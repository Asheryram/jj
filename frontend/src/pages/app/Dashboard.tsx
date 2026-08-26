import { Link } from 'react-router-dom'
import { useStore } from '../../state/store'
import { sellLinkFor } from '../../lib/origin'
import { useShopPath } from '../../lib/shopPath'
import { cedis, dateTime } from '../../lib/format'
import { Sparkline } from '../../components/charts'
import {
  Button,
  Card,
  CardHead,
  CopyField,
  EmptyState,
  NetworkChip,
  StatTile,
  StatusBadge,
  cn,
} from '../../components/ui'
import {
  CashIcon,
  ChevronRightIcon,
  DataIcon,
  ReceiptIcon,
  StoreIcon,
  TrendUpIcon,
  UsersIcon,
  WalletIcon,
} from '../../components/icons'

/** FR-6.1 — order history, balance and referred agents in one place. */
export default function Dashboard() {
  const {
    session,
    agentBalance,
    customerBalance,
    orders,
    myShareOf,
    subAgents,
    agentEarningsByDay,
    mySummary,
  } = useStore()
  if (!session) return null

  const isAgent = session.role === 'agent'

  // NFR-2.5 — only what belongs to this user. Used for the recent-activity list,
  // which is genuinely a "latest few" view.
  const mine = isAgent
    ? orders.filter((o) => o.split?.shares.some((s) => s.userId === session.id))
    : orders.filter((o) => o.buyerPhone === session.phone || o.buyer === session.name)

  /**
   * Totals come from the server, not from `orders`.
   *
   * The orders list is capped, so summing it undercounts as soon as an agent
   * passes the cap — and it would do so silently, which is the worst kind of
   * wrong number on a page about money. Zeroes show only until the first load
   * lands.
   */
  const earnedToday = mySummary?.earnedToday ?? 0
  const earnedAllTime = mySummary?.earnedAllTime ?? 0
  const spendToday = mySummary?.spentToday ?? 0
  const ordersToday = mySummary?.ordersToday ?? 0
  const ordersCompleted = mySummary?.ordersCompleted ?? 0
  const ordersTotal = mySummary?.ordersTotal ?? 0
  const activeSubAgents = mySummary?.activeSubAgents ?? subAgents.filter((a) => a.status === 'active').length
  const sellLink = sellLinkFor(session.referralCode)
  const shopPath = useShopPath()

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">
          {greeting()}, {session.name.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {isAgent
            ? 'Here is how your business is doing today.'
            : 'Here is your wallet and recent activity.'}
        </p>
      </div>

      {/* ── Balance card, first thing on the page ── */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-4 bg-brand-700 px-5 py-5 text-white">
          <div>
            <p className="text-sm text-brand-100">
              {isAgent ? 'Earnings available to withdraw' : 'Wallet balance'}
            </p>
            <p className="tabular mt-1 text-3xl font-bold tracking-tight">
              {cedis(isAgent ? agentBalance : customerBalance)}
            </p>
          </div>
          <div className="flex gap-2">
            {isAgent ? (
              <>
                <Link to="/app/withdrawals">
                  <Button variant="onBrand">
                    <CashIcon className="size-4" /> Withdraw
                  </Button>
                </Link>
                <Link to="/app/earnings">
                  <Button variant="onBrandOutline">
                    <TrendUpIcon className="size-4" /> Earnings
                  </Button>
                </Link>
              </>
            ) : (
              /* No top-up: customer wallets were withdrawn, and `/app/wallet` has
                 no route, so the button led nowhere. Buying is the only thing this
                 account can still do, and it pays per order with Mobile Money. */
              <Link to={shopPath('/shop')}>
                <Button variant="onBrand">
                  <StoreIcon className="size-4" /> Buy a bundle
                </Button>
              </Link>
            )}
          </div>
        </div>
      </Card>

      {/* ── The sell link, right where an agent will look for it ── */}
      {isAgent && (
        <Card className="mt-3 p-4">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <StoreIcon className="size-4 text-brand-600 dark:text-brand-300" /> Your sell link
            </p>
            <Link
              to="/app/referrals"
              className="flex items-center gap-0.5 text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline"
            >
              Share it <ChevronRightIcon className="size-4" />
            </Link>
          </div>
          <CopyField value={sellLink} />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Customers who buy here pay your prices, and your margin is credited automatically.
          </p>
        </Card>
      )}

      {/* ── Stat tiles ── */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isAgent ? (
          <>
            <StatTile
              label="Earned today"
              value={cedis(earnedToday)}
              hint={`${plural(ordersToday, 'order')} in your chain`}
              tone="brand"
              icon={<TrendUpIcon className="size-5" />}
            />
            <StatTile
              label="Earned all time"
              value={cedis(earnedAllTime)}
              hint="Your price minus your cost"
              icon={<CashIcon className="size-5" />}
            />
            <StatTile
              label="Orders completed"
              value={String(ordersCompleted)}
              hint={`${ordersTotal} total`}
              icon={<ReceiptIcon className="size-5" />}
            />
            <StatTile
              label="Agents under you"
              value={String(activeSubAgents)}
              hint={`${subAgents.length - activeSubAgents} suspended`}
              icon={<UsersIcon className="size-5" />}
            />
          </>
        ) : (
          <>
            <StatTile
              label="Spent today"
              value={cedis(spendToday)}
              hint={plural(ordersToday, 'order')}
              tone="brand"
              icon={<CashIcon className="size-5" />}
            />
            <StatTile
              label="Orders completed"
              value={String(ordersCompleted)}
              icon={<ReceiptIcon className="size-5" />}
            />
            <StatTile
              label="Data bought"
              value={`${mine.filter((o) => o.status === 'completed' && o.category === 'data').length} bundles`}
              hint="In your recent orders"
              icon={<DataIcon className="size-5" />}
            />
            <StatTile
              label="Wallet balance"
              value={cedis(customerBalance)}
              icon={<WalletIcon className="size-5" />}
            />
          </>
        )}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {/* ── Recent orders ── */}
        <Card className="lg:col-span-2">
          <CardHead
            title={isAgent ? 'Recent sales' : 'Recent orders'}
            action={
              <Link
                to="/app/orders"
                className="flex items-center gap-0.5 text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline"
              >
                See all <ChevronRightIcon className="size-4" />
              </Link>
            }
          />
          {mine.length === 0 ? (
            <EmptyState
              icon={<ReceiptIcon className="size-6" />}
              title={isAgent ? 'No sales yet' : 'No orders yet'}
              detail={
                isAgent
                  ? 'Share your sell link and the orders your customers place will show up here.'
                  : 'Your first purchase will show up here with its delivery status.'
              }
              action={
                <Link to={isAgent ? '/app/referrals' : shopPath('/shop')}>
                  <Button>{isAgent ? 'Get my sell link' : 'Buy your first bundle'}</Button>
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {mine.slice(0, 6).map((order) => {
                const share = myShareOf(order)
                return (
                  <li key={order.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900 dark:text-slate-50">{order.productName}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <NetworkChip network={order.network} />
                        <span className="tabular">{order.recipient}</span>
                        <span aria-hidden="true">·</span>
                        <span>{dateTime(order.createdAt)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular font-semibold text-slate-900 dark:text-slate-50">
                        {isAgent && share
                          ? cedis(share.margin, { sign: true })
                          : cedis(order.salePrice)}
                      </p>
                      <div className="mt-1 flex justify-end">
                        <StatusBadge status={order.status} />
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* ── Side column ── */}
        <div className="space-y-3">
          {isAgent && (
            <Card className="p-4">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Earnings, last 7 days</p>
                <span className="tabular text-sm font-bold text-brand-700 dark:text-brand-300">
                  {cedis(agentEarningsByDay.reduce((s, d) => s + d.revenue, 0))}
                </span>
              </div>
              <div className="mt-3 text-brand-500">
                <Sparkline values={agentEarningsByDay.map((d) => d.revenue)} />
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{agentEarningsByDay[0].day}</span>
                <span>{agentEarningsByDay[agentEarningsByDay.length - 1].day}</span>
              </div>
              <Link
                to="/app/reports"
                className="mt-3 flex items-center gap-0.5 text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline"
              >
                Full report <ChevronRightIcon className="size-4" />
              </Link>
            </Card>
          )}

          <Card>
            <CardHead title="Quick actions" />
            <div className="divide-y divide-slate-100">
              {/* Keyed by label, not route — two agent actions deliberately
                  point at the same page from different angles. */}
              {quickActions(isAgent, shopPath).map((action) => (
                <Link
                  key={action.label}
                  to={action.to}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-xl',
                      action.accent,
                    )}
                  >
                    <action.icon className="size-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {action.label}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{action.hint}</span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-slate-300 dark:text-slate-600" />
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** "1 order", "2 orders". A stat tile reading "1 orders" undermines the number. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** `shopPath` keeps a customer's shop shortcuts attributed to the agent whose
 *  link they arrived on. The agent branch has no shop links to scope. */
function quickActions(isAgent: boolean, shopPath: (path: string) => string) {
  if (isAgent) {
    return [
      {
        to: '/app/referrals',
        label: 'Share my shop',
        hint: 'Send your sell link on WhatsApp',
        icon: StoreIcon,
        accent: 'bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300',
      },
      {
        to: '/app/pricing',
        label: 'Set my prices',
        hint: 'Change what you charge',
        icon: TrendUpIcon,
        accent: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400',
      },
      {
        to: '/app/referrals',
        label: 'Invite an agent',
        hint: 'Earn on their sales too',
        icon: UsersIcon,
        accent: 'bg-violet-50 text-violet-700',
      },
      {
        to: '/app/withdrawals',
        label: 'Withdraw earnings',
        hint: 'Paid to your MoMo',
        icon: CashIcon,
        accent: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400',
      },
    ]
  }

  return [
    {
      to: shopPath('/shop?category=data'),
      label: 'Buy data',
      hint: 'MTN, Telecel, AirtelTigo',
      icon: DataIcon,
      accent: 'bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300',
    },
    {
      // Was "Top up wallet", pointing at a route that no longer exists.
      to: '/app/orders',
      label: 'Your orders',
      hint: 'Track a delivery',
      icon: ReceiptIcon,
      accent: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400',
    },
    {
      to: '/register',
      label: 'Become an agent',
      hint: 'Sell at your own prices',
      icon: TrendUpIcon,
      accent: 'bg-violet-50 text-violet-700',
    },
  ]
}
