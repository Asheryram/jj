import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

/**
 * The DataHub GH HTTP client. Transport only — no domain decisions here.
 *
 * Everything this file knows came from their published spec at
 * `GET /api/external/docs` (v2.2.0). Three things about that contract shape the
 * code and are worth knowing before changing it:
 *
 *  1. **A purchase is asynchronous.** `/data-purchase` returns `PROCESSING` and
 *     the real outcome arrives later by webhook. Nothing here may treat a 200 as
 *     a delivery.
 *
 *  2. **There is no idempotency key.** They accept no client reference, so a
 *     retried purchase can bill and deliver twice. `purchase()` therefore never
 *     retries — a timeout is reported as `unknown` and left for reconciliation.
 *     This is the single most important rule in the file.
 *
 *  3. **Their balance is prepaid.** A purchase deducts from a float James funds,
 *     and running dry is a 400, not a 402. `insufficientBalance` is surfaced
 *     separately so it can be alerted on rather than looking like a bad request.
 */

/**
 * Every outcome carries `raw`: the provider's reply, verbatim.
 *
 * `reason` is our one-line reading of it, and it is lossy by design — a bare
 * "Insufficient balance" tells you the class of failure but not the amount they
 * wanted or the amount you had. When an order fails in production the first
 * question is always "what did they actually say", and reconstructing it after
 * the fact is impossible. So it is stored, not summarised away.
 */
export type PurchaseOutcome =
  | {
      kind: 'accepted'
      providerReference: string
      providerStatus: string
      deducted: number | null
      raw: string
    }
  | { kind: 'rejected'; reason: string; insufficientBalance: boolean; raw: string }
  /** The request may or may not have been executed. Never retry on this. */
  | { kind: 'unknown'; reason: string; raw: string }

export type StatusOutcome =
  | { kind: 'found'; providerStatus: string; raw: unknown }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; reason: string }

interface DatahubEnvelope {
  success?: boolean
  message?: string
  error?: string
  data?: {
    reference?: string
    status?: string
    price?: number
    [k: string]: unknown
  }
  balance?: { previous?: number; current?: number; deducted?: number }
}

/**
 * What the provider charged, in cedis, from whichever field they populated.
 *
 * Three sources in order of directness. `deducted` is documented but not always
 * sent; `previous - current` is arithmetic on the balance they always report;
 * `data.price` is the bundle's list price, which is what they charge unless a
 * promotion applies.
 *
 * Null when none are present — better than a zero that would read as free and
 * make every margin on the order look like pure profit.
 */
