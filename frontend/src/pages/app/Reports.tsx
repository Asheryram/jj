import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { api, type MyReportSummary } from '../../lib/api'
import { cedis } from '../../lib/format'
import { CATEGORY_META, CATEGORY_ORDER } from '../../components/categories'
import { BarChart, Donut } from '../../components/charts'
import {
  Button,
  Card,
  CardHead,
  Field,
  PageHead,
  Segmented,
  StatTile,
  TableWrap,
  Td,
  TextInput,
  Th,
} from '../../components/ui'
import { CashIcon, DownloadIcon, ReceiptIcon, TrendUpIcon } from '../../components/icons'

type Range = '7d' | '30d' | 'custom'

const isoDate = (date: Date) => date.toISOString().slice(0, 10)
const daysAgo = (days: number) => isoDate(new Date(Date.now() - days * 86_400_000))

/** FR-8.2 — an agent's own sales summary for a chosen date range. */
export default function Reports() {
  const { orders, session, myShareOf, agentEarningsByDay } = useStore()
  const isAgent = session?.role === 'agent'
  const [range, setRange] = useState<Range>('7d')
  const [from, setFrom] = useState(() => daysAgo(7))
  const [to, setTo] = useState(() => isoDate(new Date()))

  const windowFrom = range === 'custom' ? from : range === '7d' ? daysAgo(7) : daysAgo(30)
  const windowTo = range === 'custom' ? to : isoDate(new Date())

  /**
   * The headline figures — revenue, profit, failed count, category split —
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

  // NFR-2.5 — this report covers only the signed-in user's own book.
  const mine = useMemo(() => {
    if (!session) return []
    return isAgent
      ? orders.filter((o) => o.split.shares.some((s) => s.userId === session.id))
      : orders.filter((o) => o.buyer === session.name)
  }, [isAgent, orders, session])

  // Only feeds the CSV export below — the on-screen figures come from `summary`.
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
        <div className="flex flex-wrap items-end gap-3">
          <Segmented<Range>
            options={[
              { value: '7d', label: 'Last 7 days' },
              { value: '30d', label: 'Last 30 days' },
              { value: 'custom', label: 'Custom' },
            ]}
            value={range}
            onChange={setRange}
          />
          {range === 'custom' && (
            <>
              <Field label="From" htmlFor="from" className="w-40">
                <TextInput
                  id="from"
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </Field>
              <Field label="To" htmlFor="to" className="w-40">
                <TextInput
                  id="to"
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </Field>
            </>
          )}
        </div>
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
    </div>
  )
}
