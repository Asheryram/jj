import type { AgentPrice, OrderSplit, Pesewas, Product, SplitShare } from '../data/types'
import { cedis } from './format'

/**
 * All money arithmetic for the reseller chain lives here, as pure functions.
 *
 * The model: DataHub GH sells to James at `supplierCost`. James sells to his
 * agents at `adminPrice`. Each agent sells to the agent below them at their own
 * resale price. The bottom agent sells to the customer. Everybody's margin is
 * simply the gap between what they pay and what they charge — there is no
 * commission to calculate, and every upline is paid automatically because
 * their markup is already inside the price the seller pays.
 *
 * In the NestJS build this file becomes the pricing domain: no HTTP, no ORM,
 * no framework, and unit-testable on its own.
 */

export interface PricingAgent {
  userId: string
  name: string
  referralCode: string
  /** null means this agent sits directly under James. */
  uplineCode: string | null
  /** Explicit per-product prices. Anything missing falls back to markupPercent. */
  prices?: AgentPrice[]
  /** Default markup over this agent's own cost, as a percentage. */
  markupPercent: number
}

export interface Admin {
  userId: string
  name: string
}

/** Guard against a malformed referral chain looping forever. */
const MAX_CHAIN_DEPTH = 10

/**
 * The chain from a seller upwards, seller first. James is not included — he is
 * always the implicit root and is added by `splitFor`.
 */
export function resolveChain(
  sellerCode: string | null,
  agents: PricingAgent[],
): PricingAgent[] {
  if (!sellerCode) return []
  const chain: PricingAgent[] = []
  const seen = new Set<string>()
  let code: string | null = sellerCode

  while (code && chain.length < MAX_CHAIN_DEPTH) {
    if (seen.has(code)) break // cycle — stop rather than hang
    seen.add(code)
    const agent = agents.find((a) => a.referralCode === code)
    if (!agent) break
    chain.push(agent)
    code = agent.uplineCode
  }

  return chain
}

/**
 * What this agent pays for the product: their upline's resale price, or
 * James's price if they sit directly under him.
 */
export function costForAgent(
  agent: PricingAgent,
  product: Product,
  agents: PricingAgent[],
): Pesewas {
  if (!agent.uplineCode) return product.adminPrice
  const upline = agents.find((a) => a.referralCode === agent.uplineCode)
  if (!upline) return product.adminPrice
  return resalePriceFor(upline, product, agents)
}

/**
 * What this agent charges. An explicit price wins; otherwise their default
 * markup is applied to their own cost. Always clamped into the legal band.
 */
export function resalePriceFor(
  agent: PricingAgent,
  product: Product,
  agents: PricingAgent[],
): Pesewas {
  const cost = costForAgent(agent, product, agents)
  const explicit = agent.prices?.find((p) => p.productId === product.id)?.resalePrice
  const raw = explicit ?? Math.round(cost * (1 + agent.markupPercent / 100))
  return clampPrice(raw, cost, product)
}

/** A price is never below what the seller paid, and never above the retail cap. */
export function clampPrice(price: Pesewas, cost: Pesewas, product: Product): Pesewas {
  const ceiling = Math.max(product.maxRetailPrice, cost)
  return Math.min(Math.max(price, cost), ceiling)
}

/**
 * What the buyer pays. With no sell link they pay James's standard price
 * (FR-3.5); through an agent's link they pay that agent's price.
 */
export function retailPriceFor(
  sellerCode: string | null,
  product: Product,
  agents: PricingAgent[],
): Pesewas {
  if (!sellerCode) return product.standardPrice
  const seller = agents.find((a) => a.referralCode === sellerCode)
  if (!seller) return product.standardPrice
  return resalePriceFor(seller, product, agents)
}

/**
 * Divide one sale between the supplier, James, and every agent in the chain.
 *
 * Guarantees `salePrice === supplierCost + sum(shares.margin)`, which is the
 * invariant the backend must enforce inside the same transaction that credits
 * each account. `assertBalanced` below is the check.
 */
export function splitFor(
  product: Product,
  sellerCode: string | null,
  agents: PricingAgent[],
  admin: Admin,
): OrderSplit {
  const chain = resolveChain(sellerCode, agents)
  const shares: SplitShare[] = []

  // Walk the chain from the seller upwards. Each agent charges the person
  // below them and pays the person above.
  chain.forEach((agent, index) => {
    const charged =
      index === 0
        ? retailPriceFor(sellerCode, product, agents)
        : resalePriceFor(agent, product, agents)
    const paid = costForAgent(agent, product, agents)
    shares.push({
      userId: agent.userId,
      name: agent.name,
      role: 'agent',
      depth: index,
      paid,
      charged,
      margin: charged - paid,
    })
  })

  // James is always last. With no agent in the chain he charges the customer
  // the standard price directly and keeps the whole spread.
  const adminCharged = chain.length > 0 ? product.adminPrice : product.standardPrice
  shares.push({
    userId: admin.userId,
    name: admin.name,
    role: 'admin',
    depth: chain.length,
    paid: product.supplierCost,
    charged: adminCharged,
    margin: adminCharged - product.supplierCost,
  })

  return { supplierCost: product.supplierCost, shares }
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

export function priceBandFor(
  agent: PricingAgent,
  product: Product,
  agents: PricingAgent[],
): PriceBand {
  const floor = costForAgent(agent, product, agents)
  return { floor, ceiling: Math.max(product.maxRetailPrice, floor) }
}

/**
 * NFR-4.3 — the returned string is shown to the agent verbatim, so it explains
 * the rule rather than naming it.
 */
export function validateResalePrice(price: Pesewas | null, band: PriceBand): string | null {
  if (price === null) return 'Enter a price like 7.50.'
  if (price < band.floor) {
    return `You pay ${cedis(band.floor)} for this, so you cannot charge less than that.`
  }
  if (price > band.ceiling) {
    return `James caps this product at ${cedis(band.ceiling)} so it stays competitive.`
  }
  return null
}
