import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PricingService } from '../pricing/pricing.service'
import { SettingsService } from '../settings/settings.service'
import { toProduct, toPublicProduct } from '../common/mappers'
import type { Role } from '@prisma/client'

/**
 * One call that gives the browser everything it needs to price the shop without
 * a round trip per product: the catalogue, the referral chain, and the platform
 * switches.
 *
 * Why ship the chain to the client at all — the frontend keeps a copy of the
 * pricing domain and resolves prices locally, which is what lets a sell-link
 * storefront render 40 products instantly on a slow Ghana connection (NFR-1.1).
 * The server still prices every order itself and trusts nothing that comes back.
 *
 * Trade-off, deliberate and worth revisiting before public launch: an agent can
 * read other agents' markup percentages from this payload. James's `supplierCost`
 * — the one genuinely sensitive number, because it reveals his own margin — is
 * stripped for everyone but admin. Tightening the rest means resolving prices
 * per-request server-side, which costs the instant render above.
 */
@Injectable()
export class CatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
  ) {}

  async snapshot(role: Role | undefined) {
    const [products, agents, admin, settings] = await Promise.all([
      this.prisma.product.findMany({
        where: role === 'admin' ? {} : { active: true },
        orderBy: [{ category: 'asc' }, { supplierCost: 'asc' }],
      }),
      this.pricing.agents(),
      this.pricing.admin(),
      this.settings.all(),
    ])

    return {
      products: products.map(role === 'admin' ? toProduct : toPublicProduct),
      pricingAgents: agents,
      admin,
      settings: {
        referralEnabled: settings.referralEnabled,
        referralRatePercent: settings.referralRatePercent,
        // The failure switch is an admin testing aid; a customer's browser has no
        // business branching on it, and telling everyone would be odd.
        ...(role === 'admin' ? { simulateFailure: settings.simulateFailure } : {}),
      },
    }
  }

  /** Resolve a sell link to the agent behind it (FR-5.7). */
  async seller(code: string) {
    const row = await this.prisma.user.findUnique({
      where: { referralCode: code.trim().toUpperCase() },
      select: { name: true, referralCode: true, role: true, status: true },
    })

    if (!row || row.role !== 'agent' || row.status !== 'active') return null
    return { name: row.name, referralCode: row.referralCode }
  }
}
