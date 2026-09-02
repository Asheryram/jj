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
  Segmented,
  StatTile,
  StatusBadge,
  TableWrap,
  Td,
  Th,
  cn,
} from '../../components/ui'
import {
  AlertIcon,
  CashIcon,
  CheckIcon,
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
      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        {dot && <span className={`size-2 rounded-full ${dot}`} />}
        {label}
      </dt>
      <dd
        className={
          strong
            ? 'tabular mt-1 text-lg font-bold text-brand-700 dark:text-brand-300'
            : 'tabular mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50'
        }
      >
        {value}
      </dd>
    </div>
  )
}

/** FR-6.3 — all orders, all users, total revenue, system-wide statistics. */
export default function Overview() {
  const { orders, users, withdrawals, revenueByDay } = useStore()

  /**
   * By volume sold, all-time — from the same per-user figures the Users page
   * shows. This used to read from `subAgents`, which is only ever populated
   * when *you* are signed in as an agent looking at your own downline — on
   * an admin session it stays empty forever, so this card silently showed
   * nothing no matter how much agents had actually sold.
   */
  const topAgents = [...users]
    .filter((u) => u.role === 'agent')
    .sort((a, b) => b.salesVolume - a.salesVolume)
    .slice(0, 5)

  const [statement, setStatement] = useState<FinanceStatement | null>(null)
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null)
  /** The window behind the "Where the money goes" breakdown further down — independent of the fixed 7-day header tiles above it. */
  const [range, setRange] = useState<'7' | '30' | 'all'>('7')

  useEffect(() => {
    let live = true
    api
      .health()
      .then((result) => live && setHealth(result))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    let live = true
    api
      .financeStatement(range === 'all' ? 'all' : Number(range))
      .then((result) => live && setStatement(result))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [range])

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
  const refunds = statement?.costs.refunds ?? 0
  /** referralBonuses and payoutFees are both historical-only kinds — nothing live writes either; agentMarginWriteoffs is the rare uncollectable-clawback case. */
  const otherCosts =
    (statement?.costs.referralBonuses ?? 0) +
    (statement?.costs.payoutFees ?? 0) +
    (statement?.costs.agentMarginWriteoffs ?? 0)
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

      {/* Before anything else — a shop that cannot fulfil an order or pay
          itself out yet needs to know that before the rest of this page's
          numbers mean anything. Disappears for good once every step is done. */}
      <GettingStartedCard />

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
          what is free to spend, and what the float still needs. `id` is the
          "Get set up" checklist's jump target above. */}
      <div className="mt-3 scroll-mt-20" id="float-panel">
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
                className="flex items-center gap-0.5 text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline"
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
                className="flex items-center gap-0.5 text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline"
              >
                All users <ChevronRightIcon className="size-4" />
              </Link>
            }
          />
          {topAgents.length === 0 ? (
            <EmptyState
              icon={<UsersIcon className="size-6" />}
              title="No agent sales yet"
              detail="Volume shows up here once a customer buys through an agent's own shop link."
            />
          ) : (
          <ul className="divide-y divide-slate-100">
            {topAgents.map((agent, index) => (
                <li key={agent.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-500 dark:text-slate-400">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900 dark:text-slate-50">{agent.name}</p>
                    <p className="tabular mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {agent.orders} orders · {agent.phone}
                    </p>
                  </div>
                  <p className="tabular shrink-0 font-semibold text-slate-900 dark:text-slate-50">
                    {cedis(agent.salesVolume)}
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
                <tr key={order.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <Td>
                    <p className="font-medium text-slate-900 dark:text-slate-50">{order.productName}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <NetworkChip network={order.network} />
                      <span className="text-xs text-slate-500 dark:text-slate-400">{dateTime(order.createdAt)}</span>
                    </div>
                  </Td>
                  <Td className="text-slate-600 dark:text-slate-300">
                    {order.split.shares.find((s) => s.depth === 0 && s.role === 'agent')?.name ??
                      'Direct'}
                  </Td>
                  <Td>
                    <StatusBadge status={order.status} />
                  </Td>
                  <Td align="right" className="tabular font-semibold text-slate-900 dark:text-slate-50">
                    {cedis(order.salePrice)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      </div>

      {/* FR-6.6 — where every cedi that came in actually went. */}
      <Card className="mt-3">
        <CardHead
          title="Where the money goes"
          subtitle={`${range === '7' ? 'Last 7 days' : range === '30' ? 'Last 30 days' : 'All time'}, from the ledger`}
          action={
            <Segmented<'7' | '30' | 'all'>
              options={[
                { value: '7', label: '7 days' },
                { value: '30', label: '30 days' },
                { value: 'all', label: 'All time' },
              ]}
              value={range}
              onChange={setRange}
            />
          }
        />
        <div className="p-4 sm:p-5">
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            {[
              { label: 'Supplier', value: supplierSpend, className: 'bg-slate-400' },
              { label: 'Paystack fee', value: paystackFee, className: 'bg-amber-400' },
              { label: 'You', value: myMargin, className: 'bg-brand-600' },
              { label: 'Agents', value: agentShare, className: 'bg-brand-300' },
              ...(refunds > 0
                ? [{ label: 'Refunds', value: refunds, className: 'bg-red-400' }]
                : []),
              ...(otherCosts > 0
                ? [{ label: 'Other', value: otherCosts, className: 'bg-slate-300 dark:bg-slate-600' }]
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
            {refunds > 0 && <MoneyBand label="Refunds" value={cedis(refunds)} dot="bg-red-400" />}
            {otherCosts > 0 && (
              <MoneyBand label="Other" value={cedis(otherCosts)} dot="bg-slate-300 dark:bg-slate-600" />
            )}
          </dl>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            From the ledger, not the price you were quoted at sale time — so it reflects what
            DataHub actually charged and what Paystack actually kept, not the catalogue estimate.
          </p>
        </div>
      </Card>

      <CatalogueAccuracyCard />

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
              className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-3"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{service.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{service.detail}</p>
              </div>
              <Badge tone={service.tone as 'success' | 'warning' | 'danger' | 'neutral'}>
                {service.label}
              </Badge>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-3 sm:px-5">
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

/**
 * What has to happen before selling actually works, checked off as it
 * becomes true rather than asked once and forgotten.
 *
 * DataHub debits a prepaid float on every order, so a shop that has never
 * logged a top-up can still take a customer's payment and then fail to
 * deliver — the money and the mistake both land after the fact. A banner
 * that only nags on day one would be missed the moment it is dismissed, so
 * this reads the platform's own state instead: still incomplete, it stays
 * here; complete, it renders nothing and never comes back.
 *
 * Deliberately not a hard gate on the rest of the app. This shop has one
 * admin, not a stream of strangers onboarding themselves — a route guard
 * would add a real maintenance burden (see `RequireAuth`'s pending-agent
 * gate for what that costs) to solve a problem an unmissable checklist
 * already solves just as well.
 */
function GettingStartedCard() {
  const { products, session } = useStore()
  const [floatLogged, setFloatLogged] = useState<boolean | null>(null)

  useEffect(() => {
    let live = true
    api
      .supplierFloat()
      .then((float) => live && setFloatLogged(float.capital.since !== null))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  // Nothing to say yet, and better silence than a guess at whether it's needed.
  if (floatLogged === null) return null

  const steps = [
    {
      done: floatLogged,
      label: 'Add money to your DataHub float, then log it here',
      detail:
        'Every order spends from this prepaid balance — without it, a paid order can still fail to deliver.',
      to: '#float-panel',
      cta: 'Log it below',
    },
    {
      done: products.some((p) => p.active),
      label: 'Price your catalogue',
      detail: 'Nothing is on sale until you set what agents and walk-up customers pay for it.',
      to: '/admin/prices',
      cta: 'Set your prices',
    },
    {
      done: Boolean(session && session.phone !== '0000000000'),
      label: 'Set your own payout Mobile Money number',
      detail: 'This is where your own earnings and any manual payouts are sent.',
      to: '/admin/settings#your-details',
      cta: 'Set it in Settings',
    },
  ]

  if (steps.every((step) => step.done)) return null

  return (
    <Card className="mb-3 border-brand-200 dark:border-brand-800">
      <CardHead title="Get set up" subtitle="Worth doing before you start selling" />
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {steps.map((step) => (
          <li key={step.label} className="flex flex-wrap items-start gap-3 px-4 py-3 sm:px-5">
            <span
              className={cn(
                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
                step.done
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500',
              )}
            >
              <CheckIcon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-sm font-semibold',
                  step.done
                    ? 'text-slate-400 line-through dark:text-slate-500'
                    : 'text-slate-900 dark:text-slate-50',
                )}
              >
                {step.label}
              </p>
              {!step.done && (
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{step.detail}</p>
              )}
            </div>
            {!step.done && (
              <Link
                to={step.to}
                className="shrink-0 text-xs font-semibold text-brand-700 dark:text-brand-300 underline underline-offset-2"
              >
                {step.cta}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * Profit or loss from the gap between what the catalogue believes a bundle
 * costs and what the supplier actually charges — see
 * `AdminService.catalogueAccuracy`.
 *
 * Already inside "Your margin" above — this is not a second cost or revenue
 * line, only a decomposition of where a slice of that all-time total came
 * from. What it adds is attribution: a product with a consistent negative
 * gap has a stale catalogue price quietly losing money on every sale, and
 * nothing else on this page would ever say so.
 */
function CatalogueAccuracyCard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.catalogueAccuracy>> | null>(null)

  useEffect(() => {
    let live = true
    api
      .catalogueAccuracy()
      .then((result) => live && setData(result))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  if (data && data.products.length === 0) return null

  return (
    <Card className="mt-3">
      <CardHead
        title="Catalogue accuracy"
        subtitle="All-time — where the supplier's real charge differed from what the catalogue said"
      />
      <div className="p-4 sm:p-5">
        {!data ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : (
          <>
            <div
              className={`rounded-xl border p-3.5 text-sm ${
                data.totalDiff >= 0
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40'
                  : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40'
              }`}
            >
              <span className="font-semibold text-slate-900 dark:text-slate-50">
                {cedis(data.totalDiff, { sign: true })}
              </span>{' '}
              <span className="text-slate-600 dark:text-slate-300">
                {data.totalDiff >= 0
                  ? "extra profit, already counted in your margin above — the supplier has charged less than the catalogue said, net, across every sale."
                  : "already eaten out of your margin above — the supplier has charged more than the catalogue said, net, across every sale."}
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {data.products.map((product) => (
                <details
                  key={product.supplierCode}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 open:bg-slate-50 dark:open:bg-slate-800/60"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <NetworkChip network={product.network} />
                      <span className="truncate font-medium text-slate-900 dark:text-slate-50">
                        {product.name}
                      </span>
                      <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                        {product.orderCount} sale{product.orderCount === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span
                      className={`tabular shrink-0 font-semibold ${
                        product.diff >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {cedis(product.diff, { sign: true })}
                    </span>
                  </summary>
                  <TableWrap caption={`Orders behind ${product.name}'s catalogue gap`}>
                    <thead>
                      <tr>
                        <Th>Order</Th>
                        <Th align="right">Catalogue said</Th>
                        <Th align="right">Actually charged</Th>
                        <Th align="right">Diff</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.orders.map((order) => (
                        <tr key={order.orderRef}>
                          <Td>
                            <p className="tabular text-xs text-slate-500 dark:text-slate-400">{order.orderRef}</p>
                            <p className="text-xs text-slate-400 dark:text-slate-500">{dateTime(order.occurredAt)}</p>
                          </Td>
                          <Td align="right" className="tabular text-slate-600 dark:text-slate-300">
                            {cedis(order.believed)}
                          </Td>
                          <Td align="right" className="tabular text-slate-600 dark:text-slate-300">
                            {cedis(order.charged)}
                          </Td>
                          <Td
                            align="right"
                            className={`tabular font-semibold ${
                              order.diff >= 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-red-700 dark:text-red-400'
                            }`}
                          >
                            {cedis(order.diff, { sign: true })}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                </details>
              ))}
            </div>

            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              A product sitting consistently in the red here has a catalogue price that no longer
              matches what the supplier actually charges — worth updating it on the Cost prices page
              before it loses money on every future sale.
            </p>
          </>
        )}
      </div>
    </Card>
  )
}
