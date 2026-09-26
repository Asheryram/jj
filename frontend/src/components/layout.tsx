import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useStore, type Toast } from '../state/store'
import { useBranding } from '../state/branding'
import { useRegisterPath, useShopPath } from '../lib/shopPath'
import { cedis, initials } from '../lib/format'
import { isAdmin } from '../lib/roles'
import { useTheme } from '../lib/theme'
import type { Role } from '../data/types'
import { Badge, Button, Modal, cn } from './ui'
import { UnreadAnnouncementsModal } from './UnreadAnnouncementsModal'
import { api, apiAsset } from '../lib/api'
import {
  AlertIcon,
  CashIcon,
  ChartIcon,
  CheckIcon,
  ChevronLeftIcon,
  ClockIcon,
  GlobeIcon,
  HelpIcon,
  HomeIcon,
  LogoutIcon,
  MenuIcon,
  MoonIcon,
  ReceiptIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  StoreIcon,
  SunIcon,
  TagIcon,
  TrendUpIcon,
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
 * platform's own, the agent loses the sale they generated, which is the fastest
 * way to make agents stop sharing their links.
 */
export function Logo({ compact }: { compact?: boolean }) {
  const branding = useBranding()
  const home = useShopPath()('/')

  return (
    <Link to={home} className="flex min-w-0 items-center gap-2.5">
      {/* An uploaded mark where there is one, and the shop's own initial where
          there is not, a hardcoded "J" on an agent's own shop reads as somebody
          else's brand. */}
      {branding.logoUrl ? (
        <img
          src={apiAsset(branding.logoUrl) ?? undefined}
          alt={branding.shopName}
          className="size-9 shrink-0 rounded-xl object-contain"
        />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-base font-bold text-white">
          {branding.shopName.trim().charAt(0).toUpperCase() || 'J'}
        </span>
      )}
      {!compact && (
        // `min-w-0` lets this shrink below its text's natural width inside the
        // header's flex row, without it a long shop name wraps to a second
        // line instead of truncating, and the header's fixed height clips it.
        <span className="min-w-0 leading-tight">
          <span className="block truncate font-bold tracking-tight text-slate-900 dark:text-slate-50">
            {branding.shopName}
          </span>
          <span className="block truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
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
  /** A small count shown on the nav item, currently only agent sign-ups waiting on Users. */
  badge?: number
  /**
   * One of the four mobile bottom-bar tabs, decided by how urgent the page
   * is, not by its position in the list below. Kept as an explicit flag
   * rather than "the first four items" so reordering or inserting into the
   * grouped list (Analytics and Assistant were both added after this array
   * was first written) can never silently bump something like Withdrawals
   * out of thumb reach without anyone noticing.
   */
  primary?: boolean
  /**
   * The sidebar/More-menu section this item renders under. Undefined items
   * render above the first section, un-headed, for the small number of
   * entry points (Overview, Analytics, Assistant) that aren't really "a
   * category" of admin work.
   */
  section?: string
}

/**
 * `shopPath` scopes shop links to the sell link in force, if any.
 *
 * Applied to a customer's "Buy" but deliberately NOT to an agent's "Browse
 * shop". They look like the same destination and are not: a customer shopping
 * through an agent's link must stay attributed to that agent, whereas an agent
 * opening the shop is reviewing their own catalogue, the margin column in
 * `Catalogue` only appears when no sell link is active, so scoping it would hide
 * from them the very numbers they went there to see.
 */
/** What each profile is called in the switcher. */
const PROFILE_LABEL: Partial<Record<Role, string>> = {
  superadmin: 'Platform',
  admin: 'Admin',
  agent: 'Agent',
  customer: 'Customer',
}

/**
 * Grouped by function (Money / Orders / Catalogue / People / Platform), not
 * alphabetically or by how the API groups it, so a flat 17-item list isn't
 * the only way to find anything. `primary` marks the four mobile bottom-bar
 * tabs explicitly, independent of position in this array, Overview and All
 * orders are the daily check, Refunds and Withdrawals are money someone else
 * is waiting on. Group order and primary order used to be the same thing
 * (whichever four happened to be listed first), which is exactly how
 * Analytics and Assistant, both added later, silently bumped Refunds and
 * Withdrawals out of thumb reach without either becoming untrue as a
 * sentence in this comment, see `NavItem.primary`'s own doc.
 */
function navFor(
  role: Role,
  shopPath: (path: string) => string,
  pendingApplications = 0,
  needsAttentionCount = 0,
  openFeedbackCount = 0,
  unreadAnnouncementsCount = 0,
  pendingDomainsCount = 0,
): NavItem[] {
  if (isAdmin(role)) {
    return [
      { to: '/admin', label: 'Overview', icon: HomeIcon, end: true, primary: true },
      // Not /admin/analytics on purpose, it reads a separate warehouse
      // database, computed on a schedule, not a live query like everything
      // else in this list.
      { to: '/analytics', label: 'Analytics', icon: ChartIcon },
      { to: '/admin/assistant', label: ' Assistant ', icon: HelpIcon },

      { to: '/admin/orders', label: 'All orders', icon: ReceiptIcon, section: 'Orders', primary: true },
      {
        to: '/admin/needs-attention',
        label: 'Needs attention',
        icon: AlertIcon,
        section: 'Orders',
        badge: needsAttentionCount > 0 ? needsAttentionCount : undefined,
      },
      // Renamed from "Approvals": this is DataHub-blocked phone numbers, not
      // agent sign-ups, those wait on Users instead (see the badge below),
      // and sharing the word "approvals" between two unrelated queues was
      // sending admins to the wrong screen.
      { to: '/admin/approvals', label: 'Number approvals', icon: ShieldIcon, section: 'Orders' },

      { to: '/admin/refunds', label: 'Refunds', icon: ReceiptIcon, section: 'Money', primary: true },
      { to: '/admin/withdrawals', label: 'Withdrawals', icon: CashIcon, section: 'Money', primary: true },
      { to: '/admin/finance', label: 'Finance', icon: CashIcon, section: 'Money' },
      // Superadmin only, matches the route guard: correcting a logged
      // capital movement is one step more sensitive than logging a fresh
      // one, and this is easy to miss entirely if it's never in the nav.
      ...(role === 'superadmin'
        ? [
            {
              to: '/admin/finance/float-corrections',
              label: 'Float corrections',
              icon: SearchIcon,
              section: 'Money',
            },
          ]
        : []),
      { to: '/admin/float-risk', label: 'Float risk', icon: AlertIcon, section: 'Money' },
      { to: '/admin/subscriptions', label: 'Subscriptions', icon: ClockIcon, section: 'Money' },

      { to: '/admin/prices', label: 'Cost prices', icon: TagIcon, section: 'Catalogue' },
      {
        to: '/admin/catalogue-accuracy',
        label: 'Catalogue accuracy',
        icon: TrendUpIcon,
        section: 'Catalogue',
      },
      { to: '/admin/branding', label: 'Branding', icon: StoreIcon, section: 'Catalogue' },
      {
        to: '/admin/branding-requests',
        label: 'Agent requests',
        icon: StoreIcon,
        section: 'Catalogue',
      },

      {
        to: '/admin/users',
        label: 'Users',
        icon: UsersIcon,
        section: 'People',
        badge: pendingApplications > 0 ? pendingApplications : undefined,
      },
      {
        to: '/admin/feedback',
        label: 'Feedback',
        icon: HelpIcon,
        section: 'People',
        badge: openFeedbackCount > 0 ? openFeedbackCount : undefined,
      },
      {
        // An admin with something unread goes straight to Received, the page
        // the badge is actually counting, rather than landing on Sent and
        // having to find their way there. Superadmin composes but is never a
        // recipient, so this always points at Sent for them.
        to: role === 'admin' && unreadAnnouncementsCount > 0 ? '/admin/announcements/received' : '/admin/announcements',
        label: 'Announcements',
        icon: AlertIcon,
        section: 'People',
        badge: role === 'admin' && unreadAnnouncementsCount > 0 ? unreadAnnouncementsCount : undefined,
      },

      { to: '/admin/settings', label: 'Settings', icon: SettingsIcon, section: 'Platform' },
      // Platform access belongs to the operator, not the business owner. An
      // admin must not be shown a door they cannot open. Approving a custom
      // domain is the same kind of trust decision, vouching that whoever
      // asked for it actually controls it, so it sits here too.
      ...(role === 'superadmin'
        ? [
            { to: '/admin/team', label: 'Platform team', icon: ShieldIcon, section: 'Platform' },
            {
              to: '/admin/domains',
              label: 'Custom domains',
              icon: GlobeIcon,
              section: 'Platform',
              badge: pendingDomainsCount > 0 ? pendingDomainsCount : undefined,
            },
          ]
        : []),
    ]
  }

  if (role === 'agent') {
    // Agents have earnings, not a wallet, they never pre-fund anything.
    return [
      { to: '/app', label: 'Dashboard', icon: HomeIcon, end: true, primary: true },
      { to: '/app/assistant', label: ' Assistant ', icon: HelpIcon },

      { to: '/app/referrals', label: 'Sell & refer', icon: StoreIcon, section: 'Sell', primary: true },
      { to: '/app/pricing', label: 'My prices', icon: TagIcon, section: 'Sell' },
      { to: '/app/shop-look', label: 'Shop look', icon: StoreIcon, section: 'Sell' },
      // Unscoped on purpose, see the note above navFor.
      { to: '/shop', label: 'Browse shop', icon: UsersIcon, section: 'Sell' },

      { to: '/app/earnings', label: 'Earnings', icon: WalletIcon, section: 'Money', primary: true },
      { to: '/app/withdrawals', label: 'Withdraw', icon: CashIcon, section: 'Money' },

      { to: '/app/orders', label: 'Sales', icon: ReceiptIcon, section: 'Activity', primary: true },
      { to: '/app/reports', label: 'Reports', icon: ChartIcon, section: 'Activity' },

      { to: '/app/feedback', label: 'Feedback', icon: HelpIcon },
      {
        to: '/app/announcements',
        label: 'Announcements',
        icon: AlertIcon,
        badge: unreadAnnouncementsCount > 0 ? unreadAnnouncementsCount : undefined,
      },
    ]
  }

  /**
   * The customer menu, minus the wallet.
   *
   * Customer accounts are no longer created, a buyer pays per order with Mobile
   * Money and needs none, so this is only ever seen by an account that predates
   * that. The wallet entry is gone because there is nothing to top it up with;
   * leaving it would be a link to a page that can only refuse.
   */
  return [
    { to: '/app', label: 'Dashboard', icon: HomeIcon, end: true, primary: true },
    { to: shopPath('/shop'), label: 'Buy', icon: StoreIcon, primary: true },
    { to: '/app/orders', label: 'Orders', icon: ReceiptIcon, primary: true },
    { to: '/app/reports', label: 'My spending', icon: ChartIcon, primary: true },
  ]
}

/**
 * Consecutive runs of the same `section`, in the order the list already
 * defines, `navFor()` already writes each section's items together so this
 * is a grouping pass, not a sort. `undefined` sections (Overview, Analytics,
 * Assistant) come back as their own headless run, rendered with no label.
 */
function sectioned(items: NavItem[]): { section: string | undefined; items: NavItem[] }[] {
  const groups: { section: string | undefined; items: NavItem[] }[] = []
  for (const item of items) {
    const current = groups[groups.length - 1]
    if (current && current.section === item.section) current.items.push(item)
    else groups.push({ section: item.section, items: [item] })
  }
  return groups
}

/** A small waiting-count on a nav item, currently just agent sign-ups on Users. */
function NavBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white',
        className,
      )}
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors',
    isActive
      ? 'bg-brand-50 dark:bg-brand-900/40 text-brand-800 dark:text-brand-300'
      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-50',
  )

// ─── Shell ──────────────────────────────────────────────────────────────────

/** Where a role lands when it needs somewhere to go, its own dashboard. */
function homeFor(role: Role): string {
  return isAdmin(role) ? '/admin' : '/app'
}

export function RequireAuth({ role, roles }: { role?: Role; roles?: Role[] }) {
  const { session } = useStore()
  const location = useLocation()

  // The full path, not just `pathname`. A deep link like an admin's
  // "?status=open" filter or a feedback item's own reference in the URL
  // would otherwise survive the trip to `/login` and then get silently
  // dropped, landing back on the bare page instead of the exact spot the
  // link pointed at.
  if (!session)
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />

  // `roles` generalises the single-`role` gate below to "any of these", used
  // where a route belongs to more than one role (e.g. /info, staff-only but
  // open to both admin and agent) without loosening it to every signed-in
  // session the way omitting both props does.
  const allowedRoles = roles ?? (role ? [role] : null)
  // A superadmin satisfies an `admin` gate, mirroring the server's guard. Without
  // this the operator could reach the API but not the screens that call it.
  const allowed =
    !allowedRoles ||
    allowedRoles.some((r) => session.role === r || (r === 'admin' && isAdmin(session.role)))
  // `homeFor`, not a hardcoded `/app`: an admin who lands here on a mismatched
  // agent-only route (or mid-switch, see `swap` below) belongs at `/admin`,
  // not at the agent dashboard.
  if (!allowed) return <Navigate to={homeFor(session.role)} replace />

  /**
   * An agent who has not been approved sees one screen, whatever they navigate to.
   *
   * Not a redirect loop risk: `/app/status` is reached through this same guard and
   * is excluded below. Enforcing it here rather than page by page means a new agent
   * screen cannot forget to check, and every one of them would be broken for a
   * pending agent anyway, since their code does not resolve as a seller.
   */
  if (
    session.role === 'agent' &&
    session.status !== 'active' &&
    location.pathname !== '/app/status'
  ) {
    return <Navigate to="/app/status" replace />
  }

  return <Outlet />
}

/**
 * A site-wide warning banner, set by James for something like a network
 * running slow, not something to interrupt anyone with, so it never pops
 * up or asks to be dismissed; it just sits in view for as long as the
 * situation lasts, the same for a guest, an agent or an admin. Renders
 * nothing when there's nothing set.
 *
 * Shown in both shells (below), never inside a single page, a page-level
 * placement would mean it comes and goes as someone navigates, when the
 * whole point is that it stays put regardless of where they are.
 */
function SiteNotice() {
  const { siteNotice } = useStore()
  if (!siteNotice) return null

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-900 dark:bg-amber-950/60">
      <div className="mx-auto flex max-w-7xl items-start gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
        <AlertIcon className="mt-0.5 size-4.5 shrink-0" />
        <p>{siteNotice}</p>
      </div>
    </div>
  )
}

