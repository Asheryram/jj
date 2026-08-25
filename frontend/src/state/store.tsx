import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  AgentPrice,
  Earning,
  Network,
  Order,
  OrderSplit,
  PlatformUser,
  Product,
  Session,
  SplitShare,
  SubAgent,
  Transaction,
  WithdrawalRequest,
  WithdrawalStatus,
} from '../data/types'
import {
  api,
  ApiError,
  newIdempotencyKey,
  token,
  type AdminOverview,
  type AgentEarningsDay,
  type MySummary,
  type Profile,
  type RevenueDay,
} from '../lib/api'
import {
  priceBandFor,
  retailPriceFor,
  splitFor,
  type PriceBand,
  type PricingAgent,
} from '../lib/pricing'
import { isAdmin } from '../lib/roles'

/**
 * The single source of application state, backed entirely by the API.
 *
 * There is no mock and no demo mode: every balance, order and price on screen
 * came out of Postgres. If the API cannot be reached the app says so rather than
 * falling back to invented data — a shop that shows plausible prices while
 * disconnected is worse than one that admits it is down, because someone will
 * try to buy at those prices.
 *
 * Prices are the one thing computed in the browser, from the pure functions in
 * lib/pricing over the chain returned by `/catalogue`. That is what lets a
 * 40-product storefront render without a request per product (NFR-1.1). The
 * server prices every order again on the way in and trusts nothing it is sent.
 */

export interface Toast {
  id: number
  tone: 'success' | 'error' | 'info'
  title: string
  detail?: string
}

/** Money owed back to a buyer whose order failed (NFR-3.3). */
export interface ClaimableCredit {
  phone: string
  amount: number
  reference: string
  createdAt: string
}

export interface PlaceOrderInput {
  product: Product
  recipient: string
  buyerName: string
  buyerPhone: string
  payWith: Order['paidWith']
  sellerCode: string | null
}

export interface RegisterInput {
  name: string
  phone: string
  email: string
  password: string
  accountType: 'customer' | 'agent'
  referralCode?: string
}

interface Store {
  /** False until the first catalogue load finishes. */
  ready: boolean
  /**
   * Set when the API could not be reached at all. Pages render an offline
   * notice instead of an empty shop.
   */
  offline: string | null
  /** Retry the initial load after a connection failure. */
  reconnect: () => Promise<void>

  session: Session | null
  /** Every profile this person holds. One entry means no switcher. */
  profiles: Profile[]
  switchProfile: (userId: string) => Promise<Session>
  addProfile: (role: 'admin' | 'agent') => Promise<void>
  /** Email is the credential; the phone number stays on the account for delivery. */
  login: (email: string, password: string) => Promise<Session>
  register: (input: RegisterInput) => Promise<Session>
  logout: () => void

  /** The sell link currently in force, if the visitor arrived through one. */
  sellerCode: string | null
  setSellerCode: (code: string | null) => void
  sellerName: string | null

  /** Spendable customer wallet. */
  customerBalance: number
  transactions: Transaction[]
  topUpWallet: (amount: number, network: Network) => Promise<void>

  /** Withdrawable agent earnings. Never topped up. */
  agentBalance: number
  earnings: Earning[]

  /** Whichever of the two applies to the signed-in role. */
  balance: number

  orders: Order[]
  /** Resolves with `paymentUrl` set when the customer still has to pay. */
  placeOrder: (input: PlaceOrderInput) => Promise<Order & { paymentUrl?: string }>
  findOrder: (reference: string, phone: string) => Promise<Order | undefined>
  /**
   * Start polling an order until it settles.
   *
   * Exposed for the return trip from Paystack: the order was placed on a previous
   * page load, so nothing is watching it, and the receipt has to pick that up.
   */
  watchOrder: (orderId: string) => void
  /** Re-read everything for the signed-in user. */
  refresh: () => Promise<void>

  products: Product[]
  updateProductTier: (
    productId: string,
    tier: 'supplierCost' | 'adminPrice' | 'standardPrice',
    value: number,
  ) => Promise<void>
  setProductOnSale: (productId: string, active: boolean) => Promise<void>

