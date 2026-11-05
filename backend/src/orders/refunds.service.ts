import { Injectable, Logger } from '@nestjs/common'
import type { Network } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../finance/ledger.service'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'
import { PaystackClient, refundTransferReference } from '../payments/paystack.client'
import { SettingsService } from '../settings/settings.service'
import { requirePaystackChecked } from '../common/paystack-check'
import { momoCodeFor } from '../payments/momo'
import { resalePriceFor, type OrderSplit, type PricingAgent } from '../domain/pricing'
import { FulfilmentService } from './fulfilment.service'
import { MIN_TRANSFER } from '../payments/transfer-limits'

/**
 * Paying back money that is owed, once a person has authorised it.
 *
 * The split between owing and paying is the whole design. `FulfilmentService`
 * records the debt when a delivery fails; nothing here runs until James decides.
 * That costs the customer time and buys the one control that matters on an
 * outbound payment, because the alternative was demonstrated: an automatic rule
 * credited eight customers GHS 196 they had never paid, and there was nothing in
 * between.
 *
 * Two things this service is careful about:
 *
 *  · **Deciding twice.** Approval moves money, so it is guarded inside the
 *    transaction by the request's own status rather than by a prior read. Two
 *    admins clicking at once, or one double-clicking, must not pay twice.
 *  · **Rejecting honestly.** A rejection is a refusal to return money somebody
 *    paid, so it requires a reason and keeps it. If it is ever disputed, the
 *    record says who decided and why.
 */
@Injectable()
export class RefundsService {
  private readonly log = new Logger(RefundsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly paystack: PaystackClient,
    private readonly settings: SettingsService,
    private readonly fulfilment: FulfilmentService,
  ) {}

