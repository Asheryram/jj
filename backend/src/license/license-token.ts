import { createPublicKey, verify } from 'node:crypto'

export type LicenseStage = 'active' | 'grace' | 'restricted' | 'suspended'

export const LICENSE_STAGES: readonly LicenseStage[] = ['active', 'grace', 'restricted', 'suspended']

/** One thing this app has to keep paying for (the app itself, hosting, maintenance). */
export interface LicenseSubscription {
  name: string
  /** In pesewas (the smallest unit), like every other amount in the system. */
  amount: number
  currency: string
  interval: string
  /** Where this one stands on its own. The app as a whole stands at the worst of them. */
  stage: LicenseStage
  dueAt: string
  mode: string
  /** The end of a free trial, while there is one. */
  trialUntil: string | null
}

/** An invoice for this app that is still waiting to be paid. */
export interface LicenseInvoice {
  number: string
  /** What is still owed on it, after any part payments. */
  amount: number
  /** The whole invoice, and how much of it is already paid. */
  total: number
  paid: number
  /** A one-time item rather than a subscription renewal, and whether leaving it unpaid can limit the app. */
  oneTime: boolean
  pausesProject: boolean
  currency: string
  dueDate: string | null
  periodStart: string | null
  periodEnd: string | null
  description: string
  /** Which subscription it renews, or null for a one-off invoice. */
  subscription: string | null
  /** Where to pay this one. */
  payUrl: string | null
}

/**
 * The licence: a signed statement from the invoicing app about THIS app, and only
 * this app (a client can have several, each with its own licence). Verified here
 * with a PUBLIC key, which can check a signature but never make one.
 *
 * It says where the app stands overall (the worst of its subscriptions), what it has
 * to pay for, and every invoice still waiting.
 */
export interface LicensePayload {
  v: 1
  /** Which app this licence is for. A token for another app is rejected. */
  app: string
  /** The project's name in the invoicing app. */
  project: string
  client: string
  stage: LicenseStage
  /** Nothing to pay, or all of it exempt or paused: never restricted. */
  exempt: boolean
  dueAt: string
  graceEndsAt: string
  suspendsAt: string
  /** Plain words for the admin banner. May be empty. */
  message: string
  subscriptions: LicenseSubscription[]
  invoices: LicenseInvoice[]
  /** The most useful single place to pay. */
  payUrl: string | null
  /** What the client wants the public told while the app is paused, in their own words. */
  publicNotice: string
  issuedAt: string
  expiresAt: string
}

/**
 * Keys travel through environment variables as base64 of the PEM text, since
 * raw PEM holds newlines that env files and dashboards mangle. A literal PEM is
 * accepted too, for convenience.
 */
function pemFrom(value: string): string | null {
  const text = value.includes('BEGIN') ? value.replace(/\\n/g, '\n') : Buffer.from(value, 'base64').toString('utf8')
  return text.includes('BEGIN') ? text : null
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isDate = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
const dateOrNull = (value: unknown): string | null => (isDate(value) ? value : null)
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

/** One bad entry is dropped, never trusted halfway, and never sinks the rest of the licence. */
function parseSubscriptions(value: unknown): LicenseSubscription[] {
  if (!Array.isArray(value)) return []
  const out: LicenseSubscription[] = []
  for (const raw of value) {
    const item = raw as Partial<LicenseSubscription> | null
    if (!item || !isText(item.name) || !isAmount(item.amount) || !isText(item.currency) || !isText(item.interval)) continue
    if (!item.stage || !LICENSE_STAGES.includes(item.stage) || !isDate(item.dueAt)) continue
    out.push({
      name: item.name,
      amount: item.amount,
      currency: item.currency,
      interval: item.interval,
      stage: item.stage,
      dueAt: item.dueAt,
      mode: typeof item.mode === 'string' ? item.mode : 'auto',
      trialUntil: isDate(item.trialUntil) ? item.trialUntil : null,
    })
  }
  return out
}

function parseInvoices(value: unknown): LicenseInvoice[] {
  if (!Array.isArray(value)) return []
  const out: LicenseInvoice[] = []
  for (const raw of value) {
    const item = raw as Partial<LicenseInvoice> | null
    if (!item || !isText(item.number) || !isAmount(item.amount) || !isText(item.currency)) continue
    // A licence from an older billing app has none of the part-payment fields: the
    // amount is then the whole invoice, nothing is paid yet, and only renewals count.
    const subscription = textOrNull(item.subscription)
    out.push({
      number: item.number,
      amount: item.amount,
      total: isAmount(item.total) ? item.total : item.amount,
      paid: isAmount(item.paid) ? item.paid : 0,
      oneTime: typeof item.oneTime === 'boolean' ? item.oneTime : subscription === null,
      pausesProject: typeof item.pausesProject === 'boolean' ? item.pausesProject : subscription !== null,
      currency: item.currency,
      dueDate: dateOrNull(item.dueDate),
      periodStart: dateOrNull(item.periodStart),
      periodEnd: dateOrNull(item.periodEnd),
      description: typeof item.description === 'string' ? item.description : '',
      subscription,
      payUrl: textOrNull(item.payUrl),
    })
  }
  return out
}

/**
 * The payload, or `null` for anything that is not a valid, untampered licence
 * of the expected shape. Never throws: a bad token is simply "not a licence".
 */
export function verifyLicenseToken(token: string, publicKey: string): LicensePayload | null {
  try {
    const [body, signature] = String(token).split('.')
    if (!body || !signature) return null

    const pem = pemFrom(publicKey)
    if (!pem) return null
    const signedOk = verify(null, Buffer.from(body), createPublicKey(pem), Buffer.from(signature, 'base64url'))
    if (!signedOk) return null

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<LicensePayload>
    if (payload.v !== 1) return null
    if (typeof payload.app !== 'string' || !payload.app) return null
    if (!payload.stage || !LICENSE_STAGES.includes(payload.stage)) return null
    if (!isDate(payload.dueAt) || !isDate(payload.graceEndsAt) || !isDate(payload.suspendsAt)) return null
    if (!isDate(payload.issuedAt) || !isDate(payload.expiresAt)) return null

    return {
      v: 1,
      app: payload.app,
      project: typeof payload.project === 'string' ? payload.project : '',
      client: typeof payload.client === 'string' ? payload.client : '',
      stage: payload.stage,
      exempt: payload.exempt === true,
      dueAt: payload.dueAt,
      graceEndsAt: payload.graceEndsAt,
      suspendsAt: payload.suspendsAt,
      message: typeof payload.message === 'string' ? payload.message : '',
      subscriptions: parseSubscriptions(payload.subscriptions),
      invoices: parseInvoices(payload.invoices),
      payUrl: typeof payload.payUrl === 'string' ? payload.payUrl : null,
      publicNotice: typeof payload.publicNotice === 'string' ? payload.publicNotice.slice(0, 300) : '',
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
    }
  } catch {
    return null
  }
}
