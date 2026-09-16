import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type AnalyticsAgentHealth,
  type AnalyticsAgentSummary,
  type AnalyticsApplicationFunnel,
  type AnalyticsCategorySummary,
  type AnalyticsCheckoutFunnel,
  type AnalyticsCustomerBehavior,
  type AnalyticsDailySummary,
  type AnalyticsDispatchReliability,
  type AnalyticsDownlineDepth,
  type AnalyticsFeedbackSummary,
  type AnalyticsFloatSnapshot,
  type AnalyticsHourlyVolume,
  type AnalyticsMarginAccuracy,
  type AnalyticsNetworkSummary,
  type AnalyticsPayoutSummary,
  type AnalyticsRange,
  type AnalyticsRefundNetworkSummary,
  type AnalyticsRefundReasonSummary,
  type AnalyticsRefundSummary,
  type AnalyticsSolvencySnapshot,
} from '../../lib/api'
import { useStore } from '../../state/store'
import { cedis, cedisCompact } from '../../lib/format'
import { CATEGORY_META } from '../../components/categories'
import { BarChart, Donut, LineChart } from '../../components/charts'
import { Badge, Button, Card, CardHead, cn, PageHead, Segmented, Spinner, StatTile, TextInput } from '../../components/ui'
import { AlertIcon, CashIcon, ClockIcon, ReceiptIcon, TrendUpIcon, UsersIcon } from '../../components/icons'

