import { Injectable } from '@nestjs/common'
import type { FactOrder } from '@prisma-analytics/client'
import { LedgerService } from '../finance/ledger.service'
import { SolvencyService } from '../finance/solvency.service'
import { FloatMonitorService } from '../supplier/float-monitor.service'
import { KNOWN_PROVIDERS } from '../settings/settings.service'
import { AnalyticsPrismaService } from './analytics-prisma.service'
import { addDays, dateIntToDate, toDateInt } from './date'

export type Granularity = 'day' | 'week' | 'month'

/** A headline figure and the same figure for the period just before. */
export interface Compared {
  value: number
  previous: number
}

export interface AttentionItem {
  level: 'danger' | 'warning' | 'info'
  title: string
  detail: string
  /** An admin route that fixes it. */
  link: string
}

interface MoneyCut {
  key: string
  orders: number
  revenue: number
  profit: number
  previousProfit: number
}

const IN_FLIGHT = ['pending', 'processing', 'awaiting_approval']

function sumBy<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0)
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}

function seconds(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null
  const s = (to.getTime() - from.getTime()) / 1000
  return s >= 0 ? s : null
}

function daysInclusive(from: number, to: number): number {
  return Math.round((dateIntToDate(to).getTime() - dateIntToDate(from).getTime()) / 86_400_000) + 1
}

/** The bucket a day falls in: itself, its week's Monday, or its month's 1st. */
function bucketOf(dateInt: number, granularity: Granularity): number {
  if (granularity === 'day') return dateInt
  if (granularity === 'month') return Math.floor(dateInt / 100) * 100 + 1
  const date = dateIntToDate(dateInt)
  return addDays(dateInt, -((date.getUTCDay() + 6) % 7))
}

function bucketsBetween(from: number, to: number, granularity: Granularity): number[] {
  const buckets: number[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const b = bucketOf(d, granularity)
    if (buckets[buckets.length - 1] !== b) buckets.push(b)
  }
  return buckets
}

