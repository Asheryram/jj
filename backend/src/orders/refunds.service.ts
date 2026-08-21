import { Injectable, Logger } from '@nestjs/common'
import type { Network } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../finance/ledger.service'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'
import { PaystackClient } from '../payments/paystack.client'
import { momoCodeFor } from '../payments/momo'

/**
 * Paying back money that is owed, once a person has authorised it.
 *
 * The split between owing and paying is the whole design. `FulfilmentService`
 * records the debt when a delivery fails; nothing here runs until James decides.
 * That costs the customer time and buys the one control that matters on an
 * outbound payment — because the alternative was demonstrated: an automatic rule
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
  ) {}

  /** The queue. Pending first and oldest first — the longest wait is the worst. */
  async list(status?: 'pending' | 'approved' | 'rejected') {
    const rows = await this.prisma.refundRequest.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    })

    return rows.map((row) => ({
      id: row.id,
      orderRef: row.orderRef,
      productName: row.productName,
      buyerName: row.buyerName,
      buyerPhone: row.buyerPhone,
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
    }))
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
   * against their number as a claim — NFR-3.3 without depending on a reversal
   * that may never land.
   */
  async approve(id: string, adminId: string, momoNetwork?: Network) {
    const request = await this.prisma.refundRequest.findUnique({ where: { id } })
    if (!request) throw new NotFoundError('We could not find that refund request.')

    /**
     * A Mobile Money refund needs to know which network to pay.
     *
     * Asked for rather than derived. Ghana's number portability means a prefix
     * cannot tell you which network carries a line — the platform used to guess
     * and turned real customers away for it — so whoever has the order in front
     * of them chooses the rail.
     */
    if (request.method === 'transfer' && !momoNetwork && !request.momoNetwork) {
      throw new ValidationError(
        'Choose which Mobile Money network to send this back on.',
      )
    }

    const settled = await this.prisma.$transaction(async (tx) => {
      const request = await tx.refundRequest.findUnique({ where: { id } })
      if (!request) throw new NotFoundError('We could not find that refund request.')

      // Guarded on the row's own state inside the transaction, so a double-click
      // or two admins at once cannot pay the same refund twice.
      if (request.status !== 'pending') {
        throw new ConflictError(
          'ALREADY_DECIDED',
          `That refund was already ${request.status}.`,
        )
      }

      const order = await tx.order.findUniqueOrThrow({
        where: { id: request.orderId },
        select: { buyerUserId: true, reference: true, productName: true },
      })

      if (request.method === 'transfer') {
        // Nothing moves in here. The money is sent after this commits, because a
        // transaction must never be held open across an outbound HTTP call — and
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
        // Legacy shape only — see RefundMethod.claimable.
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

      await tx.refundRequest.update({
        where: { id },
        data: { status: 'approved', decidedAt: new Date(), decidedBy: adminId },
      })

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
      await this.ledger.record(
        [
          {
            idempotencyKey: LedgerService.key('order', request.orderRef, 'refund'),
            kind: 'refund',
            amount: -request.amount,
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
        // A failure here does not undo the approval — the decision stands and
        // `sendRefund` records what happened. This only catches the unexpected.
        this.log.error(`refund transfer for ${id} threw: ${String(error)}`)
      })
    }

    return settled
  }

  /**
   * Pay a refund back to the number that paid.
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
    if (!row || row.status !== 'approved') return

    if (row.transferCode) {
      this.log.warn(`refund ${refundId} already has a transfer — not sending again`)
      return
    }

    if (!this.paystack.configured) {
      await this.prisma.refundRequest.update({
        where: { id: refundId },
        data: {
          transferStatus: 'manual',
          transferNote: 'No Paystack key on this server, so this one has to be sent by hand.',
        },
      })
      return
    }

    const networkCode = momoCodeFor(row.momoNetwork)
    if (!networkCode) {
      await this.holdRefund(refundId, 'No Mobile Money network was chosen for this refund.')
      return
    }

    let recipientCode = row.recipientCode
    if (!recipientCode) {
      const created = await this.paystack.createRecipient({
        name: row.buyerName,
        phone: row.buyerPhone,
        networkCode,
      })
      if (!created.ok) {
        await this.holdRefund(refundId, `Paystack would not accept the number: ${created.reason}`)
        return
      }
      recipientCode = created.recipientCode
      await this.prisma.refundRequest.update({ where: { id: refundId }, data: { recipientCode } })
    }

    // Derived from the refund, never the clock: Paystack rejects a duplicate
    // reference, so one refund can only ever produce one transfer.
    const result = await this.paystack.transfer({
      recipientCode,
      amount: row.amount,
      reference: `RFD-${row.id}`,
      reason: `Refund — ${row.productName} (${row.orderRef})`,
    })

    if (result.kind === 'sent') {
      await this.prisma.refundRequest.update({
        where: { id: refundId },
        data: { transferCode: result.transferCode, transferStatus: result.status },
      })
      this.log.log(
        `refund ${row.orderRef}: GHS ${(row.amount / 100).toFixed(2)} sent to ${row.buyerPhone}`,
      )
      return
    }

    if (result.kind === 'otp') {
      await this.holdRefund(
        refundId,
        'Paystack is asking for an OTP for every transfer. Turn transfer OTP off in your ' +
          'Paystack dashboard, or send this one from there.',
        result.transferCode,
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
   * The transfer did not go. Put the refund back in the queue.
   *
   * Back to `pending` on purpose: the customer is still owed, so it belongs in
   * the list of people waiting rather than sitting as an approval that quietly
   * achieved nothing. The reason travels with it so whoever looks knows what to
   * fix.
   *
   * An `unknown` outcome is the exception — it stays approved, because the money
   * may already be moving and re-approving it could pay twice.
   */
  private async holdRefund(
    refundId: string,
    reason: string,
    transferCode: string | null = null,
    status: 'failed' | 'unknown' = 'failed',
  ): Promise<void> {
    await this.prisma.refundRequest.update({
      where: { id: refundId },
      data: {
        status: status === 'unknown' ? 'approved' : 'pending',
        transferStatus: status === 'unknown' ? 'unknown' : 'failed',
        transferNote: reason,
        transferCode,
      },
    })

    // The payout has not happened, so it must not sit on the books as a cost.
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
   * made it — the record has to survive being asked about months later.
   */
  async reject(id: string, adminId: string, note: string) {
    const reason = note.trim()
    if (reason.length < 5) {
      throw new ValidationError(
        'Give a reason for refusing this refund. It is kept on the record.',
      )
    }

    const request = await this.prisma.refundRequest.findUnique({ where: { id } })
    if (!request) throw new NotFoundError('We could not find that refund request.')
    if (request.status !== 'pending') {
      throw new ConflictError('ALREADY_DECIDED', `That refund was already ${request.status}.`)
    }

    await this.prisma.refundRequest.update({
      where: { id },
      data: { status: 'rejected', decidedAt: new Date(), decidedBy: adminId, note: reason },
    })

    // No ledger entry and no `refunded` flag: nothing moved.
    this.log.warn(`refund ${request.orderRef} REFUSED by ${adminId}: ${reason}`)
    return { id, status: 'rejected' as const }
  }
}
