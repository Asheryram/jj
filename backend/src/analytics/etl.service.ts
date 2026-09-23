import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import type { Prisma } from '@prisma-analytics/client'
import { PrismaService } from '../prisma/prisma.service'
import { mapProviderStatus } from '../supplier/datahub.client'
import { FloatMonitorService } from '../supplier/float-monitor.service'
import { SolvencyService } from '../finance/solvency.service'
import { AnalyticsPrismaService } from './analytics-prisma.service'
import { addDays, dayBounds, toDateInt } from './date'

interface SplitShare {
  userId: string
  name: string
  role: 'admin' | 'agent'
  depth: number
  margin: number
}

interface OrderSplit {
  supplierCost: number
  shares: SplitShare[]
  processingFee: number
}

function asSplit(value: unknown): OrderSplit {
  const v = (value ?? {}) as Partial<OrderSplit>
  return {
    supplierCost: v.supplierCost ?? 0,
    shares: Array.isArray(v.shares) ? v.shares : [],
    processingFee: v.processingFee ?? 0,
  }
}

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0
}

/**
 * Buckets a set of turnaround-hours values into the same four bands
 * everywhere they're used (payouts, refunds, applications, lost-revenue
 * resolutions): a mean alone hides a slow outlier inside a fine-looking
 * number, this exposes the actual shape it came from.
 */
function bucketHours(values: number[]): { under1h: number; from1to4h: number; from4to24h: number; over24h: number } {
  const buckets = { under1h: 0, from1to4h: 0, from4to24h: 0, over24h: 0 }
  for (const hours of values) {
    if (hours < 1) buckets.under1h++
    else if (hours < 4) buckets.from1to4h++
    else if (hours < 24) buckets.from4to24h++
    else buckets.over24h++
  }
  return buckets
}

/** Orders past this status are paid for, regardless of what happens to them after. */
const PAID_STATUSES = ['pending', 'processing', 'awaiting_approval', 'completed', 'failed'] as const

/**
 * `null` means genuinely still in flight, neither a reply nor a timeout yet,
 * which counts toward `totalAttempts` in Gold but no bucket beneath it.
 *
 * Reads `providerStatus`, not `outcome`. `outcome` is written once at
 * dispatch time and never touched again, for a live async purchase that is
 * almost always `'pending'` forever, the real answer, when it comes, lands
 * later as `providerStatus` via `ReconcilerService`'s own `updateMany`
 * targeting this exact row. `outcome` is still the right field for the
 * genuinely-no-reply and simulated-immediate cases, where there is no later
 * update to wait for at all. Mirrors `ReconcilerService.alertStuckOrders`'s
 * own "no reply whatsoever" condition exactly for the `noReply` bucket.
 */
function resolveDispatchOutcome(d: {
  outcome: string
  providerReference: string | null
  providerStatus: string | null
}): 'successful' | 'noReply' | 'manualQueue' | 'otherFailed' | null {
  const mapped = mapProviderStatus(d.providerStatus ?? '')
  if (d.providerReference?.startsWith('manual_')) return 'manualQueue'
  if (d.outcome === 'delivered' || mapped === 'completed') return 'successful'
  if (d.outcome === 'unknown' && !d.providerReference) return 'noReply'
  if (d.outcome === 'rejected' || mapped === 'failed') return 'otherFailed'
  return null
}

/**
 * Bronze -> Silver -> Gold, medallion-style, on a schedule, and exposes
 * `runNow()` for a manual trigger.
 *
 * Bronze is a near-verbatim copy of the production rows for one day, Silver
 * resolves every business rule exactly once from Bronze (what counts as
 * "paid", what a dispatch's real outcome was, which agent a code belongs
 * to), and Gold is pure `GROUP BY` over Silver, what `/analytics` actually
 * queries. Nothing past Bronze ever touches the production database, see
 * that layer's own comment in the schema for why that matters.
 *
 * Checkpointed: a day already in the past is run through all three layers
 * exactly once and never touched again (`EtlCheckpoint.lastFinalizedDate`
 * records the newest one), only "today" (always incomplete, still gaining
 * orders) is recomputed every run. Three domains here don't fit that model
 * cleanly, each documented on its own methods below:
 *
 * - The agent dimension (`BronzeUser`/`SilverAgentDim`/`SilverApplicationFact`,
 *   and by extension `computeAgentHealth`/`computeDownlineDepth`) reflects the
 *   User table's *current* state, refreshed once per run rather than once per
 *   day, this schema keeps no status-change history to rebuild a past day from.
 * - Payouts and feedback are keyed by the day they were requested or
 *   submitted, so one that resolves after its own day is already checkpointed will not
 *   retroactively update that day, the same trade-off dispatch resolution
 *   already makes. Both normally resolve in hours, not days.
 * - Solvency and float are daily *snapshots* of a live computation, not an
 *   event stream, they cannot be backfilled at all: a past day with no row is
 *   an honest gap, not a bug, the trend only starts from when this was added.
 */
