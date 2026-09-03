/**
 * Domain types for the JamesDataConsult platform.
 *
 * Money is ALWAYS an integer number of pesewas — never a float. GHS 12.50 is
 * 1250. This mirrors the rule in skills-breakdown.md §2 and keeps the mock
 * layer honest about how the real API will behave.
 */
export type Pesewas = number

export type Network = 'MTN' | 'Telecel' | 'AirtelTigo'

export type Category = 'data' | 'airtime' | 'voice' | 'sms' | 'afa' | 'checker'

/** FR-4.4 — the only legal order states. */
export type OrderStatus =
  /** Placed, but the customer has not paid yet. Nothing is delivered from here. */
  | 'awaiting_payment'
  | 'pending'
  | 'processing'
  /** Paid for, held until the provider approves the recipient's number. */
  | 'awaiting_approval'
  | 'completed'
  | 'failed'

/** FR-1.5 — Customer and Agent, with Admin as a separate elevated role. */
export type Role =
  | 'customer'
  | 'agent'
  | 'admin'
  /**
   * Runs the platform, as opposed to the business on it.
   *
   * Passes every admin check — see `satisfies` in the server's auth guard — so a
   * superadmin sees the admin screens plus the platform team page. The reverse is
   * never true: an admin cannot create accounts or change roles.
   */
  | 'superadmin'

/** Movements against a customer wallet (FR-2.4). */
export type TxType = 'topup' | 'purchase' | 'refund'

/** Movements against an agent's earnings account. */
export type EarningType = 'sale' | 'downline' | 'reversal' | 'withdrawal'

export type WithdrawalStatus = 'pending' | 'approved' | 'rejected'

/**
 * Mirrors `UserStatus` in the Prisma schema — all four states, not two.
 *
 * Declaring only `active | suspended` made every `status === 'active' ? a : b`
 * in the admin screens render a *pending* agent as "Suspended", and offer a
 * "Reactivate" button that skipped the approval flow entirely: no `decidedBy`,
 * no `decidedAt`, and no email telling the agent they may start selling.
 */
export type UserStatus = 'pending' | 'active' | 'rejected' | 'suspended'

/**
 * Three prices per product: what James pays, what he charges agents, and what he
 * charges a walk-up customer himself. There is no ceiling — an agent sets their
 * own retail price anywhere above what they pay.
 */
export interface Product {
  id: string
  category: Category
  /** null for products that are not network-specific (checkers). */
  network: Network | null
  name: string
  /** Short descriptor shown under the name, e.g. "Non-expiry" or "30 days". */
  validity: string
  /** What James pays DataHub GH / the voucher supplier. Admin-only. */
  supplierCost: Pesewas
  /** What James charges agents. This is a top-level agent's cost floor. */
  adminPrice: Pesewas
  /** What a walk-up customer pays with no agent link (FR-3.5). */
  standardPrice: Pesewas
  /**
   * The markup behind each price, in basis points over cost (1500 = 15%).
   *
   * Admin-only, and for the same reason `supplierCost` is: a price divided by
   * its markup gives the cost back. Undefined for everyone else, because the
   * server strips both together.
   *
   * These are what keeps a margin alive across a provider price change — the
   * prices above are re-derived from them on every catalogue sync.
   */
  agentMarkupBp?: number
  walkupMarkupBp?: number
  /**
   * Which supplier fulfils this, when one is linked. Admin-only.
   *
   * Null while nothing is linked, rather than defaulting to the one supplier we
   * happen to have — an unfulfillable product naming a provider would be a claim
   * nobody checked. Matters once the catalogue is mixed: DataHub sells data only,
   * so airtime, voice, SMS and AFA must come from elsewhere.
   */
  provider?: string | null
  active: boolean
}

/** An agent's chosen resale price for one product (FR-3.4). */
export interface AgentPrice {
  productId: string
  resalePrice: Pesewas
}

/**
 * One participant's cut of a single order. The chain always balances:
 * `salePrice === supplierCost + sum(shares.margin)`.
 */
export interface SplitShare {
  userId: string
  name: string
  /** 'admin' is James; 'agent' is anyone in the referral chain below him. */
  role: 'admin' | 'agent'
  /** How far above the seller this participant sits. 0 = the seller. */
  depth: number
  paid: Pesewas
  charged: Pesewas
  margin: Pesewas
}

