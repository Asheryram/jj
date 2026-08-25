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
 * **There is no price ceiling.** An agent sets whatever they like above their own
 * cost. The cascade was the only reason a cap was ever needed, and with it gone
 * an overpriced agent just loses the sale to a cheaper one — competition caps the
 * price more reliably than a number James has to maintain per product.
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

/**
 * Slot numbers for `SplitShare.depth`. Fixed, so a stored split reads the same
 * forever.
 *
 * `REFERRER_DEPTH` is kept although nothing produces it any more: orders placed
 * while referrers were paid still carry a share at slot 1, and the reports that
 * read those orders have to keep understanding them. Removing the constant would
 * not remove the history, only the ability to describe it.
 */
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
 * markup is applied to the agent price, through the same fee-aware
 * `priceFromMarkup` James's own prices use — one rule for what a percentage
 * markup means, wherever it is set. Always clamped into the legal band.
 *
 * An explicit price is never adjusted for the fee. The agent typed a number;
 * there is no percentage behind it to correct, and their own earning
 * (`salePrice - cost`) is unconditionally credited by the split regardless of
 * what Paystack keeps — see `splitFor`.
 */
export function resalePriceFor(
  agent: PricingAgent,
  product: PricedProduct,
  feeBp: BasisPoints = 0,
): Pesewas {
  const cost = costForAgent(agent, product)
  const explicit = agent.prices?.find((p) => p.productId === product.id)?.resalePrice
  const raw = explicit ?? priceFromMarkup(cost, agent.markupPercent * 100, feeBp)
  return floorAtCost(raw, cost)
}

/**
 * A price is never below what the seller paid. There is no upper bound.
 *
 * There used to be a platform retail cap here, on the theory that a long chain
 * could price a bundle out of the market. That reasoning died with the cascade:
 * every agent now buys at the same price and sets their own, so an agent who
 * overprices simply loses to the agent who does not. Competition is the ceiling,
 * and it is a better one than a number James has to maintain per product.
 *
 * Selling below cost is still refused — that destroys money on every order and is
 * never a pricing strategy.
 */
export function floorAtCost(price: Pesewas, cost: Pesewas): Pesewas {
  return Math.max(price, cost)
}

/**
 * What the buyer pays. With no sell link they pay James's standard price
 * (FR-3.5); through an agent's link they pay that agent's price.
 */
export function retailPriceFor(
  sellerCode: string | null,
  product: PricedProduct,
  agents: PricingAgent[],
  feeBp: BasisPoints = 0,
): Pesewas {
  if (!sellerCode) return product.standardPrice
  const seller = agents.find((a) => a.referralCode === sellerCode)
  if (!seller) return product.standardPrice
  return resalePriceFor(seller, product, feeBp)
}

/**
 * Divide one sale between the supplier, James, and the seller.
 *
 * Guarantees `salePrice === supplierCost + sum(shares.margin)`, which is the
 * invariant the order transaction asserts before it commits.
 *
 * A referrer used to take a slice of James's margin on the people they signed up.
 * That was removed at the client's request: an agent earns from what they sell and
 * nothing else. Who invited whom is still recorded — it is how an agent sees the
 * people they brought in — it simply no longer moves money.
 */
