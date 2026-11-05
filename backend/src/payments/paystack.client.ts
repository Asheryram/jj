import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Network } from '@prisma/client'
import { networkFromPaystackBank } from './momo'

/**
 * The Paystack HTTP client. Transport and signature checking only.
 *
 * Three facts about their contract shape everything here:
 *
 *  1. **Amounts are in the currency's subunit.** For GHS that is pesewas, which
 *     is what this codebase already uses everywhere, so nothing is converted.
 *     A bug here would over- or under-charge by 100×, so it is asserted rather
 *     than assumed: `verify` compares their amount against ours.
 *
 *  2. **The webhook is signed, the redirect is not.** `x-paystack-signature` is
 *     an HMAC-SHA512 of the raw request body keyed with the secret key. The
 *     browser coming back to `callback_url` carries no proof of anything, it is
 *     the one party in the exchange with a motive to lie about having paid, so a
 *     return trip triggers a server-side `verify` call rather than being trusted.
 *
 *  3. **`charge.success` can arrive more than once.** Retries and duplicates are
 *     normal, so every consumer of this client must be idempotent.
 */
@Injectable()
export class PaystackClient {
  private readonly log = new Logger(PaystackClient.name)
  private readonly baseUrl = 'https://api.paystack.co'

  constructor(private readonly config: ConfigService) {}

  get secretKey(): string | null {
    return this.config.get<string>('PAYSTACK_SECRET_KEY') || null
  }

  get configured(): boolean {
    return Boolean(this.secretKey)
  }

  /** True for a `sk_test_` key, useful for saying so on screen. */
  get isTestMode(): boolean {
    return this.secretKey?.startsWith('sk_test') ?? false
  }

