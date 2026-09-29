import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { DatahubClient } from '../supplier/datahub.client'
import { GmplClient } from '../supplier/gmpl.client'
import { FulfilmentService } from './fulfilment.service'
import { claimTransition } from '../common/alert-flag'
import { resolveSupplierProvider } from '../supplier/supplier.service'
import type { SupplierProviderCode } from '../settings/settings.service'

/**
 * Orders paid for and held because the supplier has not approved the
 * recipient.
 *
 * DataHub will not deliver an MTN bundle to a number that is not on their
 * beneficiary list, and GMPL runs an equivalent "Up2U" first-time-number gate
 * of their own for MTN. Rather than refuse the sale, which turned every
 * first-time MTN customer away, the order is taken and parked in
 * `awaiting_approval`, and this is where it gets resolved, for either
 * provider — every op below branches by `BeneficiaryRequest.provider`.
 *
 * DataHub's `/beneficiaries` submission endpoint answers 502 on every valid
 * request (validation passes, then their upstream returns an HTML page), so
 * approval there is a manual job in their dashboard. GMPL's own submission is
 * a real, working API call (`precheckBeneficiary(..., record: true)`, see
 * `GmplClient`'s own doc comment on how that was confirmed).
 *
 * Three operations, each split by provider:
 *
 *  · **pending**, who is waiting, how many orders each is holding up, and how
 *    much of the customers' money is parked against them.
 *  · **recheck**, ask each provider which pending numbers have been approved
 *    since, and immediately re-dispatch the orders waiting on the ones that
 *    have. This is the one-click retry; approval is the provider's to grant,
 *    so their answer is the only thing that may release an order.
 *  · **submit**, try each provider's API. DataHub's is expected to fail (see
 *    above) and reports the failure rather than pretending; GMPL's actually
 *    submits.
 */
/** Where the last recheck time is kept, so the automatic call can be rate-limited. */
const RECHECK_MARKER = 'beneficiaryRecheckAt'
const RECHECK_COOLDOWN_MS = 60_000

@Injectable()
export class ApprovalsService {
  private readonly log = new Logger(ApprovalsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly datahub: DatahubClient,
    private readonly gmpl: GmplClient,
    private readonly fulfilment: FulfilmentService,
  ) {}

