import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { ServiceUnavailableException, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { LicenseService } from './license.service'
import { LICENSE_GATE_KEY, LicenseGuard } from './license.gate'
import { verifyLicenseToken, type LicensePayload, type LicenseStage } from './license-token'
import { LicenseController } from './license.controller'

// A real key pair, made the same way the invoicing app makes its own.
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const PUBLIC_KEY = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64')
const OTHER_PUBLIC_KEY = Buffer.from(
  generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }),
).toString('base64')

const APP = 'app_0123456789abcdef01234567'
const URL = `https://billing.example.com/license/${APP}`

function payloadFor(stage: LicenseStage, overrides: Partial<LicensePayload> = {}): LicensePayload {
  const now = Date.now()
  return {
    v: 1,
    app: APP,
    client: 'Acme',
    stage,
    exempt: false,
    dueAt: new Date(now - 3 * 86_400_000).toISOString(),
    graceEndsAt: new Date(now + 4 * 86_400_000).toISOString(),
    suspendsAt: new Date(now + 27 * 86_400_000).toISOString(),
    message: `stage is ${stage}`,
    payUrl: 'https://billing.example.com/pay/abc',
    publicNotice: '',
    project: 'JKBK Data Hub',
    subscriptions: [
      { name: 'App', amount: 50000, currency: 'GHS', interval: 'monthly', stage, dueAt: new Date(now - 3 * 86_400_000).toISOString(), mode: 'auto', trialUntil: null, nextAmount: null, nextAmountFrom: null },
      { name: 'Hosting', amount: 20000, currency: 'GHS', interval: 'monthly', stage: 'active', dueAt: new Date(now + 40 * 86_400_000).toISOString(), mode: 'auto', trialUntil: null, nextAmount: null, nextAmountFrom: null },
    ],
    invoices: [
      {
        number: 'INV-0007',
        amount: 50000,
        total: 50000,
        paid: 0,
        oneTime: false,
        pausesProject: true,
        currency: 'GHS',
        dueDate: new Date(now - 3 * 86_400_000).toISOString(),
        periodStart: new Date(now - 3 * 86_400_000).toISOString(),
        periodEnd: new Date(now + 27 * 86_400_000).toISOString(),
        description: 'App subscription',
        subscription: 'App',
        payUrl: 'https://billing.example.com/pay/inv7',
      },
    ],
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 86_400_000).toISOString(),
    ...overrides,
  }
}

