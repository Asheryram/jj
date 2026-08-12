import { useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../state/store'
import { cedis, initials } from '../lib/format'
import type { Role } from '../data/types'
import { Badge, Button, Modal, Segmented, Toggle, cn } from './ui'
import {
  AlertIcon,
  CashIcon,
  ChartIcon,
  CheckIcon,
  HomeIcon,
  LogoutIcon,
  MenuIcon,
  ReceiptIcon,
  SettingsIcon,
  ShieldIcon,
  StoreIcon,
  TagIcon,
  UsersIcon,
  WalletIcon,
  XIcon,
} from './icons'

// ─── Brand ──────────────────────────────────────────────────────────────────

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-base font-bold text-white">
        J
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block font-bold tracking-tight text-slate-900">JamesDataConsult</span>
          <span className="block text-[11px] font-medium text-slate-500">
            Data · Airtime · Checkers
          </span>
        </span>
      )}
    </Link>
  )
}

// ─── Demo bar ───────────────────────────────────────────────────────────────

/**
 * Present-mode controls. Not part of the product — it exists so the whole
 * platform can be walked through in one sitting without seeding accounts, and
 * so the failure-and-refund path (FR-2.7) can be demonstrated on demand.
 */
/** Who you are viewing as. A buyer is simply nobody — no account at all. */
type Viewer = 'buyer' | 'agent' | 'admin'

