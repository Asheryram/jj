/**
 * Audit every place money is recorded, and report where the books disagree.
 *
 * Not a test of the code paths — those can be right and the data still wrong,
 * because a bug that has already run leaves its damage behind after the fix.
 * This reads the ledgers as they stand and checks the claims the system makes
 * about them.
 *
 * Each check states what must be true and why. A failure is a real
 * money discrepancy, not a style problem, so nothing here is advisory.
 *
 * Run with: npx tsx scripts/money-audit.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { splitDiscrepancy, type OrderSplit } from '../src/domain/pricing'

const prisma = new PrismaClient()
const ghs = (pesewas: number) => `GHS ${(pesewas / 100).toFixed(2)}`

interface Finding {
  check: string
  detail: string
}

const failures: Finding[] = []
const notes: string[] = []

function report(check: string, ok: boolean, detail: string) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${check}`)
  if (!ok) {
    console.log(`        ${detail}`)
    failures.push({ check, detail })
  }
}

/**
 * 1 — The split invariant.
 *
 * Every order carries a snapshot of who earned what. The customer's money must
 * equal the supplier's cost plus every margin, exactly. A mismatch means money
 * was created or destroyed at the moment of sale.
 */
async function splitsBalance() {
  const orders = await prisma.order.findMany({
    select: { reference: true, salePrice: true, split: true, status: true },
  })

  const broken = orders.filter(
    (o) => splitDiscrepancy(o.salePrice, o.split as unknown as OrderSplit) !== 0,
  )

  report(
    'every order split balances (salePrice = cost + Σ margins)',
    broken.length === 0,
    broken.map((o) => `${o.reference}: off by ${splitDiscrepancy(o.salePrice, o.split as unknown as OrderSplit)}p`).join(', '),
  )
}

/**
 * 2 — Agent balances match their ledgers.
 *
 * A balance is a cached total. The ledger is the truth. If they disagree, either
 * a credit was applied twice or one went missing — and the balance is what an
 * agent gets paid from.
 */
async function balancesMatchLedgers() {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, role: true, balance: true },
  })

  const bad: string[] = []
  for (const user of users) {
    const earned = await prisma.earning.aggregate({
      where: { userId: user.id },
      _sum: { amount: true },
    })
    const moved = await prisma.transaction.aggregate({
      where: { userId: user.id },
      _sum: { amount: true },
    })

    // Customers move money through `transactions` (top-ups, purchases, refunds);
    // agents accrue through `earnings` and draw down through withdrawals, which
    // also write a transaction. Both roll up into the same balance.
    const expected = (earned._sum.amount ?? 0) + (moved._sum.amount ?? 0)
    if (expected !== user.balance) {
      bad.push(`${user.name} (${user.role}): balance ${ghs(user.balance)} vs ledgers ${ghs(expected)}`)
    }
  }

  report('balances equal the sum of their ledger entries', bad.length === 0, bad.join(' | '))
}

/**
 * 2b — Every agent credit traces to a real, completed order that actually
 * shares with them, and every such order produced exactly one.
 *
 * The check above can only ever say a balance matches its OWN ledger rows —
 * `creditAgent`/`reverseAgent` always pair a balance change with its own
 * Earning row in the same transaction, so a duplicated or fabricated event
 * (two settlements racing the same order, or a reversal running against an
 * order that was never credited) keeps a user's own books internally
 * consistent and invisible to `balancesMatchLedgers`. This checks the other
 * direction: against the order itself, not just against the agent's own
 * ledger.
 */
async function agentCreditsMatchOrders() {
  const credits = await prisma.earning.findMany({
    where: { type: { in: ['sale', 'downline'] } },
    select: { userId: true, reference: true },
  })

  const completed = await prisma.order.findMany({
    where: { status: 'completed' },
    select: { reference: true, split: true },
  })

  const expectedByOrder = new Map<string, Set<string>>()
  for (const order of completed) {
    const split = order.split as unknown as OrderSplit
    const agentIds = new Set(
      split.shares.filter((s) => s.role === 'agent' && s.margin > 0).map((s) => s.userId),
    )
    if (agentIds.size > 0) expectedByOrder.set(order.reference, agentIds)
  }

  const seenByOrder = new Map<string, Set<string>>()
  const orphaned: string[] = []
  for (const credit of credits) {
    const expected = expectedByOrder.get(credit.reference)
    if (!expected || !expected.has(credit.userId)) {
      orphaned.push(`${credit.reference} credited ${credit.userId}, but no completed order shares with them`)
      continue
    }
    if (!seenByOrder.has(credit.reference)) seenByOrder.set(credit.reference, new Set())
    seenByOrder.get(credit.reference)!.add(credit.userId)
  }

  const missing: string[] = []
  for (const [reference, agentIds] of expectedByOrder) {
    const got = seenByOrder.get(reference) ?? new Set()
    for (const userId of agentIds) {
      if (!got.has(userId)) missing.push(`${reference} owes ${userId} a credit that was never written`)
    }
  }

  report(
    'every agent credit traces to a completed order that shares with them, one each',
    orphaned.length === 0 && missing.length === 0,
    [...orphaned, ...missing].join(' | '),
  )
}

