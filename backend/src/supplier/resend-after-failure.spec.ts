import test from 'node:test'
import assert from 'node:assert/strict'
import { ReconcilerService } from './reconciler.service'

/**
 * JDC-211656166: GMPL refused the order, a refund was raised, then an admin
 * bought it on DataHub by hand. Saving the DataHub reference must reopen the
 * order and cancel the refund, unless money already went back.
 */

function service(order: { status: string; refunded: boolean }, approvedRefunds = 0) {
  const calls: Array<[string, unknown]> = []
  const svc = Object.create(ReconcilerService.prototype) as ReconcilerService
  const deps = svc as unknown as Record<string, unknown>
  const row = { id: 'o1', reference: 'JDC-1', recipient: '0242554703', providerReference: 'gmpl-ref', supplierCodeAtSale: 'GMPL-x', ...order }
  const tx = {
    refundRequest: {
      count: async () => approvedRefunds,
      updateMany: async (args: unknown) => (calls.push(['refund', args]), { count: 1 }),
    },
    order: {
      updateMany: async (args: unknown) => (calls.push(['reopen', args]), { count: 1 }),
      update: async (args: unknown) => (calls.push(['order', args]), {}),
    },
    supplierDispatch: {
      create: async (args: unknown) => (calls.push(['dispatch', args]), {}),
      update: async () => ({}),
    },
  }
  deps.log = { warn() {}, log() {}, error() {} }
  deps.lastProviderCheckAt = new Map()
  deps.prisma = {
    order: { findUnique: async () => row, findFirst: async () => null },
    supplierDispatch: {
      findFirst: async () => ({ id: 'd1', attempt: 1, supplierCode: 'GMPL-x', recipient: row.recipient, costPrice: 1925, reason: null }),
    },
    supplierProduct: { findUnique: async () => ({ provider: 'gmpl' }) },
    refundRequest: { count: async () => approvedRefunds },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  }
  // Simulated supplier: no live check, so the test needs no supplier stub beyond this.
  deps.supplier = { isLiveFor: () => false }
  return { svc, calls }
}

const admin = { id: 'admin-1', role: 'admin' }

test('a failed order re-sent by hand reopens, and its refund is closed as not owed', async () => {
  const { svc, calls } = service({ status: 'failed', refunded: false })
  await svc.attachProviderReference('o1', { reference: 'DH-123', reorderedByHand: true }, admin)
  const kinds = calls.map(([k]) => k)
  assert.deepEqual(kinds, ['reopen', 'refund', 'dispatch', 'order'])
  assert.deepEqual((calls[0][1] as { where: unknown }).where, { id: 'o1', status: 'failed', refunded: false })
  const refund = calls[1][1] as { where: unknown; data: { status: string; note: string } }
  assert.deepEqual(refund.where, { orderId: 'o1', status: 'pending' })
  assert.equal(refund.data.status, 'rejected')
  assert.match(refund.data.note, /DH-123/)
})

test('an order already refunded cannot be marked delivered', async () => {
  for (const [order, approved] of [
    [{ status: 'failed', refunded: true }, 0],
    [{ status: 'failed', refunded: false }, 1],
  ] as const) {
    const { svc, calls } = service(order, approved)
    await assert.rejects(svc.attachProviderReference('o1', { reference: 'DH-123', reorderedByHand: true }, admin), /already been refunded/)
    assert.equal(calls.length, 0)
  }
})

test('a failed order still needs "I ordered it again"; a plain reference is refused', async () => {
  const { svc } = service({ status: 'failed', refunded: false })
  await assert.rejects(svc.attachProviderReference('o1', { reference: 'DH-123', reorderedByHand: false }, admin), /already failed/)
})
