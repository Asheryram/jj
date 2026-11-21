import { Injectable } from '@nestjs/common'
import type { Network } from '@prisma/client'
import { capacityToGb, NetpulseClient } from './netpulse.client'
import type { CatalogueSource, SourceSku } from './catalogue-source'

const NETWORKS: Record<string, Network> = { MTN: 'MTN', TELECEL: 'Telecel', AIRTELTIGO: 'AirtelTigo' }

/**
 * NetPulse's ordinary data bundles as SKUs. MTN Mashup (data plus minutes and
 * SMS) is a different kind of product and is left out; so are their result
 * checkers, which GMPL already supplies.
 *
 * Namespaced `NP-*`/`np-*` like the other two sources, so each supplier's
 * bundle is its own `Product` row and routing decides which one customers see.
 *
 * `networkKey` holds their capacity string exactly as `/packages` gave it
 * ("1GB"), because `/purchase` must be sent that exact value; the network
 * comes from the SKU's own `network`, whose names match theirs. `capacityGb`
 * is the plain size ("1"), for matching the same bundle across suppliers.
 */
@Injectable()
export class NetpulseSource implements CatalogueSource {
  readonly provider = 'netpulse'
  readonly label = 'NetPulse'

  constructor(private readonly client: NetpulseClient) {}

  get configured(): boolean {
    return this.client.configured
  }

  async fetch(): Promise<SourceSku[]> {
    const result = await this.client.packages()
    if (result.kind === 'failed') throw new Error(result.reason)

    const skus: SourceSku[] = []
    for (const pkg of result.packages) {
      const network = NETWORKS[pkg.network.toUpperCase().replace(/[^A-Z]/g, '')]
      if (!network) continue
      const slug = pkg.capacity.toLowerCase().replace(/[^a-z0-9.]/g, '')
      skus.push({
        code: `NP-${network.toUpperCase()}-${pkg.capacity.toUpperCase().replace(/\s+/g, '')}`,
        productId: `np-${network.toLowerCase()}-data-${slug}`,
        category: 'data',
        network,
        name: `${network} ${pkg.capacity}`,
        costPrice: pkg.pricePesewas,
        // They list only what they currently sell.
        available: true,
        networkKey: pkg.capacity,
        capacityGb: capacityToGb(pkg.capacity),
      })
    }
    return skus
  }
}