function deductedFrom(body: DatahubEnvelope): number | null {
  const { deducted, previous, current } = body.balance ?? {}
  if (typeof deducted === 'number') return deducted
  if (typeof previous === 'number' && typeof current === 'number') {
    const difference = previous - current
    // A balance that went up is a top-up racing our order, not a charge.
    if (difference > 0) return Number(difference.toFixed(2))
  }
  return typeof body.data?.price === 'number' ? body.data.price : null
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

@Injectable()
export class DatahubClient {
  private readonly log = new Logger(DatahubClient.name)

  constructor(private readonly config: ConfigService) {}

  /**
   * `https://app.datahubgh.com/api`. Their catalogue hangs directly off it.
   */
  get baseUrl(): string {
    return (
      this.config.get<string>('DATAHUB_BASE_URL')?.replace(/\/$/, '') ??
      'https://app.datahubgh.com/api'
    )
  }

  /**
   * Everything transactional sits one level deeper, under `/external`.
   *
   * This is not cosmetic. `/api/data-purchase` does not exist — it answers with
   * the site's HTML 404 page, which this client reads as a clean rejection
   * (status < 500), so every live order would have been "declined by the
   * provider" and refunded without a single request ever reaching their
   * fulfilment system. `/bundles` happens to live at the shallower path, which
   * is why the catalogue sync worked and hid the problem.
   *
   * Verified against the live API: /external/verify, /external/beneficiaries,
   * /external/order-status and /external/data-purchase all answer; the same
   * paths under /api do not.
   */
  private externalUrl(path: string): string {
    return `${this.baseUrl}/external${path}`
  }

  get apiKey(): string | null {
    return this.config.get<string>('DATAHUB_API_KEY') || null
  }

  get configured(): boolean {
    return Boolean(this.apiKey)
  }

  /**
   * Retry with exponential backoff — for requests that are safe to repeat.
   *
   * DataHub's integration guide recommends retrying with backoff generally. That
   * is right for everything here except the one call that spends money: their API
   * takes no client reference, so a repeated `/data-purchase` that actually
   * succeeded the first time delivers a second bundle and debits the float
   * twice, with no way to tell afterwards which attempt did what. `purchase()`
   * therefore does its own single-shot fetch and never calls this.
   *
   * Reads are different — asking twice what a bundle costs, or what an order's
   * status is, costs nothing and changes nothing.
   *
   * Retried: transport failures, 5xx, and 429. Their limits are per-minute (30/min
   * on /verify, 30/min on /data-purchase), so a burst at checkout can legitimately
   * be rate-limited, and `Retry-After` is honoured when they send it. A 4xx other
   * than 429 is an answer, not a failure, and is returned as-is.
   */
  private async fetchRepeatable(
    url: string,
    init: RequestInit,
    label: string,
    attempts = 3,
  ): Promise<Response> {
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

  /**
   * Buy a data bundle.
   *
   * `capacity` is a size in GB as a bare string — "1", "2", "5" — which is how
   * their API expresses it. `recipient` is a 10-digit Ghana number starting 0.
   *
   * Deliberately single-shot. A network timeout here is genuinely ambiguous: the
   * order may already be placed and the float already debited, and without an
   * idempotency key a second attempt could deliver a second bundle to the same
   * person at James's expense. So a timeout returns `unknown` and the
   * reconciler decides, rather than this method guessing.
   */
  async purchase(input: {
    networkKey: string
    recipient: string
    capacity: string
  }): Promise<PurchaseOutcome> {
    const key = this.apiKey
    if (!key) {
      return {
        kind: 'rejected',
        reason: 'No DataHub API key configured.',
        insufficientBalance: false,
        raw: '',
      }
    }

    let response: Response
    try {
      response = await fetch(this.externalUrl('/data-purchase'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      const reason = (error as Error)?.name === 'TimeoutError' ? 'timed out' : String(error)
      this.log.error(`purchase to ${input.recipient} ${reason} — outcome unknown, NOT retrying`)
      return {
        kind: 'unknown',
        reason: `Request ${reason} before a reply arrived.`,
        raw: String(error),
      }
    }

    // Read the body as text first, then parse. A non-JSON reply — their HTML
    // error page, a proxy's 502 — is exactly the case worth keeping, and
    // `response.json()` would throw it away.
    const rawText = await response.text().catch(() => '')
    const raw = `HTTP ${response.status} ${rawText}`.slice(0, 2000)

    let body: DatahubEnvelope = {}
    try {
      body = JSON.parse(rawText) as DatahubEnvelope
    } catch {
      body = {}
    }

    if (!response.ok || body.success === false) {
      const reason = body.error ?? body.message ?? `HTTP ${response.status}`
      // Their float is empty. Distinct from a bad request: nothing about the
      // order was wrong, and every subsequent order will fail the same way until
      // somebody tops up.
      const insufficientBalance = /insufficient balance/i.test(reason)
      if (insufficientBalance) {
        this.log.error(`DataHub float exhausted: ${reason}`)
      }
      // A 5xx is not a clean rejection — they may have taken the order before
      // failing to answer. Treat it as unknown so nothing is refunded prematurely.
      if (response.status >= 500) {
        return { kind: 'unknown', reason: `Provider returned ${response.status}: ${reason}`, raw }
      }
      return { kind: 'rejected', reason, insufficientBalance, raw }
    }

    const providerReference = body.data?.reference
    if (!providerReference) {
      // Accepted but unidentifiable. We cannot reconcile what we cannot name, so
      // this is escalated rather than assumed good.
      return {
        kind: 'unknown',
        reason: 'Provider accepted the order but returned no reference.',
        raw,
      }
    }

    return {
      kind: 'accepted',
      providerReference,
      providerStatus: body.data?.status ?? 'PROCESSING',
      // What they actually took, in cedis.
      //
      // Their spec documents `deducted`, but live replies have been seen with
      // only `previous` and `current` — so the difference is the fallback, and
      // `data.price` the last resort. Getting this right is what powers the
      // cost-mismatch alarm: the first real order was priced from a catalogue
      // cost of GHS 4.70 and actually charged GHS 4.20, and reading only
      // `deducted` missed it entirely.
      deducted: deductedFrom(body),
      raw,
    }
  }

  /**
   * Look an order up by their reference.
   *
   * Undocumented in their endpoint list but live, and load-bearing: it is the
   * only way to resolve an order whose webhook never arrived. Without it a lost
   * callback would strand a paid order permanently.
   */
  async orderStatus(providerReference: string): Promise<StatusOutcome> {
    const key = this.apiKey
    if (!key) return { kind: 'unavailable', reason: 'No DataHub API key configured.' }

    try {
      const response = await this.fetchRepeatable(
        this.externalUrl(`/order-status?reference=${encodeURIComponent(providerReference)}`),
        { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(15_000) },
        'order-status',
      )
      const body = (await response.json().catch(() => ({}))) as DatahubEnvelope

      if (response.status === 404 || /not found/i.test(body.error ?? '')) {
        return { kind: 'not_found' }
      }
      if (!response.ok) {
        return { kind: 'unavailable', reason: body.error ?? `HTTP ${response.status}` }
      }

      const providerStatus = body.data?.status
      if (!providerStatus) return { kind: 'unavailable', reason: 'No status in the reply.' }

      return { kind: 'found', providerStatus, raw: body }
    } catch (error) {
      return { kind: 'unavailable', reason: String(error) }
    }
  }

  /**
   * FR-4.2 adjacent — MTN numbers must be on their beneficiary list before a
   * purchase, or the order fails after the money has moved. Advisory: a failure
   * to verify does not block the sale, it only warns.
   */
  async verify(networkKey: string, recipient: string): Promise<{ verified: boolean; message: string }> {
    const key = this.apiKey
    if (!key) return { verified: false, message: 'No DataHub API key configured.' }

    try {
      const response = await this.fetchRepeatable(
        this.externalUrl('/verify'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
          body: JSON.stringify({ networkKey, recipient, is_ported_number: true }),
          // Tighter than the background calls, and one retry rather than two.
          // This one runs inside checkout with a customer waiting, and it fails
          // open — so a long stall buys nothing: worst case here is ~16s before
          // the order proceeds anyway, against ~46s on the default settings.
          signal: AbortSignal.timeout(8_000),
        },
        'verify',
        2,
      )
      const body = (await response.json().catch(() => ({}))) as DatahubEnvelope & {
        data?: { exists?: boolean; message?: string }
      }
      return {
        verified: Boolean(body.success && body.data?.exists),
        message: body.data?.message ?? body.error ?? body.message ?? 'No reply.',
      }
    } catch (error) {
      return { verified: false, message: String(error) }
    }
  }

  /**
   * Their live catalogue: every network they sell, and every bundle under it
   * with the price they will actually charge.
   *
   * `GET /bundles`. This is the only endpoint that answers "what does it cost",
   * and reading it is what stops our `supplier_products` table from being a
   * table of guesses. Prices come back in cedis as decimals (4.7, 11.5) and are
   * converted to pesewas here, at the boundary, so nothing downstream ever holds
   * a float.
   *
   * Read-only and free — safe to call whenever, unlike everything else on this
   * client.
   */
  async catalogue(): Promise<CatalogueOutcome> {
    const key = this.apiKey
    if (!key) return { kind: 'failed', reason: 'No DataHub API key configured.' }

    let response: Response
    try {
      response = await this.fetchRepeatable(
        `${this.baseUrl}/bundles`,
        { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(20_000) },
        'bundles',
      )
    } catch (error) {
      const reason = (error as Error)?.name === 'TimeoutError' ? 'timed out' : String(error)
      return { kind: 'failed', reason: `Could not reach DataHub GH — request ${reason}.` }
    }

    const body = (await response.json().catch(() => ({}))) as DatahubEnvelope & {
      networks?: RawNetwork[]
    }

    if (!response.ok || body.success === false || !Array.isArray(body.networks)) {
      return {
        kind: 'failed',
        reason: body.error ?? body.message ?? `DataHub GH returned HTTP ${response.status}.`,
      }
    }

    const networks = body.networks.map((network) => ({
      networkKey: String(network.networkKey ?? ''),
      displayName: String(network.displayName ?? network.name ?? network.networkKey ?? ''),
      bundles: (network.bundles ?? [])
        .filter((bundle) => bundle && bundle.sizeInMB != null && bundle.price != null)
        .map((bundle) => ({
          size: String(bundle.size ?? `${bundle.sizeInMB}MB`),
          sizeInMb: Number(bundle.sizeInMB),
          // Cedis → pesewas. Round rather than truncate: 11.5 must not become
          // 1149 through binary floating point.
          pricePesewas: Math.round(Number(bundle.price) * 100),
          isActive: bundle.isActive !== false,
        }))
        .filter((bundle) => Number.isFinite(bundle.sizeInMb) && Number.isFinite(bundle.pricePesewas)),
    }))

    return { kind: 'ok', networks: networks.filter((n) => n.networkKey) }
  }
}

interface RawNetwork {
  name?: string
  displayName?: string
  networkKey?: string
  bundles?: { size?: string; sizeInMB?: number; price?: number; isActive?: boolean }[]
}

export interface CatalogueBundle {
  /** Their label, e.g. "30GB". */
  size: string
  sizeInMb: number
  pricePesewas: number
  isActive: boolean
}

export interface CatalogueNetwork {
  networkKey: string
  displayName: string
  bundles: CatalogueBundle[]
}

export type CatalogueOutcome =
  | { kind: 'ok'; networks: CatalogueNetwork[] }
  | { kind: 'failed'; reason: string }

/**
 * Their status vocabulary mapped onto ours.
 *
 * `null` means "not terminal yet" — keep waiting. Anything unrecognised is
 * treated as still in flight rather than as a failure, because guessing wrong in
 * the failure direction refunds a buyer whose bundle actually arrived.
 */
export function mapProviderStatus(status: string): 'completed' | 'failed' | null {
  switch (status.toUpperCase()) {
    case 'SUCCESSFUL':
      return 'completed'
    case 'FAILED':
    case 'CANCELLED':
      return 'failed'
    case 'INITIATED':
    case 'PENDING':
    case 'PROCESSING':
      return null
    default:
      return null
  }
}