/**
 * 3 — Nothing was delivered without being paid for.
 *
 * The bug this exists for actually happened: unpaid orders were parked in
 * `pending`, and the restart-recovery sweep treated that as "never dispatched"
 * and fulfilled them for free.
 */
async function nothingDeliveredUnpaid() {
  const delivered = await prisma.order.findMany({
    where: { status: { in: ['completed', 'processing', 'awaiting_approval'] } },
    select: {
      reference: true,
      status: true,
      paidWith: true,
      salePrice: true,
      payment: { select: { status: true } },
    },
  })

  // A wallet order was paid at top-up time and has no Payment row of its own.
  const unpaid = delivered.filter(
    (o) => o.paidWith === 'momo' && o.payment != null && o.payment.status !== 'paid',
  )

  report(
    'no order was fulfilled while its payment was unpaid',
    unpaid.length === 0,
    unpaid.map((o) => `${o.reference} (${o.status}, payment ${o.payment?.status}, ${ghs(o.salePrice)})`).join(', '),
  )
}

/**
 * 4 — Every failed order that took money has been dealt with.
 *
 * Refunds are authorised by a person rather than paid automatically, so "not yet
 * refunded" is a legitimate state — but "neither refunded nor queued nor refused"
 * is not. That is money taken from somebody with nothing at all standing against
 * it, and nothing would ever surface it.
 */
async function failedOrdersAccountedFor() {
  const failed = await prisma.order.findMany({
    where: { status: 'failed' },
    select: {
      reference: true,
      paidWith: true,
      refunded: true,
      salePrice: true,
      payment: { select: { status: true } },
      refundRequest: { select: { status: true } },
    },
  })

  const unaccounted = failed.filter((o) => {
    const moneyWasTaken = o.paidWith === 'wallet' || o.payment?.status === 'paid'
    if (!moneyWasTaken) return false
    // Refunded, queued for approval, or explicitly refused with a reason. Any of
    // those is an answer; none of them is the failure.
    return !o.refunded && !o.refundRequest
  })

  report(
    'every failed order that took money is refunded, queued or refused',
    unaccounted.length === 0,
    unaccounted.map((o) => `${o.reference} took ${ghs(o.salePrice)} with nothing recorded`).join(', '),
  )

  // And the other direction: a request marked approved must have actually paid.
  const approved = await prisma.refundRequest.findMany({
    where: { status: 'approved' },
    select: { orderRef: true, amount: true, order: { select: { refunded: true } } },
  })
  const unpaid = approved.filter((r) => !r.order.refunded)
  report(
    'every approved refund actually went back',
    unpaid.length === 0,
    unpaid.map((r) => `${r.orderRef} approved but the order says not refunded`).join(', '),
  )
}

/**
 * 5 — Paid payments are matched to something.
 *
 * A paid payment with no order and no top-up is money received against nothing —
 * the customer is owed either a bundle or a refund.
 */
async function paymentsAreAttributed() {
  const orphans = await prisma.payment.findMany({
    where: { status: 'paid', purpose: 'order', orderId: null },
    select: { reference: true, amount: true },
  })

  report(
    'every paid order-payment points at an order',
    orphans.length === 0,
    orphans.map((p) => `${p.reference} (${ghs(p.amount)})`).join(', '),
  )
}

/**
 * 6 — What the platform owes, against what it holds.
 *
 * Not an invariant — a solvency reading, and the number James most needs.
 * Agent balances and unclaimed refunds are liabilities: real money owed to other
 * people. If they exceed the Paystack balance, a payout run cannot be honoured.
 */
