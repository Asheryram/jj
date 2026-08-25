import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { NotFoundError } from '../common/domain-errors'
import {
  priceBandFor,
  retailPriceFor,
  salePriceOf,
  splitFor,
  type Admin,
  type OrderSplit,
  type PriceBand,
  type PricedProduct,
  type PricingAgent,
} from '../domain/pricing'

/** Anything that can run a query — the client, or an open transaction. */
type Db = PrismaService | Prisma.TransactionClient

/**
 * Loads agents and the referral policy out of Postgres and hands them to the
 * pure pricing domain.
 *
 * Read fresh for every price decision. Caching would be an obvious win on paper
 * and a money bug in practice: an agent who lowers their price expects the very
 * next order to use it, and a stale referral rate silently changes who earns
 * what.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Every agent, with their explicit per-product prices attached. Admins are
   * excluded — James is the implicit root of every chain and is added by
   * `splitFor`, so including him would double-count his margin.
   */
  async agents(db: Db = this.prisma): Promise<PricingAgent[]> {
    const rows = await db.user.findMany({
      where: { role: 'agent' },
      select: {
        id: true,
        name: true,
        referralCode: true,
        uplineCode: true,
        markupPercent: true,
        prices: { select: { productId: true, resalePrice: true } },
      },
      orderBy: { joinedAt: 'asc' },
    })

    return rows.map((row) => ({
      userId: row.id,
      name: row.name,
      referralCode: row.referralCode,
      uplineCode: row.uplineCode,
      markupPercent: row.markupPercent,
      prices: row.prices,
    }))
  }

/**
   * The admin, or null when the platform has no admin yet.
   *
   * Separate from `admin()` because the two callers need opposite answers on a
   * fresh deployment. Reading the shop is fine with nobody to hold the margin —
   * there is nothing priced to sell. Placing an order is not.
   *
   * This exists because the strict version made a new deployment unusable: the
   * catalogue call failed, the client treats that as fatal, and the superadmin
   * could not get past the boot screen to create the very admin that was missing.
   */
  async adminOrNull(db: Db = this.prisma): Promise<Admin | null> {
    const row = await db.user.findFirst({
      where: { role: 'admin' },
      select: { id: true, name: true },
      orderBy: { joinedAt: 'asc' },
    })
    return row ? { userId: row.id, name: row.name } : null
  }

  /** James. The root of every chain and the only holder of the supplier margin. */
  async admin(db: Db = this.prisma): Promise<Admin> {
    const row = await db.user.findFirst({
      where: { role: 'admin' },
      select: { id: true, name: true },
      orderBy: { joinedAt: 'asc' },
    })
    if (!row) {
      // Without an admin row there is nobody to hold the supplier margin, so a
      // split cannot balance. Failing here beats writing a lopsided ledger.
      throw new NotFoundError('The platform is not configured yet — no admin account exists.')
    }
    return { userId: row.id, name: row.name }
  }

  async product(productId: string, db: Db = this.prisma): Promise<PricedProduct & { active: boolean }> {
    const row = await db.product.findUnique({ where: { id: productId } })
    if (!row) throw new NotFoundError('We could not find that bundle.')
    return {
      id: row.id,
      supplierCost: row.supplierCost,
      adminPrice: row.adminPrice,
      standardPrice: row.standardPrice,
      active: row.active,
    }
  }

  /**
   * The authoritative price and split for one sale.
   *
   * Callers pass the transaction client so the seller's price and the referral
   * policy are read under the same snapshot that writes the order — otherwise the
   * rate could change between the quote and the ledger write.
   */
  async quote(
    productId: string,
    sellerCode: string | null,
    db: Db = this.prisma,
  ): Promise<{ product: PricedProduct; salePrice: number; split: OrderSplit }> {
    const [product, agents, admin, settings] = await Promise.all([
      this.product(productId, db),
      this.agents(db),
      this.admin(db),
      this.settings.all(db),
    ])

    const split = splitFor(product, sellerCode, agents, admin, settings.paystackFeeBp)
    return { product, salePrice: salePriceOf(split, product), split }
  }

  /** What a buyer arriving through `sellerCode` pays. */
  async retailPrice(productId: string, sellerCode: string | null): Promise<number> {
    const [product, agents, settings] = await Promise.all([
      this.product(productId),
      this.agents(),
      this.settings.all(),
    ])
    return retailPriceFor(sellerCode, product, agents, settings.paystackFeeBp)
  }

  /**
   * FR-3.4 — the legal window for one agent's own price on one product.
   *
   * Identical for every agent now: the floor is James's agent price, because
   * that is what all of them pay regardless of who referred them.
   */
  async bandFor(userId: string, productId: string): Promise<PriceBand> {
    const [product, agents] = await Promise.all([this.product(productId), this.agents()])
    const agent = agents.find((a) => a.userId === userId)
    if (!agent) {
      return { floor: product.adminPrice }
    }
    return priceBandFor(agent, product)
  }
}