export function DemoBar() {
  const { session, login, logout, simulateFailure, setSimulateFailure } = useStore()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const viewer: Viewer =
    session?.role === 'admin' ? 'admin' : session?.role === 'agent' ? 'agent' : 'buyer'

  return (
    <div className="sticky top-0 z-40 bg-slate-900 text-white">
      <div className="mx-auto flex h-9 max-w-7xl items-center gap-3 px-3 text-xs sm:px-4">
        <span className="flex items-center gap-1.5 font-semibold tracking-wide text-amber-300 uppercase">
          <AlertIcon className="size-3.5" /> Demo
        </span>
        <span className="hidden text-slate-400 sm:inline">
          Mock data — no live payments or DataHub GH calls
        </span>
        <div className="ml-auto flex items-center gap-2">
          {simulateFailure && (
            <span className="hidden rounded bg-red-500/20 px-1.5 py-0.5 font-semibold text-red-300 sm:inline">
              Failure mode on
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md bg-white/10 px-2 py-1 font-semibold hover:bg-white/20"
          >
            View as: {viewer}
          </button>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Demo controls">
        <div className="space-y-5 text-slate-800">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">View the site as</p>
            <Segmented<Viewer>
              className="w-full"
              options={[
                { value: 'buyer', label: 'Buyer' },
                { value: 'agent', label: 'Agent' },
                { value: 'admin', label: 'Admin' },
              ]}
              value={viewer}
              onChange={(next) => {
                setOpen(false)
                if (next === 'buyer') {
                  // A buyer is nobody: no account, no login. Straight to the shop.
                  logout()
                  navigate('/')
                  return
                }
                login(next)
                navigate(next === 'admin' ? '/admin' : '/app')
              }}
            />
            <p className="mt-2 text-sm text-slate-500">
              A <strong className="font-semibold">buyer</strong> has no account at all — that is the
              main path through the site. Accounts exist for people who want to{' '}
              <strong className="font-semibold">sell</strong> (agent) or run the platform (admin).
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 p-3.5">
            <p className="text-sm font-semibold text-slate-800">Optional: the customer wallet</p>
            <p className="mt-0.5 text-sm text-slate-500">
              A frequent buyer can register to keep a topped-up balance and skip the Mobile Money
              prompt (FR-2.1, FR-2.2). It is not required to buy anything.
            </p>
            <button
              type="button"
              onClick={() => {
                login('customer')
                setOpen(false)
                navigate('/app/wallet')
              }}
              className="mt-2 text-sm font-semibold text-brand-700 hover:underline"
            >
              View as a wallet holder
            </button>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-3.5">
            <div className="min-w-0">
              <label htmlFor="sim-fail" className="block text-sm font-semibold text-slate-800">
                Simulate upstream failure
              </label>
              <p className="mt-0.5 text-sm text-slate-500">
                The next order fails at the provider and is refunded to the wallet — the FR-2.7 and
                NFR-3.3 path.
              </p>
            </div>
            <Toggle
              id="sim-fail"
              label="Simulate upstream failure"
              checked={simulateFailure}
              onChange={setSimulateFailure}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Navigation model ───────────────────────────────────────────────────────

interface NavItem {
  to: string
  label: string
  icon: (props: { className?: string }) => ReactNode
  end?: boolean
}

function navFor(role: Role): NavItem[] {
  if (role === 'admin') {
    return [
      { to: '/admin', label: 'Overview', icon: HomeIcon, end: true },
      { to: '/admin/orders', label: 'All orders', icon: ReceiptIcon },
      { to: '/admin/users', label: 'Users', icon: UsersIcon },
      { to: '/admin/prices', label: 'Cost prices', icon: TagIcon },
      { to: '/admin/withdrawals', label: 'Withdrawals', icon: CashIcon },
      { to: '/admin/settings', label: 'Settings', icon: SettingsIcon },
    ]
  }

  if (role === 'agent') {
    // Agents have earnings, not a wallet — they never pre-fund anything.
    return [
      { to: '/app', label: 'Dashboard', icon: HomeIcon, end: true },
      { to: '/app/referrals', label: 'Sell & refer', icon: StoreIcon },
      { to: '/app/earnings', label: 'Earnings', icon: WalletIcon },
      { to: '/app/orders', label: 'Sales', icon: ReceiptIcon },
      { to: '/app/pricing', label: 'My prices', icon: TagIcon },
      { to: '/shop', label: 'Browse shop', icon: UsersIcon },
      { to: '/app/reports', label: 'Reports', icon: ChartIcon },
      { to: '/app/withdrawals', label: 'Withdraw', icon: CashIcon },
    ]
  }

  return [
    { to: '/app', label: 'Dashboard', icon: HomeIcon, end: true },
    { to: '/shop', label: 'Buy', icon: StoreIcon },
    { to: '/app/wallet', label: 'Wallet', icon: WalletIcon },
    { to: '/app/orders', label: 'Orders', icon: ReceiptIcon },
    { to: '/app/reports', label: 'My spending', icon: ChartIcon },
  ]
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors',
    isActive
      ? 'bg-brand-50 text-brand-800'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  )

// ─── Shell ──────────────────────────────────────────────────────────────────

export function RequireAuth({ role }: { role?: Role }) {
  const { session } = useStore()
  const location = useLocation()

  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (role && session.role !== role) return <Navigate to="/app" replace />
  return <Outlet />
}

export function AppShell() {
  const { session, balance, logout } = useStore()
  const [moreOpen, setMoreOpen] = useState(false)
  if (!session) return null

  const items = navFor(session.role)
  const primary = items.slice(0, 4)
  const overflow = items.slice(4)

  return (
    <div className="min-h-dvh bg-slate-50">
      <DemoBar />

      <header className="sticky top-9 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-3 sm:px-4">
          <Logo compact />
          <span className="hidden font-bold tracking-tight text-slate-900 sm:block">
            JamesDataConsult
          </span>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {session.role !== 'admin' && (
              <Link
                to={session.role === 'agent' ? '/app/earnings' : '/app/wallet'}
                title={session.role === 'agent' ? 'Earnings available' : 'Wallet balance'}
                className="tabular flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-800 hover:bg-brand-100"
              >
                <WalletIcon className="size-4" />
                {cedis(balance)}
              </Link>
            )}
            {session.role === 'admin' && (
              <Badge tone="brand">
                <ShieldIcon className="size-3.5" /> Admin
              </Badge>
            )}
            <span className="flex size-9 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">
              {initials(session.name)}
            </span>
            <button
              type="button"
              onClick={logout}
              aria-label="Log out"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <LogoutIcon className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-3 sm:px-4">
        <aside className="sticky top-24 hidden h-fit w-56 shrink-0 py-5 lg:block">
          <nav className="space-y-1">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                <item.icon className="size-5 shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-3.5">
            <p className="text-xs font-semibold text-slate-700">{session.name}</p>
            <p className="mt-0.5 text-xs text-slate-500">{session.phone}</p>
            {session.role === 'agent' && (
              <p className="mt-2 font-mono text-xs text-brand-700">{session.referralCode}</p>
            )}
          </div>
        </aside>

        <main className="min-w-0 flex-1 py-5 pb-28 lg:pb-10">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation — four thumb targets plus overflow. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="flex">
          {primary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold',
                  isActive ? 'text-brand-700' : 'text-slate-500',
                )
              }
            >
              <item.icon className="size-5.5" />
              {item.label}
            </NavLink>
          ))}
          {overflow.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold text-slate-500"
            >
              <MenuIcon className="size-5.5" />
              More
            </button>
          )}
        </div>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <nav className="space-y-1">
          {overflow.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={navLinkClass}
              onClick={() => setMoreOpen(false)}
            >
              <item.icon className="size-5 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </Modal>

      <ToastHost />
    </div>
  )
}

