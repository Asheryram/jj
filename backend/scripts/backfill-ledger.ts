/**
 * Write ledger entries for money that moved before the ledger existed.
 *
 * The ledger records events as they happen, which leaves everything that
 * happened earlier invisible to it — and a profit figure covering only the last
 * few days of trading is worse than none, because it looks complete.
 *
 * Safe to run repeatedly. Every entry is keyed by its event, so a second run
 * writes nothing; that is the same guarantee the live paths rely on, exercised
 * here against the whole history at once.
 *
 * Run with: npx tsx scripts/backfill-ledger.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { LedgerService, type LedgerDraft } from '../src/finance/ledger.service'
import type { OrderSplit } from '../src/domain/pricing'

const prisma = new PrismaClient()
const ledger = new LedgerService(prisma as never)

async function main() {
  const drafts: (LedgerDraft & { idempotencyKey: string })[] = []

  // ── Payments: revenue, fees, top-ups ───────────────────────────────────────
  const payments = await prisma.payment.findMany({
    where: { status: 'paid' },
    include: { order: { select: { reference: true, productName: true, status: true } } },
  })

  for (const payment of payments) {
    const when = payment.paidAt ?? payment.createdAt

    if (payment.fee != null) {
      drafts.push({
        idempotencyKey: LedgerService.key('payment', payment.reference, 'fee'),
        kind: 'payment_fee',
        amount: -payment.fee,
        description: `Paystack fee · ${payment.channel ?? 'unknown channel'}`,
        paymentRef: payment.reference,
        userId: payment.userId,
        occurredAt: when,
      })
    }

    if (payment.purpose === 'topup') {
      drafts.push({
        idempotencyKey: LedgerService.key('payment', payment.reference, 'topup'),
        kind: 'topup',
        amount: payment.amount,
        affectsProfit: false,
        description: 'Wallet top-up',
        paymentRef: payment.reference,
        userId: payment.userId,
        occurredAt: when,
      })
      continue
    }

    if (payment.order) {
      drafts.push({
        idempotencyKey: LedgerService.key('order', payment.order.reference, 'revenue'),
        kind: 'revenue',
        amount: payment.amount,
        description: `Sale · ${payment.order.productName}`,
        orderRef: payment.order.reference,
        paymentRef: payment.reference,
        userId: payment.userId,
        occurredAt: when,
      })
    }
  }

  // ── Wallet-paid orders: revenue was collected at top-up, so the sale itself
  //    is recognised when it completes. Without this, a wallet sale shows costs
  //    and no revenue.
  const walletSales = await prisma.order.findMany({
    where: { status: 'completed', paidWith: 'wallet' },
    select: { reference: true, productName: true, salePrice: true, completedAt: true, createdAt: true, buyerUserId: true },
  })
  for (const order of walletSales) {
    drafts.push({
      idempotencyKey: LedgerService.key('order', order.reference, 'revenue'),
      kind: 'revenue',
      amount: order.salePrice,
      description: `Sale · ${order.productName} (from wallet)`,
      orderRef: order.reference,
      userId: order.buyerUserId,
      occurredAt: order.completedAt ?? order.createdAt,
    })
  }

  // ── Completed orders: supplier cost and accrued margins ────────────────────
  const completed = await prisma.order.findMany({
    where: { status: 'completed' },
    select: {
      id: true,
      reference: true,
      productName: true,
      split: true,
      completedAt: true,
      createdAt: true,
    },
  })

  for (const order of completed) {
    const split = order.split as unknown as OrderSplit
    const when = order.completedAt ?? order.createdAt

    const dispatch = await prisma.supplierDispatch.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' },
      select: { providerCharged: true, costPrice: true },
    })
    const actualCost = dispatch?.providerCharged ?? dispatch?.costPrice ?? split.supplierCost

    drafts.push({
      idempotencyKey: LedgerService.key('order', order.reference, 'supplier_cost'),
      kind: 'supplier_cost',
      amount: -actualCost,
      description: `Bundle cost · ${order.productName}`,
      orderRef: order.reference,
      occurredAt: when,
    })

    for (const share of split.shares.filter((s) => s.role === 'agent' && s.margin > 0)) {
      drafts.push({
        idempotencyKey: LedgerService.key(
          'order',
          order.reference,
          share.depth === 0 ? 'agent_margin' : 'referral_bonus',
          share.userId,
        ),
        kind: share.depth === 0 ? 'agent_margin' : 'referral_bonus',
        amount: -share.margin,
        description:
          share.depth === 0 ? `Agent margin · ${share.name}` : `Referral bonus · ${share.name}`,
        orderRef: order.reference,
        userId: share.userId,
        occurredAt: when,
      })
    }
  }

  // ── Refunds ────────────────────────────────────────────────────────────────
  //
  // Only where money was actually collected. A Mobile Money order that failed
  // before the customer paid has nothing to give back, and booking a refund for
  // it invents a loss the size of the sale — which is exactly what the first run
  // of this script did, showing GHS 196 of refunds against GHS 5 of revenue.
  const refunded = await prisma.order.findMany({
    where: {
      status: 'failed',
      refunded: true,
      OR: [{ paidWith: 'wallet' }, { payment: { status: 'paid' } }],
    },
    select: { reference: true, productName: true, salePrice: true, createdAt: true, buyerUserId: true },
  })
  for (const order of refunded) {
    drafts.push({
      idempotencyKey: LedgerService.key('order', order.reference, 'refund'),
      kind: 'refund',
      amount: -order.salePrice,
      description: `Refund · ${order.productName}`,
      orderRef: order.reference,
      userId: order.buyerUserId,
      occurredAt: order.createdAt,
    })
  }

  // ── Payouts already approved ───────────────────────────────────────────────
  const payouts = await prisma.withdrawal.findMany({
    where: { status: 'approved' },
    select: { id: true, amount: true, agentName: true, agentPhone: true, userId: true, decidedAt: true, requestedAt: true },
  })
  for (const payout of payouts) {
    drafts.push({
      idempotencyKey: LedgerService.key('withdrawal', payout.id, 'payout'),
      kind: 'payout',
      amount: -payout.amount,
      affectsProfit: false,
      description: `Paid out to ${payout.agentName} · ${payout.agentPhone}`,
      withdrawalId: payout.id,
      userId: payout.userId,
      occurredAt: payout.decidedAt ?? payout.requestedAt,
    })
  }

  const written = await ledger.record(drafts)
  console.log(`${drafts.length} event(s) considered, ${written} newly recorded.`)
  if (written < drafts.length) {
    console.log(`${drafts.length - written} were already on the books — that is the idempotency working.`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
