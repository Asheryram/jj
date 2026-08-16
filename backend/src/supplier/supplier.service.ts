import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Order } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { DatahubClient } from './datahub.client'

export interface DispatchResult {
  /**
   * `delivered` and `rejected` are terminal. The other two are not, and the
   * difference matters more than it looks:
   *
   *  · `pending` — DataHub accepted the order and will report the real outcome
   *    by webhook. The order stays in `processing`; nothing is credited or
   *    refunded yet.
   *  · `unknown` — we never got a usable reply. The order may or may not have
   *    been placed and the float may or may not have been debited. It must NOT
   *    be refunded (the bundle may have arrived) and must NOT be retried (there
   *    is no idempotency key, so a retry can deliver twice). It is parked for a
   *    human.
   */
  outcome: 'delivered' | 'rejected' | 'pending' | 'unknown' | 'needs_approval'
  /** The provider's reason for a rejection. For admin eyes, not the buyer's. */
  reason?: string
  /** FR-4.7 — result-checker orders come back with a voucher. */
  voucher?: { serial: string; pin: string }
  /** DataHub's own reference, once they have accepted the order. */
  providerReference?: string
  /** Their status verbatim, for the dispatch log. */
  providerStatus?: string
  /** Pesewas the provider actually debited, when they told us. */
  providerCharged?: number
  /** Their reply verbatim, so a failure can be diagnosed after the fact. */
  providerResponse?: string
}

/**
 * DataHub's way of saying the recipient is not on their beneficiary list.
 *
 * Matched on their words because they send no machine-readable code for it —
 * `/verify` answers `Phone number not verified`, and `/data-purchase` returns the
 * same text with a 422. Both mean the order is deliverable later, once a human
 * approves the number, so both must produce `needs_approval` rather than the
 * plain rejection that would refund and close it.
 */
/** The networks DataHub's /verify can answer for. */
const VERIFIABLE_KEYS = ['YELLO', 'mtn_xpress']