async function solvency() {
  const [
    agents,
    credits,
    fees,
    paid,
    pendingPayouts,
    heldOrders,
    pendingRefunds,
    manualRefundAdvances,
    manualRefundReimbursements,
    manualPayoutAdvances,
    manualPayoutReimbursements,
  ] = await Promise.all([
    prisma.user.aggregate({ where: { role: 'agent' }, _sum: { balance: true } }),
    prisma.claimableCredit.aggregate({ where: { claimed: false }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: 'paid' }, _sum: { fee: true } }),
    prisma.payment.aggregate({ where: { status: 'paid' }, _sum: { amount: true } }),
    // A withdrawal debits the agent's balance the moment it is requested (see
    // WithdrawalsService.request), so it has already left `owedToAgents` below
    // by the time it shows up here. It stays owed for as long as the actual
    // Paystack transfer hasn't landed — not just while `status` reads
    // `pending`. Once approved, `status` moves on, but the transfer can still
    // be stuck on `otp`, `unknown`, `manual`, or simply not attempted yet
    // (`transferStatus` null) for a real stretch of time — matching
    // `SolvencyService.position()`. The explicit `transferStatus: null` arm
    // is deliberate: `NOT: { transferStatus: 'success' }` alone silently
    // excludes null under SQL's three-valued logic — verified directly
    // against the database — which would undercount every withdrawal not yet
    // attempted.
    prisma.withdrawal.aggregate({
      where: {
        OR: [
          { status: 'pending' },
          {
            status: 'approved',
            OR: [{ transferStatus: null }, { transferStatus: { not: 'success' } }],
          },
        ],
      },
      _sum: { amount: true },
    }),
    // Paid for and not yet delivered — either a bundle or a refund is still
    // owed, either way it is not free to spend.
    prisma.order.aggregate({
      where: { status: { in: ['awaiting_approval', 'processing'] } },
      _sum: { salePrice: true },
    }),
    // Same "still owed until the transfer actually lands" reasoning as
    // withdrawals above, scoped to `method: 'transfer'` — a wallet or
    // claimable refund already moved the money at approval. Same explicit
    // null handling, for the same reason.
    prisma.refundRequest.aggregate({
      where: {
        OR: [
          { status: 'pending' },
          {
            status: 'approved',
            method: 'transfer',
            OR: [{ transferStatus: null }, { transferStatus: { not: 'success' } }],
          },
        ],
      },
      _sum: { amount: true },
    }),
    // A refund someone paid out of their own pocket because Paystack refused
    // the transfer — see RefundsService.settleManually and
    // FloatMonitorService.outstandingManualRefunds.
    prisma.ledgerEntry.findMany({
      where: { kind: 'capital_in', orderRef: { not: null } },
      select: { orderRef: true, amount: true },
    }),
    prisma.ledgerEntry.findMany({
      where: { kind: 'capital_out', orderRef: { not: null } },
      select: { orderRef: true },
    }),
    // The identical pattern, one column over — see WithdrawalsService.settleManually
    // and WithdrawalsService.outstandingManualAdvances. A payout settled this
    // way moves to `status: 'paid'` and so drops out of the "stuck payouts"
    // query above; what's still owed is to whoever personally covered it,
    // not to the agent (already paid) or the business (already booked the
    // cost at approval).
    prisma.ledgerEntry.findMany({
      where: { kind: 'capital_in', withdrawalId: { not: null } },
      select: { withdrawalId: true, amount: true },
    }),
    prisma.ledgerEntry.findMany({
      where: { kind: 'capital_out', withdrawalId: { not: null } },
      select: { withdrawalId: true },
    }),
  ])
  const customerWallets = await prisma.user.aggregate({
    where: { role: 'customer' },
    _sum: { balance: true },
  })

  const owedToAgents = agents._sum.balance ?? 0
  const owedToCustomers =
    (credits._sum.amount ?? 0) +
    (customerWallets._sum.balance ?? 0) +
    (pendingRefunds._sum.amount ?? 0)
  const undelivered = heldOrders._sum.salePrice ?? 0
  const collected = paid._sum.amount ?? 0
  const feesPaid = fees._sum.fee ?? 0
  const owedForPayouts = pendingPayouts._sum.amount ?? 0
  const reimbursedRefs = new Set(manualRefundReimbursements.map((r) => r.orderRef))
  const owedForManualRefunds = manualRefundAdvances
    .filter((advance) => !reimbursedRefs.has(advance.orderRef))
    .reduce((sum, advance) => sum + advance.amount, 0)
  const reimbursedWithdrawalIds = new Set(manualPayoutReimbursements.map((r) => r.withdrawalId))
  const owedForManualPayouts = manualPayoutAdvances
    .filter((advance) => !reimbursedWithdrawalIds.has(advance.withdrawalId))
    .reduce((sum, advance) => sum + advance.amount, 0)
  const totalOwed =
    owedToAgents +
    owedToCustomers +
    undelivered +
    owedForPayouts +
    owedForManualRefunds +
    owedForManualPayouts

  console.log('\n  Liabilities and inflows')
  console.log(`        collected through Paystack : ${ghs(collected)}`)
  console.log(`        Paystack kept in fees      : ${ghs(feesPaid)}` +
    (collected > 0 ? `  (${((feesPaid / collected) * 100).toFixed(2)}% of collections)` : ''))
  console.log(`        owed to agents             : ${ghs(owedToAgents)}`)
  console.log(`        owed to customers          : ${ghs(owedToCustomers)}`)
  console.log(`        paid for, not delivered    : ${ghs(undelivered)}`)
  console.log(`        payouts requested/stuck    : ${ghs(owedForPayouts)}`)
  console.log(`        owed for manual refunds    : ${ghs(owedForManualRefunds)}`)
  console.log(`        owed for manual payouts    : ${ghs(owedForManualPayouts)}`)
  console.log(`        total owed to other people : ${ghs(totalOwed)}`)

  if (totalOwed > 0) {
    notes.push(
      `${ghs(totalOwed)} is owed to agents, customers, and whoever fronted a manual refund. That ` +
        'money is not segregated — it sits in the same Paystack balance as float and profit, so ' +
        'spending the balance down can leave a payout unpayable.',
    )
  }
  if (feesPaid > 0 && collected > 0) {
    notes.push(
      `Paystack fees run at ${((feesPaid / collected) * 100).toFixed(2)}% of collections. Charged ` +
        'to the buyer as a checkout surcharge, not out of any margin here — see `checkoutTotal`.',
    )
  }
}

