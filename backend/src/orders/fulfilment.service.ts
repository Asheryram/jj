import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SupplierService } from '../supplier/supplier.service'
import { LedgerService, type LedgerDraft } from '../finance/ledger.service'
import type { OrderSplit, SplitShare } from '../domain/pricing'

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
      where: { status: { in: ['pending', 'processing'] }, providerReference: null },
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

    const result = await this.supplier.dispatch(order)

    // Only terminal outcomes settle. `pending` means DataHub has the order and
    // will report back; `unknown` means we cannot tell what happened and must
    // not guess in either direction. Both leave the order in `processing`, where
    // the webhook or the reconciler will find it.
    if (result.outcome === 'pending') {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { providerReference: result.providerReference ?? null },
      })
      return
    }

    if (result.outcome === 'unknown') {
      // Deliberately no refund and no retry — see DispatchResult.outcome.
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
    order: { id: string; reference: string; productName: string },
    split: OrderSplit,
    agentShares: OrderSplit['shares'],
  ): Promise<void> {
    const dispatch = await tx.supplierDispatch.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' },
      select: { providerCharged: true, costPrice: true, supplierCode: true },
    })

    const actualCost = dispatch?.providerCharged ?? dispatch?.costPrice ?? split.supplierCost
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
  ): Promise<void> {
    await this.settle(orderId, outcome, reason, voucher)
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
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Re-read inside the transaction; the status may have moved since dispatch.
      const order = await tx.order.findUnique({ where: { id: orderId } })
      if (!order || order.status === 'completed' || order.status === 'failed') return

      const split = order.split as unknown as OrderSplit
      const agentShares = split.shares.filter((s) => s.role === 'agent' && s.margin > 0)

      if (outcome === 'delivered') {
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'completed',
            completedAt: new Date(),
            voucherSerial: voucher?.serial ?? null,
            voucherPin: voucher?.pin ?? null,
          },
        })

        // Split-at-sale: the seller's margin and their referrer's bonus are both
        // credited the moment the order completes, so an agent sees a referral
        // bonus land without anybody running a payout job.
        for (const share of agentShares) {
          await this.creditAgent(tx, share, order.reference, order.productName, order.recipient)
        }

        await this.recordDelivered(tx, order, split, agentShares)
        return
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

      await tx.order.update({
        where: { id: orderId },
        // `refunded` says on the receipt that money has gone back. It has not
        // yet — it is owed, and a person has to authorise paying it.
        data: { status: 'failed', refunded: false },
      })

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

    const agent = await tx.user.findUnique({
      where: { id: share.userId },
      select: { balance: true },
    })
    if (!agent) return

    // A reversal must never drive a balance negative — the agent may already have
    // withdrawn. Clamp to what is actually there and log the shortfall rather
    // than letting CHECK (balance >= 0) abort the whole refund.
    const recoverable = Math.min(share.margin, agent.balance)
    if (recoverable < share.margin) {
      this.log.warn(
        `partial reversal on ${reference}: wanted ${share.margin}p, recovered ${recoverable}p from ${share.userId}`,
      )
    }
    if (recoverable === 0) return

    const updated = await tx.user.update({
      where: { id: share.userId },
      data: { balance: { decrement: recoverable } },
      select: { balance: true },
    })

    await tx.earning.create({
      data: {
        userId: share.userId,
        type: 'reversal',
        amount: -recoverable,
        balanceAfter: updated.balance,
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