  /**
   * Start a payment and get the URL to send the customer to.
   *
   * `reference` is ours, and for an order it IS the order reference, so a
   * payment can never be matched to the wrong order. Paystack rejects a
   * duplicate reference, which doubles as protection against charging twice for
   * one order.
   *
   * `email` is required by Paystack even when it means nothing to us; a guest
   * buying with Mobile Money has no account. A synthesised address is passed
   * rather than a fake shared one so their dashboard stays legible per customer.
   */
  async initialise(input: {
    reference: string
    amount: number
    email: string
    callbackUrl: string
    metadata?: Record<string, unknown>
  }): Promise<
    { ok: true; authorizationUrl: string; accessCode: string } | { ok: false; reason: string }
  > {
    const key = this.secretKey
    if (!key) return { ok: false, reason: 'No Paystack secret key configured.' }

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/transaction/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          reference: input.reference,
          amount: input.amount,
          email: input.email,
          currency: 'GHS',
          callback_url: input.callbackUrl,
          // Ghana: mobile money is how most people pay, card is the fallback.
          channels: ['mobile_money', 'card'],
          metadata: input.metadata ?? {},
        }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      return { ok: false, reason: `Could not reach Paystack: ${String(error)}` }
    }

    const body = (await response.json().catch(() => ({}))) as PaystackEnvelope<{
      authorization_url?: string
      access_code?: string
    }>

    if (!response.ok || body.status !== true || !body.data?.authorization_url) {
      const reason = body.message ?? `HTTP ${response.status}`
      this.log.error(`initialise ${input.reference} failed: ${reason}`)
      return { ok: false, reason }
    }

    return {
      ok: true,
      authorizationUrl: body.data.authorization_url,
      accessCode: body.data.access_code ?? '',
    }
  }

  /**
   * Ask Paystack what actually happened. The authoritative answer.
   *
   * Used both when the customer returns to the app and when a webhook arrives,
   * because a signature proves who sent a message but not that its contents are
   * current, and this call costs nothing.
   */
  async verify(reference: string): Promise<VerifyOutcome> {
    const key = this.secretKey
    if (!key) return { kind: 'unavailable', reason: 'No Paystack secret key configured.' }

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      return { kind: 'unavailable', reason: `Could not reach Paystack: ${String(error)}` }
    }

    const raw = await response.text().catch(() => '')
    let body: PaystackEnvelope<PaystackTransaction> = {}
    try {
      body = JSON.parse(raw) as PaystackEnvelope<PaystackTransaction>
    } catch {
      body = {}
    }

    if (response.status === 404) return { kind: 'not_found' }
    if (!response.ok || body.status !== true || !body.data) {
      return { kind: 'unavailable', reason: body.message ?? `HTTP ${response.status}` }
    }

    return {
      kind: 'found',
      status: body.data.status ?? 'unknown',
      amount: Number(body.data.amount ?? 0),
      currency: String(body.data.currency ?? ''),
      channel: body.data.channel ?? null,
      // Which network actually carried a mobile money charge, theirs to
      // know, since they are the one who charged it. Null for a card payment,
      // or a bank name this platform does not recognise; see `momo.ts`.
      network: networkFromPaystackBank(body.data.authorization?.bank),
      payerNumber: localNumber(body.data.authorization?.mobile_money_number),
      fee: body.data.fees ?? null,
      providerId: body.data.id != null ? String(body.data.id) : null,
      raw: `HTTP ${response.status} ${raw}`.slice(0, 2000),
    }
  }

  /**
   * What Paystack is holding for us right now, in pesewas.
   *
   * The only figure that says whether an obligation can actually be met. Our own
   * ledger knows what is owed; it has no idea what is left to pay it with, and a
   * payout approved against money that is not there fails at the worst possible
   * moment, after the agent has been told it is coming.
   */
  async balance(): Promise<{ ok: true; balance: number } | { ok: false; reason: string }> {
    const key = this.secretKey
    if (!key) return { ok: false, reason: 'No Paystack secret key configured.' }

    try {
      const response = await fetch(`${this.baseUrl}/balance`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await response.json().catch(() => ({}))) as PaystackEnvelope<
        { currency?: string; balance?: number }[]
      >

      if (!response.ok || body.status !== true || !Array.isArray(body.data)) {
        return { ok: false, reason: body.message ?? `HTTP ${response.status}` }
      }

      // They return one row per currency. Anything but GHS is somebody else's
      // money as far as this platform is concerned.
      const ghs = body.data.find((row) => row.currency === 'GHS')
      if (!ghs) return { ok: false, reason: 'Paystack reports no GHS balance on this account.' }

      return { ok: true, balance: Number(ghs.balance ?? 0) }
    } catch (error) {
      return { ok: false, reason: `Could not reach Paystack: ${String(error)}` }
    }
  }

  /**
   * When money last actually left the balance for our bank account.
   *
   * `balance()` only ever answers "right now", it cannot say whether a fresh
   * sale is still in transit or genuinely missing. Knowing the last settlement
   * date lets a caller draw the line: anything paid after it is still on its way,
   * not lost. Null with no error means the account has never settled anything yet.
   */
  async lastSettlementAt(): Promise<{ ok: true; at: Date | null } | { ok: false; reason: string }> {
    const key = this.secretKey
    if (!key) return { ok: false, reason: 'No Paystack secret key configured.' }

    try {
      const response = await fetch(`${this.baseUrl}/settlement?perPage=1`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await response.json().catch(() => ({}))) as PaystackEnvelope<
        { settlement_date?: string }[]
      >

      if (!response.ok || body.status !== true || !Array.isArray(body.data)) {
        return { ok: false, reason: body.message ?? `HTTP ${response.status}` }
      }

      const latest = body.data[0]?.settlement_date
      return { ok: true, at: latest ? new Date(latest) : null }
    } catch (error) {
      return { ok: false, reason: `Could not reach Paystack: ${String(error)}` }
    }
  }

  /**
   * Ask Paystack what became of a transfer, by the reference we sent it with.
   *
   * The answer to a timeout, and to a confirmation that never arrived. Only
   * an explicit "not found" means Paystack has no such transfer; anything else
   * unreadable is `error`, and an unknown is never taken for a no.
   */
  async verifyTransfer(reference: string): Promise<TransferLookup> {
    const key = this.secretKey
    if (!key) return { kind: 'error', reason: 'No Paystack secret key configured.' }

    try {
      const response = await fetch(`${this.baseUrl}/transfer/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await response.json().catch(() => ({}))) as PaystackEnvelope<{
        status?: string
        transfer_code?: string
      }>

      if (response.ok && body.status === true && body.data?.status) {
        return { kind: 'found', status: body.data.status, transferCode: body.data.transfer_code ?? null }
      }
      if (response.status === 404 || /not found/i.test(body.message ?? '')) return { kind: 'not_found' }
      return { kind: 'error', reason: body.message ?? `Paystack returned ${response.status}.` }
    } catch (error) {
      return { kind: 'error', reason: `Could not reach Paystack: ${String(error)}` }
    }
  }

  /**
   * One page of the balance history: every movement in and out of the
   * Paystack balance, newest first. A top-up made on the dashboard shows here
   * as a `Transaction`, the same as a customer payment, which is why
   * `TreasuryService.syncTopups` tells them apart by matching our own payments.
   */
  async balanceLedger(input: { from: Date; page: number }): Promise<
    | {
        ok: true
        entries: {
          id: string
          difference: number
          reason: string | null
          model: string | null
          transactionId: string | null
          createdAt: Date
        }[]
      }
    | { ok: false; reason: string }
  > {
    const key = this.secretKey
    if (!key) return { ok: false, reason: 'No Paystack secret key configured.' }

    try {
      const query = `from=${encodeURIComponent(input.from.toISOString())}&perPage=100&page=${input.page}`
      const response = await fetch(`${this.baseUrl}/balance/ledger?${query}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000),
      })
      const body = (await response.json().catch(() => ({}))) as PaystackEnvelope<
        {
          id?: number | string
          currency?: string
          difference?: number
          reason?: string
          model_responsible?: string
          model_row?: number | string | { id?: number | string } | null
          createdAt?: string
          created_at?: string
        }[]
      >
      if (!response.ok || body.status !== true || !Array.isArray(body.data)) {
        return { ok: false, reason: body.message ?? `HTTP ${response.status}` }
      }

      const entries = body.data
        .filter((row) => row.id != null && (row.currency ?? 'GHS') === 'GHS')
        .map((row) => {
          // Seen both as a bare id and as the embedded row; take the id either way.
          const raw = row.model_row
          const transactionId =
            raw == null ? null : typeof raw === 'object' ? (raw.id != null ? String(raw.id) : null) : String(raw)
          return {
            id: String(row.id),
            difference: Number(row.difference ?? 0),
            reason: row.reason ?? null,
            model: row.model_responsible ?? null,
            transactionId,
            createdAt: new Date(row.createdAt ?? row.created_at ?? Date.now()),
          }
        })
      return { ok: true, entries }
    } catch (error) {
      return { ok: false, reason: `Could not reach Paystack: ${String(error)}` }
    }
  }

  /**
   * A Mobile Money recipient, created once per agent number and reused.
   *
   * Ghana pays out to Mobile Money rather than a bank account, so `type` is
   * `mobile_money` and `bank_code` is the network, MTN, VOD or ATL, exactly as
   * `GET /bank?currency=GHS&type=mobile_money` returns them. `account_number` is
   * the phone number.
   *
   * Reused because a recipient per payout would fill their dashboard with
   * duplicates of the same person, and because the code is what a transfer is
   * addressed to: one stable handle per agent is easier to reason about when
   * something goes wrong.
   */
  async createRecipient(input: {
    name: string
    phone: string
    /** MTN | VOD | ATL */
    networkCode: string
  }): Promise<{ ok: true; recipientCode: string } | { ok: false; reason: string }> {
    const key = this.secretKey
    if (!key) return { ok: false, reason: 'No Paystack secret key configured.' }

    try {
      const response = await fetch(`${this.baseUrl}/transferrecipient`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          type: 'mobile_money',
          name: input.name,
          account_number: input.phone,
          bank_code: input.networkCode,
          currency: 'GHS',
        }),
        signal: AbortSignal.timeout(20_000),
      })

      const body = (await response.json().catch(() => ({}))) as PaystackEnvelope<{
        recipient_code?: string
      }>

      if (!response.ok || body.status !== true || !body.data?.recipient_code) {
        return { ok: false, reason: body.message ?? `Paystack returned ${response.status}.` }
      }
      return { ok: true, recipientCode: body.data.recipient_code }
    } catch (error) {
      return { ok: false, reason: `Could not reach Paystack: ${String(error)}` }
    }
  }

  /**
   * Send money to a recipient.
   *
   * ── The three answers that matter ──────────────────────────────────────────
   *
   * `sent`, accepted, and Paystack will confirm the outcome by webhook. Not yet
   * delivered; a transfer can still fail or be reversed afterwards.
   *
   * `otp`, the account requires an OTP per transfer, so this cannot complete
   * without a human typing a code. Automated payouts are impossible until it is
   * switched off in Paystack's dashboard, and saying so plainly beats leaving
   * every payout mysteriously stuck.
   *
   * `failed`, refused outright, most often for want of balance. Nothing left the
   * account, so the caller must give the agent their money back.
   *
   * `reference` is ours and Paystack rejects a duplicate, which is what makes
   * this safe to retry: unlike the DataHub purchase, a repeated call cannot pay
   * twice.
   */
  async transfer(input: {
    recipientCode: string
    /** Pesewas. */
    amount: number
    reference: string
    reason: string
  }): Promise<TransferOutcome> {
    const key = this.secretKey
    if (!key) return { kind: 'failed', reason: 'No Paystack secret key configured.' }

    /**
     * A local copy of the live database run against the live key: only the
     * treasury's own transfers may go. An agent payout or a customer refund
     * approved on the copy would pay real money production never hears about,
     * and production would pay the same person again. Never set in production.
     */
    if (this.config.get<string>('PAYSTACK_TREASURY_ONLY') === '1' && !input.reference.startsWith('TRS-')) {
      this.log.warn(`transfer ${input.reference} blocked, PAYSTACK_TREASURY_ONLY is set`)
      return { kind: 'failed', reason: 'Blocked on this local test copy (PAYSTACK_TREASURY_ONLY), nothing was sent.' }
    }

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          source: 'balance',
          amount: input.amount,
          recipient: input.recipientCode,
          reference: input.reference,
          reason: input.reason,
          currency: 'GHS',
        }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      // Ambiguous: the transfer may or may not have been created. Never retried
      // blindly, the reference makes a deliberate retry safe, but a caller has
      // to decide that, and the reconciler can ask what happened.
      return {
        kind: 'unknown',
        reason: `Paystack did not answer in time: ${String(error)}`,
      }
    }

    const raw = await response.text().catch(() => '')
    let body: PaystackEnvelope<{ status?: string; transfer_code?: string }> = {}
    try {
      body = JSON.parse(raw) as PaystackEnvelope<{ status?: string; transfer_code?: string }>
    } catch {
      body = {}
    }

    if (!response.ok || body.status !== true) {
      const reason = body.message ?? `Paystack returned ${response.status}.`
      // A 5xx may have created the transfer before failing to answer.
      if (response.status >= 500) return { kind: 'unknown', reason }
      this.log.error(`transfer ${input.reference} refused: ${raw.slice(0, 300)}`)
      return {
        kind: 'failed',
        reason,
        insufficientBalance: /insufficient|balance/i.test(reason),
      }
    }

    const status = body.data?.status ?? 'pending'
    if (status === 'otp') {
      this.log.error(
        `transfer ${input.reference} is waiting for an OTP, automated payouts need ` +
          'transfer OTP disabled in the Paystack dashboard.',
      )
      return { kind: 'otp', transferCode: body.data?.transfer_code ?? null }
    }

    return {
      kind: 'sent',
      transferCode: body.data?.transfer_code ?? null,
      status,
    }
  }

  /**
   * Whether this request really came from Paystack.
   *
   * HMAC-SHA512 of the **raw** body, a re-serialised object will not match,
   * which is why `main.ts` enables `rawBody`. Compared in constant time so the
   * response cannot be used to discover a valid signature byte by byte.
   */
  signatureValid(rawBody: Buffer | string | undefined, signature: string | undefined): boolean {
    const key = this.secretKey
    if (!key || !signature || !rawBody) return false

    const expected = createHmac('sha512', key).update(rawBody).digest('hex')
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(signature, 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  }
}

