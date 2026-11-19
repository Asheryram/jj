/**
 * The one definition of "Free to spend".
 *
 * Two places compute it: `SolvencyService.position()` (the live figure on
 * Finance, All orders and Treasury) and `EtlService.computeHistoricalSolvency`
 * (the Analytics history line). They used to carry their own copies of the
 * arithmetic, and the copies drifted: owner top-ups and drawings reached the
 * live one and never the history, so the chart and the tile stopped agreeing
 * the first time the owner moved money. Both now gather their inputs (live,
 * or as of the end of a past day) and hand them here, so the arithmetic can
 * only ever be wrong in one place, and is tested in `free-to-spend.spec.ts`.
 *
 * Everything is pesewas.
 */

/** Treasury transfer states that may still move money, see `TreasuryService`. */
export const TREASURY_IN_FLIGHT = ['sending', 'pending', 'otp', 'unknown'] as const

/** Money that went through Paystack, by our own records. */
export interface CashFlows {
  /** Paid in by customers, net of Paystack's fee. */
  collected: number
  /** Agent payouts and refunds Paystack itself sent, each with its sending fee. */
  transferred: number
  /** Moved to supplier floats, logged as reimbursements. */
  reimbursed: number
  /** Manual refunds and payouts repaid to whoever covered them. */
  advancesRepaid: number
  /** Owner's own top-ups in, less owner withdrawals and treasury fees (signed). */
  ownerMoney: number
}

/** Claims already on that money. All positive. */
export interface Claims {
  agentEarnings: number
  customerMoney: number
  /** See `heldForUndelivered`. */
  undeliveredOrders: number
  /** Requested, balance already debited (amount and fee), not yet sent. */
  queuedPayouts: number
  manualRefundAdvances: number
  manualPayoutAdvances: number
  /**
   * The owner's own treasury transfers still on their way out: the amount of
   * an owner withdrawal, and the sending fee of any treasury transfer. Not a
   * debt to anyone, but money that is about to leave, so it is not free. A
   * float refill or advance repayment in flight is not counted here: when it
   * lands it lowers what is held and what is owed by the same amount.
   */
  treasuryInFlight: number
}

/**
 * What a paid, not-yet-delivered order holds back.
 *
 * The sale price, less whatever supplier cost has already been booked for it.
 * A provider's cost is booked the moment it accepts the order (see
 * `FulfilmentService`), and from then on that cost is already counted in
 * "owed to the provider float". Holding the full sale price on top of it
 * counted the cost twice, so Free to spend fell by the bundle's cost while
 * the order was in flight and jumped back when it was delivered. Floored at
 * zero per order: a cost above the sale price must not free up money.
 */
export function heldForUndelivered(orders: readonly { salePrice: number; bookedCost: number }[]): number {
  return orders.reduce((sum, o) => sum + Math.max(0, o.salePrice - Math.max(0, o.bookedCost)), 0)
}

/**
 * The part of in-flight orders' sale price that `heldForUndelivered` does
 * not hold, because their bundle cost is already counted as owed to a float.
 *
 * Right for the figure shown, which is the expected outcome: the order is
 * delivered. Not safe for a hard limit on money leaving: an order can still
 * fail after the provider charged for it and never refund the charge (two
 * production orders, GHS 29.40, did exactly that), and then the customer is
 * owed the full sale price on top of the cost already spent. Limits subtract
 * this as well, so they stay exactly as cautious as before the display fix.
 */
export function inFlightBookedCost(orders: readonly { salePrice: number; bookedCost: number }[]): number {
  return orders.reduce((sum, o) => sum + Math.min(o.salePrice, Math.max(0, o.bookedCost)), 0)
}

/**
 * What each provider's float is still owed: bundle cost booked, less what has
 * been reimbursed. Floored at zero per provider, so one float that was
 * over-reimbursed cannot cancel another's real spend.
 */
export function owedToFloats(
  costByProvider: ReadonlyMap<string, number>,
  reimbursedByProvider: ReadonlyMap<string, number>,
): Record<string, number> {
  const providers = new Set([...costByProvider.keys(), ...reimbursedByProvider.keys()])
  return Object.fromEntries(
    [...providers].map((p) => [p, Math.max(0, (costByProvider.get(p) ?? 0) - (reimbursedByProvider.get(p) ?? 0))]),
  )
}

/**
 * Sending fees on refund transfers: each refund's own frozen fee where it has
 * one, today's configured fee only for a refund sent before fees were frozen.
 */
export function refundTransferFees(withFee: number, countWithoutFee: number, currentFee: number): number {
  return withFee + countWithoutFee * currentFee
}

export function freeToSpend(flows: CashFlows, claims: Claims, owedToFloatsByProvider: Record<string, number>) {
  const expectedAtPaystack =
    flows.collected - flows.transferred - flows.reimbursed - flows.advancesRepaid + flows.ownerMoney
  const spentOnBundles = Object.values(owedToFloatsByProvider).reduce((sum, v) => sum + v, 0)
  const total =
    claims.agentEarnings +
    claims.customerMoney +
    claims.undeliveredOrders +
    claims.queuedPayouts +
    claims.manualRefundAdvances +
    claims.manualPayoutAdvances +
    claims.treasuryInFlight
  return {
    expectedAtPaystack,
    spentOnBundles,
    liabilities: { ...claims, total },
    freeToSpend: expectedAtPaystack - total - spentOnBundles,
  }
}

/**
 * Profit earned, walked across to Free to spend, line by line.
 *
 * Profit is what sales made; Free to spend is cash left after everything
 * owed. The known differences each get their own line, so the remainder is
 * only what is genuinely unexplained (Paystack fees on orders still in
 * flight, rounding). Before this, the owner's own top-ups and withdrawals
 * were all in one "other" line, and a GHS 500 withdrawal set off a warning
 * telling the admin to go and look for a wrong record.
 */
export function cashBridge(input: {
  earnedProfit: number
  ownerTopUps: number
  /** Owner withdrawals, landed or still on their way out. Positive. */
  ownerDrawings: number
  /**
   * Sending fees on the owner's treasury transfers still in flight. Positive.
   * Only in flight: a landed one is booked as a `payout_fee` cost, so it is
   * already inside `earnedProfit`, and counting it here too took it off twice.
   */
  treasuryFees: number
  /** Profit already moved into a supplier float beyond what it was owed. */
  profitInFloats: number
  freeToSpend: number
}) {
  const explained =
    input.earnedProfit + input.ownerTopUps - input.ownerDrawings - input.treasuryFees - input.profitInFloats
  return { ...input, other: input.freeToSpend - explained }
}
