import { csvCell } from '../../lib/csv'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
import type { Order, OrderStatus } from '../../data/types'
import { api, ApiError, type FinanceStatement } from '../../lib/api'
import { DispatchModal } from '../../components/DispatchModal'
import {
  Badge,
  Button,
  Callout,
  Card,
  CopyIconButton,
  EmptyState,
  Field,
  Modal,
  NetworkChip,
  PageHead,
  ProviderChip,
  Segmented,
  StatTile,
  Spinner,
  StatusBadge,
  TableWrap,
  TextInput,
  cn,
  Td,
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
  const { pushToast, session } = useStore()
  const isSuperadmin = session?.role === 'superadmin'
  const [searchParams] = useSearchParams()
  const [inspecting, setInspecting] = useState<Order | null>(null)
  const [reversing, setReversing] = useState<Order | null>(null)
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
   * What's actually safe to withdraw right now, the exact same number as
   * the Reserve panel's "Actually free to spend", not a separately computed
   * figure that happens to agree with it. This is a liquidity figure, not
   * profit: it is only what could come out today without touching money a
   * pending order might still need, a refund not yet decided, a bundle
   * still processing, a customer's wallet balance, or money already moved
   * across to fund a supplier float. `allTime.profit` below (revenue less
   * every real cost) is the honest answer to "how much did the business
   * make"; this is the honest answer to "how much of that could I take out
   * this second," and the two are expected to disagree, sometimes by a lot.
   *
   * Deliberately not derived from `visible`/`done` below: that per-order sum
   * only ever looks at completed orders, so it silently drops real, settled
   * costs, the Paystack fee lost on an order that got refunded is the one
   * that actually surfaced this. Fetched once, unaffected by the
   * filter/search above, a figure that changed depending on what you
   * searched for would not be "free to spend right now" any more.
   */
  const [freeToSpendNow, setFreeToSpendNow] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    api
      .reservePosition()
      .then((position) => live && setFreeToSpendNow(position.freeToSpend))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  /**
   * All-time pesewas reimbursed to either supplier's float beyond what its
   * bundles have actually cost it, summed across both, see
   * `FloatMonitorService.capitalSummary`'s own `overReimbursed`.
   * Deliberately not the whole reimbursed total: most of that is honest
   * cost-settlement, money that was always going to leave Paystack for a
   * bundle a supplier already charged for, and calling that "profit turned
   * into capital" would overstate the actual gap. Only this excess was
   * never owed to anything, still inside `allTime.profit` since it was
   * earned, just not free to withdraw at Paystack any more, it's sitting at
   * a supplier float as capital instead. See the Float panel for the full,
   * per-provider breakdown this is drawn from.
   */
  const [profitAtFloat, setProfitAtFloat] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    Promise.all([api.supplierFloat('datahub-gh'), api.supplierFloat('gmpl')])
      .then(([datahub, gmpl]) => live && setProfitAtFloat(datahub.capital.overReimbursed + gmpl.capital.overReimbursed))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  /**
   * `allTime.profit` still counts every open order's full revenue less its
   * Paystack fee, no supplier cost or agent margin subtracted yet, those
   * only book at settlement (`FulfilmentService`). This is the corrected
   * figure, `LedgerService.projectedProfit`, each open order's own frozen
   * split tells us what it will actually cost once it settles, so this is
   * what profit will genuinely be if everything still open finishes
   * successfully, not just today's uncorrected running total.
   */
  const [projectedProfit, setProjectedProfit] = useState<number | null>(null)
  const [earnedProfit, setEarnedProfit] = useState<number | null>(null)
  /** What the owner has taken out, so the cards show profit still here, not all-time. */
  const [ownerDrawings, setOwnerDrawings] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    api
      .projectedProfit()
      .then((result) => {
        if (!live) return
        setProjectedProfit(result.projectedProfit)
        setEarnedProfit(result.earnedProfit)
        setOwnerDrawings(result.ownerDrawings)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  /**
   * All-time totals for the top row, from the ledger, not summed from
   * `orders` below for the same reason `freeToSpendNow` isn't: that list is
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
      'Provider',
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
        o.provider === 'gmpl' ? 'GMPL' : 'DataHub',
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
    const csv = [header, ...csvRows].map((row) => row.map(csvCell).join(',')).join('\n')
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
          <Button data-tour="orders-export" variant="outline" loading={exporting} onClick={() => void exportCsv()}>
            <DownloadIcon className="size-4" /> Export CSV
          </Button>
        }
      />

      <div data-tour="orders-money-tiles" className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          label="Profit now"
          value={earnedProfit === null || ownerDrawings === null ? '-' : cedis(earnedProfit - ownerDrawings)}
          hint={
            earnedProfit === null || ownerDrawings === null
              ? 'Profit from finished sales, less what has already been taken out'
              : `Profit from finished sales still in the business: ${cedis(earnedProfit)} earned all-time, ` +
                `${cedis(ownerDrawings)} already taken out. An order still being delivered counts once it settles`
          }
          tone="success"
        />
        <StatTile
          label="Profit now, once open orders finish"
          value={projectedProfit === null || ownerDrawings === null ? '-' : cedis(projectedProfit - ownerDrawings)}
          hint="Profit now, plus what the orders still being delivered will add if they all succeed, using each order's expected cost. Refunds still owed are left out, that money goes back"
        />
        <StatTile
          label="Free to spend now"
          value={freeToSpendNow === null ? '-' : cedis(freeToSpendNow)}
          hint="Cash, not profit: what you could take out of Paystack today without touching money owed to agents, customers or an order still being delivered. Same as Finance's Actually free to spend. Analytics, Cash tab, explains why it differs from profit earned"
        />
        <StatTile
          label="Profit that became capital"
          value={profitAtFloat === null ? '-' : cedis(profitAtFloat)}
          hint="All-time. Reimbursed to a supplier's float beyond what it was actually owed. Still earned, added back to the profit above until this happened, but a supplier float cannot send it back out, so it no longer counts as yours to take. See the Float panel"
        />
      </div>

      <div data-tour="orders-filters" className="mt-3 mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
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

      <div data-tour="orders-table">
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
                          {order.provider && <ProviderChip provider={order.provider} />}
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
                      <OrderStatusDetails order={order} onWhy={() => setInspecting(order)} onReverse={isSuperadmin ? () => setReversing(order) : undefined} />
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
                        {order.provider && <ProviderChip provider={order.provider} />}
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
                      <OrderStatusDetails order={order} onWhy={() => setInspecting(order)} onReverse={isSuperadmin ? () => setReversing(order) : undefined} />
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
      </div>

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

      <ReverseOutcomeModal
        order={reversing}
        onClose={() => setReversing(null)}
        onReversed={() => setReloadTick((t) => t + 1)}
      />
    </div>
  )
}

function ReverseOutcomeModal({
  order,
  onClose,
  onReversed,
}: {
  order: Order | null
  onClose: () => void
  onReversed: () => void
}) {
  const { pushToast } = useStore()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const key = order?.id ?? 'none'
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) { setLastKey(key); setNote(''); setError('') }

  if (!order) return null

  const newOutcome = order.status === 'completed' ? 'failed' : 'completed'

  const submit = async () => {
    if (note.trim().length < 5) { setError('Say why this is being reversed.'); return }
    setBusy(true)
    try {
      await api.reverseOrderOutcome(order.id, note.trim(), order.status === 'completed' ? 'completed' : 'failed')
      onReversed()
      pushToast({ tone: 'success', title: `${order.reference} reversed to ${newOutcome}` })
      onClose()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not reverse that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Reverse outcome · ${order.reference}`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5 text-sm">
          <p className="font-semibold text-slate-900 dark:text-slate-50">{order.productName}</p>
          <p className="mt-0.5 text-slate-500 dark:text-slate-400">
            Currently <strong>{order.status}</strong> → will become <strong>{newOutcome}</strong>
          </p>
        </div>
        <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
          {order.status === 'completed'
            ? "The agent's credit for this sale is taken back and the customer's refund goes into the Refunds queue for approval."
            : "The agent is credited for this sale and the customer's refund is closed as not owed. A refund already paid to their wallet is taken back; one already sent to Mobile Money blocks this."}{' '}
          Only use this to fix a mistaken mark-as-sent or mark-as-failed.
        </Callout>
        <Field label="Why is this being reversed?" htmlFor="reverse-note" error={error}>
          <TextInput
            id="reverse-note"
            placeholder="Admin mistakenly marked as completed, bundle was not delivered"
            value={note}
            invalid={Boolean(error)}
            onChange={(e) => { setNote(e.target.value); setError('') }}
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" block variant="outline" loading={busy}>Reverse outcome</Button>
          <Button type="button" block disabled={busy} onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
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
/**
 * Asks the provider about this one order now, from its row. Delivered and failed
 * orders are checked again too: a provider can turn a delivered order into a
 * failed one later, and a disagreement is flagged on Needs attention.
 */
function CheckWithProvider({ order }: { order: Order }) {
  const { pushToast } = useStore()
  const [busy, setBusy] = useState(false)
  const check = async () => {
    setBusy(true)
    try {
      const result = await api.checkOrderNow(order.id)
      pushToast({
        tone: result.conflict ? 'error' : result.settled || result.changed ? 'success' : 'info',
        title: `${order.reference}: ${result.conflict ? 'the provider disagrees' : result.changed ? 'changed to match the provider' : result.settled ? 'settled' : 'checked'}`,
        detail: result.message ?? (result.settled ? 'The provider has answered; reload to see it.' : 'Nothing new from the provider.'),
      })
    } catch (caught) {
      pushToast({ tone: 'error', title: caught instanceof ApiError ? caught.message : 'Could not check that order.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void check()}
      className="mt-1 block text-xs font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900 disabled:opacity-60 dark:text-slate-300"
    >
      {busy ? 'Checking…' : 'Check with provider'}
    </button>
  )
}

function OrderStatusDetails({ order, onWhy, onReverse }: { order: Order; onWhy: () => void; onReverse?: () => void }) {
  return (
    <>
      {order.status === 'failed' && order.paymentCollected === false ? (
        <Badge tone="neutral">Not paid</Badge>
      ) : (
        <StatusBadge status={order.status} />
      )}
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
          // A real reference that isn't `manual_`-prefixed: DataHub's own
          // automated path, or simply any GMPL order at all, GMPL has no
          // manual queue of its own, so every one of its references lands
          // here (see `fulfilmentReference`'s own comment).
          title={`${order.provider === 'gmpl' ? 'GMPL' : "DataHub's automated system"} handled this one, a plain reference, not routed to a person.`}
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
      {(order.status === 'failed' || order.status === 'processing' || (onReverse && order.status === 'completed')) && (
        <button
          type="button"
          onClick={onWhy}
          className="mt-1 block text-xs font-semibold text-brand-700 dark:text-brand-300 underline underline-offset-2 hover:text-brand-800"
        >
          {/* A superadmin opens a completed order too, to correct its reference. */}
          {order.status === 'completed' ? 'Details' : 'Why?'}
        </button>
      )}
      {(order.status === 'completed' ||
        order.status === 'processing' ||
        order.status === 'pending' ||
        (order.status === 'failed' && order.paymentCollected !== false)) && <CheckWithProvider order={order} />}
      {onReverse && (order.status === 'completed' || order.status === 'failed') && (
        <button
          type="button"
          onClick={onReverse}
          className="mt-1 block text-xs font-semibold text-red-600 dark:text-red-400 underline underline-offset-2"
          title="Superadmin: reverse this outcome and re-settle with the opposite result"
        >
          Reverse outcome
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


