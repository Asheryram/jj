import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { LicenseInvoice, LicensePayload, LicenseStage, LicenseSubscription, verifyLicenseToken } from './license-token'

export type LicenseSource =
  /** No LICENSE_URL: this app is not subscription-managed at all. */
  | 'disabled'
  /** A URL but no usable public key: set up wrongly, so nothing can be trusted. */
  | 'misconfigured'
  /** Configured, but no answer has arrived yet (just started, or never reachable). */
  | 'unverified'
  /** A recent, verified answer. */
  | 'live'
  /** A verified answer that is a little old (a check is overdue), with no failure since. Still trusted. */
  | 'cached'
  /**
   * The billing server did not answer the latest check. Whatever it said before is set aside:
   * the app runs as if everything is paid, with nothing shown, until it answers again. A
   * billing problem on our side must never stop the client's business.
   */
  | 'unreachable'
  /** No successful check for longer than the tolerance. Ignored. */
  | 'stale'

export interface LicenseStatus {
  configured: boolean
  /** Whether a lapsed subscription actually blocks anything, or is only reported. */
  enforced: boolean
  source: LicenseSource
  /** What the licence says. */
  stage: LicenseStage
  /** True when revenue actions are being refused right now. */
  paused: boolean
  exempt: boolean
  message: string
  payUrl: string | null
  /** What the client wants the public told while paused (may be empty). */
  publicNotice: string
  /** Selling pauses within a day (the last day of grace). */
  pausesSoon: boolean
  /** Once suspended, wallet orders are refused too. */
  strictSuspend: boolean
  /** The project this app is, in the invoicing application. */
  project: string
  /** Everything this app has to keep paying for. */
  subscriptions: LicenseSubscription[]
  /** Every invoice for this app still waiting to be paid. */
  invoices: LicenseInvoice[]
  dueAt: string | null
  graceEndsAt: string | null
  suspendsAt: string | null
  daysUntilDue: number | null
  lastCheckedAt: string | null
  lastAttemptAt: string | null
  lastError: string | null
}

interface Received {
  payload: LicensePayload
  at: Date
}

const MS_DAY = 86_400_000

/**
 * Where this app's subscription stands, according to the invoicing app.
 *
 * It asks on a timer, checks the answer is genuine and really for this app,
 * and remembers it. The whole thing is built around one promise: a problem on
 * the way (the invoicing app down, a slow network, a mistyped setting) never
 * stops this app working. Anything short of a fresh, verified, matching answer
 * is treated as "unknown", and unknown means carry on.
 *
 * Whether a lapsed subscription then blocks anything is a separate switch,
 * LICENSE_ENFORCE. Left off, the app only reports what it WOULD do, which is
 * the way to prove the whole chain on real clients before turning it on.
 */