export function isApprovalProblem(reason: string): boolean {
  return /not verified|beneficiary list/i.test(reason)
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
export class SupplierService implements OnModuleInit {
  private readonly log = new Logger(SupplierService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly datahub: DatahubClient,
  ) {}

  /** Credentials are present. Necessary for live fulfilment, not sufficient. */
  get hasCredentials(): boolean {
    return this.datahub.configured
  }

  /**
   * Whether real orders go to DataHub GH.
   *
   * Two independent conditions, and both are deliberate:
   *
   *  · `DATAHUB_LIVE` must be explicitly "true". Anything else — absent, empty,
   *    "1", "yes" — is false. A money switch should have exactly one spelling
   *    that turns it on, so a typo fails safe rather than starting to spend.
   *  · Credentials must exist, or there is nothing to call with.
   *
   * Read from the environment rather than the database on purpose. Going live is
   * a deploy-time decision that costs money on every order, so it takes a
   * deliberate file change and a restart — not a click, and not something a
   * stolen admin session can do.
   */
  get isLive(): boolean {
    return this.hasCredentials && this.config.get<string>('DATAHUB_LIVE')?.trim() === 'true'
  }

  /** What `/api/health` reports, so the state is never ambiguous to a tester. */
  get providerState(): 'live' | 'simulated' | 'simulated-live-off' | 'live-requested-no-key' {
    if (this.isLive) return 'live'
    // Configured to go live but with nothing to call. Called out separately
    // because it is a misconfiguration, not a choice.
    if (this.config.get<string>('DATAHUB_LIVE')?.trim() === 'true') return 'live-requested-no-key'
    return this.hasCredentials ? 'simulated-live-off' : 'simulated'
  }

  onModuleInit(): void {
    if (this.isLive) {
      this.log.warn('DATAHUB_LIVE=true — orders WILL spend real money at DataHub GH.')
      return
    }
    if (this.providerState === 'live-requested-no-key') {
      this.log.error('DATAHUB_LIVE=true but no DATAHUB_API_KEY — falling back to simulated.')
      return
    }
    if (this.hasCredentials) {
      this.log.warn(
        'DataHub credentials present, DATAHUB_LIVE is not true — orders are simulated ' +
          'and no bundles are being sent.',
      )
    }
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
    const live = this.isLive
    const result = live ? await this.dispatchLive(order) : await this.decide(order)

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
          simulated: !live,
          providerReference: result.providerReference ?? null,
          providerStatus: result.providerStatus ?? null,
          providerCharged: result.providerCharged ?? null,
          providerResponse: result.providerResponse ?? null,
          attempt,
        },
      })
    }

    // Our seeded cost is an estimate until a live purchase contradicts it. When
    // one does, say so — every margin on this order was computed from the wrong
    // baseline, and silence would let the error repeat on every future sale.
    const believedCost = (order.split as { supplierCost?: number })?.supplierCost ?? 0
    if (result.providerCharged != null && result.providerCharged !== believedCost) {
      this.log.warn(
        `COST MISMATCH ${order.reference} (${order.productName}): we priced from ` +
          `GHS ${(believedCost / 100).toFixed(2)} but ${supplierCode ?? 'the provider'} charged ` +
          `GHS ${(result.providerCharged / 100).toFixed(2)}. Correct it on the provider catalogue.`,
      )
    }

    this.log.log(
      `${result.outcome} ${order.reference} → ${order.recipient} (${order.productName})${
        result.reason ? ` — ${result.reason}` : ''
      }`,
    )

    return result
  }

  /**
   * Place the order with DataHub GH for real.
   *
   * Data bundles only — their API sells nothing else, so anything without a
   * mapped `networkKey` and `capacityGb` is refused here rather than being
   * quietly marked delivered. That refusal is a real refund, which is the honest
   * outcome: we took money for something we cannot fulfil automatically.
   */
  private async dispatchLive(order: Order): Promise<DispatchResult> {
    // The admin test switch still wins, so the refund path stays reproducible
    // without spending money at the provider.
    if (await this.settings.get('simulateFailure')) {
      return { outcome: 'rejected', reason: 'Forced failure — admin test switch is on.' }
    }

    const supplier = await this.prisma.product
      .findUnique({ where: { id: order.productId }, select: { supplier: true } })
      .then((p) => p?.supplier ?? null)

    if (!supplier) {
      return { outcome: 'rejected', reason: 'No provider SKU is mapped to this product.' }
    }
    if (!supplier.available) {
      return {
        outcome: 'rejected',
        reason: `${supplier.name} is out of stock at ${supplier.provider}.`,
      }
    }
    if (!supplier.networkKey || !supplier.capacityGb) {
      return {
        outcome: 'rejected',
        reason: `${supplier.name} has no automated fulfilment — DataHub GH sells data bundles only.`,
      }
    }

    // Ask before buying, for the networks they can answer about. Cheaper than a
    // 422 and it keeps a doomed purchase off their rate limit — but it is only
    // an optimisation: the purchase reply is checked for the same thing below,
    // because /verify covers MTN alone.
    if (VERIFIABLE_KEYS.includes(supplier.networkKey)) {
      const check = await this.datahub.verify(supplier.networkKey, order.recipient).catch(() => null)
      if (check && !check.verified) {
        return { outcome: 'needs_approval', reason: check.message }
      }
    }

    const result = await this.datahub.purchase({
      networkKey: supplier.networkKey,
      recipient: order.recipient,
      capacity: supplier.capacityGb,
    })

    if (result.kind === 'accepted') {
      // Their reply means "queued", never "delivered". The real outcome arrives
      // by webhook, or the reconciler goes and asks.
      return {
        outcome: 'pending',
        providerReference: result.providerReference,
        providerStatus: result.providerStatus,
        // Pesewas. Their `deducted` is in cedis, like every money field they send.
        providerCharged:
          result.deducted == null ? undefined : Math.round(result.deducted * 100),
        providerResponse: result.raw,
      }
    }

    if (result.kind === 'unknown') {
      // Ambiguous. Refunding could hand back money for a bundle that did arrive;
      // retrying could send a second one. Park it and tell a human.
      this.log.error(
        `UNRESOLVED dispatch for ${order.reference} → ${order.recipient}: ${result.reason}`,
      )
      return { outcome: 'unknown', reason: result.reason, providerResponse: result.raw }
    }

    if (result.insufficientBalance) {
      this.log.error(
        'DataHub float is empty — every order will fail until it is topped up.',
      )
    }

    // Recoverable: the bundle is fine, the number just is not approved yet.
    // Refunding here would close an order that will deliver perfectly well in an
    // hour, so it is held instead.
    if (isApprovalProblem(result.reason)) {
      return {
        outcome: 'needs_approval',
        reason: result.reason,
        providerResponse: result.raw,
      }
    }

    return { outcome: 'rejected', reason: result.reason, providerResponse: result.raw }
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
