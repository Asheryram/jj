import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import type { Network } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { DatahubClient } from '../supplier/datahub.client'
import { GmplClient, gmplSendOutcome } from '../supplier/gmpl.client'
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
 * **Consolidated, not two independent queues.** A number is only truly clear
 * once every provider that could actually serve its network has approved it,
 * not just whichever one happened to refuse the sale first. Routing can move
 * a network from one provider to the other at any time, and an MTN number
 * DataHub approved means nothing to GMPL, which has never heard of it. So the
 * moment a number needs approving anywhere, a row is ensured for every
 * applicable provider (`ensureCounterparts`), `pending()` reports a number as
 * still outstanding if ANY applicable provider has not approved it, and
 * `submit`/`recheck` act on every applicable provider at once — but each
 * provider's own already-approved row is skipped, never resubmitted or
 * re-asked once it has already said yes.
 *
 * Three operations, each covering both applicable providers at once:
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

/**
 * How often the background sweep runs on its own, independent of anyone
 * opening this screen. Before this existed, `pending()` itself triggered
 * `ensureCounterparts`, and the frontend auto-ran a full `recheck()` on
 * every page load, which meant visiting Approvals was the only thing that
 * ever sent a number to GMPL or asked either provider for an update, and a
 * busy list made that one visit slow (DataHub's own verify is rate-limited
 * to 20 at a time with a pause between batches). Now the page is a plain
 * read and this sweep is the only thing that calls out to either provider
 * unprompted.
 */
const SWEEP_INTERVAL_MS = 10 * 60_000

/**
 * DataHub's own networkKey vocabulary, mapped back to the generic network it
 * represents. `mtn_xpress` is an alternate MTN product line, still MTN.
 * Needed only to figure out whether a DataHub row's network could also apply
 * to GMPL, never to pick which exact DataHub SKU a counterpart row belongs
 * to (DataHub rows are only ever read here, never invented from a GMPL one,
 * see `datahubNetworkKeyFor`).
 */
const DATAHUB_KEY_TO_NETWORK: Record<string, Network> = {
  YELLO: 'MTN',
  mtn_xpress: 'MTN',
  TELECEL: 'Telecel',
  AT_PREMIUM: 'AirtelTigo',
  AT_BIGTIME: 'AirtelTigo',
}

/** The generic network a `BeneficiaryRequest` row represents, from its own provider-specific `networkKey`. Null for a DataHub key this platform does not recognise, rather than guessing. */
function networkFor(provider: SupplierProviderCode, networkKey: string): Network | null {
  if (provider === 'gmpl') return networkKey === 'TELECEL' ? 'Telecel' : 'MTN'
  return DATAHUB_KEY_TO_NETWORK[networkKey] ?? null
}

/**
 * The DataHub networkKey to use when creating a counterpart DataHub row from
 * a GMPL one. Only ever reached for MTN/Telecel, GMPL never sells
 * AirtelTigo, see `applicableProviders`. Defaults to `YELLO` for MTN, the
 * same fallback `noteApprovalNeeded` already uses when a product's own
 * networkKey is missing, there is no way to know from a GMPL row alone
 * whether a number was ever meant for DataHub's `mtn_xpress` line instead of
 * their ordinary one, and `YELLO` is the common case.
 */
export function datahubNetworkKeyFor(network: Network): string {
  return network === 'Telecel' ? 'TELECEL' : 'YELLO'
}

/** Which providers could ever serve this network at all. GMPL sells MTN and Telecel only. */
function applicableProviders(network: Network): SupplierProviderCode[] {
  return network === 'AirtelTigo' ? ['datahub-gh'] : ['datahub-gh', 'gmpl']
}