interface PaystackEnvelope<T> {
  status?: boolean
  message?: string
  data?: T
}

interface PaystackTransaction {
  id?: number | string
  status?: string
  amount?: number
  currency?: string
  channel?: string | null
  /** What Paystack keeps, in pesewas. Their figure, not our arithmetic. */
  fees?: number | null
  /**
   * Present on a mobile money charge: `bank` carries the network and
   * `mobile_money_number` the full number that paid.
   */
  authorization?: { bank?: string | null; mobile_money_number?: string | null } | null
}

export type TransferOutcome =
  /** Accepted. Paystack confirms the real outcome by webhook. */
  | { kind: 'sent'; transferCode: string | null; status: string }
  /** The account demands an OTP per transfer, so this cannot be automated. */
  | { kind: 'otp'; transferCode: string | null }
  /** Refused. Nothing left the account. */
  | { kind: 'failed'; reason: string; insufficientBalance?: boolean }
  /** No usable answer. May or may not exist at Paystack; ask before retrying. */
  | { kind: 'unknown'; reason: string }

export type TransferLookup =
  | { kind: 'found'; status: string; transferCode: string | null }
  /** Paystack has no transfer with this reference: it never went out. */
  | { kind: 'not_found' }
  /** No usable answer. Says nothing about the transfer either way. */
  | { kind: 'error'; reason: string }

