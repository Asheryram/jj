import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../state/store'
import { useShopPath } from '../../lib/shopPath'
import { useSearchParamState } from '../../lib/useSearchParamState'
import { cedis, dateTime } from '../../lib/format'
import { api, ApiError, type MyOrdersPage } from '../../lib/api'
import type { Order } from '../../data/types'
import {
  Badge,
  Button,
  Callout,
  Card,
  CopyField,
  EmptyState,
  Modal,
  NetworkChip,
  PageHead,
  Segmented,
  Spinner,
  StatusBadge,
  TableWrap,
  Td,
  TextInput,
  Th,
} from '../../components/ui'
import { CertificateIcon, ReceiptIcon, SearchIcon } from '../../components/icons'

type Filter = 'all' | 'completed' | 'processing' | 'failed' | 'unpaid'

const PAGE_SIZE = 25

/**
 * The customer never paid: a checkout still open, or one that failed before
 * any money was taken. Not a failed delivery, nothing is owed either way.
 */
function isUnpaid(order: Order): boolean {
  return order.status === 'awaiting_payment' || (order.status === 'failed' && order.paymentCollected === false)
}

/** `StatusBadge`, except an order that failed unpaid says so instead of "Failed". */
function OrderStatus({ order }: { order: Order }) {
  if (order.status === 'failed' && order.paymentCollected === false) return <Badge tone="neutral">Not paid</Badge>
  return <StatusBadge status={order.status} />
}

type Range = 'all' | 'today' | '7d' | '30d' | 'custom'

/** `YYYY-MM-DD` for a day `daysAgo` before today, in UTC (Ghana's own time). */
function isoDay(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
}

/** The from/to a preset stands for; a custom range is typed in. */
function rangeDates(range: Range, from: string, to: string): { from?: string; to?: string } {
  if (range === 'today') return { from: isoDay(), to: isoDay() }
  if (range === '7d') return { from: isoDay(6), to: isoDay() }
  if (range === '30d') return { from: isoDay(29), to: isoDay() }
  if (range === 'custom') return { from: from || undefined, to: to || undefined }
  return {}
}

