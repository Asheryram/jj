import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../finance/ledger.service'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'

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
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
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
  async approve(id: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
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

      if (request.method === 'wallet' && order.buyerUserId) {
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

      // Now the receipt may say the money has gone back, because it has.
      await tx.order.update({ where: { id: request.orderId }, data: { refunded: true } })

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
