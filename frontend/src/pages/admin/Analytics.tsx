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
  type AnalyticsLostRevenue,
  type AnalyticsMarginAccuracy,
  type AnalyticsNetworkSummary,
  type AnalyticsPayoutSummary,
  type AnalyticsProductSummary,
  type AnalyticsRange,
  type AnalyticsRefundNetworkSummary,
  type AnalyticsRefundReasonSummary,
  type AnalyticsRefundSummary,
  type AnalyticsSolvencySnapshot,
} from '../../lib/api'
import { useStore } from '../../state/store'
import { cedis, cedisCompact } from '../../lib/format'
import { CATEGORY_META } from '../../components/categories'
import { BarChart, DistributionBar, LineChart, RankedBarChart, RevenueMarginChart } from '../../components/charts'
import { Badge, Button, Card, CardHead, cn, Modal, PageHead, Spinner, StatTile, TextInput } from '../../components/ui'
import { DateRangePicker, type PresetKey } from '../../components/DateRangePicker'
import { AlertIcon, CashIcon, CheckIcon, ClockIcon, ReceiptIcon, TrendUpIcon, UsersIcon, XIcon } from '../../components/icons'

/**
 * Fix 5: alert thresholds defined once, reused both in `attentionItems`'s
 * text and as a drawn reference line/band on the chart the alert is about,
 * so a viewer can see how close a metric is to tripping it, not just whether
 * it already has.
 */
const DISPATCH_SUCCESS_FLOOR = 85
const NO_REPLY_ALERT_RATE = 5
const ABANDONMENT_ALERT_RATE = 30

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

/**
 * The equal-length window immediately before `r`, so a raw number
 * ("Revenue GHS 1,975") can be shown next to what it actually means
 * ("up 18% on the 30 days before that"). A number with nothing to compare
 * against doesn't tell an admin whether to act on it.
 */
function previousRange(r: AnalyticsRange): AnalyticsRange {
  const lengthDays = Math.round((dateIntToDate(r.to).getTime() - dateIntToDate(r.from).getTime()) / 86_400_000) + 1
  const end = dateIntToDate(r.from)
  end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (lengthDays - 1))
  return { from: toDateInt(start), to: toDateInt(end) }
}

/**
 * The same calendar dates, one year earlier, for a seasonal ("same period
 * last year") comparison instead of the immediately-preceding window.
 * `setUTCFullYear` only changes the year component and lets `Date` itself
 * normalise an invalid result (a leap-day range shifted to a non-leap year),
 * rather than a naive digit-subtraction on the raw `dateInt`.
 */
function sameRangeLastYear(r: AnalyticsRange): AnalyticsRange {
  const from = dateIntToDate(r.from)
  const to = dateIntToDate(r.to)
  from.setUTCFullYear(from.getUTCFullYear() - 1)
  to.setUTCFullYear(to.getUTCFullYear() - 1)
  return { from: toDateInt(from), to: toDateInt(to) }
}

/** "16 Sep - 30 Sep, 2026" (or "16 Sep, 2026" for a single day), for a range with no preset name of its own. */
function formatRangeLabel(r: AnalyticsRange): string {
  const fromYear = Math.floor(r.from / 10_000)
  const toYear = Math.floor(r.to / 10_000)
  if (r.from === r.to) return `${dayLabel(r.from)}, ${fromYear}`
  return fromYear === toYear ? `${dayLabel(r.from)} - ${dayLabel(r.to)}, ${toYear}` : `${dayLabel(r.from)} ${fromYear} - ${dayLabel(r.to)} ${toYear}`
}

/** ▲/▼ N% vs the previous period, or `null` when there's nothing to compare against yet. */
function trendOf(current: number, previous: number): { pct: number; up: boolean } | null {
  if (previous === 0) return current === 0 ? null : { pct: 100, up: current > 0 }
  const pct = ((current - previous) / Math.abs(previous)) * 100
  return { pct: Math.abs(pct), up: pct > 0 }
}

/**
 * A trend arrow's colour depends on which direction is actually good: more
 * revenue is good, more no-reply attempts is bad. `goodDirection` says which
 * way this particular metric wants to move.
 */