  /**
   * Everyone waiting, with the money each is holding up, across both
   * providers.
   *
   * Ordered by value held rather than by age: the number blocking GHS 200 of
   * paid orders is the one worth approving first, and it is also the one whose
   * customers are most likely to ask for their money back.
   */
  async pending() {
    const held = await this.prisma.order.findMany({
      where: { status: 'awaiting_approval' },
      select: {
        recipient: true,
        salePrice: true,
        productName: true,
        createdAt: true,
        supplierCodeAtSale: true,
      },
    })

    const registry = await this.prisma.beneficiaryRequest.findMany({
      where: { approvedAt: null },
    })

    /**
     * A held order carries no `provider` of its own, only the SKU it was
     * frozen against at sale time — resolved the same way every other
     * provider-aware read in this codebase is, never denormalized.
     */
    const providerByOrder = new Map<string, SupplierProviderCode>()
    for (const order of held) {
      providerByOrder.set(order.recipient, await resolveSupplierProvider(this.prisma, order.supplierCodeAtSale))
    }

    const key = (phone: string, provider: string) => `${phone}:${provider}`

    const byKey = new Map<
      string,
      {
        phone: string
        provider: SupplierProviderCode
        ordersHeld: number
        valueHeld: number
        lastProduct: string | null
        lastValue: number | null
        oldest: Date
      }
    >()

    for (const order of held) {
      const provider = providerByOrder.get(order.recipient) ?? 'datahub-gh'
      const k = key(order.recipient, provider)
      const row = byKey.get(k)
      if (row) {
        row.ordersHeld++
        row.valueHeld += order.salePrice
        if (order.createdAt < row.oldest) row.oldest = order.createdAt
        continue
      }
      byKey.set(k, {
        phone: order.recipient,
        provider,
        ordersHeld: 1,
        valueHeld: order.salePrice,
        lastProduct: order.productName,
        lastValue: order.salePrice,
        oldest: order.createdAt,
      })
    }

    /**
     * Most rows now have no held order at all, and that is the point.
     *
     * A sale to an unapproved number is refused before it is created, so nothing
     * is charged and nothing is held, which means `ordersHeld` and `valueHeld`
     * are zero for every number refused that way. The demand shows up as
     * `attempts` instead: how many times somebody tried and was turned away. That
     * is the number worth sorting by, because it is the sales this is costing.
     *
     * Rows with a held order still exist: orders placed before the block, and
     * orders whose dispatch came back `needs_approval` after payment.
     */
    for (const entry of registry) {
      const k = key(entry.phone, entry.provider)
      if (byKey.has(k)) continue
      byKey.set(k, {
        phone: entry.phone,
        provider: entry.provider as SupplierProviderCode,
        ordersHeld: 0,
        valueHeld: 0,
        lastProduct: entry.lastProduct,
        lastValue: entry.lastValue,
        oldest: entry.lastSeenAt,
      })
    }

    const networkKeys = new Map(registry.map((row) => [key(row.phone, row.provider), row.networkKey]))
    const attemptsBy = new Map(registry.map((row) => [key(row.phone, row.provider), row.attempts]))
    const copiedAtBy = new Map(registry.map((row) => [key(row.phone, row.provider), row.copiedAt]))

    return [...byKey.values()]
      .sort(
        (a, b) =>
          // Money actually held first, then the number of refused sales. Both
          // matter, and with the block in place the second is usually all there is.
          b.valueHeld - a.valueHeld ||
          (attemptsBy.get(key(b.phone, b.provider)) ?? 0) - (attemptsBy.get(key(a.phone, a.provider)) ?? 0) ||
          b.ordersHeld - a.ordersHeld,
      )
      .map((row) => ({
        phone: row.phone,
        provider: row.provider,
        networkKey: networkKeys.get(key(row.phone, row.provider)) ?? 'YELLO',
        ordersHeld: row.ordersHeld,
        valueHeld: row.valueHeld,
        /** How many sales this number has been refused. */
        attempts: attemptsBy.get(key(row.phone, row.provider)) ?? 0,
        lastProduct: row.lastProduct,
        lastValue: row.lastValue,
        waitingSince: row.oldest.toISOString(),
        /**
         * Last time this specific number was copied to hand to DataHub's
         * dashboard by hand — DataHub only, GMPL's own submission is an API
         * call (see `submit`), never a copy-paste step. Null for a GMPL row
         * always, and for a DataHub row that has never been copied, which is
         * exactly the number that's easy to lose track of once a few more
         * have come in since the last copy, see `pending`'s own callers.
         */
        copiedAt: copiedAtBy.get(key(row.phone, row.provider))?.toISOString() ?? null,
      }))
  }

  /**
   * Record that these DataHub numbers were just copied to paste into their
   * dashboard by hand.
   *
   * The actual problem this solves: a batch copied five minutes ago and a
   * number that just showed up look identical in the list otherwise, and a
   * few numbers in either direction is enough to lose track of which is
   * which by memory alone. This is the checkpoint, not a claim about
   * DataHub's side, just "this one was handed over, and when." DataHub only:
   * see `pending`'s own comment on why `copiedAt` never applies to a GMPL row.
   *
   * A plain `updateMany`, not an upsert: every phone shown on the approvals
   * screen already has a `BeneficiaryRequest` row from the moment a sale to
   * it was first refused or held, so there is nothing to create here, bar
   * a handful of pre-existing held orders older than that tracking itself,
   * which this silently no-ops on rather than inventing a row with no real
   * `networkKey` or attempt count behind it.
   */
  async markCopied(phones: string[]): Promise<void> {
    if (phones.length === 0) return
    await this.prisma.beneficiaryRequest.updateMany({
      where: { phone: { in: phones }, provider: 'datahub-gh' },
      data: { copiedAt: new Date() },
    })
  }

  /**
   * Re-dispatch every held order for a number under one provider, now that
   * it is approved.
   *
   * Goes back through the ordinary fulfilment path rather than a special one, so
   * an order released here settles through exactly the same ledger code as one
   * that never needed approving. Scoped to `provider`: a routing switch means
   * the same phone can genuinely have held orders under both providers at
   * once, approving one must never touch the other's.
   */
  private async releaseOrdersFor(phone: string, provider: SupplierProviderCode): Promise<number> {
    const held = await this.prisma.order.findMany({
      where: { status: 'awaiting_approval', recipient: phone },
      select: { id: true, reference: true, supplierCodeAtSale: true },
    })

    let released = 0
    for (const order of held) {
      if ((await resolveSupplierProvider(this.prisma, order.supplierCodeAtSale)) !== provider) continue

      // Guarded on the status this read found it in: the reconciler's stale-approval
      // sweep can independently time the same order out to `failed` between the
      // `findMany` above and this write. A plain `update` would silently resurrect
      // an already-refunded order back to `processing`; the `updateMany` guard makes
      // this a no-op instead when that race happens.
      const claim = await this.prisma.order.updateMany({
        where: { id: order.id, status: 'awaiting_approval' },
        data: { status: 'processing' },
      })
      if (claim.count === 0) continue
      released++
      this.fulfilment.scheduleFor(order.id)
      this.log.log(`${order.reference} released, ${phone} approved`)
    }

    return released
  }