@Injectable()
export class LicenseService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('license')
  private timer?: NodeJS.Timeout
  private received: Received | null = null
  private lastAttemptAt: Date | null = null
  private lastError: string | null = null
  private inflight: Promise<void> | null = null
  private lastWouldBlockLog = 0

  /** Replaceable so a test can answer without a network. */
  protected fetchImpl: typeof fetch = (input, init) => fetch(input, init)

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (this.source() === 'disabled') {
      this.log.log('Not subscription-managed (LICENSE_URL is not set).')
      return
    }
    if (this.source() === 'misconfigured') {
      this.log.error('LICENSE_URL is set but LICENSE_PUBLIC_KEY is missing or not a valid key. Nothing will be enforced.')
      return
    }
    this.log.log(`Checking the subscription every ${this.intervalMinutes} minutes (${this.enforced ? 'ENFORCED' : 'report only'}).`)
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), this.intervalMinutes * 60_000)
    // Never the thing that keeps the process alive.
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  // ---------------------------------------------------------------- settings

  private get url(): string {
    return (this.config.get<string>('LICENSE_URL') ?? '').trim()
  }

  private get publicKey(): string {
    return (this.config.get<string>('LICENSE_PUBLIC_KEY') ?? '').trim()
  }

  /**
   * LICENSE_PUBLIC_KEY can hold more than one key, separated by commas, while the billing
   * app's signing key is being changed: the new one is trusted before it is used, the old
   * one until it is gone. A licence signed by any of them is accepted.
   */
  private get publicKeys(): string[] {
    return this.publicKey
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
  }

  /** LICENSE_STRICT_SUSPEND=true: once suspended, even orders paid from a wallet are refused. */
  get strictSuspend(): boolean {
    return (this.config.get<string>('LICENSE_STRICT_SUSPEND') ?? '').trim().toLowerCase() === 'true'
  }

  /** LICENSE_WARN_AGENTS=true: in the last day before selling pauses, agents see a short heads-up. */
  get warnAgents(): boolean {
    return (this.config.get<string>('LICENSE_WARN_AGENTS') ?? '').trim().toLowerCase() === 'true'
  }

  get enforced(): boolean {
    return (this.config.get<string>('LICENSE_ENFORCE') ?? '').trim().toLowerCase() === 'true'
  }

  private get intervalMinutes(): number {
    const value = Number(this.config.get<string>('LICENSE_CHECK_MINUTES'))
    return Number.isFinite(value) && value >= 5 ? value : 60
  }

  private get offlineDays(): number {
    const value = Number(this.config.get<string>('LICENSE_OFFLINE_DAYS'))
    return Number.isFinite(value) && value >= 1 ? value : 7
  }

  /** The app key at the end of the licence URL, which a token must name. */
  private get expectedApp(): string {
    try {
      return new URL(this.url).pathname.split('/').filter(Boolean).pop() ?? ''
    } catch {
      return ''
    }
  }

  private source(now = new Date()): LicenseSource {
    if (!this.url) return 'disabled'
    if (!this.publicKey || !this.expectedApp) return 'misconfigured'
    if (!this.received) return 'unverified'
    // The latest check failed: unknown, and unknown means carry on as if paid.
    if (this.lastError) return 'unreachable'
    const age = now.getTime() - this.received.at.getTime()
    if (age > this.offlineDays * MS_DAY) return 'stale'
    return age > 2 * this.intervalMinutes * 60_000 ? 'cached' : 'live'
  }

  // ---------------------------------------------------------------- fetching

  /** Asks the invoicing app now. Never throws, and overlapping calls share one request. */
  refresh(): Promise<void> {
    if (this.source() === 'disabled' || this.source() === 'misconfigured') return Promise.resolve()
    if (this.inflight) return this.inflight
    this.inflight = this.fetchOnce().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async fetchOnce(): Promise<void> {
    this.lastAttemptAt = new Date()
    try {
      const version = this.config.get<string>('APP_VERSION') ?? process.env.npm_package_version ?? 'unknown'
      const separator = this.url.includes('?') ? '&' : '?'
      const response = await this.fetchImpl(`${this.url}${separator}v=${encodeURIComponent(version)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(`the billing server answered ${response.status}`)

      const body = (await response.json()) as { token?: unknown }
      const token = typeof body.token === 'string' ? body.token : null
      let payload: LicensePayload | null = null
      for (const key of this.publicKeys) {
        payload = token ? verifyLicenseToken(token, key) : null
        if (payload) break
      }
      if (!payload) throw new Error('the answer was not a valid, signed licence')
      if (payload.app !== this.expectedApp) throw new Error('the licence is for a different app')
      // A token is good for a day. One that has already run out is an old answer
      // being played back, and is no better than no answer at all.
      if (new Date(payload.expiresAt).getTime() < Date.now() - 5 * 60_000) throw new Error('the licence has already expired')

      const before = this.received?.payload.stage
      this.received = { payload, at: new Date() }
      this.lastError = null
      if (before !== payload.stage) this.log.log(`Subscription stage: ${before ?? 'unknown'} to ${payload.stage}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message !== this.lastError) this.log.warn(`Could not confirm the subscription: ${message}. Carrying on as if everything is paid.`)
      this.lastError = message
    }
  }

  // ---------------------------------------------------------------- answers

  status(now = new Date()): LicenseStatus {
    const source = this.source(now)
    const payload = source === 'live' || source === 'cached' ? this.received?.payload : undefined
    const stage: LicenseStage = payload?.stage ?? 'active'
    const enforced = this.enforced
    const exempt = payload?.exempt === true

    // Fall back to asking again if the timer has somehow stopped.
    if (
      (source === 'cached' || source === 'stale' || source === 'unverified' || source === 'unreachable') &&
      this.lastAttemptAt &&
      now.getTime() - this.lastAttemptAt.getTime() > this.intervalMinutes * 60_000
    ) {
      void this.refresh()
    }

    return {
      configured: source !== 'disabled',
      enforced,
      source,
      stage,
      paused: enforced && !exempt && (stage === 'restricted' || stage === 'suspended'),
      exempt,
      message: payload?.message ?? '',
      payUrl: payload?.payUrl ?? null,
      publicNotice: payload?.publicNotice ?? '',
      pausesSoon:
        enforced &&
        !exempt &&
        stage === 'grace' &&
        !!payload &&
        new Date(payload.graceEndsAt).getTime() - now.getTime() <= MS_DAY,
      strictSuspend: this.strictSuspend,
      project: payload?.project ?? '',
      subscriptions: payload?.subscriptions ?? [],
      invoices: payload?.invoices ?? [],
      dueAt: payload?.dueAt ?? null,
      graceEndsAt: payload?.graceEndsAt ?? null,
      suspendsAt: payload?.suspendsAt ?? null,
      daysUntilDue: payload ? (new Date(payload.dueAt).getTime() - now.getTime()) / MS_DAY : null,
      lastCheckedAt: this.received?.at.toISOString() ?? null,
      lastAttemptAt: this.lastAttemptAt?.toISOString() ?? null,
      lastError: this.lastError,
    }
  }

  /** For report-only mode: say what enforcement would have refused, but not on every request. */
  noteWouldBlock(what: string): void {
    const now = Date.now()
    if (now - this.lastWouldBlockLog < 10 * 60_000) return
    this.lastWouldBlockLog = now
    this.log.warn(`Report only: this would have been refused (${what}) because the subscription is ${this.status().stage}.`)
  }

  /** Test seam. */
  setFetchForTest(fetchImpl: typeof fetch): void {
    this.fetchImpl = fetchImpl
  }
}
