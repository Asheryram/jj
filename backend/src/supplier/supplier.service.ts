import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Order } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'

export interface DispatchResult {
  outcome: 'delivered' | 'rejected'
  /** The provider's reason for a rejection. For admin eyes, not the buyer's. */
  reason?: string
  /** FR-4.7 — result-checker orders come back with a voucher. */
  voucher?: { serial: string; pin: string }
}

/**
 * The DataHub GH adapter.
 *
 * With no API key configured it does not call anything — it decides the outcome
 * from the seeded `supplier_products` table and logs the attempt to
 * `supplier_dispatches` in exactly the shape a real call would. That is the
 * whole point of the seam: `dispatch()` keeps its signature when the keys land,
 * and the only thing that changes below is where the answer comes from.
 *
 * Deliberately deterministic. This build goes to real acceptance testers, and an
 * order that fails at random is a bug report about our dice, not about the
 * product. An order fails only for a stated reason.
 */
@Injectable()
export class SupplierService {
  private readonly log = new Logger(SupplierService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /** True once real credentials exist. Reported on /api/health so it is visible. */
  get isLive(): boolean {
    return Boolean(this.config.get<string>('DATAHUB_API_KEY'))
  }

  /** How long the provider takes to confirm, in ms. */
  get delayMs(): number {
    return Number(this.config.get<string>('FULFILMENT_DELAY_MS') ?? 2600)
  }

  /**
   * Attempt delivery and record it. Never throws for a provider-side refusal —
   * a rejection is a result, not an exception, and the caller has to run the
   * refund path either way.
   */
  async dispatch(order: Order, attempt = 1): Promise<DispatchResult> {
    const result = await this.decide(order)

    // The supplier code is nullable on products (a checker has no DataHub SKU
    // until one is mapped), but the dispatch log needs something to point at.
    const supplierCode = await this.supplierCodeFor(order.productId)

    if (supplierCode) {
      await this.prisma.supplierDispatch.create({
        data: {
          orderId: order.id,
          orderRef: order.reference,
          supplierCode,
          recipient: order.recipient,
          costPrice: (order.split as { supplierCost?: number })?.supplierCost ?? 0,
          outcome: result.outcome,
          reason: result.reason,
          simulated: !this.isLive,
          attempt,
        },
      })
    }

    this.log.log(
      `${result.outcome} ${order.reference} → ${order.recipient} (${order.productName})${
        result.reason ? ` — ${result.reason}` : ''
      }`,
    )

    return result
  }

  private async decide(order: Order): Promise<DispatchResult> {
    // The admin test switch wins over everything, so a tester can always
    // reproduce the refund path on demand (FR-2.7).
    if (await this.settings.get('simulateFailure')) {
      return {
        outcome: 'rejected',
        reason: 'Forced failure — admin test switch is on.',
      }
    }

    const supplier = await this.prisma.product
      .findUnique({
        where: { id: order.productId },
        select: { supplier: true },
      })
      .then((p) => p?.supplier ?? null)

    // No mapped SKU means we cannot claim delivery. Better a clean refund than a
    // completed order nobody actually fulfilled.
    if (!supplier) {
      return {
        outcome: 'rejected',
        reason: 'No provider SKU is mapped to this product.',
      }
    }

    if (!supplier.available) {
      return {
        outcome: 'rejected',
        reason: `${supplier.name} is out of stock at ${supplier.provider}.`,
      }
    }

    return {
      outcome: 'delivered',
      ...(order.category === 'checker' ? { voucher: this.mintVoucher(order.reference) } : {}),
    }
  }

  private async supplierCodeFor(productId: string): Promise<string | null> {
    const row = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { supplierCode: true },
    })
    return row?.supplierCode ?? null
  }

  /**
   * A stand-in for the voucher the supplier would return.
   *
   * Derived from the order reference rather than random, so the same order
   * always shows the same voucher — a tester who reloads the page and sees
   * different digits would reasonably report it as a bug.
   */
  private mintVoucher(reference: string): { serial: string; pin: string } {
    let hash = 0
    for (const char of reference) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    const serial = `WA${(hash % 90_000_000 + 10_000_000).toString()}`
    const pin = ((hash * 2_654_435_761) % 9_000_000_000 + 1_000_000_000).toString()
    return { serial, pin }
  }
}
