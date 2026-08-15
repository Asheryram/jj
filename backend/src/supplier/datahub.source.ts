import { Injectable, Logger } from '@nestjs/common'
import type { Network } from '@prisma/client'
import { DatahubClient } from './datahub.client'
import type { CatalogueSource, SourceSku } from './catalogue-source'

/**
 * How DataHub GH names a network, and what we call it.
 *
 * Their `networkKey` is the identifier an order is placed with, so it is the
 * thing worth keying on. Two of theirs collapse onto one of ours: AT_PREMIUM
 * (iShare) and AT_BIGTIME are both AirtelTigo, but they are separate product
 * lines with separate prices — iShare runs 1–20GB, BigTime starts at 30GB — so
 * they stay distinct as products and are only grouped under one network chip.
 *
 * A network key we do not recognise is skipped rather than guessed at. Inventing
 * a mapping would put bundles on sale that we cannot correctly place an order
 * for, which is the failure mode this whole import exists to remove.
 */
const NETWORKS: Record<string, { network: Network; slug: string; line: string | null }> = {
  YELLO: { network: 'MTN', slug: 'mtn', line: null },
  TELECEL: { network: 'Telecel', slug: 'telecel', line: null },
  AT_PREMIUM: { network: 'AirtelTigo', slug: 'airteltigo-ishare', line: 'iShare' },
  AT_BIGTIME: { network: 'AirtelTigo', slug: 'airteltigo-bigtime', line: 'BigTime' },
}

/** Data bundles from DataHub GH. Their API sells nothing else. */
@Injectable()
export class DatahubSource implements CatalogueSource {
  readonly provider = 'datahub-gh'
  readonly label = 'DataHub GH'

  private readonly log = new Logger(DatahubSource.name)

  constructor(private readonly client: DatahubClient) {}

  get configured(): boolean {
    return this.client.configured
  }

  async fetch(): Promise<SourceSku[]> {
    const result = await this.client.catalogue()
    if (result.kind === 'failed') throw new Error(result.reason)

    const skus: SourceSku[] = []

    for (const network of result.networks) {
      const mapping = NETWORKS[network.networkKey]
      if (!mapping) {
        this.log.warn(
          `DataHub GH offers "${network.networkKey}" (${network.displayName}) and we have no ` +
            'mapping for it — its bundles are not on sale. Add it to NETWORKS to sell them.',
        )
        continue
      }

      for (const bundle of network.bundles) {
        // Their API takes capacity in whole gigabytes. Anything that is not a
        // whole number of GB gets no capacity, which marks it unfulfillable and
        // keeps it out of checkout rather than guessing at the right value.
        const wholeGb = bundle.sizeInMb % 1024 === 0 ? String(bundle.sizeInMb / 1024) : null

        skus.push({
          code: `DH-${network.networkKey}-${bundle.size}`,
          productId: `${mapping.slug}-data-${bundle.size.toLowerCase()}`,
          category: 'data',
          network: mapping.network,
          name: mapping.line ? `${bundle.size} ${mapping.line}` : `${bundle.size} Data`,
          costPrice: bundle.pricePesewas,
          available: bundle.isActive,
          networkKey: network.networkKey,
          capacityGb: wholeGb,
        })
      }
    }

    return skus
  }
}
