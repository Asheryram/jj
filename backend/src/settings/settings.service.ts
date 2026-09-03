import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ValidationError } from '../common/domain-errors'

type Db = PrismaService | Prisma.TransactionClient

/**
 * Runtime platform switches, one row per key so a new flag needs no migration.
 *
 * Defaults live here rather than in the seed, so a missing row is a working
 * default instead of a crash.
 */
export interface PlatformSettings {
  /**
   * Force the next fulfilment to fail. This is how a tester exercises the
   * refund path (FR-2.7) on demand instead of waiting for a real outage.
   */
  simulateFailure: boolean
  /** Whether new agent sign-ups are open. */
  registrationOpen: boolean
  /**
   * Whether a new agent can start selling immediately.
   *
   * On, and signing up is enough — which is what most of the day looks like, and
   * saves an agent waiting on somebody to notice them. Off, and every application
   * waits in the queue for a decision, which is what you want when you are being
   * signed up by people you do not recognise.
   *
   * Either way the account is real and the approval is recorded; this only decides
   * whether the queue is the default.
   */
  agentsAutoApprove: boolean
  /**
   * Float thresholds, in pesewas. Zero switches the alert off.
   *
   * The provider publishes no balance endpoint, so the float is only ever known
   * from the reply to a purchase. These decide when that number is worth an
   * email: `floatWatchAt` while there is still time to top up calmly,
   * `floatRiskAt` when the next few orders are at stake.
   *
   * Both default to zero — off — because a made-up threshold would either cry
   * wolf or say nothing, and only James knows a day's normal volume.
   */
  floatWatchAt: number
  floatRiskAt: number
  /**
   * What Paystack keeps on a Mobile Money payment, in basis points.
   *
   * Shown to the buyer as its own line at checkout and added on top of the
   * listed price — see `checkoutTotal` in the pricing domain — rather than
   * folded invisibly into it. Basis points rather than a whole percent,
   * because Paystack's real rate is not always a round number and this is
   * meant to track it, not approximate it.
   *
   * Defaults to 200 (2%), which is what their Mobile Money transactions have
   * shown so far. `scripts/money-audit.ts` reports the *observed* rate from
   * real payments once there are any — check it occasionally and nudge this to
   * match, rather than trusting the default forever.
   */
  paystackFeeBp: number
  /**
   * Whether Paystack's live balance is actually being watched for a real
   * shortfall.
   *
   * Off by default. This does not change what "should be at Paystack" means
   * anywhere — that is always all-time, from this platform's own records,
   * everywhere, regardless of this setting (see `SolvencyService`). All this
   * decides is whether the background check ever calls Paystack's live
   * balance at all: off, and it never does, and no email can ever fire. On,
   * and every 30 minutes the live balance is compared against that same
   * all-time figure, and a real shortfall — the live balance reading lower
   * than expected — reaches an admin's inbox.
   */
  paystackBusinessAccount: boolean
  /**
   * The smallest amount worth a manual MoMo transfer, in pesewas (FR-2.6).
   *
   * Was a hardcoded constant on `WithdrawalsService` — moved here so it is
   * actually the admin's to set, rather than a number nobody but a developer
   * could change.
   */
  minWithdrawal: number
}

const DEFAULTS: PlatformSettings = {
  simulateFailure: false,
  registrationOpen: true,
  agentsAutoApprove: true,
  floatWatchAt: 0,
  floatRiskAt: 0,
  paystackFeeBp: 200,
  paystackBusinessAccount: false,
  minWithdrawal: 1000,
}

/**
 * Keys holding a percentage rather than a switch.
 *
 * Empty since the referral bonus was removed. Kept rather than deleted because
 * `set` branches on it, and a percentage setting is the likeliest next one.
 */
const NUMERIC_KEYS = [] as readonly string[]

/** Keys holding an amount of money in pesewas, which has no upper bound. */
const MONEY_KEYS = ['floatWatchAt', 'floatRiskAt', 'minWithdrawal'] as const