export function AppShell() {
  const branding = useBranding()
  const { session, balance, logout, profiles, switchProfile, unreadAnnouncementsCount } = useStore()
  const [switching, setSwitching] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * A route change driven by `history.push` (what every in-app `<Link>` does)
   * does not get the browser's native jump-to-anchor behaviour that a real
   * page load with a `#hash` in the URL gets, so a link like
   * `/admin/settings#your-details` would land on the page without ever
   * scrolling to it. Handled once here rather than per-page.
   */
  useEffect(() => {
    if (!location.hash) return
    const target = document.getElementById(location.hash.slice(1))
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.pathname, location.hash])

  /**
   * Move to another of this person's profiles, and land somewhere it makes sense.
   *
   * The destination matters: switching to an agent while standing on an admin
   * page would leave you on a route your new role cannot open, and the guard
   * would bounce you somewhere arbitrary. So the switch decides where you go.
   *
   * `switchProfile` commits the new session to the store as soon as its own
   * request answers, before the catalogue/session data it also loads has
   * finished, so `RequireAuth` above sees the new role while the URL is still
   * the old page and, correctly, redirects on its own before this function
   * ever gets to. Navigating again afterwards to that same page a second time
   * left the screen blank instead of just doing nothing, some interruption in
   * the middle of matching routes, not a crash anything here logs. Checking
   * the real URL first avoids ever sending a second, redundant navigation to
   * where the guard has already put us.
   */
  const swap = async (userId: string) => {
    if (!session || userId === session.id || switching) return
    setSwitching(true)
    try {
      const next = await switchProfile(userId)
      const destination = homeFor(next.role)
      if (window.location.pathname !== destination) navigate(destination, { replace: true })
    } finally {
      setSwitching(false)
    }
  }
  const shopPath = useShopPath()
  const [moreOpen, setMoreOpen] = useState(false)

  /**
   * A count on the Users nav item, so a waiting agent sign-up is visible from
   * anywhere rather than only after opening Users itself. Fetched here, once
   * per admin session, rather than lifted into the global store: nothing else
   * in the app needs this number, and `Users`/`AgentApplications` already do
   * their own fetch of the same cheap endpoint for the actual queue.
   */
  const [pendingApplications, setPendingApplications] = useState(0)
  useEffect(() => {
    if (!session || !isAdmin(session.role)) return
    let live = true
    api
      .applicationQueue()
      .then((rows) => live && setPendingApplications(rows.length))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [session?.id, session?.role])

  /** Same reasoning as `pendingApplications` above, for the Needs attention badge. */
  const [needsAttentionCount, setNeedsAttentionCount] = useState(0)
  useEffect(() => {
    if (!session || !isAdmin(session.role)) return
    let live = true
    api
      .needsAttentionOrders()
      .then((rows) => live && setNeedsAttentionCount(rows.length))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [session?.id, session?.role])

  /** Same reasoning as `pendingApplications` above, for the Feedback badge. */
  const [openFeedbackCount, setOpenFeedbackCount] = useState(0)
  useEffect(() => {
    if (!session || !isAdmin(session.role)) return
    let live = true
    api
      .adminFeedbackOpenCount()
      .then((count) => live && setOpenFeedbackCount(count))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [session?.id, session?.role])

  /** Same reasoning as `pendingApplications` above, for the Custom domains badge. */
  const [pendingDomainsCount, setPendingDomainsCount] = useState(0)
  useEffect(() => {
    if (!session || session.role !== 'superadmin') return
    let live = true
    api
      .adminDomainsPendingCount()
      .then((count) => live && setPendingDomainsCount(count))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [session?.id, session?.role])

  if (!session) return null

  const items = navFor(
    session.role,
    shopPath,
    pendingApplications,
    needsAttentionCount,
    openFeedbackCount,
    unreadAnnouncementsCount,
    pendingDomainsCount,
  )
  const primary = items.filter((item) => item.primary)
  const overflow = items.filter((item) => !item.primary)

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <SkipLink />

      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-3 sm:px-4">
          <Logo compact />
          <span className="hidden font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:block">
            {branding.shopName}
          </span>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {!isAdmin(session.role) && (
              <Link
                /* Always earnings. The wallet route was withdrawn with customer
                   accounts, so the other branch pointed at nothing. */
                to="/app/earnings"
                title={session.role === 'agent' ? 'Earnings available' : 'Balance'}
                className="tabular flex items-center gap-2 rounded-xl border border-brand-100 dark:border-brand-800 bg-brand-50 dark:bg-brand-900/40 px-3 py-1.5 text-sm font-bold text-brand-800 dark:text-brand-300 hover:bg-brand-100"
              >
                <WalletIcon className="size-4" />
                {cedis(balance)}
              </Link>
            )}
            {/* Only when there is something to switch to. One profile needs no
                control, and an empty picker reads as a broken feature. */}
            {profiles.length > 1 ? (
              <label className="flex items-center gap-1.5">
                <span className="sr-only">Switch profile</span>
                <ShieldIcon className="size-3.5 text-brand-700 dark:text-brand-300" />
                <select
                  value={session.id}
                  disabled={switching}
                  onChange={(event) => void swap(event.target.value)}
                  className="rounded-xl border border-brand-100 dark:border-brand-800 bg-brand-50 dark:bg-brand-900/40 px-2 py-1.5 text-sm font-bold text-brand-800 dark:text-brand-300 disabled:opacity-60"
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {PROFILE_LABEL[profile.role] ?? profile.role}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              isAdmin(session.role) && (
                <Badge tone="brand">
                  <ShieldIcon className="size-3.5" />{' '}
                  {session.role === 'superadmin' ? 'Platform' : 'Admin'}
                </Badge>
              )
            )}
            <span className="flex size-9 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white dark:bg-slate-200 dark:text-slate-900">
              {initials(session.name)}
            </span>
            <ThemeToggle />
            <button
              type="button"
              onClick={logout}
              aria-label="Log out"
              // `before:-inset-1` widens the actual tap target to the app's
              // 44px minimum without growing the visible hover halo.
              className="relative rounded-lg p-2 text-slate-500 dark:text-slate-400 before:absolute before:-inset-1 before:content-[''] hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <LogoutIcon className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <SiteNotice />
      <UnreadAnnouncementsModal />

      <div className="mx-auto flex max-w-7xl gap-6 px-3 sm:px-4">
        {/*
          `h-[calc(100dvh-3.75rem)]` pins this to exactly the space below the
          sticky header (`top-15` is that same 3.75rem), so `overflow-y-auto`
          on the nav itself has a real boundary to scroll within, without it
          a long nav (17 items for a superadmin) just grows the whole
          sidebar and scrolls the entire page to reach the bottom of it,
          dragging the header out of view along with it. The profile card
          stays a normal flex child below the nav rather than something
          pinned, so it scrolls out of view too on a short screen rather
          than permanently eating space every other row could use.
        */}
        <aside className="sticky top-15 hidden h-[calc(100dvh-3.75rem)] w-56 shrink-0 flex-col py-5 lg:flex">
          <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {sectioned(items).map((group, index) => (
              <div key={group.section ?? `_${index}`} className="space-y-1">
                {group.section && (
                  <p className="px-2.5 pt-1 text-[11px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 uppercase">
                    {group.section}
                  </p>
                )}
                {group.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                    <item.icon className="size-5 shrink-0" />
                    {item.label}
                    {Boolean(item.badge) && <NavBadge count={item.badge as number} className="ml-auto" />}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="mt-5 shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{session.name}</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{session.phone}</p>
            {session.role === 'agent' && (
              <p className="mt-2 font-mono text-xs text-brand-700 dark:text-brand-300">{session.referralCode}</p>
            )}
          </div>
        </aside>

        <main id="main" className="min-w-0 flex-1 py-5 pb-28 lg:pb-10">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation, four thumb targets plus overflow. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="flex">
          {primary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold',
                  isActive ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400',
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
              className="relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400"
            >
              <span className="relative">
                <MenuIcon className="size-5.5" />
                {overflow.some((item) => item.badge) && (
                  <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-brand-600" />
                )}
              </span>
              More
            </button>
          )}
        </div>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <nav className="space-y-4">
          {sectioned(overflow).map((group, index) => (
            <div key={group.section ?? `_${index}`} className="space-y-1">
              {group.section && (
                <p className="px-2.5 text-[11px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 uppercase">
                  {group.section}
                </p>
              )}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={navLinkClass}
                  onClick={() => setMoreOpen(false)}
                >
                  <item.icon className="size-5 shrink-0" />
                  {item.label}
                  {Boolean(item.badge) && <NavBadge count={item.badge as number} className="ml-auto" />}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </Modal>

      <ToastHost />
    </div>
  )
}

/**
 * A deliberately separate shell from `AppShell`, no sidebar, no bottom nav.
 *
 * Analytics reads its own warehouse database, computed on a schedule, and the
 * user asked for it to feel like its own dashboard rather than one more page
 * in the admin app it happens to be deployed alongside. `RequireAuth` still
 * gates it and the header still carries the same logout/theme controls, so an
 * admin never re-authenticates to get here, they just leave the admin chrome
 * behind, with one link back to it.
 */
export function AnalyticsShell() {
  const { session, logout } = useStore()
  if (!session) return null

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-3 sm:px-4">
          <Logo compact />
          <span className="hidden font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:block">
            Analytics
          </span>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Link
              to={homeFor(session.role)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ChevronLeftIcon className="size-4" />
              <span className="hidden sm:inline">Back to admin</span>
            </Link>
            <span className="flex size-9 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white dark:bg-slate-200 dark:text-slate-900">
              {initials(session.name)}
            </span>
            <ThemeToggle />
            <button
              type="button"
              onClick={logout}
              aria-label="Log out"
              className="relative rounded-lg p-2 text-slate-500 dark:text-slate-400 before:absolute before:-inset-1 before:content-[''] hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <LogoutIcon className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-3 py-5 sm:px-4">
        <Outlet />
      </main>

      <ToastHost />
    </div>
  )
}

// ─── Public chrome ──────────────────────────────────────────────────────────

/** WCAG 2.4.1, the first thing in the tab order jumps past the nav. */
export function SkipLink() {
  return (
    <a href="#main" className="skip-link">
      Skip to main content
    </a>
  )
}

/** Switches `data-theme` on `<html>`, see `useTheme` for what that drives. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      // `before:-inset-1` widens the actual tap target to the app's 44px
      // minimum without growing the visible hover halo.
      className="relative rounded-lg p-2 text-slate-500 dark:text-slate-400 before:absolute before:-inset-1 before:content-[''] hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
    >
      {theme === 'dark' ? <SunIcon className="size-5" /> : <MoonIcon className="size-5" />}
    </button>
  )
}

export function PublicShell() {
  const { session } = useStore()
  const shopPath = useShopPath()
  const registerPath = useRegisterPath()

  return (
    <div className="min-h-dvh bg-white dark:bg-slate-950">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Logo />
          <nav className="ml-auto flex items-center gap-2 sm:gap-3">
            <Link
              to={shopPath('/shop')}
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 sm:block"
            >
              Buy data
            </Link>
            <Link
              to={shopPath('/checkers')}
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 sm:block"
            >
              Result checkers
            </Link>
            {/*
              Was `hidden ... lg:block`, invisible on every phone and most
              tablets, with nothing else in this header standing in for it on
              narrow screens (unlike the logged-in shell, which has its own
              mobile bottom nav). A guest with a failed or delayed order has
              no account to check it from, so this is the one way in for
              them, and it was effectively desktop-only. Icon-only below
              `sm:` keeps it inside the same tight header that already
              shortens "Become an agent" for the same reason, rather than
              hiding the whole link again.
            */}
            <Link
              to={shopPath('/track')}
              aria-label="Track order"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 sm:px-3"
            >
              <ReceiptIcon className="size-4.5 sm:hidden" />
              <span className="hidden sm:inline">Track order</span>
            </Link>
            <ThemeToggle />
            {session ? (
              <Link to={isAdmin(session.role) ? '/admin' : '/app'}>
                <Button size="sm">My dashboard</Button>
              </Link>
            ) : (
              <>
                <Link to={shopPath('/login')}>
                  <Button variant="ghost" size="sm">
                    Log in
                  </Button>
                </Link>
                <Link to={registerPath}>
                  {/* Room is tight at 390px, the label shortens rather than wraps. */}
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
      <SiteNotice />
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
    <footer className="mt-16 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-slate-500 dark:text-slate-400">
            Data bundles, airtime, voice and SMS bundles, MTN AFA registration and result checkers
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
            ['Log in', shopPath('/login')],
          ]}
        />
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Legal</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-500 dark:text-slate-400">
            <li>Terms of Service</li>
            <li>Privacy Policy</li>
            <li>Refund Policy</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-5">
        <div className="mx-auto max-w-6xl space-y-2 text-xs text-slate-500 dark:text-slate-400">
          {/* NFR-7.1 */}
          <p>
            JKBK DATA HUB is an independent reseller. We are not affiliated with, endorsed by, or
            acting on behalf of WAEC, MTN, Telecel or AirtelTigo.
          </p>
          {/* NFR-7.2 */}
          <p>
            Personal data is handled in line with Ghana&apos;s Data Protection Act, 2012 (Act 843)
            and is shared only as needed to fulfil your order.
          </p>
          <p className="pt-1">© 2026 JKBK DATA HUB. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map(([label, to]) => (
          <li key={label}>
            <Link to={to} className="text-slate-500 dark:text-slate-400 hover:text-brand-700">
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
        by screen readers, so announcements would be silently dropped, exactly
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
            toast.tone === 'success' && 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-300',
            toast.tone === 'error' && 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-300',
            toast.tone === 'info' && 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sky-900 dark:text-sky-300',
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
            // `before:-inset-2.5` widens the actual tap target to the app's
            // 44px minimum without growing the visible icon or its spacing.
            className="pointer-events-auto relative -mt-0.5 -mr-0.5 shrink-0 self-start rounded p-1 opacity-60 before:absolute before:-inset-2.5 before:content-[''] hover:opacity-100"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
