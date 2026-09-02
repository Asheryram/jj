import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { PlatformSettings } from '../settings/settings.service'
import { SettingsService } from '../settings/settings.service'
import { toProduct, PRODUCT_INCLUDE } from '../common/mappers'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'
import { markupFromPrice, priceFromMarkup, type OrderSplit } from '../domain/pricing'
import { CatalogueImportService } from '../supplier/catalogue-import.service'
import type { Category, Role } from '@prisma/client'

export type Tier = 'supplierCost' | 'adminPrice' | 'standardPrice'

@Injectable()
export class AdminService {
  private readonly log = new Logger(AdminService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly catalogueImport: CatalogueImportService,
  ) {}

  // ── Users (FR-6.4) ────────────────────────────────────────────────────────

  async users() {
    const rows = await this.prisma.user.findMany({ orderBy: { joinedAt: 'asc' } })

    // Order counts from the orders table, not a stored counter that can drift.
    const counts = await this.prisma.order.groupBy({
      by: ['soldByCode'],
      where: { status: 'completed' },
      _count: { _all: true },
    })
    const soldByCode = new Map(counts.map((c) => [c.soldByCode, c._count._all]))

    const boughtCounts = await this.prisma.order.groupBy({
      by: ['buyerUserId'],
      where: { buyerUserId: { not: null } },
      _count: { _all: true },
    })
    const boughtBy = new Map(boughtCounts.map((c) => [c.buyerUserId, c._count._all]))

    const byCode = new Map(rows.map((r) => [r.referralCode, r.name]))

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      role: row.role,
      status: row.status,
      balance: row.balance,
      orders:
        row.role === 'agent' ? (soldByCode.get(row.referralCode) ?? 0) : (boughtBy.get(row.id) ?? 0),
      referredBy: row.uplineCode ? (byCode.get(row.uplineCode) ?? null) : null,
      joinedAt: row.joinedAt.toISOString(),
    }))
  }

  /** FR-6.4 — suspend or restore an account. */
  async toggleUserStatus(id: string) {
    const row = await this.prisma.user.findUnique({ where: { id } })
    if (!row) throw new NotFoundError('We could not find that user.')

    /**
     * Neither an admin nor the superadmin can be suspended from this screen.
     *
     * Locking the only admin out of the platform is not an undoable mistake from
     * inside the platform. The superadmin matters more: this endpoint is open to
     * any admin, so checking only for `admin` let an admin suspend the person who
     * runs the platform — and the account that can restore roles is the one being
     * disabled. Hiding the button was never enough, because the request does not
     * need the button.
     */
    if (row.role === 'admin' || row.role === 'superadmin') {
      throw new ConflictError(
        'CANNOT_SUSPEND_ADMIN',
        row.role === 'superadmin'
          ? 'The platform owner cannot be suspended.'
          : 'An admin account cannot be suspended here.',
      )
    }

    /**
     * An undecided application cannot be activated from here.
     *
     * This endpoint only flips between active and suspended. Applied to a
     * `pending` agent it would set them active while skipping everything
     * `ApplicationsService.approve` does — `decidedBy`, `decidedAt`, and the
     * email telling them they may start selling. An agent who is not told they
     * are approved does not start selling, so the approval would achieve nothing
     * and nobody would know who granted it.
     */
    if (row.status === 'pending' || row.status === 'rejected') {
      throw new ConflictError(
        'NOT_DECIDED',
        'That application has not been decided. Approve or reject it under Agent applications.',
      )
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: row.status === 'active' ? 'suspended' : 'active' },
    })

    return { id: updated.id, status: updated.status }
  }

  // ── Price tiers (FR-6.1) ──────────────────────────────────────────────────

  /**
   * Edit one tier. The ordering rule (supplier ≤ admin ≤ standard ≤ cap) is
   * checked here with a readable message; `products_tiers_ordered` in the
   * database is the backstop if anything reaches it another way.
   *
   * Past orders keep the prices they were sold at, because every order carries
   * its own split snapshot rather than a reference to the current tier.
   */
  async setTier(productId: string, tier: Tier, value: number) {
    if (!Number.isInteger(value) || value < 0) {
      throw new ValidationError('Enter a price like 7.50.')
    }

    // What James pays is the provider's number, not his own. It lives in
    // `supplier_products` and is copied down by `syncSupplierCosts`. Letting it
    // be typed here would put our idea of the cost out of step with the invoice
    // we actually get — and every margin on every screen is measured from it.
    if (tier === 'supplierCost') {
      throw new ValidationError(
        'What you pay comes from the provider, not from here. Change it on the provider catalogue and sync.',
      )
    }

    const row = await this.prisma.product.findUnique({ where: { id: productId } })
    if (!row) throw new NotFoundError('We could not find that product.')

    const next = { ...row, [tier]: value }

    const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`

    // Paystack's cut no longer comes out of this price — it is added on top as
    // its own line at checkout (see `checkoutTotal`) — so the only thing to
    // guard against here is selling below what the bundle actually costs.
    if (next.adminPrice < next.supplierCost) {
      throw new ValidationError(
        `The agent price is below the ${ghs(next.supplierCost)} you pay for this. Raise it a little.`,
      )
    }

    /**
     * The walk-up price is only floored at cost.
     *
     * It is deliberately NOT required to sit above the agent price. James sells
     * directly as well as wholesale, and where he puts his own retail price
     * relative to what he charges agents is a commercial decision per product:
     * below it, and he is happy to earn more from agent volume than from his own
     * counter; level with it, and he is indifferent to which channel a sale comes
     * through. Forcing retail above wholesale would take that choice away.
     */
    if (next.standardPrice < next.supplierCost) {
      throw new ValidationError(
        `This is below the ${ghs(next.supplierCost)} you pay for it. Raise it a little.`,
      )
    }


    // Re-derive the markup from the price just typed. The price is what James
    // decided; the markup records the intent behind it, so the next time a
    // supplier's cost moves this price moves with it rather than being flattened
    // up to meet the new cost.
    const markupField = tier === 'adminPrice' ? 'agentMarkupBp' : 'walkupMarkupBp'

    /**
     * Pricing something by hand puts it on sale, exactly as the bulk markup does.
     *
     * `applyMarkup` already holds that anything being priced is by definition
     * ready to sell. This did not, so a freshly imported bundle priced one
     * product at a time stayed invisible to customers, and the only way to
     * publish it was to run the bulk tool — which is not obvious from anywhere on
     * the screen.
     *
     * Both selling prices have to clear cost first. Activating while one of them
     * still sits at cost would quietly list a bundle that earns nothing on that
     * channel, which is the thing the import is careful not to do.
     */
    const bothPricesClearCost =
      next.adminPrice > next.supplierCost && next.standardPrice > next.supplierCost

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        [tier]: value,
        [markupField]: markupFromPrice(row.supplierCost, value),
        ...(!row.active && bothPricesClearCost ? { active: true } : {}),
      },
      include: PRODUCT_INCLUDE,
    })

    if (!row.active && bothPricesClearCost) {
      this.log.log(`${productId} is now on sale — both prices clear cost`)
    }

    this.log.log(`tier ${tier} on ${productId} → ${value}p (markup ${updated[markupField]}bp)`)
    return toProduct(updated)
  }

  async setProductActive(productId: string, active: boolean) {
    const row = await this.prisma.product.findUnique({ where: { id: productId } })
    if (!row) throw new NotFoundError('We could not find that product.')

    /**
     * A product still priced at cost cannot be put on sale.
     *
     * Every other route to publishing refuses this — the import leaves new SKUs
     * inactive rather than sell them at cost, and `setTier` only activates once
     * both prices clear it. Without the same check here, this toggle would be the
     * one way to list a bundle that earns nothing, and nobody would notice until
     * the margin report came out flat.
     */
    if (active) {
      const flat: string[] = []
      if (row.adminPrice <= row.supplierCost) flat.push('the agent price')
      if (row.standardPrice <= row.supplierCost) flat.push('the walk-up price')
      if (flat.length > 0) {
        throw new ValidationError(
          `${flat.join(' and ')} ${flat.length === 1 ? 'is' : 'are'} at or below what you pay for ` +
            'this, so selling it would earn nothing or lose money. Set a price that clears cost first.',
        )
      }
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { active },
      include: PRODUCT_INCLUDE,
    })
    this.log.log(`${productId} is ${active ? 'on sale' : 'off sale'}`)
    return toProduct(updated)
  }

  // ── Supplier catalogue, imported from the suppliers themselves ─────────────

  async supplierCatalogue() {
    const rows = await this.prisma.supplierProduct.findMany({
      orderBy: [{ category: 'asc' }, { costPrice: 'asc' }],
      include: { products: { select: { id: true, name: true } } },
    })

    return rows.map((row) => ({
      code: row.code,
      provider: row.provider,
      category: row.category,
      network: row.network,
      name: row.name,
      validity: row.validity,
      costPrice: row.costPrice,
      available: row.available,
      updatedAt: row.updatedAt.toISOString(),
      mappedTo: row.products.map((p) => p.id),
      networkKey: row.networkKey,
      capacityGb: row.capacityGb,
      /** Whether the supplier can actually deliver this without a human. */
      autoFulfillable: Boolean(row.networkKey && row.capacityGb),
    }))
  }

  /**
   * Re-read every configured supplier and make our catalogue match.
   *
   * There is nothing beside this — no hand-typed cost, no hand-set stock flag.
   * Both used to exist here, and both were ways for the platform to state
   * something the supplier had not: a cost that could drift from the invoice
   * every margin is measured against, and an in-stock badge that could claim a
   * SKU was available after the supplier had withdrawn it.
   */
  async syncFromProvider() {
    const imported = await this.catalogueImport.importFromProvider()
    // Costs may have moved under products the import did not itself touch, so
    // run the downward pass afterwards.
    const { updated } = await this.syncSupplierCosts()
    return { ...imported, productsUpdated: updated }
  }

  /**
   * Put products on sale at a markup over supplier cost, and remember the markup.
   *
   * Remembering it is the point. The import deliberately leaves a new SKU
   * inactive and priced at cost, because what it sells for is James's decision —
   * but that is dozens of products to price by hand after a single sync, and a
   * price with no recorded intent behind it cannot survive a cost change.
   */
  async applyMarkup(input: {
    agentPercent: number
    walkupPercent: number
    scope: 'unpriced' | 'all'
    category?: Category
  }) {
    const { agentPercent, walkupPercent, scope, category } = input

    const targets = await this.prisma.product.findMany({
      where: {
        supplier: { available: true },
        ...(category ? { category } : {}),
        // 'unpriced' is the state a freshly imported SKU is in: it exists, its
        // cost is real, and nobody has said what it sells for. 'all' is the
        // deliberate re-pricing of a whole category.
        ...(scope === 'unpriced' ? { active: false } : {}),
      },
      select: { id: true, supplierCost: true },
    })

    if (targets.length === 0) return { updated: 0 }

    const agentBp = Math.round(agentPercent * 100)
    const walkupBp = Math.round(walkupPercent * 100)

    await this.prisma.$transaction(
      targets.map((product) =>
        this.prisma.product.update({
          where: { id: product.id },
          data: {
            agentMarkupBp: agentBp,
            walkupMarkupBp: walkupBp,
            adminPrice: priceFromMarkup(product.supplierCost, agentBp),
            standardPrice: priceFromMarkup(product.supplierCost, walkupBp),
            // Anything being priced is by definition ready to sell.
            active: true,
          },
        }),
      ),
    )

    this.log.log(
      `markup ${scope}${category ? ` (${category})` : ''}: ${targets.length} product(s) at ` +
        `+${agentPercent}% agent / +${walkupPercent}% walk-up`,
    )
    return { updated: targets.length }
  }

  /**
   * Push each supplier cost down onto the products priced from it.
   *
   * Both selling prices are re-derived from the markup James set, so a cost
   * change moves them and leaves his margin intact.
   */
  async syncSupplierCosts() {
    const suppliers = await this.prisma.supplierProduct.findMany({
      include: { products: true },
    })

    const toUpdate = suppliers.flatMap((supplier) =>
      supplier.products
        .filter((product) => product.supplierCost !== supplier.costPrice)
        .map((product) => ({ product, cost: supplier.costPrice })),
    )

    if (toUpdate.length === 0) return { updated: 0 }

    /**
     * One transaction for the whole sync, not one `update` per product.
     *
     * A thrown error partway through an update-in-loop left some products
     * re-priced to the new cost and others stranded on the old one — a
     * silently half-applied catalogue, with margins computed against two
     * different cost bases until the next sync happened to finish the job.
     * `applyMarkup` already batches its own updates in one transaction; this
     * never matched it.
     */
    await this.prisma.$transaction(
      toUpdate.map(({ product, cost }) =>
        this.prisma.product.update({
          where: { id: product.id },
          data: {
            supplierCost: cost,
            // This was `max(price, cost)`, which only guaranteed the sale was not
            // loss-making: a cost rise past the price pinned the two together and the
            // margin became exactly zero, on every affected product, with nothing on
            // any screen to say so. Deriving from the markup keeps the margin.
            //
            // `standardPrice` is still not lifted to meet `adminPrice` — James is
            // allowed to retail below what he charges agents.
            adminPrice: priceFromMarkup(cost, product.agentMarkupBp),
            standardPrice: priceFromMarkup(cost, product.walkupMarkupBp),
          },
        }),
      ),
    )

    this.log.log(`supplier cost sync updated ${toUpdate.length} product(s)`)
    return { updated: toUpdate.length }
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  settingsAll() {
    return this.settings.all()
  }

  /** Keyed off PlatformSettings, so a new setting needs no change here. */
  setSetting(key: keyof PlatformSettings, value: boolean | number) {
    return this.settings.set(key, value)
  }

  // ── Reports (FR-8.1, FR-8.2) ──────────────────────────────────────────────

  /**
   * Platform turnover per day for the last `days` days.
   *
   * Computed from completed orders — a failed order was refunded and is not
   * revenue. Days with no sales are filled in as zero so the chart has an even
   * x-axis instead of silently compressing quiet days together.
   */
  async revenueByDay(days = 7) {
    const since = startOfDayUtc(new Date(), days - 1)

    const rows = await this.prisma.order.findMany({
      where: { status: 'completed', createdAt: { gte: since } },
      select: { createdAt: true, salePrice: true, split: true },
    })

    const buckets = emptyDayBuckets(days)

    for (const row of rows) {
      const key = row.createdAt.toISOString().slice(0, 10)
      const bucket = buckets.get(key)
      if (!bucket) continue
      bucket.revenue += row.salePrice
      bucket.orders += 1
      bucket.platformMargin += adminMarginOf(row.split as unknown as OrderSplit)
    }

    return [...buckets.entries()].map(([day, value]) => ({
      day: labelFor(day),
      date: day,
      revenue: value.revenue,
      orders: value.orders,
      /** What James actually kept, as opposed to what passed through. */
      platformMargin: value.platformMargin,
    }))
  }

  /** One agent's own earnings per day, split between their sales and downline. */
  async agentEarningsByDay(userId: string, days = 7) {
    const since = startOfDayUtc(new Date(), days - 1)

    const rows = await this.prisma.earning.findMany({
      where: {
        userId,
        type: { in: ['sale', 'downline'] },
        createdAt: { gte: since },
      },
      select: { createdAt: true, amount: true, depth: true },
    })

    const buckets = emptyDayBuckets(days)

    for (const row of rows) {
      const bucket = buckets.get(row.createdAt.toISOString().slice(0, 10))
      if (!bucket) continue
      bucket.revenue += row.amount
      if (row.depth === 0) bucket.own += row.amount
      else bucket.downline += row.amount
    }

    return [...buckets.entries()].map(([day, value]) => ({
      day: labelFor(day),
      date: day,
      revenue: value.revenue,
      own: value.own,
      downline: value.downline,
    }))
  }

  /**
   * The signed-in user's own headline numbers, for their dashboard.
   *
   * Computed with aggregate queries rather than derived in the browser from the
   * orders list. That list is capped (a busy agent has thousands of orders), so
   * anything summed from it silently undercounts the moment the cap is hit —
   * which is the sort of wrong-but-plausible number that survives a demo and
   * fails an audit.
   *
   * "Today" is a UTC day boundary. Ghana is UTC+0 year round, so that is the
   * local day, not an approximation of it.
   */
  async mySummary(user: { id: string; role: Role; referralCode: string; phone: string }) {
    const startOfToday = startOfDayUtc(new Date(), 0)

    if (user.role === 'agent') {
      const codes = await this.downlineCodes(user.referralCode)

      const [today, allTime, completed, total, activeDownline] = await Promise.all([
        this.prisma.earning.aggregate({
          where: { userId: user.id, type: { in: ['sale', 'downline'] }, createdAt: { gte: startOfToday } },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.earning.aggregate({
          where: { userId: user.id, type: { in: ['sale', 'downline'] } },
          _sum: { amount: true },
        }),
        this.prisma.order.count({ where: { soldByCode: { in: codes }, status: 'completed' } }),
        this.prisma.order.count({ where: { soldByCode: { in: codes } } }),
        this.prisma.user.count({
          where: { uplineCode: user.referralCode, role: 'agent', status: 'active' },
        }),
      ])

      // Reversals are netted off separately so a refunded sale does not linger
      // in "earned" after the money has gone back.
      const reversedToday = await this.prisma.earning.aggregate({
        where: { userId: user.id, type: 'reversal', createdAt: { gte: startOfToday } },
        _sum: { amount: true },
      })
      const reversedAllTime = await this.prisma.earning.aggregate({
        where: { userId: user.id, type: 'reversal' },
        _sum: { amount: true },
      })

      return {
        role: user.role,
        earnedToday: (today._sum.amount ?? 0) + (reversedToday._sum.amount ?? 0),
        earnedAllTime: (allTime._sum.amount ?? 0) + (reversedAllTime._sum.amount ?? 0),
        ordersToday: today._count._all,
        ordersCompleted: completed,
        ordersTotal: total,
        activeSubAgents: activeDownline,
      }
    }

    // A customer's own purchases, including any made as a guest on the number
    // they later registered with.
    const mine = { OR: [{ buyerUserId: user.id }, { buyerPhone: user.phone }] }

    const [today, allTime, completed, total] = await Promise.all([
      this.prisma.order.aggregate({
        where: { ...mine, createdAt: { gte: startOfToday }, status: { not: 'failed' } },
        _sum: { salePrice: true },
        _count: { _all: true },
      }),
      this.prisma.order.aggregate({
        where: { ...mine, status: 'completed' },
        _sum: { salePrice: true },
      }),
      this.prisma.order.count({ where: { ...mine, status: 'completed' } }),
      this.prisma.order.count({ where: mine }),
    ])

    return {
      role: user.role,
      spentToday: today._sum.salePrice ?? 0,
      spentAllTime: allTime._sum.salePrice ?? 0,
      ordersToday: today._count._all,
      ordersCompleted: completed,
      ordersTotal: total,
      activeSubAgents: 0,
    }
  }

  /** The agent's own code plus every code beneath it. Mirrors OrdersService. */
  private async downlineCodes(rootCode: string): Promise<string[]> {
    const codes = new Set<string>([rootCode])
    let frontier = [rootCode]

    for (let depth = 0; depth < 10 && frontier.length > 0; depth++) {
      const children = await this.prisma.user.findMany({
        where: { uplineCode: { in: frontier }, role: 'agent' },
        select: { referralCode: true },
      })
      frontier = children.map((c) => c.referralCode).filter((c) => !codes.has(c))
      frontier.forEach((c) => codes.add(c))
    }

    return [...codes]
  }

  /** Headline numbers for the admin overview. */
  async overview() {
    const since = startOfDayUtc(new Date(), 29)

    const [completed, failed, agents, customers, pendingWithdrawals, credits] = await Promise.all([
      this.prisma.order.aggregate({
        where: { status: 'completed', createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { salePrice: true },
      }),
      this.prisma.order.count({ where: { status: 'failed', createdAt: { gte: since } } }),
      this.prisma.user.count({ where: { role: 'agent', status: 'active' } }),
      this.prisma.user.count({ where: { role: 'customer' } }),
      this.prisma.withdrawal.aggregate({
        where: { status: 'pending' },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.claimableCredit.aggregate({
        where: { claimed: false },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ])

    const orders = completed._count._all
    const revenue = completed._sum.salePrice ?? 0

    /**
     * What the payment processor kept, over the same window.
     *
     * Reported separately because it is a real cost that appears nowhere else:
     * the customer paid `salePrice`, agents are credited their margin in full,
     * and the supplier is paid its cost — so Paystack's cut comes out of what is
     * left, which is James's. A margin figure that ignores it overstates his
     * earnings on every card and Mobile Money sale.
     */
    const fees = await this.prisma.payment.aggregate({
      where: { status: 'paid', paidAt: { gte: since } },
      _sum: { fee: true },
    })

    return {
      windowDays: 30,
      orders,
      revenue,
      /** Pesewas Paystack kept over the window. */
      paymentFees: fees._sum.fee ?? 0,
      failedOrders: failed,
      /** NFR-3.1 — delivery success rate over the window. */
      successRate: orders + failed > 0 ? orders / (orders + failed) : 1,
      averageOrderValue: orders > 0 ? Math.round(revenue / orders) : 0,
      activeAgents: agents,
      customers,
      pendingWithdrawals: {
        count: pendingWithdrawals._count._all,
        amount: pendingWithdrawals._sum.amount ?? 0,
      },
      /** NFR-3.3 — money owed back and not yet claimed. Should trend to zero. */
      unclaimedCredits: {
        count: credits._count._all,
        amount: credits._sum.amount ?? 0,
      },
    }
  }
}

/** James's cut of one order — the admin share of its split. */
function adminMarginOf(split: OrderSplit): number {
  return split.shares?.find((s) => s.role === 'admin')?.margin ?? 0
}

function startOfDayUtc(from: Date, daysBack: number): Date {
  const d = new Date(from)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - daysBack)
  return d
}

interface DayBucket {
  revenue: number
  orders: number
  own: number
  downline: number
  platformMargin: number
}

/** Oldest first, one entry per day, so a quiet day shows as a gap not a skip. */
function emptyDayBuckets(days: number): Map<string, DayBucket> {
  const buckets = new Map<string, DayBucket>()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  for (let offset = days - 1; offset >= 0; offset--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - offset)
    buckets.set(d.toISOString().slice(0, 10), {
      revenue: 0,
      orders: 0,
      own: 0,
      downline: 0,
      platformMargin: 0,
    })
  }

  return buckets
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Tue 12" — matches the axis labels the charts were designed against. */
function labelFor(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`
}