export function splitFor(
  product: PricedProduct,
  sellerCode: string | null,
  agents: PricingAgent[],
  admin: Admin,
  feeBp: BasisPoints = 0,
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
  const salePrice = resalePriceFor(seller, product, feeBp)

  // James's whole margin on this sale. Nothing is taken out of it any more: the
  // referrer bonus that used to come from here was removed at the client's
  // request, so a sale now divides two ways above cost.
  const adminGross = product.adminPrice - product.supplierCost

  const shares: SplitShare[] = [
    {
      userId: seller.userId,
      name: seller.name,
      role: 'agent',
      depth: SELLER_DEPTH,
      paid: cost,
      charged: salePrice,
      margin: salePrice - cost,
    },
  ]

  shares.push({
    userId: admin.userId,
    name: admin.name,
    role: 'admin',
    // Still slot 2, not slot 1. The numbering is fixed so a split stored while
    // referrers were paid keeps meaning what it meant — see SplitShare.depth.
    depth: ADMIN_DEPTH,
    paid: product.supplierCost,
    charged: product.adminPrice,
    margin: adminGross,
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

/**
 * The legal window for an agent's price. Open-ended upwards — only the floor is
 * enforced, so this is a floor with a name rather than a band. Kept as an object
 * because callers pass it around and read `.floor`.
 */
export interface PriceBand {
  floor: Pesewas
}

/**
 * The legal window for an agent's own price. The floor is James's agent price —
 * the same for every agent, however they joined.
 */
export function priceBandFor(_agent: PricingAgent, product: PricedProduct): PriceBand {
  return { floor: product.adminPrice }
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
  // No upper bound: an agent may charge whatever they think the market will bear.
  return null
}

// ─── Markup ──────────────────────────────────────────────────────────────────

/**
 * Basis points, not percent. 1500 = 15.00%.
 *
 * Percent as an integer is too coarse — a price typed as GHS 6.40 against a cost
 * of GHS 4.70 is a markup of 36.17%, and rounding that to 36% moves the price by
 * a pesewa every time the cost is refreshed. Basis points hold it still.
 */
export type BasisPoints = number

/**
 * A fee rate is a fraction between 0 and (just under) 100%. Clamped rather than
 * trusted, because these are pure functions and 10,000 or more basis points
 * would divide by zero or go negative — a data problem, not something either
 * caller should have to guard against before calling in.
 */
function clampFeeBp(feeBp: BasisPoints): BasisPoints {
  if (!Number.isFinite(feeBp)) return 0
  return Math.min(Math.max(Math.round(feeBp), 0), 9_999)
}

/**
 * The price a markup implies, floored at cost.
 *
 * `feeBp` is the Paystack fee, in basis points, taken as a percentage of the
 * final price. Grossing the price up by it — dividing rather than adding — is
 * what makes the margin survive the fee: adding the fee on top charges it on
 * too small a base, and the shortfall grows the more expensive the bundle is.
 *
 *   price × (1 − fee) = cost × (1 + markup)      ⇒      price = cost(1+markup) / (1−fee)
 *
 * `feeBp = 0` collapses to the plain markup — no gross-up, unchanged.
 *
 * Rounds up rather than to the nearest pesewa, so a price can never quietly
 * undershoot the margin it was meant to guarantee by half a pesewa of rounding.
 * That is a deliberate, one-pesewa-at-most change from the rounding this used to
 * do even before the fee existed.
 */
export function priceFromMarkup(cost: Pesewas, markupBp: BasisPoints, feeBp: BasisPoints = 0): Pesewas {
  const fee = clampFeeBp(feeBp)
  const withMargin = cost * (10_000 + markupBp)
  return Math.max(cost, Math.ceil(withMargin / (10_000 - fee)))
}

/**
 * The markup a price implies. The inverse of the above, give or take rounding.
 *
 * Zero when cost is zero: no markup is meaningful over nothing, and dividing
 * would give Infinity.
 *
 * `feeBp` matters here too: a price that includes a fee gross-up implies a
 * *smaller* markup than reading the raw numbers would suggest, because part of
 * the gap between cost and price is the fee, not margin. Left out (0), this is
 * exactly the calculation that was always here.
 */
export function markupFromPrice(cost: Pesewas, price: Pesewas, feeBp: BasisPoints = 0): BasisPoints {
  if (cost <= 0) return 0
  const fee = clampFeeBp(feeBp)
  // What the fee leaves behind, before it is compared against cost.
  const net = (price * (10_000 - fee)) / 10_000
  return Math.max(0, Math.round((net / cost - 1) * 10_000))
}

/** For display: 1517 → "15.17%", 1500 → "15%". */
export function formatMarkup(markupBp: BasisPoints): string {
  // A non-finite markup would render as the literal text "NaN%" on a price row.
  if (!Number.isFinite(markupBp)) return '—'
  const percent = markupBp / 100
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`
}
