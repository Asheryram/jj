import test from 'node:test'
import assert from 'node:assert/strict'
import type { ConfigService } from '@nestjs/config'
import { capacityToGb, NetpulseClient, netpulseReference } from './netpulse.client'
import { NetpulseSource } from './netpulse.source'

/**
 * NetPulse's contract as the client reads it. `fetch` is stubbed so each
 * reply they document can be played back, and every request recorded: above
 * all, a purchase must never be sent twice.
 */

type Reply = { status: number; body?: unknown } | Error

function client(replies: Record<string, Reply[]>) {
  const config = { get: (key: string) => (key === 'NETPULSE_API_KEY' ? 'np_live_x' : undefined) } as unknown as ConfigService
  const np = new NetpulseClient(config)
  const sent: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace('https://buydata.space/api/v1', '')
    const key = `${init?.method ?? 'GET'} ${path}`
    sent.push(key)
    const queue = replies[key] ?? replies[key.replace(/\/order-status\/.*/, '/order-status/*')] ?? []
    const reply = queue.shift() ?? { status: 404, body: { error: 'Not found' } }
    if (reply instanceof Error) throw reply
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status })
  }) as typeof fetch
  return { np, sent, restore: () => (globalThis.fetch = realFetch) }
}

const buy = { network: 'MTN', capacity: '1GB', recipient: '0241234567', reference: 'JDC-1' }

test('accepted: reference, status, charge in pesewas, balance after', async () => {
  const { np, restore } = client({
    'POST /purchase': [{ status: 200, body: { reference: 'NPAPI-1', status: 'processing', price: 3.7, balance: 8 } }],
  })
  try {
    const r = await np.purchase(buy)
    assert.equal(r.kind, 'accepted')
    if (r.kind !== 'accepted') return
    assert.equal(r.providerReference, 'NPAPI-1')
    assert.equal(r.providerStatus, 'processing')
    assert.equal(r.charged, 370)
    assert.equal(r.balanceAfter, 8)
  } finally {
    restore()
  }
})

test('low balance is a plain refusal, flagged', async () => {
  const { np, restore } = client({ 'POST /purchase': [{ status: 402, body: { error: 'Insufficient balance' } }] })
  try {
    const r = await np.purchase(buy)
    assert.equal(r.kind, 'rejected')
    assert.equal(r.kind === 'rejected' && r.insufficientBalance, true)
  } finally {
    restore()
  }
})

test('a timeout is looked up by our reference, and the purchase is never resent', async () => {
  const { np, sent, restore } = client({
    'POST /purchase': [new DOMException('timed out', 'TimeoutError') as unknown as Error],
    'GET /order-status/*': [{ status: 200, body: { reference: 'JDC-1', status: 'processing' } }],
  })
  try {
    const r = await np.purchase(buy)
    assert.equal(r.kind, 'accepted')
    assert.equal(r.kind === 'accepted' && r.providerReference, 'JDC-1')
    assert.equal(sent.filter((s) => s.startsWith('POST')).length, 1)
  } finally {
    restore()
  }
})

test('a timeout they have no record of is left unknown for a person', async () => {
  const { np, sent, restore } = client({
    'POST /purchase': [new Error('socket hang up')],
    'GET /order-status/*': [{ status: 404 }],
  })
  try {
    const r = await np.purchase(buy)
    assert.equal(r.kind, 'unknown')
    assert.equal(sent.filter((s) => s.startsWith('POST')).length, 1)
  } finally {
    restore()
  }
})

test('a duplicate reference is looked up, not bought again', async () => {
  const { np, sent, restore } = client({
    'POST /purchase': [{ status: 409, body: { error: 'Duplicate' } }],
    'GET /order-status/*': [{ status: 200, body: { reference: 'NPAPI-9', status: 'completed' } }],
  })
  try {
    const r = await np.purchase(buy)
    assert.equal(r.kind === 'accepted' && r.providerReference, 'NPAPI-9')
    assert.equal(sent.filter((s) => s.startsWith('POST')).length, 1)
  } finally {
    restore()
  }
})

test('order status and balance', async () => {
  const { np, restore } = client({
    'GET /order-status/*': [{ status: 200, body: { status: 'completed' } }, { status: 404 }],
    'GET /balance': [{ status: 200, body: { balance: 12.5, currency: 'GHS' } }],
  })
  try {
    assert.deepEqual(await np.orderStatus('NPAPI-1'), { kind: 'found', providerStatus: 'completed', raw: { status: 'completed' } })
    assert.deepEqual(await np.orderStatus('nope'), { kind: 'not_found' })
    assert.deepEqual(await np.balance(), { kind: 'ok', balanceCedis: 12.5 })
  } finally {
    restore()
  }
})

test('catalogue: their packages become NetPulse SKUs', async () => {
  const { np, restore } = client({
    'GET /packages': [
      {
        status: 200,
        body: {
          packages: [
            { network: 'MTN', capacity: '1GB', price: 3.7, validity: '30 Days' },
            { network: 'AirtelTigo', capacity: '500MB', price: 2.1, validity: '30 Days' },
            { network: 'Glo', capacity: '1GB', price: 1, validity: '' },
          ],
          mashup: [{ id: 'mashup-10', capacity: '10', price: 14.27 }],
        },
      },
    ],
  })
  try {
    const skus = await new NetpulseSource(np).fetch()
    assert.equal(skus.length, 2)
    assert.deepEqual(skus[0], {
      code: 'NP-MTN-1GB',
      productId: 'np-mtn-data-1gb',
      category: 'data',
      network: 'MTN',
      name: 'MTN 1GB',
      costPrice: 370,
      available: true,
      networkKey: '1GB',
      capacityGb: '1',
    })
    assert.equal(skus[1].network, 'AirtelTigo')
    assert.equal(skus[1].capacityGb, '0.5')
  } finally {
    restore()
  }
})

test('references per attempt and sizes', () => {
  assert.equal(netpulseReference('JDC-1', 1), 'JDC-1')
  assert.equal(netpulseReference('JDC-1', 2), 'JDC-1-2')
  assert.equal(capacityToGb('3GB'), '3')
  assert.equal(capacityToGb('1.5 GB'), '1.5')
  assert.equal(capacityToGb('Mashup'), null)
})
