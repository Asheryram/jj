import { LearnCard } from '../../tours/LearnCard'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../state/store'
import {
  api,
  type InboxItem,
  type RevenueDay,
  type SupplierFloat,
  type TreasuryOverview,
} from '../../lib/api'
import type { Network, Order } from '../../data/types'
import { cedis, cedisCompact, dateTime, trendText } from '../../lib/format'
import { useRemembered } from '../../lib/remember'
import { BarChart } from '../../components/charts'
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  NetworkChip,
  PageHead,
  Segmented,
  Spinner,
  StatTile,
  cn,
} from '../../components/ui'
import {
  AlertIcon,
  CashIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  HelpIcon,
  ReceiptIcon,
  RefreshIcon,
  TrendUpIcon,
  UsersIcon,
} from '../../components/icons'

/**
 * FR-6.3, the admin's home screen, in the order it is used:
 *
 *  1. Act now: everything waiting on a person, the same list as Today.
 *  2. Money: what is in Paystack, what is yours to take, what is owed, and
 *     how long the floats last at the current pace.
 *  3. Sales: Today, 7 days or 30 days, each against the period before.
 *  4. Being delivered: orders still out with a provider, oldest first.
 *  5. Agents, catalogue gaps and whether each integration is live.
 *
 * Built only from what the server already reports; nothing here is summed
 * from the capped order list the app keeps in memory.
 */
export default function Overview() {
  const { users, adminOverview: overview } = useStore()
  // Bumped by Refresh, so every block reads again together.
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div>
      <PageHead
        title="Overview"
        subtitle="What needs you, where the money is, and how sales are going."
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} aria-label="Refresh">
              <RefreshIcon className="size-4" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Link to="/info" className="hidden sm:block">
              <Button variant="outline" size="sm">
                <HelpIcon className="size-4" /> What you can do
              </Button>
            </Link>
          </div>
        }
      />

      {/* Before anything else, a shop that cannot fulfil an order or pay
          itself out yet needs to know that. Disappears once every step is done. */}
      <GettingStartedCard />

      <ActNowCard refreshKey={refreshKey} />
      <MoneyCard refreshKey={refreshKey} />
      <SalesCard refreshKey={refreshKey} funnel={overview?.checkoutFunnel ?? null} />
      <BeingDeliveredCard refreshKey={refreshKey} />

      <div data-tour="overview-agents-orders" className="mt-3 grid gap-3 lg:grid-cols-2">
        <TopAgentsCard users={users} />
        {overview && overview.goingQuietAgents.length > 0 && <GoingQuietCard agents={overview.goingQuietAgents} />}
      </div>

      <CatalogueAccuracyCallout />
      <IntegrationsStrip refreshKey={refreshKey} />

      {/* Tours live at the bottom now: useful once, then out of the way. */}
      <div className="mt-5">
        <LearnCard title="Learn the admin" defaultCollapsed />
      </div>
    </div>
  )
}

// ── 1. Act now ──────────────────────────────────────────────────────────────

const URGENCY_STRIPE = { 1: 'bg-red-500', 2: 'bg-amber-500', 3: 'bg-slate-300 dark:bg-slate-600' } as const
const URGENCY_WORD = { 1: 'Now', 2: 'Today', 3: 'When you can' } as const

