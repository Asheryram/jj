import type { Category, Network } from '@prisma/client'

/**
 * One SKU as a supplier offers it, normalised.
 *
 * Every source speaks its own dialect — DataHub returns networks with nested
 * bundles keyed by `sizeInMB`, an airtime wholesaler will return something else
 * entirely — so translation happens inside each source and the importer only
 * ever sees this shape.
 */
export interface SourceSku {
  /** Unique across all sources. Namespace it with the provider. */
  code: string
  /** Our product id. Stable across syncs — it is what order history points at. */
  productId: string
  category: Category
  network: Network | null
  name: string
  /** Integer pesewas. What the supplier charges us. */
  costPrice: number
  /** Whether the supplier is currently offering it. Theirs to say, not ours. */
  available: boolean
  /**
   * How the supplier's fulfilment API identifies this SKU. Both null means there
   * is no automated path and an order for it is refused at checkout rather than
   * taken and left undeliverable.
   */
  networkKey: string | null
  capacityGb: string | null
}

/**
 * Somewhere we buy from.
 *
 * DataHub GH is the only one implemented, and it sells data bundles only — so
 * airtime, voice and SMS will have to come from somewhere else, and this is the
 * seam they arrive through. A source owns its own vocabulary, its own network
 * mapping and its own idea of what a SKU is called; the importer owns what
 * happens to the rows afterwards, identically for all of them.
 */
export interface CatalogueSource {
  /** Stored on every SKU as `supplier_products.provider`. */
  readonly provider: string
  /** For log lines and admin screens. */
  readonly label: string
  /** False when credentials are missing — the source is skipped, not failed. */
  readonly configured: boolean
  /** Throws with a human-readable reason if the supplier cannot be reached. */
  fetch(): Promise<SourceSku[]>
}

/** Injection token for the set of configured sources. */
export const CATALOGUE_SOURCES = Symbol('CATALOGUE_SOURCES')
