import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PricingService } from '../pricing/pricing.service'
import { SettingsService } from '../settings/settings.service'
import { toProduct, toPublicProduct , PRODUCT_INCLUDE} from '../common/mappers'
import type { Role } from '@prisma/client'
import { isAdminRole } from '../common/auth'

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
        where: isAdminRole(role) ? {} : { active: true },
        orderBy: [{ category: 'asc' }, { supplierCost: 'asc' }],
        // Only the admin payload keeps `provider`, but loading it costs one join
        // either way and `toPublicProduct` strips it.
        include: PRODUCT_INCLUDE,
      }),
      this.pricing.agents(),
      // Tolerant on purpose: a fresh deployment has no admin until the
      // superadmin creates one, and the shop still has to render for them to be
      // able to do it. Placing an order still refuses — see pricing.admin().
      this.pricing.adminOrNull(),
      this.settings.all(),
    ])

    return {
      products: products.map(isAdminRole(role) ? toProduct : toPublicProduct),
      pricingAgents: agents,
      admin,
      settings: {
        // The failure switch is an admin testing aid; a customer's browser has no
        // business branching on it, and telling everyone would be odd.
        ...(isAdminRole(role) ? { simulateFailure: settings.simulateFailure } : {}),
        /**
         * Sent to everyone, unlike the switch above — it is a rate, not a
         * secret, and the browser needs it to preview a price the same way the
         * server will actually charge it. An agent's own default markup is
         * computed live in the browser from this exact number (see
         * `resalePriceFor`), so a stale or missing value here would let the
         * preview promise a margin the real order does not deliver.
         */
        paystackFeeBp: settings.paystackFeeBp,
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
