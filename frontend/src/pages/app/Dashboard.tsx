import { Link } from 'react-router-dom'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
import { agentEarningsByDay, subAgents } from '../../data/mock'
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
  const { session, agentBalance, customerBalance, orders, myShareOf } = useStore()
  if (!session) return null

  const isAgent = session.role === 'agent'
  const today = '2026-08-12'

  // NFR-2.5 — only what belongs to this user.
  const mine = isAgent
    ? orders.filter((o) => o.split.shares.some((s) => s.userId === session.id))
    : orders.filter((o) => o.buyer === session.name)

  const todays = mine.filter((o) => o.createdAt.startsWith(today))
  const completed = mine.filter((o) => o.status === 'completed')

  // FR-5.3 — profit is the gap between what you paid and what you charged.
  const earnedToday = todays
    .filter((o) => o.status === 'completed')
    .reduce((sum, o) => sum + (myShareOf(o)?.margin ?? 0), 0)
  const earnedAllTime = completed.reduce((sum, o) => sum + (myShareOf(o)?.margin ?? 0), 0)
  const spendToday = todays.reduce((sum, o) => sum + o.salePrice, 0)
  const activeSubAgents = subAgents.filter((a) => a.status === 'active').length
  const sellLink = `https://jamesdataconsult.com/s/${session.referralCode}`

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {greeting()}, {session.name.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
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
              <>
                <Link to="/app/wallet">
                  <Button variant="onBrand">
                    <WalletIcon className="size-4" /> Top up
                  </Button>
                </Link>
                <Link to="/shop">
                  <Button variant="onBrandOutline">
                    <StoreIcon className="size-4" /> Buy
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* ── The sell link, right where an agent will look for it ── */}
      {isAgent && (
        <Card className="mt-3 p-4">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <StoreIcon className="size-4 text-brand-600" /> Your sell link
            </p>
            <Link
              to="/app/referrals"
              className="flex items-center gap-0.5 text-sm font-semibold text-brand-700 hover:underline"
            >
              Share it <ChevronRightIcon className="size-4" />
            </Link>
          </div>
          <CopyField value={sellLink} />
          <p className="mt-2 text-xs text-slate-500">
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
              hint={`${todays.length} orders in your chain`}
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
              value={String(completed.length)}
              hint={`${mine.length} total`}
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
              hint={`${todays.length} orders`}
              tone="brand"
              icon={<CashIcon className="size-5" />}
            />
            <StatTile
              label="Orders completed"
              value={String(completed.length)}
              icon={<ReceiptIcon className="size-5" />}
            />
            <StatTile
              label="Data bought"
              value={`${completed.filter((o) => o.category === 'data').length} bundles`}
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
                className="flex items-center gap-0.5 text-sm font-semibold text-brand-700 hover:underline"
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
                <Link to={isAgent ? '/app/referrals' : '/shop'}>
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
                      <p className="truncate font-medium text-slate-900">{order.productName}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <NetworkChip network={order.network} />
                        <span className="tabular">{order.recipient}</span>
                        <span aria-hidden="true">·</span>
                        <span>{dateTime(order.createdAt)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular font-semibold text-slate-900">
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
                <p className="text-sm font-semibold text-slate-500">Earnings, last 7 days</p>
                <span className="tabular text-sm font-bold text-brand-700">
                  {cedis(agentEarningsByDay.reduce((s, d) => s + d.revenue, 0))}
                </span>
              </div>
              <div className="mt-3 text-brand-500">
                <Sparkline values={agentEarningsByDay.map((d) => d.revenue)} />
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-slate-400">
                <span>{agentEarningsByDay[0].day}</span>
                <span>{agentEarningsByDay[agentEarningsByDay.length - 1].day}</span>
              </div>
              <Link
                to="/app/reports"
                className="mt-3 flex items-center gap-0.5 text-sm font-semibold text-brand-700 hover:underline"
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
              {quickActions(isAgent).map((action) => (
                <Link
                  key={action.label}
                  to={action.to}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
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
                    <span className="block text-sm font-semibold text-slate-800">
                      {action.label}
                    </span>
                    <span className="block text-xs text-slate-500">{action.hint}</span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function quickActions(isAgent: boolean) {
  if (isAgent) {
    return [
      {
        to: '/app/referrals',
        label: 'Share my shop',
        hint: 'Send your sell link on WhatsApp',
        icon: StoreIcon,
        accent: 'bg-brand-50 text-brand-700',
      },
      {
        to: '/app/pricing',
        label: 'Set my prices',
        hint: 'Change what you charge',
        icon: TrendUpIcon,
        accent: 'bg-sky-50 text-sky-700',
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
        accent: 'bg-amber-50 text-amber-700',
      },
    ]
  }

  return [
    {
      to: '/shop?category=data',
      label: 'Buy data',
      hint: 'MTN, Telecel, AirtelTigo',
      icon: DataIcon,
      accent: 'bg-brand-50 text-brand-700',
    },
    {
      to: '/app/wallet',
      label: 'Top up wallet',
      hint: 'Mobile Money or card',
      icon: WalletIcon,
      accent: 'bg-sky-50 text-sky-700',
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