/** YYYYMMDD -> "Sep 15", the label every chart and table on this page uses. */
function dayLabel(dateInt: number): string {
  return dateIntToDate(dateInt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function dateIntToDate(dateInt: number): Date {
  const year = Math.floor(dateInt / 10_000)
  const month = Math.floor((dateInt % 10_000) / 100) - 1
  const day = dateInt % 100
  return new Date(Date.UTC(year, month, day))
}

function toDateInt(date: Date): number {
  return date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate()
}

function daysAgo(n: number): number {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return toDateInt(d)
}

type RangeMode = 'recent' | 'day' | 'month' | 'year'

/** A range plus the human label every card subtitle on this page shows. */
interface PickedRange extends AnalyticsRange {
  label: string
}

/**
 * Builds the exact window the picker below describes: a rolling N days, one
 * calendar day, one calendar month, or one calendar year. `dayValue` and
 * `monthValue` are the raw strings native `<input type="date">`/`type="month">`
 * hand back (`YYYY-MM-DD` / `YYYY-MM`), parsed here rather than through `Date`
 * so an all-UTC value never drifts a day from the picker's own local input.
 */
function buildRange(mode: RangeMode, recentDays: number, dayValue: string, monthValue: string, year: number): PickedRange {
  if (mode === 'day') {
    const [y, m, d] = dayValue.split('-').map(Number)
    const dateInt = y * 10_000 + m * 100 + d
    return { from: dateInt, to: dateInt, label: dayLabel(dateInt) }
  }
  if (mode === 'month') {
    const [y, m] = monthValue.split('-').map(Number)
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
    return { from: y * 10_000 + m * 100 + 1, to: y * 10_000 + m * 100 + lastDay, label }
  }
  if (mode === 'year') {
    return { from: year * 10_000 + 101, to: year * 10_000 + 1231, label: String(year) }
  }
  return { from: daysAgo(recentDays), to: toDateInt(new Date()), label: `Last ${recentDays} days` }
}

interface AllData {
  daily: AnalyticsDailySummary[]
  network: AnalyticsNetworkSummary[]
  category: AnalyticsCategorySummary[]
  dispatch: AnalyticsDispatchReliability[]
  agents: AnalyticsAgentSummary[]
  agentHealth: AnalyticsAgentHealth[]
  downline: AnalyticsDownlineDepth[]
  hourly: AnalyticsHourlyVolume[]
  funnel: AnalyticsCheckoutFunnel[]
  customers: AnalyticsCustomerBehavior[]
  margin: AnalyticsMarginAccuracy[]
  refunds: AnalyticsRefundSummary[]
  refundsByNetwork: AnalyticsRefundNetworkSummary[]
  refundsByReason: AnalyticsRefundReasonSummary[]
  payouts: AnalyticsPayoutSummary[]
  feedback: AnalyticsFeedbackSummary[]
  applications: AnalyticsApplicationFunnel[]
  solvency: AnalyticsSolvencySnapshot[]
  float: AnalyticsFloatSnapshot[]
}

/**
 * The business-questions dashboard, fed entirely by the ETL job's own
 * warehouse database, never a live query against the database actually
 * taking payments. `/analytics` on purpose, not nested under `/admin`: this
 * reads a completely different database than every other admin screen, and
 * the URL says so.
 */
export default function Analytics() {
  const { pushToast } = useStore()
  const [mode, setMode] = useState<RangeMode>('recent')
  const [recentDays, setRecentDays] = useState(30)
  const [dayValue, setDayValue] = useState(() => new Date().toISOString().slice(0, 10))
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7))
  const [year, setYear] = useState(() => new Date().getUTCFullYear())
  const [data, setData] = useState<AllData | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const range = useMemo(
    () => buildRange(mode, recentDays, dayValue, monthValue, year),
    [mode, recentDays, dayValue, monthValue, year],
  )

  const load = useCallback(async (r: AnalyticsRange) => {
    const [
      daily,
      network,
      category,
      dispatch,
      agents,
      agentHealth,
      downline,
      hourly,
      funnel,
      customers,
      margin,
      refunds,
      refundsByNetwork,
      refundsByReason,
      payouts,
      feedback,
      applications,
      solvency,
      float,
    ] = await Promise.all([
      api.analyticsDailySummary(r).catch(() => []),
      api.analyticsNetworkSummary(r).catch(() => []),
      api.analyticsCategorySummary(r).catch(() => []),
      api.analyticsDispatchReliability(r).catch(() => []),
      api.analyticsAgentSummary(r).catch(() => []),
      api.analyticsAgentHealth(r).catch(() => []),
      api.analyticsDownlineDepth(r.to).catch(() => []),
      api.analyticsHourlyVolume(r).catch(() => []),
      api.analyticsCheckoutFunnel(r).catch(() => []),
      api.analyticsCustomerBehavior(r).catch(() => []),
      api.analyticsMarginAccuracy(r).catch(() => []),
      api.analyticsRefundSummary(r).catch(() => []),
      api.analyticsRefundNetworkSummary(r).catch(() => []),
      api.analyticsRefundReasonSummary(r).catch(() => []),
      api.analyticsPayoutSummary(r).catch(() => []),
      api.analyticsFeedbackSummary(r).catch(() => []),
      api.analyticsApplicationFunnel(r).catch(() => []),
      api.analyticsSolvencySnapshot(r).catch(() => []),
      api.analyticsFloatSnapshot(r).catch(() => []),
    ])
    setData({
      daily,
      network,
      category,
      dispatch,
      agents,
      agentHealth,
      downline,
      hourly,
      funnel,
      customers,
      margin,
      refunds,
      refundsByNetwork,
      refundsByReason,
      payouts,
      feedback,
      applications,
      solvency,
      float,
    })
  }, [])

  useEffect(() => {
    void load(range)
  }, [range, load])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const result = await api.analyticsRefresh()
      pushToast({ tone: 'success', title: `Refreshed, ${result.daysProcessed} day(s) recomputed` })
      await load(range)
    } catch {
      pushToast({ tone: 'error', title: 'Could not refresh right now' })
    } finally {
      setRefreshing(false)
    }
  }

  if (!data) {
    return (
      <div>
        <PageHead title="Analytics" subtitle="Business trends, computed once a day from a separate warehouse database." />
        <div className="py-16 text-center">
          <Spinner className="mx-auto size-8 text-brand-600 dark:text-brand-300" />
        </div>
      </div>
    )
  }

  const totalRevenue = data.daily.reduce((sum, d) => sum + d.revenue, 0)
  const totalProfit = data.daily.reduce((sum, d) => sum + d.profit, 0)
  const totalDispatches = data.dispatch.reduce((sum, d) => sum + d.totalAttempts, 0)
  const totalNoReply = data.dispatch.reduce((sum, d) => sum + d.noReply, 0)
  const noReplyRate = totalDispatches > 0 ? (totalNoReply / totalDispatches) * 100 : 0
  const latestBehavior = data.customers[data.customers.length - 1]
  const repeatRate =
    latestBehavior && latestBehavior.uniqueBuyers > 0
      ? (latestBehavior.repeatBuyers / latestBehavior.uniqueBuyers) * 100
      : 0
  const latestHealth = data.agentHealth[data.agentHealth.length - 1]

  const revenueChart = data.daily.map((d) => ({ day: dayLabel(d.date), revenue: d.revenue }))
  const profitChart = data.daily.map((d) => ({ day: dayLabel(d.date), revenue: d.profit }))

  const networkTotals = new Map<string, number>()
  for (const row of data.network) networkTotals.set(row.network, (networkTotals.get(row.network) ?? 0) + row.revenue)
  const networkSegments = [...networkTotals.entries()].map(([label, value]) => ({ label, value }))
  const networkTotal = networkSegments.reduce((sum, s) => sum + s.value, 0)

  const categoryTotals = new Map<string, number>()
  for (const row of data.category)
    categoryTotals.set(row.category, (categoryTotals.get(row.category) ?? 0) + row.revenue)
  const categorySegments = [...categoryTotals.entries()].map(([category, value]) => ({
    label: CATEGORY_META[category as keyof typeof CATEGORY_META]?.label ?? category,
    value,
  }))
  const categoryTotal = categorySegments.reduce((sum, s) => sum + s.value, 0)

  interface ProfitRow {
    ordersCount: number
    revenue: number
    supplierCost: number
    paystackFee: number
    agentMargin: number
    profit: number
  }
  const emptyProfitRow = (): ProfitRow => ({ ordersCount: 0, revenue: 0, supplierCost: 0, paystackFee: 0, agentMargin: 0, profit: 0 })
  const networkProfit = new Map<string, ProfitRow>()
  for (const row of data.network) {
    const entry = networkProfit.get(row.network) ?? emptyProfitRow()
    entry.ordersCount += row.ordersCount
    entry.revenue += row.revenue
    entry.supplierCost += row.supplierCost
    entry.paystackFee += row.paystackFee
    entry.agentMargin += row.agentMargin
    entry.profit += row.profit
    networkProfit.set(row.network, entry)
  }
  const categoryProfit = new Map<string, ProfitRow>()
  for (const row of data.category) {
    const entry = categoryProfit.get(row.category) ?? emptyProfitRow()
    entry.ordersCount += row.ordersCount
    entry.revenue += row.revenue
    entry.supplierCost += row.supplierCost
    entry.paystackFee += row.paystackFee
    entry.agentMargin += row.agentMargin
    entry.profit += row.profit
    categoryProfit.set(row.category, entry)
  }

  const agentTotals = new Map<string, { name: string; revenue: number; orders: number; margin: number }>()
  for (const row of data.agents) {
    const entry = agentTotals.get(row.agentId) ?? { name: row.agentName, revenue: 0, orders: 0, margin: 0 }
    entry.revenue += row.revenue
    entry.orders += row.ordersCount
    entry.margin += row.margin
    agentTotals.set(row.agentId, entry)
  }
  const leaderboard = [...agentTotals.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10)

  const dispatchByNetwork = new Map<
    string,
    { totalAttempts: number; successful: number; noReply: number; manualQueue: number; otherFailed: number }
  >()
  for (const row of data.dispatch) {
    const entry = dispatchByNetwork.get(row.network) ?? {
      totalAttempts: 0,
      successful: 0,
      noReply: 0,
      manualQueue: 0,
      otherFailed: 0,
    }
    entry.totalAttempts += row.totalAttempts
    entry.successful += row.successful
    entry.noReply += row.noReply
    entry.manualQueue += row.manualQueue
    entry.otherFailed += row.otherFailed
    dispatchByNetwork.set(row.network, entry)
  }

  const noReplyTrend = (() => {
    const byDate = new Map<number, number>()
    for (const row of data.dispatch) byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.noReply)
    return [...byDate.entries()].sort((a, b) => a[0] - b[0]).map(([date, revenue]) => ({ day: dayLabel(date), revenue }))
  })()

  const hourlyTotals = new Map<number, number>()
  for (const row of data.hourly) hourlyTotals.set(row.hour, (hourlyTotals.get(row.hour) ?? 0) + row.ordersCount)
  const hourlyChart = Array.from({ length: 24 }, (_, hour) => ({
    day: `${hour}h`,
    revenue: hourlyTotals.get(hour) ?? 0,
  }))

  const funnelTotals = data.funnel.reduce(
    (sum, f) => ({ started: sum.started + f.started, paid: sum.paid + f.paid, abandoned: sum.abandoned + f.abandoned }),
    { started: 0, paid: 0, abandoned: 0 },
  )
  const abandonmentRate = funnelTotals.started > 0 ? (funnelTotals.abandoned / funnelTotals.started) * 100 : 0

  const marginChart = data.margin.map((m) => ({ day: dayLabel(m.date), revenue: m.avgMarginBp / 100 }))

  const latestDownline = (() => {
    const latestDate = Math.max(0, ...data.downline.map((d) => d.date))
    return data.downline.filter((d) => d.date === latestDate).sort((a, b) => a.depth - b.depth)
  })()

  // Weighted by day, not a plain average of daily averages: a day with 8
  // payouts and a day with 1 should not count equally toward "how long does
  // a payout typically take".
  const weightedAvg = (rows: { count: number; avg: number }[]): number => {
    const totalCount = rows.reduce((sum, r) => sum + r.count, 0)
    if (totalCount === 0) return 0
    return rows.reduce((sum, r) => sum + r.avg * r.count, 0) / totalCount
  }

  const totalRequested = data.payouts.reduce((sum, p) => sum + p.requestedAmount, 0)
  const totalPaidOut = data.payouts.reduce((sum, p) => sum + p.paidAmount, 0)
  const avgHoursToPay = weightedAvg(data.payouts.map((p) => ({ count: p.paidCount, avg: p.avgHoursToPay })))
  const requestedChart = data.payouts.map((p) => ({ day: dayLabel(p.date), revenue: p.requestedAmount }))
  const paidChart = data.payouts.map((p) => ({ day: dayLabel(p.date), revenue: p.paidAmount }))

  const totalRefundCount = data.refunds.reduce((sum, r) => sum + r.count, 0)
  const totalRefundAmount = data.refunds.reduce((sum, r) => sum + r.amount, 0)
  const avgRefundTurnaround = weightedAvg(data.refunds.map((r) => ({ count: r.count, avg: r.avgTurnaroundHours })))
  const refundChart = data.refunds.map((r) => ({ day: dayLabel(r.date), revenue: r.amount }))
  const refundNetworkTotals = new Map<string, { count: number; amount: number }>()
  for (const row of data.refundsByNetwork) {
    const entry = refundNetworkTotals.get(row.network) ?? { count: 0, amount: 0 }
    entry.count += row.count
    entry.amount += row.amount
    refundNetworkTotals.set(row.network, entry)
  }
  const refundReasonTotals = new Map<string, { count: number; amount: number }>()
  for (const row of data.refundsByReason) {
    const entry = refundReasonTotals.get(row.reason) ?? { count: 0, amount: 0 }
    entry.count += row.count
    entry.amount += row.amount
    refundReasonTotals.set(row.reason, entry)
  }
  const topRefundReasons = [...refundReasonTotals.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)

  const feedbackByCategory = new Map<
    string,
    { openCount: number; reviewedCount: number; resolvedCount: number; escalatedCount: number; total: number }
  >()
  for (const row of data.feedback) {
    const entry = feedbackByCategory.get(row.category) ?? { openCount: 0, reviewedCount: 0, resolvedCount: 0, escalatedCount: 0, total: 0 }
    entry.openCount += row.openCount
    entry.reviewedCount += row.reviewedCount
    entry.resolvedCount += row.resolvedCount
    entry.escalatedCount += row.escalatedCount
    entry.total += row.total
    feedbackByCategory.set(row.category, entry)
  }
  const feedbackRows = [...feedbackByCategory.entries()].sort((a, b) => b[1].total - a[1].total)
  const totalFeedback = feedbackRows.reduce((sum, [, r]) => sum + r.total, 0)
  const totalEscalated = feedbackRows.reduce((sum, [, r]) => sum + r.escalatedCount, 0)

  const applicationTotals = data.applications.reduce(
    (sum, a) => ({ applied: sum.applied + a.applied, approved: sum.approved + a.approved, rejected: sum.rejected + a.rejected }),
    { applied: 0, approved: 0, rejected: 0 },
  )
  const avgHoursToDecide = weightedAvg(
    data.applications.map((a) => ({ count: a.approved + a.rejected, avg: a.avgHoursToDecide })),
  )
  const decidedCount = applicationTotals.approved + applicationTotals.rejected
  const approvalRate = decidedCount > 0 ? (applicationTotals.approved / decidedCount) * 100 : 0

  const solvencyChart = data.solvency.map((s) => ({ day: dayLabel(s.date), revenue: s.freeToSpend }))
  const latestSolvency = data.solvency[data.solvency.length - 1]
  const latestFloat = data.float[data.float.length - 1]
  const floatBreachDays = data.float.filter((f) => f.level !== 'ok').length

  return (
    <div>
      <PageHead
        title="Analytics"
        subtitle="Business trends, computed on a schedule from a separate warehouse database, never a live query against production."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<RangeMode>
              options={[
                { value: 'recent', label: 'Recent' },
                { value: 'day', label: 'Day' },
                { value: 'month', label: 'Month' },
                { value: 'year', label: 'Year' },
              ]}
              value={mode}
              onChange={setMode}
            />
            {mode === 'recent' && (
              <Segmented
                options={[
                  { value: '7', label: '7d' },
                  { value: '30', label: '30d' },
                  { value: '90', label: '90d' },
                ]}
                value={String(recentDays)}
                onChange={(next) => setRecentDays(Number(next))}
              />
            )}
            {mode === 'day' && (
              // A fixed-width wrapper, not a `className` on `TextInput` itself:
              // its own `w-full` and an override of the same property race on
              // CSS source order, not attribute order, and can silently lose.
              <div className="w-40">
                <TextInput type="date" aria-label="Pick a day" value={dayValue} onChange={(e) => setDayValue(e.target.value)} />
              </div>
            )}
            {mode === 'month' && (
              <div className="w-40">
                <TextInput type="month" aria-label="Pick a month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)} />
              </div>
            )}
            {mode === 'year' && (
              <div className="w-24">
                <TextInput
                  type="number"
                  aria-label="Pick a year"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value) || year)}
                  min={2020}
                  max={new Date().getUTCFullYear()}
                />
              </div>
            )}
            <Button variant="outline" loading={refreshing} onClick={() => void refresh()}>
              Refresh now
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={`Revenue, ${range.label}`}
          value={cedisCompact(totalRevenue)}
          hint={`${cedisCompact(totalProfit)} kept as profit`}
          tone="brand"
          icon={<TrendUpIcon className="size-5" />}
        />
        <StatTile
          label="DataHub no-reply rate"
          value={`${noReplyRate.toFixed(1)}%`}
          hint={`${totalNoReply} of ${totalDispatches} attempts got nothing back`}
          tone={noReplyRate > 5 ? 'warning' : 'neutral'}
          icon={<ClockIcon className="size-5" />}
        />
        <StatTile
          label="Checkout abandonment"
          value={`${abandonmentRate.toFixed(1)}%`}
          hint={`${funnelTotals.paid}/${funnelTotals.started} started checkouts actually paid`}
          tone={abandonmentRate > 30 ? 'warning' : 'neutral'}
          icon={<ReceiptIcon className="size-5" />}
        />
        <StatTile
          label="Repeat buyer rate"
          value={`${repeatRate.toFixed(1)}%`}
          hint={latestBehavior ? `${latestBehavior.uniqueBuyers} unique buyers, latest day` : 'No data yet'}
          icon={<UsersIcon className="size-5" />}
        />
      </div>

      <Card className="mt-3">
        <CardHead
          title="Reserve position"
          subtitle="What should be sitting at Paystack, what's owed to other people, and what's actually free to spend, snapshotted once a day. The same computation ReservePanel shows live, here as a trend."
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
          <StatTile
            label="Free to spend"
            value={latestSolvency ? cedisCompact(latestSolvency.freeToSpend) : '-'}
            hint="Latest snapshot"
            tone={latestSolvency && latestSolvency.freeToSpend < 0 ? 'warning' : 'brand'}
            icon={<CashIcon className="size-5" />}
          />
          <StatTile
            label="Should be at Paystack"
            value={latestSolvency ? cedisCompact(latestSolvency.expectedAtPaystack) : '-'}
          />
          <StatTile
            label="Owed to other people"
            value={latestSolvency ? cedisCompact(latestSolvency.liabilitiesTotal) : '-'}
          />
          <StatTile
            label="DataHub float"
            value={latestFloat ? cedisCompact(latestFloat.balance) : latestSolvency?.floatBalance != null ? cedisCompact(latestSolvency.floatBalance) : '-'}
            hint={
              latestFloat
                ? `${latestFloat.level === 'ok' ? 'Healthy' : latestFloat.level === 'watch' ? 'Watch' : 'At risk'}, ${floatBreachDays} of ${data.float.length} day(s) breached in this range`
                : 'No live reading yet'
            }
            tone={latestFloat?.level === 'risk' ? 'warning' : latestFloat?.level === 'watch' ? 'warning' : 'neutral'}
            icon={<AlertIcon className="size-5" />}
          />
        </div>
        {data.solvency.length > 0 && (
          <div className="border-t border-slate-100 p-4 dark:border-slate-800 sm:p-5">
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              Free to spend, by day. Cannot be backfilled, a gap before this feature shipped is expected, not missing data.
            </p>
            <LineChart data={solvencyChart} height={140} />
          </div>
        )}
      </Card>

      <Card className="mt-3">
        <CardHead title="Revenue" subtitle={`${range.label}, every paid order`} />
        <div className="p-4 sm:p-5">
          <LineChart data={revenueChart} height={180} />
        </div>
      </Card>

      <Card className="mt-3">
        <CardHead title="Profit" subtitle="Revenue less supplier cost, Paystack's fee, and agent margins, completed orders only" />
        <div className="p-4 sm:p-5">
          <LineChart data={profitChart} height={160} />
        </div>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="Revenue by network" subtitle={range.label} />
          <div className="p-4 sm:p-5">
            {networkSegments.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No data yet.</p>
            ) : (
              <Donut
                segments={networkSegments}
                total={networkTotal}
                centreLabel="Revenue"
                centreValue={cedisCompact(networkTotal).replace('GHS ', '')}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHead title="Revenue by category" subtitle={range.label} />
          <div className="p-4 sm:p-5">
            {categorySegments.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No data yet.</p>
            ) : (
              <Donut
                segments={categorySegments}
                total={categoryTotal}
                centreLabel="Revenue"
                centreValue={cedisCompact(categoryTotal).replace('GHS ', '')}
              />
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-3">
        <CardHead
          title="Profitability"
          subtitle="Which network and category actually keep money, not just which moves the most of it, completed orders only"
        />
        <div className="grid gap-0 sm:grid-cols-2">
          <div className="overflow-x-auto border-slate-100 dark:border-slate-800 sm:border-r">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 sm:px-5">Network</th>
                  <th className="px-4 py-2 text-right sm:px-5">Revenue</th>
                  <th className="px-4 py-2 text-right sm:px-5">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {[...networkProfit.entries()].length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500 dark:text-slate-400 sm:px-5" colSpan={3}>
                      No data yet.
                    </td>
                  </tr>
                ) : (
                  [...networkProfit.entries()]
                    .sort((a, b) => b[1].profit - a[1].profit)
                    .map(([network, row]) => (
                      <tr key={network}>
                        <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-50 sm:px-5">{network}</td>
                        <td className="tabular px-4 py-2.5 text-right sm:px-5">{cedis(row.revenue)}</td>
                        <td className={cn('tabular px-4 py-2.5 text-right sm:px-5 font-semibold', row.profit < 0 && 'text-red-600 dark:text-red-400')}>
                          {cedis(row.profit)}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 sm:px-5">Category</th>
                  <th className="px-4 py-2 text-right sm:px-5">Revenue</th>
                  <th className="px-4 py-2 text-right sm:px-5">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {[...categoryProfit.entries()].length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500 dark:text-slate-400 sm:px-5" colSpan={3}>
                      No data yet.
                    </td>
                  </tr>
                ) : (
                  [...categoryProfit.entries()]
                    .sort((a, b) => b[1].profit - a[1].profit)
                    .map(([category, row]) => (
                      <tr key={category}>
                        <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-50 sm:px-5">
                          {CATEGORY_META[category as keyof typeof CATEGORY_META]?.label ?? category}
                        </td>
                        <td className="tabular px-4 py-2.5 text-right sm:px-5">{cedis(row.revenue)}</td>
                        <td className={cn('tabular px-4 py-2.5 text-right sm:px-5 font-semibold', row.profit < 0 && 'text-red-600 dark:text-red-400')}>
                          {cedis(row.profit)}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Card className="mt-3">
        <CardHead
          title="DataHub reliability"
          subtitle="How often the delivery partner actually answers, by network"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 sm:px-5">Network</th>
                <th className="px-4 py-2 text-right sm:px-5">Attempts</th>
                <th className="px-4 py-2 text-right sm:px-5">Successful</th>
                <th className="px-4 py-2 text-right sm:px-5">No reply</th>
                <th className="px-4 py-2 text-right sm:px-5">Manual queue</th>
                <th className="px-4 py-2 text-right sm:px-5">Rejected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {[...dispatchByNetwork.entries()].length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500 dark:text-slate-400 sm:px-5" colSpan={6}>
                    No dispatch attempts in this range.
                  </td>
                </tr>
              ) : (
                [...dispatchByNetwork.entries()].map(([network, row]) => (
                  <tr key={network}>
                    <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-50 sm:px-5">{network}</td>
                    <td className="tabular px-4 py-2.5 text-right sm:px-5">{row.totalAttempts}</td>
                    <td className="tabular px-4 py-2.5 text-right sm:px-5">{row.successful}</td>
                    <td className="tabular px-4 py-2.5 text-right sm:px-5">
                      {row.noReply > 0 ? <Badge tone="warning">{row.noReply}</Badge> : row.noReply}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right sm:px-5">{row.manualQueue}</td>
                    <td className="tabular px-4 py-2.5 text-right sm:px-5">{row.otherFailed}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {noReplyTrend.some((p) => p.revenue > 0) && (
          <div className="border-t border-slate-100 p-4 dark:border-slate-800 sm:p-5">
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">No-reply attempts, by day</p>
            <LineChart data={noReplyTrend} height={100} valueLabel={(v) => String(v)} label="No-reply attempts" />
          </div>
        )}
      </Card>

      <Card className="mt-3">
        <CardHead title="Top agents" subtitle={`By revenue, ${range.label}`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 sm:px-5">Agent</th>
                <th className="px-4 py-2 text-right sm:px-5">Orders</th>
                <th className="px-4 py-2 text-right sm:px-5">Revenue</th>
                <th className="px-4 py-2 text-right sm:px-5">Margin earned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {leaderboard.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500 dark:text-slate-400 sm:px-5" colSpan={4}>
                    No sales through an agent in this range.
                  </td>
                </tr>
              ) : (
                leaderboard.map((agent) => (
                  <tr key={agent.name}>
                    <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-50 sm:px-5">{agent.name}</td>
                    <td className="tabular px-4 py-2.5 text-right sm:px-5">{agent.orders}</td>
                    <td className="tabular px-4 py-2.5 text-right sm:px-5">{cedis(agent.revenue)}</td>
                    <td className="tabular px-4 py-2.5 text-right sm:px-5">{cedis(agent.margin)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-3">
        <CardHead title="Agent payouts" subtitle={`${range.label}, keyed by the day requested`} />
        <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
          <StatTile label="Requested" value={cedisCompact(totalRequested)} icon={<CashIcon className="size-5" />} />
          <StatTile label="Actually paid" value={cedisCompact(totalPaidOut)} tone="success" />
          <StatTile
            label="Time to pay"
            value={avgHoursToPay > 0 ? `${avgHoursToPay.toFixed(1)}h` : '-'}
            hint="Average, request to payout"
          />
        </div>
        <div className="grid gap-4 border-t border-slate-100 p-4 dark:border-slate-800 sm:grid-cols-2 sm:p-5">
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Requested, by day</p>
            <LineChart data={requestedChart} height={100} />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Actually paid, by day</p>
            <LineChart data={paidChart} height={100} />
          </div>
        </div>
      </Card>

      <Card className="mt-3">
        <CardHead title="Refunds" subtitle={`${range.label}, decided in this window`} />
        <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
          <StatTile label="Refunded" value={cedisCompact(totalRefundAmount)} hint={`${totalRefundCount} refund(s)`} />
          <StatTile
            label="Time to decide"
            value={avgRefundTurnaround > 0 ? `${avgRefundTurnaround.toFixed(1)}h` : '-'}
            hint="Average, order failed to refund decided"
          />
          <StatTile label="Networks affected" value={String(refundNetworkTotals.size)} />
        </div>
        {totalRefundCount > 0 && (
          <div className="border-t border-slate-100 p-4 dark:border-slate-800 sm:p-5">
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Refunded amount, by day</p>
            <LineChart data={refundChart} height={100} />
          </div>
        )}
        <div className="grid gap-0 border-t border-slate-100 dark:border-slate-800 sm:grid-cols-2">
          <div className="overflow-x-auto border-slate-100 dark:border-slate-800 sm:border-r">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 sm:px-5">Network</th>
                  <th className="px-4 py-2 text-right sm:px-5">Count</th>
                  <th className="px-4 py-2 text-right sm:px-5">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {[...refundNetworkTotals.entries()].length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500 dark:text-slate-400 sm:px-5" colSpan={3}>
                      No refunds in this range.
                    </td>
                  </tr>
                ) : (
                  [...refundNetworkTotals.entries()]
                    .sort((a, b) => b[1].amount - a[1].amount)
                    .map(([network, row]) => (
                      <tr key={network}>
                        <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-50 sm:px-5">{network}</td>
                        <td className="tabular px-4 py-2.5 text-right sm:px-5">{row.count}</td>
                        <td className="tabular px-4 py-2.5 text-right sm:px-5">{cedis(row.amount)}</td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 sm:px-5">What's driving it</th>
                  <th className="px-4 py-2 text-right sm:px-5">Count</th>
                  <th className="px-4 py-2 text-right sm:px-5">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {topRefundReasons.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500 dark:text-slate-400 sm:px-5" colSpan={3}>
                      No refunds in this range.
                    </td>
                  </tr>
                ) : (
                  topRefundReasons.map(([reason, row]) => (
                    <tr key={reason}>
                      <td className="max-w-48 truncate px-4 py-2.5 text-slate-700 dark:text-slate-200 sm:px-5" title={reason}>
                        {reason}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right sm:px-5">{row.count}</td>
                      <td className="tabular px-4 py-2.5 text-right sm:px-5">{cedis(row.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="Agent network health" subtitle="Latest snapshot" />
          <div className="grid grid-cols-2 gap-3 p-4 sm:p-5">
            <StatTile label="Total agents" value={String(latestHealth?.totalAgents ?? 0)} />
            <StatTile label="Active" value={String(latestHealth?.activeAgents ?? 0)} tone="success" />
            <StatTile
              label="Never sold anything"
              value={String(latestHealth?.dormantAgents ?? 0)}
              tone={latestHealth && latestHealth.dormantAgents > 0 ? 'warning' : 'neutral'}
            />
            <StatTile label="Awaiting approval" value={String(latestHealth?.pendingApplications ?? 0)} />
          </div>
        </Card>
        <Card>
          <CardHead title="Referral tree depth" subtitle="How deep the downline actually goes, latest snapshot" />
          <div className="space-y-2 p-4 sm:p-5">
            {latestDownline.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No data yet.</p>
            ) : (
              latestDownline.map((row) => (
                <div key={row.depth} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-sm text-slate-500 dark:text-slate-400">
                    Depth {row.depth}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-brand-600"
                      style={{
                        width: `${Math.max((row.agentCount / Math.max(...latestDownline.map((r) => r.agentCount), 1)) * 100, 4)}%`,
                      }}
                    />
                  </div>
                  <span className="tabular w-8 shrink-0 text-right text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {row.agentCount}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="Agent applications" subtitle={`${range.label}, applied by signup day, decided by decision day`} />
          <div className="grid grid-cols-2 gap-3 p-4 sm:p-5">
            <StatTile label="Applied" value={String(applicationTotals.applied)} icon={<UsersIcon className="size-5" />} />
            <StatTile
              label="Approval rate"
              value={decidedCount > 0 ? `${approvalRate.toFixed(0)}%` : '-'}
              hint={`${applicationTotals.approved} approved, ${applicationTotals.rejected} rejected`}
              tone="success"
            />
            <StatTile
              label="Time to decide"
              value={avgHoursToDecide > 0 ? `${avgHoursToDecide.toFixed(1)}h` : '-'}
              hint="Average, applied to decided"
            />
            <StatTile label="Awaiting a decision" value={String(applicationTotals.applied - decidedCount > 0 ? applicationTotals.applied - decidedCount : 0)} />
          </div>
        </Card>
        <Card>
          <CardHead title="Feedback" subtitle={`${range.label}, by category`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 sm:px-5">Category</th>
                  <th className="px-4 py-2 text-right sm:px-5">Open</th>
                  <th className="px-4 py-2 text-right sm:px-5">Reviewed</th>
                  <th className="px-4 py-2 text-right sm:px-5">Resolved</th>
                  <th className="px-4 py-2 text-right sm:px-5">Escalated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {feedbackRows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500 dark:text-slate-400 sm:px-5" colSpan={5}>
                      No feedback in this range.
                    </td>
                  </tr>
                ) : (
                  feedbackRows.map(([category, row]) => (
                    <tr key={category}>
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-50 capitalize sm:px-5">{category}</td>
                      <td className="tabular px-4 py-2.5 text-right sm:px-5">
                        {row.openCount > 0 ? <Badge tone="warning">{row.openCount}</Badge> : row.openCount}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right sm:px-5">{row.reviewedCount}</td>
                      <td className="tabular px-4 py-2.5 text-right sm:px-5">{row.resolvedCount}</td>
                      <td className="tabular px-4 py-2.5 text-right sm:px-5">
                        {row.escalatedCount > 0 ? <Badge tone="danger">{row.escalatedCount}</Badge> : row.escalatedCount}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalFeedback > 0 && (
            <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:px-5">
              {totalFeedback} total, {totalEscalated} escalated as a real bug rather than resolved as business-as-usual.
            </p>
          )}
        </Card>
      </div>

      <Card className="mt-3">
        <CardHead
          title="Order volume by hour of day"
          subtitle={`${range.label}, when float and staffing actually matter`}
        />
        <div className="p-4 sm:p-5">
          <BarChart data={hourlyChart} height={140} valueLabel={(v) => String(v)} label="Orders by hour" />
        </div>
      </Card>

      <Card className="mt-3">
        <CardHead
          title="Margin accuracy"
          subtitle="Average margin as a percentage of sale price, completed orders. A falling line means DataHub's real cost is creeping up on the catalogue price."
        />
        <div className="p-4 sm:p-5">
          <LineChart data={marginChart} height={140} valueLabel={(v) => `${v.toFixed(1)}%`} label="Average margin" />
        </div>
      </Card>
    </div>
  )
}
