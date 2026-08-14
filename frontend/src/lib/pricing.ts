/**
 * All money arithmetic for the reseller network, as pure functions.
 *
 * A byte-identical copy of `backend/src/domain/pricing.ts`, kept in step by hand.
 * It exists so the browser can price a whole storefront without a request per
 * product (NFR-1.1).
 *
 * This copy is a QUOTE, never an authority. The server re-prices every order from
 * its own rows inside the placing transaction and ignores anything the browser
 * says the price should be. If the two ever disagree, the server is right and
 * this file is the bug.
 *
 * ── The model ────────────────────────────────────────────────────────────────
 *
 * **Every agent buys at the same price.** James pays the provider
 * `supplierCost` and sells to all agents at `adminPrice`, no matter who referred
 * them. There is no cascade: being three referrals deep does not make your stock
 * more expensive.
 *
 * That flat base is the point. Under a cascading model each level added its
 * markup to the next level's cost, so a deep network priced the product out of
 * the market — the customer paid for the length of the chain. Here the customer
 * pays what their seller chose, and depth is invisible to them.
 *
 * **Referral is exactly one level, and the bonus comes out of James's margin.**
 * An agent either registered directly or was referred by one other agent; there
 * is no third level. When a referred agent sells, their referrer is paid an
 * admin-set percentage of *James's* margin on that sale.
 *
 * Funding it from James rather than from the seller is the part that matters
 * commercially. Take it from the seller and a referred agent earns less than a
 * directly-registered one on an identical sale — so nobody would ever use a
 * referral link, and the feature would suppress the growth it exists to create.
 * Paying it from the wholesale spread instead means:
 *
 *   · the seller keeps their whole margin, so joining via a referral costs the
 *     joiner nothing;
 *   · referring is pure upside for the referrer;
 *   · the customer price does not move, because nothing is added on top;
 *   · and it cannot overdraw. A share of James's own margin, at a rate capped at
 *     100%, is always payable — unlike a share of the seller's margin, which can
 *     exceed the spread James has to pay it from.
 *
 * James is buying distribution he did not have to recruit himself, out of the
 * spread he earns because of it.
 *
 * So one sale splits at most four ways: the supplier, James, the seller, and the
 * seller's referrer.
 */

export type Pesewas = number

export interface PricedProduct {
  id: string
  supplierCost: Pesewas
  adminPrice: Pesewas
  standardPrice: Pesewas
  maxRetailPrice: Pesewas
}

export interface AgentPriceRow {
  productId: string
  resalePrice: Pesewas
}

export interface PricingAgent {
  userId: string
  name: string
  referralCode: string
  /** Who referred them. null means they signed up directly. */
  uplineCode: string | null
  /** Explicit per-product prices. Anything missing falls back to markupPercent. */
  prices?: AgentPriceRow[]
  /** Default markup over the agent price, as a percentage. */
  markupPercent: number
}

export interface Admin {
  userId: string
  name: string
}

/** FR-5.5 / NFR-5.2 — referral behaviour, changeable without a rebuild. */
export interface ReferralPolicy {
  /** Whether a referrer earns anything from the people they referred. */
  enabled: boolean
  /**
   * The referrer's share of JAMES's margin on their referral's sales, as a whole
   * percentage. Admin-set, platform-wide. Capped at 100, which is what keeps the
   * bonus always payable.
   */
  ratePercent: number
}

export const REFERRAL_OFF: ReferralPolicy = { enabled: false, ratePercent: 0 }

/** Slot numbers for `SplitShare.depth`. Fixed, so a stored split reads the same forever. */
export const SELLER_DEPTH = 0
export const REFERRER_DEPTH = 1
export const ADMIN_DEPTH = 2

export interface SplitShare {
  userId: string
  name: string
  role: 'admin' | 'agent'
  /**
   * Which slot in the sale this participant occupies:
   *
   *   0 — the seller
   *   1 — the seller's referrer
   *   2 — the platform (James), on any sale made through an agent
   *
   * A fixed slot, not a position in a chain. It has to be fixed: if James
   * collapsed to 1 whenever there was no referrer, then `depth === 1` would mean
   * "referrer" on some orders and "platform" on others, and every reader of a
   * stored split would have to know which. The one exception is a sale with no
   * agent at all, where James is the seller and sits at 0.
   *
   * Kept as a number rather than a label because the ledger orders and groups by
   * it, and because every order already written stores it this way.
   */
  depth: number
  /** What this participant paid for the stock. 0 for a referrer, who bought nothing. */
  paid: Pesewas
  /** What they charged. 0 for a referrer, who sold nothing. */
  charged: Pesewas
  margin: Pesewas
}

export interface OrderSplit {
  supplierCost: Pesewas
  shares: SplitShare[]
}

/**
 * What any agent pays for the product.
 *
 * Always James's agent price. A function rather than a bare field read because
 * this is the exact place a cascade would creep back in, and it should be
 * obvious in a diff if it ever does.
 */
export function costForAgent(_agent: PricingAgent, product: PricedProduct): Pesewas {
  return product.adminPrice
}

/**
 * What this agent charges. An explicit price wins; otherwise their default
 * markup is applied to the agent price. Always clamped into the legal band.
 */
export function resalePriceFor(agent: PricingAgent, product: PricedProduct): Pesewas {
  const cost = costForAgent(agent, product)
  const explicit = agent.prices?.find((p) => p.productId === product.id)?.resalePrice
  const raw = explicit ?? Math.round(cost * (1 + agent.markupPercent / 100))
  return clampPrice(raw, cost, product)
}

