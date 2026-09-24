import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../state/store'
import { api, type FinanceStatement, type ReservePosition } from '../../lib/api'
import { cedis, cedisCompact, dateTime, trendText } from '../../lib/format'
import { CATEGORY_META, CATEGORY_ORDER } from '../../components/categories'
import { BarChart, Donut } from '../../components/charts'
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  NetworkChip,
  PageHead,
  Spinner,
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
  HelpIcon,
  ReceiptIcon,
  TrendUpIcon,
  UsersIcon,
} from '../../components/icons'

/** FR-6.3, all orders, all users, total revenue, system-wide statistics. */
export default function Overview() {
  const { orders, users, withdrawals, revenueByDay, adminOverview: overview } = useStore()

  /**
   * By volume sold, all-time, from the same per-user figures the Users page
   * shows. This used to read from `subAgents`, which is only ever populated
   * when *you* are signed in as an agent looking at your own downline, on
   * an admin session it stays empty forever, so this card silently showed
   * nothing no matter how much agents had actually sold.
   */
  const topAgents = [...users]
    .filter((u) => u.role === 'agent')
    .sort((a, b) => b.salesVolume - a.salesVolume)
    .slice(0, 5)

  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null)
  /**
   * Fixed at 7 days, unconditionally, matching the tile's own "last 7 days"
   * label. This used to share a single `statement` with the "Where the
   * money goes" panel's own range selector (now on the Finance page), so
   * switching that selector to 30 days or all-time silently changed what
   * this tile showed too, while its label kept reading "last 7 days" no
   * matter what was actually behind it.
   */
  const [weekStatement, setWeekStatement] = useState<FinanceStatement | null>(null)

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
      .financeStatement(7)
      .then((result) => live && setWeekStatement(result))
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
    * active accounts were annotated "2 agents · 2 others", a headline of 2 over
    * a hint summing to 4. Pending agents were the difference.
    */
  const active = users.filter((u) => u.status === 'active')
  const activeAgents = active.filter((u) => u.role === 'agent')
  const awaitingApproval = users.filter((u) => u.status === 'pending').length
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending')

  /**
   * Real, all-time counts, not derived from the `orders` store (capped at
   * the same 100 most-recent rows the "Latest orders" table uses below,
   * per the `myMargin` comment further down). A busy platform with more
   * than 100 orders ever placed would otherwise show "Orders in flight"
   * silently pinned near 100 whenever a chunk of the most recent 100
   * happen to still be open, or "Failed orders" undercounting whenever an
   * older failure has already scrolled out of that window. `pageSize: 1`
   * keeps the request cheap, only `total` is read.
   */
  const [failedTotal, setFailedTotal] = useState<number | null>(null)
  const [inFlightTotal, setInFlightTotal] = useState<number | null>(null)
  const [needsAttentionCount, setNeedsAttentionCount] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    Promise.all([
      api.adminOrders({ status: 'failed', page: 1, pageSize: 1 }),
      api.adminOrders({ status: 'pending', page: 1, pageSize: 1 }),
      api.adminOrders({ status: 'processing', page: 1, pageSize: 1 }),
      api.needsAttentionOrders(),
    ])
      .then(([failed, pending, processing, needsAttention]) => {
        if (!live) return
        setFailedTotal(failed.total)
        setInFlightTotal(pending.total + processing.total)
        setNeedsAttentionCount(needsAttention.length)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  /**
   * FR-6.3, James's own margin, read from the ledger rather than recomputed
   * from the orders list.
   *
   * The orders list is capped (the same 100 rows the "Latest orders" table
   * uses), so a reduce over it silently undercounts once the platform does more
   * than a page of business. The ledger has no such cap, and it is the only
   * place that knows what the supplier actually charged and what Paystack
   * actually kept, both of which can differ from the price quoted at sale
   * time. `profit` is revenue less every real cost: supplier, Paystack's fee,
   * agent margins, and anything else that ever hits the books.
   */
  const myMargin = weekStatement?.profit ?? 0

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
        action={
          <Link to="/info">
            <Button variant="outline" size="sm">
              <HelpIcon className="size-4" /> What you can do
            </Button>
          </Link>
        }
      />

      {/* Before anything else, a shop that cannot fulfil an order or pay
          itself out yet needs to know that before the rest of this page's
          numbers mean anything. Disappears for good once every step is done. */}
      <GettingStartedCard />

      {/* One list, not three separately-styled callouts fighting for grid
          cells: needing action is the common thread, so it reads as one
          queue with several rows, not several unrelated banners. Every row
          is informational-only, though, it links to the dedicated page that
          actually acts on it rather than doing the work here. */}
      <AttentionCard needsAttentionCount={needsAttentionCount} pendingWithdrawals={pendingWithdrawals} failedTotal={failedTotal} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Revenue, last 7 days"
          value={cedisCompact(weekRevenue)}
          hint={
            (overview
              ? trendText(overview.revenueTrend.thisWeek, overview.revenueTrend.lastWeek, 'last week')
              : null) ?? `${weekOrders.toLocaleString()} orders`
          }
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
          value={inFlightTotal === null ? '-' : String(inFlightTotal)}
          hint={inFlightTotal ? 'Awaiting provider confirmation' : 'Everything settled'}
          tone={inFlightTotal ? 'warning' : 'neutral'}
          icon={<ReceiptIcon className="size-5" />}
        />
        {overview && (
          <>
            <StatTile
              label="Refund rate"
              value={`${(overview.refundRate * 100).toFixed(1)}%`}
              hint="All-time, of every order that ever finished, one way or the other"
              tone={overview.refundRate > 0.1 ? 'warning' : 'neutral'}
              icon={<AlertIcon className="size-5" />}
            />
            <StatTile
              label="Checkout funnel, this week"
              value={`${overview.checkoutFunnel.completed}/${overview.checkoutFunnel.started}`}
              hint={`${overview.checkoutFunnel.failed} failed at the provider, ${
                overview.checkoutFunnel.started - overview.checkoutFunnel.completed - overview.checkoutFunnel.failed
              } still in flight or abandoned`}
              icon={<ReceiptIcon className="size-5" />}
            />
          </>
        )}
      </div>

      {overview && overview.goingQuietAgents.length > 0 && <GoingQuietCard agents={overview.goingQuietAgents} />}

      <FinanceSummaryCard />

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
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
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

      <CatalogueAccuracyCallout />

      {/* Provider health, NFR-3.1, NFR-3.2 made visible. Read from /health, not
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
                  ? 'Live, real orders'
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
 * deliver, the money and the mistake both land after the fact. A banner
 * that only nags on day one would be missed the moment it is dismissed, so
 * this reads the platform's own state instead: still incomplete, it stays
 * here; complete, it renders nothing and never comes back.
 *
 * Deliberately not a hard gate on the rest of the app. This shop has one
 * admin, not a stream of strangers onboarding themselves, a route guard
 * would add a real maintenance burden (see `RequireAuth`'s pending-agent
 * gate for what that costs) to solve a problem an unmissable checklist
 * already solves just as well.
 */

/**
 * The one number that used to require the full `ReservePanel` to find:
 * what's actually free to spend, held and owed, minus everything already
 * committed. Overview's job is a headline, not the full statement, the
 * complete breakdown (this, the DataHub float, and where every cedi went)
 * now lives on its own Finance page, linked from here.
 */
function FinanceSummaryCard() {
  const [position, setPosition] = useState<ReservePosition | null>(null)

  useEffect(() => {
    let live = true
    api
      .reservePosition()
      .then((result) => live && setPosition(result))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  return (
    <Card className="mt-3">
      <CardHead
        title="Money held and money owed"
        subtitle="A quick glance, see Finance for the full breakdown"
        action={
          <Link to="/admin/finance">
            <Button variant="outline" size="sm">
              <CashIcon className="size-4" /> Finance <ChevronRightIcon className="size-4" />
            </Button>
          </Link>
        }
      />
      <div className="p-4 sm:p-5">
        {position === null ? (
          <div className="py-4 text-center">
            <Spinner className="mx-auto size-5 text-brand-600 dark:text-brand-300" />
          </div>
        ) : (
          <div
            className={cn(
              'flex items-center justify-between gap-3 rounded-xl border px-4 py-3',
              position.freeToSpend >= 0
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40'
                : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40',
            )}
          >
            <div>
              <p
                className={cn(
                  'text-sm font-semibold',
                  position.freeToSpend >= 0
                    ? 'text-emerald-900 dark:text-emerald-200'
                    : 'text-red-900 dark:text-red-200',
                )}
              >
                Actually free to spend
              </p>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                Should be at Paystack, less everything already owed to someone else and everything
                already spent on bundles
              </p>
            </div>
            <p
              className={cn(
                'tabular shrink-0 text-lg font-bold',
                position.freeToSpend >= 0
                  ? 'text-emerald-800 dark:text-emerald-300'
                  : 'text-red-700 dark:text-red-400',
              )}
            >
              {cedis(position.freeToSpend, { sign: true })}
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * Every queue Overview used to surface as its own separately-styled Callout
 * (stuck orders, withdrawals waiting, failed orders), now one card with one
 * row each. Same reasoning as before: informational only, each row links to
 * the dedicated page that actually acts on it, rather than a card being the
 * odd one out with an action embedded in it. Renders nothing when every row
 * would be empty, same as each Callout used to individually.
 */
function AttentionCard({
  needsAttentionCount,
  pendingWithdrawals,
  failedTotal,
}: {
  needsAttentionCount: number | null
  pendingWithdrawals: { amount: number }[]
  failedTotal: number | null
}) {
  const rows = [
    needsAttentionCount
      ? {
          key: 'stuck',
          icon: <AlertIcon className="size-4 text-amber-600 dark:text-amber-400" />,
          text: (
            <>
              {needsAttentionCount} order{needsAttentionCount === 1 ? '' : 's'} stuck at the provider, the
              reconciler will not guess at these.
            </>
          ),
          to: '/admin/needs-attention',
          cta: 'Review',
        }
      : null,
    pendingWithdrawals.length > 0
      ? {
          key: 'withdrawals',
          icon: <CashIcon className="size-4 text-amber-600 dark:text-amber-400" />,
          text: (
            <>
              {pendingWithdrawals.length} withdrawal{pendingWithdrawals.length === 1 ? '' : 's'} waiting on
              you, totalling{' '}
              <strong className="font-semibold">
                {cedis(pendingWithdrawals.reduce((s, w) => s + w.amount, 0))}
              </strong>
              .
            </>
          ),
          to: '/admin/withdrawals',
          cta: 'Review',
        }
      : null,
    failedTotal
      ? {
          key: 'failed',
          icon: <ReceiptIcon className="size-4 text-slate-500 dark:text-slate-400" />,
          text: (
            <>
              {failedTotal} order{failedTotal === 1 ? '' : 's'} failed at the provider. Wallets were
              credited back automatically, no action needed.
            </>
          ),
          to: '/admin/orders?status=failed',
          cta: 'View',
        }
      : null,
  ].filter(Boolean) as { key: string; icon: ReactNode; text: ReactNode; to: string; cta: string }[]

  if (rows.length === 0) return null

  return (
    <Card className="mb-3 border-amber-200 dark:border-amber-800">
      <CardHead title="Needs your attention" />
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <span className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200">
              {row.icon}
              {row.text}
            </span>
            <Link
              to={row.to}
              className="shrink-0 text-sm font-semibold text-brand-700 dark:text-brand-300 underline"
            >
              {row.cta}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** Active agents who have sold before and gone quiet, not brand-new ones still finding their feet. */
function GoingQuietCard({
  agents,
}: {
  agents: { name: string; referralCode: string; lastSaleAt: string }[]
}) {
  return (
    <Card className="mt-3">
      <CardHead title="Agents going quiet" subtitle="Sold before, nothing in the last two weeks" />
      <div className="space-y-2 p-4 sm:p-5">
        {agents.map((agent) => (
          <div key={agent.referralCode} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-slate-900 dark:text-slate-50">
              {agent.name} <span className="text-slate-400">· {agent.referralCode}</span>
            </span>
            <span className="text-slate-500 dark:text-slate-400">Last sale {dateTime(agent.lastSaleAt)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

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
        'Every order spends from this prepaid balance, without it, a paid order can still fail to deliver.',
      to: '/admin/finance#float-panel',
      cta: 'Log it on Finance',
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
 * The worst catalogue-vs-actual gaps, going only by each product's most
 * recent sale, see `AdminService.catalogueAccuracy`.
 *
 * Informational only, same as the rest of Overview: this says how many
 * catalogue prices are currently wrong and by how much, nothing more. The
 * full list, and the ability to act on it, lives on the dedicated Catalogue
 * accuracy page, this only ever shows the losses worth worrying about,
 * biggest first, with a link out.
 */
function CatalogueAccuracyCallout() {
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

  const losses = (data ?? []).filter((p) => p.diff < 0).sort((a, b) => a.diff - b.diff)

  if (losses.length === 0) return null

  return (
    <Card className="mt-3">
      <CardHead
        title="Catalogue accuracy"
        subtitle="Worst gaps between what the catalogue says and what the supplier last charged"
      />
      <div className="space-y-2 p-4 sm:p-5">
        {losses.slice(0, 5).map((product) => (
          <div key={product.supplierCode} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <NetworkChip network={product.network} />
              <span className="truncate font-medium text-slate-900 dark:text-slate-50">{product.name}</span>
            </span>
            <span className="tabular shrink-0 font-semibold text-red-700 dark:text-red-400">
              {cedis(product.diff, { sign: true })}
            </span>
          </div>
        ))}
        <Link
          to="/admin/catalogue-accuracy"
          className="mt-1 inline-block text-sm font-semibold text-brand-700 underline dark:text-brand-300"
        >
          Review catalogue accuracy
        </Link>
      </div>
    </Card>
  )
}
