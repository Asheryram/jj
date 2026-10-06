import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import type { Prisma } from '@prisma-analytics/client'
import { PrismaService } from '../prisma/prisma.service'
import { FloatMonitorService } from '../supplier/float-monitor.service'
import { KNOWN_PROVIDERS, SettingsService } from '../settings/settings.service'
import { AnalyticsPrismaService } from './analytics-prisma.service'
import { addDays, dayBounds, toDateInt } from './date'

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000
}

/** Monday 0 ... Sunday 6, Ghana time (UTC). */
function weekdayOf(date: Date): number {
  return (date.getUTCDay() + 6) % 7
}

/**
 * A provider's or our own failure wording, made groupable: a phone number
 * in the text ("0256807645 is not added to our beneficiary list") would
 * otherwise make every occurrence its own reason.
 */
export function normaliseReason(reason: string | null | undefined): string | null {
  if (!reason) return null
  const cleaned = reason
    .replace(/\b0\d{9}\b/g, 'the number')
    .replace(/\bJDC-\d+\b/g, 'the order')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? cleaned.slice(0, 120) : null
}

const LEDGER_PAGE = 500

/**
 * Fills the analytics warehouse from production.
 *
 * Each run:
 *  1. copies users, agent applications and blocked numbers (current state),
 *  2. rebuilds `FactOrder` for every order placed in the last
 *     `RECENT_DAYS` days (or all of them after a `FACT_VERSION` change), and
 *     `FactWithdrawal` for every payout,
 *  3. writes the reserve snapshot for each day not yet final,
 *  4. snapshots each provider's float for today.
 *
 * Step 2 re-reads recent orders on every run rather than only new ones
 * because an order keeps changing after the day it was placed: it is
 * delivered, its cost is booked, it fails and is refunded days later. Any
 * order older than `RECENT_DAYS` has long since settled.
 *
 * Runs hourly through the day so "today" is never more than an hour stale,
 * and not overnight, so a quiet database can still go idle (see
 * `ReconcilerService.intervalMs`). Also on boot, and on the page's
 * "Refresh now" button.
 */