export interface ProviderApprovalStatus {
  /**
   * `'pending'` means specifically "has not been sent to this provider yet",
   * our own action still outstanding. Once it has been sent (GMPL:
   * `recordedAt` set, DataHub: `copiedAt` set) and the provider has not yet
   * answered, that is `'awaiting_provider'` instead, a genuinely different
   * thing: nothing left for anyone here to do but wait. Conflating the two
   * under one "pending" label read as "still needs sending" even for a
   * number GMPL had already received and was simply still deciding on.
   */
  status: 'approved' | 'awaiting_provider' | 'pending' | 'not_applicable'
  networkKey: string | null
  /** DataHub only, see `copiedAt`'s own comment on `PendingApprovalRow`. */
  copiedAt: string | null
  /**
   * GMPL only, the real-API counterpart to `copiedAt`: the last time this
   * number was actually registered on GMPL's own Pending MTN Approval
   * queue (their reply confirmed `recorded: true`), not just tracked here
   * locally. Null means it is sitting in this list but has never actually
   * reached GMPL yet, the one thing "pending" alone could not tell apart
   * from "already asked, just not yet answered".
   */
  recordedAt: string | null
  /**
   * GMPL only: why the last `record: true` attempt did not succeed, so
   * "why is this still Pending" has a real answer instead of depending on
   * a server log that is usually long gone by the time anyone asks. Null
   * once a send actually succeeds, see `BeneficiaryRequest.lastSendError`'s
   * own schema comment.
   */
  lastSendError: string | null
}

export interface PendingApprovalRow {
  phone: string
  network: Network
  ordersHeld: number
  valueHeld: number
  /** Sales refused, summed across whichever provider(s) actually turned this number away. */
  attempts: number
  lastProduct: string | null
  lastValue: number | null
  waitingSince: string
  datahub: ProviderApprovalStatus
  gmpl: ProviderApprovalStatus
}