// ─── Public chrome ──────────────────────────────────────────────────────────

export function PublicShell() {
  const { session } = useStore()

  return (
    <div className="min-h-dvh bg-white">
      <DemoBar />
      <header className="sticky top-9 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Logo />
          <nav className="ml-auto flex items-center gap-2 sm:gap-3">
            <Link
              to="/shop"
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 sm:block"
            >
              Buy data
            </Link>
            <Link
              to="/checkers"
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 sm:block"
            >
              Result checkers
            </Link>
            <Link
              to="/track"
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 lg:block"
            >
              Track order
            </Link>
            {session ? (
              <Link to={session.role === 'admin' ? '/admin' : '/app'}>
                <Button size="sm">My dashboard</Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost" size="sm">
                    Log in
                  </Button>
                </Link>
                <Link to="/register">
                  {/* Room is tight at 390px — the label shortens rather than wraps. */}
                  <Button size="sm">
                    <span className="sm:hidden">Sell with us</span>
                    <span className="hidden sm:inline">Become an agent</span>
                  </Button>
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <Outlet />
      <PublicFooter />
      <ToastHost />
    </div>
  )
}

export function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-slate-50">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-slate-500">
            Data bundles, airtime, voice and SMS bundles, MTN AFA registration and result checkers —
            delivered in seconds.
          </p>
        </div>
        <FooterColumn
          title="Shop"
          links={[
            ['Data bundles', '/shop'],
            ['Airtime', '/shop'],
            ['Result checkers', '/checkers'],
            ['Track an order', '/track'],
          ]}
        />
        <FooterColumn
          title="Agents"
          links={[
            ['Become an agent', '/register'],
            ['Log in', '/login'],
          ]}
        />
        <div>
          <p className="text-sm font-semibold text-slate-800">Legal</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-500">
            <li>Terms of Service</li>
            <li>Privacy Policy</li>
            <li>Refund Policy</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-200 px-4 py-5">
        <div className="mx-auto max-w-6xl space-y-2 text-xs text-slate-500">
          {/* NFR-7.1 */}
          <p>
            JamesDataConsult is an independent reseller. We are not affiliated with, endorsed by, or
            acting on behalf of WAEC, MTN, Telecel or AirtelTigo.
          </p>
          {/* NFR-7.2 */}
          <p>
            Personal data is handled in line with Ghana&apos;s Data Protection Act, 2012 (Act 843)
            and is shared only as needed to fulfil your order.
          </p>
          <p className="pt-1">© 2026 JamesDataConsult. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map(([label, to]) => (
          <li key={label}>
            <Link to={to} className="text-slate-500 hover:text-brand-700">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Toasts (FR-7.1, FR-7.2 on-screen half) ─────────────────────────────────

export function ToastHost() {
  const { toasts, dismissToast } = useStore()
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-3 top-12 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:top-auto sm:w-80">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn(
            'pointer-events-auto flex gap-2.5 rounded-xl border p-3.5 shadow-lg',
            toast.tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
            toast.tone === 'error' && 'border-red-200 bg-red-50 text-red-900',
            toast.tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
          )}
        >
          <span className="mt-0.5 shrink-0">
            {toast.tone === 'success' ? (
              <CheckIcon className="size-4.5" />
            ) : toast.tone === 'error' ? (
              <AlertIcon className="size-4.5" />
            ) : (
              <AlertIcon className="size-4.5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{toast.title}</p>
            {toast.detail && <p className="mt-0.5 text-sm opacity-90">{toast.detail}</p>}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss"
            className="-mt-0.5 -mr-0.5 shrink-0 self-start rounded p-1 opacity-60 hover:opacity-100"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