export interface OrderSplit {
  supplierCost: Pesewas
  shares: SplitShare[]
  /** Paystack's fee, passed on to the buyer as its own line — never a margin. */
  processingFee: Pesewas
}

export interface Order {
  id: string
  reference: string
  productId: string
  productName: string
  network: Network | null
  category: Category
  recipient: string
  /** What the buyer actually paid. */
  salePrice: Pesewas
  /** How that money was divided, snapshotted at purchase time. */
  split: OrderSplit
  /** Referral code of the agent whose sell link was used, if any. */
  soldByCode: string | null
  status: OrderStatus
  createdAt: string
  /** Present only for result-checker orders (FR-4.7). */
  voucher?: { serial: string; pin: string }
  /** Set when the order failed and the buyer was refunded (FR-2.7). */
  refunded?: boolean
  /** How the buyer paid — a wallet, or Mobile Money at checkout. */
  paidWith: 'wallet' | 'momo'
  /** Display name of the buyer; 'Guest' for an account-less purchase. */
  buyer: string
  buyerPhone: string
  /**
   * Admin only: what the supplier actually charged, when known — can differ
   * from `split.supplierCost`, the estimate frozen in at sale time. Null for
   * anyone else, and for an order the supplier has not yet reported a real
   * charge for.
   */
  actualSupplierCost?: number | null
  /**
   * What Paystack actually kept, from their own reply — admin only, and null
   * for a wallet-paid order (the fee was already paid once at top-up time).
   * Not the same as `split.processingFee`, which is only the estimate shown
   * to the buyer at checkout.
   */
  paystackFee?: number | null
}

/** Customer wallet ledger entry (FR-2.4). */
export interface Transaction {
  id: string
  type: TxType
  amount: Pesewas
  balanceAfter: Pesewas
  description: string
  reference: string
  createdAt: string
}

/** Agent earnings ledger entry. Credited by sales, debited by withdrawals. */
export interface Earning {
  id: string
  type: EarningType
  amount: Pesewas
  balanceAfter: Pesewas
  description: string
  reference: string
  /** Which product produced this, for the agent's own reporting. */
  productName?: string
  /** 0 = their own sale; 1+ = a sale made by someone below them. */
  depth: number
  createdAt: string
}

export interface SubAgent {
  id: string
  name: string
  phone: string
  referralCode: string
  /** Whose link they joined through. */
  uplineCode: string | null
  joinedAt: string
  orders: number
  /** Volume this sub-agent has sold. */
  volume: Pesewas
  /** What their upline has earned from that volume. */
  earnedForUpline: Pesewas
  /** Markup this agent adds over their own cost, as a percentage. */
  markupPercent: number
  status: UserStatus
}

export interface PlatformUser {
  id: string
  name: string
  phone: string
  email: string
  role: Role
  status: UserStatus
  /** Customers: spendable wallet. Agents: withdrawable earnings. */
  balance: Pesewas
  orders: number
  /** Agents only: total GHS sold on completed orders, all-time. Zero for anyone else. */
  salesVolume: Pesewas
  /** Agents only: lifetime profit earned, before any withdrawal — not the same as `balance`. Zero for anyone else. */
  totalEarned: Pesewas
  referredBy: string | null
  joinedAt: string
}

export interface WithdrawalRequest {
  id: string
  agentName: string
  agentPhone: string
  amount: Pesewas
  momoNetwork: Network
  status: WithdrawalStatus
  requestedAt: string
}

export interface Session {
  id: string
  name: string
  phone: string
  email: string
  role: Role
  referralCode: string
  /** Referral code of this agent's upline. null means directly under James. */
  uplineCode: string | null
  /**
   * Whether this account may trade yet.
   *
   * An agent applies rather than simply signing up, so a new one is `pending`
   * until approved. They are allowed to sign in — telling them their password is
   * wrong would send them round in circles — so the app has to know not to offer
   * selling tools that cannot work.
   */
  status: 'pending' | 'active' | 'rejected' | 'suspended'
  /** Why an application was refused. Shown to them. */
  statusNote: string | null
}
