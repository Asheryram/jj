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

/**
 * `provider` is carried when the caller loaded the supplier relation.
 *
 * Which supplier fulfils a product only matters once there is more than one, and
 * there will be: DataHub sells data and nothing else, so airtime, voice, SMS and
 * AFA have to come from somewhere else. An admin pricing a mixed catalogue needs
 * to see which row comes from where; a customer does not.
 *
 * Null rather than a guess when nothing is linked yet — an unfulfillable product
 * saying "datahub-gh" would be a claim nobody checked.
 */
type ProductRow = Product & { supplier?: { provider: string } | null }

/**
 * What every product read must include for `toProduct` to be complete.
 *
 * Exported so no query can forget. When it was left to each call site, the update
 * paths did not load the relation — so editing a price returned a product whose
 * `provider` was null, and the row that had said `datahub-gh` a moment earlier
 * redrew as "no supplier". The data was fine; the response was simply missing a
 * join, which is the kind of bug that looks like data loss.
 */
export const PRODUCT_INCLUDE = { supplier: { select: { provider: true } } } as const

export function toProduct(row: ProductRow) {
  return {
    provider: row.supplier?.provider ?? null,
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
export function toPublicProduct(row: ProductRow) {
  const {
    supplierCost: _cost,
    agentMarkupBp: _agentBp,
    walkupMarkupBp: _walkupBp,
    // Who supplies it is nobody's business but the platform's.
    provider: _provider,
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
    // So the admin queue can cross-reference the requesting agent's current
    // account status — a suspended agent's already-queued payout otherwise
    // looks identical to any other request.
    userId: row.userId,
    agentName: row.agentName,
    agentPhone: row.agentPhone,
    amount: row.amount,
    momoNetwork: row.momoNetwork,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    /** Paystack's word on the transfer, or 'manual'/'unknown' — same shape as a refund's. */
    transferStatus: row.transferStatus,
    /** Why it hasn't gone, or how it was sent by hand, when either is known. */
    transferNote: row.transferNote,
    paidAt: row.paidAt?.toISOString() ?? null,
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
    /**
     * Carried so the app can show an agent what they are waiting for.
     *
     * A pending agent is allowed to sign in — being told their password is wrong
     * would send them round in circles — so the client needs to know that they
     * are approved before it offers them selling tools they cannot use.
     */
    status: row.status,
    /** Why an application was refused. Shown to them, so it travels with them. */
    statusNote: row.statusNote,
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