  /**
   * Ask each provider which pending numbers they have approved since we last
   * looked, and release the orders waiting on the ones that have.
   *
   * Rate-limited to DataHub's documented 30/min on their side, so their half
   * runs in small batches with a pause between them rather than firing
   * everything at once. GMPL's precheck has no documented per-minute limit,
   * so its batch (grouped by network, one call per network covers every
   * pending number on it) runs without an equivalent pause.
   */
  async recheck(): Promise<{
    checked: number
    approved: string[]
    released: number
    /** True when this call did nothing because one ran moments ago. */
    skipped?: boolean
    lastCheckedAt?: string
  }> {
    /**
     * One pass a minute, however often it is asked for, shared across both
     * providers rather than tracked per-provider: simpler, and safe either
     * way since GMPL's own limit is unconfirmed.
     *
     * The approvals screen runs this on load so the list is current without
     * anybody pressing anything, which means a few refreshes would otherwise
     * fire a verify call per pending number each time, against a provider that
     * allows thirty a minute. The cooldown makes the automatic call safe and
     * leaves the manual button honest: it either checks, or says when it last did.
     */
    const marker = await this.prisma.setting.findUnique({ where: { key: RECHECK_MARKER } })
    const previousValue = typeof marker?.value === 'string' ? marker.value : ''
    const last = previousValue ? Date.parse(previousValue) : NaN
    if (Number.isFinite(last) && Date.now() - last < RECHECK_COOLDOWN_MS) {
      return {
        checked: 0,
        approved: [],
        released: 0,
        skipped: true,
        lastCheckedAt: new Date(last).toISOString(),
      }
    }

    /**
     * Claimed atomically, not just read-then-written: the approvals screen
     * runs this on every load, so two admins with it open at once, or one
     * admin with two tabs, is the ordinary case, not a rare one. Without
     * this, both could read the cooldown as expired before either wrote a
     * fresh marker, and both would call the provider at once, exactly the
     * rate limit this cooldown exists to protect. Losing the
     * race here means a concurrent recheck already started elsewhere, so
     * acting on a comparison against a value that is no longer current would
     * either double-send the same alert or silently downgrade a level a
     * moment after another order correctly raised it.
     */
    const startedAt = new Date().toISOString()
    if (!(await claimTransition(this.prisma, RECHECK_MARKER, previousValue, startedAt))) {
      return { checked: 0, approved: [], released: 0, skipped: true, lastCheckedAt: new Date().toISOString() }
    }

    const waiting = await this.prisma.beneficiaryRequest.findMany({
      where: { approvedAt: null },
      select: { phone: true, networkKey: true, provider: true },
      take: 60,
    })

    const approved: string[] = []
    let released = 0
    /**
     * Distinct from "checked, still not registered", which is the ordinary,
     * expected outcome for most of up to 60 numbers on every run and does
     * not deserve a log line each time. This is specifically the check
     * itself failing (a network error, the provider unreachable), previously
     * indistinguishable from an ordinary "not yet" via the same
     * `.catch(() => null)`, only ever visible, if at all, as a smaller
     * `approved.length` than expected with no way to tell why.
     */
    const failedChecks: string[] = []

    const dhWaiting = waiting.filter((w) => w.provider === 'datahub-gh')
    for (const [index, row] of dhWaiting.entries()) {
      // Their limit is 30 a minute. Twenty at a time with a breath in between
      // stays well inside it even if this is run twice in quick succession.
      if (index > 0 && index % 20 === 0) await sleep(3000)

      const result = await this.datahub.verify(row.networkKey, row.phone).catch((error: unknown) => {
        failedChecks.push(row.phone)
        this.log.warn(`could not check ${row.phone}: ${String(error)}`)
        return null
      })
      // Only a definite yes clears a number. `unknown` leaves it pending, which is
      // right: a number is not approved because we failed to ask.
      if (result?.kind === 'registered') {
        approved.push(row.phone)
        await this.prisma.beneficiaryRequest.update({
          where: { phone_provider: { phone: row.phone, provider: 'datahub-gh' } },
          data: { approvedAt: new Date() },
        })
        released += await this.releaseOrdersFor(row.phone, 'datahub-gh')
      }
    }

    // GMPL: one precheck call per network covers every pending number on it,
    // `known: true` is their equivalent of DataHub's `registered`.
    const gmplWaiting = waiting.filter((w) => w.provider === 'gmpl')
    const gmplByNetwork = new Map<string, string[]>()
    for (const row of gmplWaiting) {
      const list = gmplByNetwork.get(row.networkKey) ?? []
      list.push(row.phone)
      gmplByNetwork.set(row.networkKey, list)
    }
    for (const [network, phones] of gmplByNetwork) {
      const result = await this.gmpl.precheckBeneficiary(network as 'MTN' | 'TELECEL', phones).catch(() => null)
      if (!result || result.kind !== 'ok') {
        failedChecks.push(...phones)
        if (result) this.log.warn(`could not recheck ${phones.length} GMPL number(s) on ${network}: ${result.reason}`)
        continue
      }
      for (const entry of result.results) {
        if (!entry.known) continue
        approved.push(entry.phone)
        await this.prisma.beneficiaryRequest.update({
          where: { phone_provider: { phone: entry.phone, provider: 'gmpl' } },
          data: { approvedAt: new Date() },
        })
        released += await this.releaseOrdersFor(entry.phone, 'gmpl')
      }
    }

    if (approved.length > 0) {
      this.log.log(`approved ${approved.length} number(s) across both providers, releasing ${released} held order(s)`)
    }
    if (failedChecks.length > 0) {
      this.log.warn(`${failedChecks.length} of ${waiting.length} number(s) could not be checked this run`)
    }
    return { checked: waiting.length, approved, released, lastCheckedAt: startedAt }
  }

