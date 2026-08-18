import type {
  AgentPrice,
  Earning,
  Network,
  Order,
  PlatformUser,
  Product,
  Role,
  Session,
  SubAgent,
  Transaction,
  WithdrawalRequest,
  WithdrawalStatus,
} from '../data/types'
import type { PricingAgent } from './pricing'

/**
 * HTTP client for the NestJS API. The only source of data in the app.
 *
 * `VITE_API_URL` points at the API. It falls back to a same-origin `/api`, which
 * is the shape of a production deployment where the SPA and the API sit behind
 * one host and no build-time URL has to be baked in.
 */
export const API_URL = (
  (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'
).replace(/\/$/, '')

const TOKEN_KEY = 'jdc.token'

export const token = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (value: string) => localStorage.setItem(TOKEN_KEY, value),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

/**
 * An error carrying the API's stable code alongside the sentence meant for the
 * user. NFR-4.3 — components show `message` and never build copy from `code`.
 */
export class ApiError extends Error {
  // Declared as fields rather than constructor parameter properties: the app
  // builds with `erasableSyntaxOnly`, which forbids the shorthand.
  readonly code: string
  readonly status: number
  readonly detail?: Record<string, unknown>

  constructor(code: string, message: string, status: number, detail?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /**
   * A multipart upload, for the one thing that needs it — a logo.
   *
   * Mutually exclusive with `body`. The Content-Type header is deliberately NOT
   * set: the browser has to add its own multipart boundary, and setting the type
   * by hand strips it and produces a body the server cannot parse.
   */
  form?: FormData
  /** Send the stored token. On by default; login and register opt out. */
  auth?: boolean
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, form, auth = true, signal } = options
  const headers: Record<string, string> = {}

  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const stored = auth ? token.get() : null
  if (stored) headers.Authorization = `Bearer ${stored}`

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal,
    })
  } catch (error) {
    // A dead API and no network look the same from here. Say the useful thing:
    // on Ghana 4G this is usually the connection, and retrying is right.
    if ((error as Error).name === 'AbortError') throw error
    throw new ApiError(
      'NETWORK',
      'We could not reach the server. Check your connection and try again.',
      0,
    )
  }

  if (response.status === 204) return undefined as T

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const envelope = (payload ?? {}) as { code?: string; message?: string; detail?: Record<string, unknown> }

    // An expired token is not an error the user can act on — drop it so the app
    // falls back to a signed-out state rather than looping on 401s.
    if (response.status === 401) token.clear()

    throw new ApiError(
      envelope.code ?? 'INTERNAL',
      envelope.message ?? 'Something went wrong. Please try again.',
      response.status,
      envelope.detail,
    )
  }

  return payload as T
}

// ─── Shapes the API returns ─────────────────────────────────────────────────

export interface AuthResult {
  accessToken: string
  user: Session
  balance: number
}

export interface CatalogueSnapshot {
  products: Product[]
  pricingAgents: PricingAgent[]
  admin: { userId: string; name: string }
  settings: {
    referralEnabled: boolean
    /** The referrer's share of James's margin, as a whole percentage. */
    referralRatePercent: number
    simulateFailure?: boolean
  }
}

export interface RevenueDay {
  day: string
  date: string
  revenue: number
  orders: number
  platformMargin: number
}

export interface AgentEarningsDay {
  day: string
  date: string
  revenue: number
  own: number
  downline: number
}

export interface AdminOverview {
  windowDays: number
  orders: number
  revenue: number
  failedOrders: number
  successRate: number
  averageOrderValue: number
  activeAgents: number
  customers: number
  pendingWithdrawals: { count: number; amount: number }
  unclaimedCredits: { count: number; amount: number }
}

/**
 * The signed-in user's own headline numbers, aggregated server-side.
 *
 * Deliberately not derived in the browser from the orders list: that list is
 * capped, so any total summed from it undercounts once an agent passes the cap.
 */
export interface MySummary {
  role: Role
  /** Agents. Net of reversals, so a refunded sale is not still counted. */
  earnedToday?: number
  earnedAllTime?: number
  /** Customers. */
  spentToday?: number
  spentAllTime?: number
  ordersToday: number
  ordersCompleted: number
  ordersTotal: number
  activeSubAgents: number
}

export interface PlatformSettings {
  referralEnabled: boolean
  referralRatePercent: number
  simulateFailure: boolean
  registrationOpen: boolean
}

/** One SKU in the provider's catalogue. */
/** One attempt to have a supplier deliver an order. */
export interface DispatchAttempt {
  id: string
  supplierCode: string
  recipient: string
  costPrice: number
  outcome: 'delivered' | 'rejected' | 'pending' | 'unknown'
  reason: string | null
  /** True when nothing left the building — the provider was stubbed. */
  simulated: boolean
  attempt: number
  createdAt: string
  providerReference: string | null
  providerStatus: string | null
  /** Pesewas the provider actually debited, when they said. */
  providerCharged: number | null
  /** Their reply verbatim, truncated to 2KB. */
  providerResponse: string | null
}