function TrendBadge({ trend, goodDirection }: { trend: { pct: number; up: boolean } | null; goodDirection: 'up' | 'down' }) {
  if (!trend || trend.pct < 0.5) return <span className="text-slate-400 dark:text-slate-500">Flat vs previous period</span>
  const isGood = trend.up === (goodDirection === 'up')
  return (
    <span className={isGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
      {trend.up ? '▲' : '▼'} {trend.pct.toFixed(0)}% vs previous period
    </span>
  )
}

/**
 * Fix 5: the no-reply *rate* per day, not the raw count `noReplyTrend` used
 * to plot, so the alert threshold (a rate) can be drawn on the same chart as
 * a horizontal reference line, and the previous period compares like for
 * like even across days with different attempt volumes.
 */
function dispatchRateByDate(rows: AnalyticsDispatchReliability[]): { date: number; rate: number }[] {
  const byDate = new Map<number, { noReply: number; total: number }>()
  for (const row of rows) {
    const entry = byDate.get(row.date) ?? { noReply: 0, total: 0 }
    entry.noReply += row.noReply
    entry.total += row.totalAttempts
    byDate.set(row.date, entry)
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([date, v]) => ({ date, rate: v.total > 0 ? (v.noReply / v.total) * 100 : 0 }))
}

/**
 * Fix 2: sums a day-scoped bucketed-count field (`<1h` / `1-4h` / `4-24h` /
 * `24h+`) across a date range into one distribution, shown beside its single
 * averaged number so a slow outlier can't hide inside a fine-looking mean.
 */
function bucketSums<T>(rows: T[], keys: [keyof T, keyof T, keyof T, keyof T]): { label: string; count: number }[] {
  const labels = ['<1h', '1-4h', '4-24h', '24h+']
  return keys.map((key, i) => ({ label: labels[i], count: rows.reduce((sum, r) => sum + (r[key] as unknown as number), 0) }))
}

/**
 * `day`/`month`/`year` predate the calendar-based picker below and are kept
 * exactly as they were (a native day/month/year picker each used to drive
 * them). Nothing in the current UI sets these three anymore, replaced by the
 * named presets and `custom`, but the branches stay: they're still correct,
 * still cheap to keep, and the new modes need to live alongside them, not
 * instead of them.
 */
type RangeMode =
  | 'recent'
  | 'day'
  | 'month'
  | 'year'
  | 'today'
  | 'yesterday'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear'
  | 'quarterToDate'
  | 'yearToDate'
  | 'custom'

/** A range plus the human label every card subtitle on this page shows. */
interface PickedRange extends AnalyticsRange {
  label: string
}

/** First day through last day of the given month (1-12), inclusive, plus its display label. Used by `thisMonth`/`lastMonth`. */
function monthRange(year: number, month: number): PickedRange {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { from: year * 10_000 + month * 100 + 1, to: year * 10_000 + month * 100 + lastDay, label }
}

/**
 * Builds the exact window the picker describes. `dayValue`/`monthValue`/
 * `year` are the raw strings the old native `<input type="date">`/
 * `type="month">`/`type="number">` used to hand back (`YYYY-MM-DD` /
 * `YYYY-MM` / a plain year), parsed here rather than through `Date` so an
 * all-UTC value never drifts a day from the picker's own local input. Kept
 * as parameters purely so the `day`/`month`/`year` branches below keep
 * compiling, see `RangeMode`'s own comment; Analytics.tsx now passes fixed
 * placeholders for them since nothing in the UI can select those modes.
 * `customRange`, by contrast, is live: it's the calendar's own selection.
 */
function buildRange(
  mode: RangeMode,
  recentDays: number,
  dayValue: string,
  monthValue: string,
  year: number,
  customRange: { from: number; to: number } | null,
): PickedRange {
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
  if (mode === 'today' || mode === 'yesterday') {
    const dateInt = mode === 'today' ? toDateInt(new Date()) : daysAgo(1)
    return { from: dateInt, to: dateInt, label: mode === 'today' ? 'Today' : 'Yesterday' }
  }
  if (mode === 'thisMonth' || mode === 'lastMonth') {
    const now = new Date()
    // 0-based, can run negative for "last month" in January; normalised below.
    const targetMonth0 = now.getUTCMonth() - (mode === 'lastMonth' ? 1 : 0)
    const y = now.getUTCFullYear() + Math.floor(targetMonth0 / 12)
    const m0 = ((targetMonth0 % 12) + 12) % 12
    return monthRange(y, m0 + 1)
  }
  if (mode === 'thisYear' || mode === 'lastYear') {
    const y = new Date().getUTCFullYear() - (mode === 'lastYear' ? 1 : 0)
    return { from: y * 10_000 + 101, to: y * 10_000 + 1231, label: String(y) }
  }
  if (mode === 'quarterToDate') {
    const now = new Date()
    const quarterStartMonth0 = Math.floor(now.getUTCMonth() / 3) * 3
    const from = now.getUTCFullYear() * 10_000 + (quarterStartMonth0 + 1) * 100 + 1
    return { from, to: toDateInt(now), label: 'Quarter to date' }
  }
  if (mode === 'yearToDate') {
    const now = new Date()
    return { from: now.getUTCFullYear() * 10_000 + 101, to: toDateInt(now), label: 'Year to date' }
  }
  if (mode === 'custom' && customRange) {
    return { ...customRange, label: formatRangeLabel(customRange) }
  }
  return { from: daysAgo(recentDays), to: toDateInt(new Date()), label: `Last ${recentDays} days` }
}

interface AllData {
  daily: AnalyticsDailySummary[]
  network: AnalyticsNetworkSummary[]
  category: AnalyticsCategorySummary[]
  products: AnalyticsProductSummary[]
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
  lostRevenue: AnalyticsLostRevenue[]
}

/**
 * The equal-length prior period, fetched a second time so every trend chart
 * can overlay "this period vs last period" on one axis (fix 1), not just the
 * four hero stat tiles that already had a trend badge.
 */
interface PrevData {
  daily: AnalyticsDailySummary[]
  dispatch: AnalyticsDispatchReliability[]
  funnel: AnalyticsCheckoutFunnel[]
  margin: AnalyticsMarginAccuracy[]
  solvency: AnalyticsSolvencySnapshot[]
  payouts: AnalyticsPayoutSummary[]
  refunds: AnalyticsRefundSummary[]
  lostRevenue: AnalyticsLostRevenue[]
}

/**
 * Everything below the hero stats and "Needs attention" is grouped into
 * these sections and shown one at a time: the page was a single ~15-card
 * scroll, and no single visit needs all of it read in order. Hero stats,
 * "Needs attention", and the range picker stay outside the tabs since those
 * are the "read this every time" summary the tabs themselves don't replace.
 */
const TABS = [
  { key: 'money', label: 'Money' },
  { key: 'agents', label: 'Agents' },
  { key: 'payouts-refunds', label: 'Payouts & refunds' },
  { key: 'lost-revenue', label: 'Lost revenue' },
  { key: 'operations', label: 'Operations' },
] as const
type TabKey = (typeof TABS)[number]['key']

/**
 * The business-questions dashboard, fed entirely by the ETL job's own
 * warehouse database, never a live query against the database actually
 * taking payments. `/analytics` on purpose, not nested under `/admin`: this
 * reads a completely different database than every other admin screen, and
 * the URL says so.
 */
export default function Analytics() {
  const { pushToast } = useStore()
  const [tab, setTab] = useState<TabKey>('money')
  const [mode, setMode] = useState<RangeMode>('recent')
  const [recentDays, setRecentDays] = useState(30)
  const [customRange, setCustomRange] = useState<{ from: number; to: number } | null>(null)
  const [compareMode, setCompareMode] = useState<'previous' | 'lastYear'>('previous')
  const [data, setData] = useState<AllData | null>(null)
  const [prevData, setPrevData] = useState<PrevData | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [recomputeOpen, setRecomputeOpen] = useState(false)
  const [recomputeDate, setRecomputeDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [recomputing, setRecomputing] = useState(false)
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null)

  // `day`/`month`/`year` are unreachable from the new picker (see `RangeMode`'s
  // own comment) but `buildRange` still takes their driving values as
  // parameters, so these are just inert placeholders, never actually read.
  const range = useMemo(
    () => buildRange(mode, recentDays, '', '', 0, customRange),
    [mode, recentDays, customRange],
  )

  const handlePreset = (preset: PresetKey) => {
    if (preset === 'last7' || preset === 'last30' || preset === 'last90') {
      setRecentDays(preset === 'last7' ? 7 : preset === 'last30' ? 30 : 90)
      setMode('recent')
      return
    }
    setMode(preset)
  }

  const comparisonRange = compareMode === 'lastYear' ? sameRangeLastYear(range) : previousRange(range)
  const comparisonLabel = formatRangeLabel(comparisonRange)

  const load = useCallback(async (r: AnalyticsRange, cmpMode: 'previous' | 'lastYear') => {
    const [
      daily,
      network,
      category,
      products,
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
      lostRevenue,
    ] = await Promise.all([
      api.analyticsDailySummary(r).catch(() => []),
      api.analyticsNetworkSummary(r).catch(() => []),
      api.analyticsCategorySummary(r).catch(() => []),
      api.analyticsProductSummary(r).catch(() => []),
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
      api.analyticsLostRevenue(r).catch(() => []),
    ])
    setData({
      daily,
      network,
      category,
      products,
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
      lostRevenue,
    })

    // A separate, lighter fetch of the comparison period: the hero stat
    // tiles' own trend badges, plus (fix 1) a previous-period overlay for
    // every trend chart below that has one. Still far short of every rollup
    // on the page a second time (no agents/network/category/etc.). Which
    // window counts as "comparison" is the one thing `compareMode` changes,
    // via `DateRangePicker`'s "compare to last year instead" toggle.
    const prev = cmpMode === 'lastYear' ? sameRangeLastYear(r) : previousRange(r)
    const [prevDaily, prevDispatch, prevFunnel, prevMargin, prevSolvency, prevPayouts, prevRefunds, prevLostRevenue] = await Promise.all([
      api.analyticsDailySummary(prev).catch(() => []),
      api.analyticsDispatchReliability(prev).catch(() => []),
      api.analyticsCheckoutFunnel(prev).catch(() => []),
      api.analyticsMarginAccuracy(prev).catch(() => []),
      api.analyticsSolvencySnapshot(prev).catch(() => []),
      api.analyticsPayoutSummary(prev).catch(() => []),
      api.analyticsRefundSummary(prev).catch(() => []),
      api.analyticsLostRevenue(prev).catch(() => []),
    ])
    setPrevData({
      daily: prevDaily,
      dispatch: prevDispatch,
      funnel: prevFunnel,
      margin: prevMargin,
      solvency: prevSolvency,
      payouts: prevPayouts,
      refunds: prevRefunds,
      lostRevenue: prevLostRevenue,
    })
  }, [])

  useEffect(() => {
    void load(range, compareMode)
  }, [range, compareMode, load])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const result = await api.analyticsRefresh()
      pushToast({ tone: 'success', title: `Refreshed, ${result.daysProcessed} day(s) recomputed` })
      await load(range, compareMode)
    } catch {
      pushToast({ tone: 'error', title: 'Could not refresh right now' })
    } finally {
      setRefreshing(false)
    }
  }

  const recomputeFrom = async () => {
    const [y, m, d] = recomputeDate.split('-').map(Number)
    const dateInt = y * 10_000 + m * 100 + d
    setRecomputing(true)
    try {
      const result = await api.analyticsRecomputeFrom(dateInt)
      pushToast({ tone: 'success', title: `Recomputed, ${result.daysProcessed} day(s) rebuilt from ${dayLabel(dateInt)}` })
      setRecomputeOpen(false)
      await load(range, compareMode)
    } catch (error) {
      pushToast({ tone: 'error', title: error instanceof Error ? error.message : 'Could not recompute right now' })
    } finally {
      setRecomputing(false)
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
  const latestSolvency = data.solvency[data.solvency.length - 1]
  const latestFloat = data.float[data.float.length - 1]
  const latestLostRevenue = data.lostRevenue[data.lostRevenue.length - 1]

  // Trend context for the hero numbers, against the equal-length period
  // right before this one. `null` while the comparison fetch hasn't
  // resolved yet, not treated as "flat" until it actually is.
  const prevRevenue = prevData ? prevData.daily.reduce((sum, d) => sum + d.revenue, 0) : null
  const prevDispatches = prevData ? prevData.dispatch.reduce((sum, d) => sum + d.totalAttempts, 0) : null
  const prevNoReply = prevData ? prevData.dispatch.reduce((sum, d) => sum + d.noReply, 0) : null
  const prevNoReplyRate = prevDispatches !== null && prevNoReply !== null && prevDispatches > 0 ? (prevNoReply / prevDispatches) * 100 : null
  const prevFunnelTotals = prevData
    ? prevData.funnel.reduce((sum, f) => ({ started: sum.started + f.started, abandoned: sum.abandoned + f.abandoned }), { started: 0, abandoned: 0 })
    : null
  const prevAbandonmentRate = prevFunnelTotals && prevFunnelTotals.started > 0 ? (prevFunnelTotals.abandoned / prevFunnelTotals.started) * 100 : null

  const revenueTrend = prevRevenue !== null ? trendOf(totalRevenue, prevRevenue) : null
  const noReplyTrendStat = prevNoReplyRate !== null ? trendOf(noReplyRate, prevNoReplyRate) : null

  // Fix 1: previous-period overlay, index-aligned with the current series
  // (same equal length, one calendar period earlier), not date-aligned.
  const revenueChart = data.daily.map((d) => ({ day: dayLabel(d.date), revenue: d.revenue }))
  const previousRevenue = prevData?.daily.map((d) => d.revenue)
  const profitChart = data.daily.map((d) => ({ day: dayLabel(d.date), revenue: d.profit }))
  const previousProfit = prevData?.daily.map((d) => d.profit)

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

  // Fix 3: revenue as bars with profit margin % overlaid, one chart in place
  // of a revenue-only donut plus this same profit table elsewhere on the
  // page, so "revenue-dominant but barely profitable" is visible on sight
  // instead of only after cross-referencing two sections.
  const networkComboRows = [...networkProfit.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([network, row]) => ({ label: network, revenue: row.revenue, marginPct: row.revenue > 0 ? (row.profit / row.revenue) * 100 : 0 }))
  const categoryComboRows = [...categoryProfit.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([category, row]) => ({
      label: CATEGORY_META[category as keyof typeof CATEGORY_META]?.label ?? category,
      revenue: row.revenue,
      marginPct: row.revenue > 0 ? (row.profit / row.revenue) * 100 : 0,
    }))

  // Drill-down from a clicked network bar (see `RevenueMarginChart`'s
  // `onSelect`) into that network's own top products, summed across the
  // whole selected range rather than day by day, the same rollup pattern
  // `agentTotals`/`networkProfit` below already use.
  interface ProductRow {
    productId: string
    productName: string
    network: string
    revenue: number
    profit: number
    ordersCount: number
  }
  const productTotals = new Map<string, ProductRow>()
  for (const row of data.products) {
    const entry = productTotals.get(row.productId) ?? {
      productId: row.productId,
      productName: row.productName,
      network: row.network,
      revenue: 0,
      profit: 0,
      ordersCount: 0,
    }
    entry.revenue += row.revenue
    entry.profit += row.profit
    entry.ordersCount += row.ordersCount
    productTotals.set(row.productId, entry)
  }
  const topProductsForNetwork = selectedNetwork
    ? [...productTotals.values()]
        .filter((p) => p.network === selectedNetwork)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 15)
    : []

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
  // Fix 4: ranked by the metric the alert actually fires on (success rate),
  // not insertion order, so the bar chart and the table read the same way.
  const dispatchRanked = [...dispatchByNetwork.entries()]
    .map(([network, row]) => ({ network, row, successRate: row.totalAttempts > 0 ? (row.successful / row.totalAttempts) * 100 : 0 }))
    .sort((a, b) => b.successRate - a.successRate)

  // Fix 1 + Fix 5: rate per day (not raw count), so a fixed alert threshold
  // and a previous-period line both mean the same thing on this axis.
  const noReplyRateSeries = dispatchRateByDate(data.dispatch)
  const noReplyTrend = noReplyRateSeries.map((r) => ({ day: dayLabel(r.date), revenue: r.rate }))
  const previousNoReplyRateSeries = prevData ? dispatchRateByDate(prevData.dispatch).map((r) => r.rate) : undefined

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
  const abandonmentTrend = prevAbandonmentRate !== null ? trendOf(abandonmentRate, prevAbandonmentRate) : null

  const marginChart = data.margin.map((m) => ({ day: dayLabel(m.date), revenue: m.avgMarginBp / 100 }))
  const previousMargin = prevData?.margin.map((m) => m.avgMarginBp / 100)

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
  const payoutBuckets = bucketSums(data.payouts, ['paidUnder1h', 'paid1to4h', 'paid4to24h', 'paidOver24h'])
  const requestedChart = data.payouts.map((p) => ({ day: dayLabel(p.date), revenue: p.requestedAmount }))
  const previousRequested = prevData?.payouts.map((p) => p.requestedAmount)
  const paidChart = data.payouts.map((p) => ({ day: dayLabel(p.date), revenue: p.paidAmount }))
  const previousPaid = prevData?.payouts.map((p) => p.paidAmount)

  const totalRefundCount = data.refunds.reduce((sum, r) => sum + r.count, 0)
  const totalRefundAmount = data.refunds.reduce((sum, r) => sum + r.amount, 0)
  const avgRefundTurnaround = weightedAvg(data.refunds.map((r) => ({ count: r.count, avg: r.avgTurnaroundHours })))
  const refundBuckets = bucketSums(data.refunds, ['decidedUnder1h', 'decided1to4h', 'decided4to24h', 'decidedOver24h'])
  const refundChart = data.refunds.map((r) => ({ day: dayLabel(r.date), revenue: r.amount }))
  const previousRefund = prevData?.refunds.map((r) => r.amount)
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
  const applicationBuckets = bucketSums(data.applications, ['decidedUnder1h', 'decided1to4h', 'decided4to24h', 'decidedOver24h'])
  const decidedCount = applicationTotals.approved + applicationTotals.rejected
  const approvalRate = decidedCount > 0 ? (applicationTotals.approved / decidedCount) * 100 : 0

  const solvencyChart = data.solvency.map((s) => ({ day: dayLabel(s.date), revenue: s.freeToSpend }))
  const previousSolvency = prevData?.solvency.map((s) => s.freeToSpend)
  const floatBreachDays = data.float.filter((f) => f.level !== 'ok').length

  const totalNewlyBlocked = data.lostRevenue.reduce((sum, r) => sum + r.newlyBlocked, 0)
  const totalNewlyBlockedValue = data.lostRevenue.reduce((sum, r) => sum + r.newlyBlockedValue, 0)
  const totalResolved = data.lostRevenue.reduce((sum, r) => sum + r.resolved, 0)
  const avgHoursToResolve = weightedAvg(data.lostRevenue.map((r) => ({ count: r.resolved, avg: r.avgHoursToResolve })))
  const lostRevenueBuckets = bucketSums(data.lostRevenue, ['resolvedUnder1h', 'resolved1to4h', 'resolved4to24h', 'resolvedOver24h'])
  const lostRevenueChart = data.lostRevenue.map((r) => ({ day: dayLabel(r.date), revenue: r.newlyBlockedValue }))
  const previousLostRevenue = prevData?.lostRevenue.map((r) => r.newlyBlockedValue)

  // Everything below is a read of numbers already computed above, from the
  // same pipeline every other card on this page reads, not a separate
  // judgement invented for this list. The point is to say what to do about
  // them in one place, instead of making someone read all fifteen cards to
  // find the two that actually need a decision.
  const attentionItems: { tone: 'danger' | 'warning'; text: string }[] = []
  if (latestSolvency && latestSolvency.freeToSpend < 0) {
    attentionItems.push({
      tone: 'danger',
      text: `Free to spend is negative (${cedisCompact(latestSolvency.freeToSpend)}), more is owed than is currently available.`,
    })
  }
  if (latestFloat && latestFloat.level !== 'ok') {
    attentionItems.push({
      tone: latestFloat.level === 'risk' ? 'danger' : 'warning',
      text: `DataHub float is at ${latestFloat.level} level (${cedisCompact(latestFloat.balance)} remaining).`,
    })
  }
  if (latestLostRevenue && latestLostRevenue.stillBlocked > 0) {
    attentionItems.push({
      tone: latestLostRevenue.stillBlockedValue > 0 ? 'danger' : 'warning',
      text: `${latestLostRevenue.stillBlocked} beneficiary number(s) still waiting on approval, worth ${cedisCompact(latestLostRevenue.stillBlockedValue)} in blocked sales.`,
    })
  }
  // Fix 5: same named constants drawn as reference lines/bands below.
  for (const { network, row, successRate } of dispatchRanked) {
    if (row.totalAttempts >= 5 && successRate < DISPATCH_SUCCESS_FLOOR) {
      attentionItems.push({
        tone: 'warning',
        text: `${network} dispatch success is only ${successRate.toFixed(0)}% (${row.successful} of ${row.totalAttempts}), worth raising with DataHub.`,
      })
    }
  }
  if (noReplyRate > NO_REPLY_ALERT_RATE) {
    attentionItems.push({ tone: 'warning', text: `${noReplyRate.toFixed(0)}% of DataHub attempts got no reply at all, not even a failure.` })
  }
  if (abandonmentRate > ABANDONMENT_ALERT_RATE) {
    attentionItems.push({ tone: 'warning', text: `${abandonmentRate.toFixed(0)}% of checkouts started but never paid.` })
  }
  if (totalEscalated > 0) {
    attentionItems.push({ tone: 'danger', text: `${totalEscalated} feedback item(s) escalated as a real bug, needs dev attention.` })
  }
  if (latestHealth && latestHealth.dormantAgents > 0) {
    attentionItems.push({ tone: 'warning', text: `${latestHealth.dormantAgents} active agent(s) have never made a sale.` })
  }

  return (
    <div>
      <PageHead
        title="Analytics"
        subtitle="Business trends, computed on a schedule from a separate warehouse database, never a live query against production."
        action={
          <div className="flex flex-wrap items-start gap-2">
            <DateRangePicker
              label={range.label}
              comparisonLabel={comparisonLabel}
              compareMode={compareMode}
              onCompareModeChange={setCompareMode}
              onPreset={handlePreset}
              onCustomRange={(from, to) => {
                setCustomRange({ from, to })
                setMode('custom')
              }}
            />
            <Button variant="outline" loading={refreshing} onClick={() => void refresh()}>
              Refresh now
            </Button>
            <Button variant="ghost" onClick={() => setRecomputeOpen(true)}>
              Recompute from...
            </Button>
          </div>
        }
      />

      <Modal
        open={recomputeOpen}
        onClose={() => setRecomputeOpen(false)}
        title="Recompute from a date"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRecomputeOpen(false)}>
              Cancel
            </Button>
            <Button loading={recomputing} onClick={() => void recomputeFrom()}>
              Recompute
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          Rewinds the ETL checkpoint and rebuilds every day from the date you pick through today, overwriting
          whatever numbers are already there. Use this after fixing a bug in how a number is computed, not for
          routine use, "Refresh now" already recomputes today on every click.
        </p>
        <TextInput
          type="date"
          aria-label="Recompute from"
          value={recomputeDate}
          onChange={(e) => setRecomputeDate(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
        />
      </Modal>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={`Revenue, ${range.label}`}
          value={cedisCompact(totalRevenue)}
          hint={
            <>
              {cedisCompact(totalProfit)} kept as profit
              <br />
              <TrendBadge trend={revenueTrend} goodDirection="up" />
            </>
          }
          tone="brand"
          icon={<TrendUpIcon className="size-5" />}
        />
        <StatTile
          label="DataHub no-reply rate"
          value={`${noReplyRate.toFixed(1)}%`}
          hint={
            <>
              {totalNoReply} of {totalDispatches} attempts got nothing back
              <br />
              <TrendBadge trend={noReplyTrendStat} goodDirection="down" />
            </>
          }
          tone={noReplyRate > NO_REPLY_ALERT_RATE ? 'warning' : 'neutral'}
          icon={<ClockIcon className="size-5" />}
        />
        <StatTile
          label="Checkout abandonment"
          value={`${abandonmentRate.toFixed(1)}%`}
          hint={
            <>
              {funnelTotals.paid}/{funnelTotals.started} started checkouts actually paid
              <br />
              <TrendBadge trend={abandonmentTrend} goodDirection="down" />
            </>
          }
          tone={abandonmentRate > ABANDONMENT_ALERT_RATE ? 'warning' : 'neutral'}
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
          title="Needs attention"
          subtitle={`${range.label}, everything below is worth a decision, not just a read`}
          tooltip="Every line here is read straight off numbers already on this page, nothing new is computed for this list alone. Red needs a decision now; amber is worth watching."
        />
        <div className="space-y-2 p-4 sm:p-5">
          {attentionItems.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckIcon className="size-4.5 shrink-0" /> Nothing needs your attention right now.
            </p>
          ) : (
            attentionItems.map((item, index) => (
              <p
                key={index}
                className={cn(
                  'flex items-start gap-2 text-sm',
                  item.tone === 'danger' ? 'text-red-700 dark:text-red-400' : 'text-amber-800 dark:text-amber-400',
                )}
              >
                <AlertIcon className="mt-0.5 size-4.5 shrink-0" />
                {item.text}
              </p>
            ))
          )}
        </div>
      </Card>

      <div className="mt-3 lg:flex lg:items-start lg:gap-4">
        <nav
          aria-label="Analytics sections"
          className="mb-3 flex flex-wrap gap-1.5 lg:sticky lg:top-4 lg:mb-0 lg:w-48 lg:shrink-0 lg:flex-col lg:gap-1 lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-white lg:p-2 lg:dark:border-slate-800 lg:dark:bg-slate-900"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              className={cn(
                'rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors',
                tab === t.key
                  ? 'bg-brand-600 text-white dark:bg-brand-500'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 lg:bg-transparent lg:dark:bg-transparent',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
      {tab === 'money' && (
      <>
      <Card className="mt-3 lg:mt-0">
        <CardHead
          title="Reserve position"
          subtitle="What should be sitting at Paystack, what's owed to other people, and what's actually free to spend, as of the most recent day in this range with a reading. Not live: one snapshot per day, read from the trend below, the same way every other number on this page is."
          tooltip="Free to spend is what's at Paystack minus everything owed to agents, customers, and pending payouts. The chart below tracks that number day by day; a dip below zero means more is owed than is currently available."
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
          <StatTile
            label="Free to spend"
            value={latestSolvency ? cedisCompact(latestSolvency.freeToSpend) : '-'}
            hint={latestSolvency ? `As of ${dayLabel(latestSolvency.date)}` : 'No reading in this range'}
            tone={latestSolvency && latestSolvency.freeToSpend < 0 ? 'warning' : 'brand'}
            icon={<CashIcon className="size-5" />}
          />
          <StatTile
            label="Should be at Paystack"
            value={latestSolvency ? cedisCompact(latestSolvency.expectedAtPaystack) : '-'}
            hint={latestSolvency ? `As of ${dayLabel(latestSolvency.date)}` : 'No reading in this range'}
          />
          <StatTile
            label="Owed to other people"
            value={latestSolvency ? cedisCompact(latestSolvency.liabilitiesTotal) : '-'}
            hint={latestSolvency ? `As of ${dayLabel(latestSolvency.date)}` : 'No reading in this range'}
          />
          <StatTile
            label="DataHub float"
            value={latestFloat ? cedisCompact(latestFloat.balance) : latestSolvency?.floatBalance != null ? cedisCompact(latestSolvency.floatBalance) : '-'}
            hint={
              latestFloat
                ? `${latestFloat.level === 'ok' ? 'Healthy' : latestFloat.level === 'watch' ? 'Watch' : 'At risk'} as of ${dayLabel(latestFloat.date)}, ${floatBreachDays} of ${data.float.length} day(s) breached in this range`
                : 'No reading in this range'
            }
            tone={latestFloat?.level === 'risk' ? 'warning' : latestFloat?.level === 'watch' ? 'warning' : 'neutral'}
            icon={<AlertIcon className="size-5" />}
          />
        </div>
        {data.solvency.length > 0 && (
          <div className="border-t border-slate-100 p-4 dark:border-slate-800 sm:p-5">
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              Free to spend, by day. Cannot be backfilled before this feature shipped, so a range that starts earlier than that will show a gap, not missing data.
            </p>
            {/* Fix 1: previous-period overlay. */}
            <LineChart data={solvencyChart} previous={previousSolvency} height={140} />
          </div>
        )}
      </Card>

      {/* Fix 1 (overlay) applied to both; paired side by side, not stacked,
          so reading "revenue vs cost of getting it" costs one card-height on
          desktop instead of two. */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead
            title="Revenue"
            subtitle={`${range.label}, every paid order`}
            tooltip="The solid line is this range; the dashed line is the comparison window named above the range picker (the previous period, or the same period last year). The gap between them is what the trend badge above is reporting."
          />
          <div className="p-4 sm:p-5">
            <LineChart data={revenueChart} previous={previousRevenue} height={180} />
          </div>
        </Card>
        <Card>
          <CardHead
            title="Profit"
            subtitle="Revenue less supplier cost, Paystack's fee, and agent margins, completed orders only"
            tooltip="Same solid-vs-dashed comparison as Revenue, but after supplier cost, Paystack's fee, and agent margins. Where the shaded area dips below the zero line, that day was a loss, not just low revenue."
          />
          <div className="p-4 sm:p-5">
            <LineChart data={profitChart} previous={previousProfit} height={180} />
          </div>
        </Card>
      </div>

      {/* Fix 3: revenue-and-margin combo chart in place of a revenue-only
          donut, so a network/category can't look dominant here and barely
          profitable in the "Profitability" table below with nothing making
          the contradiction visible. */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead
            title="Revenue & profitability by network"
            subtitle={range.label}
            tooltip="Bar height is revenue; the connected dots are profit margin %, on their own scale. A tall bar with a low dot is a network that sells a lot but keeps little of it."
          />
          <div className="p-4 sm:p-5">
            {networkComboRows.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No data yet.</p>
            ) : (
              <RevenueMarginChart
                rows={networkComboRows}
                selected={selectedNetwork}
                onSelect={(label) => setSelectedNetwork((prev) => (prev === label ? null : label))}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHead
            title="Revenue & profitability by category"
            subtitle={range.label}
            tooltip="Same reading as the network chart: bar height is revenue, the dots are profit margin %. A tall bar with a low dot sells well but isn't very profitable."
          />
          <div className="p-4 sm:p-5">
            {categoryComboRows.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No data yet.</p>
            ) : (
              <RevenueMarginChart rows={categoryComboRows} />
            )}
          </div>
        </Card>
      </div>

      {selectedNetwork && (
        <Card className="mt-3">
          <CardHead
            title={`Top products, ${selectedNetwork}`}
            subtitle={`By revenue, ${range.label}`}
            tooltip="Bar length is revenue for this one network's products, ranked highest first. The table alongside has the exact orders, revenue, and profit behind each bar."
            action={
              <button
                type="button"
                onClick={() => setSelectedNetwork(null)}
                aria-label="Close"
                className="relative -mr-1 rounded-lg p-1.5 text-slate-500 before:absolute before:-inset-1.5 before:content-[''] hover:bg-slate-100 hover:text-slate-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              >
                <XIcon className="size-5" />
              </button>
            }
          />
          <div className="grid gap-0 sm:grid-cols-2">
            <div className="border-slate-100 p-4 dark:border-slate-800 sm:border-r sm:p-5">
              {topProductsForNetwork.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No paid orders for this network in this range.</p>
              ) : (
                <RankedBarChart rows={topProductsForNetwork.map((p) => ({ label: p.productName, value: p.revenue }))} valueLabel={cedisCompact} />
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2 sm:px-5">Product</th>
                    <th className="px-4 py-2 text-right sm:px-5">Orders</th>
                    <th className="px-4 py-2 text-right sm:px-5">Revenue</th>
                    <th className="px-4 py-2 text-right sm:px-5">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {topProductsForNetwork.length === 0 ? (
                    <tr>
                      <td className="px-4 py-4 text-slate-500 dark:text-slate-400 sm:px-5" colSpan={4}>
                        No paid orders for this network in this range.
                      </td>
                    </tr>
                  ) : (
                    topProductsForNetwork.map((p) => (
                      <tr key={p.productId}>
                        <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-50 sm:px-5">{p.productName}</td>
                        <td className="tabular px-4 py-2.5 text-right sm:px-5">{p.ordersCount}</td>
                        <td className="tabular px-4 py-2.5 text-right sm:px-5">{cedis(p.revenue)}</td>
                        <td className={cn('tabular px-4 py-2.5 text-right sm:px-5 font-semibold', p.profit < 0 && 'text-red-600 dark:text-red-400')}>
                          {cedis(p.profit)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      <Card className="mt-3">
        <CardHead
          title="Profitability"
          subtitle="Which network and category actually keep money, not just which moves the most of it, completed orders only"
          tooltip="The exact cedis behind the bars and dots above. Sorted by profit, not revenue, so the most profitable row comes first even when it isn't the biggest bar."
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
      </>
      )}

      {tab === 'operations' && (
      <>
      <Card className="mt-3 lg:mt-0">
        <CardHead
          title="DataHub reliability"
          subtitle="How often the delivery partner actually answers, by network"
          tooltip="Bar length is each network's delivery success rate; the vertical line marks the 85% floor that triggers a 'Needs attention' flag. The table has the exact counts behind each bar."
        />
        {/* Fix 4 (ranked bar, beside the table) + Fix 5 (the same
            DISPATCH_SUCCESS_FLOOR line drawn here as `threshold`, not just
            implied by a red badge once a network has already crossed it). */}
        <div className="grid gap-0 sm:grid-cols-2">
          <div className="border-slate-100 p-4 dark:border-slate-800 sm:border-r sm:p-5">
            {dispatchRanked.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No dispatch attempts in this range.</p>
            ) : (
              <RankedBarChart
                rows={dispatchRanked.map((d) => ({ label: d.network, value: d.successRate }))}
                valueLabel={(v) => `${v.toFixed(0)}%`}
                threshold={{ value: DISPATCH_SUCCESS_FLOOR, label: 'Reliability floor', tone: 'warning' }}
                toneForValue={(v) => (v < DISPATCH_SUCCESS_FLOOR ? 'warning' : undefined)}
              />
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 sm:px-5">Network</th>
                  <th className="px-4 py-2 text-right sm:px-5">Success rate</th>
                  <th className="px-4 py-2 text-right sm:px-5">Attempts</th>
                  <th className="px-4 py-2 text-right sm:px-5">No reply</th>
                  <th className="px-4 py-2 text-right sm:px-5">Manual queue</th>
                  <th className="px-4 py-2 text-right sm:px-5">Rejected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {dispatchRanked.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500 dark:text-slate-400 sm:px-5" colSpan={6}>
                      No dispatch attempts in this range.
                    </td>
                  </tr>
                ) : (
                  dispatchRanked.map(({ network, row, successRate }) => (
                    <tr key={network}>
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-50 sm:px-5">{network}</td>
                      <td className="tabular px-4 py-2.5 text-right sm:px-5">
                        {row.totalAttempts >= 5 && successRate < DISPATCH_SUCCESS_FLOOR ? (
                          <Badge tone="warning">{successRate.toFixed(0)}%</Badge>
                        ) : (
                          `${successRate.toFixed(0)}%`
                        )}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right sm:px-5">{row.totalAttempts}</td>
                      <td className="tabular px-4 py-2.5 text-right sm:px-5">{row.noReply}</td>
                      <td className="tabular px-4 py-2.5 text-right sm:px-5">{row.manualQueue}</td>
                      <td className="tabular px-4 py-2.5 text-right sm:px-5">{row.otherFailed}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        {noReplyTrend.some((p) => p.revenue > 0) && (
          <div className="border-t border-slate-100 p-4 dark:border-slate-800 sm:p-5">
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">No-reply rate, by day</p>
            {/* Fix 1 (previous-period overlay) + Fix 5 (NO_REPLY_ALERT_RATE
                drawn as a reference line, same constant `attentionItems` uses). */}
            <LineChart
              data={noReplyTrend}
              previous={previousNoReplyRateSeries}
              height={100}
              valueLabel={(v) => `${v.toFixed(0)}%`}
              label="No-reply rate"
              thresholds={[{ value: NO_REPLY_ALERT_RATE, label: 'Alert threshold', tone: 'warning' }]}
            />
          </div>
        )}
      </Card>
      </>
      )}

      {tab === 'agents' && (
      <>
      <Card className="mt-3 lg:mt-0">
        <CardHead
          title="Top agents"
          subtitle={`By revenue, ${range.label}`}
          tooltip="Bar length is revenue, ranked highest first. The table alongside has the exact orders, revenue, and margin behind each bar."
        />
        {/* Fix 4: ranked bar beside the table, exact values stay in the table. */}
        <div className="grid gap-0 sm:grid-cols-2">
          <div className="border-slate-100 p-4 dark:border-slate-800 sm:border-r sm:p-5">
            {leaderboard.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No sales through an agent in this range.</p>
            ) : (
              <RankedBarChart rows={leaderboard.map((a) => ({ label: a.name, value: a.revenue }))} valueLabel={cedisCompact} />
            )}
          </div>
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
        </div>
      </Card>
      </>
      )}

      {tab === 'payouts-refunds' && (
      <>
      <Card className="mt-3 lg:mt-0">
        <CardHead
          title="Agent payouts"
          subtitle={`${range.label}, keyed by the day requested`}
          tooltip="The strip under 'Time to pay' buckets every payout by how long it actually took, so one slow outlier can't hide inside a fine-looking average."
        />
        <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
          <StatTile label="Requested" value={cedisCompact(totalRequested)} icon={<CashIcon className="size-5" />} />
          <StatTile label="Actually paid" value={cedisCompact(totalPaidOut)} tone="success" />
          <StatTile
            label="Time to pay"
            value={avgHoursToPay > 0 ? `${avgHoursToPay.toFixed(1)}h` : '-'}
            hint="Average, request to payout"
          />
        </div>
        {/* Fix 2: the distribution behind the average above, one slow payout
            can't hide inside a fine-looking mean this way. */}
        <div className="border-t border-slate-100 p-4 dark:border-slate-800 sm:p-5">
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Time to pay, distribution</p>
          <DistributionBar buckets={payoutBuckets} />
        </div>
        <div className="grid gap-4 border-t border-slate-100 p-4 dark:border-slate-800 sm:grid-cols-2 sm:p-5">
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Requested, by day</p>
            <LineChart data={requestedChart} previous={previousRequested} height={100} />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Actually paid, by day</p>
            <LineChart data={paidChart} previous={previousPaid} height={100} />
          </div>
        </div>
      </Card>

      <Card className="mt-3">
        <CardHead
          title="Refunds"
          subtitle={`${range.label}, decided in this window`}
          tooltip="Same turnaround-distribution idea as payouts, for how long a failed order sits before it's refunded. The list beside the reason table ranks which rejection reasons drive the most refunds."
        />
        <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
          <StatTile label="Refunded" value={cedisCompact(totalRefundAmount)} hint={`${totalRefundCount} refund(s)`} />
          <StatTile
            label="Time to decide"
            value={avgRefundTurnaround > 0 ? `${avgRefundTurnaround.toFixed(1)}h` : '-'}
            hint="Average, order failed to refund decided"
          />
          <StatTile label="Networks affected" value={String(refundNetworkTotals.size)} />
        </div>
        {/* Fix 2: distribution behind "Time to decide" above. */}
        <div className="border-t border-slate-100 p-4 dark:border-slate-800 sm:p-5">
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Time to decide, distribution</p>
          <DistributionBar buckets={refundBuckets} />
        </div>
        {totalRefundCount > 0 && (
          <div className="border-t border-slate-100 p-4 dark:border-slate-800 sm:p-5">
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Refunded amount, by day</p>
            <LineChart data={refundChart} previous={previousRefund} height={100} />
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
            {/* Fix 4: ranked bar above its table, same "what's driving it" data. */}
            {topRefundReasons.length > 0 && (
              <div className="border-b border-slate-100 p-4 dark:border-slate-800 sm:p-5">
                <RankedBarChart rows={topRefundReasons.map(([reason, row]) => ({ label: reason, value: row.count }))} />
              </div>
            )}
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
      </>
      )}

      {tab === 'lost-revenue' && (
      <Card className="mt-3 lg:mt-0">
        <CardHead
          title="Lost revenue: numbers waiting on approval"
          subtitle="DataHub blocks a sale to a beneficiary number until it's approved. Every number here is a real sale that couldn't go through, not a hypothetical one."
          tooltip="'Still blocked' is a live count right now; 'Newly blocked' and 'Resolved' are counted per day in the range, so they can be safely added up across days without double-counting."
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
          <StatTile
            label="Still blocked"
            value={String(latestLostRevenue?.stillBlocked ?? 0)}
            hint={latestLostRevenue ? `Worth ${cedisCompact(latestLostRevenue.stillBlockedValue)} right now, as of ${dayLabel(latestLostRevenue.date)}` : 'No reading in this range'}
            tone={latestLostRevenue && latestLostRevenue.stillBlocked > 0 ? 'warning' : 'neutral'}
            icon={<AlertIcon className="size-5" />}
          />
          <StatTile
            label="Newly blocked"
            value={String(totalNewlyBlocked)}
            hint={`${cedisCompact(totalNewlyBlockedValue)} in sales, ${range.label}`}
          />
          <StatTile label="Resolved" value={String(totalResolved)} hint={`Got approved, ${range.label}`} tone="success" />
          <StatTile
            label="Time to resolve"
            value={avgHoursToResolve > 0 ? `${avgHoursToResolve.toFixed(1)}h` : '-'}
            hint="Average, blocked to approved"
          />
        </div>
        {/* Fix 2: distribution behind "Time to resolve" above. */}
        <div className="border-t border-slate-100 p-4 dark:border-slate-800 sm:p-5">
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Time to resolve, distribution</p>
          <DistributionBar buckets={lostRevenueBuckets} />
        </div>
        {lostRevenueChart.some((p) => p.revenue > 0) && (
          <div className="border-t border-slate-100 p-4 dark:border-slate-800 sm:p-5">
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Newly blocked sales value, by day</p>
            <LineChart data={lostRevenueChart} previous={previousLostRevenue} height={100} />
          </div>
        )}
      </Card>
      )}

      {tab === 'agents' && (
      <>
      <div className="mt-3 grid gap-3 lg:grid-cols-2 lg:mt-0">
        <Card>
          <CardHead
            title="Agent network health"
            subtitle="Latest snapshot"
            tooltip="A live read of the agent roster as it stands today, not something that can be recomputed for a past day the way the trend charts elsewhere on this page are."
          />
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
          <CardHead
            title="Referral tree depth"
            subtitle="How deep the downline actually goes, latest snapshot"
            tooltip="Each row is one level of the referral tree; bar length is how many agents sit at that depth. A long tail of thin bars past depth 2 to 3 usually means referrals aren't compounding."
          />
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

      <Card className="mt-3">
          <CardHead
            title="Agent applications"
            subtitle={`${range.label}, applied by signup day, decided by decision day`}
            tooltip="'Applied' counts by signup day; 'approved' and 'rejected' count by decision day, often a different day. A range can show applications with no decision yet, or decisions on people who applied earlier, that's expected."
          />
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
          {/* Fix 2: distribution behind "Time to decide" above. */}
          <div className="border-t border-slate-100 p-4 dark:border-slate-800 sm:p-5">
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Time to decide, distribution</p>
            <DistributionBar buckets={applicationBuckets} />
          </div>
        </Card>
      </>
      )}

      {tab === 'operations' && (
      <>
      <Card className="mt-3 lg:mt-0">
          <CardHead
            title="Feedback"
            subtitle={`${range.label}, by category`}
            tooltip="Escalated is a separate flag from status: a report can be marked resolved and still be flagged as a real bug, so the two counts aren't mutually exclusive."
          />
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

      {/* Paired side by side (not stacked) to cut a card-height off the page,
          same reasoning as the Revenue/Profit pairing above. */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead
            title="Order volume by hour of day"
            subtitle={`${range.label}, when float and staffing actually matter`}
            tooltip="Bar height is total orders in that hour, summed across every day in the range, so a tall bar means that hour is consistently busy, not busy just once."
          />
          <div className="p-4 sm:p-5">
            <BarChart data={hourlyChart} height={160} valueLabel={(v) => String(v)} label="Orders by hour" />
          </div>
        </Card>
        <Card>
          <CardHead
            title="Margin accuracy"
            subtitle="Average margin as a percentage of sale price, completed orders. A falling line means DataHub's real cost is creeping up on the catalogue price."
            tooltip="Compare the dashed previous-period line against the solid one to see whether a falling margin is a new trend or one that's already recovering."
          />
          <div className="p-4 sm:p-5">
            {/* Fix 1: previous-period overlay. */}
            <LineChart data={marginChart} previous={previousMargin} height={160} valueLabel={(v) => `${v.toFixed(1)}%`} label="Average margin" />
          </div>
        </Card>
      </div>
      </>
      )}
        </div>
      </div>
    </div>
  )
}