  /** Pricing helpers, all backed by lib/pricing. */
  pricingAgents: PricingAgent[]
  /** What Paystack keeps on a Mobile Money payment, in basis points. */
  paystackFeeBp: number
  retailPrice: (product: Product, sellerCode?: string | null) => number
  myBand: (product: Product) => PriceBand
  myResalePrice: (product: Product) => number
  hasOwnPrice: (productId: string) => boolean
  setAgentPrice: (productId: string, resalePrice: number) => Promise<void>
  previewSplit: (product: Product, sellerCode: string | null) => OrderSplit
  myShareOf: (order: Order) => SplitShare | undefined

  withdrawals: WithdrawalRequest[]
  requestWithdrawal: (amount: number, momoNetwork: Network, momoNumber: string) => Promise<void>
  updatePhone: (phone: string) => Promise<void>
  decideWithdrawal: (id: string, status: WithdrawalStatus) => Promise<void>

  users: PlatformUser[]
  toggleUserStatus: (id: string) => Promise<void>

  claimableCredits: ClaimableCredit[]

  /** FR-5.2 — the signed-in agent's downline. */
  subAgents: SubAgent[]
  /** FR-8.1 — platform turnover per day (admin). */
  revenueByDay: RevenueDay[]
  /** The agent's own earnings per day, split own vs downline. */
  agentEarningsByDay: AgentEarningsDay[]
  /** Headline admin numbers. Null until an admin loads them. */
  adminOverview: AdminOverview | null
  /**
   * The signed-in user's own headline numbers, aggregated server-side. Null
   * until loaded, and for admins, who read `adminOverview` instead.
   */
  mySummary: MySummary | null

  /** The referrer's share of James's margin on their referral's sales. */

  toasts: Toast[]
  pushToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
}

const StoreContext = createContext<Store | null>(null)

let toastSeq = 0

/**
 * ~5 minutes: 10 polls at 1.5s, then every 5s.
 *
 * Past this the page stops asking, but the order is NOT abandoned — the
 * reconciler settles it server-side and the receipt stays retrievable from
 * Track order. Nothing is lost by the screen giving up; the customer just has to
 * be told that, which is what the receipt copy does.
 */
