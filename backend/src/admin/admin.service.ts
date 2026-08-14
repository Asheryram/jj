import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { toProduct } from '../common/mappers'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'
import type { OrderSplit } from '../domain/pricing'
import type { Role } from '@prisma/client'

export type Tier = 'supplierCost' | 'adminPrice' | 'standardPrice' | 'maxRetailPrice'

@Injectable()
export class AdminService {
  private readonly log = new Logger(AdminService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
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

    if (row.role === 'admin') {
      // Locking the only admin out of the platform is not an undoable mistake
      // from inside the platform.
      throw new ConflictError('CANNOT_SUSPEND_ADMIN', 'An admin account cannot be suspended here.')
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

    if (next.adminPrice < next.supplierCost) {
      throw new ValidationError(
        `You pay ${ghs(next.supplierCost)} for this, so the agent price cannot be below that.`,
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
        `You pay ${ghs(next.supplierCost)} for this, so you cannot sell it for less than that.`,
      )
    }

    // The cap governs the resale chain, so it has to clear what agents pay —
    // otherwise there is no legal price at which any agent could sell.
    if (next.maxRetailPrice < next.adminPrice) {
      throw new ValidationError(
        `The retail cap cannot be below the ${ghs(next.adminPrice)} your agents pay — none of them would be able to sell.`,
      )
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { [tier]: value },
    })

    this.log.log(`tier ${tier} on ${productId} → ${value}p`)
    return toProduct(updated)
  }

  async setProductActive(productId: string, active: boolean) {
    const updated = await this.prisma.product
      .update({ where: { id: productId }, data: { active } })
      .catch(() => {
        throw new NotFoundError('We could not find that product.')
      })
    return toProduct(updated)
  }

  // ── Supplier catalogue (the DataHub GH stand-in) ───────────────────────────

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
    }))
  }

  /**
   * Mark a provider SKU in or out of stock.
   *
   * This is the lever that makes the FR-2.7 failure path reproducible during
   * acceptance testing: switch a bundle off, buy it, and watch the refund land.
   */
  async setSupplierAvailability(code: string, available: boolean) {
    const updated = await this.prisma.supplierProduct
      .update({ where: { code }, data: { available } })
      .catch(() => {
        throw new NotFoundError('We could not find that provider SKU.')
      })

    this.log.warn(`supplier ${code} availability → ${available}`)
    return { code: updated.code, available: updated.available }
  }

  /**
   * Record a new cost price from the provider.
   *
   * Stands in for the DataHub GH price-list call while there are no keys: James
   * types what they actually charge him, here, on the provider's own record —
   * then it flows down to every product mapped to that SKU. The distinction
   * matters because `supplier_cost` is the baseline every margin is measured
   * from, so it has to trace back to a real invoice rather than a guess typed
   * into a pricing screen.
   */
  async setSupplierCost(code: string, costPrice: number) {
    if (!Number.isInteger(costPrice) || costPrice <= 0) {
      throw new ValidationError('Enter what the provider charges you, like 5.50.')
    }

    const supplier = await this.prisma.supplierProduct.findUnique({ where: { code } })
    if (!supplier) throw new NotFoundError('We could not find that provider SKU.')

    await this.prisma.supplierProduct.update({ where: { code }, data: { costPrice } })

    // Push it straight through, so the catalogue is never knowingly stale.
    const { updated } = await this.syncSupplierCosts()

    this.log.log(`supplier ${code} cost → ${costPrice}p, ${updated} product(s) resynced`)
    return { code, costPrice, productsUpdated: updated }
  }

  /**
   * Pull the provider's cost into our catalogue.
   *
   * Live, this is where the DataHub GH price-list call would land. Here it copies
   * `supplier_products.cost_price` onto the products mapped to it, then lifts any
   * tier that the new cost has overtaken so the ordering constraint still holds.
   */
  async syncSupplierCosts() {
    const suppliers = await this.prisma.supplierProduct.findMany({
      include: { products: true },
    })

    let changed = 0

    for (const supplier of suppliers) {
      for (const product of supplier.products) {
        if (product.supplierCost === supplier.costPrice) continue

        const cost = supplier.costPrice
        // Raising a cost above a selling price would make the row illegal and the
        // sale loss-making. Push each tier up only as far as its own rule needs:
        // the two selling prices clear cost independently, and the cap clears the
        // agent price. Notably `standardPrice` is NOT lifted to `adminPrice` —
        // James is allowed to retail below what he charges agents.
        const adminPrice = Math.max(product.adminPrice, cost)
        await this.prisma.product.update({
          where: { id: product.id },
          data: {
            supplierCost: cost,
            adminPrice,
            standardPrice: Math.max(product.standardPrice, cost),
            maxRetailPrice: Math.max(product.maxRetailPrice, adminPrice),
          },
        })
        changed++
      }
    }

    this.log.log(`supplier cost sync updated ${changed} product(s)`)
    return { updated: changed }
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  settingsAll() {
    return this.settings.all()
  }

  setSetting(
    key: 'referralEnabled' | 'referralRatePercent' | 'simulateFailure' | 'registrationOpen',
    value: boolean | number,
  ) {
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

    return {
      windowDays: 30,
      orders,
      revenue,
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
