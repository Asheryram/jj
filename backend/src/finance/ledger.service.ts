import { Injectable, Logger } from '@nestjs/common'
import type { LedgerKind, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

/** One money movement, described by the event that caused it. */
export interface LedgerDraft {
  kind: LedgerKind
  /** Signed pesewas from the business's point of view. Positive is money in. */
  amount: number
  description: string
  occurredAt: Date
  /**
   * False for movements that settle an existing obligation or hold somebody
   * else's money. See LedgerEntry.affectsProfit.
   */
  affectsProfit?: boolean
  orderRef?: string | null
  paymentRef?: string | null
  withdrawalId?: string | null
  userId?: string | null
}

/**
 * The one place money movements are recorded.
 *
 * Writing here is idempotent and that is the whole design: the key is derived
 * from the event, so `order:JDC-1:supplier_cost` can be written a hundred times
 * and exist once. That matters because every path that settles money in this
 * system can legitimately run twice — Paystack retries webhooks, the reconciler
 * re-checks orders it has already seen, a customer refreshes the return page, and
 * an approval release re-dispatches. Without idempotency each of those would
 * inflate the accounts, and an inflated account is worse than a missing one
 * because it looks plausible.
 *
 * Recording is deliberately non-fatal. A ledger entry is a record of something
 * that already happened elsewhere — the customer has been charged, the bundle has
 * been sent — so a failure to write the note must never roll back the event it
 * describes. It is logged loudly instead, and `money-audit.ts` cross-checks the
 * ledger against the source tables to catch anything that went missing.
 */
@Injectable()
export class LedgerService {
  private readonly log = new Logger(LedgerService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the key for an event. Same event, same key, for ever.
   *
   * Never include a timestamp or a random value: that is what turns an idempotent
   * write into a duplicate one.
   */
  static key(source: string, reference: string, kind: string, suffix?: string): string {
    return [source, reference, kind, suffix].filter(Boolean).join(':')
  }

  /**
   * Record entries, skipping any already written.
   *
   * `skipDuplicates` does the work — the unique index on `idempotencyKey` is the
   * guarantee, not a prior read. Checking first and then writing would leave a
   * race between two concurrent settlements of the same order.
   */
  async record(
    entries: (LedgerDraft & { idempotencyKey: string })[],
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    if (entries.length === 0) return 0

    const client = tx ?? this.prisma
    try {
      const result = await client.ledgerEntry.createMany({
        data: entries.map((entry) => ({
          idempotencyKey: entry.idempotencyKey,
          kind: entry.kind,
          amount: entry.amount,
          affectsProfit: entry.affectsProfit ?? true,
          description: entry.description,
          orderRef: entry.orderRef ?? null,
          paymentRef: entry.paymentRef ?? null,
          withdrawalId: entry.withdrawalId ?? null,
          userId: entry.userId ?? null,
          occurredAt: entry.occurredAt,
        })),
        skipDuplicates: true,
      })
      return result.count
    } catch (error) {
      // Loud, and swallowed. The money already moved; losing the note about it
      // must not undo it.
      this.log.error(
        `failed to record ${entries.length} ledger entr(ies) ` +
          `[${entries.map((e) => e.idempotencyKey).join(', ')}]: ${String(error)}`,
      )
      return 0
    }
  }

  /**
   * Profit and loss over a window, and the cash that moved alongside it.
   *
   * Two totals from one table, because they answer different questions: profit is
   * what the business earned, cash is what actually arrived and left. They differ
   * by exactly the movements that settle obligations — agent payouts, wallet
   * top-ups — which is why `affectsProfit` exists.
   */
  async statement(since: Date) {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['kind'],
      where: { occurredAt: { gte: since } },
      _sum: { amount: true },
      _count: { _all: true },
    })

    const byKind = new Map(rows.map((row) => [row.kind, row._sum.amount ?? 0]))
    const countOf = new Map(rows.map((row) => [row.kind, row._count._all]))
    const of = (kind: LedgerKind) => byKind.get(kind) ?? 0

    const [profitAgg, cashAgg] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({
        where: { occurredAt: { gte: since }, affectsProfit: true },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { occurredAt: { gte: since } },
        _sum: { amount: true },
      }),
    ])

    const revenue = of('revenue')

    return {
      since: since.toISOString(),
      revenue,
      /** Every cost, as a positive number each, so the statement reads plainly. */
      costs: {
        supplier: -of('supplier_cost'),
        paymentFees: -of('payment_fee'),
        agentMargins: -of('agent_margin'),
        referralBonuses: -of('referral_bonus'),
        refunds: -of('refund'),
        payoutFees: -of('payout_fee'),
        agentMarginWriteoffs: -of('agent_margin_writeoff'),
      },
      /** Revenue less every cost above. What the business earned. */
      profit: profitAgg._sum.amount ?? 0,
      /** Everything that moved, including money that was never ours. */
      cashMovement: cashAgg._sum.amount ?? 0,
      /** Settles liabilities rather than earning or spending. */
      settlements: {
        payouts: -of('payout'),
        walletTopUps: of('topup'),
      },
      /** Profit as a share of revenue. Null rather than zero when nothing sold. */
      marginRate: revenue > 0 ? (profitAgg._sum.amount ?? 0) / revenue : null,
      entryCounts: Object.fromEntries(countOf),
    }
  }

  /** The statement lines themselves, newest first, for an admin to read. */
  async entries(limit = 200) {
    const rows = await this.prisma.ledgerEntry.findMany({
      orderBy: { occurredAt: 'desc' },
      take: limit,
    })

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: row.amount,
      affectsProfit: row.affectsProfit,
      description: row.description,
      orderRef: row.orderRef,
      occurredAt: row.occurredAt.toISOString(),
    }))
  }
}
