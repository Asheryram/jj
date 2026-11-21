import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

/**
 * NetPulse (buydata.space), the third data supplier. API reference:
 * https://netpluse.shop/docs
 *
 * What their contract means for us, and why the code below is shaped this way:
 *
 *  · Purchases debit our NetPulse wallet; `GET /balance` reads it any time,
 *    and every purchase reply carries the balance after it too.
 *  · Delivery is asynchronous: a purchase answers `processing`, and the final
 *    `completed`/`failed` is only found by asking `GET /order-status/{ref}`.
 *    They document no webhooks, so the reconciler's polling is the only way
 *    an order settles.
 *  · A failed order's charge comes back to the wallet (confirmed with them,
 *    21 Nov 2026), like GMPL and unlike DataHub. See `PROVIDERS.netpulse`.
 *  · The idempotency `reference` we send only blocks a repeat for 60 seconds.
 *    So a purchase is NEVER retried automatically here: a retry after that
 *    window could buy the bundle twice. A lost reply is looked up by our
 *    reference instead, and if that finds nothing the order is left
 *    `unknown` for a person, the same as DataHub's ambiguous case.
 *  · Money fields are in cedis with decimals; everything we store is pesewas.
 */

export type NetpulsePurchaseOutcome =
  | {
      kind: 'accepted'
      providerReference: string
      providerStatus: string
      /** Pesewas they charged, from `price`. */
      charged: number | null
      /** Cedis left in the wallet after this purchase, from `balance`. */
      balanceAfter: number | null
      raw: string
    }
  | { kind: 'rejected'; reason: string; insufficientBalance: boolean; raw: string }
  | { kind: 'unknown'; reason: string; raw: string }

export type NetpulseStatusOutcome =
  | { kind: 'found'; providerStatus: string; raw: unknown }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; reason: string }

export type NetpulseBalanceOutcome = { kind: 'ok'; balanceCedis: number } | { kind: 'unavailable'; reason: string }

export interface NetpulsePackage {
  network: string
  /** Exactly what `/purchase` takes back, e.g. "1GB". */
  capacity: string
  /** Pesewas. */
  pricePesewas: number
  validity: string
}

export type NetpulseCatalogueOutcome = { kind: 'ok'; packages: NetpulsePackage[] } | { kind: 'failed'; reason: string }

/** Their status words, read into ours. `processing` is not final. */
export function mapNetpulseStatus(status: string): 'completed' | 'failed' | null {
  switch (status.toLowerCase()) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    default:
      return null
  }
}

/**
 * The reference we send with one purchase attempt: the order reference for
 * the first, with `-2`, `-3`… for an admin's retries, so each attempt is its
 * own purchase and a lost reply can be looked up by exactly the one we sent.
 */
export function netpulseReference(orderReference: string, attempt: number): string {
  return attempt <= 1 ? orderReference : `${orderReference}-${attempt}`
}

/** "1GB" → "1", "500MB" → "0.5", for matching sizes across suppliers. Null if unreadable. */
export function capacityToGb(capacity: string): string | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(GB|MB)\s*$/i.exec(capacity)
  if (!match) return null
  const value = Number(match[1])
  return String(match[2].toUpperCase() === 'MB' ? value / 1000 : value)
}

