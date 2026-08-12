import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  Earning,
  Network,
  Order,
  OrderSplit,
  PlatformUser,
  Product,
  Role,
  Session,
  SplitShare,
  Transaction,
  WithdrawalRequest,
  WithdrawalStatus,
} from '../data/types'
import * as mock from '../data/mock'
import {
  priceBandFor,
  retailPriceFor,
  splitFor,
  type PriceBand,
  type PricingAgent,
} from '../lib/pricing'

/**
 * A single in-memory store standing in for the NestJS API.
 *
 * Every function maps to a use case in the planned backend (PlaceOrder,
 * TopUpWallet, SetAgentPrice, RequestWithdrawal, …) so integration means
 * replacing the body of each one with an HTTP call — the component tree does
 * not change.
 *
 * Money model: split-at-sale. The buyer pays the platform, and each participant
 * in the referral chain is credited their own margin the moment the order
 * completes. Agents never pre-fund; their balance is an earnings account.
 */

export interface Toast {
  id: number
  tone: 'success' | 'error' | 'info'
  title: string
  detail?: string
}

/** Money owed back to a guest whose order failed (NFR-3.3). */
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

interface Store {
  session: Session | null
  login: (role: Role) => void
  logout: () => void

  /** The sell link currently in force, if the visitor arrived through one. */
  sellerCode: string | null
  setSellerCode: (code: string | null) => void
  sellerName: string | null

  /** Spendable customer wallet. */
  customerBalance: number
  transactions: Transaction[]
  topUpWallet: (amount: number, network: Network) => void

  /** Withdrawable agent earnings. Never topped up. */
  agentBalance: number
  earnings: Earning[]

  /** Whichever of the two applies to the signed-in role. */
  balance: number

  orders: Order[]
  placeOrder: (input: PlaceOrderInput) => Order
  findOrder: (reference: string, phone: string) => Order | undefined

  products: Product[]
  updateProductTier: (
    productId: string,
    tier: 'supplierCost' | 'adminPrice' | 'standardPrice' | 'maxRetailPrice',
    value: number,
  ) => void

  /** Pricing helpers, all backed by lib/pricing. */
  pricingAgents: PricingAgent[]
  retailPrice: (product: Product, sellerCode?: string | null) => number
  myBand: (product: Product) => PriceBand
  myResalePrice: (product: Product) => number
  hasOwnPrice: (productId: string) => boolean
  setAgentPrice: (productId: string, resalePrice: number) => void
  previewSplit: (product: Product, sellerCode: string | null) => OrderSplit
  myShareOf: (order: Order) => SplitShare | undefined

  withdrawals: WithdrawalRequest[]
  requestWithdrawal: (amount: number, momoNetwork: Network) => void
  decideWithdrawal: (id: string, status: WithdrawalStatus) => void

  users: PlatformUser[]
  toggleUserStatus: (id: string) => void

  claimableCredits: ClaimableCredit[]

  /** FR-5.5 / NFR-5.2 — a toggle, not a rebuild. */
  multiLevelReferral: boolean
  setMultiLevelReferral: (on: boolean) => void
  /** Demo-only switch used to show the FR-2.7 failure-and-refund path. */
  simulateFailure: boolean
  setSimulateFailure: (on: boolean) => void

  toasts: Toast[]
  pushToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
}

const StoreContext = createContext<Store | null>(null)

let toastSeq = 0
let orderSeq = 0