/**
 * 7 — Prices that cannot cover their own cost.
 *
 * Paystack's fee no longer comes out of this margin — it is charged to the
 * buyer as a separate checkout surcharge (`checkoutTotal`) and never touches
 * what a price has to clear. So the only real question left is the plain one:
 * does the price beat what the bundle actually costs.
 */
async function pricesCoverCost() {
  const products = await prisma.product.findMany({
    where: { active: true },
    select: { name: true, network: true, supplierCost: true, adminPrice: true, standardPrice: true },
  })

  const underwater = products.filter(
    (p) => p.standardPrice <= p.supplierCost || p.adminPrice <= p.supplierCost,
  )

  report(
    'every active price clears its supplier cost',
    underwater.length === 0,
    underwater
      .map(
        (p) =>
          `${p.network} ${p.name}: standard ${ghs(p.standardPrice)} / agent ${ghs(p.adminPrice)} vs cost ${ghs(p.supplierCost)}`,
      )
      .join(' | '),
  )
}

/**
 * 8 — The ledger agrees with the tables it was derived from.
 *
 * The ledger is the reporting surface, so a gap in it misstates profit while
 * every underlying record looks fine. This checks it against the sources rather
 * than trusting it: one revenue line per paid order, one supplier cost per
 * completed order (plus one per rejected order DataHub had already charged
 * before the rejection), one payout per withdrawal that's approved or paid.
 *
 * Deliberately checks for BOTH missing and duplicated lines. A missing one
 * understates; a duplicate overstates, which is worse, because nothing about the
 * number looks wrong.
 */
