import { Inject, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { priceFromMarkup } from '../domain/pricing'
import { CATALOGUE_SOURCES, type CatalogueSource, type SourceSku } from './catalogue-source'

export interface SourceResult {
  provider: string
  label: string
  created: number
  updated: number
  repriced: number
  withdrawn: number
  unpriced: number
  /** Set when the supplier could not be reached. Its rows are left untouched. */
  error?: string
}

export interface ImportResult {
  sources: SourceResult[]
  created: number
  updated: number
  repriced: number
  withdrawn: number
  unpriced: number
}

/**
 * Rebuild the supplier catalogue from what our suppliers actually sell.
 *
 * Everything in `supplier_products` used to be seeded by hand, which meant the
 * table asserted two things it had no basis for: that a SKU exists, and that it
 * costs a particular amount. Both were wrong in practice — we listed a 500MB MTN
 * bundle and three small Telecel bundles that DataHub does not sell at all,
 * every price we had invented was above the real one, and airtime was
 * attributed to a provider whose API sells data only.
 *
 * So suppliers are the source of truth. What a source returns exists, at the
 * price and the availability it reports; what it stops returning is withdrawn.
 *
 * Sources are independent, and deliberately so. A supplier that cannot be
 * reached leaves its own rows exactly as they were and reports the failure,
 * rather than letting one outage withdraw a catalogue that is perfectly fine.
 */
@Injectable()
export class CatalogueImportService {
  private readonly log = new Logger(CatalogueImportService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CATALOGUE_SOURCES) private readonly sources: CatalogueSource[],
  ) {}

  /** The suppliers wired up, whether or not they are usable right now. */
  get available(): { provider: string; label: string; configured: boolean }[] {
    return this.sources.map((source) => ({
      provider: source.provider,
      label: source.label,
      configured: source.configured,
    }))
  }

  async importFromProvider(feeBp: number): Promise<ImportResult> {
    const results: SourceResult[] = []

    for (const source of this.sources) {
      const empty = {
        provider: source.provider,
        label: source.label,
        created: 0,
        updated: 0,
        repriced: 0,
        withdrawn: 0,
        unpriced: 0,
      }

      if (!source.configured) {
        results.push({ ...empty, error: `${source.label} has no credentials configured.` })
        continue
      }

      try {
        results.push(await this.importSource(source, feeBp))
      } catch (error) {
        this.log.error(`${source.label} sync failed: ${String(error)}`)
        results.push({
          ...empty,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const total = (key: 'created' | 'updated' | 'repriced' | 'withdrawn' | 'unpriced') =>
      results.reduce((sum, result) => sum + result[key], 0)

    return {
      sources: results,
      created: total('created'),
      updated: total('updated'),
      repriced: total('repriced'),
      withdrawn: total('withdrawn'),
      unpriced: total('unpriced'),
    }
  }

  private async importSource(source: CatalogueSource, feeBp: number): Promise<SourceResult> {
    const skus = await source.fetch()
    const seen = new Set<string>()
    let created = 0
    let updated = 0
    let repriced = 0
    let unpriced = 0

    for (const sku of skus) {
      seen.add(sku.code)

      const existing = await this.prisma.supplierProduct.findUnique({ where: { code: sku.code } })

      await this.prisma.supplierProduct.upsert({
        where: { code: sku.code },
        create: {
          code: sku.code,
          provider: source.provider,
          category: sku.category,
          network: sku.network,
          name: sku.name,
          // Suppliers do not tell us about expiry, so neither do we. The seed
          // used to print "Non-expiry" on every bundle, which was a promise to
          // the customer that nobody had verified.
          validity: '',
          costPrice: sku.costPrice,
          networkKey: sku.networkKey,
          capacityGb: sku.capacityGb,
          available: sku.available,
        },
        update: {
          name: sku.name,
          costPrice: sku.costPrice,
          networkKey: sku.networkKey,
          capacityGb: sku.capacityGb,
          // Stock is the supplier's to report and nobody else's to set.
          available: sku.available,
        },
      })

      if (existing) {
        updated++
        if (existing.costPrice !== sku.costPrice) {
          repriced++
          this.log.log(
            `${sku.code}: cost ${(existing.costPrice / 100).toFixed(2)} → ` +
              `${(sku.costPrice / 100).toFixed(2)}`,
          )
        }
      } else {
        created++
      }

      if (await this.upsertProduct(sku, feeBp)) unpriced++
    }

    // Anything from this source that it no longer lists. Not deleted — orders
    // and dispatches point at these rows, and a sale that happened still
    // happened. Withdrawn from sale is the whole of what we can honestly say.
    const gone = await this.prisma.supplierProduct.findMany({
      where: { provider: source.provider, code: { notIn: [...seen] } },
      select: { code: true },
    })
    const goneCodes = gone.map((row) => row.code)

    if (goneCodes.length > 0) {
      await this.prisma.supplierProduct.updateMany({
        where: { code: { in: goneCodes } },
        data: { available: false },
      })
      await this.prisma.product.updateMany({
        where: { supplierCode: { in: goneCodes } },
        data: { active: false },
      })
      this.log.warn(
        `${source.label} no longer lists ${goneCodes.length} SKU(s) — withdrawn: ` +
          goneCodes.join(', '),
      )
    }

    this.log.log(
      `${source.label}: ${created} new, ${updated} existing, ${repriced} repriced, ` +
        `${goneCodes.length} withdrawn, ${unpriced} awaiting a price`,
    )

    return {
      provider: source.provider,
      label: source.label,
      created,
      updated,
      repriced,
      withdrawn: goneCodes.length,
      unpriced,
    }
  }

  /** Returns true when the product is new and still needs a price. */
  private async upsertProduct(sku: SourceSku, feeBp: number): Promise<boolean> {
    const product = await this.prisma.product.findUnique({ where: { id: sku.productId } })

    if (!product) {
      // New SKUs arrive priced at cost and NOT on sale.
      //
      // A default markup would be a number we made up appearing as James's
      // price, and selling at cost silently would be worse. Inactive is the
      // honest state: the SKU exists, the cost is real, and nobody has said what
      // it sells for yet.
      await this.prisma.product.create({
        data: {
          id: sku.productId,
          category: sku.category,
          network: sku.network,
          name: sku.name,
          validity: '',
          supplierCode: sku.code,
          supplierCost: sku.costPrice,
          adminPrice: sku.costPrice,
          standardPrice: sku.costPrice,
          agentMarkupBp: 0,
          walkupMarkupBp: 0,
          active: false,
        },
      })
      return true
    }

    // Re-derive both prices from the markup James set, rather than nudging them
    // up to meet a risen cost.
    //
    // That was `max(price, cost)`, which kept the sale legal and made the margin
    // exactly zero — quietly, on every affected SKU. A markup is the thing he
    // actually decided; the price is downstream of it and of a cost that moves.
    await this.prisma.product.update({
      where: { id: sku.productId },
      data: {
        supplierCode: sku.code,
        // Name and validity come from the supplier on every sync, not only on
        // creation, so the catalogue cannot drift into making claims for them
        // that they never made.
        name: sku.name,
        validity: '',
        supplierCost: sku.costPrice,
        adminPrice: priceFromMarkup(sku.costPrice, product.agentMarkupBp, feeBp),
        standardPrice: priceFromMarkup(sku.costPrice, product.walkupMarkupBp, feeBp),
      },
    })
    return false
  }
}
