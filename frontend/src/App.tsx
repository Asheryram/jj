import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { StoreProvider } from './state/store'
import { AppShell, PublicShell, RequireAuth } from './components/layout'
import RouteMeta from './components/RouteMeta'
import { Button, Card, EmptyState } from './components/ui'
import { SearchIcon } from './components/icons'

import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import Shop from './pages/Shop'
import Storefront from './pages/Storefront'
import Checkers from './pages/Checkers'
import Buy from './pages/Buy'
import Track from './pages/Track'

import Dashboard from './pages/app/Dashboard'
import Wallet from './pages/app/Wallet'
import Earnings from './pages/app/Earnings'
import Orders from './pages/app/Orders'
import Pricing from './pages/app/Pricing'
import Referrals from './pages/app/Referrals'
import Reports from './pages/app/Reports'
import Withdrawals from './pages/app/Withdrawals'

import Overview from './pages/admin/Overview'
import AdminOrders from './pages/admin/AdminOrders'
import Users from './pages/admin/Users'
import CostPrices from './pages/admin/CostPrices'
import AdminWithdrawals from './pages/admin/AdminWithdrawals'
import Settings from './pages/admin/Settings'

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <RouteMeta />
        <Routes>
          {/* Public storefront — buyable without an account (FR-4.8) */}
          <Route element={<PublicShell />}>
            {/* The front door is the shop itself — buying is never a page away. */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/shop" element={<Shop />} />
            {/* An agent's sell link (FR-5.7) */}
            <Route path="/s/:code" element={<Storefront />} />
            <Route path="/checkers" element={<Checkers />} />
            <Route path="/track" element={<Track />} />
            {/* A guest must be able to complete a purchase (FR-4.8) */}
            <Route path="/buy/:productId" element={<Buy />} />
          </Route>

          {/* Signed-in area — customers and agents (FR-1.5, NFR-2.5).
              Checkout deliberately stays on the public shell above so that one
              code path serves guests and account holders alike. */}
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path="/app" element={<Dashboard />} />
              <Route path="/app/orders" element={<Orders />} />
              <Route path="/app/reports" element={<Reports />} />

              {/* Customers hold a spendable wallet; agents do not. */}
              <Route element={<RequireAuth role="customer" />}>
                <Route path="/app/wallet" element={<Wallet />} />
              </Route>

              {/* Agent-only surfaces */}
              <Route element={<RequireAuth role="agent" />}>
                <Route path="/app/earnings" element={<Earnings />} />
                <Route path="/app/pricing" element={<Pricing />} />
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
              <Route path="/admin/settings" element={<Settings />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  )
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
