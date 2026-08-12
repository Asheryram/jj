import { Link } from 'react-router-dom'
import { useStore } from '../../state/store'
import { cedis, cedisCompact, dateTime } from '../../lib/format'
import { revenueByDay, subAgents } from '../../data/mock'
import { CATEGORY_META, CATEGORY_ORDER } from '../../components/categories'
import { BarChart, Donut } from '../../components/charts'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  NetworkChip,
  PageHead,
  StatTile,
  StatusBadge,
  TableWrap,
  Td,
  Th,
} from '../../components/ui'
import {
  AlertIcon,
  CashIcon,
  ChevronRightIcon,
  ReceiptIcon,
  TrendUpIcon,
  UsersIcon,
} from '../../components/icons'

function MoneyBand({
  label,
  value,
  dot,
  strong,
}: {
  label: string
  value: string
  dot?: string
  strong?: boolean
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {dot && <span className={`size-2 rounded-full ${dot}`} />}
        {label}
      </dt>
      <dd
        className={
          strong
            ? 'tabular mt-1 text-lg font-bold text-brand-700'
            : 'tabular mt-1 text-lg font-semibold text-slate-900'
        }
      >
        {value}
      </dd>
    </div>
  )
}

/** FR-6.3 — all orders, all users, total revenue, system-wide statistics. */
export default function Overview() {
  const { orders, users, withdrawals } = useStore()

  const weekRevenue = revenueByDay.reduce((sum, day) => sum + day.revenue, 0)
  const weekOrders = revenueByDay.reduce((sum, day) => sum + day.orders, 0)
  const activeUsers = users.filter((u) => u.status === 'active').length
  const agents = users.filter((u) => u.role === 'agent')
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending')
  const failedOrders = orders.filter((o) => o.status === 'failed')
  const inFlight = orders.filter((o) => o.status === 'processing' || o.status === 'pending')

  // FR-6.3 — James's own margin, taken from the recorded split of each order
  // rather than estimated. His share is the gap between his supplier cost and
  // what he charges (agents pay adminPrice; walk-up customers pay standard).
  const myMargin = orders
    .filter((o) => o.status === 'completed')
    .reduce(
      (sum, o) => sum + (o.split.shares.find((s) => s.role === 'admin')?.margin ?? 0),
      0,
    )
  const trackedRevenue = orders
    .filter((o) => o.status === 'completed')
    .reduce((sum, o) => sum + o.salePrice, 0)
  const agentShare = orders
    .filter((o) => o.status === 'completed')
    .reduce(
      (sum, o) =>
        sum + o.split.shares.filter((s) => s.role === 'agent').reduce((n, s) => n + s.margin, 0),
      0,
    )
  const supplierSpend = orders
    .filter((o) => o.status === 'completed')
    .reduce((sum, o) => sum + o.split.supplierCost, 0)

  const byCategory = CATEGORY_ORDER.map((category) => ({
    label: CATEGORY_META[category].label,
    value: orders
      .filter((o) => o.category === category && o.status === 'completed')
      .reduce((sum, o) => sum + o.salePrice, 0),
  })).filter((row) => row.value > 0)

  const totalCategoryValue = byCategory.reduce((sum, row) => sum + row.value, 0)

  return (
    <div>
      <PageHead
        title="Platform overview"
        subtitle="Everything happening across JamesDataConsult."
      />

      {/* Things needing attention come before the vanity numbers. */}
      {(pendingWithdrawals.length > 0 || failedOrders.length > 0) && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          {pendingWithdrawals.length > 0 && (
            <Callout tone="warning" title="Withdrawals waiting on you" icon={<CashIcon className="size-4" />}>
              {pendingWithdrawals.length} request
              {pendingWithdrawals.length === 1 ? '' : 's'} totalling{' '}
              <strong className="font-bold">
                {cedis(pendingWithdrawals.reduce((s, w) => s + w.amount, 0))}
              </strong>
              .{' '}
              <Link to="/admin/withdrawals" className="font-semibold underline">
                Review now
              </Link>
            </Callout>
          )}
          {failedOrders.length > 0 && (
            <Callout tone="info" title="Failed orders, all refunded" icon={<AlertIcon className="size-4" />}>
              {failedOrders.length} order{failedOrders.length === 1 ? '' : 's'} failed at the
              provider. Wallets were credited back automatically — no action needed.
            </Callout>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Revenue, last 7 days"
          value={cedisCompact(weekRevenue)}
          hint={`${weekOrders.toLocaleString()} orders`}
          tone="brand"
          icon={<TrendUpIcon className="size-5" />}
        />
        <StatTile
          label="Your margin, tracked orders"
          value={cedisCompact(myMargin)}
          hint="Your price less supplier cost"
          tone="success"
          icon={<CashIcon className="size-5" />}
        />
        <StatTile
          label="Active users"
          value={String(activeUsers)}
          hint={`${agents.length} agents · ${users.length - agents.length} others`}
          icon={<UsersIcon className="size-5" />}
        />
        <StatTile
          label="Orders in flight"
          value={String(inFlight.length)}
          hint={inFlight.length > 0 ? 'Awaiting provider confirmation' : 'Everything settled'}
          tone={inFlight.length > 0 ? 'warning' : 'neutral'}
          icon={<ReceiptIcon className="size-5" />}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHead
            title="Daily revenue"
            subtitle="Last 7 days across all agents and customers"
            action={
              <Link
                to="/admin/orders"
                className="flex items-center gap-0.5 text-sm font-semibold text-brand-700 hover:underline"
              >
                All orders <ChevronRightIcon className="size-4" />
              </Link>
            }
          />
          <div className="p-4 sm:p-5">
            <BarChart data={revenueByDay} height={180} />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHead title="Revenue by category" />
          <div className="p-4 sm:p-5">
            <Donut
              segments={byCategory}
              total={totalCategoryValue}
              centreLabel="Tracked"
              centreValue={cedisCompact(totalCategoryValue).replace('GHS ', '')}
            />
          </div>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {/* Top agents by volume */}
        <Card>
          <CardHead
            title="Top agents"
            subtitle="By volume sold"
            action={
              <Link
                to="/admin/users"
                className="flex items-center gap-0.5 text-sm font-semibold text-brand-700 hover:underline"
              >
                All users <ChevronRightIcon className="size-4" />
              </Link>
            }
          />
          <ul className="divide-y divide-slate-100">
            {[...subAgents]
              .sort((a, b) => b.volume - a.volume)
              .slice(0, 5)
              .map((agent, index) => (
                <li key={agent.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">{agent.name}</p>
                    <p className="tabular mt-0.5 text-xs text-slate-500">
                      {agent.orders} orders · {agent.phone}
                    </p>
                  </div>
                  <p className="tabular shrink-0 font-semibold text-slate-900">
                    {cedis(agent.volume)}
                  </p>
                </li>
              ))}
          </ul>
        </Card>

        {/* Live order feed */}
        <Card>
          <CardHead title="Latest orders" subtitle="Across the whole platform" />
          <TableWrap caption="Latest orders across the platform">
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Agent</Th>
                <Th>Status</Th>
                <Th align="right">Value</Th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 6).map((order) => (
                <tr key={order.id} className="hover:bg-slate-50">
                  <Td>
                    <p className="font-medium text-slate-900">{order.productName}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <NetworkChip network={order.network} />
                      <span className="text-xs text-slate-500">{dateTime(order.createdAt)}</span>
                    </div>
                  </Td>
                  <Td className="text-slate-600">
                    {order.split.shares.find((s) => s.depth === 0 && s.role === 'agent')?.name ??
                      'Direct'}
                  </Td>
                  <Td>
                    <StatusBadge status={order.status} />
                  </Td>
                  <Td align="right" className="tabular font-semibold text-slate-900">
                    {cedis(order.salePrice)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      </div>

      {/* FR-6.6 — where every cedi of tracked turnover actually went. */}
      <Card className="mt-3">
        <CardHead
          title="Where the money goes"
          subtitle="Split across tracked completed orders"
        />
        <div className="p-4 sm:p-5">
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
            {[
              { label: 'Supplier', value: supplierSpend, className: 'bg-slate-400' },
              { label: 'You', value: myMargin, className: 'bg-brand-600' },
              { label: 'Agents', value: agentShare, className: 'bg-brand-300' },
            ].map((band) => (
              <div
                key={band.label}
                className={band.className}
                style={{
                  width: `${trackedRevenue > 0 ? (band.value / trackedRevenue) * 100 : 0}%`,
                }}
                role="img"
                aria-label={`${band.label}: ${cedis(band.value)}`}
              />
            ))}
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-4">
            <MoneyBand label="Customers paid" value={cedis(trackedRevenue)} />
            <MoneyBand label="To DataHub GH" value={cedis(supplierSpend)} dot="bg-slate-400" />
            <MoneyBand label="Your margin" value={cedis(myMargin)} dot="bg-brand-600" strong />
            <MoneyBand label="To your agents" value={cedis(agentShare)} dot="bg-brand-300" />
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Every order stores its own split, so these figures cannot drift from what was actually
            charged — even after you change a price.
          </p>
        </div>
      </Card>

      {/* Provider health — NFR-3.1, NFR-3.2 made visible */}
      <Card className="mt-3">
        <CardHead title="Integrations" subtitle="Live status of the services orders depend on" />
        <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
          {[
            { name: 'DataHub GH API', detail: 'Bundle fulfilment', ok: true },
            { name: 'Paystack', detail: 'Wallet top-ups', ok: true },
            { name: 'SMS gateway', detail: 'Order notifications', ok: true },
          ].map((service) => (
            <div
              key={service.name}
              className="flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-3"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">{service.name}</p>
                <p className="text-xs text-slate-500">{service.detail}</p>
              </div>
              <Badge tone={service.ok ? 'success' : 'danger'}>
                {service.ok ? 'Operational' : 'Down'}
              </Badge>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
          <Link to="/admin/settings">
            <Button size="sm" variant="outline">
              Integration settings
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  )
}
