import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Order, SupplierProduct } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { DatahubClient } from './datahub.client'
import { GmplClient, gmplIdempotencyKey } from './gmpl.client'
import { FloatMonitorService } from './float-monitor.service'

export interface DispatchResult {
  /**
   * `delivered` and `rejected` are terminal. The other two are not, and the
   * difference matters more than it looks:
   *
   *  · `pending`, DataHub accepted the order and will report the real outcome
   *    by webhook. The order stays in `processing`; nothing is credited or
   *    refunded yet.
   *  · `unknown`, we never got a usable reply. The order may or may not have
   *    been placed and the float may or may not have been debited. It must NOT
   *    be refunded (the bundle may have arrived) and must NOT be retried (there
   *    is no idempotency key, so a retry can deliver twice). It is parked for a
   *    human.
   */
  outcome: 'delivered' | 'rejected' | 'pending' | 'unknown' | 'needs_approval'
  /** The provider's reason for a rejection. For admin eyes, not the buyer's. */
  reason?: string
  /** FR-4.7, result-checker orders come back with a voucher. */
  voucher?: { serial: string; pin: string }
  /** The provider's own reference, once they have accepted the order. */
  providerReference?: string
  /**
   * GMPL's own internal order id, needed only because their
   * `purchase.success`/`purchase.failed` webhook keys on it instead of the
   * `publicId` every other GMPL event and endpoint uses. Null/unused for a
   * DataHub dispatch.
   */
  secondaryProviderReference?: string
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
 * Matched on their words because they send no machine-readable code for it,
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
 * Whether a mapped supplier SKU can actually be fulfilled without a human.
 *
 * Used to be inlined as `!supplier.networkKey || !supplier.capacityGb`
 * wherever it was needed, DataHub-shaped: their purchase call takes a
 * network key AND a whole-GB capacity. GMPL's purchase call takes only a
 * bundle id (stored in `networkKey`, same as `GmplSource`'s own comment
 * explains), never a capacity, so a `gmpl` SKU with no `capacityGb` is
 * completely normal, not unfulfillable. Extracted once, here, so every call
 * site agrees on what "automated fulfilment" means for whichever provider a
 * SKU actually belongs to, instead of two providers' rules getting
 * copy-pasted and drifting apart.
 */
export function hasAutomatedFulfilment(
  supplier: Pick<SupplierProduct, 'provider' | 'networkKey' | 'capacityGb'>,
): boolean {
  if (!supplier.networkKey) return false
  if (supplier.provider === 'gmpl') return true
  return supplier.capacityGb != null
}

/**
 * The DataHub GH adapter.
 *
 * With no API key configured it does not call anything, it decides the outcome
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
    private readonly gmpl: GmplClient,
    private readonly float: FloatMonitorService,
  ) {}

  private clientFor(provider: string): DatahubClient | GmplClient {
    return provider === 'gmpl' ? this.gmpl : this.datahub
  }

  private liveEnvKeyFor(provider: string): string {
    return provider === 'gmpl' ? 'GMPL_LIVE' : 'DATAHUB_LIVE'
  }

  /** Credentials are present for this provider. Necessary for live fulfilment, not sufficient. */
  hasCredentialsFor(provider: string): boolean {
    return this.clientFor(provider).configured
  }

  /**
   * Whether real orders go to this provider.
   *
   * Two independent conditions, and both are deliberate:
   *
   *  · The provider's own `*_LIVE` env var must be explicitly "true".
   *    Anything else, absent, empty, "1", "yes", is false. A money switch
   *    should have exactly one spelling that turns it on, so a typo fails
   *    safe rather than starting to spend.
   *  · Credentials must exist, or there is nothing to call with.
   *
   * Read from the environment rather than the database on purpose. Going live is
   * a deploy-time decision that costs money on every order, so it takes a
   * deliberate file change and a restart, not a click, and not something a
   * stolen admin session can do.
   */
  isLiveFor(provider: string): boolean {
    return this.hasCredentialsFor(provider) && this.config.get<string>(this.liveEnvKeyFor(provider))?.trim() === 'true'
  }

  /** What `/api/health` reports, so the state is never ambiguous to a tester. */
  providerStateFor(provider: string): 'live' | 'simulated' | 'simulated-live-off' | 'live-requested-no-key' {
    if (this.isLiveFor(provider)) return 'live'
    // Configured to go live but with nothing to call. Called out separately
    // because it is a misconfiguration, not a choice.
    if (this.config.get<string>(this.liveEnvKeyFor(provider))?.trim() === 'true') return 'live-requested-no-key'
    return this.hasCredentialsFor(provider) ? 'simulated-live-off' : 'simulated'
  }

