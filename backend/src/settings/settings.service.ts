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
}

const DEFAULTS: PlatformSettings = {
  referralEnabled: true,
  referralRatePercent: 25,
  simulateFailure: false,
  registrationOpen: true,
}

/** Keys holding a percentage rather than a switch. */
const NUMERIC_KEYS = ['referralRatePercent'] as const

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