function tokenFor(payload: unknown, key = privateKey): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(null, Buffer.from(body), key).toString('base64url')}`
}

function service(env: Record<string, string>, answer?: () => Promise<Response>): LicenseService {
  const config = new ConfigService({ LICENSE_URL: URL, LICENSE_PUBLIC_KEY: PUBLIC_KEY, ...env })
  const instance = new LicenseService(config)
  if (answer) instance.setFetchForTest(answer as unknown as typeof fetch)
  return instance
}

const respondWith = (token: string) => async () => new Response(JSON.stringify({ token }), { status: 200 })

function gateContext(handlerKind: 'always' | 'unless-wallet' | null, body: unknown = {}): { context: ExecutionContext; reflector: Reflector } {
  const handler = () => undefined
  const reflector = new Reflector()
  if (handlerKind) Reflect.defineMetadata(LICENSE_GATE_KEY, { kind: handlerKind, message: 'Paused for now.' }, handler)
  const context = {
    getHandler: () => handler,
    getClass: () => class Nothing {},
    switchToHttp: () => ({ getRequest: () => ({ body, method: 'POST', url: '/x' }) }),
  } as unknown as ExecutionContext
  return { context, reflector }
}

// ---------------------------------------------------------------- the token

test('a genuine licence verifies, and anything altered or foreign does not', () => {
  const token = tokenFor(payloadFor('grace'))
  assert.equal(verifyLicenseToken(token, PUBLIC_KEY)?.stage, 'grace')

  const [, signature] = token.split('.')
  const forged = Buffer.from(JSON.stringify(payloadFor('active'))).toString('base64url')
  assert.equal(verifyLicenseToken(`${forged}.${signature}`, PUBLIC_KEY), null, 'a changed payload fails')
  assert.equal(verifyLicenseToken(token, OTHER_PUBLIC_KEY), null, 'someone else\'s key cannot vouch for it')
  assert.equal(verifyLicenseToken('garbage', PUBLIC_KEY), null)
  assert.equal(verifyLicenseToken(token, 'not a key'), null)
})

test('the subscriptions and the invoices come through, and a broken entry is dropped without sinking the licence', () => {
  const good = verifyLicenseToken(tokenFor(payloadFor('grace')), PUBLIC_KEY)
  assert.equal(good?.project, 'JKBK Data Hub')
  assert.deepEqual(good?.subscriptions.map((item) => item.name), ['App', 'Hosting'])
  assert.equal(good?.invoices[0]?.number, 'INV-0007')
  assert.equal(good?.invoices[0]?.subscription, 'App')
  assert.equal(good?.invoices[0]?.payUrl, 'https://billing.example.com/pay/inv7')

  const mixed = verifyLicenseToken(
    tokenFor({
      ...payloadFor('grace'),
      subscriptions: [{ name: 5 }, ...payloadFor('grace').subscriptions],
      invoices: [{ number: 'X' }, ...payloadFor('grace').invoices],
    }),
    PUBLIC_KEY,
  )
  assert.equal(mixed?.stage, 'grace', 'the rest of the licence still stands')
  assert.equal(mixed?.subscriptions.length, 2, 'the broken subscription was dropped, the good ones kept')
  assert.equal(mixed?.invoices.length, 1, 'the broken invoice was dropped, the good one kept')

  const older = { ...payloadFor('grace') } as Partial<LicensePayload>
  delete older.subscriptions
  delete older.invoices
  delete older.project
  const parsed = verifyLicenseToken(tokenFor(older), PUBLIC_KEY)
  assert.equal(parsed?.stage, 'grace', 'a licence from before these fields existed still works')
  assert.deepEqual(parsed?.invoices, [])
  assert.deepEqual(parsed?.subscriptions, [])
})

test('part payments and one-time items come through, and an invoice from an older billing app gets safe defaults', () => {
  const partly = verifyLicenseToken(
    tokenFor({
      ...payloadFor('restricted'),
      invoices: [
        { ...payloadFor('restricted').invoices[0], number: 'INV-0009', amount: 30000, total: 50000, paid: 20000, oneTime: true, pausesProject: true, subscription: null },
      ],
    }),
    PUBLIC_KEY,
  )
  assert.deepEqual(
    partly?.invoices.map(({ amount, total, paid, oneTime, pausesProject }) => ({ amount, total, paid, oneTime, pausesProject })),
    [{ amount: 30000, total: 50000, paid: 20000, oneTime: true, pausesProject: true }],
  )

  const { total, paid, oneTime, pausesProject, ...oldRenewal } = payloadFor('grace').invoices[0]
  void [total, paid, oneTime, pausesProject]
  const oldOneOff = { ...oldRenewal, number: 'INV-0010', subscription: null }
  const older = verifyLicenseToken(tokenFor({ ...payloadFor('grace'), invoices: [oldRenewal, oldOneOff] }), PUBLIC_KEY)
  assert.deepEqual(
    older?.invoices.map(({ amount, total: t, paid: p, oneTime: o, pausesProject: b }) => [amount, t, p, o, b]),
    [
      [50000, 50000, 0, false, true],
      [50000, 50000, 0, true, false],
    ],
    'the whole amount is owed, a renewal can limit the app, a one-off cannot',
  )
})

test('a signed but malformed licence is refused', () => {
  assert.equal(verifyLicenseToken(tokenFor({ ...payloadFor('active'), stage: 'banana' }), PUBLIC_KEY), null)
  assert.equal(verifyLicenseToken(tokenFor({ ...payloadFor('active'), dueAt: 'not a date' }), PUBLIC_KEY), null)
  assert.equal(verifyLicenseToken(tokenFor({ ...payloadFor('active'), v: 2 }), PUBLIC_KEY), null)
})

// ---------------------------------------------------------------- the service

test('with no LICENSE_URL the app is not managed at all, and nothing is ever paused', () => {
  const none = new LicenseService(new ConfigService({ LICENSE_ENFORCE: 'true' }))
  const status = none.status()
  assert.equal(status.source, 'disabled')
  assert.equal(status.paused, false)
})

test('a URL without a usable key is flagged as misconfigured and fails open', async () => {
  const broken = service({ LICENSE_PUBLIC_KEY: '', LICENSE_ENFORCE: 'true' })
  assert.equal(broken.status().source, 'misconfigured')
  assert.equal(broken.status().paused, false)
})

test('a fresh verified restricted licence pauses revenue when enforced, and only reports when not', async () => {
  const enforced = service({ LICENSE_ENFORCE: 'true' }, respondWith(tokenFor(payloadFor('restricted'))))
  await enforced.refresh()
  assert.equal(enforced.status().source, 'live')
  assert.equal(enforced.status().stage, 'restricted')
  assert.equal(enforced.status().paused, true)

  const reportOnly = service({}, respondWith(tokenFor(payloadFor('restricted'))))
  await reportOnly.refresh()
  assert.equal(reportOnly.status().stage, 'restricted', 'it still knows')
  assert.equal(reportOnly.status().paused, false, 'but blocks nothing')
})

test('grace never pauses anything, even when enforced', async () => {
  const s = service({ LICENSE_ENFORCE: 'true' }, respondWith(tokenFor(payloadFor('grace'))))
  await s.refresh()
  assert.equal(s.status().paused, false)
  assert.equal(s.status().stage, 'grace')
})

test('an exempt client is never paused, whatever the stage says', async () => {
  const s = service({ LICENSE_ENFORCE: 'true' }, respondWith(tokenFor(payloadFor('suspended', { exempt: true }))))
  await s.refresh()
  assert.equal(s.status().paused, false)
})

test('a licence for a different app, a forged one, and an already-expired one are all ignored', async () => {
  const wrongApp = service({ LICENSE_ENFORCE: 'true' }, respondWith(tokenFor(payloadFor('suspended', { app: 'app_ffffffffffffffffffffffff' }))))
  await wrongApp.refresh()
  assert.equal(wrongApp.status().paused, false)
  assert.match(wrongApp.status().lastError ?? '', /different app/)

  const other = generateKeyPairSync('ed25519').privateKey
  const forged = service({ LICENSE_ENFORCE: 'true' }, respondWith(tokenFor(payloadFor('suspended'), other)))
  await forged.refresh()
  assert.equal(forged.status().paused, false)
  assert.equal(forged.status().source, 'unverified')

  const old = payloadFor('suspended', { expiresAt: new Date(Date.now() - 86_400_000).toISOString() })
  const replayed = service({ LICENSE_ENFORCE: 'true' }, respondWith(tokenFor(old)))
  await replayed.refresh()
  assert.equal(replayed.status().paused, false)
  assert.match(replayed.status().lastError ?? '', /expired/)
})

test('a failing billing server never blocks anyone', async () => {
  for (const answer of [
    async () => new Response('down', { status: 503 }),
    async () => {
      throw new Error('connect timeout')
    },
    async () => new Response('not json', { status: 200 }),
  ]) {
    const s = service({ LICENSE_ENFORCE: 'true' }, answer)
    await s.refresh()
    assert.equal(s.status().paused, false)
    assert.ok(s.status().lastError)
  }
})

test('the moment the billing server stops answering, the app runs as if everything is paid, and picks up again when it is back', async () => {
  let up = true
  const s = service({ LICENSE_ENFORCE: 'true' }, async () => {
    if (!up) throw new Error('billing is down')
    return new Response(JSON.stringify({ token: tokenFor(payloadFor('suspended')) }), { status: 200 })
  })
  await s.refresh()
  assert.equal(s.status().paused, true, 'suspended while the billing server says so')

  up = false
  await s.refresh()
  const down = s.status()
  assert.equal(down.source, 'unreachable')
  assert.equal(down.paused, false, 'not a minute of blocking because the billing server is down')
  assert.equal(down.stage, 'active')
  assert.deepEqual([down.subscriptions, down.invoices, down.message, down.payUrl], [[], [], '', null], 'the subscription is simply blank')

  up = true
  await s.refresh()
  assert.equal(s.status().source, 'live')
  assert.equal(s.status().paused, true, 'once it answers again, its answer counts again')
})

test('payment is seen on the very next check', async () => {
  let stage: LicenseStage = 'suspended'
  const s = service({ LICENSE_ENFORCE: 'true' }, async () => new Response(JSON.stringify({ token: tokenFor(payloadFor(stage)) }), { status: 200 }))
  await s.refresh()
  assert.equal(s.status().paused, true)
  stage = 'active'
  await s.refresh()
  assert.equal(s.status().paused, false)
})

test('overlapping checks share one request', async () => {
  let calls = 0
  const s = service({}, async () => {
    calls += 1
    return new Response(JSON.stringify({ token: tokenFor(payloadFor('active')) }), { status: 200 })
  })
  await Promise.all([s.refresh(), s.refresh(), s.refresh()])
  assert.equal(calls, 1)
})

// ---------------------------------------------------------------- the guard

async function liveService(stage: LicenseStage, env: Record<string, string> = { LICENSE_ENFORCE: 'true' }): Promise<LicenseService> {
  const s = service(env, respondWith(tokenFor(payloadFor(stage))))
  await s.refresh()
  return s
}

test('the guard leaves unmarked routes completely alone', async () => {
  const { context, reflector } = gateContext(null)
  assert.equal(new LicenseGuard(reflector, await liveService('suspended')).canActivate(context), true)
})

test('a marked route is refused while restricted or suspended, with the shared error envelope', async () => {
  for (const stage of ['restricted', 'suspended'] as LicenseStage[]) {
    const { context, reflector } = gateContext('always')
    const guard = new LicenseGuard(reflector, await liveService(stage))
    assert.throws(
      () => guard.canActivate(context),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException)
        const body = (error as ServiceUnavailableException).getResponse() as { code: string; message: string }
        assert.equal(body.code, 'SERVICE_PAUSED')
        assert.equal(body.message, 'Paused for now.')
        return true
      },
    )
  }
})

test('a marked route works normally while active, in grace, in report-only mode, or exempt', async () => {
  const cases: [LicenseStage, Record<string, string>][] = [
    ['active', { LICENSE_ENFORCE: 'true' }],
    ['grace', { LICENSE_ENFORCE: 'true' }],
    ['suspended', {}],
  ]
  for (const [stage, env] of cases) {
    const { context, reflector } = gateContext('always')
    assert.equal(new LicenseGuard(reflector, await liveService(stage, env)).canActivate(context), true, `${stage} ${JSON.stringify(env)}`)
  }
})

test('a wallet-paid order goes through even while paused, but a mobile money one does not', async () => {
  const lapsed = await liveService('restricted')
  const wallet = gateContext('unless-wallet', { payWith: 'wallet' })
  assert.equal(new LicenseGuard(wallet.reflector, lapsed).canActivate(wallet.context), true)

  const momo = gateContext('unless-wallet', { payWith: 'momo' })
  assert.throws(() => new LicenseGuard(momo.reflector, lapsed).canActivate(momo.context), ServiceUnavailableException)

  // A route marked "always" gives the wallet no special treatment.
  const topUp = gateContext('always', { payWith: 'wallet' })
  assert.throws(() => new LicenseGuard(topUp.reflector, lapsed).canActivate(topUp.context), ServiceUnavailableException)
})

// ---------------------------------------------------------------- key rotation, strict mode, notices

test('while the signing key is being changed, a licence signed with either key is accepted', async () => {
  const fresh = generateKeyPairSync('ed25519')
  const newPublic = Buffer.from(fresh.publicKey.export({ type: 'spki', format: 'pem' })).toString('base64')
  const signedWithNew = tokenFor(payloadFor('restricted'), fresh.privateKey)
  const both = service({ LICENSE_ENFORCE: 'true', LICENSE_PUBLIC_KEY: `${PUBLIC_KEY}, ${newPublic}` }, respondWith(signedWithNew))
  await both.refresh()
  assert.equal(both.status().source, 'live')
  assert.equal(both.status().stage, 'restricted')

  const oldOnly = service({ LICENSE_ENFORCE: 'true' }, respondWith(signedWithNew))
  await oldOnly.refresh()
  assert.equal(oldOnly.status().source, 'unverified', 'a key that is not trusted yet is refused')
})

test('the strict setting refuses wallet orders once suspended, and only then', async () => {
  const wallet = gateContext('unless-wallet', { payWith: 'wallet' })
  const strict = { LICENSE_ENFORCE: 'true', LICENSE_STRICT_SUSPEND: 'true' }
  const suspended = await liveService('suspended', strict)
  assert.throws(() => new LicenseGuard(wallet.reflector, suspended).canActivate(wallet.context), ServiceUnavailableException)
  const restricted = await liveService('restricted', strict)
  assert.equal(new LicenseGuard(wallet.reflector, restricted).canActivate(wallet.context), true, 'restricted still lets wallets through')
  const normal = await liveService('suspended')
  assert.equal(new LicenseGuard(wallet.reflector, normal).canActivate(wallet.context), true, 'off by default')
})

test('the public status carries the client notice while paused, and a heads-up only when the owner asks for it', async () => {
  const paused = service({ LICENSE_ENFORCE: 'true' }, respondWith(tokenFor(payloadFor('suspended', { publicNotice: 'Back soon.' }))))
  await paused.refresh()
  assert.deepEqual(new LicenseController(paused).publicStatus(), { level: 'suspended', notice: 'Back soon.' })

  const lastDay = { graceEndsAt: new Date(Date.now() + 6 * 3_600_000).toISOString() }
  const quiet = service({ LICENSE_ENFORCE: 'true' }, respondWith(tokenFor(payloadFor('grace', lastDay))))
  await quiet.refresh()
  assert.deepEqual(new LicenseController(quiet).publicStatus(), { level: 'ok' }, 'agents are not told unless the owner wants them to be')
  const warned = service({ LICENSE_ENFORCE: 'true', LICENSE_WARN_AGENTS: 'true' }, respondWith(tokenFor(payloadFor('grace', lastDay))))
  await warned.refresh()
  assert.deepEqual(new LicenseController(warned).publicStatus(), { level: 'ok', pausesSoon: true })
})

test('a slow or failed first request is tried once more, so a billing app waking from idle still answers', async () => {
  let calls = 0
  const flaky = service({ LICENSE_ENFORCE: 'true' }, async () => {
    calls += 1
    if (calls === 1) throw new Error('The operation was aborted due to timeout')
    return new Response(JSON.stringify({ token: tokenFor(payloadFor('restricted')) }), { status: 200 })
  })
  await flaky.refresh()
  assert.equal(calls, 2)
  assert.equal(flaky.status().source, 'live')
  assert.equal(flaky.status().stage, 'restricted')

  let serverErrors = 0
  const busy = service({ LICENSE_ENFORCE: 'true' }, async () => {
    serverErrors += 1
    return serverErrors === 1 ? new Response('waking up', { status: 503 }) : new Response(JSON.stringify({ token: tokenFor(payloadFor('active')) }), { status: 200 })
  })
  await busy.refresh()
  assert.equal(busy.status().source, 'live', 'a server error is retried too')

  let forged = 0
  const wrong = service({ LICENSE_ENFORCE: 'true' }, async () => {
    forged += 1
    return new Response(JSON.stringify({ token: 'not.a-licence' }), { status: 200 })
  })
  await wrong.refresh()
  assert.equal(forged, 1, 'a wrong answer is not asked for again')
  assert.equal(wrong.status().paused, false)
})

test('a coming price change comes through, and a licence without one still parses', () => {
  const base = payloadFor('active')
  const withChange = verifyLicenseToken(
    tokenFor({ ...base, subscriptions: [{ ...base.subscriptions[0], nextAmount: 75000, nextAmountFrom: new Date(Date.now() + 30 * 86_400_000).toISOString() }] }),
    PUBLIC_KEY,
  )
  assert.equal(withChange?.subscriptions[0]?.nextAmount, 75000)
  assert.ok(withChange?.subscriptions[0]?.nextAmountFrom)
  const plain = verifyLicenseToken(tokenFor(base), PUBLIC_KEY)
  assert.equal(plain?.subscriptions[0]?.nextAmount, null)
})