@Injectable()
export class ApprovalsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(ApprovalsService.name)
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly datahub: DatahubClient,
    private readonly gmpl: GmplClient,
    private readonly fulfilment: FulfilmentService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.sweep().catch((error) => this.log.error(`approvals sweep failed: ${String(error)}`))
    }, SWEEP_INTERVAL_MS)
    this.timer.unref?.()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /**
   * The one thing that calls out to either provider without anyone asking:
   * fills in any missing counterpart (and genuinely registers it with
   * GMPL), tries sending everything still outstanding to both providers,
   * then asks both who they have approved since and releases the orders
   * waiting on them. The exact same three operations the manual buttons on
   * the Approvals screen call, just on a clock instead of a click.
   */
  private async sweep(): Promise<void> {
    await this.ensureCounterparts()
    await Promise.all([this.submitDatahub(), this.submitGmpl()])
    await this.recheck()
  }

  /**
   * Make sure every phone currently needing approval anywhere has a row for
   * every provider that could serve its network, not only the one that
   * actually refused the sale.
   *
   * Looked up from whichever row (or held order) already exists for a phone,
   * never invented from nothing: a phone with no row and no held order has
   * never needed approving at all, and is correctly left alone. A missing
   * counterpart is created with `attempts: 0`, it has not actually refused
   * any sale of its own, only the provider that holds the real row has, and
   * claiming otherwise would overstate demand on a screen sorted by exactly
   * that figure.
   *
   * Safe to call on every read, not just before acting: it only ever fills
   * in a genuinely missing row, `createMany` with `skipDuplicates` makes a
   * second call for the same phone a no-op, and an existing row, approved or
   * not, is never touched.
   *
   * Deliberately NOT filtered to `approvedAt: null`: a number already
   * approved at DataHub says nothing about GMPL, routing can move it there
   * at any time, and most of these rows predate GMPL existing as a provider
   * at all. Filtering to only-still-pending rows here would make every one
   * of those permanently invisible to this whole consolidation, exactly
   * the numbers it most needs to catch up on.
   */
  private async ensureCounterparts(): Promise<void> {
    const rows = await this.prisma.beneficiaryRequest.findMany({
      select: { phone: true, provider: true, networkKey: true },
    })

    const byPhone = new Map<string, { provider: SupplierProviderCode; networkKey: string }[]>()
    for (const row of rows) {
      const list = byPhone.get(row.phone) ?? []
      list.push({ provider: row.provider as SupplierProviderCode, networkKey: row.networkKey })
      byPhone.set(row.phone, list)
    }

    const toCreate: { phone: string; provider: SupplierProviderCode; networkKey: string }[] = []
    for (const [phone, entries] of byPhone) {
      const present = new Set(entries.map((e) => e.provider))
      // Resolved from whichever entry is recognisable; two conflicting
      // networks for the same phone across providers cannot happen, a
      // number is one person's one line.
      const network = entries.map((e) => networkFor(e.provider, e.networkKey)).find((n) => n !== null)
      if (!network) continue

      for (const provider of applicableProviders(network)) {
        if (present.has(provider)) continue
        toCreate.push({
          phone,
          provider,
          networkKey: provider === 'gmpl' ? toGmplNetworkKey(network) : datahubNetworkKeyFor(network),
        })
      }
    }

    if (toCreate.length === 0) return

    const datahubRows = toCreate.filter((r) => r.provider === 'datahub-gh')
    const gmplRows = toCreate.filter((r) => r.provider === 'gmpl')

    // DataHub: no live call possible, their own submission endpoint is
    // broken (see the class doc comment), only the tracking row so it
    // shows up to copy into their dashboard by hand.
    if (datahubRows.length > 0) {
      await this.prisma.beneficiaryRequest.createMany({
        data: datahubRows.map((row) => ({ ...row, attempts: 0 })),
        skipDuplicates: true,
      })
    }

    /**
     * GMPL: a real, working API call, registered the moment the gap is
     * first discovered, not left as a locally-tracked row nobody told them
     * about. This is what makes a number that has been sitting here since
     * before this consolidation existed (DataHub-only, from before GMPL
     * was even a provider) actually reach GMPL's own Pending MTN Approval
     * queue the next time this screen loads, rather than waiting on an
     * admin to separately click "Try sending automatically". Only ever
     * fires once per gap: the row this creates means `present.has('gmpl')`
     * is true on every call after, so there is no repeat traffic once a
     * number has been caught up.
     */
    if (gmplRows.length > 0) {
      const byNetwork = new Map<string, string[]>()
      for (const row of gmplRows) {
        const list = byNetwork.get(row.networkKey) ?? []
        list.push(row.phone)
        byNetwork.set(row.networkKey, list)
      }

      const created: {
        phone: string
        provider: SupplierProviderCode
        networkKey: string
        attempts: number
        approvedAt: Date | null
        recordedAt: Date | null
        lastSendError: string | null
      }[] = []
      for (const [network, phones] of byNetwork) {
        const result = await this.gmpl
          .precheckBeneficiary(network as 'MTN' | 'TELECEL', phones, true)
          .catch(() => null)
        const outcome = result
          ? gmplSendOutcome(result)
          : { recordedAt: null, lastSendError: 'Could not reach GMPL to register this number.' }
        for (const phone of phones) {
          const entry = result?.kind === 'ok' ? result.results.find((r) => r.phone === phone) : null
          // Same "do not trust a bypassed response" guard as everywhere
          // else this platform reads a GMPL `known`, see
          // `GmplClient.precheckBeneficiary`'s own doc comment.
          const genuinelyKnown = Boolean(result?.kind === 'ok' && result.enforced && entry?.known)
          created.push({
            phone,
            provider: 'gmpl',
            networkKey: network,
            attempts: 0,
            approvedAt: genuinelyKnown ? new Date() : null,
            recordedAt: outcome.recordedAt,
            lastSendError: outcome.lastSendError,
          })
        }
        if (!result || result.kind !== 'ok') {
          this.log.warn(`could not register ${phones.length} historical number(s) with GMPL on ${network}`)
        }
      }
      await this.prisma.beneficiaryRequest.createMany({ data: created, skipDuplicates: true })
    }
  }

  /**
   * Everyone waiting, with the money each is holding up, across both
   * providers, consolidated to one row per phone.
   *
   * Ordered by value held rather than by age: the number blocking GHS 200 of
   * paid orders is the one worth approving first, and it is also the one whose
   * customers are most likely to ask for their money back.
   *
   * A plain read, nothing here calls out to either provider: `sweep` keeps
   * this list current on its own clock, and the manual buttons do it on
   * demand, so opening this screen is never what makes a busy list slow to
   * load.
   */
  async pending(): Promise<PendingApprovalRow[]> {
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

    const registry = await this.prisma.beneficiaryRequest.findMany()

    const providerByOrder = new Map<string, SupplierProviderCode>()
    for (const order of held) {
      providerByOrder.set(order.recipient, await resolveSupplierProvider(this.prisma, order.supplierCodeAtSale))
    }

    const byPhone = new Map<
      string,
      {
        phone: string
        ordersHeld: number
        valueHeld: number
        lastProduct: string | null
        lastValue: number | null
        oldest: Date
      }
    >()

    for (const order of held) {
      const row = byPhone.get(order.recipient)
      if (row) {
        row.ordersHeld++
        row.valueHeld += order.salePrice
        if (order.createdAt < row.oldest) row.oldest = order.createdAt
        continue
      }
      byPhone.set(order.recipient, {
        phone: order.recipient,
        ordersHeld: 1,
        valueHeld: order.salePrice,
        lastProduct: order.productName,
        lastValue: order.salePrice,
        oldest: order.createdAt,
      })
    }

    const registryByPhone = new Map<string, typeof registry>()
    for (const entry of registry) {
      const list = registryByPhone.get(entry.phone) ?? []
      list.push(entry)
      registryByPhone.set(entry.phone, list)
    }

    for (const [phone, entries] of registryByPhone) {
      if (byPhone.has(phone)) continue
      // Most recently attempted entry stands in for product/value context.
      const latest = entries.reduce((a, b) => (a.lastSeenAt > b.lastSeenAt ? a : b))
      byPhone.set(phone, {
        phone,
        ordersHeld: 0,
        valueHeld: 0,
        lastProduct: latest.lastProduct,
        lastValue: latest.lastValue,
        oldest: latest.lastSeenAt,
      })
    }

    const results: PendingApprovalRow[] = []
    for (const row of byPhone.values()) {
      const entries = registryByPhone.get(row.phone) ?? []
      const network = entries
        .map((e) => networkFor(e.provider as SupplierProviderCode, e.networkKey))
        .find((n) => n !== null)
      // No recognisable network and no registry entry at all, just a held
      // order older than this tracking, resolved via the order's own
      // provider instead.
      const resolvedNetwork: Network = network ?? 'MTN'

      const statusFor = (provider: SupplierProviderCode): ProviderApprovalStatus => {
        if (!applicableProviders(resolvedNetwork).includes(provider)) {
          return { status: 'not_applicable', networkKey: null, copiedAt: null, recordedAt: null, lastSendError: null }
        }
        const entry = entries.find((e) => e.provider === provider)
        const copiedAt = provider === 'datahub-gh' ? (entry?.copiedAt?.toISOString() ?? null) : null
        const recordedAt = provider === 'gmpl' ? (entry?.recordedAt?.toISOString() ?? null) : null
        const lastSendError = provider === 'gmpl' ? (entry?.lastSendError ?? null) : null
        const sent = Boolean(copiedAt ?? recordedAt)
        return {
          status: entry?.approvedAt ? 'approved' : sent ? 'awaiting_provider' : 'pending',
          networkKey: entry?.networkKey ?? null,
          copiedAt,
          recordedAt,
          lastSendError,
        }
      }

      const datahub = statusFor('datahub-gh')
      const gmpl = statusFor('gmpl')
      // Fully resolved: nothing applicable is still outstanding. Dropped
      // from the list entirely, this is the point. "Awaiting the provider"
      // still counts as outstanding, sent does not mean settled.
      const settled = (s: ProviderApprovalStatus['status']) => s === 'approved' || s === 'not_applicable'
      if (settled(datahub.status) && settled(gmpl.status)) continue

      results.push({
        phone: row.phone,
        network: resolvedNetwork,
        ordersHeld: row.ordersHeld,
        valueHeld: row.valueHeld,
        attempts: entries.reduce((sum, e) => sum + e.attempts, 0),
        lastProduct: row.lastProduct,
        lastValue: row.lastValue,
        waitingSince: row.oldest.toISOString(),
        datahub,
        gmpl,
      })
    }

    return results.sort(
      (a, b) => b.valueHeld - a.valueHeld || b.attempts - a.attempts || b.ordersHeld - a.ordersHeld,
    )
  }

  /**
   * When the list was last actually checked with either provider, the
   * background sweep or a manual click alike, they share the one marker.
   * A plain read, same as `pending`, so the Approvals screen can show this
   * without itself triggering a check just to find out.
   */
  async lastCheckedAt(): Promise<string | null> {
    const marker = await this.prisma.setting.findUnique({ where: { key: RECHECK_MARKER } })
    return typeof marker?.value === 'string' ? marker.value : null
  }

  /**
   * Record that these DataHub numbers were just copied to paste into their
   * dashboard by hand.
   *
   * The actual problem this solves: a batch copied five minutes ago and a
   * number that just showed up look identical in the list otherwise, and a
   * few numbers in either direction is enough to lose track of which is
   * which by memory alone. This is the checkpoint, not a claim about
   * DataHub's side, just "this one was handed over, and when."
   *
   * A plain `updateMany`, not an upsert: `ensureCounterparts` already
   * guarantees a DataHub row exists for every number that needs one by the
   * time this screen can show a copy button for it.
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
      // Not `scheduleFor`: its claim refuses an order that was already
      // dispatched once, which a held order always was, see `dispatchReleased`.
      void this.fulfilment
        .dispatchReleased(order.id)
        .catch((error: unknown) => this.log.error(`${order.reference}: release dispatch failed, ${String(error)}`))
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
     * The background sweep runs this every 10 minutes on its own so the list
     * stays current without anybody pressing anything, which means it would
     * otherwise fire a verify call per pending number each time it does,
     * against a provider that allows thirty a minute. The cooldown makes
     * that automatic run safe, and leaves the manual button honest too: it
     * either checks, or says when it last did.
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

    await this.ensureCounterparts()

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
      // `enforced: false` (sandbox, or the kill switch) means every
      // well-formed number reads `known: true` regardless of its real
      // status, an honest "nothing is blocking you right now", never a
      // real decision, see `GmplClient.precheckBeneficiary`'s own doc
      // comment. Treated the same as "could not check" here: left pending,
      // not falsely cleared, so this cannot be a way to approve numbers
      // just by catching GMPL on a sandbox key or with the switch off.
      if (!result.enforced) {
        failedChecks.push(...phones)
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
   * Covers every applicable provider for every pending phone, not just
   * whichever one already has a row, `ensureCounterparts` fills in the rest
   * first. Each provider's own query already excludes anything it has
   * already approved (`approvedAt: null`), so a provider that said yes
   * earlier is never resubmitted, only the one(s) still outstanding for a
   * given number are ever sent again.
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
    await this.ensureCounterparts()
    const [datahub, gmpl] = await Promise.all([this.submitDatahub(), this.submitGmpl()])
    return { datahub, gmpl }
  }

  /**
   * GMPL only, on demand: this already happens on its own the moment a
   * number needs approving, and again on every page load (`ensureCounterparts`,
   * called from `pending`/`recheck`/`submit` alike), but that is a sweep
   * triggered by someone opening this screen, not a push the instant a
   * number appears. A number can sit genuinely un-sent for a while if
   * nobody has loaded Approvals (or clicked anything) since it showed up.
   * This is the explicit, on-demand version of exactly that sweep, scoped
   * to GMPL alone, for someone who wants to force it rather than wait.
   */
  async submitGmplOnly(): Promise<{ submitted: number; error: string | null }> {
    await this.ensureCounterparts()
    return this.submitGmpl()
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
      /**
       * Never-sent rows (`recordedAt: null`) first. Without this, a backlog
       * bigger than one batch starves forever: the same already-recorded
       * rows (sitting in GMPL's own queue, just awaiting their decision)
       * keep winning this batch's 30 slots on every call, a truly
       * never-sent number past them never gets its first attempt, no matter
       * how many times this is re-run, since resubmitting an already-sent
       * one is redundant but costs a slot a never-sent one actually needs.
       * Confirmed live: a real backlog of 43 left the same 5 unreached
       * across two manual resends in a row before this fix.
       */
      orderBy: { recordedAt: { sort: 'asc', nulls: 'first' } },
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
      const outcome = gmplSendOutcome(result)
      if (result.kind === 'ok') {
        submitted += phones.length
      } else {
        error = result.reason
        this.log.warn(`GMPL beneficiary submission failed for ${network}: ${result.reason}`)
      }
      // Written either way, not just on success: a failed attempt's reason
      // belongs on the row too, see `BeneficiaryRequest.lastSendError`'s own
      // schema comment, this is the one write site that previously left a
      // failure invisible once the request finished.
      await this.prisma.beneficiaryRequest.updateMany({
        where: { phone: { in: phones }, provider: 'gmpl' },
        data: outcome.recordedAt
          ? { recordedAt: outcome.recordedAt, lastSendError: null }
          : { lastSendError: outcome.lastSendError },
      })
    }
    if (submitted > 0) this.log.log(`submitted ${submitted} number(s) to GMPL for approval`)
    return { submitted, error }
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** `Network` in GMPL's own vocabulary, see `toGmplNetwork` in `gmpl.client.ts`, duplicated here to avoid exporting a function from there purely for this reverse lookup's inverse. */
function toGmplNetworkKey(network: Network): 'MTN' | 'TELECEL' {
  return network === 'Telecel' ? 'TELECEL' : 'MTN'
}
