import { Injectable } from '@nestjs/common'
import type { Network } from '@prisma/client'
import { GmplClient } from './gmpl.client'
import type { CatalogueSource, SourceSku } from './catalogue-source'

const NETWORKS: Record<'MTN' | 'TELECEL', Network> = { MTN: 'MTN', TELECEL: 'Telecel' }

/**
 * Data bundles from GMPL. Their agent API sells nothing else, no airtime, no
 * result checkers, and no AirtelTigo at all (see `GmplClient`'s own header).
 *
 * `productId`/`code` are namespaced `gmpl-*`/`GMPL-*`, deliberately never the
 * same as `DatahubSource`'s `mtn-data-*`/`DH-*`: GMPL's own bundle sizes and
 * names do not reliably line up with DataHub's, so each provider's bundles
 * get their own customer-facing `Product` row rather than trying to alias
 * non-identical SKUs onto a shared id. `CatalogueImportService` is what
 * decides, per network, which of the two rows is actually allowed to be on
 * sale, not this file.
 */
@Injectable()
export class GmplSource implements CatalogueSource {
  readonly provider = 'gmpl'
  readonly label = 'GMPL'

  constructor(private readonly client: GmplClient) {}

  get configured(): boolean {
    return this.client.configured
  }

  async fetch(): Promise<SourceSku[]> {
    const skus: SourceSku[] = []

    for (const [gmplNetwork, network] of Object.entries(NETWORKS) as ['MTN' | 'TELECEL', Network][]) {
      const result = await this.client.bundles(gmplNetwork)
      if (result.kind === 'failed') throw new Error(result.reason)

      for (const bundle of result.bundles) {
        skus.push({
          code: `GMPL-${bundle.id}`,
          productId: `gmpl-${network.toLowerCase()}-data-${bundle.id}`,
          category: 'data',
          network,
          name: bundle.name || `${bundle.dataVolume} Data`,
          costPrice: bundle.agentAmountPesewas,
          available: bundle.isActive,
          // Their purchase call takes a bundle id, not a network+capacity
          // pair, so that id is all `networkKey` ever needs to hold for this
          // provider. `capacityGb` stays null on purpose: GMPL never asks for
          // it, and `hasAutomatedFulfilment` knows a `gmpl` SKU doesn't need one.
          networkKey: bundle.id,
          capacityGb: null,
        })
      }
    }

    return skus
  }
}
