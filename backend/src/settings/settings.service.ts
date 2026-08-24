import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ValidationError } from '../common/domain-errors'
import type { ReferralPolicy } from '../domain/pricing'

type Db = PrismaService | Prisma.TransactionClient

/**
 * Runtime platform switches, one row per key so a new flag needs no migration.
 *
 * Defaults live here rather than in the seed, so a missing row is a working
 * default instead of a crash.
 */
export interface PlatformSettings {
  /**
   * FR-5.5 / NFR-5.2 — whether a referrer earns from the people they referred.
   *
   * One level only. Off, and an agent's referrals are just a list of people they
   * brought in; on, and the referrer takes a cut of their margin.
   */
  referralEnabled: boolean
  /**
   * The referrer's share of James's margin on their referral's sales, as a whole
   * percentage. Paid from the wholesale spread, never from the seller.
   */
  referralRatePercent: number
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
}

const DEFAULTS: PlatformSettings = {
  referralEnabled: true,
  referralRatePercent: 25,
  simulateFailure: false,
  registrationOpen: true,
  agentsAutoApprove: true,
  floatWatchAt: 0,
  floatRiskAt: 0,
}

/** Keys holding a percentage rather than a switch. */
const NUMERIC_KEYS = ['referralRatePercent'] as const

/** Keys holding an amount of money in pesewas, which has no upper bound. */
const MONEY_KEYS = ['floatWatchAt', 'floatRiskAt'] as const

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async all(db: Db = this.prisma): Promise<PlatformSettings> {
    const rows = await db.setting.findMany()
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    return {
      referralEnabled: bool(stored.referralEnabled, DEFAULTS.referralEnabled),
      referralRatePercent: percent(
        stored.referralRatePercent,
        DEFAULTS.referralRatePercent,
      ),
      simulateFailure: bool(stored.simulateFailure, DEFAULTS.simulateFailure),
      registrationOpen: bool(stored.registrationOpen, DEFAULTS.registrationOpen),
      agentsAutoApprove: bool(stored.agentsAutoApprove, DEFAULTS.agentsAutoApprove),
      floatWatchAt: money(stored.floatWatchAt, DEFAULTS.floatWatchAt),
      floatRiskAt: money(stored.floatRiskAt, DEFAULTS.floatRiskAt),
    }
  }

  async get<K extends keyof PlatformSettings>(
    key: K,
    db: Db = this.prisma,
  ): Promise<PlatformSettings[K]> {
    const row = await db.setting.findUnique({ where: { key } })
    if (!row) return DEFAULTS[key]

    return (
      (NUMERIC_KEYS as readonly string[]).includes(key)
        ? percent(row.value, DEFAULTS[key] as number)
        : bool(row.value, DEFAULTS[key] as boolean)
    ) as PlatformSettings[K]
  }

  /** The referral policy, in the shape the pricing domain expects. */
  async referralPolicy(db: Db = this.prisma): Promise<ReferralPolicy> {
    const settings = await this.all(db)
    return {
      enabled: settings.referralEnabled,
      ratePercent: settings.referralRatePercent,
    }
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
       * are set one at a time.
       */
      const current = await this.all()
      const watch = key === 'floatWatchAt' ? amount : current.floatWatchAt
      const risk = key === 'floatRiskAt' ? amount : current.floatRiskAt
      if (watch > 0 && risk > 0 && risk > watch) {
        throw new ValidationError(
          'The at-risk amount has to be lower than the watch amount — it is the more urgent of the two.',
        )
      }

      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value: amount },
        update: { value: amount },
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