/**
 * The webhook event a looked-up status amounts to, so a lookup settles through
 * the same code as a delivered webhook. Null while it is still undecided.
 */
export function transferEventFor(status: string): 'transfer.success' | 'transfer.failed' | 'transfer.reversed' | null {
  if (status === 'success') return 'transfer.success'
  if (status === 'reversed') return 'transfer.reversed'
  return ['failed', 'abandoned', 'blocked', 'rejected'].includes(status) ? 'transfer.failed' : null
}

/** A Ghana number in local form, 0XXXXXXXXX, or null if it is not one. */
function localNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  const local = digits.startsWith('233') && digits.length === 12 ? `0${digits.slice(3)}` : digits
  return /^0\d{9}$/.test(local) ? local : null
}

/** One reference per approval of a refund, see `RefundsService.sendRefund`. */
export function refundTransferReference(row: { id: string; decidedAt: Date | null; createdAt: Date }): string {
  return `RFD-${row.id}_${(row.decidedAt ?? row.createdAt).getTime().toString(36)}`
}

export type VerifyOutcome =
  | {
      kind: 'found'
      /** Their vocabulary: success, failed, abandoned, pending, reversed. */
      status: string
      amount: number
      currency: string
      channel: string | null
      /** The Mobile Money network that carried this, when it can be told. */
      network: Network | null
      /**
       * The Mobile Money number that actually paid, as Paystack charged it,
       * in local form (0XXXXXXXXX). Null for a card, or when Paystack did
       * not say. Not the order's phone number, which is only for the receipt.
       */
      payerNumber: string | null
      /** Pesewas Paystack kept. Null when they did not say. */
      fee: number | null
      providerId: string | null
      raw: string
    }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; reason: string }