const ghs = (pesewas: number) => `GHS ${(pesewas / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** 'under an hour', '5 hours', '14 days'. */
const waited = (hours: number) =>
  hours < 1 ? 'under an hour' : hours < 48 ? `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}` : `${Math.round(hours / 24)} days`
const providerName = (p: string | null) => (p === 'gmpl' ? 'GMPL' : p === 'datahub-gh' ? 'DataHub' : 'Not sent')

/**
 * Everything the /analytics page shows, for one date range, in one call.
 *
 * Aggregated on read from `FactOrder`/`FactWithdrawal` rather than from
 * pre-computed daily totals, so every figure for any range, and the same
 * figure for the period before it, comes from the same rows and agrees with
 * every other figure on the page. The few things that only exist "now" (the
 * Reserve position, each float) are read live, the same calls the Finance
 * screen makes, so the two screens can never disagree.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly warehouse: AnalyticsPrismaService,
    private readonly solvency: SolvencyService,
    private readonly floats: FloatMonitorService,
    private readonly ledger: LedgerService,
  ) {}

  async insights(from: number, to: number) {
    const span = daysInclusive(from, to)
    const prevTo = addDays(from, -1)
    const prevFrom = addDays(from, -span)
    const granularity: Granularity = span <= 45 ? 'day' : span <= 180 ? 'week' : 'month'
    const today = toDateInt(new Date())

    const [all, checkpoint, withdrawals, applications, agentsDim, blocked, solvencyHistory, floatHistory, firstOrders] =
      await Promise.all([
        this.warehouse.factOrder.findMany({ where: { dateKey: { gte: Math.min(prevFrom, addDays(today, -8)), lte: Math.max(to, today) } } }),
        this.warehouse.etlCheckpoint.findUnique({ where: { id: 1 } }),
        this.warehouse.factWithdrawal.findMany(),
        this.warehouse.silverApplicationFact.findMany(),
        this.warehouse.silverAgentDim.findMany({ select: { agentId: true, name: true, status: true, role: true, joinedDateKey: true } }),
        this.warehouse.silverBeneficiaryFact.findMany(),
        this.warehouse.dailySolvencySnapshot.findMany({ where: { date: { gte: from, lte: to } }, orderBy: { date: 'asc' } }),
        this.warehouse.dailyFloatSnapshot.findMany({ where: { date: { gte: from, lte: to } }, orderBy: { date: 'asc' } }),
        // Each paying buyer's first-ever paid order, to tell new from returning.
        this.warehouse.factOrder.groupBy({ by: ['buyerPhone'], where: { isPaid: true }, _min: { dateKey: true } }),
      ])
    // In-flight and owed-now figures look at every order, not just this range.
    const openOrders = await this.warehouse.factOrder.findMany({
      where: {
        OR: [
          { isPaid: true, status: { in: IN_FLIGHT } },
          { isFailedAfterPay: true, refundSettledAt: null, NOT: { refundStatus: 'rejected' } },
        ],
      },
    })

    const inRange = (o: { dateKey: number }) => o.dateKey >= from && o.dateKey <= to
    const inPrev = (o: { dateKey: number }) => o.dateKey >= prevFrom && o.dateKey <= prevTo
    const cur = all.filter(inRange)
    const prev = all.filter(inPrev)
    const firstPaidDay = new Map(firstOrders.map((r) => [r.buyerPhone, r._min.dateKey ?? 0]))

    const now = new Date()
    const [position, earnedProfit, floatStates] = await Promise.all([
      this.solvency.position(),
      this.ledger.earnedProfit(),
      Promise.all(
        KNOWN_PROVIDERS.map(async (provider) => {
          const [latest, expected, capital] = await Promise.all([
            this.floats.latest(provider),
            this.floats.expectedBalance(provider),
            this.floats.capitalSummary(provider),
          ])
          return { provider, latest, expected, overReimbursed: capital.overReimbursed }
        }),
      ),
    ])

    const money = this.money(cur, prev, from, to, granularity)
    const sales = this.sales(cur, prev, from, to, granularity, firstPaidDay)
    const operations = this.operations(cur, prev, from, to, granularity, openOrders, blocked, now)
    const agents = this.agents(cur, prev, from, to, prevFrom, prevTo, granularity, withdrawals, applications, agentsDim, now)
    const cash = this.cash(all, today, position, earnedProfit, floatStates, solvencyHistory, floatHistory)

    const summary = {
      revenue: { value: money.totals.revenue, previous: money.previousTotals.revenue },
      profit: { value: money.totals.profit, previous: money.previousTotals.profit },
      marginPct: {
        value: ratio(money.totals.profit, money.totals.revenue) * 100,
        previous: ratio(money.previousTotals.profit, money.previousTotals.revenue) * 100,
      },
      delivered: { value: cur.filter((o) => o.isCompleted).length, previous: prev.filter((o) => o.isCompleted).length },
      buyers: sales.kpis.buyers,
      avgOrderValue: sales.kpis.avgOrderValue,
      successRate: operations.kpis.successRate,
      conversion: sales.kpis.conversion,
    }

    return {
      meta: {
        from,
        to,
        previousFrom: prevFrom,
        previousTo: prevTo,
        granularity,
        dataAsOf: checkpoint?.lastRunAt?.toISOString() ?? null,
      },
      summary,
      attention: this.attention({ cash, operations, money, agents }),
      money,
      sales,
      operations,
      agents,
      cash,
    }
  }

  // ─── Money ────────────────────────────────────────────────────────────────

  private money(cur: FactOrder[], prev: FactOrder[], from: number, to: number, granularity: Granularity) {
    const totals = (rows: FactOrder[]) => ({
      revenue: sumBy(rows, (o) => o.revenue),
      supplierCost: sumBy(rows, (o) => o.supplierCost),
      paystackFee: sumBy(rows, (o) => o.paystackFee),
      agentMargin: sumBy(rows, (o) => o.agentMargin),
      adjustments: sumBy(rows, (o) => o.adjustments),
      profit: sumBy(rows, (o) => o.profit),
    })

    const series = bucketsBetween(from, to, granularity).map((bucket) => {
      const rows = cur.filter((o) => bucketOf(o.dateKey, granularity) === bucket)
      return { bucket, ...totals(rows) }
    })

    const cut = (key: (o: FactOrder) => string): MoneyCut[] => {
      const groups = new Map<string, MoneyCut>()
      const touch = (k: string) => {
        let g = groups.get(k)
        if (!g) {
          g = { key: k, orders: 0, revenue: 0, profit: 0, previousProfit: 0 }
          groups.set(k, g)
        }
        return g
      }
      for (const o of cur) {
        if (!o.isPaid) continue
        const g = touch(key(o))
        if (o.isCompleted) g.orders++
        g.revenue += o.revenue
        g.profit += o.profit
      }
      for (const o of prev) {
        if (!o.isPaid) continue
        touch(key(o)).previousProfit += o.profit
      }
      return [...groups.values()].sort((a, b) => b.profit - a.profit)
    }

    const productMap = new Map<string, { productId: string; name: string; network: string; orders: number; revenue: number; profit: number; cost: number }>()
    for (const o of cur) {
      if (!o.isCompleted) continue
      const p = productMap.get(o.productId) ?? {
        productId: o.productId,
        name: o.productName,
        network: o.network,
        orders: 0,
        revenue: 0,
        profit: 0,
        cost: 0,
      }
      p.orders++
      p.revenue += o.revenue
      p.profit += o.profit
      p.cost += o.supplierCost
      productMap.set(o.productId, p)
    }
    const products = [...productMap.values()]
      .map((p) => ({ ...p, marginPct: ratio(p.profit, p.revenue) * 100 }))
      .sort((a, b) => b.profit - a.profit)

    return {
      totals: totals(cur),
      previousTotals: totals(prev),
      series,
      byNetwork: cut((o) => o.network),
      byCategory: cut((o) => o.category),
      byProvider: cut((o) => o.provider ?? 'none').filter((c) => c.key !== 'none'),
      byChannel: cut((o) => o.channel),
      topProducts: products.slice(0, 10),
      thinProducts: products.filter((p) => p.marginPct < 3).sort((a, b) => a.marginPct - b.marginPct).slice(0, 10),
    }
  }

  // ─── Sales ────────────────────────────────────────────────────────────────

  private sales(
    cur: FactOrder[],
    prev: FactOrder[],
    from: number,
    to: number,
    granularity: Granularity,
    firstPaidDay: Map<string, number>,
  ) {
    const kpi = (rows: FactOrder[]) => {
      const paid = rows.filter((o) => o.isPaid)
      const delivered = rows.filter((o) => o.isCompleted)
      return {
        placed: rows.length,
        paid: paid.length,
        buyers: new Set(paid.map((o) => o.buyerPhone)).size,
        avgOrderValue: delivered.length > 0 ? sumBy(delivered, (o) => o.revenue) / delivered.length : 0,
        conversion: ratio(paid.length, rows.length) * 100,
      }
    }
    const c = kpi(cur)
    const p = kpi(prev)

    const series = bucketsBetween(from, to, granularity).map((bucket) => {
      const rows = cur.filter((o) => bucketOf(o.dateKey, granularity) === bucket)
      const paid = rows.filter((o) => o.isPaid)
      const buyers = new Set(paid.map((o) => o.buyerPhone))
      let newBuyers = 0
      for (const phone of buyers) {
        const first = firstPaidDay.get(phone) ?? 0
        if (bucketOf(first, granularity) === bucket) newBuyers++
      }
      return {
        bucket,
        placed: rows.length,
        paid: paid.length,
        delivered: rows.filter((o) => o.isCompleted).length,
        buyers: buyers.size,
        newBuyers,
      }
    })

    const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
    for (const o of cur) if (o.isPaid) heatmap[o.weekday][o.hour]++

    const paidCur = cur.filter((o) => o.isPaid)
    const buyerPhones = new Set(paidCur.map((o) => o.buyerPhone))
    let newBuyers = 0
    for (const phone of buyerPhones) if ((firstPaidDay.get(phone) ?? 0) >= from) newBuyers++
    const ordersPerBuyer = new Map<string, number>()
    for (const o of paidCur) ordersPerBuyer.set(o.buyerPhone, (ordersPerBuyer.get(o.buyerPhone) ?? 0) + 1)
    const boughtTwice = [...ordersPerBuyer.values()].filter((n) => n >= 2).length

    const networkShare = new Map<string, number>()
    for (const o of paidCur) networkShare.set(o.network, (networkShare.get(o.network) ?? 0) + 1)

    return {
      kpis: {
        placed: { value: c.placed, previous: p.placed },
        paid: { value: c.paid, previous: p.paid },
        buyers: { value: c.buyers, previous: p.buyers },
        avgOrderValue: { value: c.avgOrderValue, previous: p.avgOrderValue },
        conversion: { value: c.conversion, previous: p.conversion },
      },
      series,
      heatmap,
      funnel: {
        placed: cur.length,
        paid: paidCur.length,
        delivered: cur.filter((o) => o.isCompleted).length,
        failedAfterPay: cur.filter((o) => o.isFailedAfterPay).length,
        neverPaid: cur.filter((o) => !o.isPaid).length,
      },
      buyers: {
        total: buyerPhones.size,
        new: newBuyers,
        returning: buyerPhones.size - newBuyers,
        boughtTwiceOrMore: boughtTwice,
      },
      networkShare: [...networkShare.entries()].map(([key, orders]) => ({ key, orders })).sort((a, b) => b.orders - a.orders),
    }
  }

  // ─── Operations ───────────────────────────────────────────────────────────

  private operations(
    cur: FactOrder[],
    prev: FactOrder[],
    from: number,
    to: number,
    granularity: Granularity,
    openOrders: FactOrder[],
    blocked: { dateKey: number; resolvedDateKey: number | null; resolved: boolean; lastValue: number | null; hoursToResolve: number | null }[],
    now: Date,
  ) {
    const rate = (rows: FactOrder[]) => {
      const delivered = rows.filter((o) => o.isCompleted).length
      const failed = rows.filter((o) => o.isFailedAfterPay).length
      return { delivered, failed, rate: ratio(delivered, delivered + failed) * 100 }
    }

    const providers = [...new Set([...cur, ...prev].map((o) => o.provider).filter((p): p is string => Boolean(p)))]
    const speedOf = (rows: FactOrder[]) => {
      const paidToSent = rows.map((o) => seconds(o.paidAt, o.firstSentAt)).filter((s): s is number => s !== null)
      const sentToDelivered = rows
        .filter((o) => o.isCompleted)
        .map((o) => seconds(o.firstSentAt, o.completedAt))
        .filter((s): s is number => s !== null)
      const paidToDelivered = rows
        .filter((o) => o.isCompleted)
        .map((o) => seconds(o.paidAt, o.completedAt))
        .filter((s): s is number => s !== null)
      return {
        orders: paidToDelivered.length,
        paidToSent: { p50: percentile(paidToSent, 50), p90: percentile(paidToSent, 90) },
        sentToDelivered: { p50: percentile(sentToDelivered, 50), p90: percentile(sentToDelivered, 90) },
        paidToDelivered: { p50: percentile(paidToDelivered, 50), p90: percentile(paidToDelivered, 90) },
        within15m: ratio(paidToDelivered.filter((s) => s <= 900).length, paidToDelivered.length) * 100,
      }
    }

    const byProvider = providers.map((provider) => {
      const c = cur.filter((o) => o.provider === provider)
      const p = prev.filter((o) => o.provider === provider)
      const r = rate(c)
      return {
        provider,
        ...r,
        previousRate: rate(p).rate,
        speed: speedOf(c),
        retried: c.filter((o) => o.attempts > 1).length,
      }
    })

    const series = bucketsBetween(from, to, granularity).map((bucket) => {
      const rows = cur.filter((o) => bucketOf(o.dateKey, granularity) === bucket)
      const point: Record<string, number | null> & { bucket: number } = { bucket }
      for (const provider of providers) {
        const pr = rows.filter((o) => o.provider === provider)
        const r = rate(pr)
        point[`${provider}:rate`] = r.delivered + r.failed > 0 ? r.rate : null
        const minutes = speedOf(pr).paidToDelivered.p50
        point[`${provider}:minutes`] = minutes === null ? null : minutes / 60
      }
      return point
    })

    const reasons = new Map<string, { reason: string; count: number; amount: number }>()
    for (const o of cur) {
      if (!o.isFailedAfterPay) continue
      const reason = o.failureReason ?? 'Not recorded'
      const r = reasons.get(reason) ?? { reason, count: 0, amount: 0 }
      r.count++
      r.amount += o.salePrice
      reasons.set(reason, r)
    }

    const refundRows = cur.filter((o) => o.refundAmount !== null)
    const settleHours = refundRows
      .map((o) => seconds(o.refundCreatedAt, o.refundSettledAt))
      .filter((s): s is number => s !== null)
      .map((s) => s / 3600)
    const owed = openOrders.filter((o) => o.isFailedAfterPay)
    const inFlight = openOrders.filter((o) => IN_FLIGHT.includes(o.status))
    const ageMinutes = (o: FactOrder) => (now.getTime() - (o.paidAt ?? o.createdAt).getTime()) / 60_000

    const stillBlocked = blocked.filter((b) => !b.resolved)
    const resolvedInRange = blocked.filter((b) => b.resolvedDateKey !== null && b.resolvedDateKey >= from && b.resolvedDateKey <= to)

    const c = rate(cur)
    return {
      kpis: {
        successRate: { value: c.rate, previous: rate(prev).rate },
        medianMinutes: {
          value: (speedOf(cur).paidToDelivered.p50 ?? 0) / 60,
          previous: (speedOf(prev).paidToDelivered.p50 ?? 0) / 60,
        },
        failedAfterPay: { value: c.failed, previous: rate(prev).failed },
      },
      overall: speedOf(cur),
      byProvider,
      providers,
      series,
      failureReasons: [...reasons.values()].sort((a, b) => b.count - a.count),
      refunds: {
        count: refundRows.length,
        amount: sumBy(refundRows, (o) => o.refundAmount ?? 0),
        medianHoursToSettle: percentile(settleHours, 50),
        waitingNow: {
          count: owed.length,
          amount: sumBy(owed, (o) => o.refundAmount ?? o.salePrice),
          oldestHours: owed.length > 0 ? Math.max(...owed.map((o) => ageMinutes(o) / 60)) : 0,
        },
      },
      inFlight: {
        count: inFlight.length,
        value: sumBy(inFlight, (o) => o.salePrice),
        over60m: inFlight.filter((o) => ageMinutes(o) > 60).length,
        oldestMinutes: inFlight.length > 0 ? Math.max(...inFlight.map(ageMinutes)) : 0,
      },
      blockedNumbers: {
        stillBlocked: stillBlocked.length,
        stillBlockedValue: sumBy(stillBlocked, (b) => b.lastValue ?? 0),
        newInRange: blocked.filter((b) => b.dateKey >= from && b.dateKey <= to).length,
        resolvedInRange: resolvedInRange.length,
        medianHoursToResolve: percentile(
          resolvedInRange.map((b) => b.hoursToResolve).filter((h): h is number => h !== null),
          50,
        ),
      },
    }
  }

  // ─── Agents ───────────────────────────────────────────────────────────────

  private agents(
    cur: FactOrder[],
    prev: FactOrder[],
    from: number,
    to: number,
    prevFrom: number,
    prevTo: number,
    granularity: Granularity,
    withdrawals: { dateKey: number; amount: number; fee: number; status: string; requestedAt: Date; paidAt: Date | null }[],
    applications: { appliedDateKey: number; decidedDateKey: number | null; outcome: string; hoursToDecide: number | null }[],
    dim: { agentId: string; name: string; status: string; role: string; joinedDateKey: number }[],
    now: Date,
  ) {
    const agentRole = new Map(dim.map((d) => [d.agentId, d]))
    // Only real agents: an admin selling on their own code is the business itself.
    const isAgentSale = (o: FactOrder) => o.channel === 'agent' && o.agentId !== null && agentRole.get(o.agentId)?.role !== 'admin' && agentRole.get(o.agentId)?.role !== 'superadmin'

    type Row = {
      agentId: string
      name: string
      status: string
      orders: number
      revenue: number
      profit: number
      earnings: number
      lastSaleAt: string | null
      previousProfit: number
      previousOrders: number
    }
    const rows = new Map<string, Row>()
    const touch = (o: FactOrder) => {
      const id = o.agentId as string
      let r = rows.get(id)
      if (!r) {
        r = {
          agentId: id,
          name: agentRole.get(id)?.name ?? o.agentName ?? id,
          status: agentRole.get(id)?.status ?? 'unknown',
          orders: 0,
          revenue: 0,
          profit: 0,
          earnings: 0,
          lastSaleAt: null,
          previousProfit: 0,
          previousOrders: 0,
        }
        rows.set(id, r)
      }
      return r
    }
    for (const o of cur) {
      if (!o.isCompleted || !isAgentSale(o)) continue
      const r = touch(o)
      r.orders++
      r.revenue += o.revenue
      r.profit += o.profit
      r.earnings += o.agentMargin
      const at = (o.completedAt ?? o.createdAt).toISOString()
      if (!r.lastSaleAt || at > r.lastSaleAt) r.lastSaleAt = at
    }
    for (const o of prev) {
      if (!o.isCompleted || !isAgentSale(o)) continue
      const r = touch(o)
      r.previousProfit += o.profit
      r.previousOrders++
    }
    const all = [...rows.values()]
    const active = all.filter((r) => r.orders > 0)
    const quiet = all
      .filter((r) => r.orders === 0 && r.previousOrders > 0)
      .sort((a, b) => b.previousOrders - a.previousOrders)

    const profitOf = (rs: FactOrder[], agent: boolean) => sumBy(rs.filter((o) => o.isCompleted && isAgentSale(o) === agent), (o) => o.profit)
    const share = (rs: FactOrder[]) => {
      const a = profitOf(rs, true)
      const d = profitOf(rs, false)
      return ratio(a, a + d) * 100
    }

    const series = bucketsBetween(from, to, granularity).map((bucket) => {
      const rs = cur.filter((o) => o.isCompleted && bucketOf(o.dateKey, granularity) === bucket)
      return {
        bucket,
        activeAgents: new Set(rs.filter(isAgentSale).map((o) => o.agentId)).size,
        agentOrders: rs.filter(isAgentSale).length,
        directOrders: rs.filter((o) => !isAgentSale(o)).length,
      }
    })

    const wCur = withdrawals.filter((w) => w.dateKey >= from && w.dateKey <= to)
    const paid = withdrawals.filter((w) => w.paidAt && toDateInt(w.paidAt) >= from && toDateInt(w.paidAt) <= to)
    const waiting = withdrawals.filter((w) => w.status === 'pending' || w.status === 'approved')
    const aCur = applications.filter((a) => a.appliedDateKey >= from && a.appliedDateKey <= to)
    const joined = (lo: number, hi: number) => dim.filter((d) => d.role === 'agent' && d.joinedDateKey >= lo && d.joinedDateKey <= hi).length

    return {
      kpis: {
        activeAgents: { value: active.length, previous: all.filter((r) => r.previousOrders > 0).length },
        profitShare: { value: share(cur), previous: share(prev) },
        agentEarnings: {
          value: sumBy(cur.filter((o) => o.isCompleted && isAgentSale(o)), (o) => o.agentMargin),
          previous: sumBy(prev.filter((o) => o.isCompleted && isAgentSale(o)), (o) => o.agentMargin),
        },
        newAgents: {
          value: joined(from, to),
          previous: joined(prevFrom, prevTo),
        },
      },
      leaderboard: active.sort((a, b) => b.profit - a.profit).slice(0, 15),
      quiet: quiet.slice(0, 10),
      series,
      payouts: {
        requested: { count: wCur.length, amount: sumBy(wCur, (w) => w.amount) },
        paid: { count: paid.length, amount: sumBy(paid, (w) => w.amount), fees: sumBy(paid, (w) => w.fee) },
        medianHoursToPay: percentile(
          paid.map((w) => ((w.paidAt as Date).getTime() - w.requestedAt.getTime()) / 3_600_000),
          50,
        ),
        waitingNow: {
          count: waiting.length,
          amount: sumBy(waiting, (w) => w.amount),
          oldestHours: waiting.length > 0 ? Math.max(...waiting.map((w) => (now.getTime() - w.requestedAt.getTime()) / 3_600_000)) : 0,
        },
      },
      applications: {
        applied: aCur.length,
        // What became of the applications made in this period. Auto-approved
        // agents carry no decision time, so a by-decision-day count missed them.
        approved: aCur.filter((a) => a.outcome === 'approved').length,
        rejected: aCur.filter((a) => a.outcome === 'rejected').length,
        pendingNow: applications.filter((a) => a.outcome === 'pending').length,
        medianHoursToDecide: percentile(
          aCur.map((a) => a.hoursToDecide).filter((h): h is number => h !== null),
          50,
        ),
      },
    }
  }

  // ─── Cash ─────────────────────────────────────────────────────────────────

  private cash(
    recent: FactOrder[],
    today: number,
    position: Awaited<ReturnType<SolvencyService['position']>>,
    earnedProfit: number,
    floatStates: {
      provider: string
      latest: { balance: number; reference: number; level: string; observedAt: string } | null
      expected: { balance: number } | null
      overReimbursed: number
    }[],
    history: { date: number; freeToSpend: number; liabilitiesTotal: number; expectedAtPaystack: number; spentOnBundles: number }[],
    floatHistory: { date: number; provider: string; balance: number; expected: number | null }[],
  ) {
    // The last seven whole days, so today's half-day doesn't drag the average down.
    const weekFrom = addDays(today, -7)
    const weekTo = addDays(today, -1)
    const floats = floatStates.map(({ provider, latest, expected }) => {
      const spent = sumBy(
        recent.filter((o) => o.provider === provider && o.dateKey >= weekFrom && o.dateKey <= weekTo),
        (o) => o.supplierCost,
      )
      const avgDailySpend = spent / 7
      const usable = latest ? latest.reference : (expected?.balance ?? null)
      return {
        provider,
        balance: latest?.balance ?? null,
        expected: expected?.balance ?? null,
        usable,
        level: latest?.level ?? 'unknown',
        observedAt: latest?.observedAt ?? null,
        avgDailySpend,
        daysLeft: usable !== null && avgDailySpend > 0 ? Math.max(0, usable) / avgDailySpend : null,
      }
    })

    /**
     * Why "free to spend" is not the same number as profit earned, so an
     * admin who sees both is told the difference instead of left to guess.
     * Profit is what sales made; free to spend is cash left in Paystack
     * after everything owed. The one large, known difference is profit
     * already moved into a supplier float beyond what that float was owed:
     * still yours, but stock now, not cash. Anything else (Paystack fees on
     * orders that later failed, payout sending fees, rounding) is shown as
     * one remainder rather than guessed at.
     */
    const inFloats = sumBy(floatStates, (f) => f.overReimbursed)
    const bridge = {
      earnedProfit,
      profitInFloats: inFloats,
      other: position.freeToSpend - (earnedProfit - inFloats),
      freeToSpend: position.freeToSpend,
    }

    return {
      bridge,
      now: {
        expectedAtPaystack: position.expectedAtPaystack,
        spentOnBundles: position.spentOnBundles,
        freeToSpend: position.freeToSpend,
        liabilities: position.liabilities,
        pendingRefunds: position.pendingRefunds,
        pendingPayouts: position.pendingPayouts,
      },
      history: history.map((h) => ({
        date: h.date,
        freeToSpend: h.freeToSpend,
        liabilities: h.liabilitiesTotal,
        expectedAtPaystack: h.expectedAtPaystack,
        spentOnBundles: h.spentOnBundles,
      })),
      floats,
      floatHistory: floatHistory.map((f) => ({ date: f.date, provider: f.provider, balance: f.balance, expected: f.expected })),
    }
  }

  // ─── What needs a decision ────────────────────────────────────────────────

  private attention(parts: {
    cash: ReturnType<InsightsService['cash']>
    operations: ReturnType<InsightsService['operations']>
    money: ReturnType<InsightsService['money']>
    agents: ReturnType<InsightsService['agents']>
  }): AttentionItem[] {
    const items: AttentionItem[] = []
    const { cash, operations, money, agents } = parts

    for (const f of cash.floats) {
      if (f.daysLeft !== null && f.daysLeft < 3) {
        items.push({
          level: f.daysLeft < 1 ? 'danger' : 'warning',
          title: `${providerName(f.provider)} float runs out ${f.daysLeft < 1 ? 'within a day' : `in about ${Math.floor(f.daysLeft)} day${Math.floor(f.daysLeft) === 1 ? '' : 's'}`}`,
          detail: `About ${ghs(f.usable ?? 0)} left against ${ghs(f.avgDailySpend)} spent a day this past week. Top it up before it stops orders.`,
          link: '/admin/finance',
        })
      }
    }
    if (cash.now.freeToSpend < 0) {
      items.push({
        level: 'danger',
        title: 'More is owed than the business holds',
        detail: `Free to spend is ${ghs(cash.now.freeToSpend)}. Don't move money out of Paystack until this is back above zero.`,
        link: '/admin/finance',
      })
    }
    if (operations.refunds.waitingNow.count > 0) {
      const hours = operations.refunds.waitingNow.oldestHours
      items.push({
        level: hours > 24 ? 'danger' : 'warning',
        title: `${operations.refunds.waitingNow.count} customer${operations.refunds.waitingNow.count === 1 ? ' is' : 's are'} waiting for a refund`,
        detail: `${ghs(operations.refunds.waitingNow.amount)} in total, the oldest for ${waited(hours)}.`,
        link: '/admin/refunds',
      })
    }
    if (operations.inFlight.over60m > 0) {
      items.push({
        level: 'warning',
        title: `${operations.inFlight.over60m} paid order${operations.inFlight.over60m === 1 ? ' has' : 's have'} waited over an hour`,
        detail: 'Paid for but not delivered yet. Check whether the provider has answered.',
        link: '/admin/needs-attention',
      })
    }
    if (agents.payouts.waitingNow.count > 0) {
      items.push({
        level: agents.payouts.waitingNow.oldestHours > 24 ? 'warning' : 'info',
        title: `${agents.payouts.waitingNow.count} agent payout${agents.payouts.waitingNow.count === 1 ? '' : 's'} waiting`,
        detail: `${ghs(agents.payouts.waitingNow.amount)} requested and not sent yet.`,
        link: '/admin/withdrawals',
      })
    }
    for (const p of operations.byProvider) {
      if (p.delivered + p.failed >= 10 && p.rate < 90) {
        items.push({
          level: 'warning',
          title: `${providerName(p.provider)} delivered only ${Math.round(p.rate)}% of orders`,
          detail: `${p.failed} paid order${p.failed === 1 ? '' : 's'} failed in this period. See the failure reasons under Operations.`,
          link: '/analytics?tab=operations',
        })
      }
    }
    const losing = money.thinProducts.filter((p) => p.profit < 0)
    if (losing.length > 0) {
      items.push({
        level: 'warning',
        title: `${losing.length} product${losing.length === 1 ? ' is' : 's are'} selling at a loss`,
        detail: `${losing.map((p) => p.name).slice(0, 3).join(', ')}${losing.length > 3 ? ' and more' : ''}. Raise the price or stop selling it.`,
        link: '/admin/prices',
      })
    }
    if (operations.blockedNumbers.stillBlocked > 0) {
      items.push({
        level: 'info',
        title: `${operations.blockedNumbers.stillBlocked} number${operations.blockedNumbers.stillBlocked === 1 ? '' : 's'} waiting on provider approval`,
        detail: 'Sales to these numbers are blocked until the provider approves them.',
        link: '/admin/approvals',
      })
    }
    const order = { danger: 0, warning: 1, info: 2 }
    return items.sort((a, b) => order[a.level] - order[b.level])
  }
}