/** FR-6.1, the signed-in user's own orders, a page at a time, for any range of days. */
export default function Orders() {
  const { orders, session, myShareOf } = useStore()
  const shopPath = useShopPath()
  const [filter, setFilter] = useSearchParamState('filter', 'all') as [Filter, (v: Filter) => void]
  const [query, setQuery] = useSearchParamState('q')
  const [range, setRange] = useSearchParamState('range', 'all') as [Range, (v: Range) => void]
  const [customFrom, setCustomFrom] = useSearchParamState('from')
  const [customTo, setCustomTo] = useSearchParamState('to')
  const dates = rangeDates(range, customFrom, customTo)
  const [selected, setSelected] = useState<Order | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState(query.trim())
  const [data, setData] = useState<MyOrdersPage | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  const isAgent = session?.role === 'agent'

  // Wait for a pause in typing, one request per search, not one per letter.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => setPage(1), [filter, search, dates.from, dates.to])

  // The store tracks orders settling in the background, so a status changing
  // there is the cue to read this page again.
  const statuses = useMemo(() => orders.map((o) => `${o.id}:${o.status}`).join(), [orders])

  useEffect(() => {
    let live = true
    api
      .myOrders({
        view: filter === 'all' ? undefined : filter,
        q: search || undefined,
        page,
        pageSize: PAGE_SIZE,
        from: dates.from,
        to: dates.to,
      })
      .then((result) => {
        if (!live) return
        setData(result)
        setError('')
      })
      .catch((caught) => {
        if (live) setError(caught instanceof ApiError ? caught.message : 'We could not load your orders.')
      })
    return () => {
      live = false
    }
  }, [filter, search, page, statuses, retry, dates.from, dates.to])

  const visible = data?.rows ?? []
  const summary = data?.summary
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div>
      <div data-tour="agent-sales-summary">
      <PageHead
        title={isAgent ? 'Sales' : 'My orders'}
        subtitle={
          isAgent
            ? summary
              ? `${summary.all} orders · ${cedis(summary.earned)} earned · ${summary.failed} failed · ${summary.unpaid} not paid`
              : undefined
            : summary
              ? `${summary.all} orders · ${summary.completed} completed`
              : undefined
        }
      />
      </div>

      {/* Which days: the totals above and the list below both follow it. */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Segmented<Range>
          options={[
            { value: 'all', label: 'All time' },
            { value: 'today', label: 'Today' },
            { value: '7d', label: '7 days' },
            { value: '30d', label: '30 days' },
            { value: 'custom', label: 'Pick dates' },
          ]}
          value={range}
          onChange={setRange}
        />
        {range === 'custom' && (
          <div className="flex items-center gap-2">
            <TextInput
              type="date"
              aria-label="From"
              value={customFrom}
              max={customTo || isoDay()}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="w-full sm:w-40"
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">to</span>
            <TextInput
              type="date"
              aria-label="To"
              value={customTo}
              min={customFrom || undefined}
              max={isoDay()}
              onChange={(event) => setCustomTo(event.target.value)}
              className="w-full sm:w-40"
            />
          </div>
        )}
      </div>

      <div data-tour="agent-sales-filters" className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Filter>
          options={[
            { value: 'all', label: `All ${summary?.all ?? ''}` },
            { value: 'completed', label: `Completed ${summary?.completed ?? ''}` },
            { value: 'processing', label: `In progress ${summary?.processing ?? ''}` },
            { value: 'failed', label: `Failed ${summary?.failed ?? ''}` },
            { value: 'unpaid', label: `Not paid ${summary?.unpaid ?? ''}` },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div className="relative sm:w-64">
          <SearchIcon className="absolute inset-y-0 left-3 my-auto size-4 text-slate-500 dark:text-slate-400" />
          <TextInput
            placeholder="Number, reference or product"
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search orders"
          />
        </div>
      </div>

      <div data-tour="agent-sales-list">
      {error && (
        <Callout tone="danger" className="mb-3">
          {error}{' '}
          <button type="button" className="font-semibold underline" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </Callout>
      )}
      <Card>
        {!data && !error ? (
          <div className="py-10 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<ReceiptIcon className="size-6" />}
            title={query ? 'Nothing matched that search' : 'No orders in this view'}
            detail={
              query
                ? 'Check the number or reference and try again.'
                : isAgent
                  ? 'Share your sell link and the orders your customers place will appear here.'
                  : 'When you buy a bundle it appears here with its delivery status.'
            }
            action={
              query ? (
                <Button variant="outline" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              ) : (
                <Link to={isAgent ? '/app/referrals' : shopPath('/shop')}>
                  <Button>{isAgent ? 'Get my sell link' : 'Buy a bundle'}</Button>
                </Link>
              )
            }
          />
        ) : (
          <TableWrap caption="Your orders">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Recipient</Th>
                <Th>Status</Th>
                <Th align="right">Customer paid</Th>
                {isAgent && <Th align="right">You earned</Th>}
                <Th align="right">Reference</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => {
                const share = myShareOf(order)
                return (
                  <tr
                    key={order.id}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => setSelected(order)}
                  >
                    <Td>
                      <p className="font-medium text-slate-900 dark:text-slate-50">{order.productName}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <NetworkChip network={order.network} />
                        <span className="text-xs text-slate-500 dark:text-slate-400">{dateTime(order.createdAt)}</span>
                      </div>
                    </Td>
                    <Td className="tabular">{order.recipient}</Td>
                    <Td>
                      <OrderStatus order={order} />
                      {order.refunded && (
                        <Badge tone="info" className="ml-1.5">
                          Refunded
                        </Badge>
                      )}
                    </Td>
                    <Td align="right" className="tabular font-semibold text-slate-900 dark:text-slate-50">
                      {isUnpaid(order) ? (
                        <span className="font-normal text-slate-500 dark:text-slate-400">Nothing paid</span>
                      ) : (
                        cedis(order.salePrice)
                      )}
                    </Td>
                    {isAgent && (
                      <Td align="right">
                        <span className="tabular font-semibold text-brand-700 dark:text-brand-300">
                          {order.status === 'completed' && share
                            ? cedis(share.margin, { sign: true })
                            : '-'}
                        </span>
                        {share && share.depth > 0 && (
                          <Badge tone="info" className="ml-1.5">
                            downline
                          </Badge>
                        )}
                      </Td>
                    )}
                    <Td align="right" className="tabular text-xs text-slate-500 dark:text-slate-400">
                      {order.reference}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>
      {data && totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Page {data.page} of {totalPages} · {data.total.toLocaleString()} order{data.total === 1 ? '' : 's'}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
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
      </div>

      <OrderDetail order={selected} onClose={() => setSelected(null)} isAgent={isAgent} />
    </div>
  )
}

function OrderDetail({
  order,
  onClose,
  isAgent,
}: {
  order: Order | null
  onClose: () => void
  isAgent: boolean
}) {
  const { myShareOf } = useStore()
  const share = order ? myShareOf(order) : undefined

  return (
    <Modal open={Boolean(order)} onClose={onClose} title="Order details">
      {order && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-bold text-slate-900 dark:text-slate-50">{order.productName}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <NetworkChip network={order.network} />
                <OrderStatus order={order} />
              </div>
            </div>
            <p className="tabular text-xl font-bold text-brand-800 dark:text-brand-300">{cedis(order.salePrice)}</p>
          </div>

          {order.status === 'awaiting_payment' && (
            <Callout tone="info" title="Waiting for payment">
              The {cedis(order.salePrice)} has not been paid yet, so nothing has been sent.
            </Callout>
          )}

          {order.status === 'failed' &&
            (isUnpaid(order) ? (
              <Callout tone="info" title="Not paid">
                The payment never went through, so no money was taken, nothing was sent and there is
                nothing to refund.{isAgent ? ' You earn nothing on it.' : ''}
              </Callout>
            ) : (
              <Callout tone="info" title="Failed, buyer is refunded">
                This order failed at the provider, so the {cedis(order.salePrice)} the buyer paid is
                being refunded to them. You earn nothing on it, any earnings were reversed.
              </Callout>
            ))}

          {order.voucher && (
            <div className="space-y-3">
              <Callout
                tone="info"
                title="Checker voucher"
                icon={<CertificateIcon className="size-4" />}
              >
                Also sent by SMS to {order.recipient}.
              </Callout>
              <CopyField label="Serial number" value={order.voucher.serial} mono />
              <CopyField label="PIN" value={order.voucher.pin} mono />
            </div>
          )}

          <dl className="space-y-2.5 border-t border-slate-100 dark:border-slate-800 pt-4 text-sm">
            <Row label="Recipient" value={order.recipient} />
            <Row label="Buyer" value={order.buyer} />
            <Row
              label={isUnpaid(order) ? 'Tried to pay with' : 'Paid with'}
              value={order.paidWith === 'wallet' ? 'Wallet' : 'Mobile Money'}
            />
            <Row label="Reference" value={order.reference} />
            <Row label="Placed" value={dateTime(order.createdAt)} />
          </dl>

          {/* FR-5.8, an agent sees their own part of the sale: their price and their
              profit. Never the supplier's cost, the platform's margin or anyone else's. */}
          {isAgent && !isUnpaid(order) && share && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5">
              <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
                Your part of this {cedis(order.salePrice)}
              </p>
              <ul className="mt-2.5 space-y-1.5 text-sm">
                {share.paid > 0 && (
                  <li className="flex items-baseline justify-between gap-3">
                    <span className="text-slate-600 dark:text-slate-300">Your price for this bundle</span>
                    <span className="tabular font-medium text-slate-700 dark:text-slate-200">{cedis(share.paid)}</span>
                  </li>
                )}
                <li className="flex items-baseline justify-between gap-3">
                  <span className="text-slate-600 dark:text-slate-300">{share.paid > 0 ? 'Your profit' : 'Your referral earning'}</span>
                  <span className="tabular font-semibold text-brand-700 dark:text-brand-300">
                    {cedis(share.margin, { sign: true })}
                  </span>
                </li>
              </ul>
              {share && (
                <p className="mt-2.5 border-t border-slate-200 dark:border-slate-700 pt-2.5 text-xs text-slate-500 dark:text-slate-400">
                  {share.depth === 0
                    ? 'You sold this directly.'
                    : `Sold ${share.depth} level${share.depth > 1 ? 's' : ''} below you.`}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            {/* Not just a failed order's own retry, a completed one gets this
                too, so a customer buying the same bundle for the same number
                is one tap. Customers only: an agent's list is their sales,
                and a failed one is for an admin to reorder, not the agent. */}
            {!isAgent && (order.status === 'failed' || order.status === 'completed') && (
              <Link
                to={`/buy/${order.productId}?recipient=${encodeURIComponent(order.recipient)}`}
                className="flex-1"
              >
                <Button block>{order.status === 'failed' ? 'Order again' : 'Buy again'}</Button>
              </Link>
            )}
            <Button block variant="outline" onClick={onClose} className="flex-1">
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="tabular font-medium text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  )
}
