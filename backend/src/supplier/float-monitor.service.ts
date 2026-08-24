import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { MailerService } from '../mail/mailer.service'

/** Where the balance sits relative to the two thresholds. */
export type FloatLevel = 'ok' | 'watch' | 'risk'

export interface FloatObservation {
  /** Pesewas left in the provider float. */
  balance: number
  /** When the provider reported it — always the moment of a purchase. */
  observedAt: string
  /** The order whose reply revealed it, for tracing. */
  orderRef: string | null
  level: FloatLevel
}

const OBSERVATION_KEY = 'supplierFloat'
const ALERT_LEVEL_KEY = 'supplierFloatAlertLevel'

const SEVERITY: Record<FloatLevel, number> = { ok: 0, watch: 1, risk: 2 }

/**
 * Which band a balance falls in. A threshold of zero is switched off.
 *
 * At-or-below rather than strictly below, so a threshold set to exactly the
 * remaining balance still counts as reached — the point is to be told before it
 * matters, not after.
 */
function levelFor(balance: number, watchAt: number, riskAt: number): FloatLevel {
  if (riskAt > 0 && balance <= riskAt) return 'risk'
  if (watchAt > 0 && balance <= watchAt) return 'watch'
  return 'ok'
}

/**
 * Watches what is left in the DataHub float and says so before it runs out.
 *
 * The float is prepaid: DataHub deducts the cost of every bundle from a balance
 * James tops up himself, so an empty float does not slow the platform down, it
 * fails every order outright — after the customer has paid. The money then has to
 * come back through the refund queue by hand.
 *
 * Two things make this awkward. There is no balance endpoint, so the figure is
 * knowable exactly once per purchase, from the reply; and it was being parsed and
 * thrown away, so nobody could see it at all until an order failed. Hence: record
 * it whenever it arrives, and email when it crosses a line.
 */
@Injectable()
export class FloatMonitorService {
  private readonly log = new Logger(FloatMonitorService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly mailer: MailerService,
  ) {}

  /**
   * Record what the provider just said is left, and alert if it crossed a mark.
   *
   * Takes cedis because that is what they send. Never throws: this runs inside
   * the dispatch path, and failing to record a balance must not turn a successful
   * purchase into a failed one.
   */
  async record(balanceCedis: number | null, orderRef: string | null): Promise<void> {
    if (balanceCedis === null || !Number.isFinite(balanceCedis)) return

    try {
      const balance = Math.round(balanceCedis * 100)
      const { floatWatchAt, floatRiskAt } = await this.settings.all()
      const level = levelFor(balance, floatWatchAt, floatRiskAt)

      await this.write(OBSERVATION_KEY, {
        balance,
        observedAt: new Date().toISOString(),
        orderRef,
      })

      const previous = await this.alertLevel()

      /**
       * Only on a change, and only email downwards.
       *
       * Every order reports the balance, so alerting on the level itself would
       * send one email per order for as long as the float stayed low — dozens on
       * a busy afternoon, which trains you to ignore them. A recovery is recorded
       * silently: seeing the balance climb is not news, and it re-arms the alert
       * for the next time it falls.
       */
      if (level !== previous) {
        await this.write(ALERT_LEVEL_KEY, level)
        if (SEVERITY[level] > SEVERITY[previous]) {
          await this.alert(level, balance, floatWatchAt, floatRiskAt)
        } else {
          this.log.log(`float recovered to ${level} (GHS ${(balance / 100).toFixed(2)})`)
        }
      }
    } catch (error) {
      // Deliberately swallowed — see the doc comment above.
      this.log.error(`could not record the provider float: ${String(error)}`)
    }
  }

  /** The last reading, for the admin screens. Null before any purchase. */
  async latest(): Promise<FloatObservation | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: OBSERVATION_KEY } })
    if (!row) return null

    const stored = row.value as { balance?: unknown; observedAt?: unknown; orderRef?: unknown }
    const balance = Number(stored.balance)
    if (!Number.isFinite(balance)) return null

    const { floatWatchAt, floatRiskAt } = await this.settings.all()
    return {
      balance,
      observedAt:
        typeof stored.observedAt === 'string' ? stored.observedAt : row.updatedAt.toISOString(),
      orderRef: typeof stored.orderRef === 'string' ? stored.orderRef : null,
      level: levelFor(balance, floatWatchAt, floatRiskAt),
    }
  }

  private async alertLevel(): Promise<FloatLevel> {
    const row = await this.prisma.setting.findUnique({ where: { key: ALERT_LEVEL_KEY } })
    const value = row?.value
    return value === 'watch' || value === 'risk' ? value : 'ok'
  }

  private async write(key: string, value: unknown): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: { value: value as never },
    })
  }

  /**
   * Tell whoever funds the float.
   *
   * The admin, because it is their money and their top-up. Falls back to the
   * superadmin so a platform without an admin yet is not silent.
   */
  private async alert(
    level: FloatLevel,
    balance: number,
    watchAt: number,
    riskAt: number,
  ): Promise<void> {
    const recipient =
      (await this.prisma.user.findFirst({
        where: { role: 'admin', status: 'active' },
        select: { name: true, email: true },
      })) ??
      (await this.prisma.user.findFirst({
        where: { role: 'superadmin', status: 'active' },
        select: { name: true, email: true },
      }))

    const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`

    if (!recipient) {
      this.log.warn(`float is ${level} at ${ghs(balance)} — nobody to tell`)
      return
    }

    const threshold = level === 'risk' ? riskAt : watchAt
    const urgent = level === 'risk'

    const consequence = urgent
      ? 'When it runs out, orders stop being delivered after the customer has already paid, and each one has to be refunded by hand. Top up before that happens.'
      : 'There is still time to top up without anything failing.'

    await this.mailer.send({
      to: recipient.email,
      subject: urgent
        ? `Provider float is low — ${ghs(balance)} left`
        : `Provider float is getting low — ${ghs(balance)} left`,
      html:
        `<p>Hello ${recipient.name},</p>` +
        `<p>Your DataHub GH float is down to <strong>${ghs(balance)}</strong>, ` +
        `below the ${ghs(threshold)} you asked to be told about.</p>` +
        `<p>${consequence}</p>` +
        '<p style="color:#475569;font-size:13px">This figure comes from the reply to your most ' +
        'recent order. DataHub has no way to ask for it, so it is only ever as current as your ' +
        'last sale.</p>' +
        '<p style="color:#475569;font-size:13px">You will not get this again until the float ' +
        'recovers and falls past the same point, so it will not repeat on every order.</p>',
      text: [
        `Hello ${recipient.name},`,
        '',
        `Your DataHub GH float is down to ${ghs(balance)}, below the ${ghs(threshold)} you asked to be told about.`,
        '',
        consequence,
        '',
        'This figure comes from the reply to your most recent order. DataHub has no way to ask for it, so it is only ever as current as your last sale.',
        '',
        'You will not get this again until the float recovers and falls past the same point, so it will not repeat on every order.',
      ].join('\n'),
    })

    this.log.warn(`float ${level}: ${ghs(balance)} (threshold ${ghs(threshold)}) — told ${recipient.email}`)
  }
}