/** The top of the same queue as the Today page, each item with its one button. */
function ActNowCard({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ items: InboxItem[]; at: string } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    api
      .today()
      .then((result) => {
        if (!live) return
        setData(result)
        setFailed(false)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [refreshKey])

  const items = data?.items ?? []
  const shown = items.slice(0, 5)
  const urgent = items.some((item) => item.urgency === 1)

  return (
    <div data-tour="overview-attention">
      <Card className={cn('mb-3', urgent && 'border-red-200 dark:border-red-900')}>
        <CardHead
          title="Act now"
          subtitle={
            data
              ? items.length === 0
                ? undefined
                : `${items.length} thing${items.length === 1 ? '' : 's'} waiting on you, most urgent first`
              : undefined
          }
          action={
            items.length > 0 ? (
              <Link
                to="/admin/today"
                className="flex items-center gap-0.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
              >
                {items.length > shown.length ? `All ${items.length}` : 'Today'} <ChevronRightIcon className="size-4" />
              </Link>
            ) : undefined
          }
        />
        {data === null ? (
          failed ? (
            <p className="px-4 pb-4 text-sm text-slate-600 sm:px-5 dark:text-slate-300">
              Could not load what needs doing.{' '}
              <Link to="/admin/today" className="font-semibold text-brand-700 underline dark:text-brand-300">
                Open Today
              </Link>
            </p>
          ) : (
            <div className="pb-4 text-center">
              <Spinner className="mx-auto size-5 text-brand-600 dark:text-brand-300" />
            </div>
          )
        ) : items.length === 0 ? (
          <p className="flex items-center gap-2 px-4 pb-4 text-sm font-medium text-emerald-700 sm:px-5 dark:text-emerald-400">
            <CheckIcon className="size-4" /> Nothing needs you right now.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((item) => (
              <li key={item.id} className="flex items-stretch">
                <span className={cn('w-1 shrink-0', URGENCY_STRIPE[item.urgency])} aria-hidden="true" />
                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      <span className="sr-only">{URGENCY_WORD[item.urgency]}: </span>
                      {item.title}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{item.detail}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    {item.amount != null && (
                      <span className="tabular text-sm font-bold text-slate-900 dark:text-slate-50">{cedis(item.amount)}</span>
                    )}
                    <Link to={item.link}>
                      <Button size="sm" variant={item.urgency === 1 ? 'primary' : 'outline'}>
                        {item.action}
                      </Button>
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ── 2. Money ────────────────────────────────────────────────────────────────

const PROVIDERS: { code: 'datahub-gh' | 'gmpl'; name: string }[] = [
  { code: 'datahub-gh', name: 'DataHub GH' },
  { code: 'gmpl', name: 'GMPL' },
]

const LEVEL = {
  ok: { label: 'OK', tone: 'success' },
  watch: { label: 'Getting low', tone: 'warning' },
  risk: { label: 'Low, refill', tone: 'danger' },
} as const

/** "about 6 hours", "2.5 days", for how long a balance lasts. */
function runwayText(days: number): string {
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24))
    return `about ${hours} hour${hours === 1 ? '' : 's'}`
  }
  return `about ${days < 10 ? days.toFixed(1) : Math.round(days)} days`
}

/**
 * Where the money is right now, from the same figures as the Paystack balance
 * page, and how long the floats last at the last 7 days' pace of buying.
 */
function MoneyCard({ refreshKey }: { refreshKey: number }) {
  const [treasury, setTreasury] = useState<TreasuryOverview | null>(null)
  const [floats, setFloats] = useState<Record<string, SupplierFloat | null> | null>(null)
  const [weekBundleSpend, setWeekBundleSpend] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    Promise.allSettled([
      api.treasury(),
      api.supplierFloat('datahub-gh'),
      api.supplierFloat('gmpl'),
      api.financeStatement(7),
    ]).then(([money, datahub, gmpl, week]) => {
      if (!live) return
      setTreasury(money.status === 'fulfilled' ? money.value : null)
      setFailed(money.status === 'rejected')
      setFloats({
        'datahub-gh': datahub.status === 'fulfilled' ? datahub.value : null,
        gmpl: gmpl.status === 'fulfilled' ? gmpl.value : null,
      })
      setWeekBundleSpend(week.status === 'fulfilled' ? Math.abs(week.value.costs.supplier) : null)
    })
    return () => {
      live = false
    }
  }, [refreshKey])

  const floatTotal = floats
    ? PROVIDERS.reduce((sum, p) => sum + (floats[p.code]?.observation?.balance ?? 0), 0)
    : null
  const perDay = weekBundleSpend !== null ? weekBundleSpend / 7 : null

  const figures: { label: string; value: string; hint: string; tone?: string }[] = treasury
    ? [
        {
          label: 'Cash in Paystack',
          value: treasury.liveBalance === null ? 'Unavailable' : cedisCompact(treasury.liveBalance),
          hint: treasury.liveBalance === null ? 'Paystack did not answer' : 'Live from Paystack',
        },
        {
          label: 'Yours to take now',
          value: cedisCompact(Math.max(treasury.ownerDrawingMax, 0)),
          hint: 'After everything owed and the transfer fee',
          tone: 'text-emerald-700 dark:text-emerald-400',
        },
        {
          label: 'Owed to others',
          value: cedisCompact(treasury.heldFor.owedToOthers),
          hint: 'Agents, customers, orders being delivered',
        },
        {
          label: 'In the floats',
          value: cedisCompact(floatTotal ?? treasury.floatsHeld),
          hint: 'DataHub and GMPL together',
        },
      ]
    : []

  return (
    <div data-tour="overview-money">
      <Card className="mb-3">
        <CardHead
          title="Money"
          action={
            <Link
              to="/admin/finance"
              className="flex items-center gap-0.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
            >
              Finance <ChevronRightIcon className="size-4" />
            </Link>
          }
        />
        <div className="space-y-3 px-4 pb-4 pt-3 sm:px-5 sm:pt-4">
          {treasury === null && !failed ? (
            <div className="py-3 text-center">
              <Spinner className="mx-auto size-5 text-brand-600 dark:text-brand-300" />
            </div>
          ) : failed ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Could not load the money figures. The{' '}
              <Link to="/admin/finance" className="font-semibold text-brand-700 underline dark:text-brand-300">
                Finance page
              </Link>{' '}
              has them.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {figures.map((figure) => (
                <div key={figure.label} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{figure.label}</p>
                  <p className={cn('tabular mt-1 text-lg font-bold text-slate-900 dark:text-slate-50', figure.tone)}>
                    {figure.value}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{figure.hint}</p>
                </div>
              ))}
            </div>
          )}

          {floats && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {PROVIDERS.map((provider) => {
                  const reading = floats[provider.code]?.observation ?? null
                  const level = reading ? LEVEL[reading.level] : null
                  return (
                    <li key={provider.code} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{provider.name} float</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {reading ? `As of ${dateTime(reading.observedAt)}` : 'No reading yet'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {reading && (
                          <span className="tabular text-sm font-bold text-slate-900 dark:text-slate-50">
                            {cedis(reading.balance)}
                          </span>
                        )}
                        {level && <Badge tone={level.tone}>{level.label}</Badge>}
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="border-t border-slate-100 px-3.5 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
                {perDay === null || floatTotal === null ? (
                  'How long the floats last shows once spending can be read.'
                ) : perDay <= 0 ? (
                  'No bundles bought in the last 7 days, so nothing is using the floats.'
                ) : (
                  <>
                    Together they last <strong className="font-semibold">{runwayText(floatTotal / perDay)}</strong> at
                    the last 7 days' pace of {cedisCompact(perDay)} a day.
                  </>
                )}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Link to="/admin/treasury">
              <Button size="sm" variant="outline">
                <CashIcon className="size-4" /> Refill a float or take money out
              </Button>
            </Link>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ── 3. Sales ────────────────────────────────────────────────────────────────

type Period = 'today' | '7d' | '30d'
const PERIODS: readonly Period[] = ['today', '7d', '30d']
const PERIOD_DAYS: Record<Period, number> = { today: 1, '7d': 7, '30d': 30 }
const PERIOD_BEFORE: Record<Period, string> = { today: 'yesterday', '7d': 'the 7 days before', '30d': 'the 30 days before' }
const PERIOD_PHRASE: Record<Period, string> = { today: 'today', '7d': 'in the last 7 days', '30d': 'in the last 30 days' }

interface FailureSummary {
  /** Delivery failures only: an order nobody paid for is not one. */
  count: number
  byProduct: { name: string; network: Network | null; count: number }[]
  /** More failures than were read, so the per-product counts are the latest ones only. */
  partial: boolean
}

/**
 * Sales for Today, 7 days or 30 days, each against the period before, from
 * completed orders by calendar day (Ghana time), and which bundles failed
 * most, so a broken bundle is spotted before customers complain.
 */
function SalesCard({
  refreshKey,
  funnel,
}: {
  refreshKey: number
  funnel: { started: number; completed: number; failed: number } | null
}) {
  const [period, setPeriod] = useRemembered<Period>('overview-period', '7d', PERIODS)
  const [days, setDays] = useState<RevenueDay[] | null>(null)
  const [failures, setFailures] = useState<FailureSummary | null>(null)

  useEffect(() => {
    let live = true
    api
      .revenueByDay(60)
      .then((rows) => live && setDays(rows))
      .catch(() => live && setDays([]))
    return () => {
      live = false
    }
  }, [refreshKey])

  const n = PERIOD_DAYS[period]
  const current = useMemo(() => (days ?? []).slice(-n), [days, n])
  const previous = useMemo(() => (days ?? []).slice(-2 * n, -n), [days, n])
  const from = current[0]?.date
  const to = current[current.length - 1]?.date

  useEffect(() => {
    if (!from || !to) return
    let live = true
    setFailures(null)
    api
      .adminOrders({ status: 'failed', from, to, pageSize: 500 })
      .then((result) => {
        if (!live) return
        const delivery = result.rows.filter((order) => order.paymentCollected !== false)
        const groups = new Map<string, { name: string; network: Network | null; count: number }>()
        for (const order of delivery) {
          const key = `${order.productName}|${order.network ?? ''}`
          const group = groups.get(key) ?? { name: order.productName, network: order.network, count: 0 }
          group.count += 1
          groups.set(key, group)
        }
        setFailures({
          count: delivery.length,
          byProduct: [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 3),
          partial: result.total > result.rows.length,
        })
      })
      .catch(() => live && setFailures({ count: 0, byProduct: [], partial: true }))
    return () => {
      live = false
    }
  }, [from, to, refreshKey])

  const sum = (rows: RevenueDay[], key: 'revenue' | 'orders' | 'platformMargin') =>
    rows.reduce((total, row) => total + row[key], 0)
  const revenue = sum(current, 'revenue')
  const orders = sum(current, 'orders')
  const margin = sum(current, 'platformMargin')
  const before = PERIOD_BEFORE[period]
  const hasPrevious = previous.length === n
  const trend = (now: number, then: number) => (hasPrevious ? trendText(now, then, before) : null)
  const failureRate = failures && orders + failures.count > 0 ? (failures.count / (orders + failures.count)) * 100 : null
  // "Today" alone is one bar; the week behind it gives the day some context.
  const chartDays = period === 'today' ? (days ?? []).slice(-7) : current

  return (
    <div data-tour="overview-stat-tiles">
      <Card className="mb-3">
        <CardHead
          title="Sales"
          action={
            <Segmented<Period>
              options={[
                { value: 'today', label: 'Today' },
                { value: '7d', label: '7 days' },
                { value: '30d', label: '30 days' },
              ]}
              value={period}
              onChange={setPeriod}
            />
          }
        />
        <div className="space-y-3 px-4 pb-4 pt-3 sm:px-5 sm:pt-4">
          {days === null ? (
            <div className="py-6 text-center">
              <Spinner className="mx-auto size-5 text-brand-600 dark:text-brand-300" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <StatTile
                  label="Sales"
                  value={cedisCompact(revenue)}
                  hint={trend(revenue, sum(previous, 'revenue')) ?? `${orders.toLocaleString()} delivered`}
                  tone="brand"
                  icon={<TrendUpIcon className="size-5" />}
                />
                <StatTile
                  label="Orders delivered"
                  value={orders.toLocaleString()}
                  hint={trend(orders, sum(previous, 'orders')) ?? undefined}
                  icon={<ReceiptIcon className="size-5" />}
                />
                <StatTile
                  label="Your margin"
                  value={cedisCompact(margin)}
                  hint={trend(margin, sum(previous, 'platformMargin')) ?? 'On delivered sales'}
                  tone="success"
                  icon={<CashIcon className="size-5" />}
                />
                <StatTile
                  label="Failed deliveries"
                  value={failureRate === null ? (failures ? '0%' : '…') : `${failureRate.toFixed(1)}%`}
                  hint={failures ? `${failures.count} failed${failures.partial ? ' (latest 500)' : ''}` : undefined}
                  tone={failureRate !== null && failureRate >= 10 ? 'warning' : 'neutral'}
                  icon={<AlertIcon className="size-5" />}
                />
              </div>
              <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                Your margin is what you keep on delivered sales, before Paystack's fees and refunds. Finance shows profit
                after every cost.
              </p>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Sales by day{period === 'today' ? ', last 7 days' : ''}
                </p>
                <BarChart data={chartDays} height={150} />
              </div>

              {failures && (
                <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Failing most {PERIOD_PHRASE[period]}</p>
                    {failures.count > 0 && (
                      <Link
                        to="/admin/orders?status=failed"
                        className="text-xs font-semibold text-brand-700 underline dark:text-brand-300"
                      >
                        See failed orders
                      </Link>
                    )}
                  </div>
                  {failures.byProduct.length === 0 ? (
                    <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
                      No failed deliveries {PERIOD_PHRASE[period]}.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {failures.byProduct.map((row) => (
                        <li key={`${row.name}|${row.network ?? ''}`} className="flex items-center justify-between gap-3 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <NetworkChip network={row.network} />
                            <span className="truncate text-slate-700 dark:text-slate-200">{row.name}</span>
                          </span>
                          <span
                            className={cn(
                              'tabular shrink-0 font-semibold',
                              row.count >= 3 ? 'text-red-700 dark:text-red-400' : 'text-slate-700 dark:text-slate-200',
                            )}
                          >
                            {row.count} failed
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {funnel && funnel.started > 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Checkouts this week: {funnel.started} started, {funnel.completed} delivered, {funnel.failed} failed,{' '}
                  {Math.max(funnel.started - funnel.completed - funnel.failed, 0)} abandoned or still going.
                </p>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  )
}

// ── 4. Being delivered ──────────────────────────────────────────────────────

/** Past this, an order still out with the provider is worth a look. */
const SLOW_MS = 15 * 60_000

function ageText(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ${minutes % 60} min`
  return `${Math.floor(hours / 24)} days`
}

/** Orders still out with a provider, oldest first, with how long each has waited. */
function BeingDeliveredCard({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ rows: Order[]; total: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let live = true
    Promise.all([
      api.adminOrders({ status: 'processing', pageSize: 50 }),
      api.adminOrders({ status: 'pending', pageSize: 50 }),
    ])
      .then(([processing, pending]) => {
        if (!live) return
        const rows = [...processing.rows, ...pending.rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        setData({ rows, total: processing.total + pending.total })
        setNow(Date.now())
      })
      .catch(() => live && setData({ rows: [], total: 0 }))
    return () => {
      live = false
    }
  }, [refreshKey])

  // Ages move on their own while the page is open.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const slow = data ? data.rows.filter((order) => now - new Date(order.createdAt).getTime() > SLOW_MS).length : 0
  const shown = data?.rows.slice(0, 6) ?? []

  return (
    <Card className="mb-3">
      <CardHead
        title={data ? `Being delivered (${data.total})` : 'Being delivered'}
        subtitle={data && data.total > 0 ? `Oldest first${slow > 0 ? `, ${slow} waiting over 15 minutes` : ''}` : undefined}
        action={
          data && data.total > 0 ? (
            <Link
              to="/admin/orders?status=processing"
              className="flex items-center gap-0.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
            >
              All <ChevronRightIcon className="size-4" />
            </Link>
          ) : undefined
        }
      />
      {data === null ? (
        <div className="pb-4 text-center">
          <Spinner className="mx-auto size-5 text-brand-600 dark:text-brand-300" />
        </div>
      ) : shown.length === 0 ? (
        <p className="flex items-center gap-2 px-4 pb-4 text-sm font-medium text-emerald-700 sm:px-5 dark:text-emerald-400">
          <CheckIcon className="size-4" /> Nothing waiting on a provider.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {shown.map((order) => {
            const late = now - new Date(order.createdAt).getTime() > SLOW_MS
            const agent = order.split?.shares.find((s) => s.depth === 0 && s.role === 'agent')?.name
            return (
              <li key={order.id}>
                <Link
                  to={`/admin/orders?ref=${encodeURIComponent(order.reference)}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 sm:px-5 dark:hover:bg-slate-800"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <NetworkChip network={order.network} />
                      <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{order.productName}</span>
                    </span>
                    <span className="tabular mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                      {order.recipient} · {agent ?? 'Direct'} · {order.reference}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold',
                      late
                        ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                    )}
                  >
                    <ClockIcon className="size-3.5" /> {ageText(order.createdAt, now)}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// ── 5. Agents, catalogue, integrations ──────────────────────────────────────

/**
 * By volume sold, all-time, from the same per-user figures the Users page
 * shows. (It once read `subAgents`, which is only populated for an agent's
 * own downline and stayed empty on an admin session.)
 */
function TopAgentsCard({ users }: { users: ReturnType<typeof useStore>['users'] }) {
  const agents = users.filter((u) => u.role === 'agent')
  const active = agents.filter((u) => u.status === 'active').length
  const awaiting = users.filter((u) => u.status === 'pending').length
  const top = [...agents].sort((a, b) => b.salesVolume - a.salesVolume).slice(0, 5)

  return (
    <Card>
      <CardHead
        title="Top agents"
        subtitle={`By volume sold · ${active} active${awaiting > 0 ? ` · ${awaiting} awaiting approval` : ''}`}
        action={
          <Link
            to="/admin/users"
            className="flex items-center gap-0.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
          >
            Users <ChevronRightIcon className="size-4" />
          </Link>
        }
      />
      {top.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="size-6" />}
          title="No agent sales yet"
          detail="Volume shows up here once a customer buys through an agent's own shop link."
        />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {top.map((agent, index) => (
            <li key={agent.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900 dark:text-slate-50">{agent.name}</p>
                <p className="tabular mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {agent.orders} orders · {agent.phone}
                </p>
              </div>
              <p className="tabular shrink-0 font-semibold text-slate-900 dark:text-slate-50">{cedis(agent.salesVolume)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * Whether each integration is really live, as one line of dots: it only needs
 * attention when a dot is not green. Read from /health, not hardcoded.
 */
function IntegrationsStrip({ refreshKey }: { refreshKey: number }) {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null)

  useEffect(() => {
    let live = true
    api
      .health()
      .then((result) => live && setHealth(result))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [refreshKey])

  const supplier = (state: string | undefined) =>
    state === 'live'
      ? { label: 'Live', dot: 'bg-emerald-500' }
      : state === 'live-requested-no-key'
        ? { label: 'Misconfigured', dot: 'bg-red-500' }
        : health
          ? { label: 'Simulated', dot: 'bg-amber-500' }
          : { label: 'Checking…', dot: 'bg-slate-300 dark:bg-slate-600' }
  const services = [
    { name: 'DataHub', ...supplier(health?.providers.datahub) },
    { name: 'GMPL', ...supplier(health?.providers.gmpl) },
    {
      name: 'Paystack',
      ...(health
        ? health.providers.paystack === 'live'
          ? { label: 'Configured', dot: 'bg-emerald-500' }
          : { label: 'Not configured', dot: 'bg-red-500' }
        : { label: 'Checking…', dot: 'bg-slate-300 dark:bg-slate-600' }),
    },
  ]

  return (
    <div data-tour="overview-integrations">
      <Card className="mt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm sm:px-5">
          <span className="font-semibold text-slate-900 dark:text-slate-50">Integrations</span>
          {services.map((service) => (
            <span key={service.name} className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
              <span className={cn('size-2 rounded-full', service.dot)} aria-hidden="true" />
              {service.name}
              <span className="text-slate-500 dark:text-slate-400">{service.label}</span>
            </span>
          ))}
          <Link to="/admin/settings" className="ml-auto text-xs font-semibold text-brand-700 underline dark:text-brand-300">
            Settings
          </Link>
        </div>
      </Card>
    </div>
  )
}

/** Active agents who have sold before and gone quiet, not brand-new ones still finding their feet. */
function GoingQuietCard({
  agents,
}: {
  agents: { name: string; referralCode: string; lastSaleAt: string }[]
}) {
  return (
    <Card>
      <CardHead title="Agents going quiet" subtitle="Sold before, nothing in the last two weeks" />
      <div className="space-y-2 p-4 sm:p-5">
        {agents.map((agent) => (
          <div key={agent.referralCode} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm">
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

/**
 * What has to happen before selling actually works, checked off as it
 * becomes true rather than asked once and forgotten.
 *
 * Each supplier debits its own prepaid float on every order, so a shop that
 * has never logged a top-up can still take a customer's payment and then
 * fail to deliver. This reads the platform's own state instead of a dismissed
 * banner: still incomplete, it stays; complete, it renders nothing for good.
 */
function GettingStartedCard() {
  const { products, session } = useStore()
  const [floatLogged, setFloatLogged] = useState<boolean | null>(null)

  useEffect(() => {
    let live = true
    // Done the moment EITHER provider's float has capital tracked: a shop
    // routing everything through GMPL has just as real a way to satisfy it.
    Promise.all([api.supplierFloat('datahub-gh'), api.supplierFloat('gmpl')])
      .then(([datahub, gmpl]) => live && setFloatLogged(datahub.capital.since !== null || gmpl.capital.since !== null))
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
      label: 'Add money to a supplier float, then log it here',
      detail: 'Every order spends from a prepaid balance, without it, a paid order can still fail to deliver.',
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
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                  : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
              )}
            >
              <CheckIcon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-sm font-semibold',
                  step.done ? 'text-slate-400 line-through dark:text-slate-500' : 'text-slate-900 dark:text-slate-50',
                )}
              >
                {step.label}
              </p>
              {!step.done && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{step.detail}</p>}
            </div>
            {!step.done && (
              <Link
                to={step.to}
                className="shrink-0 text-xs font-semibold text-brand-700 underline underline-offset-2 dark:text-brand-300"
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
 * recent sale, see `AdminService.catalogueAccuracy`. Shows only the losses,
 * biggest first, and links to the page that fixes them.
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