import type { BrandRamp } from './branding'

export interface PublicBranding {
  shopName: string
  /** The colour as chosen. The ramp below may darken its 700 step for contrast. */
  brandColor: string
  /** Every Tailwind step, keyed '50' through '900'. */
  ramp: BrandRamp
  logoUrl: string | null
  /** True when this is an agent's own branding rather than the platform's. */
  custom: boolean
}

export interface MyBranding {
  live: { shopName: string | null; brandColor: string | null; hasLogo: boolean } | null
  pending: {
    id: string
    shopName: string | null
    brandColor: string | null
    hasLogo: boolean
    createdAt: string
  } | null
  lastDecision: { status: string; note: string | null; decidedAt: string | null } | null
}

export interface BrandingRequestRow {
  id: string
  agentName: string
  agentCode: string
  shopName: string | null
  brandColor: string | null
  logoUrl: string | null
  status: 'pending' | 'approved' | 'rejected'
  note: string | null
  createdAt: string
  decidedAt: string | null
}

export interface RefundRequest {
  id: string
  orderRef: string
  productName: string
  buyerName: string
  buyerPhone: string
  amount: number
  /** `wallet` credits directly; `claimable` issues a link to claim. */
  method: 'wallet' | 'claimable'
  /** Why the order failed, in the words shown to whoever decides. */
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  /** Set only on a refusal: why it was refused. */
  note: string | null
  createdAt: string
  decidedAt: string | null
}

export interface ReservePosition {
  /** Pesewas Paystack holds. Null when they could not be reached — not zero. */
  balance: number | null
  balanceError: string | null
  liabilities: {
    agentEarnings: number
    customerMoney: number
    undeliveredOrders: number
    total: number
  }
  pendingPayouts: { count: number; amount: number }
  unclaimedRefunds: { count: number; amount: number }
  /** Owed back and waiting on approval. Already counted in the liabilities. */
  pendingRefunds: { count: number; amount: number }
  /** Balance less every obligation. Null when the balance is unknown. */
  available: number | null
  covered: boolean | null
}

export interface FinanceStatement {
  since: string
  revenue: number
  costs: {
    supplier: number
    paymentFees: number
    agentMargins: number
    referralBonuses: number
    refunds: number
    payoutFees: number
  }
  profit: number
  cashMovement: number
  settlements: { payouts: number; walletTopUps: number }
  marginRate: number | null
}

export interface PendingApproval {
  phone: string
  networkKey: string
  /** Paid orders parked against this number, waiting to be delivered. */
  ordersHeld: number
  /** Pesewas of customer money held up by it. */
  valueHeld: number
  lastProduct: string | null
  waitingSince: string
}

export interface SupplierSku {
  code: string
  provider: string
  category: string
  network: Network | null
  name: string
  validity: string
  costPrice: number
  available: boolean
  updatedAt: string
  /** Our product ids fulfilled by this SKU. */
  mappedTo: string[]
  /** DataHub's network identifier, e.g. YELLO. Null when they cannot sell it. */
  networkKey: string | null
  /** Size in GB as their API wants it. Null when there is no whole-GB form. */
  capacityGb: string | null
  /** False means an order for this is refused at checkout while live. */
  autoFulfillable: boolean
}

export interface ClaimableCreditDto {
  phone: string
  amount: number
  reference: string
  createdAt: string
}

