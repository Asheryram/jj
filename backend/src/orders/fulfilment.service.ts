import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import type { Order, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SupplierService } from '../supplier/supplier.service'
import { LedgerService, type LedgerDraft } from '../finance/ledger.service'
import { lastRealCost } from '../common/real-cost'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'
import type { OrderSplit, SplitShare } from '../domain/pricing'

/**
 * How long a dispatch claim (`Order.dispatchClaimedAt`) has to sit with no
 * `SupplierDispatch` row at all before it's treated as abandoned rather than
 * in-flight. DataHub answers in seconds in the ordinary case — this is a
 * generous multiple of that, wide enough that a live call in progress is
 * never mistaken for a crashed one, narrow enough that a genuine crash
 * doesn't strand an order for long.
 */
const STALE_CLAIM_MS = 5 * 60 * 1000

/**
 * What actually happened when something tried to settle an order.
 *
 * `applied: false` covers two very different situations, which is why
 * `conflict` exists to tell them apart. A plain duplicate — the exact outcome
 * this order was already settled with, arriving again — is expected and
 * boring (Paystack and DataHub both warn that their callbacks repeat). A
 * `conflict` is not: it means the outcome being reported now disagrees with
 * the one already settled, which is exactly the shape of a customer ending up
 * with both a bundle and a refund, or an agent credited for a sale that was
 * actually rejected. See `FulfilmentService.settle`.
 */
export interface SettleResult {
  applied: boolean
  conflict: boolean
  /** The outcome this order actually carries right now, when `applied` is false. */
  actualOutcome?: 'delivered' | 'rejected'
}

/**
 * Moves an order out of `processing` once the provider answers, and settles all
 * the money that depends on that answer.
 *
 * In production this is a BullMQ worker driven by the DataHub GH callback
 * (FR-4.4). Here it is an in-process timer calling the simulated adapter — same
 * boundary, same states, same ledger writes, so swapping the transport later does
 * not touch `settle()`.
 */
@Injectable()
export class FulfilmentService implements OnApplicationBootstrap {
  private readonly log = new Logger(FulfilmentService.name)
  private readonly pending = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly supplier: SupplierService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * NFR-3.2 / NFR-3.3 — recover orders that were mid-flight when the process
   * stopped. Without this an API restart during acceptance testing leaves paid
   * orders stuck in `processing` forever, with the money already debited.
   */
  async onApplicationBootstrap(): Promise<void> {
    const stranded = await this.prisma.order.findMany({
      // Only orders the provider never accepted. One that already has a
      // providerReference is theirs now, and re-dispatching it would buy a
      // second bundle — their API has no idempotency key to protect us.
      //
      // `awaiting_payment` is deliberately absent: nobody has paid for those, and
      // sweeping them here is exactly how an unpaid order got delivered free.
      //
      // `Order.providerReference` alone is not proof of anything: it is set by
      // a *second*, later write (`run()` below) after the purchase already
      // happened — see `SupplierService.dispatch`, which writes the
      // `SupplierDispatch` row, `providerReference` and `providerCharged`
      // included, in the very same call that makes the real purchase, before
      // this order's own column is ever touched. A crash in that window
      // leaves `providerReference` null despite the float already being
      // spent, and this sweep would otherwise buy the bundle a second time.
      // The dispatch row is the one write that actually survives that crash.
      where: {
        status: { in: ['pending', 'processing'] },
        providerReference: null,
        dispatches: {
          /**
           * `outcome: 'unknown'` added alongside the two existing real-answer
           * fields — DataHub genuinely answered for this order once already,
           * just ambiguously (a timeout or a 5xx), and `DispatchResult`'s own
           * doc comment already says that must NOT be guessed at by retrying,
           * only parked for a human. Without this, every order left `unknown`
           * had both fields null forever, so this sweep re-dispatched it —
           * for real — on every subsequent restart or deploy.
           */
          none: {
            OR: [{ providerReference: { not: null } }, { providerCharged: { not: null } }, { outcome: 'unknown' }],
          },
        },
      },
      select: { id: true, reference: true },
      take: 200,
    })

    if (stranded.length === 0) return

    this.log.warn(`recovering ${stranded.length} order(s) left in processing by a restart`)
    // Staggered so a large backlog does not open 200 transactions at once.
    stranded.forEach((order, index) => this.schedule(order.id, 500 + index * 150))
  }

  /** Ask the provider after its usual latency. */
  scheduleFor(orderId: string): void {
    this.schedule(orderId, this.supplier.delayMs)
  }

  private schedule(orderId: string, delayMs: number): void {
    // Guard against two timers for one order — a recovery sweep racing a fresh
    // placement would otherwise dispatch twice.
    if (this.pending.has(orderId)) return

    const timer = setTimeout(() => {
      this.pending.delete(orderId)
      void this.run(orderId).catch((error) =>
        this.log.error(`fulfilment failed for ${orderId}: ${String(error)}`),
      )
    }, delayMs)

    // Do not hold the event loop open on shutdown for a pending simulated call.
    timer.unref?.()
    this.pending.set(orderId, timer)
  }

