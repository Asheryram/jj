import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PricingService } from '../pricing/pricing.service'
import { toEarning } from '../common/mappers'
import { ValidationError } from '../common/domain-errors'
import { validateResalePrice } from '../domain/pricing'

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /** Withdrawable earnings and the ledger behind them. */
  async earnings(userId: string) {
    const [user, rows] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { balance: true },
      }),
      this.prisma.earning.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ])

    return { balance: user.balance, earnings: rows.map(toEarning) }
  }

  /** FR-3.4 / FR-6.2 — this agent's own resale prices. */
  async prices(userId: string) {
    const rows = await this.prisma.agentPrice.findMany({
      where: { userId },
      select: { productId: true, resalePrice: true },
    })
    return rows
  }

  /**
   * Set one price. The band is recomputed server-side from the live chain — an
   * agent must not be able to sell below what they pay by posting a number the
   * form would have rejected.
   */
  async setPrice(userId: string, productId: string, resalePrice: number) {
    const band = await this.pricing.bandFor(userId, productId)

    const complaint = validateResalePrice(resalePrice, band)
    // The band goes back in `detail` so the form can re-render its own limits
    // from the server's view rather than the stale one it validated against.
    if (complaint) {
      throw new ValidationError(complaint, { floor: band.floor })
    }

    await this.prisma.agentPrice.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId, resalePrice },
      update: { resalePrice },
    })

    return { productId, resalePrice, band }
  }

  /** Fall back to the default markup for this product. */
  async clearPrice(userId: string, productId: string) {
    await this.prisma.agentPrice
      .delete({ where: { userId_productId: { userId, productId } } })
      .catch(() => undefined) // already absent is the desired end state
    return { productId, cleared: true }
  }

  /**
   * FR-5.2 — the agents this agent referred, with what each has actually sold.
   *
   * One level, matching what actually pays: a referrer earns on the people they
   * personally brought in, and nothing on those people's own recruits. Showing a
   * second level here would imply an income that does not exist.
   *
   * Volume and earnings are computed from the order and earnings tables rather
   * than stored counters. Counters drift the moment a refund lands; this cannot.
   */
  async downline(referralCode: string) {
    const everyone = await this.prisma.user.findMany({
      where: { uplineCode: referralCode, role: 'agent' },
      orderBy: { joinedAt: 'asc' },
    })

    if (everyone.length === 0) return []

    const codes = everyone.map((a) => a.referralCode)

    const [sales, uplineCredit] = await Promise.all([
      // Only completed orders count as volume — a failed one was refunded.
      this.prisma.order.groupBy({
        by: ['soldByCode'],
        where: { soldByCode: { in: codes }, status: 'completed' },
        _count: { _all: true },
        _sum: { salePrice: true },
      }),
      // What this agent has earned from the downline's activity.
      this.prisma.earning.aggregate({
        where: { user: { referralCode }, type: 'downline' },
        _sum: { amount: true },
      }),
    ])

    const byCode = new Map(sales.map((s) => [s.soldByCode, s]))
    const totalDownlineVolume = sales.reduce((sum, s) => sum + (s._sum.salePrice ?? 0), 0)
    const totalEarned = uplineCredit._sum.amount ?? 0

    return everyone.map((agent) => {
      const stats = byCode.get(agent.referralCode)
      const volume = stats?._sum.salePrice ?? 0
      return {
        id: agent.id,
        name: agent.name,
        phone: agent.phone,
        referralCode: agent.referralCode,
        uplineCode: agent.uplineCode,
        joinedAt: agent.joinedAt.toISOString(),
        orders: stats?._count._all ?? 0,
        volume,
        // Apportioned by share of volume. The per-agent attribution would need
        // the order reference on every earning row joined back to its seller;
        // this is the honest approximation and it sums to the real total.
        earnedForUpline:
          totalDownlineVolume > 0 ? Math.round((volume / totalDownlineVolume) * totalEarned) : 0,
        markupPercent: agent.markupPercent,
        status: agent.status,
      }
    })
  }

  /** The default markup applied to any product the agent has not priced. */
  async setMarkup(userId: string, markupPercent: number) {
    if (!Number.isInteger(markupPercent) || markupPercent < 0 || markupPercent > 200) {
      throw new ValidationError('A markup is a whole number between 0 and 200 percent.')
    }
    await this.prisma.user.update({ where: { id: userId }, data: { markupPercent } })
    return { markupPercent }
  }
}