  /** Back-compat aliases: every caller written before GMPL existed meant "DataHub" by this. */
  get hasCredentials(): boolean {
    return this.hasCredentialsFor('datahub-gh')
  }
  get isLive(): boolean {
    return this.isLiveFor('datahub-gh')
  }
  get providerState(): 'live' | 'simulated' | 'simulated-live-off' | 'live-requested-no-key' {
    return this.providerStateFor('datahub-gh')
  }
  /** What `/api/health` reports for GMPL specifically. */
  get gmplProviderState(): 'live' | 'simulated' | 'simulated-live-off' | 'live-requested-no-key' {
    return this.providerStateFor('gmpl')
  }

  onModuleInit(): void {
    for (const [provider, label] of [
      ['datahub-gh', 'DataHub GH'],
      ['gmpl', 'GMPL'],
    ] as const) {
      const state = this.providerStateFor(provider)
      if (state === 'live') {
        this.log.warn(`${this.liveEnvKeyFor(provider)}=true, orders WILL spend real money at ${label}.`)
      } else if (state === 'live-requested-no-key') {
        this.log.error(
          `${this.liveEnvKeyFor(provider)}=true but no credentials configured for ${label}, falling back to simulated.`,
        )
      } else if (state === 'simulated-live-off') {
        this.log.warn(
          `${label} credentials present, ${this.liveEnvKeyFor(provider)} is not true, orders are simulated ` +
            'and nothing is being sent.',
        )
      }
    }
  }

  /** How long the provider takes to confirm, in ms. */
  get delayMs(): number {
    return Number(this.config.get<string>('FULFILMENT_DELAY_MS') ?? 2600)
  }

