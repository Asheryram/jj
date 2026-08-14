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
  /** Send the stored token. On by default; login and register opt out. */
  auth?: boolean
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options
  const headers: Record<string, string> = {}

  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const stored = auth ? token.get() : null
  if (stored) headers.Authorization = `Bearer ${stored}`

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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

/** One SKU in the provider's catalogue — the DataHub GH stand-in. */
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
  placeOrder: (body: PlaceOrderBody) => request<Order>('/orders', { method: 'POST', body }),

  orders: () => request<Order[]>('/orders'),

  order: (id: string) => request<Order>(`/orders/${id}`),

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

  adminUsers: () => request<PlatformUser[]>('/admin/users'),

  toggleUserStatus: (id: string) =>
    request<{ id: string; status: 'active' | 'suspended' }>(`/admin/users/${id}/status`, {
      method: 'PATCH',
    }),

  setProductTier: (
    productId: string,
    tier: 'supplierCost' | 'adminPrice' | 'standardPrice' | 'maxRetailPrice',
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
    request<{
      referralEnabled: boolean
      referralRatePercent: number
      simulateFailure: boolean
      registrationOpen: boolean
    }>(
      '/admin/settings',
      { method: 'PATCH', body: { key, value } },
    ),

  supplierCatalogue: () => request<SupplierSku[]>('/admin/supplier'),

  setSupplierAvailability: (code: string, available: boolean) =>
    request<{ code: string; available: boolean }>(
      `/admin/supplier/${encodeURIComponent(code)}/availability`,
      { method: 'PATCH', body: { available } },
    ),

  /** The only way `supplierCost` can change — see admin.service.ts setTier. */
  setSupplierCost: (code: string, costPrice: number) =>
    request<{ code: string; costPrice: number; productsUpdated: number }>(
      `/admin/supplier/${encodeURIComponent(code)}/cost`,
      { method: 'PATCH', body: { costPrice } },
    ),

  syncSupplierCosts: () => request<{ updated: number }>('/admin/supplier/sync', { method: 'POST' }),
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
