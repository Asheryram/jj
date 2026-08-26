import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
import type { Order, OrderStatus } from '../../data/types'
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
  StatusBadge,
  TableWrap,
  Td,
  TextInput,
  Th,
} from '../../components/ui'
import { CertificateIcon, ReceiptIcon, SearchIcon } from '../../components/icons'

type Filter = 'all' | OrderStatus

/** FR-6.1 — the signed-in user's own orders. */
export default function Orders() {
  const { orders, session, myShareOf } = useStore()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Order | null>(null)

  const isAgent = session?.role === 'agent'

  // NFR-2.5 — an agent sees orders they earned from, a customer sees orders
  // they bought. Nobody sees somebody else's book.
  const mine = useMemo(() => {
    if (!session) return []
    if (isAgent) {
      return orders.filter((order) =>
        order.split.shares.some((share) => share.userId === session.id),
      )
    }
    return orders.filter((order) => order.buyer === session.name)
  }, [isAgent, orders, session])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return mine.filter((order) => {
      if (filter !== 'all' && order.status !== filter) return false
      if (!needle) return true
      return (
        order.recipient.includes(needle) ||
        order.reference.toLowerCase().includes(needle) ||
        order.productName.toLowerCase().includes(needle)
      )
    })
  }, [filter, mine, query])

  const counts = useMemo(
    () => ({
      all: mine.length,
      completed: mine.filter((o) => o.status === 'completed').length,
      processing: mine.filter((o) => o.status === 'processing' || o.status === 'pending').length,
      failed: mine.filter((o) => o.status === 'failed').length,
    }),
    [mine],
  )

  const earned = mine
    .filter((o) => o.status === 'completed')
    .reduce((sum, o) => sum + (myShareOf(o)?.margin ?? 0), 0)

  return (
    <div>
      <PageHead
        title={isAgent ? 'Sales' : 'My orders'}
        subtitle={
          isAgent
            ? `${counts.all} orders in your chain · ${cedis(earned)} earned · ${counts.failed} failed and reversed`
            : `${counts.all} orders · ${counts.completed} completed`
        }
      />

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Filter>
          options={[
            { value: 'all', label: `All ${counts.all}` },
            { value: 'completed', label: 'Completed' },
            { value: 'processing', label: `In progress ${counts.processing}` },
            { value: 'failed', label: 'Failed' },
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

      <Card>
        {visible.length === 0 ? (
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
                <Link to={isAgent ? '/app/referrals' : '/shop'}>
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
                      <StatusBadge status={order.status} />
                      {order.refunded && (
                        <Badge tone="info" className="ml-1.5">
                          Refunded
                        </Badge>
                      )}
                    </Td>
                    <Td align="right" className="tabular font-semibold text-slate-900 dark:text-slate-50">
                      {cedis(order.salePrice)}
                    </Td>
                    {isAgent && (
                      <Td align="right">
                        <span className="tabular font-semibold text-brand-700 dark:text-brand-300">
                          {order.status === 'completed' && share
                            ? cedis(share.margin, { sign: true })
                            : '—'}
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
  const { myShareOf, session } = useStore()
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
                <StatusBadge status={order.status} />
              </div>
            </div>
            <p className="tabular text-xl font-bold text-brand-800 dark:text-brand-300">{cedis(order.salePrice)}</p>
          </div>

          {order.status === 'failed' && (
            <Callout tone="success" title="Refunded">
              This order failed at the provider, so {cedis(order.salePrice)} was returned to the
              buyer automatically. Any earnings on it were reversed.
            </Callout>
          )}

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
            <Row label="Paid with" value={order.paidWith === 'wallet' ? 'Wallet' : 'Mobile Money'} />
            <Row label="Reference" value={order.reference} />
            <Row label="Placed" value={dateTime(order.createdAt)} />
          </dl>

          {/* FR-5.8 — an agent can see exactly where the money went. */}
          {isAgent && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5">
              <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
                How this {cedis(order.salePrice)} split
              </p>
              <ul className="mt-2.5 space-y-1.5 text-sm">
                <li className="flex items-baseline justify-between gap-3">
                  <span className="text-slate-600 dark:text-slate-300">DataHub GH (supplier)</span>
                  <span className="tabular font-medium text-slate-700 dark:text-slate-200">
                    {cedis(order.split.supplierCost)}
                  </span>
                </li>
                {[...order.split.shares]
                  .sort((a, b) => a.depth - b.depth)
                  .map((entry) => (
                    <li key={entry.userId} className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-slate-600 dark:text-slate-300">{entry.name}</span>
                        {entry.userId === session?.id && <Badge tone="brand">you</Badge>}
                      </span>
                      <span
                        className={
                          entry.userId === session?.id
                            ? 'tabular font-semibold text-brand-700 dark:text-brand-300'
                            : 'tabular font-medium text-slate-700 dark:text-slate-200'
                        }
                      >
                        {cedis(entry.margin, { sign: true })}
                      </span>
                    </li>
                  ))}
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
            {order.status === 'failed' && (
              <Link to={`/buy/${order.productId}`} className="flex-1">
                <Button block>Order again</Button>
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
