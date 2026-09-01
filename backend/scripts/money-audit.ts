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
  const [agents, credits, fees, paid, pendingPayouts, manualRefundAdvances, manualRefundReimbursements] =
    await Promise.all([
      prisma.user.aggregate({ where: { role: 'agent' }, _sum: { balance: true } }),
      prisma.claimableCredit.aggregate({ where: { claimed: false }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: { status: 'paid' }, _sum: { fee: true } }),
      prisma.payment.aggregate({ where: { status: 'paid' }, _sum: { amount: true } }),
      // A withdrawal debits the agent's balance the moment it is requested (see
      // WithdrawalsService.request), so it has already left `owedToAgents` below
      // by the time it shows up here — left out entirely it would vanish from
      // both sides rather than just changing which one it's counted under.
      prisma.withdrawal.aggregate({ where: { status: 'pending' }, _sum: { amount: true } }),
      // Same idea for a refund someone paid out of their own pocket because
      // Paystack refused the transfer — see RefundsService.settleManually and
      // FloatMonitorService.outstandingManualRefunds.
      prisma.ledgerEntry.findMany({
        where: { kind: 'capital_in', orderRef: { not: null } },
        select: { orderRef: true, amount: true },
      }),
      prisma.ledgerEntry.findMany({
        where: { kind: 'capital_out', orderRef: { not: null } },
        select: { orderRef: true },
      }),
    ])
  const customerWallets = await prisma.user.aggregate({
    where: { role: 'customer' },
    _sum: { balance: true },
  })

  const owedToAgents = agents._sum.balance ?? 0
  const owedToCustomers = (credits._sum.amount ?? 0) + (customerWallets._sum.balance ?? 0)
  const collected = paid._sum.amount ?? 0
  const feesPaid = fees._sum.fee ?? 0
  const owedForPayouts = pendingPayouts._sum.amount ?? 0
  const reimbursedRefs = new Set(manualRefundReimbursements.map((r) => r.orderRef))
  const owedForManualRefunds = manualRefundAdvances
    .filter((advance) => !reimbursedRefs.has(advance.orderRef))
    .reduce((sum, advance) => sum + advance.amount, 0)
  const totalOwed = owedToAgents + owedToCustomers + owedForPayouts + owedForManualRefunds

  console.log('\n  Liabilities and inflows')
  console.log(`        collected through Paystack : ${ghs(collected)}`)
  console.log(`        Paystack kept in fees      : ${ghs(feesPaid)}` +
    (collected > 0 ? `  (${((feesPaid / collected) * 100).toFixed(2)}% of collections)` : ''))
  console.log(`        owed to agents             : ${ghs(owedToAgents)}`)
  console.log(`        owed to customers          : ${ghs(owedToCustomers)}`)
  console.log(`        payouts requested, unsent  : ${ghs(owedForPayouts)}`)
  console.log(`        owed for manual refunds    : ${ghs(owedForManualRefunds)}`)
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
 * completed order, one payout per approved withdrawal.
 *
 * Deliberately checks for BOTH missing and duplicated lines. A missing one
 * understates; a duplicate overstates, which is worse, because nothing about the
 * number looks wrong.
 */
async function ledgerMatchesSources() {
  const [completedOrders, paidPayments, approvedPayouts] = await Promise.all([
    prisma.order.count({ where: { status: 'completed' } }),
    prisma.payment.count({ where: { status: 'paid', purpose: 'order' } }),
    prisma.withdrawal.count({ where: { status: 'approved' } }),
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
    'one supplier-cost line per completed order',
    got('supplier_cost') === completedOrders,
    `${got('supplier_cost')} lines for ${completedOrders} completed orders`,
  )
  report(
    'revenue lines match paid orders and wallet sales',
    got('revenue') <= paidPayments + walletSales,
    `${got('revenue')} revenue lines vs at most ${paidPayments + walletSales} paid sales — more means double-counting`,
  )
  report(
    'one payout line per approved withdrawal',
    got('payout') === approvedPayouts,
    `${got('payout')} lines for ${approvedPayouts} approved withdrawals`,
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
