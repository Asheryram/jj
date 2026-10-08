import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { priceFromMarkup } from '../domain/pricing'
import { CATALOGUE_SOURCES, type CatalogueSource, type SourceSku } from './catalogue-source'

/** The first scheduled sync, a little after start so it never slows a boot. */
const FIRST_SYNC_DELAY_MS = 5 * 60_000
/** Then every six hours: supplier prices and stock move slowly, and each run calls them. */
const SYNC_INTERVAL_MS = 6 * 60 * 60_000

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
 * costs a particular amount. Both were wrong in practice, we listed a 500MB MTN
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
export class CatalogueImportService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(CatalogueImportService.name)
  private timer: NodeJS.Timeout | null = null
  private firstRun: NodeJS.Timeout | null = null
  private running: Promise<ImportResult> | null = null

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

  /**
   * Keeps costs, stock and new products current without anyone clicking
   * Sync: once a few minutes after start, then every few hours. Safe to run
   * unattended: it never puts anything on or off sale, it only records what
   * the supplier now charges and whether they stock it.
   */
  onApplicationBootstrap(): void {
    const run = () =>
      void this.importFromProvider()
        .then((r) => this.log.log(`scheduled sync: ${r.created} new, ${r.repriced} repriced, ${r.withdrawn} unavailable`))
        .catch((error) => this.log.error(`scheduled sync failed: ${String(error)}`))
    this.firstRun = setTimeout(run, FIRST_SYNC_DELAY_MS)
    this.firstRun.unref?.()
    this.timer = setInterval(run, SYNC_INTERVAL_MS)
    this.timer.unref?.()
  }

  onModuleDestroy(): void {
    if (this.firstRun) clearTimeout(this.firstRun)
    if (this.timer) clearInterval(this.timer)
  }

  /** One sync at a time: a click on Sync during a scheduled run gets that run's result. */
  importFromProvider(): Promise<ImportResult> {
    if (!this.running) {
      this.running = this.runImport().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  private async runImport(): Promise<ImportResult> {
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
        results.push(await this.importSource(source))
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

  private async importSource(source: CatalogueSource): Promise<SourceResult> {
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

      if (await this.upsertProduct(sku)) unpriced++
    }

    // Anything from this source that it no longer lists. Not deleted, orders
    // and dispatches point at these rows, and a sale that happened still
    // happened. Withdrawn from sale is the whole of what we can honestly say.
    //
    // Marked unavailable only, never switched off sale: an unavailable SKU is
    // already hidden from the shop and refused at checkout, and it comes back
    // by itself the next time the supplier lists it. Switching the product
    // off used to make a supplier's bad afternoon (a checker outage, a
    // briefly short list) permanent until someone noticed and switched each
    // one back on. On sale or not stays the admin's decision alone.
    const gone = await this.prisma.supplierProduct.findMany({
      where: { provider: source.provider, available: true, code: { notIn: [...seen] } },
      select: { code: true },
    })
    // An empty list from a supplier that had products is almost certainly
    // their glitch, not a real withdrawal of everything. Leave it be.
    const goneCodes = skus.length === 0 ? [] : gone.map((row) => row.code)
    if (skus.length === 0 && gone.length > 0) {
      this.log.warn(`${source.label} returned an empty catalogue, nothing withdrawn, check their API`)
    }

    if (goneCodes.length > 0) {
      await this.prisma.supplierProduct.updateMany({
        where: { code: { in: goneCodes } },
        data: { available: false },
      })
      this.log.warn(
        `${source.label} no longer lists ${goneCodes.length} SKU(s), marked unavailable: ` +
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

  /**
   * Returns true when the product is new and still needs a price.
   *
   * Runs the same way for every source, regardless of which provider is
   * currently routed for this SKU's network+category: `SettingsService`'s
   * `networkProviderRouting` is deliberately NOT consulted here any more.
   * An earlier version of this method deactivated a non-selected provider's
   * `Product` row on sync, which collided with `AdminService.setTier`/
   * `applyMarkup`, both of which reactivate a product the moment its price
   * clears cost with no idea *why* it was off, silently undoing a routing
   * decision that had nothing to do with pricing. Routing is enforced at
   * read time instead (`CatalogueService.snapshot`, `OrdersService.priceInside`),
   * independent of `active`, which stays purely the admin's own on/off-sale
   * signal and is never written here for any reason but the ones this
   * method already had before GMPL existed: a brand-new SKU starts inactive,
   * an existing one keeps whatever `active` value it already had.
   */
  private async upsertProduct(sku: SourceSku): Promise<boolean> {
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
    // exactly zero, quietly, on every affected SKU. A markup is the thing he
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
        adminPrice: priceFromMarkup(sku.costPrice, product.agentMarkupBp),
        standardPrice: priceFromMarkup(sku.costPrice, product.walkupMarkupBp),
      },
    })
    return false
  }
}