const nowIso = () => new Date().toISOString()
const ref = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`

export function StoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => {
    const saved = localStorage.getItem('jdc.role') as Role | null
    return saved && mock.sessions[saved] ? mock.sessions[saved] : null
  })
  const [sellerCode, setSellerCodeState] = useState<string | null>(() =>
    sessionStorage.getItem('jdc.seller'),
  )

  const [customerBalance, setCustomerBalance] = useState(mock.customerOpeningBalance)
  const [transactions, setTransactions] = useState(mock.customerTransactions)
  const [agentBalance, setAgentBalance] = useState(mock.agentOpeningBalance)
  const [earnings, setEarnings] = useState(mock.agentEarnings)

  const [orders, setOrders] = useState(mock.orders)
  const [products, setProducts] = useState(mock.products)
  const [prices, setPrices] = useState(mock.agentPrices)
  const [withdrawals, setWithdrawals] = useState(mock.withdrawalRequests)
  const [users, setUsers] = useState(mock.platformUsers)
  const [claimableCredits, setClaimableCredits] = useState<ClaimableCredit[]>([])
  const [multiLevelReferral, setMultiLevelReferral] = useState(false)
  const [simulateFailure, setSimulateFailure] = useState(false)
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

  // ── Session ───────────────────────────────────────────────────────────────

  const login = useCallback((role: Role) => {
    localStorage.setItem('jdc.role', role)
    setSession(mock.sessions[role])
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('jdc.role')
    setSession(null)
  }, [])

  const setSellerCode = useCallback((code: string | null) => {
    if (code) sessionStorage.setItem('jdc.seller', code)
    else sessionStorage.removeItem('jdc.seller')
    setSellerCodeState(code)
  }, [])

  // ── Pricing ───────────────────────────────────────────────────────────────

  /** Rebuilt from live state so the agent's own edits take effect immediately. */
  const pricingAgents = useMemo<PricingAgent[]>(
    () =>
      mock.pricingAgents.map((agent) =>
        agent.referralCode === mock.sessions.agent.referralCode
          ? { ...agent, prices }
          : agent,
      ),
    [prices],
  )

  const sellerName = useMemo(() => {
    if (!sellerCode) return null
    return pricingAgents.find((a) => a.referralCode === sellerCode)?.name ?? null
  }, [pricingAgents, sellerCode])

  const retailPrice = useCallback(
    (product: Product, code?: string | null) =>
      retailPriceFor(code === undefined ? sellerCode : code, product, pricingAgents),
    [pricingAgents, sellerCode],
  )

  const meAsAgent = useMemo(
    () => pricingAgents.find((a) => a.referralCode === session?.referralCode),
    [pricingAgents, session?.referralCode],
  )

  const myBand = useCallback(
    (product: Product): PriceBand => {
      if (!meAsAgent) return { floor: product.adminPrice, ceiling: product.maxRetailPrice }
      return priceBandFor(meAsAgent, product, pricingAgents)
    },
    [meAsAgent, pricingAgents],
  )

  const myResalePrice = useCallback(
    (product: Product) =>
      meAsAgent ? retailPriceFor(meAsAgent.referralCode, product, pricingAgents) : product.standardPrice,
    [meAsAgent, pricingAgents],
  )

  const hasOwnPrice = useCallback(
    (productId: string) => prices.some((p) => p.productId === productId),
    [prices],
  )

  const setAgentPrice = useCallback(
    (productId: string, resalePrice: number) => {
      setPrices((current) => {
        const existing = current.find((p) => p.productId === productId)
        if (existing) {
          return current.map((p) => (p.productId === productId ? { ...p, resalePrice } : p))
        }
        return [...current, { productId, resalePrice }]
      })
      pushToast({ tone: 'success', title: 'Price saved' })
    },
    [pushToast],
  )

  const updateProductTier = useCallback(
    (
      productId: string,
      tier: 'supplierCost' | 'adminPrice' | 'standardPrice' | 'maxRetailPrice',
      value: number,
    ) => {
      setProducts((current) =>
        current.map((p) => (p.id === productId ? { ...p, [tier]: value } : p)),
      )
      pushToast({
        tone: 'success',
        title: 'Price updated',
        detail: 'Past orders keep the prices they were sold at.',
      })
    },
    [pushToast],
  )

  const previewSplit = useCallback(
    (product: Product, code: string | null) =>
      splitFor(product, code, pricingAgents, mock.admin),
    [pricingAgents],
  )

  const myShareOf = useCallback(
    (order: Order) => order.split.shares.find((share) => share.userId === session?.id),
    [session?.id],
  )

  // ── Customer wallet ───────────────────────────────────────────────────────

  const topUpWallet = useCallback(
    (amount: number, network: Network) => {
      const next = customerBalance + amount
      setCustomerBalance(next)
      setTransactions((current) => [
        {
          id: `t-${Date.now()}`,
          type: 'topup',
          amount,
          balanceAfter: next,
          description: `Wallet top-up · ${momoLabel(network)}`,
          reference: ref('PSK'),
          createdAt: nowIso(),
        },
        ...current,
      ])
      // FR-7.1
      pushToast({
        tone: 'success',
        title: 'Wallet topped up',
        detail: `Your balance is now ${(next / 100).toFixed(2)} cedis.`,
      })
    },
    [customerBalance, pushToast],
  )

  // ── Ordering ──────────────────────────────────────────────────────────────

  const placeOrder = useCallback(
    ({ product, recipient, buyerName, buyerPhone, payWith, sellerCode: code }: PlaceOrderInput) => {
      const split = splitFor(product, code, pricingAgents, mock.admin)
      const salePrice = split.shares.find((s) => s.depth === 0)?.charged ?? product.standardPrice
      const id = `o-new-${++orderSeq}`
      const reference = `JDC-${Math.floor(900000 + Math.random() * 99999)}`

      const order: Order = {
        id,
        reference,
        productId: product.id,
        productName: product.name,
        network: product.network,
        category: product.category,
        recipient,
        salePrice,
        split,
        soldByCode: code,
        status: 'processing',
        createdAt: nowIso(),
        paidWith: payWith,
        buyer: buyerName,
        buyerPhone,
      }

      setOrders((current) => [order, ...current])

      // FR-2.3 — a wallet payment is debited as the order is created.
      if (payWith === 'wallet') {
        const after = customerBalance - salePrice
        setCustomerBalance(after)
        setTransactions((current) => [
          {
            id: `t-${Date.now()}`,
            type: 'purchase',
            amount: -salePrice,
            balanceAfter: after,
            description: `${product.name} → ${recipient}`,
            reference,
            createdAt: order.createdAt,
          },
          ...current,
        ])
      }

      const myShare = split.shares.find((s) => s.userId === session?.id)

      // Stand-in for the DataHub GH callback (FR-4.4). The real app moves this
      // status from a webhook; a timer plays the same part during a demo.
      window.setTimeout(() => {
        if (simulateFailure) {
          setOrders((current) =>
            current.map((o) => (o.id === id ? { ...o, status: 'failed', refunded: true } : o)),
          )

          if (payWith === 'wallet') {
            // FR-2.7 — straight back to the wallet it came from.
            setCustomerBalance((balance) => {
              const after = balance + salePrice
              setTransactions((current) => [
                {
                  id: `t-${Date.now()}-r`,
                  type: 'refund',
                  amount: salePrice,
                  balanceAfter: after,
                  description: `Refund · ${product.name} failed at provider`,
                  reference,
                  createdAt: nowIso(),
                },
                ...current,
              ])
              return after
            })
          } else {
            // A Mobile Money payer has no wallet to credit, and reversing a MoMo
            // collection is neither instant nor guaranteed. So the money is held
            // as a claimable credit against their number and they are sent a
            // link — NFR-3.3 without depending on a reversal.
            setClaimableCredits((current) => [
              { phone: buyerPhone, amount: salePrice, reference, createdAt: nowIso() },
              ...current,
            ])
          }

          // The chain's earnings are reversed too — nobody profits from a
          // failed delivery.
          if (myShare && myShare.margin > 0) {
            setAgentBalance((balance) => {
              const after = balance - myShare.margin
              setEarnings((current) => [
                {
                  id: `e-${Date.now()}-r`,
                  type: 'reversal',
                  amount: -myShare.margin,
                  balanceAfter: after,
                  description: `Reversed · ${product.name} failed at provider`,
                  productName: product.name,
                  reference,
                  depth: myShare.depth,
                  createdAt: nowIso(),
                },
                ...current,
              ])
              return after
            })
          }

          pushToast({
            tone: 'error',
            title: 'Order failed — the money is coming back',
            detail:
              payWith === 'wallet'
                ? `${(salePrice / 100).toFixed(2)} cedis went back to the wallet.`
                : `${(salePrice / 100).toFixed(2)} cedis is held for ${buyerPhone}. An SMS with the claim link is on its way.`,
          })
          return
        }

        setOrders((current) =>
          current.map((o) =>
            o.id === id
              ? {
                  ...o,
                  status: 'completed',
                  ...(product.category === 'checker'
                    ? {
                        voucher: {
                          serial: `WA${Math.floor(10000000 + Math.random() * 89999999)}`,
                          pin: `${Math.floor(1000000000 + Math.random() * 8999999999)}`,
                        },
                      }
                    : {}),
                }
              : o,
          ),
        )

        // Split-at-sale: credit the signed-in participant their own margin.
        if (myShare && myShare.margin > 0) {
          setAgentBalance((balance) => {
            const after = balance + myShare.margin
            setEarnings((current) => [
              {
                id: `e-${Date.now()}`,
                type: myShare.depth === 0 ? 'sale' : 'downline',
                amount: myShare.margin,
                balanceAfter: after,
                description:
                  myShare.depth === 0
                    ? `Your sale · ${product.name} → ${recipient}`
                    : `Downline sale · ${product.name}`,
                productName: product.name,
                reference,
                depth: myShare.depth,
                createdAt: nowIso(),
              },
              ...current,
            ])
            return after
          })
        }

        // FR-4.5 / FR-7.2
        pushToast({
          tone: 'success',
          title: `${product.name} delivered`,
          detail: myShare
            ? `Sent to ${recipient}. You earned ${(myShare.margin / 100).toFixed(2)} cedis.`
            : `Sent to ${recipient}. An SMS confirmation is on its way.`,
        })
      }, 2600)

      return order
    },
    [customerBalance, pricingAgents, pushToast, session?.id, simulateFailure],
  )

  const findOrder = useCallback(
    (reference: string, phone: string) => {
      const needle = reference.trim().toUpperCase()
      const digits = phone.replace(/\D/g, '')
      return orders.find(
        (order) =>
          order.reference.toUpperCase() === needle &&
          (order.buyerPhone.endsWith(digits.slice(-9)) ||
            order.recipient.endsWith(digits.slice(-9))),
      )
    },
    [orders],
  )

  // ── Withdrawals ───────────────────────────────────────────────────────────

  const requestWithdrawal = useCallback(
    (amount: number, momoNetwork: Network) => {
      setWithdrawals((current) => [
        {
          id: `w-${Math.floor(1000 + Math.random() * 8999)}`,
          agentName: session?.name ?? 'Agent',
          agentPhone: session?.phone ?? '',
          amount,
          momoNetwork,
          status: 'pending',
          requestedAt: nowIso(),
        },
        ...current,
      ])
      // FR-2.6 — manual approval for v1, so we promise review, not payment.
      pushToast({
        tone: 'info',
        title: 'Withdrawal request sent',
        detail: 'James reviews requests within 24 hours.',
      })
    },
    [pushToast, session?.name, session?.phone],
  )

  const decideWithdrawal = useCallback(
    (id: string, status: WithdrawalStatus) => {
      setWithdrawals((current) => current.map((w) => (w.id === id ? { ...w, status } : w)))
      pushToast({
        tone: status === 'approved' ? 'success' : 'info',
        title: status === 'approved' ? 'Withdrawal approved' : 'Withdrawal rejected',
      })
    },
    [pushToast],
  )

  const toggleUserStatus = useCallback((id: string) => {
    setUsers((current) =>
      current.map((u) =>
        u.id === id ? { ...u, status: u.status === 'active' ? 'suspended' : 'active' } : u,
      ),
    )
  }, [])

  const balance = session?.role === 'agent' ? agentBalance : customerBalance

  const value = useMemo<Store>(
    () => ({
      session,
      login,
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
      findOrder,
      products,
      updateProductTier,
      pricingAgents,
      retailPrice,
      myBand,
      myResalePrice,
      hasOwnPrice,
      setAgentPrice,
      previewSplit,
      myShareOf,
      withdrawals,
      requestWithdrawal,
      decideWithdrawal,
      users,
      toggleUserStatus,
      claimableCredits,
      multiLevelReferral,
      setMultiLevelReferral,
      simulateFailure,
      setSimulateFailure,
      toasts,
      pushToast,
      dismissToast,
    }),
    [
      agentBalance,
      balance,
      claimableCredits,
      customerBalance,
      decideWithdrawal,
      dismissToast,
      earnings,
      findOrder,
      hasOwnPrice,
      login,
      logout,
      multiLevelReferral,
      myBand,
      myResalePrice,
      myShareOf,
      orders,
      placeOrder,
      previewSplit,
      pricingAgents,
      products,
      pushToast,
      requestWithdrawal,
      retailPrice,
      sellerCode,
      sellerName,
      session,
      setAgentPrice,
      setSellerCode,
      simulateFailure,
      toasts,
      toggleUserStatus,
      topUpWallet,
      transactions,
      updateProductTier,
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