  /** The queue. Pending first and oldest first, the longest wait is the worst. */
  async list(status?: 'pending' | 'approved' | 'rejected') {
    const rows = await this.prisma.refundRequest.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      // Just enough of the order to let the "Reorder" picker filter the
      // catalogue to bundles that could actually fulfil this one, and to show
      // what reordering would actually net after the agent's frozen share.
      include: {
        order: {
          select: {
            network: true,
            category: true,
            split: true,
            productId: true,
            soldByCode: true,
            status: true,
            resolvedManually: true,
          },
        },
      },
    })

    /**
     * What Paystack actually kept, per `Payment.fee`, not `split.processingFee`,
     * which is only the checkout estimate. Same figure and same reasoning as
     * `OrdersService.list`'s own `feeByOrderId`; null for a wallet-paid order,
     * whose fee (if any) was already paid once at top-up time, not again here.
     */
    const payments = await this.prisma.payment.findMany({
      where: { orderId: { in: rows.map((row) => row.orderId) } },
      select: { orderId: true, fee: true },
    })
    const feeByOrderId = new Map(payments.filter((p) => p.orderId).map((p) => [p.orderId as string, p.fee]))

    /**
     * Today's selling price for the same product, for the "Reorder" preview
     * to sanity-check against, an agent sale against that specific agent's
     * own current price, a direct sale against the standard one. Purely
     * informational: the amount actually owed is `row.amount`, frozen at
     * sale, regardless of what either price has done since.
     */
    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((row) => row.order.productId) } },
      select: { id: true, supplierCost: true, adminPrice: true, standardPrice: true },
    })
    const productById = new Map(products.map((p) => [p.id, p]))

    /**
     * The specific agent an order was sold through, resolved once for every
     * distinct `soldByCode` in this page, not the wholesale floor everyone
     * pays, but what *this* agent actually charges, explicit price or their
     * own default markup, exactly how a live checkout would price it (see
     * `resalePriceFor`). An agent who has since raised or lowered their own
     * price shows up here; admin's own wholesale price to agents is a
     * different, coarser number and is only the fallback once the agent
     * itself cannot be identified any more.
     */
    const soldByCodes = [...new Set(rows.map((row) => row.order.soldByCode).filter((c): c is string => c !== null))]
    const agentUsers = soldByCodes.length
      ? await this.prisma.user.findMany({
          where: { referralCode: { in: soldByCodes } },
          select: { id: true, referralCode: true, markupPercent: true },
        })
      : []
    const agentPrices = agentUsers.length
      ? await this.prisma.agentPrice.findMany({
          where: {
            userId: { in: agentUsers.map((a) => a.id) },
            productId: { in: rows.map((row) => row.order.productId) },
          },
          select: { userId: true, productId: true, resalePrice: true },
        })
      : []
    const agentByReferralCode = new Map(agentUsers.map((a) => [a.referralCode, a]))

    return rows.map((row) => {
      // Frozen at the original sale and unchanged by a reorder, `settle`'s
      // delivered branch always pays an agent this exact amount regardless of
      // what the SKU costs today, so it is the one number the "Reorder" modal
      // needs to turn a live cost into a true net margin rather than a gross
      // one that reads as bigger than it will actually be.
      const split = row.order.split as unknown as OrderSplit
      const agentMargin = split.shares
        .filter((share) => share.role === 'agent' && share.margin > 0)
        .reduce((sum, share) => sum + share.margin, 0)
      const product = productById.get(row.order.productId)

      return {
        id: row.id,
        /** For the "Reorder" action, see `FulfilmentService.reorder`. */
        orderId: row.orderId,
        /** Whether the order this refund is for still stands as failed. */
        orderFailed: row.order.status === 'failed',
        /** A person failed this order, so the customer may already be sorted out. */
        markedFailedByHand: row.order.status === 'failed' && row.order.resolvedManually,
        network: row.order.network,
        category: row.order.category,
        /** Owed to an agent from this exact sale, unchanged by a reorder. */
        agentMargin,
        /**
         * What this order was originally priced against, see
         * `Order.supplierCodeAtSale`'s own comment. The "Reorder" modal
         * compares this to the chosen bundle's cost today: reordering at the
         * same cost the sale already assumed is not a gain, it is just this
         * order finally completing, so that comparison is the actual point,
         * not the raw cost by itself.
         */
        originalCost: split.supplierCost,
        /**
         * What Paystack actually kept from the original payment, already
         * spent, not something a reorder redoes or gets back. Null for a
         * wallet-paid order, whose fee (if any) was booked once already at
         * top-up time, not against this sale.
         */
        paystackFee: feeByOrderId.get(row.orderId) ?? null,
        /** Whether this was sold through an agent's own link (FR-5.7). */
        soldByAgent: row.order.soldByCode !== null,
        /**
         * Today's price for this same product, for an agent sale, that
         * specific agent's own current price, explicit or their default
         * markup, priced exactly as a live checkout would (`resalePriceFor`),
         * not admin's wholesale floor everyone pays; for a direct sale, the
         * standard walk-up price. Purely a sanity check, not part of the
         * margin math below; null once the product, or the agent, is gone.
         */
        currentSellingPrice: (() => {
          if (!product) return null
          if (!row.order.soldByCode) return product.standardPrice
          const agent = agentByReferralCode.get(row.order.soldByCode)
          if (!agent) return product.adminPrice // agent no longer exists, the wholesale floor is the best fallback
          const pricingAgent: PricingAgent = {
            userId: agent.id,
            name: '',
            referralCode: agent.referralCode,
            uplineCode: null,
            markupPercent: agent.markupPercent,
            prices: agentPrices
              .filter((p) => p.userId === agent.id)
              .map((p) => ({ productId: p.productId, resalePrice: p.resalePrice })),
          }
          return resalePriceFor(pricingAgent, product)
        })(),
        orderRef: row.orderRef,
        productName: row.productName,
        buyerName: row.buyerName,
        buyerPhone: row.buyerPhone,
        /** Where the refund was sent: the number that paid, once known. */
        payToPhone: row.payToPhone,
        amount: row.amount,
        method: row.method,
        reason: row.reason,
        status: row.status,
        note: row.note,
        /** Chosen at approval for a Mobile Money refund. */
        momoNetwork: row.momoNetwork,
        /** Paystack's word on the transfer: pending, success, failed, otp, manual. */
        transferStatus: row.transferStatus,
        /** Why it has not gone, when it has not. */
        transferNote: row.transferNote,
        createdAt: row.createdAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
        paidAt: row.paidAt?.toISOString() ?? null,
      }
    })
  }

  /** Why a hand refund cannot be recorded for this order, thrown before the order is touched. */
  async assertHandRefundPossible(orderId: string, momoNetwork?: Network): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { paidWith: true, payment: { select: { network: true } } },
    })
    if (order?.paidWith === 'wallet') {
      throw new ValidationError('This was paid from a wallet. Mark it failed, then approve the refund back to the wallet.')
    }
    if (order && !momoNetwork && !order.payment?.network) {
      throw new ValidationError('We do not know which network this was paid on. Choose the network it was refunded on.')
    }
  }

  /**
   * The order was just failed because the customer already has their money
   * back: pay off the refund that queued, the same as "Paid another way", so
   * nobody pays it again. Nothing queued means no money was taken at all.
   */
  async recordHandRefund(orderId: string, adminId: string, note: string, momoNetwork?: Network): Promise<void> {
    const request = await this.prisma.refundRequest.findUnique({ where: { orderId } })
    if (request?.status !== 'pending') return
    await this.settleManually(request.id, adminId, `Refunded by hand before marking failed, ${note.trim()}`, momoNetwork)
  }

  /**
   * Put a refused refund back in the queue, for a refusal that was a mistake.
   * Only while the order still stands as failed: a delivered order owes nothing.
   */
  async reopen(id: string, adminId: string, note: string) {
    const reason = note.trim()
    if (reason.length < 5) throw new ValidationError('Say why this refund is being reopened. It is kept on the record.')

    const request = await this.prisma.refundRequest.findUnique({
      where: { id },
      include: { order: { select: { status: true } } },
    })
    if (!request) throw new NotFoundError('We could not find that refund request.')
    if (request.status !== 'rejected' || request.order.status !== 'failed') {
      throw new ConflictError('NOT_REOPENABLE', 'Only a refused refund on an order that still stands as failed can be reopened.')
    }

    const claim = await this.prisma.refundRequest.updateMany({
      where: { id, status: 'rejected' },
      data: { status: 'pending', decidedAt: null, decidedBy: null, note: null },
    })
    if (claim.count === 0) throw new ConflictError('ALREADY_DECIDED', 'That refund just changed, refresh and check.')
    this.log.warn(`refund ${request.orderRef} reopened by ${adminId}, was refused with "${request.note ?? ''}": ${reason}`)
    return { id, status: 'pending' as const }
  }

  /** What is queued, for the dashboard. */
  async pendingSummary() {
    const result = await this.prisma.refundRequest.aggregate({
      where: { status: 'pending' },
      _count: { _all: true },
      _sum: { amount: true },
    })
    return { count: result._count._all, amount: result._sum.amount ?? 0 }
  }

  /**
   * Authorise a refund and pay it.
   *
   * A wallet customer is credited directly. A Mobile Money payer has no wallet
   * and a MoMo collection cannot be reliably reversed, so the amount is held
   * against their number as a claim, NFR-3.3 without depending on a reversal
   * that may never land.
   */
  /**
   * Stop before paying a refund for an order the provider has since reported
   * delivered. That report doesn't undo anything on its own, it only flags
   * the order (see `FulfilmentService`'s conflict detection), and paying the
   * refund anyway would hand the customer both the bundle and their money.
   * Cleared once someone has checked and acknowledged it on Needs Attention.
   */
  private async refuseIfFlagged(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { conflictNote: true } })
    if (order?.conflictNote) {
      throw new ConflictError(
        'ORDER_FLAGGED',
        'The provider has since reported this order delivered. Check whether the bundle arrived, ' +
          'then acknowledge the flag on Needs attention, before refunding.',
      )
    }
  }

  /** Paystack reported this one sent after it went back in the queue, see `PaymentsService.flagSentAfterReturn`. */
  private refuseIfAlreadySent(transferStatus: string | null): void {
    if (transferStatus === 'sent_after_return') {
      throw new ConflictError(
        'ALREADY_SENT',
        'Paystack reported this refund as sent after it came back to the queue. Check it on Needs attention before paying it again.',
      )
    }
  }

  async approve(id: string, adminId: string, momoNetwork?: Network) {
    const request = await this.prisma.refundRequest.findUnique({ where: { id } })
    if (!request) throw new NotFoundError('We could not find that refund request.')

    /**
     * A Mobile Money refund needs to know which network to pay.
     *
     * Already known when the original payment reported it (see
     * `FulfilmentService.settle`, which reads it off Paystack at that point),
     * this only blocks when it is not: a guest whose payment predates this, or
     * one Paystack did not report cleanly. Never guessed from the phone number
     * itself. Ghana's number portability means a prefix cannot tell you which
     * network carries a line, the platform used to guess and turned real
     * customers away for it, so an unknown case falls to whoever has the
     * order in front of them.
     */
    if (request.method === 'transfer' && !momoNetwork && !request.momoNetwork && !(await this.paidThroughPaystack(request.orderId))) {
      throw new ValidationError(
        'Choose which Mobile Money network to send this back on.',
      )
    }

    await this.refuseIfFlagged(request.orderId)
    this.refuseIfAlreadySent(request.transferStatus)

    const settled = await this.prisma.$transaction(async (tx) => {
      /**
       * Claimed atomically, not read-then-written.
       *
       * A plain `findUnique` + a status check proves nothing about what is
       * still true by the time the later `update`s run, two admins clicking
       * approve within the same window, or one admin double-clicking, both
       * pass a read-then-write guard and both go on to pay. `updateMany`'s
       * `WHERE status = 'pending'` is the actual guard: only the caller that
       * wins this write moves on to credit anything or send anything: the
       * other sees `count: 0` and stops here, before ever calling
       * `sendRefund` a second time for the same reference.
       */
      const claim = await tx.refundRequest.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'approved', decidedAt: new Date(), decidedBy: adminId },
      })
      if (claim.count === 0) {
        const current = await tx.refundRequest.findUnique({ where: { id } })
        if (!current) throw new NotFoundError('We could not find that refund request.')
        throw new ConflictError('ALREADY_DECIDED', `That refund was already ${current.status}.`)
      }

      const request = await tx.refundRequest.findUniqueOrThrow({ where: { id } })

      const order = await tx.order.findUniqueOrThrow({
        where: { id: request.orderId },
        select: { buyerUserId: true, reference: true, productName: true },
      })

      if (request.method === 'transfer') {
        // Nothing moves in here. The money is sent after this commits, because a
        // transaction must never be held open across an outbound HTTP call, and
        // the request has to be marked approved first so a second click cannot
        // start a second transfer.
        await tx.refundRequest.update({
          where: { id },
          data: { momoNetwork: momoNetwork ?? request.momoNetwork },
        })
      } else if (request.method === 'wallet' && order.buyerUserId) {
        const after = await tx.user.update({
          where: { id: order.buyerUserId },
          data: { balance: { increment: request.amount } },
          select: { balance: true },
        })
        await tx.transaction.create({
          data: {
            userId: order.buyerUserId,
            type: 'refund',
            amount: request.amount,
            balanceAfter: after.balance,
            description: `Refund · ${request.productName}`,
            reference: request.orderRef,
          },
        })
      } else {
        // Legacy shape only, see RefundMethod.claimable.
        await tx.claimableCredit.upsert({
          where: { reference: request.orderRef },
          create: {
            phone: request.buyerPhone,
            amount: request.amount,
            reference: request.orderRef,
          },
          update: {},
        })
      }

      /**
       * `refunded` says on the receipt that the money has gone back.
       *
       * True immediately for a wallet credit, because it has. For a transfer it
       * waits: Paystack settles asynchronously, and telling a customer their
       * money has arrived before it has is the one claim this whole flow exists
       * to avoid making.
       */
      if (request.method !== 'transfer') {
        await tx.order.update({ where: { id: request.orderId }, data: { refunded: true } })
      }

      // And now it is a real cost. Booked here rather than when the order failed,
      // so profit is not reduced by a payment nobody had authorised.
      //
      // ...but only a cost against profit if the sale's revenue was ever
      // booked. A Mobile Money sale books revenue at payment, so giving it
      // back is a loss. A wallet sale only books revenue on delivery, so a
      // failed one never did: returning that money to the wallet just
      // reverses a transfer of the customer's own balance, and counting it
      // against profit understated profit by the full sale price.
      const revenueBooked = await tx.ledgerEntry.findFirst({
        where: { kind: 'revenue', orderRef: request.orderRef },
        select: { id: true },
      })
      await this.ledger.record(
        [
          {
            idempotencyKey: LedgerService.key('order', request.orderRef, 'refund'),
            kind: 'refund',
            amount: -request.amount,
            affectsProfit: Boolean(revenueBooked),
            description: `Refund · ${request.productName}`,
            orderRef: request.orderRef,
            userId: order.buyerUserId,
            occurredAt: new Date(),
          },
        ],
        tx,
      )

      this.log.log(
        `refund ${request.orderRef} approved by ${adminId}: ${request.amount}p via ${request.method}`,
      )
      return { id, status: 'approved' as const }
    })

    // Committed. Now actually send it.
    if (request.method === 'transfer') {
      await this.sendRefund(id).catch((error) => {
        // A failure here does not undo the approval, the decision stands and
        // `sendRefund` records what happened. This only catches the unexpected.
        this.log.error(`refund transfer for ${id} threw: ${String(error)}`)
      })
    }

    return settled
  }

  /**
   * Mark a Mobile Money refund as sent outside Paystack.
   *
   * Some Paystack accounts cannot initiate third-party payouts at all, a
   * Starter Business tier refuses every transfer with a reason that has
   * nothing to do with this platform's code, and there is no code fix for it.
   * When that is the wall, whoever is looking at the queue can pay the
   * customer directly instead (their own Mobile Money, cash, however) and
   * record it here so the books and the customer's receipt agree with what
   * actually happened.
   *
   * Held to the same standard as a refusal: a reason is required and kept
   * against the person who gave it, because "I sent it" is a claim nobody
   * else verifies the way Paystack's webhook verifies an automatic transfer,
   * the record is what answers a dispute later.
   */
  async settleManually(id: string, adminId: string, note: string, momoNetwork?: Network, confirmCheckedPaystack = false) {
    const reason = note.trim()
    if (reason.length < 5) {
      throw new ValidationError('Say how and where this was sent. It is kept on the record.')
    }

    const existing = await this.prisma.refundRequest.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError('We could not find that refund request.')
    if (existing.method !== 'transfer') {
      throw new ValidationError('Only a Mobile Money refund can be marked as sent manually.')
    }
    if (existing.method === 'transfer' && !momoNetwork && !existing.momoNetwork) {
      throw new ValidationError('Choose which Mobile Money network this was sent on.')
    }
    await this.refuseIfFlagged(existing.orderId)
    this.refuseIfAlreadySent(existing.transferStatus)
    requirePaystackChecked(existing.transferStatus, confirmCheckedPaystack)

    return this.prisma.$transaction(async (tx) => {
      /**
       * Claimed atomically, not read-then-written, same reasoning as
       * `approve()` above. Two admins racing to settle the same stuck refund
       * by hand must not both credit it and both tell the customer it's sent.
       */
      const claim = await tx.refundRequest.updateMany({
        where: {
          id,
          OR: [
            { status: 'pending' },
            // Approved but parked for sending by hand (a Starter account, or
            // no Paystack key, see `sendRefund`). Only when no Paystack
            // transfer exists for it, so this can never pay on top of a real
            // one.
            { status: 'approved', transferStatus: 'manual', transferCode: null },
            // Stuck on Paystack (no answer, or waiting for an OTP), only once
            // the admin has confirmed on their dashboard it did not go out,
            // see `requirePaystackChecked`. Before this there was no way out
            // of either state at all.
            ...(confirmCheckedPaystack ? [{ status: 'approved' as const, transferStatus: { in: ['unknown', 'otp'] } }] : []),
          ],
        },
        data: {
          status: 'approved',
          decidedAt: new Date(),
          decidedBy: adminId,
          momoNetwork: momoNetwork ?? existing.momoNetwork,
          // Never counted as money that left through Paystack, see `transfersSince`.
          transferCode: null,
          transferStatus: 'success',
          transferNote: `Sent manually, ${reason}`,
          paidAt: new Date(),
          // The one thing a later genuine Paystack transfer event for this
          // same reference can check to refuse acting, see the field's own
          // doc comment in schema.prisma and `PaymentsService.applyTransfer`.
          resolvedManually: true,
        },
      })
      if (claim.count === 0) {
        const current = await tx.refundRequest.findUnique({ where: { id } })
        if (!current) throw new NotFoundError('We could not find that refund request.')
        throw new ConflictError('ALREADY_DECIDED', `That refund was already ${current.status}.`)
      }

      const request = await tx.refundRequest.findUniqueOrThrow({ where: { id } })

      const order = await tx.order.findUniqueOrThrow({
        where: { id: request.orderId },
        select: { buyerUserId: true },
      })

      // Same as a webhook-confirmed transfer: only now can the receipt say
      // the money has gone back.
      await tx.order.update({ where: { id: request.orderId }, data: { refunded: true } })

      await this.ledger.record(
        [
          // The same cost as any other refund, money left to make the
          // customer whole, whichever account it left from. Re-recorded here
          // because a prior failed Paystack attempt removes this entry;
          // `record` is idempotent on its key either way, so this cannot
          // double-count.
          {
            idempotencyKey: LedgerService.key('order', request.orderRef, 'refund'),
            kind: 'refund',
            amount: -request.amount,
            description: `Refund (sent manually) · ${request.productName}`,
            orderRef: request.orderRef,
            userId: order.buyerUserId,
            occurredAt: new Date(),
          },
          /**
           * The business did not pay this, a person did, out of their own
           * pocket, because Paystack refused to. That is a debt to them, not
           * a cost to the business twice over, so it is booked as capital
           * coming in rather than a second refund line, and does not touch
           * profit. `FloatMonitorService.outstandingManualRefunds` surfaces
           * it, traced back to this exact order, until a matching
           * `capital_out` on the same order says they took it back.
           */
          {
            idempotencyKey: LedgerService.key('order', request.orderRef, 'capital_in'),
            kind: 'capital_in',
            amount: request.amount,
            description: `Covered refund ${request.orderRef} personally, ${reason}`,
            orderRef: request.orderRef,
            occurredAt: new Date(),
            affectsProfit: false,
          },
        ],
        tx,
      )

      this.log.log(`refund ${request.orderRef} settled manually by ${adminId}: ${reason}`)
      return { id, status: 'approved' as const }
    })
  }

  /** The order's Paystack payment reference, when it was paid through Paystack. */
  private async paidThroughPaystack(orderId: string): Promise<string | null> {
    const payment = await this.prisma.payment.findUnique({ where: { orderId }, select: { reference: true, status: true } })
    return payment?.status === 'paid' ? payment.reference : null
  }

  /**
   * The Mobile Money number and network that paid for this order, read
   * fresh from Paystack's own record of the payment.
   */
  private async payingNumber(
    orderId: string,
  ): Promise<
    | { kind: 'found'; phone: string; network: Network | null }
    | { kind: 'none'; reason: string }
    | { kind: 'unreachable'; reason: string }
  > {
    const reference = await this.paidThroughPaystack(orderId)
    if (!reference) {
      return { kind: 'none', reason: 'There is no Paystack payment on this order, so there is no paying number to send it to.' }
    }
    const result = await this.paystack.verify(reference)
    if (result.kind === 'unavailable') {
      return { kind: 'unreachable', reason: `We could not ask Paystack who paid: ${result.reason} Approve it again in a moment.` }
    }
    if (result.kind === 'not_found' || result.status !== 'success') {
      return { kind: 'none', reason: 'Paystack has no successful payment for this order, so there is no paying number to send it to.' }
    }
    if (!result.payerNumber) {
      return {
        kind: 'none',
        reason:
          result.channel === 'card'
            ? 'This was paid by card, so it cannot be sent back to a Mobile Money number automatically.'
            : 'Paystack did not say which Mobile Money number paid.',
      }
    }
    return { kind: 'found', phone: result.payerNumber, network: result.network }
  }

  /**
   * Pay a refund back to the number that paid.
   *
   * That is the Mobile Money number Paystack charged, read from Paystack's
   * own record of the payment, not the order's phone number: that one is
   * only where the receipt went, and is often the bundle recipient's.
   *
   * The mirror of an agent payout, and deliberately the same shape: one
   * recipient per number, an idempotent reference so a retry cannot pay twice,
   * and three outcomes that each leave the books honest.
   *
   * The order is only marked `refunded` when Paystack confirms. Until then the
   * customer is told their refund is on its way, which is true, rather than that
   * it has arrived, which is not.
   */
  private async sendRefund(refundId: string): Promise<void> {
    const row = await this.prisma.refundRequest.findUnique({ where: { id: refundId } })
    if (!row || row.status !== 'approved') {
      this.log.warn(`refund ${refundId}: skipped, not in approved state (${row?.status ?? 'missing'})`)
      return
    }

    if (row.transferCode) {
      this.log.warn(`refund ${refundId} already has a transfer, not sending again`)
      return
    }

    /**
     * Same check `WithdrawalsService.sendPayout` makes, for the same reason:
     * a Starter Paystack account refuses every third-party transfer, so
     * calling it anyway only produces a timeout, an OTP prompt, or a refusal,
     * and each of those used to leave the refund `approved` with nothing sent
     * and no way to record it as paid by hand. Known in advance, so parked as
     * `manual` straight away, for "Paid another way" to settle once sent.
     */
    if (!(await this.settings.get('paystackBusinessAccount'))) {
      await this.prisma.refundRequest.update({
        where: { id: refundId },
        data: {
          transferStatus: 'manual',
          transferNote:
            "This Paystack account can't send transfers yet (not registered/upgraded as a " +
            'business account), so send this refund by hand on Mobile Money, then confirm it ' +
            'with "Paid another way".',
        },
      })
      this.log.warn(`refund ${refundId} left for manual sending, Paystack transfers are not enabled`)
      return
    }

    if (!this.paystack.configured) {
      this.log.warn(`refund ${refundId} left for manual sending, Paystack is not configured`)
      await this.prisma.refundRequest.update({
        where: { id: refundId },
        data: {
          transferStatus: 'manual',
          transferNote: 'No Paystack key on this server, so this one has to be sent by hand.',
        },
      })
      return
    }

    const payer = await this.payingNumber(row.orderId)
    if (payer.kind === 'unreachable') {
      await this.holdRefund(refundId, payer.reason)
      return
    }
    if (payer.kind === 'none') {
      await this.prisma.refundRequest.update({
        where: { id: refundId },
        data: {
          transferStatus: 'manual',
          transferNote: `${payer.reason} Send it by hand, then confirm it with "Paid another way".`,
        },
      })
      this.log.warn(`refund ${refundId} left for manual sending: ${payer.reason}`)
      return
    }

    // The network Paystack charged on, over anything chosen by hand.
    const network = payer.network ?? row.momoNetwork

    /**
     * Below Paystack's smallest transfer: it would only be refused. Parked
     * for the admin to send from their own Mobile Money, with the paying
     * number and network spelled out. "Paid another way" then records it as
     * owed back to them, repaid from the Paystack balance page.
     */
    if (row.amount < MIN_TRANSFER) {
      await this.prisma.refundRequest.update({
        where: { id: refundId },
        data: {
          payToPhone: payer.phone,
          momoNetwork: network,
          transferStatus: 'manual',
          transferNote:
            `Under GHS ${(MIN_TRANSFER / 100).toFixed(2)}, Paystack's smallest transfer. Send ` +
            `GHS ${(row.amount / 100).toFixed(2)} from your own Mobile Money to ${payer.phone}` +
            `${network ? ` (${network})` : ''}, the number that paid, then confirm it with "Paid another way". ` +
            'It is then owed back to you, and repaid from the Paystack balance page.',
        },
      })
      this.log.log(`refund ${row.orderRef} under the transfer minimum, left for sending by hand to ${payer.phone}`)
      return
    }
    const networkCode = momoCodeFor(network)
    if (!networkCode) {
      await this.holdRefund(refundId, 'Paystack did not say which network paid, choose it and approve again.')
      return
    }

    /**
     * A fresh recipient every time, never a saved one: an older attempt may
     * have saved one for the receipt number. Paystack hands back the same
     * recipient for the same number anyway.
     */
    const created = await this.paystack.createRecipient({
      name: row.buyerName,
      phone: payer.phone,
      networkCode,
    })
    if (!created.ok) {
      await this.holdRefund(refundId, `Paystack would not accept the paying number ${payer.phone}: ${created.reason}`)
      return
    }
    const recipientCode = created.recipientCode
    await this.prisma.refundRequest.update({
      where: { id: refundId },
      data: { recipientCode, payToPhone: payer.phone, momoNetwork: network },
    })

    // One reference per approval, not per refund: derived from this
    // approval's own `decidedAt`, so any retry of the *same* approval reuses
    // it (Paystack's duplicate check stops a double send), while a new
    // approval after a failed transfer gets a fresh one instead of being
    // refused as a duplicate forever. `PaymentsService.applyTransfer` strips
    // the suffix to find the refund.
    const result = await this.paystack.transfer({
      recipientCode,
      amount: row.amount,
      reference: refundTransferReference(row),
      reason: `Refund, ${row.productName} (${row.orderRef})`,
    })

    if (result.kind === 'sent') {
      /**
       * Guarded on the transfer not already being confirmed: `paystack.transfer()`
       * can take up to 30 seconds, long enough for their webhook to arrive and
       * resolve this refund first. An unconditional write here would then
       * clobber a real `transferStatus: 'success'` back to whatever this stale
       * reply says, a bookkeeping inconsistency, not a double-pay, but a
       * needless one to leave in.
       *
       * Written as an explicit `OR` rather than `NOT: { transferStatus: 'success' }`,
       * SQL's three-valued NULL logic means a plain negation SILENTLY EXCLUDES
       * a null `transferStatus`, and this column is null on every refund the
       * first time it is ever sent (nothing sets it before this point). The
       * `NOT` form was verified against the local database to update zero rows
       * on a completely normal, first-time send, it would have quietly stopped
       * every refund from ever recording its transfer code.
       */
      await this.prisma.refundRequest.updateMany({
        where: {
          id: refundId,
          OR: [{ transferStatus: null }, { transferStatus: { not: 'success' } }],
        },
        data: { transferCode: result.transferCode, transferStatus: result.status },
      })
      this.log.log(
        `refund ${row.orderRef}: GHS ${(row.amount / 100).toFixed(2)} sent to ${payer.phone}, the number that paid`,
      )
      return
    }

    if (result.kind === 'otp') {
      await this.holdRefund(
        refundId,
        'Paystack is asking for an OTP for every transfer. Turn transfer OTP off in your ' +
          'Paystack dashboard, or send this one from there.',
        result.transferCode,
        'otp',
      )
      return
    }

    if (result.kind === 'failed') {
      await this.holdRefund(
        refundId,
        result.insufficientBalance
          ? 'Your Paystack balance could not cover this refund. Top up and approve it again.'
          : result.reason,
      )
      return
    }

    await this.holdRefund(
      refundId,
      `We did not get an answer from Paystack: ${result.reason} The money may be on its way. ` +
        'Check the transfer in their dashboard before approving again.',
      null,
      'unknown',
    )
  }

  /**
   * The transfer did not go. Put the refund back in the queue, usually.
   *
   * Back to `pending` on a plain `failed`: the customer is still owed, so it
   * belongs in the list of people waiting rather than sitting as an approval
   * that quietly achieved nothing. The reason travels with it so whoever
   * looks knows what to fix.
   *
   * `unknown` and `otp` are both exceptions, and for related but different
   * reasons, both stay `approved`, never `pending`:
   *
   *  · `unknown`, the money may already be moving, and re-approving it
   *    could pay it twice.
   *  · `otp`, nothing has moved (Paystack blocked the transfer outright
   *    pending a code), but `transferCode` is already set from this very
   *    attempt. Resetting to `pending` here used to mislabel this as
   *    `failed`, and an admin who then re-approved it hit `sendRefund`'s own
   *    "already has a transfer (not sending again" guard) a dead end that
   *    alternated `pending` → `approved` forever with zero progress. This
   *    only actually clears by resolving the OTP requirement in Paystack's
   *    own dashboard, same as the message already says.
   *
   * Withdrawals already handle `otp` this way (`WithdrawalsService.sendPayout`);
   * this was the one place still mislabeling it as an outright failure.
   */
  private async holdRefund(
    refundId: string,
    reason: string,
    transferCode: string | null = null,
    status: 'failed' | 'unknown' | 'otp' = 'failed',
  ): Promise<void> {
    await this.prisma.refundRequest.update({
      where: { id: refundId },
      data: {
        status: status === 'failed' ? 'pending' : 'approved',
        transferStatus: status,
        transferNote: reason,
        transferCode,
      },
    })

    // Nothing has actually been paid in either `failed` or `otp`, only
    // `unknown` might genuinely already have moved, so it must not sit on
    // the books as a cost until it's actually confirmed sent.
    const row = await this.prisma.refundRequest.findUnique({ where: { id: refundId } })
    if (row && status !== 'unknown') {
      await this.prisma.ledgerEntry.deleteMany({
        where: { idempotencyKey: LedgerService.key('order', row.orderRef, 'refund') },
      })
    }

    this.log.warn(`refund ${refundId} not sent: ${reason}`)
  }

  /**
   * Refuse a refund, with a reason.
   *
   * Kept deliberately hard to do quietly. This is a decision not to return money
   * a customer paid, so the reason is required and stored against the person who
   * made it, the record has to survive being asked about months later.
   */
  /**
   * `delivered` (the default) is the usual reason a refund is refused: the
   * bundle did arrive after all. The order then becomes `completed` and the
   * selling agent is credited their margin, through the same
   * `FulfilmentService.reverseOutcome` a superadmin uses, in one transaction
   * with the refusal. `false` only refuses, for the rare case nothing was
   * delivered either (the payment never actually landed, say).
   */
  async reject(id: string, adminId: string, note: string, delivered = true) {
    const reason = note.trim()
    if (reason.length < 5) {
      throw new ValidationError(
        'Give a reason for refusing this refund. It is kept on the record.',
      )
    }

    const request = await this.prisma.refundRequest.findUnique({
      where: { id },
      include: { order: { select: { status: true } } },
    })
    if (!request) throw new NotFoundError('We could not find that refund request.')
    if (request.status !== 'pending') {
      throw new ConflictError('ALREADY_DECIDED', `That refund was already ${request.status}.`)
    }

    if (delivered && request.order.status === 'failed') {
      await this.fulfilment.reverseOutcome(request.orderId, adminId, reason, { refund: { id, note: reason } })
      this.log.warn(`refund ${request.orderRef} REFUSED by ${adminId}, order marked delivered: ${reason}`)
      return { id, status: 'rejected' as const }
    }

    // Claimed on `pending`, not just checked above: an approval landing in
    // between (wallet already credited, or a transfer already sent) must not
    // be overwritten to `rejected` with the money already gone.
    const claim = await this.prisma.refundRequest.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected', decidedAt: new Date(), decidedBy: adminId, note: reason },
    })
    if (claim.count === 0) {
      throw new ConflictError('ALREADY_DECIDED', 'That refund was just decided, refresh and check.')
    }

    // No ledger entry and no `refunded` flag: nothing moved.
    this.log.warn(`refund ${request.orderRef} REFUSED by ${adminId}: ${reason}`)
    return { id, status: 'rejected' as const }
  }
}
