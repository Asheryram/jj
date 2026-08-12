import { useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
import type { OrderStatus } from '../../data/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  NetworkChip,
  PageHead,
  Segmented,
  StatTile,
  StatusBadge,
  TableWrap,
  Td,
  TextInput,
  Th,
} from '../../components/ui'
import { DownloadIcon, ReceiptIcon, SearchIcon } from '../../components/icons'

type Filter = 'all' | OrderStatus

/** FR-6.3 (all orders) + FR-8.3 (export for record-keeping). */
export default function AdminOrders() {
  const { orders } = useStore()
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
    </div>
  )
}
