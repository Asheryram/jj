import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { api, type MyReportSummary, type TopCustomer } from '../../lib/api'
import { cedis } from '../../lib/format'
import { CATEGORY_META, CATEGORY_ORDER } from '../../components/categories'
import { BarChart, Donut } from '../../components/charts'
import { Button, Card, CardHead, EmptyState, PageHead, StatTile, TableWrap, Td, Th } from '../../components/ui'
import { DateRangePicker, type PresetKey } from '../../components/DateRangePicker'
import { CashIcon, DownloadIcon, ReceiptIcon, TrendUpIcon, UsersIcon } from '../../components/icons'

function toDateInt(date: Date): number {
  return date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate()
}
function daysAgoInt(days: number): number {
  return toDateInt(new Date(Date.now() - days * 86_400_000))
}
function dateIntToIso(dateInt: number): string {
  const y = Math.floor(dateInt / 10_000)
  const m = Math.floor((dateInt % 10_000) / 100)
  const d = dateInt % 100
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** `today`/`yesterday`/`thisMonth`/... resolve every time they're picked, `custom` and `recent` (the last7/30/90 presets) need state, see `Analytics.tsx`'s identical split. Duplicated rather than imported: `DateRangePicker` deliberately has no dependency on either page's internals, see its own comment. */
type RangeMode = 'recent' | 'today' | 'yesterday' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear' | 'quarterToDate' | 'yearToDate' | 'custom'

interface PickedRange {
  from: number
  to: number
  label: string
}

function monthRange(year: number, month: number): PickedRange {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { from: year * 10_000 + month * 100 + 1, to: year * 10_000 + month * 100 + lastDay, label }
}

function buildRange(mode: RangeMode, recentDays: number, customRange: { from: number; to: number } | null): PickedRange {
  if (mode === 'today' || mode === 'yesterday') {
    const dateInt = mode === 'today' ? toDateInt(new Date()) : daysAgoInt(1)
    return { from: dateInt, to: dateInt, label: mode === 'today' ? 'Today' : 'Yesterday' }
  }
  if (mode === 'thisMonth' || mode === 'lastMonth') {
    const now = new Date()
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
    return { ...customRange, label: `${dateIntToIso(customRange.from)} to ${dateIntToIso(customRange.to)}` }
  }
  return { from: daysAgoInt(recentDays), to: toDateInt(new Date()), label: `Last ${recentDays} days` }
}

/** FR-8.2, an agent's own sales summary for a chosen date range, same range picker as `Analytics.tsx`. */
export default function Reports() {
  const { orders, session, myShareOf, agentEarningsByDay } = useStore()
  const isAgent = session?.role === 'agent'
  const [mode, setMode] = useState<RangeMode>('recent')
  const [recentDays, setRecentDays] = useState(7)
  const [customRange, setCustomRange] = useState<{ from: number; to: number } | null>(null)

  const range = useMemo(() => buildRange(mode, recentDays, customRange), [mode, recentDays, customRange])
  const handlePreset = (preset: PresetKey) => {
    if (preset === 'last7' || preset === 'last30' || preset === 'last90') {
      setRecentDays(preset === 'last7' ? 7 : preset === 'last30' ? 30 : 90)
      setMode('recent')
      return
    }
    setMode(preset)
  }
  const handleCustomRange = (from: number, to: number) => {
    setCustomRange({ from, to })
    setMode('custom')
  }

  const windowFrom = dateIntToIso(range.from)
  const windowTo = dateIntToIso(range.to)

  /**
   * The headline figures, revenue, profit, failed count, category split,
   * come from the backend, aggregated over the real `windowFrom`/`windowTo`
   * range. This used to be derived from whatever orders were already sitting
   * in the client store (capped at 500, and only the most recent of those),
   * which silently undercounted the moment an agent's or customer's true
   * total for the chosen range passed that cap. `AdminService.myReport` on
   * the backend does the actual counting now; the CSV export below is the
   * one thing still built from the client list, since a per-row export needs
   * the individual orders anyway.
   */
  const [summary, setSummary] = useState<MyReportSummary | null>(null)
  useEffect(() => {
    let live = true
    api
      .myReportSummary(windowFrom, windowTo)
      .then((result) => live && setSummary(result))
      .catch(() => live && setSummary(null))
    return () => {
      live = false
    }
  }, [windowFrom, windowTo])

  // Customers have no customers of their own, `AdminService.myTopCustomers` is agent-only.
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([])
  useEffect(() => {
    if (!isAgent) return
    let live = true
    api
      .myTopCustomers(windowFrom, windowTo)
      .then((result) => live && setTopCustomers(result))
      .catch(() => live && setTopCustomers([]))
    return () => {
      live = false
    }
  }, [isAgent, windowFrom, windowTo])

  // NFR-2.5, this report covers only the signed-in user's own book.
  const mine = useMemo(() => {
    if (!session) return []
    return isAgent
      ? orders.filter((o) => o.split.shares.some((s) => s.userId === session.id))
      : orders.filter((o) => o.buyer === session.name)
  }, [isAgent, orders, session])

  // Only feeds the CSV export below, the on-screen figures come from `summary`.
  const filtered = useMemo(
    () => mine.filter((o) => o.createdAt >= windowFrom && o.createdAt <= `${windowTo}T23:59:59`),
    [mine, windowFrom, windowTo],
  )

  const revenue = summary?.revenue ?? 0
  const profit = summary?.profit ?? 0
  const failed = summary?.failedCount ?? 0
  const completedCount = summary?.completedCount ?? 0

  const byCategory = CATEGORY_ORDER.map((category) => {
    const row = summary?.byCategory.find((r) => r.category === category)
    return { label: CATEGORY_META[category].label, value: row?.revenue ?? 0, orders: row?.orders ?? 0 }
  }).filter((row) => row.orders > 0)

  const exportCsv = () => {
    const header = [
      'Reference',
      'Date',
      'Product',
      'Network',
      'Recipient',
      'Customer paid',
      'You earned',
      'Levels below you',
      'Status',
    ]
    const rows = filtered.map((o) => {
      const share = myShareOf(o)
      return [
        o.reference,
        o.createdAt,
        o.productName,
        o.network ?? 'All',
        o.recipient,
        (o.salePrice / 100).toFixed(2),
        ((share?.margin ?? 0) / 100).toFixed(2),
        String(share?.depth ?? 0),
        o.status,
      ]
    })
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `jamesdataconsult-sales-${windowFrom}-to-${windowTo}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHead
        title={isAgent ? 'Sales summary' : 'My spending'}
        subtitle="Pick a range to see how much you moved and what you kept."
        action={
          <Button variant="outline" onClick={exportCsv}>
            <DownloadIcon className="size-4" /> Export CSV
          </Button>
        }
      />

      <Card className="p-4">
        <DateRangePicker label={range.label} onPreset={handlePreset} onCustomRange={handleCustomRange} />
      </Card>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={isAgent ? 'Volume sold' : 'Total spent'}
          value={cedis(revenue)}
          hint={`${completedCount} completed orders`}
          tone="brand"
          icon={<CashIcon className="size-5" />}
        />
        {isAgent && (
          <StatTile
            label="You earned"
            value={cedis(profit)}
            hint="Your margin on every sale in your chain"
            tone="success"
            icon={<TrendUpIcon className="size-5" />}
          />
        )}
        <StatTile
          label="Average order"
          value={cedis(completedCount > 0 ? Math.round(revenue / completedCount) : 0)}
          icon={<ReceiptIcon className="size-5" />}
        />
        <StatTile
          label="Failed orders"
          value={String(failed)}
          hint={failed > 0 ? 'All refunded automatically' : 'Nothing failed'}
          tone={failed > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHead title="Daily sales" subtitle="Last 7 days" />
          <div className="p-4 sm:p-5">
            <BarChart data={agentEarningsByDay} />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHead title="What sells" subtitle="Share of revenue by category" />
          <div className="p-4 sm:p-5">
            <Donut
              segments={byCategory}
              total={revenue}
              centreLabel="Revenue"
              centreValue={cedis(revenue).replace('GHS ', '')}
            />
          </div>
        </Card>
      </div>

      <Card className="mt-3">
        <CardHead title="Breakdown by category" />
        <TableWrap caption="Revenue breakdown by category">
          <thead>
            <tr>
              <Th>Category</Th>
              <Th align="right">Orders</Th>
              <Th align="right">Revenue</Th>
              <Th align="right">Share</Th>
            </tr>
          </thead>
          <tbody>
            {byCategory.map((row) => (
              <tr key={row.label} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                <Td className="font-medium text-slate-900 dark:text-slate-50">{row.label}</Td>
                <Td align="right" className="tabular">
                  {row.orders}
                </Td>
                <Td align="right" className="tabular font-semibold text-slate-900 dark:text-slate-50">
                  {cedis(row.value)}
                </Td>
                <Td align="right" className="tabular text-slate-500 dark:text-slate-400">
                  {revenue > 0 ? Math.round((row.value / revenue) * 100) : 0}%
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {isAgent && (
        <Card className="mt-3">
          <CardHead title="Top customers" subtitle="Ranked by completed spend in this range" />
          {topCustomers.length === 0 ? (
            <EmptyState
              icon={<UsersIcon className="size-6" />}
              title="No completed sales in this range yet"
              detail="Top customers will show up here once orders complete."
            />
          ) : (
            <TableWrap caption="Top customers by spend">
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th align="right">Orders</Th>
                  <Th align="right">Spent</Th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((c) => (
                  <tr key={c.buyerPhone} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <Td className="font-medium text-slate-900 dark:text-slate-50">
                      {c.buyer}
                      <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">{c.buyerPhone}</span>
                    </Td>
                    <Td align="right" className="tabular">
                      {c.ordersCount}
                    </Td>
                    <Td align="right" className="tabular font-semibold text-slate-900 dark:text-slate-50">
                      {cedis(c.totalSpend)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}
    </div>
  )
}
