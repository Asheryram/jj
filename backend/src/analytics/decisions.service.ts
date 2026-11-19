import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SolvencyService } from '../finance/solvency.service'
import { FloatMonitorService } from '../supplier/float-monitor.service'
import { KNOWN_PROVIDERS } from '../settings/settings.service'
import {
  agentsSlipping,
  cashAvailable,
  failureCost,
  floatRunway,
  providerSwitch,
  pulse,
  rank,
  thinMargins,
  type AgentActivity,
  type FailureReason,
  type FloatState,
  type Listing,
  type ProductMargin,
  type ProviderReliability,
  type WeekSales,
} from './decisions'

/**
 * Gathers the inputs for `decisions.ts` straight from the production
 * database, not the analytics warehouse: these are decisions for this week,
 * so they must not wait for the nightly ETL, and the queries are small.
 *
 * Profit per order is the ledger's, every line that affects profit booked
 * against the order or its payment, the same definition as Profit earned.
 */
@Injectable()
export class DecisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly solvency: SolvencyService,
    private readonly floats: FloatMonitorService,
  ) {}

  async decisions() {
    const now = new Date()
    const [listings, reliability, products, agents, floats, failures, position, weeks] = await Promise.all([
      this.listings(),
      this.reliability(),
      this.productMargins(),
      this.agentActivity(),
      this.floatStates(),
      this.failureReasons(),
      this.solvency.position(),
      this.weeks(),
    ])
    const decisions = rank([
      ...floatRunway(floats),
      cashAvailable({
        freeToSpend: position.freeToSpend,
        inFlightWorstCase: position.inFlightBookedCost,
        dailyFloatSpend: floats.reduce((sum, f) => sum + f.dailySpend, 0),
      }),
      providerSwitch(listings, reliability),
      agentsSlipping(agents, now),
      thinMargins(products),
      failureCost(failures),
    ])
    return {
      at: now.toISOString(),
      pulse: pulse(weeks.filter((w) => w.complete)),
      thisWeek: weeks.find((w) => !w.complete) ?? null,
      weeks,
      decisions,
      /** Every bundle sold in the last 4 weeks, for the price simulator. */
      products: products.sort((a, b) => b.sold - a.sold),
    }
  }

  /** Profit kept on one order: every profit line on the order or its payment. */
  private static readonly ORDER_PROFIT = Prisma.sql`
    (SELECT coalesce(sum(l.amount), 0) FROM ledger_entries l
     WHERE l.affects_profit AND (l.order_ref = o.reference OR (l.order_ref IS NULL AND l.payment_ref = o.reference)))`

  private async listings(): Promise<Listing[]> {
    const rows = await this.prisma.$queryRaw<
      { productId: string; name: string; network: string | null; category: string; provider: string; active: boolean; cost: number; sold: bigint }[]
    >`
      SELECT p.id AS "productId", p.name, p.network::text AS network, p.category::text AS category,
             sp.provider, (p.active AND sp.available) AS active, sp.cost_price AS cost,
             (SELECT count(*) FROM orders o WHERE o.product_id = p.id AND o.status = 'completed'
                AND o.created_at >= now() - interval '28 days') AS sold
      FROM products p JOIN supplier_products sp ON sp.code = p.supplier_code`
    return rows.map((r) => ({ ...r, sold: Number(r.sold) }))
  }

  private async reliability(): Promise<ProviderReliability[]> {
    const rows = await this.prisma.$queryRaw<{ provider: string; network: string | null; settled: bigint; delivered: bigint }[]>`
      SELECT sp.provider, o.network::text AS network,
             count(*) FILTER (WHERE o.status IN ('completed', 'failed')) AS settled,
             count(*) FILTER (WHERE o.status = 'completed') AS delivered
      FROM orders o
      JOIN supplier_products sp ON sp.code = o.supplier_code_at_sale
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.created_at >= now() - interval '56 days' AND (o.paid_with = 'wallet' OR p.status = 'paid')
      GROUP BY 1, 2`
    return rows.map((r) => ({ ...r, settled: Number(r.settled), delivered: Number(r.delivered) }))
  }

  private async productMargins(): Promise<ProductMargin[]> {
    const rows = await this.prisma.$queryRaw<
      { productId: string; name: string; network: string | null; provider: string; sold: bigint; avgSale: number; avgProfit: number; cost: number }[]
    >`
      SELECT p.id AS "productId", p.name, p.network::text AS network, coalesce(sp.provider, 'datahub-gh') AS provider,
             count(*) AS sold, round(avg(o.sale_price))::int AS "avgSale",
             round(avg(${DecisionsService.ORDER_PROFIT}))::int AS "avgProfit",
             coalesce(sp.cost_price, p.supplier_cost) AS cost
      FROM orders o
      JOIN products p ON p.id = o.product_id
      LEFT JOIN supplier_products sp ON sp.code = p.supplier_code
      WHERE o.status = 'completed' AND o.created_at >= now() - interval '28 days'
      GROUP BY p.id, p.name, p.network, sp.provider, sp.cost_price, p.supplier_cost`
    return rows.map((r) => ({ ...r, sold: Number(r.sold) }))
  }

  private async agentActivity(): Promise<AgentActivity[]> {
    const rows = await this.prisma.$queryRaw<
      { userId: string; name: string; phone: string; prior: bigint; recent: bigint; profitPerOrder: number | null; lastSaleAt: Date | null }[]
    >`
      SELECT u.id AS "userId", u.name, u.phone,
             count(*) FILTER (WHERE o.created_at < now() - interval '28 days') AS prior,
             count(*) FILTER (WHERE o.created_at >= now() - interval '28 days') AS recent,
             round(avg(${DecisionsService.ORDER_PROFIT}))::int AS "profitPerOrder",
             max(o.created_at) AS "lastSaleAt"
      FROM orders o JOIN users u ON u.referral_code = o.sold_by_code
      WHERE u.role = 'agent' AND u.status = 'active' AND o.status = 'completed'
        AND o.created_at >= now() - interval '56 days'
      GROUP BY u.id, u.name, u.phone`
    return rows.map((r) => ({ ...r, prior: Number(r.prior), recent: Number(r.recent), profitPerOrder: r.profitPerOrder ?? 0 }))
  }

  private async floatStates(): Promise<FloatState[]> {
    return Promise.all(
      KNOWN_PROVIDERS.map(async (provider) => {
        const [latest, spend, empty] = await Promise.all([
          this.floats.latest(provider),
          this.prisma.$queryRaw<{ total: bigint | null }[]>`
            SELECT -sum(amount) AS total FROM ledger_entries
            WHERE kind = 'supplier_cost' AND occurred_at >= now() - interval '7 days'
              AND coalesce(provider, 'datahub-gh') = ${provider}`,
          this.prisma.$queryRaw<{ n: bigint; value: bigint | null }[]>`
            SELECT count(DISTINCT o.id) AS n, sum(o.sale_price) AS value
            FROM orders o JOIN supplier_dispatches d ON d.order_id = o.id
            JOIN supplier_products sp ON sp.code = d.supplier_code
            WHERE o.status = 'failed' AND o.created_at >= now() - interval '28 days'
              AND sp.provider = ${provider} AND d.reason ILIKE '%insufficient%'`,
        ])
        return {
          provider,
          balance: latest ? latest.reference : null,
          dailySpend: Math.round(Number(spend[0]?.total ?? 0) / 7),
          emptyFailures: Number(empty[0]?.n ?? 0),
          emptyFailureValue: Number(empty[0]?.value ?? 0),
        }
      }),
    )
  }

  /**
   * Paid orders that failed in the last 28 days, by the provider's last
   * reason. Cost is what did not come back: Paystack's fee on the sale, the
   * fee for sending the refund, and any provider charge never refunded.
   */
  private async failureReasons(): Promise<FailureReason[]> {
    const rows = await this.prisma.$queryRaw<{ reason: string; orders: bigint; cost: bigint | null; value: bigint | null }[]>`
      SELECT coalesce(d.reason, 'No reply from the provider') AS reason, count(*) AS orders,
             -sum(${DecisionsService.ORDER_PROFIT} - (SELECT coalesce(sum(l.amount), 0) FROM ledger_entries l
                    WHERE l.order_ref = o.reference AND l.kind IN ('revenue', 'refund'))) AS cost,
             sum(o.sale_price) AS value
      FROM orders o
      JOIN payments p ON p.order_id = o.id AND p.status = 'paid'
      LEFT JOIN LATERAL (SELECT reason FROM supplier_dispatches x WHERE x.order_id = o.id ORDER BY x.created_at DESC LIMIT 1) d ON true
      WHERE o.status = 'failed' AND o.created_at >= now() - interval '28 days'
      GROUP BY 1`
    return rows.map((r) => ({
      reason: r.reason,
      orders: Number(r.orders),
      cost: Math.max(0, Number(r.cost ?? 0)),
      value: Number(r.value ?? 0),
    }))
  }

  /** The last nine weeks, Monday to Sunday, the current one marked incomplete. */
  private async weeks(): Promise<(WeekSales & { complete: boolean })[]> {
    const rows = await this.prisma.$queryRaw<
      { week: Date; sales: bigint | null; profit: bigint | null; ownShop: bigint | null; agents: bigint | null; activeAgents: bigint }[]
    >`
      SELECT date_trunc('week', o.created_at) AS week,
             sum(o.sale_price) AS sales,
             sum(${DecisionsService.ORDER_PROFIT}) AS profit,
             sum(o.sale_price) FILTER (WHERE u.id IS NULL OR u.role <> 'agent') AS "ownShop",
             sum(o.sale_price) FILTER (WHERE u.role = 'agent') AS agents,
             count(DISTINCT u.id) FILTER (WHERE u.role = 'agent') AS "activeAgents"
      FROM orders o LEFT JOIN users u ON u.referral_code = o.sold_by_code
      WHERE o.status = 'completed' AND o.created_at >= date_trunc('week', now()) - interval '8 weeks'
      GROUP BY 1 ORDER BY 1`
    const thisWeek = new Date()
    thisWeek.setUTCHours(0, 0, 0, 0)
    thisWeek.setUTCDate(thisWeek.getUTCDate() - ((thisWeek.getUTCDay() + 6) % 7))
    return rows.map((r) => ({
      week: r.week.toISOString().slice(0, 10),
      sales: Number(r.sales ?? 0),
      profit: Number(r.profit ?? 0),
      ownShop: Number(r.ownShop ?? 0),
      agents: Number(r.agents ?? 0),
      activeAgents: Number(r.activeAgents),
      complete: r.week.getTime() < thisWeek.getTime(),
    }))
  }
}