export interface PlaceOrderBody {
  productId: string
  recipient: string
  buyerPhone?: string
  buyerName?: string
  payWith: 'wallet' | 'momo'
  sellerCode?: string | null
  idempotencyKey?: string
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

export const api = {
  health: () =>
    request<{
      status: string
      database: string
      providers: { datahub: string; paystack: string }
    }>('/health', { auth: false }),

  // Auth
  login: (email: string, password: string) =>
    request<AuthResult>('/auth/login', { method: 'POST', body: { email, password }, auth: false }),

  register: (body: {
    name: string
    phone: string
    email: string
    password: string
    accountType: 'customer' | 'agent'
    referralCode?: string
  }) => request<AuthResult>('/auth/register', { method: 'POST', body, auth: false }),

  me: () => request<{ user: Session; balance: number }>('/auth/me'),

  // Catalogue — one call for products, the referral chain and platform switches.
  catalogue: () => request<CatalogueSnapshot>('/catalogue', { auth: true }),

  seller: (code: string) =>
    request<{ seller: { name: string; referralCode: string } | null }>(
      `/sellers/${encodeURIComponent(code)}`,
      { auth: false },
    ),

  // Orders
  /**
   * Place an order.
   *
   * With Paystack collecting the money the reply carries `paymentUrl` and the
   * order is `awaiting_payment` — the caller must send the customer there, not
   * show them a receipt.
   */
  placeOrder: (body: PlaceOrderBody) =>
    request<Order & { paymentUrl?: string }>('/orders', { method: 'POST', body }),

  /**
   * Ask the server to check a payment with Paystack.
   *
   * Sends only a reference, which the browser already knows. Everything is
   * decided from a server-to-Paystack call, because the page coming back from a
   * payment is the one party with a motive to claim it succeeded.
   */
  confirmPayment: (reference: string) =>
    request<{ status: 'paid' | 'pending' | 'failed' }>('/payments/confirm', {
      method: 'POST',
      body: { reference },
      auth: false,
    }),

  /**
   * Ask the provider whether they will deliver to this number, before paying.
   * `checked: false` means the question did not apply — simulated fulfilment, or
   * a network their check does not cover.
   */
  verifyRecipient: (productId: string, recipient: string) =>
    request<{ checked: boolean; verified: boolean; message: string }>('/orders/verify-recipient', {
      method: 'POST',
      body: { productId, recipient },
      auth: false,
    }),

  orders: () => request<Order[]>('/orders'),

  order: (id: string) => request<Order>(`/orders/${id}`),

  /**
   * What we asked the provider for this order and what it answered. Admin only.
   *
   * The order itself only carries `status`, which flattens every way a delivery
   * can go wrong into the single word "failed". This is where the difference
   * lives: an empty float, an unapproved recipient, a withdrawn bundle.
   */
  orderDispatches: (id: string) => request<DispatchAttempt[]>(`/orders/${id}/dispatches`),

  trackOrder: (reference: string, phone: string) =>
    request<Order>('/orders/track', { method: 'POST', body: { reference, phone }, auth: false }),

  credits: (phone: string) =>
    request<ClaimableCreditDto[]>(`/orders/credits?phone=${encodeURIComponent(phone)}`, {
      auth: false,
    }),

  // Wallet (customers)
  wallet: () => request<{ balance: number; transactions: Transaction[] }>('/wallet'),

  topUp: (amount: number, network: Network) =>
    request<{ balance: number; transaction: Transaction }>('/wallet/topup', {
      method: 'POST',
      body: { amount, network },
    }),

  // Agents
  earnings: () => request<{ balance: number; earnings: Earning[] }>('/agents/me/earnings'),

  agentPrices: () => request<AgentPrice[]>('/agents/me/prices'),

  setAgentPrice: (productId: string, resalePrice: number) =>
    request<{ productId: string; resalePrice: number }>(
      `/agents/me/prices/${encodeURIComponent(productId)}`,
      { method: 'PUT', body: { resalePrice } },
    ),

  clearAgentPrice: (productId: string) =>
    request<{ productId: string }>(`/agents/me/prices/${encodeURIComponent(productId)}`, {
      method: 'DELETE',
    }),

  downline: () => request<SubAgent[]>('/agents/me/downline'),

  myEarningsByDay: (days = 7) => request<AgentEarningsDay[]>(`/reports/my-earnings?days=${days}`),

  mySummary: () => request<MySummary>('/reports/my-summary'),

  // Withdrawals
  withdrawals: () => request<WithdrawalRequest[]>('/withdrawals'),

  requestWithdrawal: (amount: number, momoNetwork: Network) =>
    request<WithdrawalRequest>('/withdrawals', {
      method: 'POST',
      body: { amount, momoNetwork },
    }),

  decideWithdrawal: (id: string, status: WithdrawalStatus) =>
    request<WithdrawalRequest>(`/withdrawals/${id}`, { method: 'PATCH', body: { status } }),

  // Admin
  adminOverview: () => request<AdminOverview>('/admin/overview'),

  /**
   * What is owed against what Paystack is holding.
   *
   * The figure that decides whether supplier float can be topped up without
   * spending an agent's earnings.
   */
  /**
   * A shop's name, mark and colour. Unauthenticated: a guest shopping through an
   * agent's link has no account, and the shop still has to render for them.
   */
  branding: (seller?: string | null) =>
    request<PublicBranding>(seller ? `/branding?seller=${encodeURIComponent(seller)}` : '/branding', {
      auth: false,
    }),

  /** What the signed-in agent has live, and anything awaiting review. */
  myBranding: () => request<MyBranding>('/branding/mine'),

  /** Propose branding. Reviewed before it goes live. */
  submitBranding: (form: FormData) =>
    request<{ id: string; status: string }>('/branding/mine', { method: 'POST', form }),

  /** The platform owner's own branding. Applies immediately. */
  setPlatformBranding: (form: FormData) =>
    request<PublicBranding>('/admin/branding', { method: 'POST', form }),

  brandingQueue: (status: 'pending' | 'approved' | 'rejected' = 'pending') =>
    request<BrandingRequestRow[]>(`/admin/branding/requests?status=${status}`),

  approveBranding: (id: string) =>
    request<{ id: string; status: string }>(`/admin/branding/requests/${id}/approve`, {
      method: 'POST',
    }),

  rejectBranding: (id: string, note: string) =>
    request<{ id: string; status: string }>(`/admin/branding/requests/${id}/reject`, {
      method: 'POST',
      body: { note },
    }),

  reservePosition: () => request<ReservePosition>('/admin/finance/position'),

  /**
   * Money owed back to customers, waiting on a decision.
   *
   * Refunds are not automatic: a failed delivery records the debt and stops, so
   * approving here is the only thing that moves the money.
   */
  refundQueue: (status: 'pending' | 'approved' | 'rejected' = 'pending') =>
    request<RefundRequest[]>(`/admin/refunds?status=${status}`),

  approveRefund: (id: string) =>
    request<{ id: string; status: 'approved' }>(`/admin/refunds/${id}/approve`, { method: 'POST' }),

  /** Refusing needs a reason, and it is kept on the record. */
  rejectRefund: (id: string, note: string) =>
    request<{ id: string; status: 'rejected' }>(`/admin/refunds/${id}/reject`, {
      method: 'POST',
      body: { note },
    }),

  /** Profit and loss from the ledger, over a window of days. */
  financeStatement: (days = 30) =>
    request<FinanceStatement>(`/admin/finance/statement?days=${days}`),

  adminUsers: () => request<PlatformUser[]>('/admin/users'),

  toggleUserStatus: (id: string) =>
    request<{ id: string; status: 'active' | 'suspended' }>(`/admin/users/${id}/status`, {
      method: 'PATCH',
    }),

  setProductTier: (
    productId: string,
    tier: 'supplierCost' | 'adminPrice' | 'standardPrice',
    value: number,
  ) =>
    request<Product>(`/admin/products/${encodeURIComponent(productId)}/tier`, {
      method: 'PATCH',
      body: { tier, value },
    }),

  revenueByDay: (days = 7) => request<RevenueDay[]>(`/admin/reports/revenue?days=${days}`),

  setSetting: (
    key: 'referralEnabled' | 'referralRatePercent' | 'simulateFailure' | 'registrationOpen',
    value: boolean | number,
  ) =>
    request<PlatformSettings>(
      '/admin/settings',
      { method: 'PATCH', body: { key, value } },
    ),

  adminSettings: () => request<PlatformSettings>('/admin/settings'),

  supplierCatalogue: () => request<SupplierSku[]>('/admin/supplier'),

  /**
   * Numbers a customer tried to buy for that DataHub has not approved yet.
   *
   * Every row is a refused sale. Their submission API is down, so these get
   * approved by hand in DataHub's dashboard.
   */
  pendingApprovals: () => request<PendingApproval[]>('/admin/beneficiaries'),

  /** Ask DataHub which of them have since been approved. */
  recheckApprovals: () =>
    request<{ checked: number; approved: string[]; released: number }>('/admin/beneficiaries/recheck', {
      method: 'POST',
    }),

  /** Try their submission API. Returns the reason when it refuses. */
  submitApprovals: () =>
    request<{ submitted: number; error: string | null }>('/admin/beneficiaries/submit', {
      method: 'POST',
    }),

  /**
   * Re-read every configured supplier's catalogue and make ours match.
   *
   * Each supplier is reported separately, and one that cannot be reached carries
   * an `error` while its rows are left exactly as they were — an outage at one
   * must not withdraw a catalogue that is fine.
   */
  syncSuppliers: () =>
    request<{
      sources: {
        provider: string
        label: string
        created: number
        updated: number
        repriced: number
        withdrawn: number
        unpriced: number
        /** Set when that supplier could not be reached; its rows are untouched. */
        error?: string
      }[]
      created: number
      updated: number
      repriced: number
      withdrawn: number
      unpriced: number
      productsUpdated: number
    }>('/admin/supplier/sync', { method: 'POST' }),

  /**
   * Set one markup across many products at once, and price them from it.
   *
   * `unpriced` catches products freshly imported from a supplier; `all` re-prices
   * a whole category deliberately.
   */
  applyMarkup: (input: {
    agentPercent: number
    walkupPercent: number
    scope: 'unpriced' | 'all'
    category?: string
  }) => request<{ updated: number }>('/admin/products/markup', { method: 'POST', body: input }),
}

/**
 * A key that survives a retry of the same checkout attempt but differs between
 * two deliberate purchases. Generated once per confirm press.
 */
export function newIdempotencyKey(): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `chk-${random}`
}