@Injectable()
export class EtlService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(EtlService.name)
  private timer: NodeJS.Timeout | null = null
  private running: Promise<{ daysProcessed: number }> | null = null

  /** Bump to rebuild every order fact from scratch on the next run. */
  static readonly FACT_VERSION = 2
  /** How far back each run re-reads orders that may still be changing. */
  static readonly RECENT_DAYS = 45
  /** Ghana hours (UTC) the hourly run is allowed in, inclusive. */
  private static readonly FIRST_RUN_HOUR = 6
  private static readonly LAST_RUN_HOUR = 23

  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouse: AnalyticsPrismaService,
    private readonly floatMonitor: FloatMonitorService,
    private readonly settings: SettingsService,
  ) {}

  /** The next :05 past the hour that falls inside the daytime window. */
  private msUntilNextRun(): number {
    const next = new Date()
    next.setUTCMinutes(5, 0, 0)
    if (next.getTime() <= Date.now()) next.setUTCHours(next.getUTCHours() + 1)
    while (next.getUTCHours() < EtlService.FIRST_RUN_HOUR || next.getUTCHours() > EtlService.LAST_RUN_HOUR) {
      next.setUTCHours(next.getUTCHours() + 1)
    }
    return next.getTime() - Date.now()
  }

  onApplicationBootstrap(): void {
    if (!this.warehouse.isAvailable) return

    const scheduleNext = () => {
      this.timer = setTimeout(() => {
        void this.runNow().catch((error) => this.log.error(`ETL run failed: ${String(error)}`))
        scheduleNext()
      }, this.msUntilNextRun())
      this.timer.unref?.()
    }
    scheduleNext()

    void this.runNow().catch((error) => this.log.error(`ETL run failed: ${String(error)}`))
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer)
  }

  /**
   * One pass. A second call while one is running joins it instead of
   * starting a parallel rebuild of the same rows.
   */
  runNow(): Promise<{ daysProcessed: number }> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  /**
   * Rewrites the reserve snapshots from `fromDateInt` and rebuilds every
   * order fact. For "the numbers for those days were wrong, recompute them".
   */
  async recomputeFrom(fromDateInt: number): Promise<{ daysProcessed: number }> {
    await this.warehouse.etlCheckpoint.upsert({
      where: { id: 1 },
      create: { id: 1, lastFinalizedDate: addDays(fromDateInt, -1), factVersion: null },
      update: { lastFinalizedDate: addDays(fromDateInt, -1), factVersion: null },
    })
    return this.runNow()
  }

  private async run(): Promise<{ daysProcessed: number }> {
    if (!this.warehouse.isAvailable) {
      this.log.warn('ETL run skipped, the analytics warehouse is not available.')
      return { daysProcessed: 0 }
    }

    const checkpoint = await this.warehouse.etlCheckpoint.findUnique({ where: { id: 1 } })
    const today = toDateInt(new Date())

    await this.ingestBronzeUsers(today)
    await this.refreshSilverAgentDim()
    await this.refreshSilverApplications()
    await this.ingestBronzeBeneficiaryRequests(today)
    await this.refreshSilverBeneficiaryFacts()

    const fullRebuild = checkpoint?.factVersion !== EtlService.FACT_VERSION
    const since = fullRebuild ? null : new Date(Date.now() - EtlService.RECENT_DAYS * 86_400_000)
    const orders = await this.refreshFactOrders(since)
    await this.refreshFactWithdrawals()

    let startDate = checkpoint?.lastFinalizedDate ? addDays(checkpoint.lastFinalizedDate, 1) : null
    if (startDate === null) {
      const earliest = await this.prisma.order.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } })
      startDate = earliest ? toDateInt(earliest.createdAt) : today
    }
    const dates: number[] = []
    for (let d = startDate; d <= today; d = addDays(d, 1)) dates.push(d)
    for (const dateInt of dates) {
      await this.computeHistoricalSolvency(dateInt, dayBounds(dateInt).end)
      if (dateInt < today) {
        await this.warehouse.etlCheckpoint.upsert({
          where: { id: 1 },
          create: { id: 1, lastFinalizedDate: dateInt },
          update: { lastFinalizedDate: dateInt },
        })
      }
    }

    await this.computeFloatSnapshots(today)

    await this.warehouse.etlCheckpoint.upsert({
      where: { id: 1 },
      create: { id: 1, factVersion: EtlService.FACT_VERSION, lastRunAt: new Date() },
      update: { factVersion: EtlService.FACT_VERSION, lastRunAt: new Date() },
    })

    this.log.log(
      `ETL: ${orders} order fact(s) ${fullRebuild ? 'rebuilt from scratch' : 'refreshed'}, ${dates.length} reserve day(s)`,
    )
    return { daysProcessed: dates.length }
  }

  // ─── Facts ────────────────────────────────────────────────────────────────

  /**
   * Rebuilds `FactOrder` for every order placed on or after `since` (all
   * orders when null). Computed fully in memory first, then swapped in with
   * one transaction, so the page never reads a half-written range.
   */
  private async refreshFactOrders(since: Date | null): Promise<number> {
    const agents = await this.warehouse.silverAgentDim.findMany({ select: { agentId: true, referralCode: true } })
    const agentIdByCode = new Map(agents.map((a) => [a.referralCode, a.agentId]))
    const skus = await this.prisma.supplierProduct.findMany({ select: { code: true, provider: true } })
    const providerBySku = new Map(skus.map((s) => [s.code, s.provider]))

    const rows: Prisma.FactOrderCreateManyInput[] = []
    let cursor: { createdAt: Date; id: string } | null = null

    for (;;) {
      const page = await this.orderPage(since, cursor)
      if (page.length === 0) break
      cursor = { createdAt: page[page.length - 1].createdAt, id: page[page.length - 1].id }

      // Paystack's fee is booked against the payment, whose reference is the order's own.
      const fees = await this.prisma.ledgerEntry.findMany({
        where: { kind: 'payment_fee', paymentRef: { in: page.map((o) => o.reference) }, orderRef: null },
        select: { paymentRef: true, amount: true, affectsProfit: true },
      })
      const feeByRef = new Map<string, { amount: number; profit: number }>()
      for (const f of fees) {
        const ref = f.paymentRef as string
        const current = feeByRef.get(ref) ?? { amount: 0, profit: 0 }
        current.amount += f.amount
        if (f.affectsProfit) current.profit += f.amount
        feeByRef.set(ref, current)
      }

      for (const o of page) {
        const isPaid = o.paidWith === 'wallet' ? o.status !== 'awaiting_payment' : o.payment?.status === 'paid'
        const sum = (kinds: string[]) =>
          o.ledgerEntries.filter((e) => kinds.includes(e.kind)).reduce((total, e) => total + e.amount, 0)
        const fee = feeByRef.get(o.reference) ?? { amount: 0, profit: 0 }
        const orderProfit = o.ledgerEntries.filter((e) => e.affectsProfit).reduce((total, e) => total + e.amount, 0)

        const lastDispatch = o.dispatches[o.dispatches.length - 1]
        const stampedCost = o.ledgerEntries.find((e) => e.kind === 'supplier_cost' && e.provider)
        const provider =
          stampedCost?.provider ??
          lastDispatch?.supplier.provider ??
          (o.dispatches.length > 0 && o.supplierCodeAtSale ? (providerBySku.get(o.supplierCodeAtSale) ?? null) : null)

        const isFailedAfterPay = isPaid && o.status === 'failed'
        const refund = o.refundRequest
        const refundSettledAt =
          refund?.status === 'approved' ? (refund.method === 'wallet' ? refund.decidedAt : refund.paidAt) : null
        /**
         * Only a settled order's money counts. Revenue is booked the moment
         * Paystack confirms payment, so an order still being delivered, or a
         * failed one whose refund isn't paid yet, already shows its full
         * sale as profit: money that may still go to the supplier or back to
         * the customer. Counting it read as more profit than the business
         * had, next to a lower "free to spend". It counts once delivered, or
         * once its refund is paid or refused.
         */
        const settled =
          o.status === 'completed' ||
          (o.status === 'failed' && (!refund || refund.status === 'rejected' || refundSettledAt !== null))
        const money = (amount: number) => (settled ? amount : 0)

        rows.push({
          orderId: o.id,
          reference: o.reference,
          dateKey: toDateInt(o.createdAt),
          createdAt: o.createdAt,
          hour: o.createdAt.getUTCHours(),
          weekday: weekdayOf(o.createdAt),
          status: o.status,
          paidWith: o.paidWith,
          isPaid,
          isCompleted: o.status === 'completed',
          isFailedAfterPay,
          network: o.network ?? 'UNKNOWN',
          category: o.category,
          productId: o.productId,
          productName: o.productName,
          provider,
          channel: o.soldByCode ? 'agent' : 'direct',
          agentId: o.soldByCode ? (agentIdByCode.get(o.soldByCode) ?? o.soldByCode) : null,
          agentCode: o.soldByCode,
          agentName: o.soldByAgentName ?? o.soldByCode,
          buyerPhone: o.buyerPhone,
          buyerUserId: o.buyerUserId,
          salePrice: o.salePrice,
          revenue: money(sum(['revenue'])),
          supplierCost: money(-sum(['supplier_cost'])),
          paystackFee: money(-(fee.amount + sum(['payment_fee']))),
          agentMargin: money(-sum(['agent_margin', 'referral_bonus'])),
          adjustments: money(
            o.ledgerEntries
              .filter((e) => e.affectsProfit && ['refund', 'agent_margin_writeoff', 'overpayment'].includes(e.kind))
              .reduce((total, e) => total + e.amount, 0),
          ),
          profit: money(orderProfit + fee.profit),
          paidAt: o.paidWith === 'wallet' ? (isPaid ? o.createdAt : null) : (o.payment?.paidAt ?? null),
          firstSentAt: o.dispatches[0]?.createdAt ?? null,
          completedAt: o.completedAt,
          attempts: o.dispatches.length,
          failureReason: isFailedAfterPay
            ? (normaliseReason(refund?.reason) ?? normaliseReason(lastDispatch?.reason) ?? 'Not recorded')
            : null,
          refundAmount: refund?.amount ?? null,
          refundStatus: refund?.status ?? null,
          refundCreatedAt: refund?.createdAt ?? null,
          refundSettledAt: refundSettledAt ?? null,
        })
      }
    }

    const chunks: Prisma.FactOrderCreateManyInput[][] = []
    for (let i = 0; i < rows.length; i += 1000) chunks.push(rows.slice(i, i + 1000))
    await this.warehouse.$transaction([
      this.warehouse.factOrder.deleteMany({ where: since ? { createdAt: { gte: since } } : {} }),
      ...chunks.map((data) => this.warehouse.factOrder.createMany({ data })),
    ])
    return rows.length
  }

  /** One page of orders placed on or after `since`, after `cursor`, with everything a fact needs. */
  private orderPage(since: Date | null, cursor: { createdAt: Date; id: string } | null) {
    return this.prisma.order.findMany({
      where: {
        ...(since ? { createdAt: { gte: since } } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: LEDGER_PAGE,
      select: {
        id: true,
        reference: true,
        createdAt: true,
        completedAt: true,
        status: true,
        paidWith: true,
        network: true,
        category: true,
        productId: true,
        productName: true,
        supplierCodeAtSale: true,
        soldByCode: true,
        soldByAgentName: true,
        buyerPhone: true,
        buyerUserId: true,
        salePrice: true,
        payment: { select: { status: true, paidAt: true } },
        dispatches: {
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true, outcome: true, reason: true, supplier: { select: { provider: true } } },
        },
        refundRequest: {
          select: { amount: true, status: true, reason: true, method: true, createdAt: true, decidedAt: true, paidAt: true },
        },
        ledgerEntries: { select: { kind: true, amount: true, affectsProfit: true, provider: true } },
      },
    })
  }

  /** Every payout, small enough to rebuild whole each run. */
  private async refreshFactWithdrawals(): Promise<void> {
    const withdrawals = await this.prisma.withdrawal.findMany({
      select: {
        id: true,
        userId: true,
        agentName: true,
        amount: true,
        transferFee: true,
        status: true,
        resolvedManually: true,
        requestedAt: true,
        decidedAt: true,
        paidAt: true,
      },
    })
    await this.warehouse.$transaction([
      this.warehouse.factWithdrawal.deleteMany({}),
      this.warehouse.factWithdrawal.createMany({
        data: withdrawals.map((w) => ({
          withdrawalId: w.id,
          dateKey: toDateInt(w.requestedAt),
          agentId: w.userId,
          agentName: w.agentName,
          amount: w.amount,
          fee: w.transferFee,
          status: w.status,
          manual: w.resolvedManually,
          requestedAt: w.requestedAt,
          decidedAt: w.decidedAt,
          paidAt: w.paidAt,
        })),
      }),
    ])
  }

  // ─── Current-state copies ─────────────────────────────────────────────────

  /**
   * Every user with a referral code, not only agents: an admin account can
   * sell on its own code too, and orders sold on it must still resolve.
   */
  private async ingestBronzeUsers(today: number): Promise<void> {
    const users = await this.prisma.user.findMany({
      select: { id: true, role: true, status: true, referralCode: true, uplineCode: true, name: true, joinedAt: true, decidedAt: true },
    })
    for (const u of users) {
      const data = {
        snapshotDateKey: today,
        role: u.role,
        status: u.status,
        referralCode: u.referralCode,
        uplineCode: u.uplineCode,
        name: u.name,
        decidedAt: u.decidedAt,
      }
      await this.warehouse.bronzeUser.upsert({
        where: { id: u.id },
        create: { id: u.id, joinedAt: u.joinedAt, ...data },
        update: data,
      })
    }
  }

  private async refreshSilverAgentDim(): Promise<void> {
    const users = await this.warehouse.bronzeUser.findMany()
    const uplineByCode = new Map(users.filter((u) => u.role === 'agent').map((u) => [u.referralCode, u.uplineCode]))

    const depthOf = (code: string): number => {
      let depth = 0
      let upline = uplineByCode.get(code) ?? null
      const seen = new Set<string>()
      while (upline && uplineByCode.has(upline) && !seen.has(upline) && depth <= 50) {
        seen.add(upline)
        depth++
        upline = uplineByCode.get(upline) ?? null
      }
      return depth
    }

    for (const u of users) {
      const data = {
        referralCode: u.referralCode,
        name: u.name ?? u.referralCode,
        role: u.role,
        status: u.status,
        uplineCode: u.uplineCode,
        depth: depthOf(u.referralCode),
        snapshotDateKey: u.snapshotDateKey,
      }
      await this.warehouse.silverAgentDim.upsert({
        where: { agentId: u.id },
        create: { agentId: u.id, joinedAt: u.joinedAt, joinedDateKey: toDateInt(u.joinedAt), ...data },
        update: data,
      })
    }
  }

  private async refreshSilverApplications(): Promise<void> {
    const agents = await this.warehouse.bronzeUser.findMany({ where: { role: 'agent' } })
    for (const u of agents) {
      // Suspended happened after an approval, not instead of one.
      const outcome = u.status === 'pending' ? 'pending' : u.status === 'rejected' ? 'rejected' : 'approved'
      const data = {
        decidedDateKey: u.decidedAt ? toDateInt(u.decidedAt) : null,
        outcome,
        hoursToDecide: u.decidedAt ? hoursBetween(u.joinedAt, u.decidedAt) : null,
      }
      await this.warehouse.silverApplicationFact.upsert({
        where: { userId: u.id },
        create: { userId: u.id, appliedDateKey: toDateInt(u.joinedAt), ...data },
        update: data,
      })
    }
  }

  private async ingestBronzeBeneficiaryRequests(today: number): Promise<void> {
    const rows = await this.prisma.beneficiaryRequest.findMany({
      select: { phone: true, provider: true, networkKey: true, attempts: true, lastProduct: true, lastValue: true, firstSeenAt: true, approvedAt: true },
    })
    for (const r of rows) {
      const data = {
        snapshotDateKey: today,
        attempts: r.attempts,
        lastProduct: r.lastProduct,
        lastValue: r.lastValue,
        approvedAt: r.approvedAt,
      }
      await this.warehouse.bronzeBeneficiaryRequest.upsert({
        where: { phone_provider: { phone: r.phone, provider: r.provider } },
        create: { phone: r.phone, provider: r.provider, networkKey: r.networkKey, firstSeenAt: r.firstSeenAt, ...data },
        update: data,
      })
    }
  }

  private async refreshSilverBeneficiaryFacts(): Promise<void> {
    const rows = await this.warehouse.bronzeBeneficiaryRequest.findMany()
    for (const r of rows) {
      const data = {
        networkKey: r.networkKey,
        attempts: r.attempts,
        lastValue: r.lastValue,
        resolved: r.approvedAt !== null,
        resolvedDateKey: r.approvedAt ? toDateInt(r.approvedAt) : null,
        hoursToResolve: r.approvedAt ? hoursBetween(r.firstSeenAt, r.approvedAt) : null,
      }
      await this.warehouse.silverBeneficiaryFact.upsert({
        where: { phone_provider: { phone: r.phone, provider: r.provider } },
        create: { phone: r.phone, provider: r.provider, dateKey: toDateInt(r.firstSeenAt), ...data },
        update: data,
      })
    }
  }

  // ─── Snapshots ────────────────────────────────────────────────────────────

  /**
   * Each provider's float for today. A reading only exists for the moment a
   * provider reported one, so this cannot be rebuilt for a past day, it can
   * only be captured as days go by.
   */
  private async computeFloatSnapshots(today: number): Promise<void> {
    for (const provider of KNOWN_PROVIDERS) {
      const [float, expected] = await Promise.all([
        this.floatMonitor.latest(provider),
        this.floatMonitor.expectedBalance(provider),
      ])
      if (!float) continue
      const row = {
        balance: float.balance,
        reference: float.reference,
        expected: expected?.balance ?? null,
        level: float.level,
        observedAt: new Date(float.observedAt),
      }
      await this.warehouse.dailyFloatSnapshot.upsert({
        where: { date_provider: { date: today, provider } },
        create: { date: today, provider, ...row },
        update: row,
      })
      if (provider === 'datahub-gh') {
        await this.warehouse.dailySolvencySnapshot.updateMany({ where: { date: today }, data: { floatBalance: float.balance } })
      }
    }
  }

  /**
   * `SolvencyService.position()`'s arithmetic as of the end of one day,
   * entirely from timestamped production history, so any past day can be
   * rebuilt. Where that service reads a running balance with no date, this
   * sums the history it is derived from instead.
   *
   * One approximation: `ClaimableCredit` has no `claimedAt`, so a credit
   * claimed by now reads as claimed on every past day too. That slightly
   * understates history, never overstates it, and the table is tiny.
   */
  private async computeHistoricalSolvency(dateInt: number, end: Date): Promise<void> {
    const [
      earningsAsOf,
      walletAsOf,
      unclaimedCredits,
      withdrawalsUpTo,
      heldOrders,
      refundsUpTo,
      manualAdvances,
      manualReimbursements,
      collected,
      transferredPayouts,
      transferredRefunds,
      reimbursements,
    ] = await Promise.all([
      this.prisma.earning.aggregate({ where: { createdAt: { lt: end } }, _sum: { amount: true } }),
      this.prisma.transaction.aggregate({ where: { createdAt: { lt: end } }, _sum: { amount: true } }),
      this.prisma.claimableCredit.aggregate({ where: { claimed: false, createdAt: { lt: end } }, _sum: { amount: true } }),
      this.prisma.withdrawal.findMany({
        where: { requestedAt: { lt: end } },
        select: { amount: true, status: true, decidedAt: true, paidAt: true },
      }),
      // Paid by `end` and neither delivered nor failed (refund raised) by `end`.
      this.prisma.order.aggregate({
        where: {
          OR: [
            { paidWith: 'momo', payment: { is: { status: 'paid', paidAt: { lt: end } } } },
            { paidWith: 'wallet', createdAt: { lt: end } },
          ],
          AND: [
            { OR: [{ completedAt: null }, { completedAt: { gte: end } }] },
            { OR: [{ refundRequest: { is: null } }, { refundRequest: { is: { createdAt: { gte: end } } } }] },
          ],
        },
        _sum: { salePrice: true },
      }),
      this.prisma.refundRequest.findMany({
        where: { createdAt: { lt: end } },
        select: { amount: true, method: true, status: true, decidedAt: true, paidAt: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { kind: 'capital_in', occurredAt: { lt: end }, OR: [{ orderRef: { not: null } }, { withdrawalId: { not: null } }] },
        select: { orderRef: true, withdrawalId: true, amount: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { kind: 'capital_out', occurredAt: { lt: end }, OR: [{ orderRef: { not: null } }, { withdrawalId: { not: null } }] },
        select: { orderRef: true, withdrawalId: true, amount: true },
      }),
      this.prisma.payment.aggregate({ where: { status: 'paid', paidAt: { lt: end } }, _sum: { amount: true, fee: true } }),
      this.prisma.withdrawal.aggregate({
        where: { paidAt: { lt: end }, transferCode: { not: null } },
        _sum: { amount: true, transferFee: true },
      }),
      this.prisma.refundRequest.aggregate({
        where: { method: 'transfer', paidAt: { lt: end }, transferCode: { not: null } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { kind: { in: ['capital_in_reimbursement', 'capital_out'] }, occurredAt: { lt: end } },
        select: { id: true, kind: true, amount: true, idempotencyKey: true, provider: true },
      }),
    ])

    const queuedPayouts = withdrawalsUpTo
      .filter((w) => {
        if (w.paidAt && w.paidAt < end) return false
        if ((w.status === 'rejected' || w.status === 'failed') && w.decidedAt && w.decidedAt < end) return false
        return true
      })
      .reduce((sum, w) => sum + w.amount, 0)

    const owedForRefunds = refundsUpTo
      .filter((r) => {
        if (r.status === 'rejected' && r.decidedAt && r.decidedAt < end) return false
        if (r.method === 'wallet' && r.status === 'approved' && r.decidedAt && r.decidedAt < end) return false
        if (r.method === 'transfer' && r.paidAt && r.paidAt < end) return false
        return true
      })
      .reduce((sum, r) => sum + r.amount, 0)

    const reimbursedOrderRefs = new Set(manualReimbursements.filter((r) => r.orderRef).map((r) => r.orderRef as string))
    const reimbursedWithdrawalIds = new Set(
      manualReimbursements.filter((r) => r.withdrawalId).map((r) => r.withdrawalId as string),
    )
    const manualRefundAdvances = manualAdvances
      .filter((a) => a.orderRef && !reimbursedOrderRefs.has(a.orderRef))
      .reduce((sum, a) => sum + a.amount, 0)
    const manualPayoutAdvances = manualAdvances
      .filter((a) => a.withdrawalId && !reimbursedWithdrawalIds.has(a.withdrawalId))
      .reduce((sum, a) => sum + a.amount, 0)

    const reversedIds = new Set(
      reimbursements
        .filter((r) => r.kind === 'capital_out' && r.idempotencyKey.startsWith('correction:'))
        .map((r) => r.idempotencyKey.split(':')[1]),
    )
    const liveReimbursements = reimbursements.filter(
      (r) => r.kind === 'capital_in_reimbursement' && !reversedIds.has(r.id),
    )
    const reimbursedAcrossProviders = liveReimbursements.reduce((sum, r) => sum + r.amount, 0)

    // Per provider, then added, as the live Reserve panel does: one float's
    // over-reimbursement must not cancel the other's real spend.
    const costRows = await this.prisma.ledgerEntry.findMany({
      where: { kind: 'supplier_cost', occurredAt: { lt: end } },
      select: { amount: true, provider: true, order: { select: { supplierCodeAtSale: true } } },
    })
    const skuCodes = [...new Set(costRows.map((r) => r.order?.supplierCodeAtSale).filter((c): c is string => Boolean(c)))]
    const skuProviders = await this.prisma.supplierProduct.findMany({
      where: { code: { in: skuCodes } },
      select: { code: true, provider: true },
    })
    const providerByCode = new Map(skuProviders.map((s) => [s.code, s.provider]))
    const costByProvider = new Map<string, number>()
    for (const row of costRows) {
      const code = row.order?.supplierCodeAtSale
      const provider = row.provider ?? (code ? (providerByCode.get(code) ?? 'datahub-gh') : 'datahub-gh')
      costByProvider.set(provider, (costByProvider.get(provider) ?? 0) - row.amount)
    }
    const reimbursedByProvider = new Map<string, number>()
    for (const r of liveReimbursements) {
      const provider = r.provider ?? 'datahub-gh'
      reimbursedByProvider.set(provider, (reimbursedByProvider.get(provider) ?? 0) + r.amount)
    }
    const providers = new Set([...costByProvider.keys(), ...reimbursedByProvider.keys()])
    const spentOnBundles = [...providers].reduce(
      (sum, p) => sum + Math.max(0, (costByProvider.get(p) ?? 0) - (reimbursedByProvider.get(p) ?? 0)),
      0,
    )

    const advancesRepaid = -manualReimbursements.reduce((sum, r) => sum + r.amount, 0)

    const expectedAtPaystack =
      (collected._sum.amount ?? 0) -
      (collected._sum.fee ?? 0) -
      (transferredPayouts._sum.amount ?? 0) -
      (transferredPayouts._sum.transferFee ?? 0) -
      (transferredRefunds._sum.amount ?? 0) -
      transferredRefunds._count._all * (await this.settings.get('payoutTransferFee')) -
      reimbursedAcrossProviders -
      advancesRepaid

    const owedToAgents = earningsAsOf._sum.amount ?? 0
    const owedToCustomers = (walletAsOf._sum.amount ?? 0) + (unclaimedCredits._sum.amount ?? 0) + owedForRefunds
    const undeliveredOrders = heldOrders._sum.salePrice ?? 0
    const liabilitiesTotal =
      owedToAgents + owedToCustomers + undeliveredOrders + queuedPayouts + manualRefundAdvances + manualPayoutAdvances

    const row = {
      expectedAtPaystack,
      spentOnBundles,
      freeToSpend: expectedAtPaystack - liabilitiesTotal - spentOnBundles,
      owedToAgents,
      owedToCustomers,
      undeliveredOrders,
      queuedPayouts,
      manualRefundAdvances,
      manualPayoutAdvances,
      liabilitiesTotal,
    }
    await this.warehouse.dailySolvencySnapshot.upsert({
      where: { date: dateInt },
      create: { date: dateInt, ...row, floatBalance: null },
      update: row,
    })
  }
}
