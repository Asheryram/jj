import { createHash } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

/**
 * The GMPL HTTP client (getmorepaylessdatahouse.net). Transport only, no
 * domain decisions here, same split as `DatahubClient`.
 *
 * Their `/developers` page is a client-rendered SPA, so this is built against
 * their own published agent API v1, read directly out of that page's JS
 * bundle (no server-rendered docs exist to fetch instead). Two things about
 * their contract shape the code and are worth knowing before changing it:
 *
 *  1. **A purchase is idempotent.** Every `POST /agent/orders` carries a
 *     client-supplied `idempotencyKey` (a UUID v4); the same key with the
 *     same body within 24h returns the SAME order, never a second one. That
 *     is the opposite of DataHub's contract (see `datahub.client.ts`'s own
 *     header), and it is what makes `purchase()` here safe to retry on a
 *     timeout, a 5xx, or a 429, unlike DataHub's single-shot rule.
 *  2. **They only sell MTN and Telecel data bundles.** No AirtelTigo, no
 *     airtime, no result-checker endpoint exists on this API at all.
 */

export type PurchaseOutcome =
  | {
      kind: 'accepted'
      /** Their `publicId` (`ord_...`). Used for `GET /agent/orders/:id` and every `order.*` webhook. */
      providerReference: string
      /**
       * Their internal order id. `purchase.success`/`purchase.failed`
       * webhook events key on THIS instead of `providerReference`, the one
       * documented inconsistency in their event schema.
       */
      secondaryReference: string
      providerStatus: string
      /** Pesewas charged, from their reply's own `amount` (cedis, converted at the boundary). Null if absent. */
      charged: number | null
      raw: string
    }
  | { kind: 'rejected'; code: string; reason: string; insufficientBalance: boolean; raw: string }
  /** The request may or may not have been executed, or every retry was exhausted. */
  | { kind: 'unknown'; reason: string; raw: string }

export type StatusOutcome =
  | { kind: 'found'; providerStatus: string; raw: unknown }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; reason: string }

export type PrecheckOutcome =
  | {
      kind: 'ok'
      results: { phone: string; normalized: string; valid: boolean; known: boolean }[]
      recorded: boolean
      /**
       * False means Up2U is not actually being applied to this response at
       * all, TELECEL, the kill switch off, or a sandbox key, see their own
       * docs. Every well-formed number comes back `known: true` in that
       * case, an honest "nothing is blocking you right now", never proof
       * MTN approved them. Callers that write `approvedAt` from a `known`
       * result should treat an `enforced: false` batch as unconfirmed, not
       * as a real decision.
       */
      enforced: boolean
      /** A sandbox (`ak_test_…`) key never enforces Up2U and never records anything, even with `record: true`. */
      sandbox: boolean
      /** False means GMPL is in maintenance; their own docs say not to place the order yet. */
      acceptingOrders: boolean
    }
  | { kind: 'unavailable'; reason: string }

export type WalletBalanceOutcome = { kind: 'ok'; balanceCedis: number } | { kind: 'unavailable'; reason: string }

export interface GmplBundle {
  id: string
  name: string
  network: 'MTN' | 'TELECEL'
  dataVolume: string
  agentAmountPesewas: number
  isActive: boolean
}

export type CatalogueOutcome = { kind: 'ok'; bundles: GmplBundle[] } | { kind: 'failed'; reason: string }

interface GmplEnvelope {
  success?: boolean
  statusCode?: number
  message?: string
  error?: { code?: string; message?: string; details?: string[] }
  data?: unknown
}

/**
 * Their `error.message` alone is often a generic "Validation failed" with the
 * actual problem sitting in `error.details` (confirmed against a real 400:
 * their own docs show `type=DATA`, their validator only accepts lowercase
 * `type=data`, and `details` was the only place that said so). Folded into
 * one string so a sync failure is diagnosable from `SourceResult.error`
 * alone, without going back to curl them by hand to find out what actually
 * went wrong.
 */
