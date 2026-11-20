import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cashBridge,
  freeToSpend,
  heldForUndelivered,
  inFlightBookedCost,
  owedToFloats,
  refundTransferFees,
  refusedCollected,
  type CashFlows,
  type Claims,
} from './free-to-spend'

/**
 * Walks money through the system one event at a time and checks, after each
 * event, that Free to spend says what the ledger says it should: profit
 * earned, plus or minus the owner's own moves. Every bug fixed alongside
 * this file showed up as a step where the two disagreed.
 */

const noFlows: CashFlows = { collected: 0, transferred: 0, reimbursed: 0, advancesRepaid: 0, ownerMoney: 0 }
const noClaims: Claims = {
  agentEarnings: 0,
  customerMoney: 0,
  undeliveredOrders: 0,
  queuedPayouts: 0,
  manualRefundAdvances: 0,
  manualPayoutAdvances: 0,
  treasuryInFlight: 0,
}
const floats = (cost: number, reimbursed = 0) =>
  owedToFloats(new Map([['datahub-gh', cost]]), new Map([['datahub-gh', reimbursed]]))

// One GHS 10.00 sale: Paystack keeps 0.20, the bundle costs 8.00, the agent earns 1.00.
const SALE = 1000
const PAYSTACK_FEE = 20
const COST = 800
const AGENT = 100
const PROFIT = SALE - PAYSTACK_FEE - COST - AGENT // 80

test('a paid order not yet sent holds its full sale price', () => {
  const r = freeToSpend(
    { ...noFlows, collected: SALE - PAYSTACK_FEE },
    { ...noClaims, undeliveredOrders: heldForUndelivered([{ salePrice: SALE, bookedCost: 0 }]) },
    floats(0),
  )
  assert.equal(r.freeToSpend, -PAYSTACK_FEE)
})

test('accepting an order does not count its bundle cost twice', () => {
  // The provider accepted it: cost booked, owed to the float, order still in flight.
  const r = freeToSpend(
    { ...noFlows, collected: SALE - PAYSTACK_FEE },
    { ...noClaims, undeliveredOrders: heldForUndelivered([{ salePrice: SALE, bookedCost: COST }]) },
    floats(COST),
  )
  // Unchanged from before acceptance. The old arithmetic read -820 here.
  assert.equal(r.freeToSpend, -PAYSTACK_FEE)
})

test('a booked cost above the sale price never frees money up', () => {
  assert.equal(heldForUndelivered([{ salePrice: 500, bookedCost: 700 }]), 0)
  assert.equal(heldForUndelivered([{ salePrice: 500, bookedCost: -50 }]), 500)
})

test('once delivered, free to spend equals profit earned', () => {
  const r = freeToSpend(
    { ...noFlows, collected: SALE - PAYSTACK_FEE },
    { ...noClaims, agentEarnings: AGENT },
    floats(COST),
  )
  assert.equal(r.freeToSpend, PROFIT)
})

test("a waiting payout holds the agent's transfer fee too", () => {
  // The agent asks for 0.99 with a 0.01 fee: both leave their balance at once.
  const r = freeToSpend(
    { ...noFlows, collected: SALE - PAYSTACK_FEE },
    { ...noClaims, queuedPayouts: 99 + 1 },
    floats(COST),
  )
  assert.equal(r.freeToSpend, PROFIT)
})

test('a payout landing does not move free to spend', () => {
  const r = freeToSpend(
    { ...noFlows, collected: SALE - PAYSTACK_FEE, transferred: 99 + 1 },
    noClaims,
    floats(COST),
  )
  assert.equal(r.freeToSpend, PROFIT)
})

test('refilling a float does not move free to spend', () => {
  const r = freeToSpend(
    { ...noFlows, collected: SALE - PAYSTACK_FEE, transferred: 100, reimbursed: COST },
    noClaims,
    floats(COST, COST),
  )
  assert.equal(r.freeToSpend, PROFIT)
})

test("one float's over-reimbursement does not cancel another's spend", () => {
  const owed = owedToFloats(
    new Map([
      ['datahub-gh', 800],
      ['gmpl', 0],
    ]),
    new Map([['gmpl', 300]]),
  )
  assert.deepEqual(owed, { 'datahub-gh': 800, gmpl: 0 })
})

test("the owner's withdrawal counts the moment it starts, not only when it lands", () => {
  const flows = { ...noFlows, collected: SALE - PAYSTACK_FEE, transferred: 100, reimbursed: COST }
  const inFlight = freeToSpend(flows, { ...noClaims, treasuryInFlight: 50 + 1 }, floats(COST, COST))
  const landed = freeToSpend({ ...flows, ownerMoney: -(50 + 1) }, noClaims, floats(COST, COST))
  assert.equal(inFlight.freeToSpend, PROFIT - 51)
  assert.equal(landed.freeToSpend, inFlight.freeToSpend)

  // And the bridge explains all of it, with nothing left in "other". Once
  // landed, the 0.01 fee is a booked cost, so it is inside profit already.
  const whileInFlight = cashBridge({
    earnedProfit: PROFIT,
    ownerTopUps: 0,
    ownerDrawings: 50,
    treasuryFees: 1,
    profitInFloats: 0,
    freeToSpend: inFlight.freeToSpend,
  })
  assert.equal(whileInFlight.other, 0)
  const afterLanding = cashBridge({
    earnedProfit: PROFIT - 1,
    ownerTopUps: 0,
    ownerDrawings: 50,
    treasuryFees: 0,
    profitInFloats: 0,
    freeToSpend: landed.freeToSpend,
  })
  assert.equal(afterLanding.other, 0)
})

