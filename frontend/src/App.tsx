import type { ReactNode } from 'react'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { StoreProvider, useStore } from './state/store'
import { BrandingProvider } from './state/branding'
import { AppShell, PublicShell, RequireAuth } from './components/layout'
import RouteMeta from './components/RouteMeta'
import { Button, Card, EmptyState, Spinner } from './components/ui'
import { AlertIcon, SearchIcon } from './components/icons'

import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import Shop from './pages/Shop'
import Storefront from './pages/Storefront'
import Checkers from './pages/Checkers'
import Buy from './pages/Buy'
import Track from './pages/Track'

import Dashboard from './pages/app/Dashboard'
import Earnings from './pages/app/Earnings'
import Orders from './pages/app/Orders'
import Pricing from './pages/app/Pricing'
import Referrals from './pages/app/Referrals'
import ShopBranding from './pages/app/ShopBranding'
import AwaitingApproval from './pages/app/AwaitingApproval'
import Reports from './pages/app/Reports'
import Withdrawals from './pages/app/Withdrawals'

import Overview from './pages/admin/Overview'
import AdminOrders from './pages/admin/AdminOrders'
import Users from './pages/admin/Users'
import CostPrices from './pages/admin/CostPrices'
import AdminWithdrawals from './pages/admin/AdminWithdrawals'
import NumberApprovals from './pages/admin/NumberApprovals'
import PaymentReturn from './pages/PaymentReturn'
import SetPassword from './pages/SetPassword'
import ForgotPassword from './pages/ForgotPassword'
import Refunds from './pages/admin/Refunds'
import BrandingReview from './pages/admin/BrandingReview'
import Team from './pages/admin/Team'
import Settings from './pages/admin/Settings'

/**
 * Decides whose branding the current page wears.
 *
 * Read from the URL, deliberately NOT from the store's `sellerCode`. That value
 * is sticky by design — it lives in sessionStorage so a buyer who arrives through
 * an agent's link keeps buying from that agent as they move around — and theming
 * from it meant an admin who had once opened an agent's shop kept the agent's
 * colours on their own admin pages for the rest of the session.
 *
 * So: only `/s/<code>` paths wear an agent's brand. The admin screens, the agent
 * dashboard and the platform's own storefront are the platform's, whatever link
 * somebody arrived by.
 */
function ShopTheme({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const shopCode = pathname.match(/^\/s\/([^/]+)/)?.[1] ?? null
  return (
    <BrandingProvider sellerCode={shopCode ? decodeURIComponent(shopCode) : null}>
      {children}
    </BrandingProvider>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Boot>
        <BrowserRouter>
        {/* Inside the router because it themes from the /s/<code> route, and
            inside the store because that is what resolves the code. */}
        <ShopTheme>
        <RouteMeta />
        <Routes>
          {/* Public storefront — buyable without an account (FR-4.8) */}
          <Route element={<PublicShell />}>
            {/* The front door is the shop itself — buying is never a page away. */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/checkers" element={<Checkers />} />
            <Route path="/track" element={<Track />} />
            {/* Where Paystack sends the customer back to. Public: a guest paying
                with Mobile Money has no account, and the reference in the URL is
                checked with Paystack rather than believed. */}
            <Route path="/pay/return" element={<PaymentReturn />} />
            {/* Public: the holder of a one-time link is not signed in yet, and
                the token is what authorises them. */}
            <Route path="/set-password" element={<SetPassword />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            {/* A guest must be able to complete a purchase (FR-4.8) */}
            <Route path="/buy/:productId" element={<Buy />} />

            {/*
              An agent's sell link (FR-5.7), and the whole shop beneath it.

              The same pages as above, mounted a second time under `/s/:code`, so
              a buyer in an agent's shop keeps the agent in the URL as they move
              around. The pages are identical — `Storefront` only puts the code
              into the store, and prices resolve from there. Nothing is
              duplicated but the route table.
            */}
            <Route path="/s/:code" element={<Storefront />}>
              <Route index element={<Home />} />
              <Route path="shop" element={<Shop />} />
              <Route path="checkers" element={<Checkers />} />
              <Route path="track" element={<Track />} />
              <Route path="buy/:productId" element={<Buy />} />
            </Route>
          </Route>

          {/* Signed-in area — customers and agents (FR-1.5, NFR-2.5).
              Checkout deliberately stays on the public shell above so that one
              code path serves guests and account holders alike. */}
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path="/app" element={<Dashboard />} />
              <Route path="/app/orders" element={<Orders />} />
              <Route path="/app/reports" element={<Reports />} />

              {/* No wallet route. Customer accounts are not created any more, and
                  top-ups are closed, so the page could only ever refuse. The
                  Wallet screen and its ledger stay in the codebase for the day
                  holding customer balances is worth the reconciliation. */}

              {/* Agent-only surfaces */}
              <Route element={<RequireAuth role="agent" />}>
                <Route path="/app/earnings" element={<Earnings />} />
                <Route path="/app/pricing" element={<Pricing />} />
                <Route path="/app/shop-look" element={<ShopBranding />} />
              <Route path="/app/status" element={<AwaitingApproval />} />
                <Route path="/app/referrals" element={<Referrals />} />
                <Route path="/app/withdrawals" element={<Withdrawals />} />
              </Route>
            </Route>
          </Route>

          {/* Admin — James only */}
          <Route element={<RequireAuth role="admin" />}>
            <Route element={<AppShell />}>
              <Route path="/admin" element={<Overview />} />
              <Route path="/admin/orders" element={<AdminOrders />} />
              <Route path="/admin/users" element={<Users />} />
              <Route path="/admin/prices" element={<CostPrices />} />
              <Route path="/admin/withdrawals" element={<AdminWithdrawals />} />
              <Route path="/admin/approvals" element={<NumberApprovals />} />
              <Route path="/admin/refunds" element={<Refunds />} />
              <Route path="/admin/branding" element={<BrandingReview />} />
              <Route path="/admin/team" element={<Team />} />
              <Route path="/admin/settings" element={<Settings />} />
            </Route>
          </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </ShopTheme>
        </BrowserRouter>
      </Boot>
    </StoreProvider>
  )
}

/**
 * Holds the app back until the catalogue has loaded, and says so plainly if the
 * API cannot be reached.
 *
 * Worth a gate of its own rather than a spinner per page: without the catalogue
 * there are no products and no referral chain, so every price on every screen
 * would render as zero. A shop quoting GHS 0.00 is a worse failure than a shop
 * that admits it is offline, because somebody will try to buy at that price.
 */
function Boot({ children }: { children: ReactNode }) {
  const { ready, offline, reconnect } = useStore()

  if (!ready) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center px-4"
        role="status"
        aria-live="polite"
      >
        <div className="text-center">
          <Spinner className="mx-auto size-8 text-brand-600" />
          <p className="mt-3 text-sm text-slate-500">Loading the shop…</p>
        </div>
      </div>
    )
  }

  if (offline) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
        <Card className="w-full">
          <EmptyState
            icon={<AlertIcon className="size-6" />}
            title="We cannot reach the shop right now"
            detail={offline}
            action={<Button onClick={() => void reconnect()}>Try again</Button>}
          />
        </Card>
      </div>
    )
  }

  return <>{children}</>
}

function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20">
      <Card>
        <EmptyState
          icon={<SearchIcon className="size-6" />}
          title="That page does not exist"
          detail="The link may be old, or the page may have moved."
          action={
            <Link to="/">
              <Button>Go to the storefront</Button>
            </Link>
          }
        />
      </Card>
    </div>
  )
}
