import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Network } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { FulfilmentService } from '../orders/fulfilment.service'
import { ValidationError } from '../common/domain-errors'
import { PaystackClient } from './paystack.client'
import { LedgerService } from '../finance/ledger.service'

/**
 * Collecting money, and what happens once it arrives.
 *
 * The single rule everything here serves: **an order is not fulfilled and a
 * wallet is not credited until Paystack has told our server the money arrived.**
 * Before this existed, `payWith: 'momo'` created an order and dispatched it
 * immediately — nothing was ever charged, which was the right stand-in while
 * there were no keys and is free bundles the moment there are.
 *
 * Two things can report a payment, and neither is the browser:
 *
 *  · the signed webhook, which is fast and unauthenticated-by-default so it is
 *    HMAC-checked, and
 *  · our own `verify` call, made when the customer returns to the app and again
 *    by the reconciler for anything left hanging.
 *
 * Both funnel into `applyPaid`, which is idempotent — Paystack retries, and a
 * customer refreshing the return page is normal.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly paystack: PaystackClient,
    private readonly fulfilment: FulfilmentService,
    private readonly ledger: LedgerService,
  ) {}

  get live(): boolean {
    return this.paystack.configured
  }

  /**
   * Where Paystack sends the customer back to.
   *
   * `agentCode` routes it through that agent's own shop path
   * (`/s/<code>/pay/return`) instead of the bare platform path, so a buyer who
   * paid from inside an agent's shop lands back inside it — same reasoning,
   * and same rule of only ever using a code the order already carries, as
   * `SetupTokensService.link`.
   */
  private callbackUrl(reference: string, agentCode?: string | null): string {
    const base = (this.config.get<string>('PUBLIC_APP_URL')?.trim() || 'http://localhost:5173').replace(
      /\/$/,
      '',
    )
    const path = agentCode ? `/s/${agentCode}/pay/return` : '/pay/return'
    return `${base}${path}?reference=${encodeURIComponent(reference)}`
  }

  /**
   * Paystack requires an email address. A guest paying with Mobile Money does
   * not have one, so it is derived from their phone rather than sharing one
   * inbox across every guest — which would make their dashboard unreadable and
   * every receipt go to the same place.
   */
  private emailFor(phone: string, real: string | null | undefined): string {
    if (real) return real
    return `${phone.replace(/\D/g, '')}@guest.jamesdataconsult.com`
  }

  /**
   * Start payment for an order that has been created but not paid for.
   *
   * The order reference doubles as the Paystack reference: they cannot drift
   * apart, and Paystack rejecting a duplicate reference is a second line of
   * defence against charging twice for one order.
   */
  async startOrderPayment(order: {
    id: string
    reference: string
    salePrice: number
    buyerPhone: string
    productName: string
    recipient: string
    buyerUserId: string | null
    sellerCode: string | null
  }): Promise<{ paymentUrl: string }> {
    const email = await this.prisma.user
      .findUnique({
        where: { id: order.buyerUserId ?? '' },
        select: { email: true },
      })
      .then((row) => row?.email ?? null)
      .catch(() => null)

    await this.prisma.payment.create({
      data: {
        reference: order.reference,
        purpose: 'order',
        amount: order.salePrice,
        userId: order.buyerUserId,
        orderId: order.id,
      },
    })

    const result = await this.paystack.initialise({
      reference: order.reference,
      amount: order.salePrice,
      email: this.emailFor(order.buyerPhone, email),
      callbackUrl: this.callbackUrl(order.reference, order.sellerCode),
      metadata: {
        purpose: 'order',
        product: order.productName,
        recipient: order.recipient,
      },
    })

    if (!result.ok) {
      // The order exists but cannot be paid for. Fail it now rather than leaving
      // an unpayable row that looks like a pending sale for ever.
      await this.prisma.payment.update({
        where: { reference: order.reference },
        data: { status: 'failed', providerResponse: result.reason.slice(0, 2000) },
      })
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'failed' },
      })
      throw new ValidationError(
        'We could not start the payment just now. Please try again in a moment.',
      )
    }

    await this.prisma.payment.update({
      where: { reference: order.reference },
      data: { authorizationUrl: result.authorizationUrl },
    })

    return { paymentUrl: result.authorizationUrl }
  }

  /**
   * The checkout link for an order that has been placed but not paid for.
   *
   * Used when a customer reloads or replays checkout. Paystack refuses a second
   * initialise on the same reference, so the stored link is the only way to send
   * them back to the same payment — handing back a receipt for an unpaid order
   * would lose the sale and confuse them about whether they owe anything.
   */
  async paymentUrlForOrder(orderId: string): Promise<string | null> {
    const payment = await this.prisma.payment.findUnique({
      where: { orderId },
      select: { status: true, authorizationUrl: true },
    })
    if (!payment || payment.status !== 'pending') return null
    return payment.authorizationUrl
  }

  /** Start a wallet top-up. */
  async startTopUp(user: { id: string; phone: string; email: string }, amount: number) {
    const reference = `TOP-${Date.now().toString(36).toUpperCase()}-${user.id.slice(0, 6).toUpperCase()}`

    await this.prisma.payment.create({
      data: { reference, purpose: 'topup', amount, userId: user.id },
    })

    const result = await this.paystack.initialise({
      reference,
      amount,
      email: this.emailFor(user.phone, user.email),
      callbackUrl: this.callbackUrl(reference),
      metadata: { purpose: 'topup' },
    })

    if (!result.ok) {
      await this.prisma.payment.update({
        where: { reference },
        data: { status: 'failed', providerResponse: result.reason.slice(0, 2000) },
      })
      throw new ValidationError(
        'We could not start the payment just now. Please try again in a moment.',
      )
    }

    await this.prisma.payment.update({
      where: { reference },
      data: { authorizationUrl: result.authorizationUrl },
    })

    return { reference, paymentUrl: result.authorizationUrl }
  }

  /**
   * Ask Paystack about a reference and apply whatever they say.
   *
   * This is what the return-from-Paystack page calls, and it is deliberately the
   * same path the webhook takes. The browser only supplies a reference — a public
   * string — and everything decided from here comes from Paystack directly.
   */
  async confirm(reference: string): Promise<{ status: 'paid' | 'pending' | 'failed' }> {
    const payment = await this.prisma.payment.findUnique({ where: { reference } })
    if (!payment) return { status: 'failed' }
    if (payment.status === 'paid') return { status: 'paid' }

    const result = await this.paystack.verify(reference)

    if (result.kind === 'unavailable') {
      this.log.warn(`could not verify ${reference}: ${result.reason}`)
      // Unknown, not failed. Saying "failed" here would tell a customer who has
      // paid that they have not.
      return { status: 'pending' }
    }

    if (result.kind === 'not_found') {
      return { status: payment.status === 'pending' ? 'pending' : 'failed' }
    }

    if (result.status === 'success') {
      await this.applyPaid(reference, {
        amount: result.amount,
        currency: result.currency,
        channel: result.channel,
        network: result.network,
        fee: result.fee,
        providerId: result.providerId,
        raw: result.raw,
      })
      return { status: 'paid' }
    }

    // Their terminal failures. Anything else — pending, ongoing — is still in
    // flight and must not close the order.
    if (['failed', 'abandoned', 'reversed'].includes(result.status)) {
      await this.applyFailed(reference, result.raw)
      return { status: 'failed' }
    }

    return { status: 'pending' }
  }

  /**
   * Money arrived. Credit or fulfil, exactly once.
   *
   * The amount is checked against what we asked for, because Paystack will
   * happily report a part payment as a successful charge and an order half paid
   * for must not ship. A mismatch is left pending and shouted about rather than
   * quietly accepted or quietly dropped — somebody's money is involved either
   * way.
   */
  private async applyPaid(
    reference: string,
    detail: {
      amount: number
      currency: string
      channel: string | null
      network: Network | null
      fee: number | null
      providerId: string | null
      raw: string
    },
  ): Promise<void> {
    const orderIdToDispatch = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { reference } })
      // Already applied. Paystack retries webhooks and customers refresh pages;
      // both must be no-ops rather than a second bundle or a second credit.
      if (!payment || payment.status === 'paid') return null

      if (detail.currency && detail.currency !== 'GHS') {
        this.log.error(
          `${reference}: paid in ${detail.currency}, expected GHS — NOT applied, needs a human`,
        )
        return null
      }

      if (detail.amount < payment.amount) {
        this.log.error(
          `${reference}: only ${detail.amount}p of ${payment.amount}p arrived — NOT applied, needs a human`,
        )
        return null
      }

      await tx.payment.update({
        where: { reference },
        data: {
          status: 'paid',
          paidAt: new Date(),
          channel: detail.channel,
          network: detail.network,
          fee: detail.fee,
          providerId: detail.providerId,
          providerResponse: detail.raw,
        },
      })

      // Recorded inside the same transaction that applies the payment, so the
      // books cannot show money arriving that the wallet or order never saw.
      const paidAt = new Date()
      await this.ledger.record(
        [
          {
            idempotencyKey: LedgerService.key('payment', reference, 'fee'),
            kind: 'payment_fee',
            // Negative: this is money Paystack kept out of what the customer
            // paid. Null when they did not report it, which is not zero — a
            // missing figure must not read as a free transaction.
            amount: detail.fee != null ? -detail.fee : 0,
            description: `Paystack fee · ${detail.channel ?? 'unknown channel'}`,
            paymentRef: reference,
            userId: payment.userId,
            occurredAt: paidAt,
          },
        ],
        tx,
      )

      if (payment.purpose === 'topup' && payment.userId) {
        const updated = await tx.user.update({
          where: { id: payment.userId },
          data: { balance: { increment: payment.amount } },
          select: { balance: true },
        })
        await tx.transaction.create({
          data: {
            userId: payment.userId,
            type: 'topup',
            amount: payment.amount,
            balanceAfter: updated.balance,
            description: `Wallet top-up · ${channelLabel(detail.channel)}`,
            reference,
          },
        })
        // Cash in, but not revenue: it is the customer's money, held. Counting
        // it as earnings would inflate profit and then inflate it again when they
        // spend it on a bundle.
        await this.ledger.record(
          [
            {
              idempotencyKey: LedgerService.key('payment', reference, 'topup'),
              kind: 'topup',
              amount: payment.amount,
              affectsProfit: false,
              description: 'Wallet top-up',
              paymentRef: reference,
              userId: payment.userId,
              occurredAt: paidAt,
            },
          ],
          tx,
        )

        this.log.log(`top-up ${reference}: +${payment.amount}p`)
        return null
      }

      if (payment.orderId) {
        // `processing` is the state dispatch expects. Paid and moving.
        const order = await tx.order.update({
          where: { id: payment.orderId },
          data: { status: 'processing' },
          select: { id: true, reference: true, productName: true },
        })

        await this.ledger.record(
          [
            {
              idempotencyKey: LedgerService.key('order', order.reference, 'revenue'),
              kind: 'revenue',
              amount: payment.amount,
              description: `Sale · ${order.productName}`,
              orderRef: order.reference,
              paymentRef: reference,
              userId: payment.userId,
              occurredAt: paidAt,
            },
          ],
          tx,
        )

        return payment.orderId
      }

      return null
    })

    // Outside the transaction, deliberately: dispatch makes an outbound HTTP
    // call, and a transaction must never be held open across one.
    if (orderIdToDispatch) {
      this.log.log(`${reference} paid — dispatching`)
      this.fulfilment.scheduleFor(orderIdToDispatch)
    }
  }

  /** Paystack says it will not be paid. Close the order; nothing was charged. */
  private async applyFailed(reference: string, raw: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { reference } })
    if (!payment || payment.status !== 'pending') return

    await this.prisma.payment.update({
      where: { reference },
      data: { status: 'failed', providerResponse: raw },
    })

    if (payment.orderId) {
      // No refund flag: no money ever left the customer, so claiming one was
      // returned would be a lie on their receipt.
      await this.prisma.order.updateMany({
        where: { id: payment.orderId, status: 'awaiting_payment' },
        data: { status: 'failed' },
      })
    }

    this.log.log(`${reference} not paid — closed`)
  }

  /**
   * Apply a verified webhook.
   *
   * The signature is checked by the controller. The amount still comes from a
   * fresh `verify` call rather than from the webhook body: a valid signature
   * proves who sent the message, not that its contents are current, and this is
   * the moment money moves.
   */
  async applyWebhook(event: string, reference: string): Promise<{ applied: boolean }> {
    if (!reference) return { applied: false }

    if (event === 'charge.success') {
      const before = await this.prisma.payment.findUnique({ where: { reference } })
      if (!before) {
        // A reference we never issued. Not ours to act on.
        this.log.warn(`webhook for unknown reference ${reference}`)
        return { applied: false }
      }
      const result = await this.confirm(reference)
      return { applied: result.status === 'paid' }
    }

    /**
     * A payout landing, or not.
     *
     * Approving a withdrawal hands the transfer to Paystack; it is not delivered
     * until they say so. Without this an approved payout would sit as "in flight"
     * for ever, and a reversal three days later would go unnoticed while the
     * agent's balance stayed debited for money they never received.
     */
    if (event === 'transfer.success' || event === 'transfer.failed' || event === 'transfer.reversed') {
      return this.applyTransfer(event, reference)
    }

    return { applied: false }
  }

  /**
   * Settle a payout from Paystack's own report.
   *
   * `reference` is the one we sent — `WDR-<withdrawal id>` — so the withdrawal is
   * found without trusting anything else in the payload.
   *
   * A failure or reversal returns the money to the agent, because it never
   * reached them and their balance was debited when they asked. That path is
   * shared with a synchronous refusal, so both leave the books in the same state.
   */
  /**
   * Settle a customer refund that was sent by transfer.
   *
   * Success is the only thing that marks the order refunded: until Paystack
   * confirms, the customer is told their refund is on its way, which is true,
   * rather than that it arrived, which would not be.
   *
   * A failure puts the refund back in the queue rather than losing it. The
   * customer is still owed, so it belongs with the other people waiting — and the
   * ledger entry comes off, because nothing left the business.
   */
  private async applyRefundTransfer(
    event: string,
    refundId: string,
  ): Promise<{ applied: boolean }> {
    const row = await this.prisma.refundRequest.findUnique({ where: { id: refundId } })
    if (!row) {
      this.log.warn(`refund transfer webhook for unknown refund ${refundId}`)
      return { applied: false }
    }

    // Paystack retries. Already settled means no-op, not a second anything.
    if (row.transferStatus === 'success') return { applied: false }

    if (event === 'transfer.success') {
      await this.prisma.$transaction(async (tx) => {
        await tx.refundRequest.update({
          where: { id: refundId },
          data: { transferStatus: 'success', paidAt: new Date(), transferNote: null },
        })
        // Now, and only now, the receipt may say the money has gone back.
        await tx.order.update({ where: { id: row.orderId }, data: { refunded: true } })
      })
      this.log.log(`refund ${row.orderRef} confirmed paid to ${row.buyerPhone}`)
      return { applied: true }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.refundRequest.update({
        where: { id: refundId },
        data: {
          status: 'pending',
          transferStatus: event === 'transfer.reversed' ? 'reversed' : 'failed',
          transferNote:
            event === 'transfer.reversed'
              ? 'The refund was sent and then reversed. It is back in the queue to try again.'
              : 'The refund transfer did not go through. It is back in the queue to try again.',
        },
      })
      // Nothing left the business, so it must not sit on the books as a cost.
      await tx.ledgerEntry.deleteMany({
        where: { idempotencyKey: LedgerService.key('order', row.orderRef, 'refund') },
      })
    })

    this.log.warn(`refund ${row.orderRef} ${event} — back in the queue`)
    return { applied: true }
  }

  private async applyTransfer(
    event: string,
    reference: string,
  ): Promise<{ applied: boolean }> {
    // Two kinds of money leave this platform, and both are transfers: an agent
    // payout (WDR-) and a customer refund (RFD-). The prefix says which, so one
    // webhook settles both without guessing.
    if (reference.startsWith('RFD-')) {
      return this.applyRefundTransfer(event, reference.slice(4))
    }

    const id = reference.startsWith('WDR-') ? reference.slice(4) : null
    if (!id) {
      this.log.warn(`transfer webhook for a reference we did not issue: ${reference}`)
      return { applied: false }
    }

    const row = await this.prisma.withdrawal.findUnique({ where: { id } })
    if (!row) {
      this.log.warn(`transfer webhook for unknown withdrawal ${id}`)
      return { applied: false }
    }

    // Already settled. Paystack retries, so this must be a no-op rather than a
    // second credit or a second reversal.
    if (row.status === 'paid' || row.status === 'failed') {
      return { applied: false }
    }

    if (event === 'transfer.success') {
      await this.prisma.withdrawal.update({
        where: { id },
        data: { status: 'paid', transferStatus: 'success', paidAt: new Date() },
      })
      this.log.log(`payout ${id} confirmed paid to ${row.agentPhone}`)
      return { applied: true }
    }

    // failed or reversed — the money is back with us, so it goes back to them.
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.user.update({
        where: { id: row.userId },
        data: { balance: { increment: row.amount } },
        select: { balance: true },
      })

      await tx.withdrawal.update({
        where: { id },
        data: {
          status: 'failed',
          transferStatus: event === 'transfer.reversed' ? 'reversed' : 'failed',
          transferNote:
            event === 'transfer.reversed'
              ? 'The transfer was reversed after being sent. The amount is back in your balance.'
              : 'The transfer did not go through. The amount is back in your balance.',
        },
      })

      await tx.earning.create({
        data: {
          userId: row.userId,
          type: 'withdrawal',
          amount: row.amount,
          balanceAfter: after.balance,
          description: 'Payout did not reach you — amount returned to your balance',
          reference: `WDR-${id.slice(0, 8).toUpperCase()}-R`,
          depth: 0,
        },
      })

      // No money left the platform, so the payout line comes off the books.
      await tx.ledgerEntry.deleteMany({
        where: { idempotencyKey: LedgerService.key('withdrawal', id, 'payout') },
      })
    })

    this.log.warn(`payout ${id} ${event} — GHS ${(row.amount / 100).toFixed(2)} returned to the agent`)
    return { applied: true }
  }
}

function channelLabel(channel: string | null): string {
  if (!channel) return 'Paystack'
  if (channel === 'mobile_money') return 'Mobile Money'
  if (channel === 'card') return 'Card'
  return channel
}