  private async run(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) return

    // Idempotency: a replayed callback, a recovery sweep, and the original timer
    // can all arrive. Only a non-terminal order is still settleable.
    if (order.status === 'completed' || order.status === 'failed') return

    /**
     * Claimed atomically, not read-then-called.
     *
     * The check above proves nothing about what is still true by the time
     * `supplier.dispatch` actually runs — a replayed webhook wake-up, the
     * restart-recovery sweep, and the originally scheduled timer can all
     * reach here for the same order, and `dispatch` places a real purchase
     * with no idempotency key of DataHub's own to protect a retry. Only the
     * caller that wins this write may call it; every other caller sees
     * `count: 0` and stops here, before ever placing a second real purchase.
     * `this.pending`'s in-process map already guards one Node instance
     * against itself; this is the same guard made to actually hold across
     * more than one.
     *
     * Left set afterward, not released — `dispatch` is meant to run at most
     * once per order, ever. The one case let back in: a claim old enough
     * that whoever made it must have crashed before `dispatch` ever
     * answered — no `SupplierDispatch` row exists at all to say otherwise,
     * and DataHub answers well inside this window in the ordinary case. That
     * mirrors the tolerance `onApplicationBootstrap`'s own sweep already
     * accepts for exactly this scenario; without it, a crash in that narrow
     * window would strand the order in `processing` forever instead of the
     * restart recovering it.
     */
    const claim = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        status: { notIn: ['completed', 'failed'] },
        OR: [
          { dispatchClaimedAt: null },
          { dispatchClaimedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) }, dispatches: { none: {} } },
        ],
      },
      data: { dispatchClaimedAt: new Date() },
    })
    if (claim.count === 0) return

    await this.dispatchAndHandle(order, 1)
  }

  /**
   * An admin re-attempts dispatch for an order stuck exactly the one way
   * nothing here can ever resolve on its own: the purchase call timed out
   * before any reply arrived at all, so no `providerReference` exists —
   * `ReconcilerService.sweep()`'s active check is scoped to
   * `providerReference: { not: null }` and can never ask about this one.
   * `run()`'s own claim would otherwise block a second attempt forever, by
   * design; this is the one deliberate, authorised exception to it, and only
   * for that exact case — not for a reference DataHub already accepted (the
   * reconciler is already checking that one) and not for anything already
   * terminal.
   *
   * Safe specifically because a person, not this code, has already done the
   * one check that actually answers whether a retry is safe: looking up the
   * recipient directly in DataHub's own dashboard. `note` is required and
   * kept on the record for exactly that reason — it is the evidence the
   * retry was authorised on, not a rubber stamp.
   */
  async retryDispatch(orderId: string, adminId: string, note: string): Promise<void> {
    const reason = note.trim()
    if (reason.length < 5) {
      throw new ValidationError('Say what you checked before retrying. It is kept on the record.')
    }

    const order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundError('We could not find that order.')
    if (order.status === 'completed' || order.status === 'failed') {
      throw new ConflictError('ALREADY_SETTLED', `This order is already ${order.status}.`)
    }

    const lastDispatch = await this.prisma.supplierDispatch.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    })
    if (!lastDispatch || lastDispatch.outcome !== 'unknown' || lastDispatch.providerReference) {
      throw new ConflictError(
        'NOT_RETRYABLE',
        'Only an order whose last attempt came back unresolved, with no reference from the delivery partner, can be retried by hand.',
      )
    }

    const reclaim = await this.prisma.order.updateMany({
      where: { id: orderId, status: { notIn: ['completed', 'failed'] } },
      data: { dispatchClaimedAt: new Date() },
    })
    if (reclaim.count === 0) {
      throw new ConflictError('ALREADY_SETTLED', 'This order was settled just now — refresh and check.')
    }

    this.log.warn(`${order.reference}: admin ${adminId} retrying dispatch by hand — ${reason}`)
    await this.dispatchAndHandle(order, lastDispatch.attempt + 1)
  }

  /**
   * Re-attempt a failed order whose refund has not been paid yet, when
   * whatever caused the rejection turns out not to apply any more — a
   * catalogue mapping that came back, a stock line that refilled.
   *
   * Deliberately not gated the way `retryDispatch` is. That gate exists
   * because an `unknown` outcome is genuinely ambiguous — the purchase may or
   * may not have gone through — and only a person checking the provider's own
   * dashboard can tell. A `rejected` outcome carries none of that: DataHub, or
   * our own validation before ever reaching them, said no outright. Nothing was
   * purchased, so there is nothing a second attempt could duplicate.
   *
   * Gated on the refund instead. Reordering is only meaningful while it is
   * still `pending` — once it is approved or paid, the money is already gone
   * or already promised, and reordering on top of that hands the customer both
   * the refund and the bundle.
   *
   * `supplierCode` is chosen by the admin from the live catalogue, not reused
   * from the order's own `supplierCodeAtSale` — see `ReorderDto.supplierCode`'s
   * own comment for why silently reusing it is exactly the failure mode this
   * whole method exists to route around. Re-validated here regardless of
   * what the client claims to have shown: never trust a request body for
   * something that is about to drive a real purchase.
   */
  async reorder(orderId: string, adminId: string, note: string, supplierCode: string): Promise<void> {
    const reason = note.trim()
    if (reason.length < 5) {
      throw new ValidationError('Say why this is being reordered. It is kept on the record.')
    }

    const code = supplierCode.trim()
    if (!code) {
      throw new ValidationError('Choose which bundle this should be fulfilled against.')
    }

    const order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundError('We could not find that order.')
    if (order.status !== 'failed') {
      throw new ConflictError('NOT_RETRYABLE', 'Only a failed order can be reordered.')
    }

    /**
     * The same checks `dispatchLive` itself would make, run up front — so a
     * bad or stale choice is refused here, before the refund is ever put on
     * hold, rather than surfacing as another confusing "rejected" dispatch.
     */
    const supplier = await this.prisma.supplierProduct.findUnique({ where: { code } })
    if (!supplier) {
      throw new ValidationError('That is not a bundle we know about — choose one from the list.')
    }
    if (!supplier.available) {
      throw new ValidationError(`${supplier.name} is currently out of stock at ${supplier.provider}.`)
    }
    if (!supplier.networkKey || !supplier.capacityGb) {
      throw new ValidationError(`${supplier.name} has no automated fulfilment — choose a data bundle.`)
    }

    /**
     * Claims the refund itself, not just the order.
     *
     * `RefundsService.approve` only ever checks the refund's own status, never
     * the order's, so this is the one write that actually stops a concurrent
     * approval from paying out money a successful reorder is about to make
     * unowed. Restored below if the reorder does not end up delivering.
     */
    const claimRefund = await this.prisma.refundRequest.updateMany({
      where: { orderId, status: 'pending' },
      data: {
        status: 'rejected',
        decidedBy: adminId,
        decidedAt: new Date(),
        note: `On hold — reordering by hand: ${reason}`,
      },
    })
    if (claimRefund.count === 0) {
      throw new ConflictError(
        'ALREADY_SETTLED',
        'This refund is no longer pending — refresh and check before reordering.',
      )
    }

    const reclaimOrder = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'failed' },
      data: { status: 'processing', dispatchClaimedAt: new Date(), supplierCodeAtSale: code },
    })
    if (reclaimOrder.count === 0) {
      // The order moved before the reclaim above landed — nothing is actually
      // being reordered, so the refund is still genuinely owed. Undo the hold.
      await this.prisma.refundRequest.updateMany({
        where: { orderId, status: 'rejected', decidedBy: adminId },
        data: { status: 'pending', decidedBy: null, decidedAt: null, note: null },
      })
      throw new ConflictError('ALREADY_SETTLED', 'This order changed just now — refresh and check.')
    }

    const lastDispatch = await this.prisma.supplierDispatch.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    })

    this.log.warn(
      `${order.reference}: admin ${adminId} reordering against ${code} ` +
        `(was ${order.supplierCodeAtSale ?? 'none'}) — ${reason}`,
    )
    await this.dispatchAndHandle({ ...order, supplierCodeAtSale: code }, (lastDispatch?.attempt ?? 0) + 1)

    const after = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true } })
    if (after?.status === 'failed') {
      // Rejected again, cleanly — still genuinely owed. Restore the hold.
      await this.prisma.refundRequest.updateMany({
        where: { orderId, status: 'rejected', decidedBy: adminId },
        data: { status: 'pending', decidedBy: null, decidedAt: null, note: null },
      })
    } else if (after?.status === 'completed') {
      // Delivered after all — the hold above is now permanent. Reword it so
      // it reads as a settled outcome rather than a still-open one.
      await this.prisma.refundRequest.updateMany({
        where: { orderId, status: 'rejected', decidedBy: adminId },
        data: { note: `Reordered and delivered — ${reason}` },
      })
    }
    // `processing` (`pending`/`unknown` again): left on hold on purpose —
    // restoring it before this new attempt resolves would reopen exactly the
    // ambiguity this method exists to avoid. It surfaces again on the Needs
    // Attention page like any other unresolved dispatch.
  }

  /**
   * Everything from the actual purchase call onward — shared by the normal
   * automatic path (`run`, always `attempt: 1`), `retryDispatch`, and
   * `reorder` (whatever attempt number comes next), so all three can never
   * handle the same result two different ways.
   */
  private async dispatchAndHandle(order: Order, attempt: number): Promise<void> {
    const orderId = order.id
    const result = await this.supplier.dispatch(order, attempt)

    // Only terminal outcomes settle. `pending` means DataHub has the order and
    // will report back; `unknown` means we cannot tell what happened and must
    // not guess in either direction. Both leave the order in `processing`, where
    // the webhook or the reconciler will find it.
    if (result.outcome === 'pending') {
      /**
       * The float moved the moment DataHub accepted this — not once we later
       * settle it as delivered or rejected. Booking the real cost here, the
       * instant it's known, rather than waiting for that later moment is what
       * keeps `FloatMonitorService.expectedBalance` honest while an order
       * sits in this state: without it, an order that's genuinely still
       * awaiting DataHub's webhook makes the float look short by exactly its
       * cost, and the low-float alert reads that as a missing top-up.
       *
       * Safe to book twice: `recordDelivered` and the rejected branch below
       * both write this exact same idempotency key once the order actually
       * settles, and `LedgerService.record` skips a duplicate rather than
       * writing it again — so whichever of the two runs first is the one
       * that sticks, and the amount is identical either way since both read
       * the same `SupplierDispatch.providerCharged`.
       */
      if (result.providerCharged != null) {
        const believedCost = (order.split as unknown as OrderSplit).supplierCost
        await this.ledger.record([
          {
            idempotencyKey: LedgerService.key('order', order.reference, 'supplier_cost'),
            kind: 'supplier_cost',
            amount: -result.providerCharged,
            description:
              `Bundle cost · ${order.productName} (charged by DataHub; not yet settled)` +
              (result.providerCharged !== believedCost
                ? ` (expected ${(believedCost / 100).toFixed(2)}, charged ${(result.providerCharged / 100).toFixed(2)})`
                : ''),
            orderRef: order.reference,
            occurredAt: new Date(),
          },
        ])
      }

      await this.prisma.order.update({
        where: { id: orderId },
        data: { providerReference: result.providerReference ?? null },
      })
      return
    }

    if (result.outcome === 'unknown') {
      // No automatic refund and no automatic retry — see DispatchResult.outcome.
      // An admin can still retry this by hand, once they've checked the
      // delivery partner's own dashboard for this recipient — see `retryDispatch`.
      this.log.error(
        `${order.reference} left unresolved and needs manual checking: ${result.reason ?? ''}`,
      )
      return
    }

    if (result.outcome === 'needs_approval') {
      await this.holdForApproval(order, result.reason ?? '')
      return
    }

    await this.settle(orderId, result.outcome, result.reason, result.voucher)
  }

  /**
   * Park a paid order until the provider approves the recipient's number.
   *
   * The money stays where it is. That is the whole point of the state: the
   * bundle is fine, the customer paid, and the only thing missing is a one-time
   * approval that somebody has to grant. Refunding would close a sale that will
   * go through perfectly well in an hour.
   *
   * It is also why the hold has an expiry. Approval is manual on DataHub's side
   * with no promised turnaround, and holding a stranger's money indefinitely on
   * the strength of "it should come through" is not a trade the customer agreed
   * to. `ReconcilerService` refunds anything still waiting past
   * APPROVAL_HOLD_HOURS.
   */
  private async holdForApproval(
    order: { id: string; reference: string; recipient: string; productName: string },
    reason: string,
  ): Promise<void> {
    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'awaiting_approval' },
    })

    const supplier = await this.prisma.order
      .findUnique({
        where: { id: order.id },
        select: { product: { select: { supplier: { select: { networkKey: true } } } } },
      })
      .then((row) => row?.product?.supplier ?? null)

    // The registry the admin screen reads. Upserted rather than inserted because
    // one number can hold up several orders.
    await this.prisma.beneficiaryRequest.upsert({
      where: { phone: order.recipient },
      create: {
        phone: order.recipient,
        networkKey: supplier?.networkKey ?? 'YELLO',
        lastProduct: order.productName,
      },
      update: {
        attempts: { increment: 1 },
        lastProduct: order.productName,
        approvedAt: null,
      },
    })

    this.log.warn(
      `${order.reference} held: ${order.recipient} needs DataHub approval (${reason})`,
    )
  }

  /**
   * Book the costs of a delivered order.
   *
   * Two costs, and they are recognised here rather than at payment because this
   * is the moment they become real: nothing is owed to a supplier or an agent for
   * an order that failed.
   *
   * The supplier figure prefers what the provider actually charged over what we
   * expected to pay. The two differ in practice — DataHub's catalogue listed a
   * bundle at GHS 4.70 and billed GHS 4.20 — and a margin measured against the
   * estimate is wrong by the difference on every single sale.
   */
  private async recordDelivered(
    tx: Prisma.TransactionClient,
    order: {
      id: string
      reference: string
      productName: string
      paidWith: string
      salePrice: number
      buyerUserId: string | null
    },
    split: OrderSplit,
    agentShares: OrderSplit['shares'],
  ): Promise<void> {
    const dispatch = await tx.supplierDispatch.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' },
      select: { providerCharged: true, costPrice: true, supplierCode: true },
    })

    /**
     * This dispatch's own reply beats everything — it is this exact delivery.
     * Absent that, a real charge from a sibling sale of the same bundle is
     * still worth more than `costPrice`/`split.supplierCost`, which are only
     * ever a guess frozen in before anyone had proof — see `lastRealCost`.
     * Only once there is no real number anywhere does this fall back to that
     * guess.
     */
    const actualCost =
      dispatch?.providerCharged ??
      (await lastRealCost(tx, dispatch?.supplierCode)) ??
      dispatch?.costPrice ??
      split.supplierCost
    const estimated = split.supplierCost

    const entries: (LedgerDraft & { idempotencyKey: string })[] = [
      {
        idempotencyKey: LedgerService.key('order', order.reference, 'supplier_cost'),
        kind: 'supplier_cost',
        amount: -actualCost,
        description:
          `Bundle cost · ${order.productName}` +
          (actualCost !== estimated
            ? ` (expected ${(estimated / 100).toFixed(2)}, charged ${(actualCost / 100).toFixed(2)})`
            : ''),
        orderRef: order.reference,
        occurredAt: new Date(),
      },
    ]

    /**
     * A Mobile Money order's revenue is booked when Paystack confirms the
     * payment (`PaymentsService.applyPaid`) — this order's `Payment` row is
     * what triggers that. A wallet order has no `Payment` row at all: the cash
     * was already collected and recognised back when the wallet was topped
     * up, so nothing ever books the *sale* itself. Without this, every wallet
     * sale posts a real supplier cost and agent margin against zero revenue —
     * permanently understating profit by the full sale price of every wallet
     * purchase.
     */
    if (order.paidWith === 'wallet') {
      entries.push({
        idempotencyKey: LedgerService.key('order', order.reference, 'revenue'),
        kind: 'revenue',
        amount: order.salePrice,
        description: `Sale · ${order.productName} (from wallet)`,
        orderRef: order.reference,
        userId: order.buyerUserId,
        occurredAt: new Date(),
      })
    }

    for (const share of agentShares) {
      entries.push({
        /**
         * Still keyed per user, though a sale now has only one agent in it.
         *
         * A referrer used to take a slice of James's margin and appear as a second
         * agent share; that was removed at the client's request. The key keeps the
         * user in it anyway, because it costs nothing and the alternative is a
         * scheme that silently collides the day a sale involves two agents again.
         */
        idempotencyKey: LedgerService.key(
          'order',
          order.reference,
          'agent_margin',
          share.userId,
        ),
        kind: 'agent_margin',
        amount: -share.margin,
        description: `Agent margin · ${share.name}`,
        orderRef: order.reference,
        userId: share.userId,
        occurredAt: new Date(),
      })
    }

    await this.ledger.record(entries, tx)
  }

  /**
   * Settle from an outside signal — DataHub's webhook, or the reconciler having
   * asked them directly. Public because both live outside this class, and both
   * must land in exactly the same ledger code as a simulated settlement.
   */
  async settleFromProvider(
    orderId: string,
    outcome: 'delivered' | 'rejected',
    reason?: string,
    voucher?: { serial: string; pin: string },
    resolvedManually = false,
  ): Promise<SettleResult> {
    return this.settle(orderId, outcome, reason, voucher, resolvedManually)
  }

  /**
   * An already-terminal order was just told a *different* outcome than the
   * one it was settled with. Flag it once — a repeat of the same conflict
   * (a retried webhook, say) must not keep overwriting the first note — and
   * log loudly. This is the one place all three settlement sources (webhook,
   * reconciler sweep, manual resolution) funnel through, so it is the one
   * place capable of ever noticing this at all.
   *
   * Deliberately does not attempt to undo anything. The money may already be
   * wrong in a way nothing here can safely guess how to fix — see the file
   * header on `SettleResult` — so this only makes sure a human finds out,
   * via the Needs Attention page (`ReconcilerService.needsAttention`).
   */
  private async flagConflict(
    tx: Prisma.TransactionClient,
    order: { id: string; reference: string; conflictNote: string | null },
    actualOutcome: 'delivered' | 'rejected',
    reportedOutcome: 'delivered' | 'rejected',
    reason?: string,
  ): Promise<void> {
    if (order.conflictNote) return // already flagged; do not clobber the original note

    const note =
      `Already settled as ${actualOutcome}, but a later signal reported ${reportedOutcome}` +
      (reason ? ` (${reason})` : '') +
      '. Check this order was not paid out and refunded, or delivered and rejected, at once.'

    await tx.order.update({ where: { id: order.id }, data: { conflictNote: note } })
    this.log.error(
      `CONFLICTING SETTLEMENT ${order.reference}: already ${actualOutcome}, now told ${reportedOutcome} — flagged for review`,
    )
  }

  /**
   * Apply the provider's answer and settle every account it touches, in one
   * transaction. Either the order completes and everybody in the chain is
   * credited, or it fails and everybody is made whole — never half of each.
   */
  private async settle(
    orderId: string,
    outcome: 'delivered' | 'rejected',
    reason?: string,
    voucher?: { serial: string; pin: string },
    resolvedManually = false,
  ): Promise<SettleResult> {
    return this.prisma.$transaction(async (tx) => {
      // Re-read inside the transaction; the status may have moved since dispatch.
      const order = await tx.order.findUnique({ where: { id: orderId } })
      if (!order) return { applied: false, conflict: false }

      if (order.status === 'completed' || order.status === 'failed') {
        const actualOutcome = order.status === 'completed' ? 'delivered' : 'rejected'
        if (actualOutcome !== outcome) {
          await this.flagConflict(tx, order, actualOutcome, outcome, reason)
          return { applied: false, conflict: true, actualOutcome }
        }
        // The exact same outcome, told again — a boring, expected replay.
        return { applied: false, conflict: false, actualOutcome }
      }

      const split = order.split as unknown as OrderSplit
      const agentShares = split.shares.filter((s) => s.role === 'agent' && s.margin > 0)

      if (outcome === 'delivered') {
        /**
         * Claimed atomically, not just read-then-branched.
         *
         * The `findUnique` above proves nothing about what is still true by the
         * time this write runs — the DataHub webhook, the reconciler's regular
         * sweep, and its stale-approval expiry can all call `settle` for the
         * same order. Postgres locks the row this UPDATE matches, so a second
         * settlement racing this one blocks until this commits, then re-checks
         * its own WHERE clause against the now-current status and claims
         * nothing. Only the transaction that actually wins this update may
         * credit anyone or book anything below — the alternative let one order
         * be completed AND rejected at once: agent paid, cost booked, and the
         * customer queued for a refund on the same sale.
         */
        const claim = await tx.order.updateMany({
          where: { id: orderId, status: { notIn: ['completed', 'failed'] } },
          data: {
            status: 'completed',
            completedAt: new Date(),
            voucherSerial: voucher?.serial ?? null,
            voucherPin: voucher?.pin ?? null,
            resolvedManually,
          },
        })
        if (claim.count === 0) {
          // Lost the race — something else settled this order first, in the
          // moment between the read above and this write. Read-committed
          // isolation means the winner's write is now visible here.
          const now = await tx.order.findUniqueOrThrow({
            where: { id: orderId },
            select: { status: true, conflictNote: true },
          })
          const actualOutcome = now.status === 'completed' ? 'delivered' : 'rejected'
          if (actualOutcome !== outcome) {
            await this.flagConflict(tx, { ...order, conflictNote: now.conflictNote }, actualOutcome, outcome, reason)
          }
          return { applied: false, conflict: actualOutcome !== outcome, actualOutcome }
        }

        // Split-at-sale: the seller's margin and their referrer's bonus are both
        // credited the moment the order completes, so an agent sees a referral
        // bonus land without anybody running a payout job.
        for (const share of agentShares) {
          await this.creditAgent(tx, share, order.reference, order.productName, order.recipient)
        }

        await this.recordDelivered(tx, order, split, agentShares)
        return { applied: true, conflict: false }
      }

      /**
       * Was any money actually taken for this order?
       *
       * Everything below turns on it. A wallet order was paid when the wallet was
       * topped up; a Mobile Money order was paid only if Paystack says so. An
       * order that failed *before* payment — an abandoned checkout, a recipient
       * the supplier refused while the customer was still on the payment page —
       * took nothing, so there is nothing to give back.
       *
       * Getting this wrong is not a rounding error. It told eight customers they
       * were owed GHS 196 they had never paid, put that on the books as a
       * liability, and would have sent each of them a claim link for it.
       */
      const payment = await tx.payment.findUnique({
        where: { orderId: order.id },
        select: { status: true, network: true },
      })
      const collected = order.paidWith === 'wallet' || payment?.status === 'paid'

      // Same atomic claim as the delivered branch above — see that comment.
      // `refunded` says on the receipt that money has gone back. It has not
      // yet — it is owed, and a person has to authorise paying it.
      const claim = await tx.order.updateMany({
        where: { id: orderId, status: { notIn: ['completed', 'failed'] } },
        data: { status: 'failed', refunded: false, resolvedManually },
      })
      if (claim.count === 0) {
        // Same race as the delivered branch above — see that comment.
        const now = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { status: true, conflictNote: true },
        })
        const actualOutcome = now.status === 'completed' ? 'delivered' : 'rejected'
        if (actualOutcome !== outcome) {
          await this.flagConflict(tx, { ...order, conflictNote: now.conflictNote }, actualOutcome, outcome, reason)
        }
        return { applied: false, conflict: actualOutcome !== outcome, actualOutcome }
      }

      /**
       * A rejection does not mean nothing was spent.
       *
       * DataHub deducts the float the moment it *accepts* a purchase — see
       * `SupplierService.dispatchLive`, which records `providerCharged` and the
       * new float balance right there, before the real outcome is known. If the
       * final answer is still a rejection, that deduction already happened and
       * is real money gone, not a cost avoided. Without booking it, the float
       * genuinely drops by this amount and nothing on the ledger explains why —
       * `FloatMonitorService.reconcile` then misdiagnoses the gap as an
       * unlogged top-up or withdrawal instead of the order that actually caused it.
       */
      const dispatch = await tx.supplierDispatch.findFirst({
        where: { orderId: order.id },
        orderBy: { createdAt: 'desc' },
        select: { providerCharged: true },
      })
      if (dispatch?.providerCharged) {
        await this.ledger.record(
          [
            {
              idempotencyKey: LedgerService.key('order', order.reference, 'supplier_cost'),
              kind: 'supplier_cost',
              amount: -dispatch.providerCharged,
              description: `Bundle cost · ${order.productName} (charged before the order was rejected)`,
              orderRef: order.reference,
              occurredAt: new Date(),
            },
          ],
          tx,
        )
      }

      /**
       * FR-2.7 — the debt is recorded here; paying it is a decision.
       *
       * This used to credit the wallet or issue a claim link immediately, which
       * was faster for the customer and removed the only control that matters on
       * money leaving: somebody deciding it is owed. That mattered in practice —
       * a rule that refunded every failed order paid eight customers GHS 196 they
       * had never paid, and nothing stood between the bug and the money.
       *
       * The obligation starts now, not at approval: `SolvencyService` counts a
       * pending request against the balance, so the money is never treated as
       * spendable while it is queued.
       */
      if (collected) {
        await tx.refundRequest.upsert({
          where: { orderId: order.id },
          create: {
            orderId: order.id,
            orderRef: order.reference,
            productName: order.productName,
            buyerName: order.buyer,
            buyerPhone: order.buyerPhone,
            amount: order.salePrice,
            // A guest is paid back on the rail they paid from. `claimable`
             // is never chosen any more: nothing ever implemented claiming, so
             // money parked there could be listed and never collected.
            method: order.paidWith === 'wallet' && order.buyerUserId ? 'wallet' : 'transfer',
            reason: reason ?? 'The delivery partner could not complete this order.',
            // Known already, when Paystack reported it on the way in — see
            // `PaystackClient.verify`. Still shown to whoever approves, and
            // still changeable there; this only saves asking when the answer
            // is already on file.
            momoNetwork: payment?.network ?? null,
          },
          // A second failure on the same order does not owe twice.
          update: {},
        })
        this.log.warn(
          `${order.reference}: GHS ${(order.salePrice / 100).toFixed(2)} owed back — awaiting approval`,
        )
      }

      // Nobody profits from a failed delivery.
      for (const share of agentShares) {
        await this.reverseAgent(tx, share, order.reference, order.productName)
      }

      // No refund entry on the ledger yet. The money has not moved, and booking
      // a cost for a payment nobody has authorised would misstate profit for as
      // long as the request sits in the queue. `RefundsService` writes it when the
      // refund is actually paid.

      this.log.warn(`failed ${order.reference}: ${reason ?? 'provider rejected'}`)
      return { applied: true, conflict: false }
    })
  }

  /**
   * Credit one agent's margin and append the ledger row.
   *
   * The `(userId, reference, type)` unique index makes this safe to run twice:
   * a duplicated callback hits the constraint and the balance is not touched
   * again. Checked first so a legitimate re-run is a no-op rather than a 500.
   */
  private async creditAgent(
    tx: Prisma.TransactionClient,
    share: SplitShare,
    reference: string,
    productName: string,
    recipient: string,
  ): Promise<void> {
    // `downline` never actually fires today: `splitFor` (domain/pricing.ts)
    // only ever emits agent shares at depth 0 now that multi-level referral
    // sharing has been removed, so this branch is kept only so a historical
    // pre-removal row still reads correctly, not because a live sale can
    // still produce one. `AgentsService.downline()`'s "earned for upline"
    // figure is downstream of this and will correctly read zero forever.
    const type = share.depth === 0 ? 'sale' : 'downline'

    const already = await tx.earning.findUnique({
      where: { userId_reference_type: { userId: share.userId, reference, type } },
      select: { id: true },
    })
    if (already) return

    // The agent may have been deleted between placement and settlement.
    const agent = await tx.user.findUnique({
      where: { id: share.userId },
      select: { id: true },
    })
    if (!agent) {
      this.log.warn(`share for missing user ${share.userId} on ${reference} — skipped`)
      return
    }

    const updated = await tx.user.update({
      where: { id: share.userId },
      data: { balance: { increment: share.margin } },
      select: { balance: true },
    })

    await tx.earning.create({
      data: {
        userId: share.userId,
        type,
        amount: share.margin,
        balanceAfter: updated.balance,
        description:
          share.depth === 0
            ? `Your sale · ${productName} → ${recipient}`
            // depth 1 is the seller's referrer, paid a bonus out of James's
            // margin rather than a margin of their own.
            : `Referral bonus · ${productName} sold by your referral`,
        productName,
        reference,
        depth: share.depth,
      },
    })
  }

  private async reverseAgent(
    tx: Prisma.TransactionClient,
    share: SplitShare,
    reference: string,
    productName: string,
  ): Promise<void> {
    const already = await tx.earning.findUnique({
      where: { userId_reference_type: { userId: share.userId, reference, type: 'reversal' } },
      select: { id: true },
    })
    if (already) return

    /**
     * There is nothing to reverse unless this agent was actually credited for
     * THIS order. `creditAgent` only ever runs on the `delivered` branch of
     * `settle`, and `settle`'s own guard means an order only ever takes one of
     * `delivered`/`rejected` — so a normal rejection reaches here having never
     * credited anyone. Without this check, every rejected order with an agent
     * share silently debited that agent's balance for money earned on
     * unrelated past sales, logged as a "reversal" of something that never
     * happened. This only proceeds for the one legitimate case: an order that
     * really was credited earlier and is now being unwound.
     */
    const credited = await tx.earning.findFirst({
      where: { userId: share.userId, reference, type: { in: ['sale', 'downline'] } },
      select: { id: true },
    })
    if (!credited) return

    /**
     * Clamped and decremented in one atomic statement, not read-then-decided.
     *
     * The old shape read `agent.balance` in JS, computed `recoverable` from
     * that snapshot, and decremented separately below. Two orders for the
     * *same* agent failing at nearly the same time (a webhook and the
     * reconciler sweep landing close together, say) could both read the same
     * pre-reversal balance and both compute a `recoverable` as if the whole
     * thing were still theirs to claim. Whichever committed second then drove
     * the decrement below zero, tripping `CHECK (balance >= 0)` and rolling
     * back the *entire* enclosing transaction — including the order's own
     * flip to `failed` and its `RefundRequest`, stranding a genuinely failed
     * order with no bundle and no refund queued.
     *
     * `GREATEST(balance - margin, 0)` inside a single `UPDATE` never attempts
     * the illegal decrement in the first place, and Postgres's own row lock
     * for the duration of that statement serializes two concurrent reversals
     * on the same agent — the second one's `GREATEST` sees the *already*
     * reduced balance, not a stale one, so it clamps correctly instead of
     * double-claiming the same headroom.
     */
    const rows = await tx.$queryRaw<{ old_balance: number; new_balance: number }[]>`
      WITH prior AS (SELECT balance FROM users WHERE id = ${share.userId} FOR UPDATE)
      UPDATE users u
      SET balance = GREATEST(u.balance - ${share.margin}, 0)
      FROM prior
      WHERE u.id = ${share.userId}
      RETURNING u.balance AS new_balance, prior.balance AS old_balance
    `
    const claimed = rows[0]
    if (!claimed) return

    const recoverable = claimed.old_balance - claimed.new_balance
    const shortfall = share.margin - recoverable
    if (shortfall > 0) {
      this.log.warn(
        `partial reversal on ${reference}: wanted ${share.margin}p, recovered ${recoverable}p from ${share.userId}`,
      )
      /**
       * The uncollected part is not merely logged — it is a real, permanent
       * loss (the agent already spent it) that would otherwise have no trace
       * anywhere on the business's own books. `balancesMatchLedgers` in
       * `money-audit.ts` cannot catch this either way, since the agent's own
       * balance and Earning rows stay internally consistent regardless — this
       * is the only place the shortfall itself is recorded.
       */
      await this.ledger.record(
        [
          {
            idempotencyKey: LedgerService.key('order', reference, 'agent_margin_writeoff', share.userId),
            kind: 'agent_margin_writeoff',
            amount: -shortfall,
            description: `Uncollectable margin · ${productName} (agent had already withdrawn it)`,
            orderRef: reference,
            userId: share.userId,
            occurredAt: new Date(),
          },
        ],
        tx,
      )
    }
    if (recoverable === 0) return

    // Already decremented above, atomically — nothing left to write here but
    // the record of it.
    await tx.earning.create({
      data: {
        userId: share.userId,
        type: 'reversal',
        amount: -recoverable,
        balanceAfter: claimed.new_balance,
        description: `Reversed · ${productName} failed at provider`,
        productName,
        reference,
        depth: share.depth,
      },
    })
  }

  private async refundWallet(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    reference: string,
    productName: string,
  ): Promise<void> {
    const already = await tx.transaction.findUnique({
      where: { userId_reference_type: { userId, reference, type: 'refund' } },
      select: { id: true },
    })
    if (already) return

    const updated = await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: amount } },
      select: { balance: true },
    })

    await tx.transaction.create({
      data: {
        userId,
        type: 'refund',
        amount,
        balanceAfter: updated.balance,
        description: `Refund · ${productName} failed at provider`,
        reference,
      },
    })
  }
}