function gmplErrorReason(body: GmplEnvelope, fallback: string): string {
  const base = body.error?.message ?? body.message ?? fallback
  const details = body.error?.details
  return details && details.length > 0 ? `${base}: ${details.join('; ')}` : base
}

interface RawBundle {
  id?: string
  name?: string
  dataVolume?: string
  amount?: number | string
  agentAmount?: number | string
  isActive?: boolean
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * A deterministic, RFC-4122-shaped v4 UUID from a stable seed.
 *
 * GMPL requires a real UUID as `idempotencyKey` and guarantees the same key
 * with the same body returns the same order within 24h, the retry safety
 * DataHub's contract cannot offer (see this file's own header). Deriving it
 * from `${orderReference}:${attempt}` rather than a fresh random one per call
 * means every retry of the SAME attempt, a crash-recovery sweep, a timed-out
 * request retried internally, reuses the identical key and is therefore a
 * genuine no-op at GMPL's end, never a second sale. A new `attempt` (an
 * admin's retry/reorder) mints a fresh one on purpose.
 */
export function gmplIdempotencyKey(orderReference: string, attempt: number): string {
  const hash = createHash('sha256').update(`gmpl:${orderReference}:${attempt}`).digest()
  hash[6] = (hash[6] & 0x0f) | 0x40 // version 4
  hash[8] = (hash[8] & 0x3f) | 0x80 // variant 10xx
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

@Injectable()
export class GmplClient {
  private readonly log = new Logger(GmplClient.name)

  constructor(private readonly config: ConfigService) {}

  get baseUrl(): string {
    return (
      this.config.get<string>('GMPL_BASE_URL')?.replace(/\/$/, '') ||
      'https://api.getmorepaylessdatahouse.net/api/v1'
    )
  }

  /** The agent's own API key, `ak_live_…`/`ak_test_…`. Kept under its existing env name, GMPL_SECRET. */
  get apiKey(): string | null {
    return this.config.get<string>('GMPL_SECRET') || null
  }

  get configured(): boolean {
    return Boolean(this.apiKey)
  }

  /** True for an `ak_test_…` key: sandbox, never debits a real wallet or reaches real delivery. */
  get isTestMode(): boolean {
    return this.apiKey?.startsWith('ak_test') ?? false
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { 'x-api-key': this.apiKey ?? '', ...extra }
  }

  /**
   * Retry with exponential backoff. Unlike `DatahubClient.fetchRepeatable`,
   * this is safe for EVERY call here, including `purchase()`, because every
   * request that spends money carries an idempotency key GMPL itself
   * guarantees is safe to replay (see this file's own header). Retried:
   * transport failures, 5xx, and 429, `Retry-After` honoured when they send it.
   */
  private async fetchRepeatable(url: string, init: RequestInit, label: string, attempts = 3): Promise<Response> {
    let lastError: unknown

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(url, init)
        const retryable = response.status === 429 || response.status >= 500
        if (!retryable || attempt === attempts) return response

        const after = Number(response.headers.get('retry-after'))
        const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 400 * 3 ** (attempt - 1)
        this.log.warn(`${label} got ${response.status}, retrying in ${wait}ms (${attempt}/${attempts})`)
        await delay(wait)
        continue
      } catch (error) {
        lastError = error
        if (attempt === attempts) break
        const wait = 400 * 3 ** (attempt - 1)
        this.log.warn(`${label} failed (${String(error)}), retrying in ${wait}ms (${attempt}/${attempts})`)
        await delay(wait)
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  /** Their live catalogue for one network: every active bundle, priced for this key's own tier. */
  async bundles(network: 'MTN' | 'TELECEL'): Promise<CatalogueOutcome> {
    if (!this.configured) return { kind: 'failed', reason: 'No GMPL API key configured.' }

    let response: Response
    try {
      response = await this.fetchRepeatable(
        // Their own docs show `type=DATA`, uppercase; the real validator only
        // accepts lowercase `data` and answers a 400 otherwise. Confirmed
        // against their live API, not assumed from the docs.
        this.url(`/agent/bundles?type=data&network=${network}&limit=100`),
        { headers: this.headers(), signal: AbortSignal.timeout(20_000) },
        'bundles',
      )
    } catch (error) {
      const reason = (error as Error)?.name === 'TimeoutError' ? 'timed out' : String(error)
      return { kind: 'failed', reason: `Could not reach GMPL, request ${reason}.` }
    }

    const body = (await response.json().catch(() => ({}))) as GmplEnvelope & {
      data?: { data?: RawBundle[] }
    }

    if (!response.ok || body.success === false || !Array.isArray(body.data?.data)) {
      return {
        kind: 'failed',
        reason: gmplErrorReason(body, `GMPL returned HTTP ${response.status}.`),
      }
    }

    const bundles = body.data.data
      .filter((b): b is RawBundle & { id: string } => Boolean(b?.id))
      .map((b) => ({
        id: String(b.id),
        name: String(b.name ?? ''),
        network,
        dataVolume: String(b.dataVolume ?? ''),
        // agentAmount is what THIS key is charged; fall back to amount only
        // if a bundle is ever missing it, rather than pricing at nothing.
        agentAmountPesewas: Math.round(Number(b.agentAmount ?? b.amount ?? 0) * 100),
        isActive: b.isActive !== false,
      }))
      .filter((b) => Number.isFinite(b.agentAmountPesewas) && b.agentAmountPesewas > 0)

    return { kind: 'ok', bundles }
  }

  /**
   * Buy a data bundle. Safe to retry, unlike DataHub's (see this file's own
   * header): a timeout or 5xx here is retried under the hood by
   * `fetchRepeatable` with the identical body and idempotency key, so a
   * retried purchase can never deliver, or charge, twice.
   */
  async purchase(input: { bundleId: string; recipient: string; idempotencyKey: string }): Promise<PurchaseOutcome> {
    if (!this.configured) {
      return {
        kind: 'rejected',
        code: 'NO_KEY',
        reason: 'No GMPL API key configured.',
        insufficientBalance: false,
        raw: '',
      }
    }

    let response: Response
    try {
      response = await this.fetchRepeatable(
        this.url('/agent/orders'),
        {
          method: 'POST',
          headers: this.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            bundleId: input.bundleId,
            phoneNumber: input.recipient,
            idempotencyKey: input.idempotencyKey,
          }),
          signal: AbortSignal.timeout(30_000),
        },
        'orders',
      )
    } catch (error) {
      const reason = (error as Error)?.name === 'TimeoutError' ? 'timed out' : String(error)
      this.log.error(`purchase to ${input.recipient} ${reason} after retries, outcome unknown`)
      return { kind: 'unknown', reason: `Request ${reason} before a reply arrived.`, raw: String(error) }
    }

    const rawText = await response.text().catch(() => '')
    const raw = `HTTP ${response.status} ${rawText}`.slice(0, 2000)

    let body: GmplEnvelope = {}
    try {
      body = JSON.parse(rawText) as GmplEnvelope
    } catch {
      body = {}
    }

    if (!response.ok || body.success === false) {
      const code = body.error?.code ?? `HTTP_${response.status}`
      const reason = gmplErrorReason(body, `HTTP ${response.status}`)
      const insufficientBalance = code === 'INSUFFICIENT_BALANCE'
      if (insufficientBalance) this.log.error(`GMPL wallet exhausted: ${reason}`)
      // Already exhausted its retries inside fetchRepeatable above, so a 5xx
      // reaching here is still genuinely ambiguous, same reasoning as
      // DataHub's own unknown-on-5xx branch.
      if (response.status >= 500) {
        return { kind: 'unknown', reason: `Provider returned ${response.status}: ${reason}`, raw }
      }
      return { kind: 'rejected', code, reason, insufficientBalance, raw }
    }

    const data = body.data as
      | { publicId?: string; id?: string; status?: string; amount?: string | number }
      | undefined
    const providerReference = data?.publicId
    const secondaryReference = data?.id
    if (!providerReference || !secondaryReference) {
      return { kind: 'unknown', reason: 'GMPL accepted the order but returned no usable reference.', raw }
    }

    return {
      kind: 'accepted',
      providerReference,
      secondaryReference,
      providerStatus: data?.status ?? 'received',
      charged: data?.amount != null ? Math.round(Number(data.amount) * 100) : null,
      raw,
    }
  }

  /** Look an order up by their `publicId`. The only way to resolve one whose webhook never arrived. */
  async orderStatus(publicId: string): Promise<StatusOutcome> {
    if (!this.configured) return { kind: 'unavailable', reason: 'No GMPL API key configured.' }

    try {
      const response = await this.fetchRepeatable(
        this.url(`/agent/orders/${encodeURIComponent(publicId)}`),
        { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
        'order-status',
      )
      const body = (await response.json().catch(() => ({}))) as GmplEnvelope

      if (response.status === 404) return { kind: 'not_found' }
      if (!response.ok || body.success === false) {
        return { kind: 'unavailable', reason: gmplErrorReason(body, `HTTP ${response.status}`) }
      }

      const status = (body.data as { status?: string } | undefined)?.status
      if (!status) return { kind: 'unavailable', reason: 'No status in the reply.' }
      return { kind: 'found', providerStatus: status, raw: body }
    } catch (error) {
      this.log.warn(`could not check order status for ${publicId}: ${String(error)}`)
      return { kind: 'unavailable', reason: String(error) }
    }
  }

  /**
   * Their one genuinely live read: unlike DataHub, which only ever reveals a
   * balance as a side effect of an order reply (see `DatahubClient`'s own
   * header), this asks directly, no purchase required. Requires the
   * `wallet:read` scope on the key; confirmed live against this platform's
   * own real account (200, real figures back).
   */
  async getWalletBalance(): Promise<WalletBalanceOutcome> {
    if (!this.configured) return { kind: 'unavailable', reason: 'No GMPL API key configured.' }

    try {
      const response = await this.fetchRepeatable(
        this.url('/agent/wallet/balance'),
        { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
        'wallet-balance',
        2,
      )
      const body = (await response.json().catch(() => ({}))) as GmplEnvelope & {
        data?: { balance?: number }
      }
      if (!response.ok || body.success === false || typeof body.data?.balance !== 'number') {
        return { kind: 'unavailable', reason: gmplErrorReason(body, `HTTP ${response.status}`) }
      }
      return { kind: 'ok', balanceCedis: body.data.balance }
    } catch (error) {
      this.log.warn(`could not check the wallet balance: ${String(error)}`)
      return { kind: 'unavailable', reason: String(error) }
    }
  }

  /**
   * MTN's own "first-time number" precheck (Up2U), their equivalent of
   * DataHub's beneficiary list. TELECEL never blocks. Confirmed against
   * their own published docs (`POST /agent/beneficiaries/precheck`), not
   * reverse-engineered.
   *
   * `record` (default `false`) is a purely speculative check when unset:
   * nothing submits a number into GMPL's own approval queue. `record: true`
   * is meant to actually register an unknown number there, attributed to
   * this key's own agent, exactly as a real blocked order would, used both
   * by `ApprovalsService.submit`'s bulk GMPL branch and by
   * `OrdersService.verifyRecipient` at the exact moment a sale is refused
   * for an unknown number, their own docs call this out specifically: call
   * it before charging, with the real recipient, so a first-time number is
   * queued for MTN's own approval immediately, not only whenever an admin
   * next happens to run a bulk resubmit.
   *
   * `enforced`/`sandbox` matter because every well-formed number comes back
   * `known: true` when either is true (or `network` is TELECEL), which is
   * "nothing is blocking you right now", never "MTN approved these". A
   * sandbox key never enforces Up2U and never records anything, even with
   * `record: true`, confirmed live.
   */
  async precheckBeneficiary(
    network: 'MTN' | 'TELECEL',
    phoneNumbers: string[],
    record = false,
  ): Promise<PrecheckOutcome> {
    if (!this.configured) return { kind: 'unavailable', reason: 'No GMPL API key configured.' }
    if (phoneNumbers.length === 0) return { kind: 'ok', results: [], recorded: false, enforced: true, sandbox: this.isTestMode, acceptingOrders: true }

    try {
      const response = await this.fetchRepeatable(
        this.url('/agent/beneficiaries/precheck'),
        {
          method: 'POST',
          headers: this.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ network, phoneNumbers, record }),
          signal: AbortSignal.timeout(8_000),
        },
        'precheck',
        2,
      )
      const body = (await response.json().catch(() => ({}))) as GmplEnvelope & {
        data?: {
          results?: { phone: string; normalized: string; valid: boolean; known: boolean }[]
          recorded?: boolean
          enforced?: boolean
          sandbox?: boolean
          platform?: { acceptingOrders?: boolean }
        }
      }
      if (!response.ok || body.success === false || !Array.isArray(body.data?.results)) {
        return { kind: 'unavailable', reason: gmplErrorReason(body, `HTTP ${response.status}`) }
      }
      const enforced = body.data.enforced !== false
      const sandbox = body.data.sandbox === true
      if (sandbox || !enforced) {
        this.log.warn(
          `GMPL precheck on ${network}: ${sandbox ? 'sandbox key' : 'Up2U not enforced'}, ` +
            `every well-formed number reads known:true regardless of its real status`,
        )
      }
      return {
        kind: 'ok',
        results: body.data.results,
        recorded: body.data.recorded === true,
        enforced,
        sandbox,
        acceptingOrders: body.data.platform?.acceptingOrders !== false,
      }
    } catch (error) {
      this.log.warn(`could not precheck ${phoneNumbers.length} number(s) on ${network}: ${String(error)}`)
      return { kind: 'unavailable', reason: String(error) }
    }
  }
}

