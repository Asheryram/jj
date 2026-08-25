import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ReservePanel from './ReservePanel'
import FloatPanel from './FloatPanel'
import { useStore } from '../../state/store'
import { api, type FinanceStatement } from '../../lib/api'
import { cedis, cedisCompact, dateTime } from '../../lib/format'
import { CATEGORY_META, CATEGORY_ORDER } from '../../components/categories'
import { BarChart, Donut } from '../../components/charts'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  EmptyState,
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
  const { orders, users, withdrawals, revenueByDay, subAgents } = useStore()

  const [statement, setStatement] = useState<FinanceStatement | null>(null)
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null)

  useEffect(() => {
    let live = true
    api
      .financeStatement(7)
      .then((result) => live && setStatement(result))
      .catch(() => undefined)
    api
      .health()
      .then((result) => live && setHealth(result))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const weekRevenue = revenueByDay.reduce((sum, day) => sum + day.revenue, 0)
  const weekOrders = revenueByDay.reduce((sum, day) => sum + day.orders, 0)
  /**
    * Both numbers count the same population.
    *
    * The tile used to show active users with a breakdown of *every* user, so two
    * active accounts were annotated "2 agents · 2 others" — a headline of 2 over
    * a hint summing to 4. Pending agents were the difference.
    */
  const active = users.filter((u) => u.status === 'active')
  const activeAgents = active.filter((u) => u.role === 'agent')
  const awaitingApproval = users.filter((u) => u.status === 'pending').length
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending')
  const failedOrders = orders.filter((o) => o.status === 'failed')
  const inFlight = orders.filter((o) => o.status === 'processing' || o.status === 'pending')

  /**
   * FR-6.3 — James's own margin, read from the ledger rather than recomputed
   * from the orders list.
   *
   * The orders list is capped (the same 100 rows the "Latest orders" table
   * uses), so a reduce over it silently undercounts once the platform does more
   * than a page of business. The ledger has no such cap, and it is the only
   * place that knows what the supplier actually charged and what Paystack
   * actually kept — both of which can differ from the price quoted at sale
   * time. `profit` is revenue less every real cost: supplier, Paystack's fee,
   * agent margins, and anything else that ever hits the books.
   */
  const trackedRevenue = statement?.revenue ?? 0
  const supplierSpend = statement?.costs.supplier ?? 0
  const paystackFee = statement?.costs.paymentFees ?? 0
  const agentShare = statement?.costs.agentMargins ?? 0
  const otherCosts =
    (statement?.costs.referralBonuses ?? 0) +
    (statement?.costs.refunds ?? 0) +
    (statement?.costs.payoutFees ?? 0)
  const myMargin = statement?.profit ?? 0

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
          label="Your margin, last 7 days"
          value={cedisCompact(myMargin)}
          hint="Revenue less supplier cost, Paystack's fee and agent payouts"
          tone="success"
          icon={<CashIcon className="size-5" />}
        />
        <StatTile
          label="Active users"
          value={String(active.length)}
          hint={
            `${activeAgents.length} agents · ${active.length - activeAgents.length} others` +
            (awaitingApproval > 0 ? ` · ${awaitingApproval} awaiting approval` : '')
          }
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

      <ReservePanel />

      {/* The other pot of money, and the one that stops the product working when
          it empties. Next to the reserve panel because the two are read together:
          what is free to spend, and what the float still needs. */}
      <div className="mt-3">
        <FloatPanel />
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
          {subAgents.length === 0 ? (
            <EmptyState
              icon={<UsersIcon className="size-6" />}
              title="No agent sales yet"
              detail="Volume shows up here once a customer buys through an agent's own shop link."
            />
          ) : (
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
          )}
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

      {/* FR-6.6 — where every cedi that came in over the last 7 days actually went. */}
      <Card className="mt-3">
        <CardHead title="Where the money goes" subtitle="Last 7 days, from the ledger" />
        <div className="p-4 sm:p-5">
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
            {[
              { label: 'Supplier', value: supplierSpend, className: 'bg-slate-400' },
              { label: 'Paystack fee', value: paystackFee, className: 'bg-amber-400' },
              { label: 'You', value: myMargin, className: 'bg-brand-600' },
              { label: 'Agents', value: agentShare, className: 'bg-brand-300' },
              ...(otherCosts > 0
                ? [{ label: 'Other', value: otherCosts, className: 'bg-slate-300' }]
                : []),
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
          <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MoneyBand label="Customers paid" value={cedis(trackedRevenue)} />
            <MoneyBand label="To DataHub GH" value={cedis(supplierSpend)} dot="bg-slate-400" />
            <MoneyBand label="Paystack fee" value={cedis(paystackFee)} dot="bg-amber-400" />
            <MoneyBand label="Your margin" value={cedis(myMargin)} dot="bg-brand-600" strong />
            <MoneyBand label="To your agents" value={cedis(agentShare)} dot="bg-brand-300" />
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            From the ledger, not the price you were quoted at sale time — so it reflects what
            DataHub actually charged and what Paystack actually kept, not the catalogue estimate.
          </p>
        </div>
      </Card>

      {/* Provider health — NFR-3.1, NFR-3.2 made visible. Read from /health, not
          hardcoded: a badge that always says "Operational" answers nothing. */}
      <Card className="mt-3">
        <CardHead title="Integrations" subtitle="What's actually live right now, not what's configured" />
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          {[
            {
              name: 'DataHub GH API',
              detail: 'Bundle fulfilment',
              label:
                health?.providers.datahub === 'live'
                  ? 'Live — real orders'
                  : health?.providers.datahub === 'live-requested-no-key'
                    ? 'Misconfigured'
                    : health
                      ? 'Simulated'
                      : 'Checking…',
              tone:
                health?.providers.datahub === 'live'
                  ? 'success'
                  : health?.providers.datahub === 'live-requested-no-key'
                    ? 'danger'
                    : health
                      ? 'warning'
                      : 'neutral',
            },
            {
              name: 'Paystack',
              detail: 'Checkout & agent payouts',
              label: health ? (health.providers.paystack === 'live' ? 'Configured' : 'Not configured') : 'Checking…',
              tone: health ? (health.providers.paystack === 'live' ? 'success' : 'danger') : 'neutral',
            },
          ].map((service) => (
            <div
              key={service.name}
              className="flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-3"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">{service.name}</p>
                <p className="text-xs text-slate-500">{service.detail}</p>
              </div>
              <Badge tone={service.tone as 'success' | 'warning' | 'danger' | 'neutral'}>
                {service.label}
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