@Injectable()
export class EtlService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(EtlService.name)
  private timer: NodeJS.Timeout | null = null

  /**
   * 2am, UTC, which is also Ghana local time year-round (see `date.ts`).
   * Not payment-critical and not needed intraday, once a day is enough to
   * keep the trend current without polling the production database on a
   * schedule that has nothing to do with when anyone actually looks at it.
   */
  private readonly dailyRunHourUtc = 2

  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouse: AnalyticsPrismaService,
    private readonly solvency: SolvencyService,
    private readonly floatMonitor: FloatMonitorService,
  ) {}

  private msUntilNextDailyRun(): number {
    const now = new Date()
    const next = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), this.dailyRunHourUtc, 0, 0, 0),
    )
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
    return next.getTime() - now.getTime()
  }

  onApplicationBootstrap(): void {
    // `AnalyticsPrismaService` already logged why, nothing more to say here.
    // Checked once at boot, not on every tick: Render restarts the process on
    // any env var change, so "unavailable now" only ever changes via a restart.
    if (!this.warehouse.isAvailable) return

    // A self-rescheduling `setTimeout`, not `setInterval`: the delay to the
    // *next* 2am changes every time (23 vs 25 hours away depending on when
    // this last fired), a fixed-period interval can't land on a wall-clock
    // time at all, only a fixed distance from whenever it happened to start.
    const scheduleNext = () => {
      this.timer = setTimeout(() => {
        void this.runNow().catch((error) => this.log.error(`ETL run failed: ${String(error)}`))
        scheduleNext()
      }, this.msUntilNextDailyRun())
      this.timer.unref?.()
    }
    scheduleNext()

    // Also run once at boot, rather than waiting until 2am for the first data to appear.
    void this.runNow().catch((error) => this.log.error(`ETL run failed: ${String(error)}`))
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer)
  }

  /** One pass. Public so it can be triggered by hand from an admin route or a test. */
  async runNow(): Promise<{ daysProcessed: number }> {
    if (!this.warehouse.isAvailable) {
      this.log.warn('ETL run skipped, the analytics warehouse is not available.')
      return { daysProcessed: 0 }
    }

    const checkpoint = await this.warehouse.etlCheckpoint.findUnique({ where: { id: 1 } })
    const today = toDateInt(new Date())

    let startDate = checkpoint?.lastFinalizedDate ? addDays(checkpoint.lastFinalizedDate, 1) : null
    if (startDate === null) {
      // The earlier of the two: agents are commonly recruited before the
      // first sale, and `DailyApplicationFunnel` needs to reach that day too,
      // not just whichever came first between orders and signups.
      const [earliestOrder, earliestAgent] = await Promise.all([
        this.prisma.order.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        this.prisma.user.findFirst({ where: { role: 'agent' }, orderBy: { joinedAt: 'asc' }, select: { joinedAt: true } }),
      ])
      const candidates = [earliestOrder?.createdAt, earliestAgent?.joinedAt].filter((d): d is Date => Boolean(d))
      startDate = candidates.length > 0 ? Math.min(...candidates.map(toDateInt)) : today
    }

    const dates: number[] = []
    for (let d = startDate; d <= today; d = addDays(d, 1)) dates.push(d)

    // The agent dimension, applications, solvency and float all reflect
    // current state, not a per-day event stream, so each is refreshed once
    // per run rather than once per historical day, see this class's own doc
    // comment for the consequence of that.
    await this.ingestBronzeUsers(today)
    await this.refreshSilverAgentDim()
    await this.refreshSilverApplications()
    await this.ingestBronzeBeneficiaryRequests(today)
    await this.refreshSilverBeneficiaryFacts()
    await this.computeLiveSnapshots(today)

    for (const dateInt of dates) {
      await this.computeDay(dateInt)
      if (dateInt < today) {
        await this.warehouse.etlCheckpoint.upsert({
          where: { id: 1 },
          create: { id: 1, lastFinalizedDate: dateInt },
          update: { lastFinalizedDate: dateInt },
        })
        await this.pruneRawHistory(dateInt)
      }
    }

    this.log.log(`ETL: computed ${dates.length} day(s) up to ${today}`)
    return { daysProcessed: dates.length }
  }

  /**
   * The manual escape hatch for "I fixed a bug in the ETL, recompute
   * everything from March 1st" without wiping the whole warehouse and doing
   * a full cold-start backfill. Rewinds the checkpoint to just before
   * `fromDateInt`, then runs immediately: every day from `fromDateInt`
   * through today gets recomputed on this same run. Safe to replay a day
   * that was already finalized, every Bronze/Silver/Gold write in
   * `computeDay` is an upsert keyed by date, so it overwrites that day with
   * the current logic's answer rather than duplicating rows. The caller
   * (the controller) is responsible for validating `fromDateInt` is a real,
   * not-in-the-future date; this trusts it the same way `computeDay` does.
   */
  async recomputeFrom(fromDateInt: number): Promise<{ daysProcessed: number }> {
    const dayBefore = addDays(fromDateInt, -1)
    await this.warehouse.etlCheckpoint.upsert({
      where: { id: 1 },
      create: { id: 1, lastFinalizedDate: dayBefore },
      update: { lastFinalizedDate: dayBefore },
    })
    return this.runNow()
  }

  /**
   * One-time cleanup for history that finalized before this pruning existed:
   * everything `runNow()`'s own per-day prune would already have removed had
   * it been running from the start. Safe to call any time, including with
   * nothing left to prune, an empty `deleteMany` is a cheap no-op.
   */
  async pruneHistory(): Promise<{ prunedThrough: number | null }> {
    const checkpoint = await this.warehouse.etlCheckpoint.findUnique({ where: { id: 1 } })
    if (!checkpoint?.lastFinalizedDate) return { prunedThrough: null }
    await this.pruneRawHistory(checkpoint.lastFinalizedDate)
    return { prunedThrough: checkpoint.lastFinalizedDate }
  }

  /**
   * Deletes every Bronze/Silver row at or before `uptoDateInt`, except
   * `BronzeOrder` and `SilverOrderFact`, which are kept forever on purpose:
   * `conformSilverRefunds`/`conformSilverLedgerFacts` look `BronzeOrder` up
   * by id/reference regardless of how much later a refund or a delayed
   * ledger entry lands, and `computeAgentHealth`/`computeCustomerBehavior`
   * both read `SilverOrderFact`'s full history (`dateKey: { lte }`), not just
   * the day being computed, to answer "has this agent ever sold" and "has
   * this buyer ordered before." Everything else here is read only scoped to
   * its own day everywhere in this file, so once that day's Gold rollup
   * exists (this only ever runs after `computeDay` for `uptoDateInt` has
   * already finished), the raw row has nothing left to serve.
   */
  private async pruneRawHistory(uptoDateInt: number): Promise<void> {
    const where = { dateKey: { lte: uptoDateInt } }
    const results = await Promise.all([
      this.warehouse.bronzeSupplierDispatch.deleteMany({ where }),
      this.warehouse.bronzeRefund.deleteMany({ where }),
      this.warehouse.bronzeWithdrawal.deleteMany({ where }),
      this.warehouse.bronzeFeedback.deleteMany({ where }),
      this.warehouse.bronzeLedgerEntry.deleteMany({ where }),
      this.warehouse.silverDispatchFact.deleteMany({ where }),
      this.warehouse.silverRefundFact.deleteMany({ where }),
      this.warehouse.silverWithdrawalFact.deleteMany({ where }),
      this.warehouse.silverFeedbackFact.deleteMany({ where }),
      this.warehouse.silverLedgerFact.deleteMany({ where }),
    ])
    const total = results.reduce((sum, r) => sum + r.count, 0)
    if (total > 0) this.log.log(`ETL: pruned ${total} finalized Bronze/Silver row(s) through ${uptoDateInt}`)
  }

  private async computeDay(dateInt: number): Promise<void> {
    const { start, end } = dayBounds(dateInt)

    // Bronze: raw copy from production, scoped to this one day.
    await this.ingestBronzeOrders(dateInt, start, end)
    await this.ingestBronzeDispatches(dateInt, start, end)
    await this.ingestBronzeRefunds(dateInt, start, end)
    await this.ingestBronzeWithdrawals(dateInt, start, end)
    await this.ingestBronzeFeedback(dateInt, start, end)
    await this.ingestBronzeLedgerEntries(dateInt, start, end)

    // Silver: every business rule resolved exactly once, from Bronze.
    await this.conformSilverOrders(dateInt)
    await this.conformSilverDispatches(dateInt)
    await this.conformSilverRefunds(dateInt)
    await this.conformSilverWithdrawals(dateInt)
    await this.conformSilverFeedback(dateInt)
    await this.conformSilverLedgerFacts(dateInt)

    // Gold: pure aggregation over Silver, what the dashboard actually reads.
    await this.computeDailySummary(dateInt)
    await this.computeNetworkSummary(dateInt)
    await this.computeCategorySummary(dateInt)
    await this.computeProductSummary(dateInt)
    await this.computeDispatchReliability(dateInt)
    await this.computeAgentSummary(dateInt)
    await this.computeAgentHealth(dateInt, end)
    await this.computeDownlineDepth(dateInt)
    await this.computeHourlyVolume(dateInt)
    await this.computeCheckoutFunnel(dateInt)
    await this.computeCustomerBehavior(dateInt)
    await this.computeMarginAccuracy(dateInt)
    await this.computeRefundSummary(dateInt)
    await this.computeRefundNetworkSummary(dateInt)
    await this.computeRefundReasonSummary(dateInt)
    await this.computeDailyPayoutSummary(dateInt)
    await this.computeDailyFeedbackSummary(dateInt)
    await this.computeDailyApplicationFunnel(dateInt)
    await this.computeLostRevenueSummary(dateInt)
  }

  // ─── Bronze ─────────────────────────────────────────────────────────────

  private async ingestBronzeOrders(dateInt: number, start: Date, end: Date): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: {
        id: true,
        reference: true,
        status: true,
        network: true,
        category: true,
        productId: true,
        productName: true,
        salePrice: true,
        split: true,
        soldByCode: true,
        soldByAgentName: true,
        buyerPhone: true,
        createdAt: true,
      },
    })
    for (const o of orders) {
      await this.warehouse.bronzeOrder.upsert({
        where: { id: o.id },
        create: {
          id: o.id,
          dateKey: dateInt,
          reference: o.reference,
          status: o.status,
          network: o.network,
          category: o.category,
          productId: o.productId,
          productName: o.productName,
          salePrice: o.salePrice,
          split: o.split as Prisma.InputJsonValue,
          soldByCode: o.soldByCode,
          soldByAgentName: o.soldByAgentName,
          buyerPhone: o.buyerPhone,
          createdAt: o.createdAt,
        },
        // A status change (pending -> completed) is the one thing that
        // legitimately mutates an already-ingested row on a re-run of
        // "today". `productId`/`productName` are also written here even
        // though they never change after creation: production's own
        // `Order.productName` is itself frozen at sale time (never rewritten
        // by a later rename/delete), so re-copying it here is harmless, and
        // it's what lets `recomputeFrom` backfill this field into Bronze
        // rows that were ingested before it existed, not just brand-new ones.
        update: {
          status: o.status,
          network: o.network,
          productId: o.productId,
          productName: o.productName,
          split: o.split as Prisma.InputJsonValue,
          soldByAgentName: o.soldByAgentName,
        },
      })
    }
  }

  private async ingestBronzeDispatches(dateInt: number, start: Date, end: Date): Promise<void> {
    const dispatches = await this.prisma.supplierDispatch.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: {
        id: true,
        orderId: true,
        outcome: true,
        providerReference: true,
        providerStatus: true,
        createdAt: true,
        order: { select: { network: true } },
      },
    })
    for (const d of dispatches) {
      await this.warehouse.bronzeSupplierDispatch.upsert({
        where: { id: d.id },
        create: {
          id: d.id,
          dateKey: dateInt,
          orderId: d.orderId,
          network: d.order.network,
          outcome: d.outcome,
          providerReference: d.providerReference,
          providerStatus: d.providerStatus,
          createdAt: d.createdAt,
        },
        // `providerStatus`/`providerReference` are the two fields the
        // reconciler updates in place later, everything else is frozen.
        update: { outcome: d.outcome, providerReference: d.providerReference, providerStatus: d.providerStatus },
      })
    }
  }

  private async ingestBronzeRefunds(dateInt: number, start: Date, end: Date): Promise<void> {
    const refunds = await this.prisma.refundRequest.findMany({
      where: { status: 'approved', decidedAt: { gte: start, lt: end } },
      select: { id: true, orderId: true, amount: true, method: true, momoNetwork: true, reason: true, createdAt: true, decidedAt: true },
    })
    for (const r of refunds) {
      await this.warehouse.bronzeRefund.upsert({
        where: { id: r.id },
        create: {
          id: r.id,
          dateKey: dateInt,
          orderId: r.orderId,
          amount: r.amount,
          method: r.method,
          momoNetwork: r.momoNetwork,
          reason: r.reason,
          createdAt: r.createdAt,
          decidedAt: r.decidedAt as Date,
        },
        update: { amount: r.amount },
      })
    }
  }

  /**
   * Keyed by `requestedAt`'s day, see this class's own doc comment for why a
   * payout that gets paid well after that day is checkpointed won't
   * retroactively update it.
   */
  private async ingestBronzeWithdrawals(dateInt: number, start: Date, end: Date): Promise<void> {
    const withdrawals = await this.prisma.withdrawal.findMany({
      where: { requestedAt: { gte: start, lt: end } },
      select: { id: true, userId: true, agentName: true, amount: true, momoNetwork: true, status: true, requestedAt: true, decidedAt: true, paidAt: true },
    })
    for (const w of withdrawals) {
      await this.warehouse.bronzeWithdrawal.upsert({
        where: { id: w.id },
        create: {
          id: w.id,
          dateKey: dateInt,
          userId: w.userId,
          agentName: w.agentName,
          amount: w.amount,
          momoNetwork: w.momoNetwork,
          status: w.status,
          requestedAt: w.requestedAt,
          decidedAt: w.decidedAt,
          paidAt: w.paidAt,
        },
        // `status`/`decidedAt`/`paidAt` are what the approval and payout flow
        // updates in place later, everything else is frozen at request time.
        update: { status: w.status, decidedAt: w.decidedAt, paidAt: w.paidAt },
      })
    }
  }

  /** Keyed by `createdAt`'s day, the same accepted late-resolution trade-off as payouts. */
  private async ingestBronzeFeedback(dateInt: number, start: Date, end: Date): Promise<void> {
    const reports = await this.prisma.feedbackReport.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { id: true, userId: true, category: true, status: true, escalated: true, createdAt: true, decidedAt: true },
    })
    for (const f of reports) {
      await this.warehouse.bronzeFeedback.upsert({
        where: { id: f.id },
        create: {
          id: f.id,
          dateKey: dateInt,
          userId: f.userId,
          category: f.category,
          status: f.status,
          escalated: f.escalated,
          createdAt: f.createdAt,
          decidedAt: f.decidedAt,
        },
        update: { status: f.status, escalated: f.escalated, decidedAt: f.decidedAt },
      })
    }
  }

  /**
   * `LedgerEntry` is the production schema's own single source of truth for
   * money (see `BronzeLedgerEntry`'s own comment), keyed by `occurredAt`,
   * not the order's `createdAt`: a wallet order's revenue is booked at
   * delivery, a MoMo order's at payment, and bucketing by anything else
   * would put money on a different day than it actually moved.
   */
  private async ingestBronzeLedgerEntries(dateInt: number, start: Date, end: Date): Promise<void> {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { occurredAt: { gte: start, lt: end } },
      select: { id: true, kind: true, amount: true, affectsProfit: true, orderRef: true, withdrawalId: true, userId: true, occurredAt: true },
    })
    for (const e of entries) {
      // Ledger rows are never edited once written (`LedgerService.record` is
      // create-only, idempotency-keyed), so there is nothing to refresh on a
      // re-run of "today", only new rows to add.
      await this.warehouse.bronzeLedgerEntry.upsert({
        where: { id: e.id },
        create: {
          id: e.id,
          dateKey: dateInt,
          kind: e.kind,
          amount: e.amount,
          affectsProfit: e.affectsProfit,
          orderRef: e.orderRef,
          withdrawalId: e.withdrawalId,
          userId: e.userId,
          occurredAt: e.occurredAt,
        },
        update: {},
      })
    }
  }

  /**
   * One snapshot per run, keyed to `today`, the same reasoning as
   * `ingestBronzeUsers`: the source keeps only the current state per phone,
   * not a history of every attempt.
   */
  private async ingestBronzeBeneficiaryRequests(today: number): Promise<void> {
    const rows = await this.prisma.beneficiaryRequest.findMany({
      select: { phone: true, networkKey: true, attempts: true, lastProduct: true, lastValue: true, firstSeenAt: true, approvedAt: true },
    })
    for (const r of rows) {
      await this.warehouse.bronzeBeneficiaryRequest.upsert({
        where: { phone: r.phone },
        create: {
          phone: r.phone,
          snapshotDateKey: today,
          networkKey: r.networkKey,
          attempts: r.attempts,
          lastProduct: r.lastProduct,
          lastValue: r.lastValue,
          firstSeenAt: r.firstSeenAt,
          approvedAt: r.approvedAt,
        },
        update: {
          snapshotDateKey: today,
          attempts: r.attempts,
          lastProduct: r.lastProduct,
          lastValue: r.lastValue,
          approvedAt: r.approvedAt,
        },
      })
    }
  }

  /**
   * Every user with a referral code, not only `role: 'agent'`: an admin
   * account can and does sell directly on its own code (see
   * `SilverAgentDim`'s own comment), and this table has to resolve both.
   * One snapshot per run, keyed to `today`, not one per historical day, see
   * `BronzeUser`'s own schema comment for why.
   */
  private async ingestBronzeUsers(today: number): Promise<void> {
    const users = await this.prisma.user.findMany({
      select: { id: true, role: true, status: true, referralCode: true, uplineCode: true, name: true, joinedAt: true, decidedAt: true },
    })
    for (const u of users) {
      await this.warehouse.bronzeUser.upsert({
        where: { id: u.id },
        create: {
          id: u.id,
          snapshotDateKey: today,
          role: u.role,
          status: u.status,
          referralCode: u.referralCode,
          uplineCode: u.uplineCode,
          name: u.name,
          joinedAt: u.joinedAt,
          decidedAt: u.decidedAt,
        },
        update: {
          snapshotDateKey: today,
          role: u.role,
          status: u.status,
          referralCode: u.referralCode,
          uplineCode: u.uplineCode,
          name: u.name,
          decidedAt: u.decidedAt,
        },
      })
    }
  }

  // ─── Silver ─────────────────────────────────────────────────────────────

  private async conformSilverOrders(dateInt: number): Promise<void> {
    const orders = await this.warehouse.bronzeOrder.findMany({ where: { dateKey: dateInt } })
    if (orders.length === 0) return

    const codes = [...new Set(orders.map((o) => o.soldByCode).filter((c): c is string => Boolean(c)))]
    const agents =
      codes.length > 0
        ? await this.warehouse.silverAgentDim.findMany({ where: { referralCode: { in: codes } } })
        : []
    const agentByCode = new Map(agents.map((a) => [a.referralCode, a]))

    for (const o of orders) {
      const isPaid = (PAID_STATUSES as readonly string[]).includes(o.status)
      const isCompleted = o.status === 'completed'
      const split = asSplit(o.split)
      const agent = o.soldByCode ? agentByCode.get(o.soldByCode) : undefined

      await this.warehouse.silverOrderFact.upsert({
        where: { orderId: o.id },
        create: {
          orderId: o.id,
          dateKey: o.dateKey,
          hour: o.createdAt.getUTCHours(),
          status: o.status,
          isPaid,
          isCompleted,
          network: o.network ?? 'UNKNOWN',
          category: o.category,
          productId: o.productId ?? 'UNKNOWN',
          productName: o.productName ?? 'UNKNOWN',
          salePrice: o.salePrice,
          supplierCost: isCompleted ? split.supplierCost : 0,
          paystackFee: isCompleted ? split.processingFee : 0,
          agentMargin: isCompleted
            ? split.shares.filter((s) => s.role === 'agent').reduce((sum, s) => sum + s.margin, 0)
            : 0,
          agentCode: o.soldByCode,
          // `?? o.soldByCode` mirrors the original fallback: a code with no
          // matching user (should be rare) is still attributable by itself.
          agentId: o.soldByCode ? (agent?.agentId ?? o.soldByCode) : null,
          agentName: o.soldByAgentName ?? agent?.name ?? o.soldByCode,
          buyerPhone: o.buyerPhone,
        },
        update: {
          status: o.status,
          isPaid,
          isCompleted,
          network: o.network ?? 'UNKNOWN',
          // Same reasoning as `network` above and as `ingestBronzeOrders`'s
          // own update clause: harmless to re-write an immutable value, and
          // it's what lets a Silver row ingested before this field existed
          // pick it up on a `recomputeFrom` rerun instead of staying 'UNKNOWN'.
          productId: o.productId ?? 'UNKNOWN',
          productName: o.productName ?? 'UNKNOWN',
          supplierCost: isCompleted ? split.supplierCost : 0,
          paystackFee: isCompleted ? split.processingFee : 0,
          agentMargin: isCompleted
            ? split.shares.filter((s) => s.role === 'agent').reduce((sum, s) => sum + s.margin, 0)
            : 0,
          agentName: o.soldByAgentName ?? agent?.name ?? o.soldByCode,
        },
      })
    }
  }

  private async conformSilverDispatches(dateInt: number): Promise<void> {
    const dispatches = await this.warehouse.bronzeSupplierDispatch.findMany({ where: { dateKey: dateInt } })
    for (const d of dispatches) {
      const resolvedOutcome = resolveDispatchOutcome(d)
      await this.warehouse.silverDispatchFact.upsert({
        where: { dispatchId: d.id },
        create: {
          dispatchId: d.id,
          dateKey: d.dateKey,
          orderId: d.orderId,
          network: d.network ?? 'UNKNOWN',
          resolvedOutcome,
        },
        update: { network: d.network ?? 'UNKNOWN', resolvedOutcome },
      })
    }
  }

  /** Resolves the order's network/category via a join to `BronzeOrder`, `RefundRequest` itself carries neither. */
  private async conformSilverRefunds(dateInt: number): Promise<void> {
    const refunds = await this.warehouse.bronzeRefund.findMany({ where: { dateKey: dateInt } })
    if (refunds.length === 0) return

    const orderIds = [...new Set(refunds.map((r) => r.orderId))]
    const orders = await this.warehouse.bronzeOrder.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, network: true, category: true },
    })
    const orderById = new Map(orders.map((o) => [o.id, o]))

    for (const r of refunds) {
      const order = orderById.get(r.orderId)
      const row = {
        amount: r.amount,
        method: r.method,
        network: order?.network ?? 'UNKNOWN',
        category: order?.category ?? 'UNKNOWN',
        reason: r.reason.slice(0, 200),
        turnaroundHours: hoursBetween(r.createdAt, r.decidedAt),
      }
      await this.warehouse.silverRefundFact.upsert({
        where: { refundId: r.id },
        create: { refundId: r.id, dateKey: r.dateKey, ...row },
        update: row,
      })
    }
  }

  private async conformSilverWithdrawals(dateInt: number): Promise<void> {
    const withdrawals = await this.warehouse.bronzeWithdrawal.findMany({ where: { dateKey: dateInt } })
    for (const w of withdrawals) {
      const isPaid = w.status === 'paid'
      await this.warehouse.silverWithdrawalFact.upsert({
        where: { withdrawalId: w.id },
        create: {
          withdrawalId: w.id,
          dateKey: w.dateKey,
          agentId: w.userId,
          status: w.status,
          amount: w.amount,
          isPaid,
          hoursToPay: w.paidAt ? hoursBetween(w.requestedAt, w.paidAt) : null,
        },
        update: {
          status: w.status,
          isPaid,
          hoursToPay: w.paidAt ? hoursBetween(w.requestedAt, w.paidAt) : null,
        },
      })
    }
  }

  private async conformSilverFeedback(dateInt: number): Promise<void> {
    const reports = await this.warehouse.bronzeFeedback.findMany({ where: { dateKey: dateInt } })
    for (const f of reports) {
      await this.warehouse.silverFeedbackFact.upsert({
        where: { feedbackId: f.id },
        create: {
          feedbackId: f.id,
          dateKey: f.dateKey,
          category: f.category,
          status: f.status,
          escalated: f.escalated,
          turnaroundHours: f.decidedAt ? hoursBetween(f.createdAt, f.decidedAt) : null,
        },
        update: {
          status: f.status,
          escalated: f.escalated,
          turnaroundHours: f.decidedAt ? hoursBetween(f.createdAt, f.decidedAt) : null,
        },
      })
    }
  }

  /**
   * `network`/`category`/`agentId` resolved here, once, via a join through
   * `orderRef` to `BronzeOrder` (and, for the agent, on to `SilverAgentDim`
   * the same way `conformSilverOrders` does it). A `topup`/`payout`/
   * `capital_*` entry has no `orderRef` and correctly resolves to nulls,
   * excluded from any per-network/category/agent cut without special-casing
   * it at every Gold query.
   */
  private async conformSilverLedgerFacts(dateInt: number): Promise<void> {
    const entries = await this.warehouse.bronzeLedgerEntry.findMany({ where: { dateKey: dateInt } })
    if (entries.length === 0) return

    const orderRefs = [...new Set(entries.map((e) => e.orderRef).filter((r): r is string => Boolean(r)))]
    const orders =
      orderRefs.length > 0
        ? await this.warehouse.bronzeOrder.findMany({
            where: { reference: { in: orderRefs } },
            select: { reference: true, network: true, category: true, productId: true, productName: true, soldByCode: true },
          })
        : []
    const orderByRef = new Map(orders.map((o) => [o.reference, o]))

    const codes = [...new Set(orders.map((o) => o.soldByCode).filter((c): c is string => Boolean(c)))]
    const agents =
      codes.length > 0
        ? await this.warehouse.silverAgentDim.findMany({ where: { referralCode: { in: codes } } })
        : []
    const agentByCode = new Map(agents.map((a) => [a.referralCode, a.agentId]))

    for (const e of entries) {
      const order = e.orderRef ? orderByRef.get(e.orderRef) : undefined
      // `userId` wins when the entry carries one: `agent_margin` is written
      // once per share (see `FulfilmentService.recordDelivered`), each
      // correctly tagged with that share's own agent, which an order-level
      // `soldByCode` fallback could not tell apart if a sale ever produces
      // more than one share again. Only entries with no `userId` of their
      // own (`revenue`, `supplier_cost`, `payment_fee`, all order-wide, not
      // per-agent) fall back to the order's single seller.
      const agentId = e.userId ?? (order?.soldByCode ? agentByCode.get(order.soldByCode) ?? order.soldByCode : null)
      const row = {
        kind: e.kind,
        amount: e.amount,
        affectsProfit: e.affectsProfit,
        orderRef: e.orderRef,
        network: order?.network ?? (order ? 'UNKNOWN' : null),
        category: order?.category ?? null,
        productId: order?.productId ?? (order ? 'UNKNOWN' : null),
        productName: order?.productName ?? (order ? 'UNKNOWN' : null),
        agentId,
      }
      await this.warehouse.silverLedgerFact.upsert({
        where: { entryId: e.id },
        create: { entryId: e.id, dateKey: e.dateKey, ...row },
        update: row,
      })
    }
  }

  /**
   * Refreshed from the latest `BronzeBeneficiaryRequest` snapshot every run,
   * the same reasoning as `refreshSilverAgentDim`, but safe to write into
   * historical days for the immutable half of it: `firstSeenAt` never
   * changes, and neither does `approvedAt` once it is set, only the
   * "still blocked right now" reading is a snapshot rather than history.
   */
  private async refreshSilverBeneficiaryFacts(): Promise<void> {
    const rows = await this.warehouse.bronzeBeneficiaryRequest.findMany()
    for (const r of rows) {
      const resolved = r.approvedAt !== null
      const data = {
        networkKey: r.networkKey,
        attempts: r.attempts,
        lastValue: r.lastValue,
        resolved,
        resolvedDateKey: r.approvedAt ? toDateInt(r.approvedAt) : null,
        hoursToResolve: r.approvedAt ? hoursBetween(r.firstSeenAt, r.approvedAt) : null,
      }
      await this.warehouse.silverBeneficiaryFact.upsert({
        where: { phone: r.phone },
        create: { phone: r.phone, dateKey: toDateInt(r.firstSeenAt), ...data },
        update: data,
      })
    }
  }

  /**
   * Refreshed from the latest `BronzeUser` snapshot, see that model's own
   * comment. `depth` here is the agent's position in *today's* full tree; an
   * admin is the root, not one more rung in someone's chain, so only an
   * agent's own upline continues the walk. `computeDownlineDepth` below
   * does its own separate, day-scoped version of this same walk for the
   * Gold rollup, this field is a current-state dimension attribute, not
   * what that rollup actually reads.
   */
  private async refreshSilverAgentDim(): Promise<void> {
    const users = await this.warehouse.bronzeUser.findMany()
    const agentByCode = new Map(
      users.filter((u) => u.role === 'agent').map((u) => [u.referralCode, u.uplineCode]),
    )

    const depthOf = (code: string): number => {
      let depth = 0
      let upline = agentByCode.get(code) ?? null
      const seen = new Set<string>()
      while (upline && agentByCode.has(upline) && !seen.has(upline)) {
        seen.add(upline)
        depth++
        upline = agentByCode.get(upline) ?? null
        if (depth > 50) break // a real cycle should never exist, this is just a hard stop.
      }
      return depth
    }

    for (const u of users) {
      await this.warehouse.silverAgentDim.upsert({
        where: { agentId: u.id },
        create: {
          agentId: u.id,
          referralCode: u.referralCode,
          name: u.name ?? u.referralCode,
          role: u.role,
          status: u.status,
          uplineCode: u.uplineCode,
          depth: depthOf(u.referralCode),
          joinedAt: u.joinedAt,
          joinedDateKey: toDateInt(u.joinedAt),
          snapshotDateKey: u.snapshotDateKey,
        },
        update: {
          referralCode: u.referralCode,
          name: u.name ?? u.referralCode,
          role: u.role,
          status: u.status,
          uplineCode: u.uplineCode,
          depth: depthOf(u.referralCode),
          snapshotDateKey: u.snapshotDateKey,
        },
      })
    }
  }

  /**
   * One row per agent application ever made, refreshed from `BronzeUser`
   * every run like `SilverAgentDim`, but this is safe to write into
   * historical days from a snapshot: `joinedAt`/`decidedAt` are immutable
   * once set (an application is decided exactly once, see
   * `ApplicationsService.approve`/`reject`), so a cold-start backfill still
   * lands `applied`/`approved`/`rejected` on the real day each happened,
   * unlike `computeAgentHealth`'s status-based counts.
   */
  private async refreshSilverApplications(): Promise<void> {
    const agents = await this.warehouse.bronzeUser.findMany({ where: { role: 'agent' } })
    for (const u of agents) {
      // `suspended` reflects something that happened after an approval, not
      // a different original decision, so it still counts as `approved` here.
      const outcome = u.status === 'pending' ? 'pending' : u.status === 'rejected' ? 'rejected' : 'approved'
      await this.warehouse.silverApplicationFact.upsert({
        where: { userId: u.id },
        create: {
          userId: u.id,
          appliedDateKey: toDateInt(u.joinedAt),
          decidedDateKey: u.decidedAt ? toDateInt(u.decidedAt) : null,
          outcome,
          hoursToDecide: u.decidedAt ? hoursBetween(u.joinedAt, u.decidedAt) : null,
        },
        update: {
          decidedDateKey: u.decidedAt ? toDateInt(u.decidedAt) : null,
          outcome,
          hoursToDecide: u.decidedAt ? hoursBetween(u.joinedAt, u.decidedAt) : null,
        },
      })
    }
  }

  /**
   * `SolvencyService.position()` and `FloatMonitorService.latest()`, the same
   * two computations `ReservePanel.tsx`/`FloatPanel.tsx` already call live,
   * snapshotted once a day so their trend becomes visible. Always for
   * `today` only, see this class's own doc comment for why neither can be
   * backfilled.
   */
  private async computeLiveSnapshots(today: number): Promise<void> {
    const [position, float] = await Promise.all([this.solvency.position(), this.floatMonitor.latest()])

    const solvencyRow = {
      expectedAtPaystack: position.expectedAtPaystack,
      spentOnBundles: position.spentOnBundles,
      freeToSpend: position.freeToSpend,
      owedToAgents: position.liabilities.agentEarnings,
      owedToCustomers: position.liabilities.customerMoney,
      undeliveredOrders: position.liabilities.undeliveredOrders,
      queuedPayouts: position.liabilities.queuedPayouts,
      manualRefundAdvances: position.liabilities.manualRefundAdvances,
      manualPayoutAdvances: position.liabilities.manualPayoutAdvances,
      liabilitiesTotal: position.liabilities.total,
      floatBalance: float?.balance ?? null,
    }
    await this.warehouse.dailySolvencySnapshot.upsert({
      where: { date: today },
      create: { date: today, ...solvencyRow },
      update: solvencyRow,
    })

    // No live reading yet (a fresh install before the first purchase) leaves
    // nothing meaningful to snapshot.
    if (!float) return
    const floatRow = { balance: float.balance, reference: float.reference, level: float.level, observedAt: new Date(float.observedAt) }
    await this.warehouse.dailyFloatSnapshot.upsert({
      where: { date: today },
      create: { date: today, ...floatRow },
      update: floatRow,
    })
  }

  // ─── Gold ───────────────────────────────────────────────────────────────

  /** Signed pesewa sum per `kind`, for whatever slice of `SilverLedgerFact` the caller already filtered to. */
  private sumLedgerByKind(entries: { kind: string; amount: number }[]): Map<string, number> {
    const totals = new Map<string, number>()
    for (const e of entries) totals.set(e.kind, (totals.get(e.kind) ?? 0) + e.amount)
    return totals
  }

  /**
   * Every money figure here comes from `SilverLedgerFact`, never from
   * `SilverOrderFact.supplierCost`/`paystackFee`/`agentMargin` (which no
   * longer exist as separate fields): those used to be parsed straight out
   * of `Order.split`, a point-in-time estimate frozen at sale, not the
   * settled truth `LedgerEntry` is. `profit` is the single
   * `affectsProfit`-filtered sum, the same computation `LedgerService.statement()`
   * itself uses, which nets revenue, cost, fees, margins AND refunds/write-offs/
   * overpayments in one pass, this table's own `refundsAmount` is no longer
   * something a reader has to remember to also subtract.
   */
  private async computeDailySummary(dateInt: number): Promise<void> {
    const orders = await this.warehouse.silverOrderFact.findMany({
      where: { dateKey: dateInt },
      select: { status: true },
    })
    const ledger = await this.warehouse.silverLedgerFact.findMany({ where: { dateKey: dateInt } })
    const byKind = this.sumLedgerByKind(ledger)

    const row = {
      ordersCount: orders.length,
      completedCount: orders.filter((o) => o.status === 'completed').length,
      failedCount: orders.filter((o) => o.status === 'failed').length,
      revenue: byKind.get('revenue') ?? 0,
      supplierCost: -(byKind.get('supplier_cost') ?? 0),
      paystackFees: -(byKind.get('payment_fee') ?? 0),
      agentMargins: -(byKind.get('agent_margin') ?? 0),
      refundsAmount: -(byKind.get('refund') ?? 0),
      profit: ledger.filter((e) => e.affectsProfit).reduce((sum, e) => sum + e.amount, 0),
    }
    await this.warehouse.dailySummary.upsert({
      where: { date: dateInt },
      create: { date: dateInt, ...row },
      update: row,
    })
  }

  /** Same money-from-the-ledger approach as `computeDailySummary`, cut by `SilverLedgerFact.network` instead of platform-wide. */
  private async computeNetworkSummary(dateInt: number): Promise<void> {
    const orders = await this.warehouse.silverOrderFact.findMany({
      where: { dateKey: dateInt, isPaid: true },
      select: { network: true },
    })
    const ordersCountByNetwork = new Map<string, number>()
    for (const o of orders) ordersCountByNetwork.set(o.network, (ordersCountByNetwork.get(o.network) ?? 0) + 1)

    const ledger = await this.warehouse.silverLedgerFact.findMany({ where: { dateKey: dateInt, network: { not: null } } })
    const byNetwork = new Map<string, { revenue: number; supplierCost: number; paystackFee: number; agentMargin: number; profit: number }>()
    for (const e of ledger) {
      const network = e.network as string
      const row = byNetwork.get(network) ?? { revenue: 0, supplierCost: 0, paystackFee: 0, agentMargin: 0, profit: 0 }
      if (e.kind === 'revenue') row.revenue += e.amount
      else if (e.kind === 'supplier_cost') row.supplierCost += -e.amount
      else if (e.kind === 'payment_fee') row.paystackFee += -e.amount
      else if (e.kind === 'agent_margin') row.agentMargin += -e.amount
      if (e.affectsProfit) row.profit += e.amount
      byNetwork.set(network, row)
    }

    for (const network of new Set([...ordersCountByNetwork.keys(), ...byNetwork.keys()])) {
      const money = byNetwork.get(network) ?? { revenue: 0, supplierCost: 0, paystackFee: 0, agentMargin: 0, profit: 0 }
      const data = { ordersCount: ordersCountByNetwork.get(network) ?? 0, ...money }
      await this.warehouse.dailyNetworkSummary.upsert({
        where: { date_network: { date: dateInt, network } },
        create: { date: dateInt, network, ...data },
        update: data,
      })
    }
  }

  /** Same shape as `computeNetworkSummary`, cut by category instead of network. */
  private async computeCategorySummary(dateInt: number): Promise<void> {
    const orders = await this.warehouse.silverOrderFact.findMany({
      where: { dateKey: dateInt, isPaid: true },
      select: { category: true },
    })
    const ordersCountByCategory = new Map<string, number>()
    for (const o of orders) ordersCountByCategory.set(o.category, (ordersCountByCategory.get(o.category) ?? 0) + 1)

    const ledger = await this.warehouse.silverLedgerFact.findMany({ where: { dateKey: dateInt, category: { not: null } } })
    const byCategory = new Map<string, { revenue: number; supplierCost: number; paystackFee: number; agentMargin: number; profit: number }>()
    for (const e of ledger) {
      const category = e.category as string
      const row = byCategory.get(category) ?? { revenue: 0, supplierCost: 0, paystackFee: 0, agentMargin: 0, profit: 0 }
      if (e.kind === 'revenue') row.revenue += e.amount
      else if (e.kind === 'supplier_cost') row.supplierCost += -e.amount
      else if (e.kind === 'payment_fee') row.paystackFee += -e.amount
      else if (e.kind === 'agent_margin') row.agentMargin += -e.amount
      if (e.affectsProfit) row.profit += e.amount
      byCategory.set(category, row)
    }

    for (const category of new Set([...ordersCountByCategory.keys(), ...byCategory.keys()])) {
      const money = byCategory.get(category) ?? { revenue: 0, supplierCost: 0, paystackFee: 0, agentMargin: 0, profit: 0 }
      const data = { ordersCount: ordersCountByCategory.get(category) ?? 0, ...money }
      await this.warehouse.dailyCategorySummary.upsert({
        where: { date_category: { date: dateInt, category } },
        create: { date: dateInt, category, ...data },
        update: data,
      })
    }
  }

  /**
   * Same formula and same ledger-sourced money as `computeNetworkSummary`/
   * `computeCategorySummary`, one row per individual product instead. Unlike
   * those two, `network`/`category` are carried here as plain attributes on
   * each product row (not the grouping key), so the frontend can filter this
   * same table down to "just this network's products" client-side, e.g. the
   * drill-down when a bar on the network chart is clicked, without a second
   * per-network product table.
   */
  private async computeProductSummary(dateInt: number): Promise<void> {
    interface ProductRow {
      productName: string
      network: string
      category: string
      ordersCount: number
      revenue: number
      supplierCost: number
      paystackFee: number
      agentMargin: number
      profit: number
    }
    const empty = (productName: string, network: string, category: string): ProductRow => ({
      productName,
      network,
      category,
      ordersCount: 0,
      revenue: 0,
      supplierCost: 0,
      paystackFee: 0,
      agentMargin: 0,
      profit: 0,
    })

    const byProduct = new Map<string, ProductRow>()

    const orders = await this.warehouse.silverOrderFact.findMany({
      where: { dateKey: dateInt, isPaid: true },
      select: { productId: true, productName: true, network: true, category: true },
    })
    for (const o of orders) {
      const row = byProduct.get(o.productId) ?? empty(o.productName, o.network, o.category)
      row.ordersCount++
      byProduct.set(o.productId, row)
    }

    const ledger = await this.warehouse.silverLedgerFact.findMany({ where: { dateKey: dateInt, productId: { not: null } } })
    for (const e of ledger) {
      const productId = e.productId as string
      const row = byProduct.get(productId) ?? empty(e.productName ?? 'UNKNOWN', e.network ?? 'UNKNOWN', e.category ?? 'UNKNOWN')
      if (e.kind === 'revenue') row.revenue += e.amount
      else if (e.kind === 'supplier_cost') row.supplierCost += -e.amount
      else if (e.kind === 'payment_fee') row.paystackFee += -e.amount
      else if (e.kind === 'agent_margin') row.agentMargin += -e.amount
      if (e.affectsProfit) row.profit += e.amount
      byProduct.set(productId, row)
    }

    // Delete-then-insert, not a per-key upsert: unlike `network`/`category`
    // (a small, effectively permanent set), `recomputeFrom` fixing a bug in
    // how an order resolves to its product can genuinely change WHICH
    // productId an already-processed order belongs to (this is exactly how
    // this table's own bootstrapping bug was found: every existing order
    // resolved to 'UNKNOWN' until `ingestBronzeOrders`/`conformSilverOrders`
    // were fixed to backfill it). An upsert alone leaves the old, now-wrong
    // key's row behind, since nothing about re-running ever revisits or
    // deletes a key the fresh computation no longer produces.
    await this.warehouse.dailyProductSummary.deleteMany({ where: { date: dateInt } })
    for (const [productId, row] of byProduct) {
      await this.warehouse.dailyProductSummary.create({ data: { date: dateInt, productId, ...row } })
    }
  }

  private async computeDispatchReliability(dateInt: number): Promise<void> {
    const dispatches = await this.warehouse.silverDispatchFact.findMany({ where: { dateKey: dateInt } })

    const byNetwork = new Map<
      string,
      { totalAttempts: number; successful: number; noReply: number; manualQueue: number; otherFailed: number }
    >()
    for (const d of dispatches) {
      const row = byNetwork.get(d.network) ?? { totalAttempts: 0, successful: 0, noReply: 0, manualQueue: 0, otherFailed: 0 }
      row.totalAttempts++
      if (d.resolvedOutcome === 'successful') row.successful++
      else if (d.resolvedOutcome === 'noReply') row.noReply++
      else if (d.resolvedOutcome === 'manualQueue') row.manualQueue++
      else if (d.resolvedOutcome === 'otherFailed') row.otherFailed++
      byNetwork.set(d.network, row)
    }

    for (const [network, row] of byNetwork) {
      await this.warehouse.dailyDispatchReliability.upsert({
        where: { date_network: { date: dateInt, network } },
        create: { date: dateInt, network, ...row },
        update: row,
      })
    }
  }

  /** `ordersCount`/`agentName`/`agentCode` from `SilverOrderFact` (identity, unaffected by the money source); `revenue`/`margin` from `SilverLedgerFact`, grouped by `agentId`. */
  private async computeAgentSummary(dateInt: number): Promise<void> {
    const orders = await this.warehouse.silverOrderFact.findMany({
      where: { dateKey: dateInt, isPaid: true, agentCode: { not: null } },
    })
    if (orders.length === 0) return

    const byAgent = new Map<string, { agentId: string; name: string; ordersCount: number }>()
    for (const o of orders) {
      const code = o.agentCode as string
      const row = byAgent.get(code) ?? { agentId: o.agentId ?? code, name: o.agentName ?? code, ordersCount: 0 }
      row.ordersCount++
      byAgent.set(code, row)
    }

    const agentIds = [...new Set([...byAgent.values()].map((r) => r.agentId))]
    const ledger = await this.warehouse.silverLedgerFact.findMany({
      where: { dateKey: dateInt, agentId: { in: agentIds } },
    })
    const revenueByAgent = new Map<string, number>()
    const marginByAgent = new Map<string, number>()
    for (const e of ledger) {
      const agentId = e.agentId as string
      if (e.kind === 'revenue') revenueByAgent.set(agentId, (revenueByAgent.get(agentId) ?? 0) + e.amount)
      else if (e.kind === 'agent_margin') marginByAgent.set(agentId, (marginByAgent.get(agentId) ?? 0) + -e.amount)
    }

    for (const [code, row] of byAgent) {
      const data = {
        agentName: row.name,
        ordersCount: row.ordersCount,
        revenue: revenueByAgent.get(row.agentId) ?? 0,
        margin: marginByAgent.get(row.agentId) ?? 0,
      }
      await this.warehouse.dailyAgentSummary.upsert({
        where: { date_agentId: { date: dateInt, agentId: row.agentId } },
        create: { date: dateInt, agentId: row.agentId, agentCode: code, ...data },
        update: data,
      })
    }
  }

  /**
   * Reflects `SilverAgentDim`'s state as of *now*, not a true reconstruction
   * of that day, see this class's own doc comment for why. `dormantAgents`
   * and `newSignups` are the two numbers here safe to trust even on a
   * backfill: dormancy is measured against Silver order history up to that
   * day (immutable), and a signup date never changes.
   */
  private async computeAgentHealth(dateInt: number, end: Date): Promise<void> {
    const agents = await this.warehouse.silverAgentDim.findMany({ where: { role: 'agent' } })
    const asOfDay = agents.filter((a) => a.joinedAt < end)
    const active = asOfDay.filter((a) => a.status === 'active')
    const pendingApplications = asOfDay.filter((a) => a.status === 'pending').length
    const newSignups = agents.filter((a) => a.joinedAt >= dayBounds(dateInt).start && a.joinedAt < end).length

    const soldCodes = new Set(
      (
        await this.warehouse.silverOrderFact.findMany({
          where: { isCompleted: true, dateKey: { lte: dateInt }, agentCode: { not: null } },
          select: { agentCode: true },
          distinct: ['agentCode'],
        })
      ).map((o) => o.agentCode as string),
    )
    const dormantAgents = active.filter((a) => !soldCodes.has(a.referralCode)).length

    const row = { totalAgents: asOfDay.length, activeAgents: active.length, dormantAgents, newSignups, pendingApplications }
    await this.warehouse.dailyAgentHealth.upsert({
      where: { date: dateInt },
      create: { date: dateInt, ...row },
      update: row,
    })
  }

  /**
   * Deliberately its own walk, not a read of `SilverAgentDim.depth`: that
   * field is today's full tree, this rebuilds the tree as it stood using
   * only agents who had joined by this day, so a backfilled historical day
   * shows the shape it actually had, not today's. Status (which the
   * "current structure" caveat elsewhere is about) never enters this
   * calculation at all, only `uplineCode` and `joinedAt`, both immutable,
   * so this part genuinely is a true historical reconstruction.
   */
  private async computeDownlineDepth(dateInt: number): Promise<void> {
    const { end } = dayBounds(dateInt)
    const agents = await this.warehouse.silverAgentDim.findMany({
      where: { role: 'agent', joinedAt: { lt: end } },
      select: { referralCode: true, uplineCode: true },
    })
    const byCode = new Map(agents.map((a) => [a.referralCode, a.uplineCode]))

    const depthByCount = new Map<number, number>()
    for (const agent of agents) {
      let depth = 0
      let upline = agent.uplineCode
      const seen = new Set<string>()
      while (upline && byCode.has(upline) && !seen.has(upline)) {
        seen.add(upline)
        depth++
        upline = byCode.get(upline) ?? null
        if (depth > 50) break // a real cycle should never exist, this is just a hard stop.
      }
      depthByCount.set(depth, (depthByCount.get(depth) ?? 0) + 1)
    }

    for (const [depth, agentCount] of depthByCount) {
      await this.warehouse.dailyDownlineDepth.upsert({
        where: { date_depth: { date: dateInt, depth } },
        create: { date: dateInt, depth, agentCount },
        update: { agentCount },
      })
    }
  }

  private async computeHourlyVolume(dateInt: number): Promise<void> {
    const orders = await this.warehouse.silverOrderFact.findMany({ where: { dateKey: dateInt, isPaid: true } })

    const byHour = new Map<number, { ordersCount: number; revenue: number }>()
    for (const o of orders) {
      const row = byHour.get(o.hour) ?? { ordersCount: 0, revenue: 0 }
      row.ordersCount++
      row.revenue += o.salePrice
      byHour.set(o.hour, row)
    }

    for (const [hour, row] of byHour) {
      await this.warehouse.hourlyOrderVolume.upsert({
        where: { date_hour: { date: dateInt, hour } },
        create: { date: dateInt, hour, ...row },
        update: row,
      })
    }
  }

  private async computeCheckoutFunnel(dateInt: number): Promise<void> {
    const orders = await this.warehouse.silverOrderFact.findMany({ where: { dateKey: dateInt }, select: { isPaid: true } })
    const started = orders.length
    const paid = orders.filter((o) => o.isPaid).length

    await this.warehouse.dailyCheckoutFunnel.upsert({
      where: { date: dateInt },
      create: { date: dateInt, started, paid, abandoned: started - paid },
      update: { started, paid, abandoned: started - paid },
    })
  }

  private async computeCustomerBehavior(dateInt: number): Promise<void> {
    const todaysOrders = await this.warehouse.silverOrderFact.findMany({
      where: { dateKey: dateInt, isPaid: true },
      select: { buyerPhone: true },
      distinct: ['buyerPhone'],
    })
    const buyers = todaysOrders.map((o) => o.buyerPhone)
    if (buyers.length === 0) {
      await this.warehouse.dailyCustomerBehavior.upsert({
        where: { date: dateInt },
        create: { date: dateInt, uniqueBuyers: 0, repeatBuyers: 0 },
        update: { uniqueBuyers: 0, repeatBuyers: 0 },
      })
      return
    }

    const history = await this.warehouse.silverOrderFact.groupBy({
      by: ['buyerPhone'],
      where: { buyerPhone: { in: buyers }, isCompleted: true, dateKey: { lte: dateInt } },
      _count: { _all: true },
    })
    const repeatBuyers = history.filter((h) => h._count._all >= 2).length

    await this.warehouse.dailyCustomerBehavior.upsert({
      where: { date: dateInt },
      create: { date: dateInt, uniqueBuyers: buyers.length, repeatBuyers },
      update: { uniqueBuyers: buyers.length, repeatBuyers },
    })
  }

  /**
   * `avgSupplierCost` is the real settled charge from `SilverLedgerFact`'s
   * `supplier_cost` entries, not `SilverOrderFact.supplierCost` (the estimate
   * frozen in `Order.split` at sale time, before DataHub had actually
   * replied with what it charged). That estimate is exactly what this KPI
   * is supposed to be checking pricing *against*, so it cannot also be the
   * thing standing in for the real number. A `supplier_cost` entry can be
   * booked days after the order itself, on whichever day DataHub actually
   * settles it, so this joins by `orderRef` across all of `SilverLedgerFact`,
   * not by matching `dateKey` to this day.
   */
  private async computeMarginAccuracy(dateInt: number): Promise<void> {
    const orders = await this.warehouse.bronzeOrder.findMany({
      where: { dateKey: dateInt, status: 'completed' },
      select: { reference: true, salePrice: true },
    })
    if (orders.length === 0) {
      await this.warehouse.dailyMarginAccuracy.upsert({
        where: { date: dateInt },
        create: { date: dateInt, ordersCount: 0, avgSalePrice: 0, avgSupplierCost: 0, avgMarginBp: 0 },
        update: { ordersCount: 0, avgSalePrice: 0, avgSupplierCost: 0, avgMarginBp: 0 },
      })
      return
    }

    const refs = orders.map((o) => o.reference)
    const costEntries = await this.warehouse.silverLedgerFact.findMany({
      where: { kind: 'supplier_cost', orderRef: { in: refs } },
      select: { orderRef: true, amount: true },
    })
    const costByRef = new Map(costEntries.map((e) => [e.orderRef as string, -e.amount]))

    const avgSalePrice = Math.round(orders.reduce((sum, o) => sum + o.salePrice, 0) / orders.length)
    const avgSupplierCost = Math.round(orders.reduce((sum, o) => sum + (costByRef.get(o.reference) ?? 0), 0) / orders.length)
    const avgMarginBp = avgSalePrice > 0 ? Math.round(((avgSalePrice - avgSupplierCost) / avgSalePrice) * 10_000) : 0

    await this.warehouse.dailyMarginAccuracy.upsert({
      where: { date: dateInt },
      create: { date: dateInt, ordersCount: orders.length, avgSalePrice, avgSupplierCost, avgMarginBp },
      update: { ordersCount: orders.length, avgSalePrice, avgSupplierCost, avgMarginBp },
    })
  }

  private async computeRefundSummary(dateInt: number): Promise<void> {
    const refunds = await this.warehouse.silverRefundFact.findMany({ where: { dateKey: dateInt } })
    const buckets = bucketHours(refunds.map((r) => r.turnaroundHours))
    const row = {
      count: refunds.length,
      amount: refunds.reduce((sum, r) => sum + r.amount, 0),
      avgTurnaroundHours: average(refunds.map((r) => r.turnaroundHours)),
      decidedUnder1h: buckets.under1h,
      decided1to4h: buckets.from1to4h,
      decided4to24h: buckets.from4to24h,
      decidedOver24h: buckets.over24h,
    }
    await this.warehouse.dailyRefundSummary.upsert({
      where: { date: dateInt },
      create: { date: dateInt, ...row },
      update: row,
    })
  }

  private async computeRefundNetworkSummary(dateInt: number): Promise<void> {
    const refunds = await this.warehouse.silverRefundFact.findMany({ where: { dateKey: dateInt } })
    const byNetwork = new Map<string, { count: number; amount: number }>()
    for (const r of refunds) {
      const row = byNetwork.get(r.network) ?? { count: 0, amount: 0 }
      row.count++
      row.amount += r.amount
      byNetwork.set(r.network, row)
    }
    for (const [network, row] of byNetwork) {
      await this.warehouse.dailyRefundNetworkSummary.upsert({
        where: { date_network: { date: dateInt, network } },
        create: { date: dateInt, network, ...row },
        update: row,
      })
    }
  }

  private async computeRefundReasonSummary(dateInt: number): Promise<void> {
    const refunds = await this.warehouse.silverRefundFact.findMany({ where: { dateKey: dateInt } })
    const byReason = new Map<string, { count: number; amount: number }>()
    for (const r of refunds) {
      const row = byReason.get(r.reason) ?? { count: 0, amount: 0 }
      row.count++
      row.amount += r.amount
      byReason.set(r.reason, row)
    }
    for (const [reason, row] of byReason) {
      await this.warehouse.dailyRefundReasonSummary.upsert({
        where: { date_reason: { date: dateInt, reason } },
        create: { date: dateInt, reason, ...row },
        update: row,
      })
    }
  }

  private async computeDailyPayoutSummary(dateInt: number): Promise<void> {
    const withdrawals = await this.warehouse.silverWithdrawalFact.findMany({ where: { dateKey: dateInt } })
    const paid = withdrawals.filter((w) => w.isPaid)
    const buckets = bucketHours(paid.map((w) => w.hoursToPay ?? 0))
    const row = {
      requestedCount: withdrawals.length,
      requestedAmount: withdrawals.reduce((sum, w) => sum + w.amount, 0),
      paidCount: paid.length,
      paidAmount: paid.reduce((sum, w) => sum + w.amount, 0),
      avgHoursToPay: average(paid.map((w) => w.hoursToPay ?? 0)),
      paidUnder1h: buckets.under1h,
      paid1to4h: buckets.from1to4h,
      paid4to24h: buckets.from4to24h,
      paidOver24h: buckets.over24h,
    }
    await this.warehouse.dailyPayoutSummary.upsert({
      where: { date: dateInt },
      create: { date: dateInt, ...row },
      update: row,
    })
  }

  private async computeDailyFeedbackSummary(dateInt: number): Promise<void> {
    const reports = await this.warehouse.silverFeedbackFact.findMany({ where: { dateKey: dateInt } })
    const byCategory = new Map<string, { openCount: number; reviewedCount: number; resolvedCount: number; escalatedCount: number; total: number }>()
    for (const f of reports) {
      const row = byCategory.get(f.category) ?? { openCount: 0, reviewedCount: 0, resolvedCount: 0, escalatedCount: 0, total: 0 }
      row.total++
      if (f.status === 'open') row.openCount++
      else if (f.status === 'reviewed') row.reviewedCount++
      else if (f.status === 'resolved') row.resolvedCount++
      // Escalation is a separate, orthogonal track (see `FeedbackReport`'s
      // own comment), independent of status, so this is not an `else if`.
      if (f.escalated) row.escalatedCount++
      byCategory.set(f.category, row)
    }
    for (const [category, row] of byCategory) {
      await this.warehouse.dailyFeedbackSummary.upsert({
        where: { date_category: { date: dateInt, category } },
        create: { date: dateInt, category, ...row },
        update: row,
      })
    }
  }

  private async computeDailyApplicationFunnel(dateInt: number): Promise<void> {
    const applied = await this.warehouse.silverApplicationFact.count({ where: { appliedDateKey: dateInt } })
    const decidedToday = await this.warehouse.silverApplicationFact.findMany({ where: { decidedDateKey: dateInt } })
    const approved = decidedToday.filter((a) => a.outcome === 'approved').length
    const rejected = decidedToday.filter((a) => a.outcome === 'rejected').length
    const avgHoursToDecide = average(decidedToday.map((a) => a.hoursToDecide ?? 0))
    const buckets = bucketHours(decidedToday.map((a) => a.hoursToDecide ?? 0))

    if (applied === 0 && decidedToday.length === 0) return
    const row = {
      applied,
      approved,
      rejected,
      avgHoursToDecide,
      decidedUnder1h: buckets.under1h,
      decided1to4h: buckets.from1to4h,
      decided4to24h: buckets.from4to24h,
      decidedOver24h: buckets.over24h,
    }
    await this.warehouse.dailyApplicationFunnel.upsert({
      where: { date: dateInt },
      create: { date: dateInt, ...row },
      update: row,
    })
  }

  /**
   * `newlyBlocked`/`resolved` are day-scoped and safe to backfill, immutable
   * events. `stillBlocked` is not: it is `SilverBeneficiaryFact`'s *current*
   * unresolved count, written the same on every day this runs for, the same
   * "snapshot, not history" caveat as `computeAgentHealth`.
   */
  private async computeLostRevenueSummary(dateInt: number): Promise<void> {
    const newlyBlockedRows = await this.warehouse.silverBeneficiaryFact.findMany({ where: { dateKey: dateInt } })
    const resolvedRows = await this.warehouse.silverBeneficiaryFact.findMany({ where: { resolvedDateKey: dateInt } })
    const stillBlockedRows = await this.warehouse.silverBeneficiaryFact.findMany({ where: { resolved: false } })
    const buckets = bucketHours(resolvedRows.map((r) => r.hoursToResolve ?? 0))

    const row = {
      newlyBlocked: newlyBlockedRows.length,
      newlyBlockedValue: newlyBlockedRows.reduce((sum, r) => sum + (r.lastValue ?? 0), 0),
      resolved: resolvedRows.length,
      avgHoursToResolve: average(resolvedRows.map((r) => r.hoursToResolve ?? 0)),
      stillBlocked: stillBlockedRows.length,
      stillBlockedValue: stillBlockedRows.reduce((sum, r) => sum + (r.lastValue ?? 0), 0),
      resolvedUnder1h: buckets.under1h,
      resolved1to4h: buckets.from1to4h,
      resolved4to24h: buckets.from4to24h,
      resolvedOver24h: buckets.over24h,
    }
    await this.warehouse.dailyLostRevenueSummary.upsert({
      where: { date: dateInt },
      create: { date: dateInt, ...row },
      update: row,
    })
  }
}