/** A price is never below what the seller paid, and never above the retail cap. */
export function clampPrice(price: Pesewas, cost: Pesewas, product: PricedProduct): Pesewas {
  const ceiling = Math.max(product.maxRetailPrice, cost)
  return Math.min(Math.max(price, cost), ceiling)
}

/**
 * What the buyer pays. With no sell link they pay James's standard price
 * (FR-3.5); through an agent's link they pay that agent's price.
 */
export function retailPriceFor(
  sellerCode: string | null,
  product: PricedProduct,
  agents: PricingAgent[],
): Pesewas {
  if (!sellerCode) return product.standardPrice
  const seller = agents.find((a) => a.referralCode === sellerCode)
  if (!seller) return product.standardPrice
  return resalePriceFor(seller, product)
}

/** The agent who referred this seller, if referral is on and they exist. */
export function referrerOf(
  seller: PricingAgent,
  agents: PricingAgent[],
  policy: ReferralPolicy,
): PricingAgent | null {
  if (!policy.enabled || !seller.uplineCode) return null
  // A self-referral would pay the seller twice out of one margin.
  if (seller.uplineCode === seller.referralCode) return null
  return agents.find((a) => a.referralCode === seller.uplineCode) ?? null
}

/**
 * Divide one sale between the supplier, James, the seller, and the seller's
 * referrer.
 *
 * Guarantees `salePrice === supplierCost + sum(shares.margin)`, which is the
 * invariant the order transaction asserts before it commits.
 */
export function splitFor(
  product: PricedProduct,
  sellerCode: string | null,
  agents: PricingAgent[],
  admin: Admin,
  policy: ReferralPolicy = REFERRAL_OFF,
): OrderSplit {
  const seller = sellerCode ? (agents.find((a) => a.referralCode === sellerCode) ?? null) : null

  // No sell link: James sells to the customer directly at his own walk-up price
  // and keeps the whole spread.
  if (!seller) {
    return {
      supplierCost: product.supplierCost,
      shares: [
        {
          userId: admin.userId,
          name: admin.name,
          role: 'admin',
          depth: 0,
          paid: product.supplierCost,
          charged: product.standardPrice,
          margin: product.standardPrice - product.supplierCost,
        },
      ],
    }
  }

  const cost = costForAgent(seller, product)
  const salePrice = resalePriceFor(seller, product)

  // James's own margin on this sale, and the slice of it the referrer is paid.
  // Rounded once, with James taking the remainder, so the two always sum back to
  // his gross exactly — no lost or invented pesewa.
  const adminGross = product.adminPrice - product.supplierCost
  const referrer = referrerOf(seller, agents, policy)
  const bonus =
    referrer && adminGross > 0
      ? Math.min(adminGross, Math.round((adminGross * policy.ratePercent) / 100))
      : 0

  const shares: SplitShare[] = [
    {
      userId: seller.userId,
      name: seller.name,
      role: 'agent',
      depth: SELLER_DEPTH,
      paid: cost,
      charged: salePrice,
      // The seller's whole margin. A referred agent is never worse off than one
      // who registered directly — that is the point of funding the bonus from
      // James's side.
      margin: salePrice - cost,
    },
  ]

  if (referrer && bonus > 0) {
    shares.push({
      userId: referrer.userId,
      name: referrer.name,
      role: 'agent',
      depth: REFERRER_DEPTH,
      // A referrer neither bought nor sold — they are paid a share of James's
      // margin, so there is no price to record on either side.
      paid: 0,
      charged: 0,
      margin: bonus,
    })
  }

  shares.push({
    userId: admin.userId,
    name: admin.name,
    role: 'admin',
    // Always slot 2, whether or not a referrer was paid. See SplitShare.depth.
    depth: ADMIN_DEPTH,
    paid: product.supplierCost,
    charged: product.adminPrice,
    margin: adminGross - bonus,
  })

  return { supplierCost: product.supplierCost, shares }
}

/** The sale price is whatever the seller charged. */
export function salePriceOf(split: OrderSplit, product: PricedProduct): Pesewas {
  const seller = split.shares.find((share) => share.depth === 0)
  return seller ? seller.charged : product.standardPrice
}

/** The invariant. Returns the discrepancy in pesewas; 0 means balanced. */
export function splitDiscrepancy(salePrice: Pesewas, split: OrderSplit): Pesewas {
  const distributed =
    split.supplierCost + split.shares.reduce((sum, share) => sum + share.margin, 0)
  return salePrice - distributed
}

// ─── Price editing rules (FR-3.4) ───────────────────────────────────────────

export interface PriceBand {
  floor: Pesewas
  ceiling: Pesewas
}

/**
 * The legal window for an agent's own price. The floor is James's agent price —
 * the same for every agent, however they joined.
 */
export function priceBandFor(_agent: PricingAgent, product: PricedProduct): PriceBand {
  const floor = product.adminPrice
  return { floor, ceiling: Math.max(product.maxRetailPrice, floor) }
}

/**
 * NFR-4.3 — the returned string is shown to the agent verbatim, so it explains
 * the rule rather than naming it.
 */
export function validateResalePrice(price: Pesewas | null, band: PriceBand): string | null {
  const ghs = (p: Pesewas) => `GHS ${(p / 100).toFixed(2)}`
  if (price === null || !Number.isFinite(price)) return 'Enter a price like 7.50.'
  if (!Number.isInteger(price)) return 'A price is a whole number of pesewas.'
  if (price < band.floor) {
    return `You pay ${ghs(band.floor)} for this, so you cannot charge less than that.`
  }
  if (price > band.ceiling) {
    return `James caps this product at ${ghs(band.ceiling)} so it stays competitive.`
  }
  return null
}
