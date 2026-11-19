/**
 * Turns this business's own numbers into a short, ranked list of decisions:
 * what to do this week, why, and roughly what it is worth.
 *
 * Pure functions over plain data, so each rule is tested on its own
 * (`decisions.spec.ts`); `DecisionsService` only gathers the inputs. Every
 * rule is deliberately conservative: it stays quiet unless the evidence is
 * strong enough to act on, because a list that cries wolf stops being read.
 *
 * All money is pesewas. "A month" is 28 days of recent trading, scaled up.
 */

export type Urgency = 'now' | 'this_week' | 'when_you_can'

export interface Decision {
  /** Stable per rule (and per subject), so the page can key and track it. */
  id: string
  kind: 'provider_switch' | 'float_runway' | 'agents_slipping' | 'thin_margin' | 'failure_cost' | 'cash_available'
  urgency: Urgency
  /** One line: the decision itself. */
  title: string
  /** Why, in plain words, with the numbers that back it. */
  evidence: string[]
  /** Roughly what acting is worth (or protects) over a month, pesewas. Null when it is not a money call. */
  monthlyImpact: number | null
  action: { label: string; to: string }
  /** What to watch out for before acting. */
  caveat?: string
}

const MONTH_DAYS = 30
const WINDOW_DAYS = 28
const perMonth = (amountOverWindow: number) => Math.round((amountOverWindow * MONTH_DAYS) / WINDOW_DAYS)
const ghs = (p: number) => `GHS ${(p / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** "MTN 2GB", "2GB Data", "TELECEL(10GB)" → 2 / 10. Null when the name says no size. */
export function sizeGb(name: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*GB/i.exec(name)
  return match ? Number(match[1]) : null
}

// ── 1. Cheaper provider for the same bundle ──────────────────────────────────

export interface Listing {
  productId: string
  name: string
  network: string | null
  category: string
  provider: string
  active: boolean
  /** What the provider charges now, pesewas. */
  cost: number
  /** Completed sales in the last 28 days. */
  sold: number
}

export interface ProviderReliability {
  provider: string
  network: string | null
  /** Paid orders that reached an outcome in the last 56 days. */
  settled: number
  delivered: number
}

/**
 * The same bundle (network, category, size) is on sale from two providers at
 * once, and customers keep buying the dearer one. Recommends moving that
 * volume to the cheaper provider, but only when the cheaper one delivers at
 * least as reliably on that network (within 2 points, on at least 20 orders).
 */
export function providerSwitch(listings: Listing[], reliability: ProviderReliability[]): Decision | null {
  const rateOf = (provider: string, network: string | null) => {
    const r = reliability.find((x) => x.provider === provider && x.network === network)
    return r && r.settled >= 20 ? r.delivered / r.settled : null
  }
  const moves: { from: Listing; to: Listing; saving: number }[] = []
  for (const from of listings) {
    const size = sizeGb(from.name)
    if (!from.active || from.sold === 0 || size === null) continue
    const cheaper = listings
      .filter(
        (to) =>
          to.active &&
          to.provider !== from.provider &&
          to.network === from.network &&
          to.category === from.category &&
          sizeGb(to.name) === size &&
          to.cost < from.cost,
      )
      .sort((a, b) => a.cost - b.cost)[0]
    if (!cheaper) continue
    const fromRate = rateOf(from.provider, from.network)
    const toRate = rateOf(cheaper.provider, cheaper.network)
    if (fromRate === null || toRate === null || toRate < fromRate - 0.02) continue
    moves.push({ from, to: cheaper, saving: (from.cost - cheaper.cost) * from.sold })
  }
  if (moves.length === 0) return null
  moves.sort((a, b) => b.saving - a.saving)
  const total = moves.reduce((sum, m) => sum + m.saving, 0)
  const label = (p: string) => (p === 'gmpl' ? 'GMPL' : p === 'datahub-gh' ? 'DataHub' : p)
  const top = moves[0]
  const fromRate = rateOf(top.from.provider, top.from.network)!
  const toRate = rateOf(top.to.provider, top.to.network)!
  return {
    id: 'provider_switch',
    kind: 'provider_switch',
    urgency: 'this_week',
    title: `Sell ${moves.length === 1 ? top.from.name : `${moves.length} bundles`} through ${label(top.to.provider)}, it costs less for the same bundle`,
    evidence: [
      ...moves
        .slice(0, 5)
        .map(
          (m) =>
            `${m.from.network ?? ''} ${sizeGb(m.from.name)}GB: ${label(m.from.provider)} charges ${ghs(m.from.cost)}, ` +
            `${label(m.to.provider)} ${ghs(m.to.cost)}. ${m.from.sold} sold through ${label(m.from.provider)} in 4 weeks`,
        ),
      `${label(top.to.provider)} delivered ${(toRate * 100).toFixed(1)}% of ${top.to.network ?? ''} orders, ` +
        `${label(top.from.provider)} ${(fromRate * 100).toFixed(1)}%`,
    ],
    monthlyImpact: perMonth(total),
    action: { label: 'Open prices', to: '/admin/prices' },
    caveat:
      'Take the dearer listing off sale (or point it at the cheaper provider) rather than deleting it, so you can switch back ' +
      'if that provider runs short. Keep both floats topped up either way.',
  }
}

// ── 2. Floats running out ────────────────────────────────────────────────────

export interface FloatState {
  provider: string
  /** Usable balance now, pesewas. Null when never read. */
  balance: number | null
  /** Bundle cost charged to this float per day, last 7 days. */
  dailySpend: number
  /** Paid orders that failed for lack of float, last 28 days, and their sale value. */
  emptyFailures: number
  emptyFailureValue: number
}

/**
 * A float that will run dry within five days at the current pace. Every paid
 * order it cannot fill is a refund, a lost sale and a customer let down, so
 * under two days is "now".
 */
export function floatRunway(floats: FloatState[]): Decision[] {
  const label = (p: string) => (p === 'gmpl' ? 'GMPL' : p === 'datahub-gh' ? 'DataHub' : p)
  return floats
    .filter((f) => f.balance !== null && f.dailySpend > 0)
    .map((f) => ({ ...f, days: (f.balance as number) / f.dailySpend }))
    .filter((f) => f.days < 5)
    .sort((a, b) => a.days - b.days)
    .map((f) => {
      const twoWeeks = Math.max(0, Math.ceil((f.dailySpend * 14 - (f.balance as number)) / 100) * 100)
      return {
        id: `float_runway:${f.provider}`,
        kind: 'float_runway' as const,
        urgency: f.days < 2 ? ('now' as const) : ('this_week' as const),
        title: `Refill the ${label(f.provider)} float: about ${f.days < 1 ? 'less than a day' : `${Math.floor(f.days)} day${Math.floor(f.days) === 1 ? '' : 's'}`} left`,
        evidence: [
          `${ghs(f.balance as number)} left, and bundles cost about ${ghs(f.dailySpend)} a day from it (last 7 days)`,
          `${ghs(twoWeeks)} more covers the next two weeks`,
          ...(f.emptyFailures > 0
            ? [`It has already run dry ${f.emptyFailures} time${f.emptyFailures === 1 ? '' : 's'} in 4 weeks: ${ghs(f.emptyFailureValue)} of paid orders failed and had to be refunded`]
            : []),
        ],
        // Not a gain, a loss avoided: ranked by urgency, not by cedis.
        monthlyImpact: null,
        action: { label: 'Refill from the Paystack balance', to: '/admin/treasury' },
      }
    })
}

// ── 3. Agents slipping ───────────────────────────────────────────────────────

export interface AgentActivity {
  userId: string
  name: string
  phone: string
  /** Completed sales, 28 days before the last 28. */
  prior: number
  /** Completed sales, last 28 days. */
  recent: number
  /** Your average profit per order from this agent's sales, pesewas. */
  profitPerOrder: number
  lastSaleAt: Date | null
}

/**
 * Agents who were selling and have more than halved. A call costs nothing and
 * a lapsed agent rarely comes back on their own. Only agents with at least
 * five sales before, so one quiet week from a casual seller is not a signal.
 */
export function agentsSlipping(agents: AgentActivity[], now: Date): Decision | null {
  const slipping = agents
    .filter((a) => a.prior >= 5 && a.recent <= a.prior / 2)
    .map((a) => ({ ...a, lost: (a.prior - a.recent) * a.profitPerOrder }))
    .sort((a, b) => b.lost - a.lost)
  if (slipping.length === 0) return null
  const days = (d: Date | null) => (d ? Math.floor((now.getTime() - d.getTime()) / 86_400_000) : null)
  const lostSales = slipping.reduce((sum, a) => sum + (a.prior - a.recent), 0)
  return {
    id: 'agents_slipping',
    kind: 'agents_slipping',
    urgency: 'this_week',
    title: `Call ${slipping.length} agent${slipping.length === 1 ? '' : 's'} whose sales have dropped`,
    evidence: [
      ...slipping.slice(0, 6).map((a) => {
        const quiet = days(a.lastSaleAt)
        return `${a.name} (${a.phone}): ${a.prior} → ${a.recent} sales${quiet !== null && quiet >= 7 ? `, nothing for ${quiet} days` : ''}`
      }),
      `Together that is ${lostSales} fewer sales than the 4 weeks before`,
    ],
    monthlyImpact: perMonth(slipping.reduce((sum, a) => sum + a.lost, 0)),
    action: { label: 'Open agents', to: '/admin/users' },
    caveat: 'Ask what changed: a cheaper competitor, a delivery that went wrong, or simply no reminder. Each answer is a different fix.',
  }
}

// ── 4. Bundles that barely pay ───────────────────────────────────────────────

export interface ProductMargin {
  productId: string
  name: string
  network: string | null
  provider: string
  sold: number
  /** Average price customers paid, pesewas. */
  avgSale: number
  /** Average profit you kept per sale after every cost, pesewas. */
  avgProfit: number
  /** What the provider charges now, pesewas. */
  cost: number
}

/** Under this share of the sale price, a bundle is not worth the float it ties up. */
export const THIN_MARGIN = 0.09
const TARGET_MARGIN = 0.12

/**
 * Bundles that sell but keep less than 9% of their price after every cost.
 * Suggests the price that would keep 12%, and what that is worth at the same
 * volume. The simulator on the page lets the owner try other prices.
 */
export function thinMargins(products: ProductMargin[]): Decision | null {
  const thin = products
    .filter((p) => p.sold >= 3 && p.avgSale > 0 && p.avgProfit / p.avgSale < THIN_MARGIN)
    .map((p) => {
      const raise = Math.max(0, Math.ceil((p.avgSale * TARGET_MARGIN - p.avgProfit) / 10) * 10)
      return { ...p, raise, gain: raise * p.sold }
    })
    .filter((p) => p.raise > 0)
    .sort((a, b) => b.gain - a.gain)
  if (thin.length === 0) return null
  return {
    id: 'thin_margin',
    kind: 'thin_margin',
    urgency: 'when_you_can',
    title: `${thin.length} bundle${thin.length === 1 ? '' : 's'} keep${thin.length === 1 ? 's' : ''} under ${THIN_MARGIN * 100}% of the price`,
    evidence: thin
      .slice(0, 5)
      .map(
        (p) =>
          `${p.name}: you keep ${ghs(p.avgProfit)} of ${ghs(p.avgSale)} (${((p.avgProfit / p.avgSale) * 100).toFixed(1)}%), ` +
          `${p.sold} sold. +${ghs(p.raise)} would keep ${TARGET_MARGIN * 100}%`,
      ),
    monthlyImpact: perMonth(thin.reduce((sum, p) => sum + p.gain, 0)),
    action: { label: 'Open prices', to: '/admin/prices' },
    caveat:
      'Assumes the same number still sell. Try the simulator below: a big bundle that customers compare on price may sell less, ' +
      'and that can still be worth it if what is left pays properly.',
  }
}

// ── 5. What failed orders are costing ────────────────────────────────────────

export interface FailureReason {
  reason: string
  orders: number
  /** What it cost you: Paystack fees kept, refund fees, provider charges not given back. */
  cost: number
  /** What customers had paid for these orders. */
  value: number
}

/** The single most expensive reason paid orders fail, once failures cost something real. */
export function failureCost(reasons: FailureReason[]): Decision | null {
  const total = reasons.reduce((sum, r) => sum + r.cost, 0)
  const orders = reasons.reduce((sum, r) => sum + r.orders, 0)
  if (orders < 3) return null
  const top = [...reasons].sort((a, b) => b.orders - a.orders || b.cost - a.cost)[0]
  const fix: Record<string, string> = {
    'Insufficient balance': 'the float ran dry',
    'Duplicate order detected': 'the same number ordered twice in a row and the provider refused the second',
    'No reply from the provider': 'the provider never confirmed them',
  }
  const matched = Object.keys(fix).find((k) => top.reason.toLowerCase().includes(k.toLowerCase()))
  const why = matched ? fix[matched] : /beneficiary|approv/i.test(top.reason) ? 'numbers not yet approved by the provider' : top.reason
  return {
    id: 'failure_cost',
    kind: 'failure_cost',
    urgency: 'when_you_can',
    title: `${orders} paid orders failed in 4 weeks, most often because ${why}`,
    evidence: [
      ...[...reasons]
        .sort((a, b) => b.orders - a.orders || b.cost - a.cost)
        .slice(0, 4)
        .map((r) => `${r.reason}: ${r.orders} order${r.orders === 1 ? '' : 's'}, ${ghs(r.value)} refunded or owed`),
      `Fees and charges you did not get back: ${ghs(total)}`,
    ],
    monthlyImpact: perMonth(total),
    action: { label: 'Open needs attention', to: '/admin/needs-attention' },
  }
}

// ── 6. Cash you can safely take ──────────────────────────────────────────────

export interface CashState {
  /** Free to spend, as Finance shows it. */
  freeToSpend: number
  /** Worst case on orders still in flight, see `inFlightBookedCost`. */
  inFlightWorstCase: number
  /** Combined daily float spend, for a one-week buffer. */
  dailyFloatSpend: number
}

/**
 * How much could come out of Paystack today and still leave a week of float
 * refills in hand. Negative free cash is a warning, not an opportunity.
 */
export function cashAvailable(cash: CashState): Decision | null {
  const buffer = Math.round(cash.dailyFloatSpend * 7)
  const safe = cash.freeToSpend - cash.inFlightWorstCase - buffer
  if (cash.freeToSpend < 0) {
    return {
      id: 'cash_available',
      kind: 'cash_available',
      urgency: 'now',
      title: `You owe more than Paystack should hold, by ${ghs(-cash.freeToSpend)}`,
      evidence: [
        'Free to spend is below zero: agents, customers and pending orders are owed more than the cash on hand',
        'Do not take money out, and top up before approving payouts',
      ],
      monthlyImpact: null,
      action: { label: 'Open Finance', to: '/admin/finance' },
    }
  }
  if (safe < 5_000) return null
  const rounded = Math.floor(safe / 1_000) * 1_000
  return {
    id: 'cash_available',
    kind: 'cash_available',
    urgency: 'when_you_can',
    title: `You can safely take out up to ${ghs(rounded)}`,
    evidence: [
      `Free to spend is ${ghs(cash.freeToSpend)}`,
      `Less ${ghs(cash.inFlightWorstCase)} held in case orders still being delivered fail`,
      `Less ${ghs(buffer)} kept back for a week of float refills`,
    ],
    monthlyImpact: null,
    action: { label: 'Open the Paystack balance', to: '/admin/treasury' },
  }
}

// ── Ranking ──────────────────────────────────────────────────────────────────

const URGENCY_ORDER: Record<Urgency, number> = { now: 0, this_week: 1, when_you_can: 2 }

/**
 * Most urgent first; within that, a float about to run dry first (every
 * other decision assumes orders can still be filled), then the most money.
 */
export function rank(decisions: (Decision | null)[]): Decision[] {
  const weight = (d: Decision) => (d.kind === 'float_runway' ? Number.POSITIVE_INFINITY : (d.monthlyImpact ?? 0))
  return decisions
    .filter((d): d is Decision => d !== null)
    .sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || weight(b) - weight(a))
}

// ── The pulse: how the business is moving ───────────────────────────────────

export interface WeekSales {
  /** Monday, ISO date. */
  week: string
  sales: number
  profit: number
  ownShop: number
  agents: number
  activeAgents: number
}

/**
 * Last full week against the average of the four before it. A single headline
 * the owner reads first, so the decisions below have their context.
 */
export function pulse(weeks: WeekSales[]) {
  if (weeks.length < 2) return null
  const last = weeks[weeks.length - 1]
  const before = weeks.slice(-5, -1)
  const avg = (pick: (w: WeekSales) => number) => before.reduce((s, w) => s + pick(w), 0) / before.length
  const change = (now: number, then: number) => (then > 0 ? (now - then) / then : null)
  return {
    week: last.week,
    sales: last.sales,
    salesChange: change(last.sales, avg((w) => w.sales)),
    profit: last.profit,
    profitChange: change(last.profit, avg((w) => w.profit)),
    agentsChange: change(last.agents, avg((w) => w.agents)),
    ownShopChange: change(last.ownShop, avg((w) => w.ownShop)),
    activeAgents: last.activeAgents,
    activeAgentsBefore: Math.round(avg((w) => w.activeAgents)),
  }
}