/**
 * Their status vocabulary mapped onto ours. `null` means "not terminal yet,
 * keep waiting", same conservative default as `mapProviderStatus`: anything
 * unrecognised is treated as still in flight rather than as a failure,
 * because guessing wrong in the failure direction refunds a buyer whose
 * bundle actually arrived.
 */
/**
 * This platform's own `Network` ('MTN'/'Telecel'/'AirtelTigo') mapped to
 * GMPL's own vocabulary ('MTN'/'TELECEL'). Only ever called for a product
 * routed to GMPL, and routing validation (`SettingsService.set`) already
 * refuses `gmpl` for AirtelTigo, so this only ever sees the two GMPL
 * actually sells.
 */
export function toGmplNetwork(network: string): 'MTN' | 'TELECEL' {
  return network === 'Telecel' ? 'TELECEL' : 'MTN'
}

/**
 * What a `record: true` precheck attempt means for the row it was about:
 * `recordedAt` only ever moves forward on a confirmed success, and
 * `lastSendError` holds why the most recent attempt did not, so "why is this
 * still Pending" has a real answer sitting in the data, not only a server
 * log that may already be gone by the time anyone asks. Every write site
 * that calls `precheckBeneficiary(..., true)` reads its outcome through
 * this, so the reasons recorded are consistent no matter which caller hit
 * the failure.
 */
export function gmplSendOutcome(result: PrecheckOutcome): { recordedAt: Date | null; lastSendError: string | null } {
  if (result.kind !== 'ok') return { recordedAt: null, lastSendError: result.reason }
  if (result.recorded) return { recordedAt: new Date(), lastSendError: null }
  if (result.sandbox) {
    return { recordedAt: null, lastSendError: 'Not recorded: this is a sandbox GMPL key, which never records a real registration.' }
  }
  if (!result.enforced) {
    return { recordedAt: null, lastSendError: 'Not recorded: Up2U is not enforced right now (TELECEL, or the kill switch is off).' }
  }
  return { recordedAt: null, lastSendError: 'GMPL answered the check but did not confirm recording it.' }
}

export function mapGmplOrderStatus(status: string): 'completed' | 'failed' | null {
  switch (status.toLowerCase()) {
    case 'delivered':
    case 'approved':
    case 'fulfilled':
      return 'completed'
    case 'could_not_deliver':
    case 'rejected':
    case 'refunded':
    case 'fulfillment_failed':
      return 'failed'
    default:
      return null
  }
}