async function ledgerMatchesSources() {
  const [completedOrders, paidPayments, approvedOrPaidPayouts, rejectedWithCharge] = await Promise.all([
    prisma.order.count({ where: { status: 'completed' } }),
    prisma.payment.count({ where: { status: 'paid', purpose: 'order' } }),
    // Not `status: 'approved'` alone — a payout that's since confirmed `paid`
    // still carries its `payout` ledger line (booked once, at approval, and
    // never touched again unless the transfer later fails and is reversed,
    // which deletes it). Counting only `approved` undercounts the moment any
    // payout actually completes — dormant while nothing had reached `paid`,
    // real the moment one does. See `WithdrawalsService.decide`/`failPayout`.
    prisma.withdrawal.count({ where: { status: { in: ['approved', 'paid'] } } }),
    // `FulfilmentService.settle`'s rejected branch books a supplier_cost line
    // too, whenever DataHub had already accepted the purchase and deducted
    // the float before the final answer turned out to be a rejection — real
    // money spent on an order that did not complete. One line per *order*
    // (the ledger key is `order:<ref>:supplier_cost`, not per dispatch
    // attempt), so this counts orders, not SupplierDispatch rows.
    prisma.order.count({
      where: { status: 'failed', dispatches: { some: { providerCharged: { not: null } } } },
    }),
  ])

  const counts = await prisma.ledgerEntry.groupBy({
    by: ['kind'],
    _count: { _all: true },
  })
  const seen = new Map(counts.map((row) => [row.kind, row._count._all]))
  const got = (kind: string) => seen.get(kind as never) ?? 0

  // Revenue lines come from a paid Paystack order OR a completed wallet sale.
  const walletSales = await prisma.order.count({
    where: { status: 'completed', paidWith: 'wallet' },
  })

  report(
    'one supplier-cost line per completed (or rejected-but-charged) order',
    got('supplier_cost') === completedOrders + rejectedWithCharge,
    `${got('supplier_cost')} lines for ${completedOrders} completed + ${rejectedWithCharge} ` +
      'rejected-but-charged orders',
  )
  report(
    'revenue lines match paid orders and wallet sales',
    got('revenue') === paidPayments + walletSales,
    `${got('revenue')} revenue lines vs ${paidPayments + walletSales} paid sales — more means ` +
      'double-counting, fewer means a sale with no revenue booked (a wallet order settling ' +
      "without FulfilmentService.recordDelivered's wallet branch running is exactly this)",
  )
  report(
    'one payout line per approved-or-paid withdrawal',
    got('payout') === approvedOrPaidPayouts,
    `${got('payout')} lines for ${approvedOrPaidPayouts} approved/paid withdrawals`,
  )

  // Duplicate keys are impossible by index, but a wrongly *derived* key would let
  // two events collapse into one — the opposite failure, and invisible to the
  // unique constraint.
  const distinct = await prisma.ledgerEntry.findMany({ select: { idempotencyKey: true } })
  const unique = new Set(distinct.map((row) => row.idempotencyKey))
  report(
    'every ledger key is distinct',
    unique.size === distinct.length,
    `${distinct.length} rows, ${unique.size} distinct keys`,
  )
}

/**
 * 9 — What the business actually made.
 *
 * Not a check. The reason the rest of this file exists.
 */
async function profitAndLoss() {
  const rows = await prisma.ledgerEntry.groupBy({
    by: ['kind'],
    _sum: { amount: true },
  })
  const of = (kind: string) =>
    rows.find((row) => row.kind === (kind as never))?._sum.amount ?? 0

  const [profit, cash] = await Promise.all([
    prisma.ledgerEntry.aggregate({ where: { affectsProfit: true }, _sum: { amount: true } }),
    prisma.ledgerEntry.aggregate({ _sum: { amount: true } }),
  ])

  const revenue = of('revenue')
  console.log('\n  Profit and loss, all time')
  console.log(`        revenue                    : ${ghs(revenue)}`)
  console.log(`        bundle cost                : ${ghs(of('supplier_cost'))}`)
  console.log(`        payment fees               : ${ghs(of('payment_fee'))}`)
  console.log(`        agent margins              : ${ghs(of('agent_margin'))}`)
  console.log(`        referral bonuses           : ${ghs(of('referral_bonus'))}`)
  console.log(`        refunds                    : ${ghs(of('refund'))}`)
  console.log(`        agent margin write-offs    : ${ghs(of('agent_margin_writeoff'))}`)
  console.log(`        ────`)
  console.log(`        profit                     : ${ghs(profit._sum.amount ?? 0)}` +
    (revenue > 0 ? `  (${(((profit._sum.amount ?? 0) / revenue) * 100).toFixed(1)}% of revenue)` : ''))
  console.log('\n  Movements that are not profit or loss')
  console.log(`        wallet top-ups held        : ${ghs(of('topup'))}`)
  console.log(`        paid out to agents         : ${ghs(of('payout'))}`)
  console.log(`        net cash movement          : ${ghs(cash._sum.amount ?? 0)}`)

  if ((profit._sum.amount ?? 0) < 0) {
    notes.push(
      `The business is ${ghs(-(profit._sum.amount ?? 0))} down over all recorded trading. Check ` +
        'whether margins cover the bundle cost AND the payment fee.',
    )
  }
}

async function main() {
  console.log('\nMoney audit\n')
  console.log('  Invariants')
  await splitsBalance()
  await balancesMatchLedgers()
  await agentCreditsMatchOrders()
  await nothingDeliveredUnpaid()
  await failedOrdersAccountedFor()
  await paymentsAreAttributed()
  await pricesCoverCost()
  await ledgerMatchesSources()
  await solvency()
  await profitAndLoss()

  if (notes.length > 0) {
    console.log('\n  Worth knowing')
    for (const note of notes) console.log(`        · ${note}`)
  }

  console.log(
    `\n${failures.length === 0 ? 'The books balance.' : `${failures.length} discrepanc${failures.length === 1 ? 'y' : 'ies'} found.`}\n`,
  )
  if (failures.length > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