const MAX_ORDER_POLLS = 65

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [offline, setOffline] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  /**
   * Never undefined, whatever the API sends.
   *
   * The header reads `profiles.length` to decide whether to show the switcher, so
   * a payload without the field took the whole app down with a TypeError the
   * moment somebody logged in — a white screen, and only for signed-in users. That
   * is exactly what a frontend deployed ahead of its API looks like, and it is not
   * a state the client should be able to reach.
   */
  const [profiles, setProfiles] = useState<Profile[]>([])

  const [sellerCode, setSellerCodeState] = useState<string | null>(() =>
    sessionStorage.getItem('jdc.seller'),
  )
  const [sellerNameState, setSellerNameState] = useState<string | null>(null)

  const [customerBalance, setCustomerBalance] = useState(0)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [agentBalance, setAgentBalance] = useState(0)
  const [earnings, setEarnings] = useState<Earning[]>([])

  const [orders, setOrders] = useState<Order[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [prices, setPrices] = useState<AgentPrice[]>([])
  const [remoteAgents, setRemoteAgents] = useState<PricingAgent[]>([])
  /**
   * The Paystack fee, in basis points, sent with the catalogue so a price
   * derived here locally (an agent's own default markup) matches what the
   * server would actually charge. Defaults to 0 — no gross-up — until the first
   * snapshot arrives, which only matters for the instant before it does.
   */
  const [paystackFeeBp, setPaystackFeeBp] = useState(0)

  const [admin, setAdmin] = useState<{ userId: string; name: string }>({
    userId: '',
    name: 'JamesDataConsult',
  })
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([])
  const [users, setUsers] = useState<PlatformUser[]>([])
  const [claimableCredits, setClaimableCredits] = useState<ClaimableCredit[]>([])
  const [subAgents, setSubAgents] = useState<SubAgent[]>([])
  const [revenueByDay, setRevenueByDay] = useState<RevenueDay[]>([])
  const [agentEarningsByDay, setAgentEarningsByDay] = useState<AgentEarningsDay[]>([])
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null)
  const [mySummary, setMySummary] = useState<MySummary | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  // ── Toasts ────────────────────────────────────────────────────────────────

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++toastSeq
    setToasts((current) => [...current, { ...toast, id }])
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6000)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  /** One place that turns a thrown ApiError into a toast the user can read. */
  const reportError = useCallback(
    (error: unknown, fallback: string) => {
      const message = error instanceof ApiError ? error.message : fallback
      pushToast({ tone: 'error', title: message })
    },
    [pushToast],
  )

  // ── Loading ───────────────────────────────────────────────────────────────

  const loadCatalogue = useCallback(async () => {
    const snapshot = await api.catalogue()
    setProducts(snapshot.products)
    setRemoteAgents(snapshot.pricingAgents)
    // A fresh deployment has no admin until the superadmin creates one. Keep the
    // placeholder rather than blanking the name, so the shop renders and they can
    // get to the screen that fixes it.
    if (snapshot.admin) setAdmin(snapshot.admin)
    setPaystackFeeBp(snapshot.settings.paystackFeeBp)
  }, [])

  /**
   * Everything that depends on who is signed in. Called after login, after a
   * mutation that moves money, and on first load — so a dashboard is never a
   * cached guess about a balance.
   *
   * Individual failures are swallowed per-request: one unavailable report should
   * not blank the four panels beside it.
   */
  const loadForSession = useCallback(async (current: Session | null) => {
    if (!current) {
      setOrders([])
      setTransactions([])
      setEarnings([])
      setWithdrawals([])
      setUsers([])
      setSubAgents([])
      setAdminOverview(null)
      setMySummary(null)
      return
    }

    const tasks: Promise<unknown>[] = [
      api
        .orders()
        .then(setOrders)
        .catch(() => undefined),
    ]

    if (!isAdmin(current.role)) {
      tasks.push(
        api
          .mySummary()
          .then(setMySummary)
          .catch(() => undefined),
      )
    }

    if (current.role === 'customer') {
      tasks.push(
        api
          .wallet()
          .then(({ balance, transactions: rows }) => {
            setCustomerBalance(balance)
            setTransactions(rows)
          })
          .catch(() => undefined),
      )
    }

    if (current.role === 'agent') {
      tasks.push(
        api
          .earnings()
          .then(({ balance, earnings: rows }) => {
            setAgentBalance(balance)
            setEarnings(rows)
          })
          .catch(() => undefined),
        api
          .agentPrices()
          .then(setPrices)
          .catch(() => undefined),
        api
          .downline()
          .then(setSubAgents)
          .catch(() => undefined),
        api
          .withdrawals()
          .then(setWithdrawals)
          .catch(() => undefined),
        api
          .myEarningsByDay(7)
          .then(setAgentEarningsByDay)
          .catch(() => undefined),
      )
    }

    if (isAdmin(current.role)) {
      tasks.push(
        api
          .adminUsers()
          .then(setUsers)
          .catch(() => undefined),
        api
          .withdrawals()
          .then(setWithdrawals)
          .catch(() => undefined),
        api
          .revenueByDay(7)
          .then(setRevenueByDay)
          .catch(() => undefined),
        api
          .adminOverview()
          .then(setAdminOverview)
          .catch(() => undefined),
      )
    }

    await Promise.all(tasks)
  }, [])

  const bootstrap = useCallback(async () => {
    setOffline(null)

    try {
      await loadCatalogue()
    } catch (error) {
      // The catalogue is the one request the shop cannot open without.
      setOffline(
        error instanceof ApiError
          ? error.message
          : 'We could not reach the server. Check your connection and try again.',
      )
      setReady(true)
      return
    }

    if (token.get()) {
      try {
        const { user, profiles: mine } = await api.me()
        setSession(user)
        setProfiles(mine ?? [])
        await loadForSession(user)
      } catch (error) {
        /**
         * Only a 401 means the token is bad. Anything else must not sign anybody out.
         *
         * This used to drop the session on *any* failure, so a rate limit, a
         * five-hundred or a moment of bad signal logged the user out and left them
         * on the public shell — where every link is a signed-out link, which reads
         * as the app being broken rather than as having been ejected from it.
         *
         * On anything else the token is kept and the app comes up offline-ish: the
         * next navigation retries, and a real 401 will still clear it.
         */
        if (error instanceof ApiError && error.status === 401) {
          token.clear()
          setSession(null)
        } else {
          // Keep the token and say what happened, rather than pretending the
          // visitor is a stranger.
          setOffline(
            error instanceof ApiError
              ? error.message
              : 'We could not reach the server. Check your connection and try again.',
          )
        }
      }
    }

    setReady(true)
  }, [loadCatalogue, loadForSession])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const refresh = useCallback(async () => {
    await Promise.all([loadCatalogue(), loadForSession(session)])
  }, [loadCatalogue, loadForSession, session])

  // ── Session ───────────────────────────────────────────────────────────────

  const login = useCallback(
    async (email: string, password: string): Promise<Session> => {
      const result = await api.login(email, password)
      token.set(result.accessToken)
      setSession(result.user)
      setProfiles(result.profiles ?? [])
      if (result.user.role === 'customer') setCustomerBalance(result.balance)
      if (result.user.role === 'agent') setAgentBalance(result.balance)

      // The catalogue is re-fetched, not just the session's own data, because
      // its *shape* depends on who is asking: `supplierCost` is admin-only and
      // is stripped for everyone else. Skipping this left an admin holding the
      // anonymous payload, so every "you pay" and margin on the Prices page
      // rendered from an absent number — GHS NaN.
      await Promise.all([loadCatalogue(), loadForSession(result.user)])
      return result.user
    },
    [loadCatalogue, loadForSession],
  )

  /**
   * Wear another hat.
   *
   * The catalogue is refetched for the same reason login refetches it, and the
   * reason matters more here: its shape depends on who is asking, because
   * `supplierCost` and the markups are stripped for anyone who is not an admin.
   * Switching without this would leave an agent holding admin data — or worse,
   * an admin holding the agent payload, which is exactly how the Prices page
   * came to render GHS NaN.
   */
  const switchProfile = useCallback(
    async (userId: string): Promise<Session> => {
      const result = await api.switchProfile(userId)
      token.set(result.accessToken)
      setSession(result.user)
      setProfiles(result.profiles ?? [])
      if (result.user.role === 'customer') setCustomerBalance(result.balance)
      if (result.user.role === 'agent') setAgentBalance(result.balance)
      await Promise.all([loadCatalogue(), loadForSession(result.user)])
      return result.user
    },
    [loadCatalogue, loadForSession],
  )

  /** Give yourself another profile. No password and no link — you have both. */
  const addProfile = useCallback(
    async (role: 'admin' | 'agent') => {
      try {
        await api.addProfile(role)
        const { profiles: mine } = await api.me()
        setProfiles(mine ?? [])
        pushToast({
          tone: 'success',
          title: `${role === 'agent' ? 'Agent' : 'Admin'} profile added`,
          detail: 'Switch to it from the menu at the top.',
        })
      } catch (error) {
        reportError(error, 'We could not add that profile.')
      }
    },
    [pushToast, reportError],
  )

  const register = useCallback(
    async (input: RegisterInput): Promise<Session> => {
      const result = await api.register(input)
      token.set(result.accessToken)
      setSession(result.user)
      setProfiles(result.profiles ?? [])
      // Reload the catalogue too: a new agent joins the referral chain, which
      // changes what prices resolve to.
      await Promise.all([loadCatalogue(), loadForSession(result.user)])
      return result.user
    },
    [loadCatalogue, loadForSession],
  )

  const logout = useCallback(() => {
    token.clear()
    setSession(null)
    setProfiles([])
    // Re-fetch for the same reason as login: an admin's catalogue carries
    // supplier costs, and those should not linger in a signed-out browser.
    void loadCatalogue()
    setOrders([])
    setTransactions([])
    setEarnings([])
    setWithdrawals([])
    setUsers([])
    setSubAgents([])
    setAdminOverview(null)
    setMySummary(null)
    setCustomerBalance(0)
    setAgentBalance(0)
    setPrices([])
  }, [loadCatalogue])

  const setSellerCode = useCallback((code: string | null) => {
    if (code) sessionStorage.setItem('jdc.seller', code)
    else sessionStorage.removeItem('jdc.seller')
    setSellerCodeState(code)
  }, [])

  // ── Pricing ───────────────────────────────────────────────────────────────

  /**
   * Rebuilt from live state so an agent's own edit takes effect immediately,
   * before the server round trip has come back.
   */
  const pricingAgents = useMemo<PricingAgent[]>(() => {
    const myCode = session?.referralCode
    if (!myCode) return remoteAgents
    return remoteAgents.map((agent) =>
      agent.referralCode === myCode ? { ...agent, prices } : agent,
    )
  }, [remoteAgents, prices, session?.referralCode])

  const sellerName = useMemo(() => {
    if (!sellerCode) return null
    return pricingAgents.find((a) => a.referralCode === sellerCode)?.name ?? sellerNameState
  }, [pricingAgents, sellerCode, sellerNameState])

  // A sell link may point at an agent who is not in the loaded chain. Ask.
  useEffect(() => {
    if (!sellerCode) {
      setSellerNameState(null)
      return
    }
    if (pricingAgents.some((a) => a.referralCode === sellerCode)) return

    let cancelled = false
    void api
      .seller(sellerCode)
      .then(({ seller }) => {
        if (!cancelled) setSellerNameState(seller?.name ?? null)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [sellerCode, pricingAgents])

  const retailPrice = useCallback(
    (product: Product, code?: string | null) =>
      retailPriceFor(code === undefined ? sellerCode : code, product, pricingAgents, paystackFeeBp),
    [pricingAgents, sellerCode, paystackFeeBp],
  )

  const meAsAgent = useMemo(
    () => pricingAgents.find((a) => a.referralCode === session?.referralCode),
    [pricingAgents, session?.referralCode],
  )

  const myBand = useCallback(
    (product: Product): PriceBand => {
      if (!meAsAgent) return { floor: product.adminPrice }
      return priceBandFor(meAsAgent, product)
    },
    [meAsAgent],
  )

  const myResalePrice = useCallback(
    (product: Product) =>
      meAsAgent
        ? retailPriceFor(meAsAgent.referralCode, product, pricingAgents, paystackFeeBp)
        : product.standardPrice,
    [meAsAgent, pricingAgents, paystackFeeBp],
  )

  const hasOwnPrice = useCallback(
    (productId: string) => prices.some((p) => p.productId === productId),
    [prices],
  )

  const setAgentPrice = useCallback(
    async (productId: string, resalePrice: number) => {
      // Optimistic, because an agent editing a price list edits several in a row
      // and a round trip between each would make the page feel broken. A refusal
      // rolls the value back and shows the server's own explanation.
      const previous = prices
      setPrices((current) => {
        const existing = current.find((p) => p.productId === productId)
        return existing
          ? current.map((p) => (p.productId === productId ? { ...p, resalePrice } : p))
          : [...current, { productId, resalePrice }]
      })

      try {
        await api.setAgentPrice(productId, resalePrice)
        pushToast({ tone: 'success', title: 'Price saved' })
      } catch (error) {
        setPrices(previous)
        reportError(error, 'We could not save that price.')
      }
    },
    [prices, pushToast, reportError],
  )

  const updateProductTier = useCallback(
    async (
      productId: string,
      tier: 'supplierCost' | 'adminPrice' | 'standardPrice',
      value: number,
    ) => {
      try {
        const updated = await api.setProductTier(productId, tier, value)
        setProducts((current) => current.map((p) => (p.id === productId ? updated : p)))
        pushToast({
          tone: 'success',
          title: 'Price updated',
          detail: 'Past orders keep the prices they were sold at.',
        })
      } catch (error) {
        reportError(error, 'We could not update that price.')
      }
    },
    [pushToast, reportError],
  )

  const setProductOnSale = useCallback(
    async (productId: string, active: boolean) => {
      try {
        const updated = await api.setProductActive(productId, active)
        setProducts((current) => current.map((p) => (p.id === productId ? updated : p)))
        pushToast({
          tone: 'success',
          title: active ? 'On sale' : 'Taken off sale',
          detail: active
            ? 'Customers and agents can buy it now.'
            : 'Nobody can buy it. Orders already placed are unaffected.',
        })
      } catch (error) {
        reportError(error, 'We could not change whether that is on sale.')
      }
    },
    [pushToast, reportError],
  )

  const previewSplit = useCallback(
    (product: Product, code: string | null) =>
      splitFor(product, code, pricingAgents, admin, paystackFeeBp),
    [pricingAgents, admin, paystackFeeBp],
  )

  const myShareOf = useCallback(
    (order: Order) => order.split?.shares.find((share) => share.userId === session?.id),
    [session?.id],
  )

  // ── Customer wallet ───────────────────────────────────────────────────────

  const topUpWallet = useCallback(
    async (amount: number, network: Network) => {
      try {
        const { balance, transaction } = await api.topUp(amount, network)
        setCustomerBalance(balance)
        setTransactions((current) => [transaction, ...current])
        pushToast({
          tone: 'success',
          title: 'Wallet topped up',
          detail: `Your balance is now ${(balance / 100).toFixed(2)} cedis.`,
        })
      } catch (error) {
        reportError(error, 'We could not top up your wallet.')
      }
    },
    [pushToast, reportError],
  )

  // ── Ordering ──────────────────────────────────────────────────────────────

  /** Timers polling in-flight orders, so unmounting cannot leave one running. */
  const pollers = useRef(new Map<string, number>())

  useEffect(
    () => () => {
      pollers.current.forEach((timer) => window.clearInterval(timer))
      pollers.current.clear()
    },
    [],
  )

  /**
   * Follow an order until the provider answers.
   *
   * FR-4.4 — status moves from a provider callback, not from anything the browser
   * did, so the browser has to ask. Polling rather than a socket because a lost
   * poll is self-healing and a lost socket is not, and Ghana 4G loses things.
   */
  const watchOrder = useCallback(
    (orderId: string) => {
      if (pollers.current.has(orderId)) return

      let attempts = 0
      /**
       * Poll fast at first, then ease off, and keep watching for five minutes.
       *
       * This was a flat 1.5s interval that gave up after 60 tries — exactly 90
       * seconds, which is exactly the reconciler's grace period. The customer's
       * screen therefore stopped watching at the precise moment the server-side
       * fallback became eligible to settle the order, so a slow delivery could
       * never resolve on screen no matter how long they waited.
       *
       * Most orders land in the first few seconds, which is what the tight
       * opening interval is for. But DataHub can genuinely sit in PROCESSING for
       * minutes, and hammering them 200 times would only burn rate limit — so
       * after the first ~15s it drops to every 5s.
       */
      const tick = () => {
        attempts++
        const nextDelay = attempts < 10 ? 1500 : 5000

        void api
          .order(orderId)
          .then((fresh) => {
            setOrders((current) =>
              current.some((o) => o.id === fresh.id)
                ? current.map((o) => (o.id === fresh.id ? { ...o, ...fresh } : o))
                : [fresh, ...current],
            )

            if (fresh.status !== 'completed' && fresh.status !== 'failed') return

            stop()

            if (fresh.status === 'completed') {
              const share = fresh.split?.shares.find((s) => s.userId === session?.id)
              pushToast({
                tone: 'success',
                title: `${fresh.productName} delivered`,
                detail:
                  share && share.margin > 0
                    ? `Sent to ${fresh.recipient}. You earned ${(share.margin / 100).toFixed(2)} cedis.`
                    : `Sent to ${fresh.recipient}. An SMS confirmation is on its way.`,
              })
            } else {
              // Careful with the tense. A refund is authorised by a person, so
              // at this moment the money is owed rather than returned.
              pushToast({
                tone: 'error',
                title: fresh.refunded
                  ? 'Order failed — your money is back'
                  : 'Order failed — your money is owed back to you',
                detail: fresh.refunded
                  ? fresh.paidWith === 'wallet'
                    ? `${(fresh.salePrice / 100).toFixed(2)} cedis went back to your wallet.`
                    : `${(fresh.salePrice / 100).toFixed(2)} cedis is held for ${fresh.buyerPhone}. An SMS with the claim link is on its way.`
                  : `${(fresh.salePrice / 100).toFixed(2)} cedis is logged for refund. We will text you when it is done.`,
              })
            }

            if (session) {
              // Balances and ledgers moved server-side when the order settled.
              void loadForSession(session)
            } else {
              // A guest has no server-side lists to refresh, and calling
              // loadForSession(null) here would be actively harmful: its first
              // act is to clear `orders`, which is where the order this receipt
              // is about lives. That blanked the receipt at the exact moment the
              // buyer had just paid — the worst screen in the product to lose.
              void api
                .credits(fresh.buyerPhone)
                .then(setClaimableCredits)
                .catch(() => undefined)
            }
          })
          .catch(() => undefined)
          .finally(() => {
            // Re-arm only if this watcher is still the live one. Settling calls
            // stop(), which removes it from the map, and without this check a
            // settled order would keep polling forever.
            if (pollers.current.get(orderId) === undefined) return
            if (attempts > MAX_ORDER_POLLS) {
              stop()
              return
            }
            pollers.current.set(orderId, window.setTimeout(tick, nextDelay))
          })
      }

      const stop = () => {
        const handle = pollers.current.get(orderId)
        if (handle !== undefined) window.clearTimeout(handle)
        pollers.current.delete(orderId)
      }

      // A placeholder so the re-arm check above has something to find, and so a
      // second watchOrder for the same id is refused by the guard at the top.
      pollers.current.set(orderId, window.setTimeout(tick, 1500))
    },
    [loadForSession, pushToast, session],
  )

  const placeOrder = useCallback(
    async ({
      product,
      recipient,
      buyerName,
      buyerPhone,
      payWith,
      sellerCode: code,
    }: PlaceOrderInput): Promise<Order & { paymentUrl?: string }> => {
      const order = await api.placeOrder({
        productId: product.id,
        recipient,
        buyerPhone,
        buyerName,
        payWith,
        sellerCode: code,
        idempotencyKey: newIdempotencyKey(),
      })

      setOrders((current) => [order, ...current.filter((o) => o.id !== order.id)])

      if (payWith === 'wallet') {
        // The server has already debited inside the placing transaction. Reflect
        // its number rather than recomputing one that could disagree.
        setCustomerBalance((balance) => Math.max(0, balance - order.salePrice))
      }

      // Only watch an order that is actually on its way. One waiting to be paid
      // for resolves through the payment return, not by polling — and polling it
      // would just burn requests until the watcher gave up.
      if (order.status !== 'awaiting_payment') watchOrder(order.id)
      return order
    },
    [watchOrder],
  )

  const findOrder = useCallback(
    async (reference: string, phone: string): Promise<Order | undefined> => {
      try {
        return await api.trackOrder(reference.trim(), phone.trim())
      } catch {
        // Not found is the expected outcome of a typo, and Track.tsx renders its
        // own "we could not find that" state.
        return undefined
      }
    },
    [],
  )

  // ── Withdrawals ───────────────────────────────────────────────────────────

  /** Change your number everywhere you hold a profile. */
  const updatePhone = useCallback(
    async (phone: string) => {
      try {
        const result = await api.updatePhone(phone)
        setSession(result.user)
        setProfiles(result.profiles ?? [])
        pushToast({ tone: 'success', title: 'Number updated', detail: `Earnings will be paid to ${phone}.` })
      } catch (error) {
        reportError(error, 'We could not update that number.')
      }
    },
    [pushToast, reportError],
  )

  const requestWithdrawal = useCallback(
    async (amount: number, momoNetwork: Network, momoNumber: string) => {
      try {
        const created = await api.requestWithdrawal(amount, momoNetwork, momoNumber)
        setWithdrawals((current) => [created, ...current])
        // The balance is held at request time, so re-read it rather than guess.
        await loadForSession(session)
        pushToast({
          tone: 'info',
          title: 'Withdrawal request sent',
          detail: 'James reviews requests within 24 hours.',
        })
      } catch (error) {
        reportError(error, 'We could not send that withdrawal request.')
      }
    },
    [loadForSession, pushToast, reportError, session],
  )

  const decideWithdrawal = useCallback(
    async (id: string, status: WithdrawalStatus) => {
      try {
        const updated = await api.decideWithdrawal(id, status)
        setWithdrawals((current) => current.map((w) => (w.id === id ? updated : w)))
        pushToast({
          tone: status === 'approved' ? 'success' : 'info',
          title: status === 'approved' ? 'Withdrawal approved' : 'Withdrawal rejected',
        })
      } catch (error) {
        reportError(error, 'We could not update that request.')
      }
    },
    [pushToast, reportError],
  )

  const toggleUserStatus = useCallback(
    async (id: string) => {
      try {
        const { status } = await api.toggleUserStatus(id)
        setUsers((current) => current.map((u) => (u.id === id ? { ...u, status } : u)))
      } catch (error) {
        reportError(error, 'We could not change that account.')
      }
    },
    [reportError],
  )

  const balance = session?.role === 'agent' ? agentBalance : customerBalance

  const value = useMemo<Store>(
    () => ({
      ready,
      offline,
      reconnect: bootstrap,
      session,
      profiles,
      switchProfile,
      addProfile,
      login,
      register,
      logout,
      sellerCode,
      setSellerCode,
      sellerName,
      customerBalance,
      transactions,
      topUpWallet,
      agentBalance,
      earnings,
      balance,
      orders,
      placeOrder,
      watchOrder,
      findOrder,
      refresh,
      products,
      updateProductTier,
      setProductOnSale,
      pricingAgents,
      paystackFeeBp,
      retailPrice,
      myBand,
      myResalePrice,
      hasOwnPrice,
      setAgentPrice,
      previewSplit,
      myShareOf,
      withdrawals,
      requestWithdrawal,
      updatePhone,
      decideWithdrawal,
      users,
      toggleUserStatus,
      claimableCredits,
      subAgents,
      revenueByDay,
      agentEarningsByDay,
      adminOverview,
      mySummary,
      toasts,
      pushToast,
      dismissToast,
    }),
    [
      adminOverview,
      agentBalance,
      agentEarningsByDay,
      balance,
      bootstrap,
      claimableCredits,
      customerBalance,
      decideWithdrawal,
      dismissToast,
      earnings,
      findOrder,
      hasOwnPrice,
      login,
      logout,
      myBand,
      myResalePrice,
      myShareOf,
      mySummary,
      offline,
      orders,
      placeOrder,
      previewSplit,
      pricingAgents,
      paystackFeeBp,
      products,
      pushToast,
      ready,
      refresh,
      register,
      requestWithdrawal,
      updatePhone,
      retailPrice,
      revenueByDay,
      sellerCode,
      sellerName,
      session,
      profiles,
      switchProfile,
      addProfile,
      setAgentPrice,
      setSellerCode,
      subAgents,
      toasts,
      toggleUserStatus,
      topUpWallet,
      transactions,
      updateProductTier,
      setProductOnSale,
      watchOrder,
      users,
      withdrawals,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function momoLabel(network: Network): string {
  if (network === 'MTN') return 'MTN MoMo'
  if (network === 'Telecel') return 'Telecel Cash'
  return 'AirtelTigo Money'
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside <StoreProvider>')
  return store
}
