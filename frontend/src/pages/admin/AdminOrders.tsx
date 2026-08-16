import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
import type { Order, OrderStatus } from '../../data/types'
import { api, ApiError, type DispatchAttempt } from '../../lib/api'
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Modal,
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
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  ReceiptIcon,
  SearchIcon,
} from '../../components/icons'

type Filter = 'all' | OrderStatus

/** FR-6.3 (all orders) + FR-8.3 (export for record-keeping). */
export default function AdminOrders() {
  const { orders } = useStore()
  const [inspecting, setInspecting] = useState<Order | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return orders.filter((order) => {
      if (filter !== 'all' && order.status !== filter) return false
      if (!needle) return true
      return (
        order.recipient.includes(needle) ||
        order.reference.toLowerCase().includes(needle) ||
        order.buyer.toLowerCase().includes(needle) ||
        (order.soldByCode ?? '').toLowerCase().includes(needle) ||
        order.split.shares.some((s) => s.name.toLowerCase().includes(needle)) ||
        order.productName.toLowerCase().includes(needle)
      )
    })
  }, [filter, orders, query])

  const done = visible.filter((o) => o.status === 'completed')
  const revenue = done.reduce((sum, o) => sum + o.salePrice, 0)
  const supplierSpend = done.reduce((sum, o) => sum + o.split.supplierCost, 0)
  const adminMarginOf = (order: (typeof visible)[number]) =>
    order.split.shares.find((s) => s.role === 'admin')?.margin ?? 0
  const myMargin = done.reduce((sum, o) => sum + adminMarginOf(o), 0)

  const exportCsv = () => {
    const header = [
      'Reference',
      'Date',
      'Sold by',
      'Buyer',
      'Product',
      'Network',
      'Recipient',
      'Customer paid',
      'Supplier cost',
      'Your margin',
      'Agent margins',
      'Chain',
      'Paid with',
      'Status',
      'Refunded',
    ]
    const rows = visible.map((o) => {
      const agentShares = o.split.shares.filter((s) => s.role === 'agent')
      return [
        o.reference,
        o.createdAt,
        o.soldByCode ?? 'direct',
        o.buyer,
        o.productName,
        o.network ?? 'All',
        o.recipient,
        (o.salePrice / 100).toFixed(2),
        (o.split.supplierCost / 100).toFixed(2),
        (adminMarginOf(o) / 100).toFixed(2),
        (agentShares.reduce((n, s) => n + s.margin, 0) / 100).toFixed(2),
        agentShares.map((s) => s.name).join(' → ') || 'none',
        o.paidWith,
        o.status,
        o.refunded ? 'yes' : 'no',
      ]
    })
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n')
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
          <Button variant="outline" onClick={exportCsv}>
            <DownloadIcon className="size-4" /> Export CSV
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Orders shown" value={String(visible.length)} />
        <StatTile label="Customers paid" value={cedis(revenue)} tone="brand" />
        <StatTile label="Paid to supplier" value={cedis(supplierSpend)} />
        <StatTile
          label="Your margin"
          value={cedis(myMargin)}
          hint="Your share of these orders"
          tone="success"
        />
      </div>

      <div className="mt-3 mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Filter>
          options={[
            { value: 'all', label: 'All' },
            { value: 'completed', label: 'Completed' },
            { value: 'processing', label: 'Processing' },
            { value: 'failed', label: 'Failed' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div className="relative sm:w-72">
          <SearchIcon className="absolute inset-y-0 left-3 my-auto size-4 text-slate-500" />
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
        {visible.length === 0 ? (
          <EmptyState
            icon={<ReceiptIcon className="size-6" />}
            title="No orders matched"
            detail="Adjust the filter or clear your search."
            action={
              <Button variant="outline" onClick={() => setQuery('')}>
                Clear search
              </Button>
            }
          />
        ) : (
          <TableWrap caption="All orders on the platform, with the split per order">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Sold through</Th>
                <Th>Recipient</Th>
                <Th>Status</Th>
                <Th align="right">Customer paid</Th>
                <Th align="right">Supplier</Th>
                <Th align="right">Your margin</Th>
                <Th align="right">Agents</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => {
                const agentShares = order.split.shares.filter((s) => s.role === 'agent')
                return (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <Td>
                      <p className="font-medium text-slate-900">{order.productName}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <NetworkChip network={order.network} />
                        <span className="tabular text-xs text-slate-500">{order.reference}</span>
                      </div>
                    </Td>
                    <Td>
                      {agentShares.length > 0 ? (
                        <p className="text-slate-800">
                          {agentShares.map((s) => s.name).join(' ← ')}
                        </p>
                      ) : (
                        <Badge tone="neutral">Direct sale</Badge>
                      )}
                      <p className="mt-0.5 text-xs text-slate-500">
                        {order.buyer} · {dateTime(order.createdAt)}
                      </p>
                    </Td>
                    <Td className="tabular">{order.recipient}</Td>
                    <Td>
                      <StatusBadge status={order.status} />
                      {order.refunded && (
                        <Badge tone="info" className="ml-1.5">
                          Refunded
                        </Badge>
                      )}
                      {/* "Failed" flattens a dead float, an unapproved
                          recipient and a withdrawn bundle into one word. The
                          difference decides what to do about it, so it is one
                          click away rather than a database query. */}
                      {(order.status === 'failed' || order.status === 'processing') && (
                        <button
                          type="button"
                          onClick={() => setInspecting(order)}
                          className="mt-1 block text-xs font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800"
                        >
                          Why?
                        </button>
                      )}
                    </Td>
                    <Td align="right" className="tabular font-semibold text-slate-900">
                      {cedis(order.salePrice)}
                    </Td>
                    <Td align="right" className="tabular text-slate-500">
                      {cedis(order.split.supplierCost)}
                    </Td>
                    <Td align="right" className="tabular font-semibold text-brand-700">
                      {order.status === 'completed'
                        ? cedis(adminMarginOf(order), { sign: true })
                        : '—'}
                    </Td>
                    <Td align="right" className="tabular text-slate-600">
                      {order.status === 'completed' && agentShares.length > 0
                        ? cedis(agentShares.reduce((n, s) => n + s.margin, 0))
                        : '—'}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <DispatchModal order={inspecting} onClose={() => setInspecting(null)} />
    </div>
  )
}

/**
 * Turn a supplier's reply into something James can act on.
 *
 * He is not a developer, and `HTTP 400 {"success":false,"error":"Insufficient
 * balance"}` is not an instruction. Every failure here has exactly one sensible
 * next move — top up, get the number approved, fix the catalogue, call the
 * partner — and that move is the thing worth putting on screen.
 *
 * Matched on the provider's words rather than a code, because they send no
 * codes. An unrecognised reason falls through to their text verbatim: better a
 * sentence he has to puzzle over than a confident wrong diagnosis.
 */
function explain(attempt: DispatchAttempt): {
  tone: 'success' | 'danger' | 'warning' | 'info'
  title: string
  detail: string
  action: string | null
} {
  const reason = attempt.reason ?? ''

  if (attempt.simulated) {
    return {
      tone: 'info',
      title: 'Test mode — nothing was sent',
      detail: 'The delivery partner was not contacted. This order was simulated end to end.',
      action: null,
    }
  }

  if (attempt.outcome === 'delivered') {
    return {
      tone: 'success',
      title: 'Delivered',
      detail: 'The delivery partner confirmed the bundle reached the recipient.',
      action: null,
    }
  }

  if (attempt.outcome === 'pending') {
    return {
      tone: 'info',
      title: 'Sent — waiting for confirmation',
      detail:
        'The delivery partner accepted the order and is working on it. They confirm separately, usually within a couple of minutes.',
      action: null,
    }
  }

  if (attempt.outcome === 'unknown') {
    return {
      tone: 'warning',
      title: 'We do not know whether this was delivered',
      detail:
        'The connection broke before the partner answered, so the bundle may or may not have been sent.',
      action:
        'Do not re-send it manually — that risks paying twice. It is being checked automatically every minute.',
    }
  }

  if (/insufficient balance/i.test(reason)) {
    return {
      tone: 'danger',
      title: 'Your DataHub account is out of credit',
      detail:
        'Nothing is wrong with this order or this number. Bundles are paid for from a prepaid balance you hold with DataHub, and there is not enough in it to buy this one.',
      action:
        'Top up at app.datahubgh.com. Every order will keep failing this way until you do. The customer was not charged.',
    }
  }

  if (/not verified|beneficiary/i.test(reason)) {
    return {
      tone: 'danger',
      title: 'This number is not approved for delivery yet',
      detail:
        'DataHub only sends MTN bundles to numbers on their approved list, and this one is not on it.',
      action: 'Ask DataHub to add the number, then try again.',
    }
  }

  if (/no automated fulfilment|not found|no bundle/i.test(reason)) {
    return {
      tone: 'danger',
      title: 'The partner does not sell this bundle',
      detail:
        'They have no matching bundle for this size and network, so it cannot be delivered automatically.',
      action: 'Sync the provider catalogue, and take the bundle off sale if it has been withdrawn.',
    }
  }

  if (/out of stock/i.test(reason)) {
    return {
      tone: 'warning',
      title: 'Out of stock with the partner',
      detail: 'They are temporarily unable to supply this bundle.',
      action: 'Try again later, or take it off sale in the meantime.',
    }
  }

  if (/forced failure|test switch/i.test(reason)) {
    return {
      tone: 'info',
      title: 'Deliberately failed by the test switch',
      detail: 'The "simulate failure" setting is on, so this order was rejected on purpose.',
      action: 'Turn the switch off in Settings when you are done testing.',
    }
  }

  return {
    tone: 'danger',
    title: 'The delivery partner refused this order',
    detail: reason || 'They gave no reason.',
    action: null,
  }
}

/**
 * What we asked the supplier for this order, and what came back.
 *
 * Exists because "failed" is not an answer anyone can act on. An empty float
 * means top up; an unapproved recipient means get the number added; a withdrawn
 * bundle means fix the catalogue — three different jobs behind one badge.
 *
 * Written for James rather than for a developer: the plain reading leads, and
 * the provider's raw reply is folded away underneath. It is still there, because
 * our summary is lossy and when it is wrong the raw text is the only way to find
 * out — but it is not what he has to read first.
 */
function DispatchModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const [attempts, setAttempts] = useState<DispatchAttempt[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!order) {
      setAttempts(null)
      setError('')
      return
    }
    let live = true
    api
      .orderDispatches(order.id)
      .then((rows) => live && setAttempts(rows))
      .catch(
        (caught) =>
          live && setError(caught instanceof ApiError ? caught.message : 'We could not load this.'),
      )
    return () => {
      live = false
    }
  }, [order])

  if (!order) return null

  return (
    <Modal open onClose={onClose} title={`Order ${order.reference}`}>
      <div className="space-y-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-900">{order.productName}</p>
              <p className="tabular mt-0.5 text-sm text-slate-500">{order.recipient}</p>
            </div>
            <p className="tabular text-lg font-bold text-slate-900">{cedis(order.salePrice)}</p>
          </div>
        </div>

        {error && (
          <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
            {error}
          </Callout>
        )}

        {attempts === null && !error && (
          <div className="py-8 text-center">
            <Spinner className="mx-auto size-6 text-brand-600" />
          </div>
        )}

        {attempts?.length === 0 && (
          <Callout tone="info" title="No delivery was attempted" icon={<AlertIcon className="size-4" />}>
            The order was stopped before it reached the delivery partner, so nothing was sent and
            nothing was charged.
          </Callout>
        )}

        {attempts?.map((attempt) => {
          const said = explain(attempt)
          return (
            <div
              key={attempt.id}
              className={cn(
                'overflow-hidden rounded-xl border',
                said.tone === 'success' && 'border-emerald-200 bg-emerald-50/50',
                said.tone === 'danger' && 'border-red-200 bg-red-50/50',
                said.tone === 'warning' && 'border-amber-200 bg-amber-50/50',
                said.tone === 'info' && 'border-slate-200 bg-slate-50/50',
              )}
            >
              <div className="p-3.5">
                <div className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
                      said.tone === 'success' && 'bg-emerald-100 text-emerald-700',
                      said.tone === 'danger' && 'bg-red-100 text-red-700',
                      said.tone === 'warning' && 'bg-amber-100 text-amber-700',
                      said.tone === 'info' && 'bg-slate-200 text-slate-600',
                    )}
                  >
                    {said.tone === 'success' ? (
                      <CheckIcon className="size-4" />
                    ) : said.tone === 'info' ? (
                      <ClockIcon className="size-4" />
                    ) : (
                      <AlertIcon className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{said.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-slate-700">{said.detail}</p>
                  </div>
                </div>

                {said.action && (
                  <div className="mt-2.5 rounded-lg border border-white/80 bg-white/80 p-2.5 text-sm font-medium text-slate-800">
                    {said.action}
                  </div>
                )}
              </div>

              <div className="border-t border-white/60 bg-white/50 px-3.5 py-2 text-xs text-slate-500">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{dateTime(attempt.createdAt)}</span>
                  {attempts.length > 1 && <span>Try {attempt.attempt}</span>}
                  <span>
                    Bundle cost{' '}
                    <span className="tabular font-semibold text-slate-700">
                      {cedis(attempt.costPrice)}
                    </span>
                  </span>
                  {attempt.providerCharged != null && (
                    <span>
                      They charged{' '}
                      <span className="tabular font-semibold text-slate-900">
                        {cedis(attempt.providerCharged)}
                      </span>
                    </span>
                  )}
                </div>

                {/* Kept, because our plain-English reading above is a summary and
                    summaries are wrong sometimes. Folded away so it is never the
                    first thing anyone has to read. */}
                {(attempt.providerResponse || attempt.providerReference) && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer font-semibold text-slate-500 hover:text-slate-700">
                      Technical details
                    </summary>
                    <div className="mt-1.5 space-y-1">
                      {attempt.providerReference && (
                        <p className="font-mono break-all">Ref {attempt.providerReference}</p>
                      )}
                      {attempt.providerStatus && <p>Status {attempt.providerStatus}</p>}
                      <p className="font-mono">SKU {attempt.supplierCode}</p>
                      {attempt.providerResponse && (
                        <pre className="max-h-40 overflow-auto rounded-lg bg-slate-900 p-2 text-[11px] leading-relaxed break-all whitespace-pre-wrap text-slate-100">
                          {attempt.providerResponse}
                        </pre>
                      )}
                    </div>
                  </details>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