  /**
   * Try to submit the pending numbers through each provider's own API.
   *
   * DataHub's half is expected to fail while their upstream is down (see the
   * class doc comment); it returns the reason rather than swallowing it,
   * because "we submitted your number" is exactly the kind of claim that
   * must not be made when nothing was submitted. GMPL's half is a real,
   * working call (`precheckBeneficiary(..., record: true)`).
   */
  async submit(): Promise<{
    datahub: { submitted: number; error: string | null }
    gmpl: { submitted: number; error: string | null }
  }> {
    const [datahub, gmpl] = await Promise.all([this.submitDatahub(), this.submitGmpl()])
    return { datahub, gmpl }
  }

  private async submitDatahub(): Promise<{ submitted: number; error: string | null }> {
    const waiting = await this.prisma.beneficiaryRequest.findMany({
      where: { approvedAt: null, provider: 'datahub-gh' },
      select: { phone: true },
      // Their documented ceiling is 30 per request.
      take: 30,
    })
    if (waiting.length === 0) return { submitted: 0, error: null }

    const result = await this.datahub.submitBeneficiaries(waiting.map((row) => row.phone))
    if (!result.ok) {
      this.log.warn(`DataHub beneficiary submission failed: ${result.reason}`)
      return { submitted: 0, error: result.reason }
    }

    this.log.log(`submitted ${result.submitted} number(s) to DataHub for approval`)
    return { submitted: result.submitted, error: null }
  }

  private async submitGmpl(): Promise<{ submitted: number; error: string | null }> {
    const waiting = await this.prisma.beneficiaryRequest.findMany({
      where: { approvedAt: null, provider: 'gmpl' },
      select: { phone: true, networkKey: true },
      take: 30,
    })
    if (waiting.length === 0) return { submitted: 0, error: null }

    const byNetwork = new Map<string, string[]>()
    for (const row of waiting) {
      const list = byNetwork.get(row.networkKey) ?? []
      list.push(row.phone)
      byNetwork.set(row.networkKey, list)
    }

    let submitted = 0
    let error: string | null = null
    for (const [network, phones] of byNetwork) {
      const result = await this.gmpl.precheckBeneficiary(network as 'MTN' | 'TELECEL', phones, true)
      if (result.kind === 'ok') {
        submitted += phones.length
      } else {
        error = result.reason
        this.log.warn(`GMPL beneficiary submission failed for ${network}: ${result.reason}`)
      }
    }
    if (submitted > 0) this.log.log(`submitted ${submitted} number(s) to GMPL for approval`)
    return { submitted, error }
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