test("the owner's own top-up is explained by the bridge, not left in other", () => {
  const r = freeToSpend({ ...noFlows, collected: SALE - PAYSTACK_FEE, ownerMoney: 5000 }, { ...noClaims, agentEarnings: AGENT }, floats(COST))
  const bridge = cashBridge({
    earnedProfit: PROFIT,
    ownerTopUps: 5000,
    ownerDrawings: 0,
    treasuryFees: 0,
    profitInFloats: 0,
    freeToSpend: r.freeToSpend,
  })
  assert.equal(bridge.other, 0)
})

test('a refund sent by transfer costs the same in cash as in profit', () => {
  // A GHS 5.00 sale that failed, refunded by Paystack transfer with a 0.01 fee.
  const fee = refundTransferFees(1, 0, 999)
  const r = freeToSpend({ ...noFlows, collected: 500 - 10, transferred: 500 + fee }, noClaims, floats(0))
  const profit = 500 - 10 - 500 - fee // revenue, Paystack fee, refund, refund fee
  assert.equal(r.freeToSpend, profit)
})

test("a refund's frozen fee is used, today's setting only for one sent before fees were frozen", () => {
  // Three refunds recorded 1.00 each; two older ones fall back to today's 1.50.
  assert.equal(refundTransferFees(300, 2, 150), 600)
})

test('liabilities total is the sum of its parts', () => {
  const claims: Claims = {
    agentEarnings: 1,
    customerMoney: 2,
    undeliveredOrders: 4,
    queuedPayouts: 8,
    manualRefundAdvances: 16,
    manualPayoutAdvances: 32,
    treasuryInFlight: 64,
  }
  assert.equal(freeToSpend(noFlows, claims, {}).liabilities.total, 127)
})

test('hard limits stay as cautious as before the display fix', () => {
  // An accepted order in flight: the shown figure no longer holds its cost
  // twice, but a limit subtracts it again in case the order fails after the
  // provider charged and never refunds.
  const orders = [{ salePrice: SALE, bookedCost: COST }]
  const shown = freeToSpend(
    { ...noFlows, collected: SALE - PAYSTACK_FEE },
    { ...noClaims, undeliveredOrders: heldForUndelivered(orders) },
    floats(COST),
  ).freeToSpend
  const oldArithmetic = SALE - PAYSTACK_FEE - SALE - COST
  assert.equal(shown - inFlightBookedCost(orders), oldArithmetic)
  // Never more than the sale price, never negative.
  assert.equal(inFlightBookedCost([{ salePrice: 500, bookedCost: 700 }]), 500)
  assert.equal(inFlightBookedCost([{ salePrice: 500, bookedCost: -50 }]), 0)
})

test('a refused payment counts as collected, net of its fee, estimated when never kept', () => {
  const rows = [
    { amount: 800, paymentRef: 'JDC-A' },
    { amount: 1000, paymentRef: 'JDC-B' },
    { amount: 500, paymentRef: null },
  ]
  const fees = new Map<string, number | null>([
    ['JDC-A', 16],
    ['JDC-B', null],
  ])
  // A: its own fee. B and the unreferenced one: 1.95%, rounded up.
  assert.equal(refusedCollected(rows, fees, 195), 800 - 16 + (1000 - 20) + (500 - 10))
  assert.equal(refusedCollected([], fees, 195), 0)
})

test('a float refill in transit leaves Free to spend where it was, before and after it lands', () => {
  const claims: Claims = {
    agentEarnings: 0,
    customerMoney: 0,
    undeliveredOrders: 0,
    queuedPayouts: 0,
    manualRefundAdvances: 0,
    manualPayoutAdvances: 0,
    treasuryInFlight: 0,
  }
  const cost = new Map([['gmpl', 5000]])
  const base: CashFlows = { collected: 20_000, transferred: 0, reimbursed: 0, advancesRepaid: 0, ownerMoney: 0 }

  const before = freeToSpend(base, claims, owedToFloats(cost, new Map()))
  // Sent to the MoMo number: gone from Paystack and counted against the
  // float's debt (`reimbursedByProvider` includes it), not yet in the float.
  const inTransit = freeToSpend({ ...base, reimbursed: 5000 }, claims, owedToFloats(cost, new Map([['gmpl', 5000]])))
  // Confirmed in the float: the same 5000, now as a ledger reimbursement.
  const landed = freeToSpend({ ...base, reimbursed: 5000 }, claims, owedToFloats(cost, new Map([['gmpl', 5000]])))

  assert.equal(inTransit.freeToSpend, before.freeToSpend)
  assert.equal(landed.freeToSpend, before.freeToSpend)
  assert.equal(inTransit.expectedAtPaystack, before.expectedAtPaystack - 5000)
  assert.equal(inTransit.spentOnBundles, 0)
})