  /**
   * Attempt delivery and record it. Never throws for a provider-side refusal,
   * a rejection is a result, not an exception, and the caller has to run the
   * refund path either way.
   */
  async dispatch(order: Order, attempt = 1): Promise<DispatchResult> {
    // Frozen at order time (see `Order.supplierCodeAtSale`'s own doc
    // comment), not re-resolved from the product live, a checker with no
    // supplier SKU mapped yet still has null here, same as before. Loaded
    // once, here, so `dispatchLive`/`decide` don't each re-query it, and so
    // liveness is decided for the provider this order actually belongs to,
    // not a single, one-provider-only switch.
    const supplierCode = order.supplierCodeAtSale
    const supplier = supplierCode
      ? await this.prisma.supplierProduct.findUnique({ where: { code: supplierCode } })
      : null
    const provider = supplier?.provider ?? 'datahub-gh'
    const live = this.isLiveFor(provider)
    const result = live
      ? await this.dispatchLive(order, supplier, provider, attempt)
      : await this.decide(order, supplier)

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
    // one does, say so, every margin on this order was computed from the wrong
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
        result.reason ? `, ${result.reason}` : ''
      }`,
    )

    return result
  }

  /**
   * Refuse what neither provider can actually deliver, then hand off to
   * whichever one this order's frozen SKU belongs to. Shared here, once,
   * rather than duplicated inside `dispatchLiveDatahub`/`dispatchLiveGmpl`,
   * so both providers are refused by the exact same rules.
   *
   * `supplier` is looked up by the SKU frozen at order time, not by
   * re-reading `Product.supplierCode` live, see `Order.supplierCodeAtSale`'s
   * own doc comment. A product remapped to a different provider SKU between
   * this order being placed and dispatch actually running (a real,
   * documented catalogue-correction workflow, not just a crash window) used
   * to fulfil against whatever the mapping currently says, not what the
   * customer's frozen sale price/split was actually priced against.
   */
  private async dispatchLive(
    order: Order,
    supplier: SupplierProduct | null,
    provider: string,
    attempt: number,
  ): Promise<DispatchResult> {
    // The admin test switch still wins, so the refund path stays reproducible
    // without spending money at either provider.
    if (await this.settings.get('simulateFailure')) {
      return { outcome: 'rejected', reason: 'Forced failure, admin test switch is on.' }
    }
    if (!supplier) {
      return { outcome: 'rejected', reason: 'No provider SKU is mapped to this product.' }
    }
    if (!supplier.available) {
      return { outcome: 'rejected', reason: `${supplier.name} is out of stock at ${supplier.provider}.` }
    }
    if (!hasAutomatedFulfilment(supplier)) {
      return {
        outcome: 'rejected',
        reason: `${supplier.name} has no automated fulfilment at ${supplier.provider}.`,
      }
    }

    return provider === 'gmpl'
      ? this.dispatchLiveGmpl(order, supplier, attempt)
      : this.dispatchLiveDatahub(order, supplier)
  }

  /** Place the order with DataHub GH for real. */
  private async dispatchLiveDatahub(order: Order, supplier: SupplierProduct): Promise<DispatchResult> {
    // Ask before buying, for the networks they can answer about. Cheaper than a
    // 422 and it keeps a doomed purchase off their rate limit, but it is only
    // an optimisation: the purchase reply is checked for the same thing below,
    // because /verify covers MTN alone.
    if (VERIFIABLE_KEYS.includes(supplier.networkKey as string)) {
      // `verify()` already logs its own failures internally and resolves
      // rather than rejecting; this catch is only a defensive backstop.
      const check = await this.datahub
        .verify(supplier.networkKey as string, order.recipient)
        .catch((error: unknown) => {
          this.log.warn(`${order.reference}: pre-purchase verify threw unexpectedly, ${String(error)}`)
          return null
        })
      // Only a definite refusal holds the order. `unknown` falls through to the
      // purchase, which checks the same thing and is the authority anyway.
      if (check?.kind === 'not_registered') {
        return { outcome: 'needs_approval', reason: check.message }
      }
    }

    const result = await this.datahub.purchase({
      networkKey: supplier.networkKey as string,
      recipient: order.recipient,
      capacity: supplier.capacityGb as string,
    })

    if (result.kind === 'accepted') {
      /**
       * The one moment the float is knowable.
       *
       * DataHub publishes no balance endpoint, so this reply is the only place
       * the remaining balance ever appears. Awaited rather than fired and
       * forgotten, because the process may be about to be replaced on a deploy,
       * but `record` swallows its own failures, so it cannot turn a successful
       * purchase into a failed one.
       */
      await this.float.record(result.balanceAfter, order.reference)

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
        'DataHub float is empty, every order will fail until it is topped up.',
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

  /**
   * Place the order with GMPL for real.
   *
   * MTN has its own "first-time number" gate (Up2U), GMPL's equivalent of
   * DataHub's beneficiary list, checked the same advisory way: only a
   * definite `known: false` holds the order, the purchase call is still the
   * authority and is checked for the same thing via its own machine-readable
   * `BENEFICIARY_NOT_VALIDATED` code. Wallet monitoring is out of scope this
   * pass, so unlike the DataHub path there is no float/balance recording
   * here at all, only the log line below if a purchase ever reports the
   * wallet empty.
   */
  private async dispatchLiveGmpl(order: Order, supplier: SupplierProduct, attempt: number): Promise<DispatchResult> {
    if (supplier.network === 'MTN') {
      const check = await this.gmpl.precheckBeneficiary('MTN', [order.recipient]).catch((error: unknown) => {
        this.log.warn(`${order.reference}: GMPL precheck threw unexpectedly, ${String(error)}`)
        return null
      })
      const entry = check?.kind === 'ok' ? check.results[0] : null
      if (entry && entry.valid && !entry.known) {
        return { outcome: 'needs_approval', reason: "Not yet on GMPL/MTN's approved beneficiary list." }
      }
    }

    const result = await this.gmpl.purchase({
      bundleId: supplier.networkKey as string,
      recipient: order.recipient,
      idempotencyKey: gmplIdempotencyKey(order.reference, attempt),
    })

    if (result.kind === 'accepted') {
      // Their reply means "queued", never "delivered". The real outcome
      // arrives by webhook, or the reconciler goes and asks.
      return {
        outcome: 'pending',
        providerReference: result.providerReference,
        secondaryProviderReference: result.secondaryReference,
        providerStatus: result.providerStatus,
        providerCharged: result.charged ?? undefined,
        providerResponse: result.raw,
      }
    }

    if (result.kind === 'unknown') {
      this.log.error(`UNRESOLVED GMPL dispatch for ${order.reference} → ${order.recipient}: ${result.reason}`)
      return { outcome: 'unknown', reason: result.reason, providerResponse: result.raw }
    }

    if (result.insufficientBalance) {
      this.log.error('GMPL wallet is empty, every order routed to them will fail until it is topped up.')
    }

    if (result.code === 'BENEFICIARY_NOT_VALIDATED') {
      return { outcome: 'needs_approval', reason: result.reason, providerResponse: result.raw }
    }

    return { outcome: 'rejected', reason: result.reason, providerResponse: result.raw }
  }

  private async decide(order: Order, supplier: SupplierProduct | null): Promise<DispatchResult> {
    // The admin test switch wins over everything, so a tester can always
    // reproduce the refund path on demand (FR-2.7).
    if (await this.settings.get('simulateFailure')) {
      return {
        outcome: 'rejected',
        reason: 'Forced failure, admin test switch is on.',
      }
    }

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

  /**
   * A stand-in for the voucher the supplier would return.
   *
   * Derived from the order reference rather than random, so the same order
   * always shows the same voucher, a tester who reloads the page and sees
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
