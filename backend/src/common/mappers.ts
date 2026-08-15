import type {
  Earning,
  Order,
  Product,
  Transaction,
  User,
  Withdrawal,
} from '@prisma/client'
import type { OrderSplit } from '../domain/pricing'

/**
 * Persistence rows → API response shapes.
 *
 * These exist so column names never leak into the contract. The output shapes
 * are exactly the interfaces in `frontend/src/data/types.ts`; if one of these
 * functions changes, that file changes with it. Dates go out as ISO strings
 * because that is what the frontend's `format.ts` parses.
 */

export function toProduct(row: Product) {
  return {
    id: row.id,
    category: row.category,
    network: row.network,
    name: row.name,
    validity: row.validity,
    supplierCost: row.supplierCost,
    adminPrice: row.adminPrice,
    standardPrice: row.standardPrice,
    agentMarkupBp: row.agentMarkupBp,
    walkupMarkupBp: row.walkupMarkupBp,
    active: row.active,
  }
}

/**
 * `supplierCost` is James's buying price and is commercially sensitive — an
 * agent seeing it can work out exactly what James makes. Admin-only (FR-6.x),
 * so every non-admin caller gets the field stripped rather than zeroed, which
 * would read as free.
 *
 * The markups go with it, and not as a matter of taste: a price and the markup
 * behind it give up the cost by division. Stripping one and keeping the other
 * would publish the same secret in two steps.
 */
export function toPublicProduct(row: Product) {
  const {
    supplierCost: _cost,
    agentMarkupBp: _agentBp,
    walkupMarkupBp: _walkupBp,
    ...rest
  } = toProduct(row)
  return rest
}

export function toOrder(row: Order) {
  return {
    id: row.id,
    reference: row.reference,
    productId: row.productId,
    productName: row.productName,
    network: row.network,
    category: row.category,
    recipient: row.recipient,
    salePrice: row.salePrice,
    split: row.split as unknown as OrderSplit,
    soldByCode: row.soldByCode,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    paidWith: row.paidWith,
    buyer: row.buyer,
    buyerPhone: row.buyerPhone,
    ...(row.voucherSerial && row.voucherPin
      ? { voucher: { serial: row.voucherSerial, pin: row.voucherPin } }
      : {}),
    ...(row.refunded ? { refunded: true } : {}),
  }
}

/**
 * What a guest may see about an order they can quote the reference for (FR-4.9
 * order tracking). The split is who-earned-what across the whole chain and is
 * nobody's business but the participants'.
 */
export function toTrackedOrder(row: Order) {
  const { split: _private, ...rest } = toOrder(row)
  return rest
}

export function toTransaction(row: Transaction) {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    description: row.description,
    reference: row.reference,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toEarning(row: Earning) {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    description: row.description,
    reference: row.reference,
    ...(row.productName ? { productName: row.productName } : {}),
    depth: row.depth,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toWithdrawal(row: Withdrawal) {
  return {
    id: row.id,
    agentName: row.agentName,
    agentPhone: row.agentPhone,
    amount: row.amount,
    momoNetwork: row.momoNetwork,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
  }
}

/** The `Session` the frontend stores after login. No balance, no password. */
export function toSession(row: User) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    referralCode: row.referralCode,
    uplineCode: row.uplineCode,
  }
}

export function toPlatformUser(row: User, referredByName: string | null, orders: number) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    status: row.status,
    balance: row.balance,
    orders,
    referredBy: referredByName,
    joinedAt: row.joinedAt.toISOString(),
  }
}