/** Keys holding a fee rate in basis points — bounded, unlike a plain amount. */
const FEE_BP_KEYS = ['paystackFeeBp'] as const

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async all(db: Db = this.prisma): Promise<PlatformSettings> {
    const rows = await db.setting.findMany()
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    return {
      simulateFailure: bool(stored.simulateFailure, DEFAULTS.simulateFailure),
      registrationOpen: bool(stored.registrationOpen, DEFAULTS.registrationOpen),
      agentsAutoApprove: bool(stored.agentsAutoApprove, DEFAULTS.agentsAutoApprove),
      floatWatchAt: money(stored.floatWatchAt, DEFAULTS.floatWatchAt),
      floatRiskAt: money(stored.floatRiskAt, DEFAULTS.floatRiskAt),
      paystackFeeBp: feeBp(stored.paystackFeeBp, DEFAULTS.paystackFeeBp),
      paystackBusinessAccount: bool(stored.paystackBusinessAccount, DEFAULTS.paystackBusinessAccount),
      minWithdrawal: money(stored.minWithdrawal, DEFAULTS.minWithdrawal),
    }
  }

  /**
   * Read one setting by key, parsed the same way `all()` parses it.
   *
   * This used to only distinguish `NUMERIC_KEYS` (percent) from everything
   * else (bool) — silently wrong for `MONEY_KEYS`/`FEE_BP_KEYS`, since a
   * stored pesewa amount or basis-point rate is neither a percent nor a
   * boolean, and `bool()` would fall back to the hardcoded default every
   * time. Dormant only because nothing outside `all()` has called `get()` on
   * one of those keys yet — a landmine, not a live bug, but exactly the kind
   * of thing that fails silently the day something does.
   */
  async get<K extends keyof PlatformSettings>(
    key: K,
    db: Db = this.prisma,
  ): Promise<PlatformSettings[K]> {
    const row = await db.setting.findUnique({ where: { key } })
    if (!row) return DEFAULTS[key]

    if ((MONEY_KEYS as readonly string[]).includes(key)) {
      return money(row.value, DEFAULTS[key] as number) as PlatformSettings[K]
    }
    if ((FEE_BP_KEYS as readonly string[]).includes(key)) {
      return feeBp(row.value, DEFAULTS[key] as number) as PlatformSettings[K]
    }
    if ((NUMERIC_KEYS as readonly string[]).includes(key)) {
      return percent(row.value, DEFAULTS[key] as number) as PlatformSettings[K]
    }
    return bool(row.value, DEFAULTS[key] as boolean) as PlatformSettings[K]
  }

  async set(
    key: keyof PlatformSettings,
    value: boolean | number,
  ): Promise<PlatformSettings> {
    if ((MONEY_KEYS as readonly string[]).includes(key)) {
      const amount = Number(value)
      if (!Number.isInteger(amount) || amount < 0) {
        throw new ValidationError('A threshold is a whole number of pesewas, or 0 to switch it off.')
      }

      /**
       * At-risk has to be the lower number.
       *
       * The two describe a falling balance passing two marks, so a risk level
       * above the watch level would fire the severe alert first and the mild one
       * never. Checked against whichever value is already stored, because they
       * are set one at a time. Scoped to these two keys specifically — folding
       * every `MONEY_KEYS` write through this check would make setting, say,
       * `minWithdrawal` fail on a stale float-threshold combination that has
       * nothing to do with it.
       */
      if (key === 'floatWatchAt' || key === 'floatRiskAt') {
        const current = await this.all()
        const watch = key === 'floatWatchAt' ? amount : current.floatWatchAt
        const risk = key === 'floatRiskAt' ? amount : current.floatRiskAt
        if (watch > 0 && risk > 0 && risk > watch) {
          throw new ValidationError(
            'The at-risk amount has to be lower than the watch amount — it is the more urgent of the two.',
          )
        }
      }

      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value: amount },
        update: { value: amount },
      })
      return this.all()
    }

    if ((FEE_BP_KEYS as readonly string[]).includes(key)) {
      const bp = Number(value)
      // 10,000 basis points is the whole price — a fee rate that size or larger
      // divides by zero or goes negative in `priceFromMarkup`, so it is refused
      // here rather than left to produce a nonsense price later.
      if (!Number.isInteger(bp) || bp < 0 || bp >= 10_000) {
        throw new ValidationError(
          'A fee rate is a whole number of basis points, from 0 up to (not including) 10,000 — 200 is 2%.',
        )
      }
      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value: bp },
        update: { value: bp },
      })
      return this.all()
    }

    if ((NUMERIC_KEYS as readonly string[]).includes(key)) {
      const rate = Number(value)
      // A rate above 100 would owe a referrer more than the whole margin, and a
      // negative one would bill them for a sale they helped make.
      if (!Number.isInteger(rate) || rate < 0 || rate > 100) {
        throw new ValidationError('A referral rate is a whole number between 0 and 100 percent.')
      }
      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value: rate },
        update: { value: rate },
      })
      return this.all()
    }

    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: Boolean(value) },
      update: { value: Boolean(value) },
    })
    return this.all()
  }
}

/**
 * A stored amount in pesewas, or the default.
 *
 * Anything not a whole number at or above zero falls back rather than being
 * rounded into something plausible — a corrupted threshold that silently became
 * a real number would either alert constantly or never, and both are worse than
 * the feature being off.
 */
function money(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

/** Settings arrive as Prisma `Json`, so coerce rather than trust the shape. */
function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function percent(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return fallback
  return Math.round(parsed)
}

/** A stored fee rate in basis points, bounded below 10,000 (the whole price). */
function feeBp(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 10_000) return fallback
  return Math.round(parsed)
}
