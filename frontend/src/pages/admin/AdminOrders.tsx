import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
import type { Order, OrderStatus } from '../../data/types'
import { api, type FinanceStatement } from '../../lib/api'
import { DispatchModal } from '../../components/DispatchModal'
import {
  Badge,
  Button,
  Card,
  CopyIconButton,
  EmptyState,
  NetworkChip,
  PageHead,
  Segmented,
  StatTile,
  Spinner,
  StatusBadge,
  TableWrap,
  cn,
  Td,
  TextInput,
  Th,
} from '../../components/ui'
import { AlertIcon, DownloadIcon, ReceiptIcon, SearchIcon } from '../../components/icons'

type Filter = 'all' | OrderStatus | 'unresolved'
const STATUS_VALUES: OrderStatus[] = ['pending', 'processing', 'completed', 'failed']
const LINK_FILTER_VALUES: Filter[] = [...STATUS_VALUES, 'unresolved']
const PAGE_SIZE = 50

/** `YYYY-MM-DD` in the browser's own local date. `daysAgo: 0` is today. */
function dateStr(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** FR-6.3 (all orders) + FR-8.3 (export for record-keeping). */
export default function AdminOrders() {
  const { pushToast } = useStore()
  const [searchParams] = useSearchParams()
  const [inspecting, setInspecting] = useState<Order | null>(null)
  /** `?status=` links here from the Overview page's failed-orders callout. */
  const [filter, setFilter] = useState<Filter>(() => {
    const s = searchParams.get('status')
    return s && LINK_FILTER_VALUES.includes(s as Filter) ? (s as Filter) : 'all'
  })
  const linkedIn = Boolean(searchParams.get('ref') || searchParams.get('status'))
  /**
   * `?ref=` links here from elsewhere (the Overview page's "Needs your
   * attention" card, for one), the same search box, just pre-filled, so
   * landing here shows exactly the one order that was clicked through for.
   */
  const [query, setQuery] = useState(() => searchParams.get('ref') ?? '')
  // Debounced separately from `query` so every keystroke doesn't fire a request.
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  /**
   * Defaults to the last 7 days: an admin opening this page cold almost
   * always wants "what's been happening lately", not every order the
   * platform has ever taken, but a single day is too narrow to be the
   * default, an order placed yesterday shouldn't already need a manual date
   * change to find. Landing via a `?ref=`/`?status=` link is the one
   * exception, an order or a whole status being searched for should not be
   * hidden by a date boundary it doesn't know to clear.
   */
  const [fromDate, setFromDate] = useState(() => (linkedIn ? '' : dateStr(6)))
  const [toDate, setToDate] = useState(() => (linkedIn ? '' : dateStr(0)))

  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [reloadTick, setReloadTick] = useState(0)

  // Any filter change invalidates the current page number.
  useEffect(() => {
    setPage(1)
  }, [filter, fromDate, toDate, debouncedQuery])

  useEffect(() => {
    let live = true
    setLoading(true)
    api
      .adminOrders({
        status: filter === 'all' || filter === 'unresolved' ? undefined : filter,
        unresolvedOnly: filter === 'unresolved',
        from: fromDate || undefined,
        to: toDate || undefined,
        q: debouncedQuery || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((result) => {
        if (!live) return
        setRows(result.rows)
        setTotal(result.total)
        setLoadError(false)
      })
      .catch(() => {
        if (!live) return
        setRows([])
        setTotal(0)
        setLoadError(true)
      })
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [filter, fromDate, toDate, debouncedQuery, page, reloadTick])

  const visible = rows
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  /**
   * "Your profit" is deliberately the exact same number as the Reserve
   * panel's "Actually free to spend", not a separately computed figure that
   * happens to agree with it.
   *
   * James's own definition: profit is only what he could take out today
   * without touching money any pending order might still need, a refund
   * that has not been decided yet, a bundle still processing, a customer's
   * wallet balance. The ledger's all-time revenue-less-costs figure does not
   * satisfy that: it counts a sale's revenue the moment payment is
   * confirmed, before knowing whether the order will actually complete. So
   * this reuses `freeToSpend` itself rather than reconciling two figures
   * that answer different questions, see `SolvencyService.position`.
   *
   * Deliberately not derived from `visible`/`done` below: that per-order sum
   * only ever looks at completed orders, so it silently drops real, settled
   * costs, the Paystack fee lost on an order that got refunded is the one
   * that actually surfaced this. Fetched once, unaffected by the
   * filter/search above, a profit figure that changed depending on what you
   * searched for would not be "your profit" any more.
   */
  const [takeableProfit, setTakeableProfit] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    api
      .reservePosition()
      .then((position) => live && setTakeableProfit(position.freeToSpend))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  /**
   * All-time totals for the top row, from the ledger, not summed from
   * `orders` below for the same reason `takeableProfit` isn't: that list is
   * both capped and, worse, whatever the filter and search box currently
   * show. A customer's payment is real the moment Paystack confirms it,
   * whatever later happens to the order, "Customers paid" summing only
   * `status === 'completed'` orders was silently dropping every failed or
   * refunded sale's money, which is exactly why it read lower than the
   * Reserve panel's "Should be at Paystack" instead of higher.
   */
  const [allTime, setAllTime] = useState<FinanceStatement | null>(null)
  useEffect(() => {
    let live = true
    api
      .financeStatement('all')
      .then((statement) => live && setAllTime(statement))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  // Landed here via `?ref=` naming exactly one order, open it straight away
  // rather than making the click that brought you here do only half the job.
  // The date range is already cleared (see `linkedIn` above) and `query` is
  // seeded with the reference, so the server-side search above should
  // return exactly this one order regardless of when it was placed.
  //
  // Guarded on having already opened for this exact `refParam`: `rows` is
  // in the dependency list so this can retry while the page is still
  // loading, but it also gets a brand-new array reference on every fetch
  // even when nothing about *this* order changed. Without the guard, every
  // refetch would re-fire `setInspecting` with a fresh-but-equal object,
  // which `DispatchModal`'s own reset effect below
  // reads as a genuinely different order and wipes its note field, an
  // admin typing "why" mid-resolve would watch their own keystrokes vanish.
  const refParam = searchParams.get('ref')
  const autoOpenedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!refParam || autoOpenedFor.current === refParam) return
    const match = rows.find((o) => o.reference === refParam)
    if (match) {
      setInspecting(match)
      autoOpenedFor.current = refParam
    }
  }, [rows, refParam])

  /**
   * `split.supplierCost` is frozen at whatever the catalogue believed at
   * sale time. The supplier's own reply, once known, can say something
   * different (`actualSupplierCost`) and that is what actually left the
   * float, and what the ledger's all-time profit is already computed from.
   * Falling back to the estimate keeps every figure below correct even
   * before the supplier has reported back (still processing, or on a
   * currency this admin cannot see the real cost for).
   */
  const actualCostOf = (order: (typeof visible)[number]) =>
    order.actualSupplierCost ?? order.split.supplierCost
  const catalogueDiffOf = (order: (typeof visible)[number]) =>
    order.split.supplierCost - actualCostOf(order)
  const adminMarginOf = (order: (typeof visible)[number]) =>
    order.split.shares.find((s) => s.role === 'admin')?.margin ?? 0
  /**
   * What this order actually made, not what it was priced to make, the
   * recorded split margin plus the catalogue gap. The two are only ever
   * different amounts when the supplier's real charge differs from the
   * estimate; otherwise this equals `adminMarginOf` exactly.
   */
  const trueMarginOf = (order: (typeof visible)[number]) =>
    adminMarginOf(order) + catalogueDiffOf(order)
  const agentMarginOf = (order: (typeof visible)[number]) =>
    order.split.shares.filter((s) => s.role === 'agent').reduce((sum, s) => sum + s.margin, 0)

  const [exporting, setExporting] = useState(false)

  /**
   * Exports everything matching the current filter/dates/search, not just
   * the page on screen, up to the server's own 2000-row cap. That cap is
   * called out explicitly if it's hit rather than silently truncating: a
   * CSV that looks complete but quietly drops rows is worse than a CSV that
   * says so.
   */
  const exportCsv = async () => {
    setExporting(true)
    let exportRows: Order[]
    let matched: number
    try {
      const result = await api.adminOrders({
        status: filter === 'all' || filter === 'unresolved' ? undefined : filter,
        unresolvedOnly: filter === 'unresolved',
        from: fromDate || undefined,
        to: toDate || undefined,
        q: debouncedQuery || undefined,
        page: 1,
        pageSize: 2000,
      })
      exportRows = result.rows
      matched = result.total
    } catch {
      pushToast({ tone: 'error', title: 'Could not export', detail: 'Try again in a moment.' })
      setExporting(false)
      return
    }
    setExporting(false)

    if (matched > exportRows.length) {
      pushToast({
        tone: 'info',
        title: `Showing the first ${exportRows.length.toLocaleString()} of ${matched.toLocaleString()}`,
        detail: 'Narrow the date range or filter to export the rest.',
      })
    }

    const header = [
      'Reference',
      'Date',
      'Sold by',
      'Buyer',
      'Product',
      'Network',
      'Recipient',
      'Customer paid',
      'Paystack fee',
      'Catalogue price',
      'Supplier cost (actual)',
      'Catalogue diff',
      'Your margin (true)',
      'Agent margins',
      'Chain',
      'Paid with',
      'Status',
      'Refunded',
      'DataHub fulfilment',
      'DataHub ticket ID',
      'Resolved by admin',
      'Refund status',
    ]
    const csvRows = exportRows.map((o) => {
      const agentShares = o.split.shares.filter((s) => s.role === 'agent')
      return [
        o.reference,
        o.createdAt,
        o.soldByCode ? `${o.soldByCode}${o.soldByAgentName ? ` (${o.soldByAgentName})` : ''}` : 'direct',
        o.buyer,
        o.productName,
        o.network ?? 'All',
        o.recipient,
        (o.salePrice / 100).toFixed(2),
        o.paystackFee == null ? '' : (o.paystackFee / 100).toFixed(2),
        (o.split.supplierCost / 100).toFixed(2),
        (actualCostOf(o) / 100).toFixed(2),
        // Blank, not a hypothetical figure, until the supplier's real charge
        // is actually known, matches the table's own gate on
        // `actualSupplierCost` (a fresh order priced exactly at catalogue
        // and one nobody has heard back on yet must not read the same).
        o.actualSupplierCost == null ? '' : (catalogueDiffOf(o) / 100).toFixed(2),
        /**
         * Blank for anything short of `completed`. This used to be written
         * unconditionally, so a failed order, one that was never delivered,
         * never paid an agent, and for many rows here never even collected
         * the customer's payment at all (see the blank Paystack fee on
         * those same rows), showed the exact same margin figure as a real
         * sale. `trueMarginOf`/`agentMarginOf` are the split *priced at
         * checkout*, not what actually landed; only a completed order ever
         * turned that price into real money. Matches the table's own gate
         * exactly, this was the one place still showing the hypothetical
         * number as if it were real.
         */
        o.status === 'completed' ? (trueMarginOf(o) / 100).toFixed(2) : '',
        o.status === 'completed' && agentShares.length > 0
          ? (agentShares.reduce((n, s) => n + s.margin, 0) / 100).toFixed(2)
          : '',
        agentShares.map((s) => s.name).join(' → ') || 'none',
        o.paidWith,
        o.status,
        o.refunded ? 'yes' : 'no',
        o.fulfilmentReference ?? '',
        o.manualOrderNumber ?? '',
        o.resolvedManually ? 'yes' : 'no',
        o.refunded ? 'approved' : (o.refundStatus ?? ''),
      ]
    })
    const csv = [header, ...csvRows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'jamesdataconsult-orders.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHead
        title="All orders"
        subtitle="Every order placed on the platform, by anyone."
        action={
          <Button variant="outline" loading={exporting} onClick={() => void exportCsv()}>
            <DownloadIcon className="size-4" /> Export CSV
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Orders matching"
          value={String(total)}
          hint="Follows the filter, dates and search below. The table shows one page of these at a time"
        />
        <StatTile
          label="Customers paid"
          value={allTime === null ? '-' : cedis(allTime.revenue)}
          hint="All-time, every payment ever collected, not affected by the filter, dates or search below"
          tone="brand"
        />
        <StatTile
          label="Paid to supplier"
          value={allTime === null ? '-' : cedis(allTime.costs.supplier)}
          hint="All-time. What they actually charged, not the catalogue estimate"
        />
        <StatTile
          label="Paystack fees"
          value={allTime === null ? '-' : cedis(allTime.costs.paymentFees)}
          hint="All-time. Their cut, paid on every sale"
        />
        <StatTile
          label="Paid to agents"
          value={allTime === null ? '-' : cedis(allTime.costs.agentMargins)}
          hint="All-time. Their commission, never counted as your profit"
        />
        <StatTile
          label="Your profit"
          value={takeableProfit === null ? '-' : cedis(takeableProfit)}
          hint="What you could take out today without touching money a pending order might still need, the same figure as the Reserve panel's Actually free to spend, not affected by the filter, dates or search below"
          tone="success"
        />
      </div>

      <div className="mt-3 mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <Segmented<Filter>
          options={[
            { value: 'all', label: 'All' },
            { value: 'completed', label: 'Completed' },
            { value: 'processing', label: 'Processing' },
            // A processing order stuck with no reply from the delivery
            // partner at all, the same "stuck" definition Needs Attention
            // uses, surfaced here too since not every admin thinks to check
            // a separate page for it.
            { value: 'unresolved', label: 'Unresolved' },
            { value: 'failed', label: 'Failed' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div className="flex flex-wrap items-center gap-2">
          <TextInput
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(event) => setFromDate(event.target.value)}
            aria-label="From date"
            className="w-full sm:w-40"
          />
          <span className="text-sm text-slate-500 dark:text-slate-400">to</span>
          <TextInput
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(event) => setToDate(event.target.value)}
            aria-label="To date"
            className="w-full sm:w-40"
          />
          {(fromDate || toDate) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFromDate('')
                setToDate('')
              }}
            >
              Clear dates
            </Button>
          )}
        </div>
        <div className="relative sm:w-72">
          <SearchIcon className="absolute inset-y-0 left-3 my-auto size-4 text-slate-500 dark:text-slate-400" />
          <TextInput
            placeholder="Number, reference, agent or product"
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search all orders"
          />
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="py-10 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        ) : loadError ? (
          <EmptyState
            icon={<AlertIcon className="size-6" />}
            title="Could not load orders"
            detail="Try again in a moment."
            action={
              <Button variant="outline" onClick={() => setReloadTick((t) => t + 1)}>
                Retry
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<ReceiptIcon className="size-6" />}
            title="No orders matched"
            detail="Adjust the filter, dates or search."
            action={
              <Button variant="outline" onClick={() => setQuery('')}>
                Clear search
              </Button>
            }
          />
        ) : (
          <>
            {/* Reading one order's financials by scrolling column-by-column
                doesn't work on a phone, below `sm` this renders the same
                rows as cards instead, financial figures stacked as
                label/value pairs rather than columns. */}
            <div className="space-y-2 p-3 sm:hidden">
              {visible.map((order) => {
                const agentShares = order.split.shares.filter((s) => s.role === 'agent')
                return (
                  <div
                    key={order.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900 dark:text-slate-50">
                          {order.productName}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <NetworkChip network={order.network} />
                          <span className="tabular text-xs text-slate-500 dark:text-slate-400">
                            {order.reference}
                          </span>
                        </div>
                      </div>
                      <p className="tabular shrink-0 font-semibold text-slate-900 dark:text-slate-50">
                        {cedis(order.salePrice)}
                      </p>
                    </div>

                    <div className="mt-2">
                      {agentShares.length > 0 ? (
                        <p className="text-sm text-slate-800 dark:text-slate-100">
                          {agentShares.map((s) => s.name).join(' ← ')}
                        </p>
                      ) : (
                        <Badge tone="neutral">Direct sale</Badge>
                      )}
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        to {order.recipient} · {order.buyer} · {dateTime(order.createdAt)}
                      </p>
                    </div>

                    <div className="mt-2">
                      <OrderStatusDetails order={order} onWhy={() => setInspecting(order)} />
                    </div>

                    <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-100 dark:border-slate-800 pt-2.5 text-sm">
                      <FinancialFigure label="Paystack fee" value={order.paystackFee == null ? '-' : cedis(order.paystackFee)} />
                      <FinancialFigure label="Catalogue price" value={cedis(order.split.supplierCost)} />
                      <FinancialFigure label="Actual cost" value={cedis(actualCostOf(order))} />
                      <FinancialFigure
                        label="Catalogue P/L"
                        value={order.actualSupplierCost == null ? '-' : cedis(catalogueDiffOf(order), { sign: true })}
                        tone={
                          order.actualSupplierCost == null
                            ? 'neutral'
                            : catalogueDiffOf(order) > 0
                              ? 'positive'
                              : catalogueDiffOf(order) < 0
                                ? 'negative'
                                : 'neutral'
                        }
                      />
                      <FinancialFigure
                        label="Your profit"
                        value={order.status === 'completed' ? cedis(trueMarginOf(order), { sign: true }) : '-'}
                        tone="brand"
                      />
                      <FinancialFigure
                        label="Agents"
                        value={order.status === 'completed' && agentShares.length > 0 ? cedis(agentMarginOf(order)) : '-'}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="hidden sm:block">
            <TableWrap caption="All orders on the platform, with the split per order">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Sold through</Th>
                <Th>Recipient</Th>
                <Th>Status</Th>
                <Th align="right">Customer paid</Th>
                <Th align="right">Paystack fee</Th>
                <Th align="right">Catalogue price</Th>
                <Th align="right">Actual cost</Th>
                <Th align="right">Catalogue P/L</Th>
                <Th align="right">Your profit</Th>
                <Th align="right">Agents</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => {
                const agentShares = order.split.shares.filter((s) => s.role === 'agent')
                return (
                  <tr key={order.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <Td>
                      <p className="font-medium text-slate-900 dark:text-slate-50">{order.productName}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <NetworkChip network={order.network} />
                        <span className="tabular text-xs text-slate-500 dark:text-slate-400">{order.reference}</span>
                      </div>
                    </Td>
                    <Td>
                      {agentShares.length > 0 ? (
                        <p className="text-slate-800 dark:text-slate-100">
                          {agentShares.map((s) => s.name).join(' ← ')}
                        </p>
                      ) : (
                        <Badge tone="neutral">Direct sale</Badge>
                      )}
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {order.buyer} · {dateTime(order.createdAt)}
                      </p>
                    </Td>
                    <Td className="tabular">{order.recipient}</Td>
                    <Td>
                      <OrderStatusDetails order={order} onWhy={() => setInspecting(order)} />
                    </Td>
                    <Td align="right" className="tabular font-semibold text-slate-900 dark:text-slate-50">
                      {cedis(order.salePrice)}
                    </Td>
                    <Td align="right" className="tabular text-slate-500 dark:text-slate-400">
                      {/* Null, not zero, either a wallet-paid order (no fresh
                          fee, it was already paid once at top-up time) or one
                          Paystack didn't report a fee for, never a free sale. */}
                      {order.paystackFee == null ? '-' : cedis(order.paystackFee)}
                    </Td>
                    <Td align="right" className="tabular text-slate-500 dark:text-slate-400">
                      {cedis(order.split.supplierCost)}
                    </Td>
                    <Td align="right" className="tabular text-slate-500 dark:text-slate-400">
                      {cedis(actualCostOf(order))}
                    </Td>
                    <Td
                      align="right"
                      className={cn(
                        'tabular font-semibold',
                        order.actualSupplierCost == null
                          ? 'text-slate-400 dark:text-slate-500'
                          : catalogueDiffOf(order) > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : catalogueDiffOf(order) < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-slate-500 dark:text-slate-400',
                      )}
                    >
                      {/* Null, not zero, until the supplier's real charge is
                          actually known, a fresh order priced exactly at
                          catalogue and one nobody has heard back on yet must
                          not read the same. */}
                      {order.actualSupplierCost == null
                        ? '-'
                        : cedis(catalogueDiffOf(order), { sign: true })}
                    </Td>
                    <Td align="right" className="tabular font-semibold text-brand-700 dark:text-brand-300">
                      {order.status === 'completed' ? cedis(trueMarginOf(order), { sign: true }) : '-'}
                    </Td>
                    <Td align="right" className="tabular text-slate-600 dark:text-slate-300">
                      {order.status === 'completed' && agentShares.length > 0
                        ? cedis(agentMarginOf(order))
                        : '-'}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
            </TableWrap>
            </div>
          </>
        )}
      </Card>

      {!loading && !loadError && total > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Page {page} of {totalPages} · {total.toLocaleString()} order{total === 1 ? '' : 's'} match
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <DispatchModal order={inspecting} onClose={() => setInspecting(null)} />
    </div>
  )
}

/** One label/value line in the mobile card fallback, the table's columns, stacked instead of scrolled. */
function FinancialFigure({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'positive' | 'negative' | 'brand'
}) {
  return (
    <div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={cn(
          'tabular font-semibold',
          tone === 'brand'
            ? 'text-brand-700 dark:text-brand-300'
            : tone === 'positive'
              ? 'text-emerald-600 dark:text-emerald-400'
              : tone === 'negative'
                ? 'text-red-600 dark:text-red-400'
                : 'text-slate-700 dark:text-slate-200',
        )}
      >
        {value}
      </p>
    </div>
  )
}

/**
 * Every badge/note about how an order settled, shared between the desktop
 * table's Status column and the mobile card fallback below, so the two never
 * drift out of sync with each other.
 */
function OrderStatusDetails({ order, onWhy }: { order: Order; onWhy: () => void }) {
  return (
    <>
      <StatusBadge status={order.status} />
      {order.dispatchUnresolved && (
        <span
          className="ml-1.5 inline-block"
          title="The delivery partner never answered at all, no reference exists for the automatic check to use. This will sit exactly like this until a person looks."
        >
          <Badge tone="warning">Unresolved</Badge>
        </span>
      )}
      {/*
          "Failed" alone flattens two very different things into one word: a
          customer who paid and DataHub couldn't deliver (money is owed back,
          see the refund badges below) versus a customer who never actually
          paid at all, an abandoned Paystack checkout, or a recipient the
          supplier rejected before any charge went through. `refundRequest` is
          only ever created when `FulfilmentService.settle` found money had
          been collected (see its own `collected` check), so its absence,
          `refunded` false and `refundStatus` null, on a failed order is the
          one reliable sign nothing was ever taken and there is nothing to
          chase or refund here.
      */}
      {order.status === 'failed' && !order.refunded && !order.refundStatus && (
        <span
          className="ml-1.5 inline-block"
          title="No refund needed here, this closed before the customer's payment ever went through, either they abandoned the checkout or the recipient number was rejected before any charge was collected."
        >
          <Badge tone="neutral">Never paid</Badge>
        </span>
      )}
      {order.refunded && (
        <Badge tone="info" className="ml-1.5">
          Refunded
        </Badge>
      )}
      {order.refundStatus === 'pending' && (
        <span
          className="ml-1.5 inline-block"
          title="This money is owed back and nobody has approved paying it yet, a person always decides a refund, so this is waiting on a click, not automation."
        >
          <Badge tone="warning">Refund pending</Badge>
        </span>
      )}
      {order.refundStatus === 'rejected' && (
        <span
          className="ml-1.5 inline-block"
          title="An admin looked at this refund request and refused it, no money moved."
        >
          <Badge tone="danger">Refund rejected</Badge>
        </span>
      )}
      {order.fulfilmentReference === 'manual' && (
        <span className="ml-1.5 inline-flex items-center gap-1">
          {/* Deliberately not just "Manual", this app also has
              "resolve manually" (an admin forcing a stuck order's
              outcome by hand), a completely different thing. A
              bare "Manual" badge here would read as that instead
              of what it actually means: DataHub routed this to
              one of their own staff, nobody on our side touched it. */}
          <span
            title="DataHub routed this one to a person on their side to clear by hand, not their automated system, it can take much longer to settle than a normal order. Not the same thing as resolving an order manually here."
          >
            <Badge tone="warning">
              DataHub manual{order.manualOrderNumber ? ` · ${order.manualOrderNumber}` : ''}
            </Badge>
          </span>
          {/* DataHub's own ticket ID for this one, what to quote
              back to their support if it needs chasing. */}
          {order.manualOrderNumber && <CopyIconButton value={order.manualOrderNumber} />}
        </span>
      )}
      {order.fulfilmentReference === 'code' && (
        <span
          className="ml-1.5 inline-block"
          title="DataHub's automated system handled this one, a plain reference, not routed to a person."
        >
          <Badge tone="neutral">Code</Badge>
        </span>
      )}
      {/* Who on OUR side decided this outcome, separate from,
          and shown next to, whatever DataHub's own badge above
          says. An admin clicking "mark as delivered/failed" and
          DataHub routing to their manual queue are unrelated
          facts; an order can be either, both, or neither. */}
      {order.resolvedManually && (
        <span
          className="ml-1.5 inline-block"
          title="An admin forced this order's outcome by hand, DataHub's own webhook or polling never confirmed it."
        >
          <Badge tone="info">Resolved by admin</Badge>
        </span>
      )}
      {/* "Failed" flattens a dead float, an unapproved
          recipient and a withdrawn bundle into one word. The
          difference decides what to do about it, so it is one
          click away rather than a database query. */}
      {(order.status === 'failed' || order.status === 'processing') && (
        <button
          type="button"
          onClick={onWhy}
          className="mt-1 block text-xs font-semibold text-brand-700 dark:text-brand-300 underline underline-offset-2 hover:text-brand-800"
        >
          Why?
        </button>
      )}
      {/* When it actually finished, not just when it was placed,
          `completedAt` is exact; a failed order has no
          dedicated column for this, so `failedAt` is read off
          the refund request settled in the same moment. */}
      {(order.completedAt || order.failedAt) && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Finished {dateTime(order.completedAt ?? order.failedAt ?? '')}
        </p>
      )}
    </>
  )
}


