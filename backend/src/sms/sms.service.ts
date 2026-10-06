import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'

/** BMS Africa (mNotify) API v2, see https://developer.bms.africa/ (`openapi14.yaml`). */
const BMS_BASE_URL = 'https://api.mnotify.com/api'
/** A slow SMS gateway must never hold anything up for long, and nothing waits on it anyway. */
const TIMEOUT_MS = 8_000
/** Three SMS parts. Longer text is cut rather than sent as a costly multi-part blast. */
const MAX_LENGTH = 459

const ghs = (pesewas: number) => `GHS ${(pesewas / 100).toFixed(2)}`

/**
 * Text messages to buyers and agents, through BMS Africa.
 *
 * The one rule this whole class is built around: an SMS is a courtesy, never
 * part of a process. Every public method returns immediately, sends in the
 * background, and swallows every failure (no key, gateway down, timeout,
 * rejected number, out of credit) into a log line. An order, refund or
 * payout has always already been saved before anything here is called, and
 * nothing here can roll it back, delay it or throw into it.
 *
 * Switched off entirely, silently, until `SMS_API_KEY` and `SMS_SENDER_ID`
 * are set (the sender ID must be registered with BMS first). `SMS_ENABLED=false`
 * turns it off without removing the key.
 */
@Injectable()
export class SmsService {
  private readonly log = new Logger(SmsService.name)
  private readonly apiKey: string
  private readonly sender: string
  private readonly enabled: boolean

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.apiKey = config.get<string>('SMS_API_KEY')?.trim() ?? ''
    this.sender = (config.get<string>('SMS_SENDER_ID')?.trim() ?? '').slice(0, 11)
    const switchedOff = config.get<string>('SMS_ENABLED')?.trim().toLowerCase() === 'false'
    this.enabled = Boolean(this.apiKey && this.sender) && !switchedOff
    if (!this.enabled) {
      this.log.log(
        switchedOff
          ? 'SMS switched off (SMS_ENABLED=false).'
          : 'SMS not configured (set SMS_API_KEY and SMS_SENDER_ID to send texts). Nothing will be sent.',
      )
    }
  }

  /** For the health check: whether texts are actually going out. */
  get state(): 'live' | 'off' {
    return this.enabled ? 'live' : 'off'
  }

  // ─── What gets sent ─────────────────────────────────────────────────────────

  /**
   * After an order settles: delivered (with the voucher for a checker), or
   * failed and owed back. Every order text carries its reference.
   *
   * Retries change what the buyer needs to hear. A failed order that is then
   * reordered and delivered already told the buyer "refund coming", so the
   * delivery text says no refund is needed. A reorder that fails again says
   * it was tried again, instead of repeating the first failure word for word.
   */
  orderSettled(orderId: string): void {
    this.inBackground(`order ${orderId}`, async () => {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          reference: true,
          status: true,
          productName: true,
          network: true,
          category: true,
          recipient: true,
          buyerPhone: true,
          salePrice: true,
          voucherSerial: true,
          voucherPin: true,
          refundRequest: { select: { status: true, note: true } },
          _count: { select: { dispatches: true } },
        },
      })
      if (!order) return
      const what = `${order.productName}${order.network && !order.productName.includes(order.network) ? ` (${order.network})` : ''}`
      const refund = order.refundRequest
      // A refund row on an order means it failed at least once before this outcome.
      const failedBefore = Boolean(refund)
      const triedAgain = order._count.dispatches > 1

      if (order.status === 'completed') {
        if (order.category === 'checker' && order.voucherSerial && order.voucherPin) {
          // The page and receipt promise the voucher by SMS, to the number given for it.
          await this.send(
            order.recipient,
            `Your ${order.productName}: Serial ${order.voucherSerial}, PIN ${order.voucherPin}. Ref ${order.reference}. Keep this message safe.`,
          )
          return
        }
        const toSomeoneElse = normalise(order.recipient) !== normalise(order.buyerPhone)
        const to = toSomeoneElse ? ` to ${order.recipient}` : ''
        await this.send(
          order.buyerPhone,
          failedBefore
            ? `Good news: we tried again and ${what} has now been delivered${to}. Ref ${order.reference}. No refund is needed.`
            : `${what} delivered${to}. Ref ${order.reference}. Thank you for buying with us.`,
        )
        return
      }

      // Only a paid order that failed is owed anything (it has a refund
      // request); an unpaid checkout that closed needs no message at all.
      if (order.status === 'failed' && refund && refund.status === 'pending') {
        await this.send(
          order.buyerPhone,
          triedAgain
            ? `We tried again but could not deliver ${what} (Ref ${order.reference}). Your ${ghs(order.salePrice)} will be refunded to you shortly.`
            : `Sorry, we could not deliver ${what} (Ref ${order.reference}). Your ${ghs(order.salePrice)} will be refunded to you shortly.`,
        )
      }
    })
  }

  /** After a refund has actually reached the customer (sent, or credited to their wallet). */
  refundPaid(refundId: string): void {
    this.inBackground(`refund ${refundId}`, async () => {
      const refund = await this.prisma.refundRequest.findUnique({
        where: { id: refundId },
        select: { buyerPhone: true, amount: true, orderRef: true, method: true },
      })
      if (!refund) return
      const where = refund.method === 'wallet' ? 'your wallet' : 'your Mobile Money'
      await this.send(refund.buyerPhone, `Your refund of ${ghs(refund.amount)} for Ref ${refund.orderRef} has been sent to ${where}.`)
    })
  }

  /**
   * After an admin refuses a refund the buyer was already told was coming.
   * Silence there reads as being ignored; the reason itself stays internal,
   * it is written for the record, not for the customer.
   */
  refundDeclined(refundId: string): void {
    this.inBackground(`refund ${refundId}`, async () => {
      const refund = await this.prisma.refundRequest.findUnique({
        where: { id: refundId },
        select: { buyerPhone: true, amount: true, orderRef: true },
      })
      if (!refund) return
      await this.send(
        refund.buyerPhone,
        `Update on Ref ${refund.orderRef}: the ${ghs(refund.amount)} refund was not approved. Please contact us with this reference if you have questions.`,
      )
    })
  }

  /** After an agent's payout has actually been sent. */
  payoutSent(withdrawalId: string): void {
    this.inBackground(`payout ${withdrawalId}`, async () => {
      const w = await this.prisma.withdrawal.findUnique({
        where: { id: withdrawalId },
        select: { id: true, agentPhone: true, amount: true },
      })
      if (!w) return
      await this.send(
        w.agentPhone,
        `Your withdrawal of ${ghs(w.amount)} has been sent to your Mobile Money ${w.agentPhone}. Ref ${payoutRef(w.id)}.`,
      )
    })
  }

  /** After a payout is rejected, cancelled or could not be sent, and the money went back to the agent. */
  payoutReturned(withdrawalId: string): void {
    this.inBackground(`payout ${withdrawalId}`, async () => {
      const w = await this.prisma.withdrawal.findUnique({
        where: { id: withdrawalId },
        select: { id: true, agentPhone: true, amount: true, transferFee: true },
      })
      if (!w) return
      await this.send(
        w.agentPhone,
        `Your withdrawal of ${ghs(w.amount)} (Ref ${payoutRef(w.id)}) was not sent. ${ghs(w.amount + w.transferFee)} is back in your balance, you can request it again.`,
      )
    })
  }

  // ─── How it gets sent ───────────────────────────────────────────────────────

  /**
   * Runs `work` detached from the caller. Never awaited by anyone, never
   * throws: the caller's request finishes whether or not this ever does.
   */
  private inBackground(label: string, work: () => Promise<void>): void {
    if (!this.enabled) return
    setImmediate(() => {
      work().catch((error: unknown) => this.log.warn(`SMS for ${label} not sent: ${String(error)}`))
    })
  }

  /** One message to one number. Resolves `false` on any failure, never throws. */
  private async send(to: string, message: string): Promise<boolean> {
    const recipient = normalise(to)
    if (!recipient) {
      this.log.warn(`SMS skipped: "${mask(to)}" is not a Ghana mobile number`)
      return false
    }
    try {
      const response = await fetch(`${BMS_BASE_URL}/sms/quick?key=${encodeURIComponent(this.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          recipient: [recipient],
          sender: this.sender,
          message: message.slice(0, MAX_LENGTH),
          is_schedule: false,
          schedule_date: '',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const body = (await response.json().catch(() => null)) as
        | { status?: string; code?: string; message?: string; summary?: { _id?: string; credit_left?: number } }
        | null
      if (!response.ok || body?.status !== 'success') {
        this.log.warn(`SMS to ${mask(recipient)} refused: HTTP ${response.status} ${body?.code ?? ''} ${body?.message ?? ''}`.trim())
        return false
      }
      // "Accepted" is all BMS can say at this point; whether the network then
      // delivered it shows in their report under this campaign id.
      this.log.log(
        `SMS to ${mask(recipient)} accepted by BMS, campaign ${body.summary?._id ?? 'unknown'}, ${body.summary?.credit_left ?? '?'} credits left`,
      )
      return true
    } catch (error) {
      this.log.warn(`SMS to ${mask(recipient)} failed: ${String(error)}`)
      return false
    }
  }
}

/** Any Ghana mobile format (0XXXXXXXXX, 233XXXXXXXXX, +233 XX XXX XXXX) to the local 0XXXXXXXXX BMS expects. */
export function normalise(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (/^0\d{9}$/.test(digits)) return digits
  if (/^233\d{9}$/.test(digits)) return `0${digits.slice(3)}`
  if (/^\d{9}$/.test(digits)) return `0${digits}`
  return null
}

/** The reference agents already see for a payout in their earnings list. */
function payoutRef(withdrawalId: string): string {
  return `WDR-${withdrawalId.slice(0, 8).toUpperCase()}`
}

/** Logs carry enough to trace a number, not enough to read it. */
function mask(phone: string): string {
  return phone.length > 4 ? `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}` : '****'
}
