import { useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useStore, type Toast } from '../state/store'
import { useRegisterPath, useShopPath } from '../lib/shopPath'
import { cedis, initials } from '../lib/format'
import type { Role } from '../data/types'
import { Badge, Button, Modal, cn } from './ui'
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

/**
 * The wordmark, and the way home.
 *
 * "Home" means the agent's storefront whenever a sell link is in force. Linking
 * it to `/` would walk a buyer out of the shop that brought them and into the
 * platform's own — the agent loses the sale they generated, which is the fastest
 * way to make agents stop sharing their links.
 */
export function Logo({ compact }: { compact?: boolean }) {
  const { sellerCode } = useStore()
  const home = sellerCode ? `/s/${sellerCode}` : '/'

  return (
    <Link to={home} className="flex items-center gap-2.5">
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

// ─── Navigation model ───────────────────────────────────────────────────────

interface NavItem {
  to: string
  label: string
  icon: (props: { className?: string }) => ReactNode
  end?: boolean
}

/**
 * `shopPath` scopes shop links to the sell link in force, if any.
 *
 * Applied to a customer's "Buy" but deliberately NOT to an agent's "Browse
 * shop". They look like the same destination and are not: a customer shopping
 * through an agent's link must stay attributed to that agent, whereas an agent
 * opening the shop is reviewing their own catalogue — the margin column in
 * `Catalogue` only appears when no sell link is active, so scoping it would hide
 * from them the very numbers they went there to see.
 */
function navFor(role: Role, shopPath: (path: string) => string): NavItem[] {
  if (role === 'admin') {
    return [
      { to: '/admin', label: 'Overview', icon: HomeIcon, end: true },
      { to: '/admin/orders', label: 'All orders', icon: ReceiptIcon },
      { to: '/admin/approvals', label: 'Approvals', icon: ShieldIcon },
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
      // Unscoped on purpose — see the note above navFor.
      { to: '/shop', label: 'Browse shop', icon: UsersIcon },
      { to: '/app/reports', label: 'Reports', icon: ChartIcon },
      { to: '/app/withdrawals', label: 'Withdraw', icon: CashIcon },
    ]
  }

  return [
    { to: '/app', label: 'Dashboard', icon: HomeIcon, end: true },
    { to: shopPath('/shop'), label: 'Buy', icon: StoreIcon },
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
  const shopPath = useShopPath()
  const [moreOpen, setMoreOpen] = useState(false)
  if (!session) return null

  const items = navFor(session.role, shopPath)
  const primary = items.slice(0, 4)
  const overflow = items.slice(4)

  return (
    <div className="min-h-dvh bg-slate-50">
      <SkipLink />

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
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
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <LogoutIcon className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-3 sm:px-4">
        <aside className="sticky top-15 hidden h-fit w-56 shrink-0 py-5 lg:block">
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

        <main id="main" className="min-w-0 flex-1 py-5 pb-28 lg:pb-10">
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

/** WCAG 2.4.1 — the first thing in the tab order jumps past the nav. */
export function SkipLink() {
  return (
    <a href="#main" className="skip-link">
      Skip to main content
    </a>
  )
}

export function PublicShell() {
  const { session } = useStore()
  const shopPath = useShopPath()
  const registerPath = useRegisterPath()

  return (
    <div className="min-h-dvh bg-white">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Logo />
          <nav className="ml-auto flex items-center gap-2 sm:gap-3">
            <Link
              to={shopPath('/shop')}
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 sm:block"
            >
              Buy data
            </Link>
            <Link
              to={shopPath('/checkers')}
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 sm:block"
            >
              Result checkers
            </Link>
            <Link
              to={shopPath('/track')}
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
                <Link to={registerPath}>
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
      <main id="main">
        <Outlet />
      </main>
      <PublicFooter />
      <ToastHost />
    </div>
  )
}

export function PublicFooter() {
  const shopPath = useShopPath()
  const registerPath = useRegisterPath()

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
            ['Data bundles', shopPath('/shop')],
            ['Airtime', shopPath('/shop')],
            ['Result checkers', shopPath('/checkers')],
            ['Track an order', shopPath('/track')],
          ]}
        />
        <FooterColumn
          title="Agents"
          links={[
            ['Become an agent', registerPath],
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

  const spoken = (t: Toast) => [t.title, t.detail].filter(Boolean).join('. ')

  return (
    <>
      {/*
        The live regions are always in the DOM, even with nothing to say.
        A region created at the same moment as its content is frequently missed
        by screen readers, so announcements would be silently dropped — exactly
        the messages that confirm money moved.

        Errors go in an assertive region (interrupt), everything else polite.
        The visual toasts below are aria-hidden so nothing is read twice.
      */}
      <div aria-live="assertive" aria-atomic="false" className="sr-only">
        {toasts.filter((t) => t.tone === 'error').map((t) => (
          <p key={t.id}>{spoken(t)}</p>
        ))}
      </div>
      <div aria-live="polite" aria-atomic="false" className="sr-only">
        {toasts.filter((t) => t.tone !== 'error').map((t) => (
          <p key={t.id}>{spoken(t)}</p>
        ))}
      </div>

      {toasts.length > 0 && <VisualToasts toasts={toasts} onDismiss={dismissToast} />}
    </>
  )
}

function VisualToasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: number) => void
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-3 top-3 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:top-auto sm:w-80"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
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
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss"
            className="pointer-events-auto -mt-0.5 -mr-0.5 shrink-0 self-start rounded p-1 opacity-60 hover:opacity-100"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
