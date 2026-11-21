import { Injectable, Logger } from '@nestjs/common'
import type { Network } from '@prisma/client'
import { capacityToGb, NetpulseClient, type NetpulseMashup } from './netpulse.client'
import type { CatalogueSource, SourceSku } from './catalogue-source'

const NETWORKS: Record<string, Network> = { MTN: 'MTN', TELECEL: 'Telecel', AIRTELTIGO: 'AirtelTigo' }

/**
 * "511 MB data · 176 MTN mins · 22 mins to other networks · 45 SMS · 30 days",
 * what a Mashup pack really holds. Their own name ("Mashup 10GB") is not its
 * data allowance, so it is never shown as if it were.
 */
export function mashupContents(m: NetpulseMashup): string {
  return [
    m.data ? `${m.data} data` : null,
    m.mtnMinutes ? `${m.mtnMinutes} MTN mins` : null,
    m.otherMinutes ? `${m.otherMinutes} mins to other networks` : null,
    m.sms ? `${m.sms} SMS` : null,
    m.validityDays ? `${m.validityDays} days` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * NetPulse's products as SKUs: ordinary data bundles, MTN Mashup packs (their
 * own `mashup` category, data, minutes and SMS together) and WAEC/BECE result
 * checkers. Checkers are not routed per network, so with GMPL also selling
 * them, which one customers get is decided by which is on sale.
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
  private readonly log = new Logger(NetpulseSource.name)

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
        validity: pkg.validity,
      })
    }

    for (const m of result.mashup) {
      const minutes = m.mtnMinutes + m.otherMinutes
      skus.push({
        code: `NP-MASHUP-${m.capacity.toUpperCase().replace(/[^A-Z0-9.]/g, '')}`,
        productId: `np-mtn-mashup-${m.capacity.toLowerCase().replace(/[^a-z0-9.]/g, '')}`,
        category: 'mashup',
        network: 'MTN',
        name: ['Mashup', m.data, minutes ? `+ ${minutes} mins` : null].filter(Boolean).join(' '),
        costPrice: m.pricePesewas,
        available: true,
        // `/purchase` takes this back with `product: "mashup"`.
        networkKey: m.capacity,
        capacityGb: null,
        validity: mashupContents(m),
      })
    }

    // A checker failure never fails the data sync above.
    const checkers = await this.client.checkers()
    if (checkers.kind === 'ok') {
      for (const c of checkers.checkers) {
        const type = c.id.toLowerCase().replace(/[^a-z0-9]/g, '')
        skus.push({
          code: `NP-CHK-${type.toUpperCase()}`,
          productId: `np-checker-${type}`,
          category: 'checker',
          network: null,
          name: c.name,
          costPrice: c.pricePesewas,
          available: c.available,
          // `/checkers/purchase` takes this as `type`.
          networkKey: c.id,
          capacityGb: null,
        })
      }
    } else {
      this.log.warn(`NetPulse checkers not synced: ${checkers.reason}`)
    }
    return skus
  }
}
