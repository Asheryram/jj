import test from 'node:test'
import assert from 'node:assert/strict'
import { OrdersService } from './orders.service'
import type { PlaceOrderDto } from './orders.dto'
import type { AuthUser } from '../common/auth'

/**
 * An admin can buy a bundle customers cannot (off sale, or a supplier its
 * network is not routed to). Customers and agents still cannot, and nobody
 * pays for a supplier that would not actually be sent the order.
 */


/** A GMPL MTN bundle that is off sale, while MTN is routed to DataHub. */
function service(opts: { live?: boolean; available?: boolean } = {}) {
  const svc = Object.create(OrdersService.prototype) as OrdersService
  const deps = svc as unknown as Record<string, unknown>
  const supplier = { provider: 'gmpl', networkKey: 'b-1', capacityGb: null, available: opts.available ?? true }
  const product = { id: 'p1', name: 'MTN 1GB', active: false, network: 'MTN', category: 'data', supplier }
  deps.log = { warn() {}, error() {}, log() {} }
  deps.prisma = { product: { findUnique: async () => product } }
  deps.supplier = { wouldFulfil: () => opts.live ?? true, isLiveFor: () => false }
  deps.settings = { all: async () => ({ networkProviderRouting: {} }), providerFor: () => 'datahub-gh' }
  deps.pricing = { quote: async () => ({ salePrice: 500, split: { supplierCost: 500, shares: [] } }) }
  const tx = { product: { findUnique: async () => product } }
  return { svc, tx }
}

const dto = (anySupplier?: boolean): PlaceOrderDto =>
  ({ productId: 'p1', recipient: '0241234567', payWith: 'momo', anySupplier }) as PlaceOrderDto
const user = (role: string) => ({ id: 'u1', name: 'Ama', role }) as unknown as AuthUser

test('a customer or agent cannot buy past the gates', async () => {
  const { svc } = service()
  for (const role of ['customer', 'agent']) {
    await assert.rejects(svc.place(dto(true), user(role)), /Only an admin/)
  }
  await assert.rejects(svc.place(dto(true), undefined), /Only an admin/)
})

test('an admin cannot pay for a supplier that would not be sent the order', async () => {
  const { svc } = service({ live: false })
  await assert.rejects(svc.place(dto(true), user('admin')), /GMPL is not switched on for real orders.*GMPL_LIVE/)
})

type PriceInside = (tx: unknown, id: string, seller: null, recipient: string, any?: boolean) => Promise<{ salePrice: number }>

test('pricing lets an admin past off-sale and routing, nobody else', async () => {
  const { svc, tx } = service()
  const priceInside = (svc as unknown as { priceInside: PriceInside }).priceInside.bind(svc)
  await assert.rejects(priceInside(tx, 'p1', null, '0241234567'), /not on sale/)
  const quoted = await priceInside(tx, 'p1', null, '0241234567', true)
  assert.equal(quoted.salePrice, 500)
})

test('out of stock at the supplier still stops an admin', async () => {
  const { svc, tx } = service({ available: false })
  const priceInside = (svc as unknown as { priceInside: PriceInside }).priceInside.bind(svc)
  await assert.rejects(priceInside(tx, 'p1', null, '0241234567', true), /out of stock/)
})