const toPesewas = (cedis: unknown): number | null => {
  const n = Number(cedis)
  return cedis == null || !Number.isFinite(n) ? null : Math.round(n * 100)
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type Body = Record<string, unknown>

function errorText(body: Body, fallback: string): string {
  const error = body.error ?? body.message
  return typeof error === 'string' && error.trim() ? error.trim() : fallback
}

@Injectable()
export class NetpulseClient {
  private readonly log = new Logger(NetpulseClient.name)

  constructor(private readonly config: ConfigService) {}

  get baseUrl(): string {
    return this.config.get<string>('NETPULSE_BASE_URL')?.replace(/\/$/, '') || 'https://buydata.space/api/v1'
  }

  get apiKey(): string | null {
    return this.config.get<string>('NETPULSE_API_KEY')?.trim() || null
  }

  get configured(): boolean {
    return Boolean(this.apiKey)
  }

  private headers(json = false): Record<string, string> {
    return { 'x-api-key': this.apiKey ?? '', ...(json ? { 'Content-Type': 'application/json' } : {}) }
  }

  /**
   * GET with retries on transport errors, 5xx and 429, honouring `retryAfter`.
   * Only for reads: a purchase is never sent through this.
   */
  private async get(path: string, label: string, timeoutMs = 15_000, attempts = 3): Promise<Response> {
    let lastError: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, { headers: this.headers(), signal: AbortSignal.timeout(timeoutMs) })
        if ((response.status !== 429 && response.status < 500) || attempt === attempts) return response
        const after = Number(response.headers.get('retry-after'))
        const wait = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : 400 * 3 ** (attempt - 1)
        this.log.warn(`${label} got ${response.status}, retrying in ${wait}ms (${attempt}/${attempts})`)
        await delay(wait)
      } catch (error) {
        lastError = error
        if (attempt === attempts) break
        await delay(400 * 3 ** (attempt - 1))
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private static async read(response: Response): Promise<{ body: Body; raw: string }> {
    const text = await response.text().catch(() => '')
    let body: Body = {}
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object') body = parsed as Body
    } catch {
      body = {}
    }
    return { body, raw: `HTTP ${response.status} ${text}`.slice(0, 2000) }
  }

  /** Their data bundles for this key's tier. MTN Mashup is left out on purpose for now. */
  async packages(): Promise<NetpulseCatalogueOutcome> {
    if (!this.configured) return { kind: 'failed', reason: 'No NetPulse API key configured.' }
    let response: Response
    try {
      response = await this.get('/packages', 'packages', 20_000)
    } catch (error) {
      return { kind: 'failed', reason: `NetPulse did not answer: ${String(error)}` }
    }
    const { body } = await NetpulseClient.read(response)
    if (!response.ok) return { kind: 'failed', reason: errorText(body, `HTTP ${response.status}`) }
    const rows = Array.isArray(body.packages) ? (body.packages as Body[]) : []
    const packages: NetpulsePackage[] = []
    for (const row of rows) {
      const pricePesewas = toPesewas(row.price)
      if (typeof row.network !== 'string' || typeof row.capacity !== 'string' || pricePesewas === null) continue
      packages.push({ network: row.network, capacity: row.capacity, pricePesewas, validity: String(row.validity ?? '') })
    }
    return { kind: 'ok', packages }
  }

  /**
   * Buy one data bundle. Sent once, never retried (see the file header);
   * anything ambiguous is looked up by `reference` before giving up as unknown.
   */
  async purchase(input: { network: string; capacity: string; recipient: string; reference: string }): Promise<NetpulsePurchaseOutcome> {
    if (!this.configured) {
      return { kind: 'rejected', reason: 'No NetPulse API key configured.', insufficientBalance: false, raw: '' }
    }

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/purchase`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          network: input.network,
          phoneNumber: input.recipient,
          capacity: input.capacity,
          reference: input.reference,
        }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      const reason = (error as Error)?.name === 'TimeoutError' ? 'timed out' : String(error)
      this.log.error(`purchase ${input.reference} → ${input.recipient} ${reason}, looking it up by reference`)
      return this.recover(input.reference, `Request ${reason} before a reply arrived.`, String(error))
    }

    const { body, raw } = await NetpulseClient.read(response)

    if (response.ok) {
      const providerReference = typeof body.reference === 'string' && body.reference ? body.reference : null
      if (!providerReference) {
        return this.recover(input.reference, 'NetPulse accepted the order but returned no reference.', raw)
      }
      const balance = Number(body.balance)
      return {
        kind: 'accepted',
        providerReference,
        providerStatus: typeof body.status === 'string' ? body.status : 'processing',
        charged: toPesewas(body.price),
        balanceAfter: body.balance != null && Number.isFinite(balance) ? balance : null,
        raw,
      }
    }

    const reason = errorText(body, `HTTP ${response.status}`)
    switch (response.status) {
      case 402:
        this.log.error(`NetPulse wallet is too low: ${reason}`)
        return { kind: 'rejected', reason: `NetPulse wallet balance is too low: ${reason}`, insufficientBalance: true, raw }
      case 409:
        // The same reference was used in the last minute, so an earlier send
        // of this attempt may have gone through. Never a second purchase.
        return this.recover(input.reference, `NetPulse says ${input.reference} was already used: ${reason}`, raw)
      case 401:
      case 403:
        this.log.error(`NetPulse refused our API key (${response.status}): ${reason}`)
        return { kind: 'rejected', reason: `NetPulse refused our API key: ${reason}`, insufficientBalance: false, raw }
      case 429:
        return { kind: 'rejected', reason: `NetPulse rate limit reached, nothing was bought: ${reason}`, insufficientBalance: false, raw }
      default:
        if (response.status >= 500) return this.recover(input.reference, `NetPulse returned ${response.status}: ${reason}`, raw)
        return { kind: 'rejected', reason, insufficientBalance: false, raw }
    }
  }

  /** After an ambiguous purchase: found by our reference means it went through. */
  private async recover(reference: string, reason: string, raw: string): Promise<NetpulsePurchaseOutcome> {
    const found = await this.orderStatus(reference)
    if (found.kind === 'found') {
      this.log.warn(`purchase ${reference} recovered by lookup: NetPulse says ${found.providerStatus}`)
      const ref = (found.raw as Body | null)?.reference
      return {
        kind: 'accepted',
        providerReference: typeof ref === 'string' && ref ? ref : reference,
        providerStatus: found.providerStatus,
        charged: null,
        balanceAfter: null,
        raw,
      }
    }
    this.log.error(`purchase ${reference} outcome unknown (${reason}), left for a person`)
    return { kind: 'unknown', reason, raw }
  }

  async orderStatus(reference: string): Promise<NetpulseStatusOutcome> {
    if (!this.configured) return { kind: 'unavailable', reason: 'No NetPulse API key configured.' }
    let response: Response
    try {
      response = await this.get(`/order-status/${encodeURIComponent(reference)}`, 'order-status')
    } catch (error) {
      return { kind: 'unavailable', reason: (error as Error)?.name === 'TimeoutError' ? 'TimeoutError' : String(error) }
    }
    const { body } = await NetpulseClient.read(response)
    if (response.status === 404) return { kind: 'not_found' }
    if (!response.ok) return { kind: 'unavailable', reason: errorText(body, `HTTP ${response.status}`) }
    if (typeof body.status !== 'string') return { kind: 'unavailable', reason: 'NetPulse replied without a status.' }
    return { kind: 'found', providerStatus: body.status, raw: body }
  }

  async balance(): Promise<NetpulseBalanceOutcome> {
    if (!this.configured) return { kind: 'unavailable', reason: 'No NetPulse API key configured.' }
    let response: Response
    try {
      response = await this.get('/balance', 'balance')
    } catch (error) {
      return { kind: 'unavailable', reason: String(error) }
    }
    const { body } = await NetpulseClient.read(response)
    const balance = Number(body.balance)
    if (!response.ok || body.balance == null || !Number.isFinite(balance)) {
      return { kind: 'unavailable', reason: errorText(body, `HTTP ${response.status}`) }
    }
    return { kind: 'ok', balanceCedis: balance }
  }
}
