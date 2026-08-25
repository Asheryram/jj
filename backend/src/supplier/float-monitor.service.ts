import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { MailerService } from '../mail/mailer.service'
import { escape, wrap } from '../mail/templates'

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

  private async platformName(): Promise<string> {
    const branding = await this.prisma.branding.findFirst({ where: { userId: null } })
    return branding?.shopName ?? 'JamesDataConsult'
  }

  /** Tell whoever funds the float — see the doc comment on the query below. */
  private async alert(
    level: FloatLevel,
    balance: number,
    watchAt: number,
    riskAt: number,
  ): Promise<void> {
    /**
     * Every active admin, because it is everyone's business when the float
     * runs out — an order fails for a customer no matter which admin happens
     * to be looking. Falls back to every active superadmin only when no admin
     * exists yet, so a platform mid-setup is not silent either.
     */
    const admins = await this.prisma.user.findMany({
      where: { role: 'admin', status: 'active' },
      select: { name: true, email: true },
    })
    const recipients =
      admins.length > 0
        ? admins
        : await this.prisma.user.findMany({
            where: { role: 'superadmin', status: 'active' },
            select: { name: true, email: true },
          })

    const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`

    if (recipients.length === 0) {
      this.log.warn(`float is ${level} at ${ghs(balance)} — nobody to tell`)
      return
    }

    const threshold = level === 'risk' ? riskAt : watchAt
    const urgent = level === 'risk'
    const shopName = await this.platformName()

    const consequence = urgent
      ? 'This is urgent: once it runs out, every paid order fails after the customer has already been charged, and each one then has to be refunded by hand. Top up your DataHub float now to avoid that.'
      : 'There is still time to top up before anything fails — no order has been affected yet.'

    const subject = urgent
      ? `Float critically low — ${ghs(balance)} left`
      : `Float getting low — ${ghs(balance)} left`

    const pillBg = urgent ? '#fee2e2' : '#fef3c7'
    const pillFg = urgent ? '#b3261e' : '#92400e'
    const statBg = urgent ? '#fef2f2' : '#fffbeb'
    const statBorder = urgent ? '#fecaca' : '#fde68a'

    const footer =
      `You are getting this because you are an active admin on ${escape(shopName)}. ` +
      "It is sent only when the float's status gets worse, never on every order."

    // Sent one at a time rather than in parallel — this is a handful of admins
    // at most, and one slow send should not race a second SMTP connection for
    // no benefit.
    for (const recipient of recipients) {
      const html = wrap(
        shopName,
        urgent ? 'Your float is critically low' : 'Your float is running low',
        `<div style="text-align:center;margin:0 0 20px">
           <span style="display:inline-block;padding:4px 14px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.4px;background:${pillBg};color:${pillFg}">
             ${urgent ? 'ACTION NEEDED' : 'HEADS UP'}
           </span>
         </div>
         <p style="margin:0 0 18px;font-size:15px;line-height:1.6">Hello ${escape(recipient.name)}, your DataHub GH
           float ${urgent ? 'is critically low' : 'is getting low'}.</p>
         <div style="text-align:center;background:${statBg};border:1px solid ${statBorder};border-radius:12px;padding:20px;margin:0 0 20px">
           <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.4px;color:${pillFg};text-transform:uppercase">Float remaining</p>
           <p style="margin:0;font-size:34px;font-weight:800;color:${pillFg}">${ghs(balance)}</p>
           <p style="margin:8px 0 0;font-size:12.5px;color:${pillFg}">below your ${ghs(threshold)} alert line</p>
         </div>
         <p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;font-weight:${urgent ? '700' : '400'};color:${urgent ? '#b3261e' : '#1e293b'}">${escape(consequence)}</p>
         <p style="margin:0 0 8px;font-size:12.5px;line-height:1.6;color:#64748b">This figure comes from the reply to
           your most recent order — DataHub has no balance endpoint to ask directly, so it is only ever as current
           as your last sale.</p>
         <p style="margin:0;font-size:12.5px;line-height:1.6;color:#64748b">You will not get this again until the
           float recovers and falls past the same point, so it will not repeat on every order.</p>`,
        footer,
      )

      const text = [
        `Hello ${recipient.name},`,
        '',
        urgent ? '*** ACTION NEEDED ***' : '*** HEADS UP ***',
        `Your DataHub GH float ${urgent ? 'is critically low' : 'is getting low'}.`,
        '',
        `FLOAT REMAINING: ${ghs(balance)} (below your ${ghs(threshold)} alert line)`,
        '',
        consequence,
        '',
        'This figure comes from the reply to your most recent order — DataHub has no balance endpoint to ask directly, so it is only ever as current as your last sale.',
        '',
        'You will not get this again until the float recovers and falls past the same point, so it will not repeat on every order.',
      ].join('\n')

      await this.mailer.send({ to: recipient.email, subject, html, text }).catch((error) => {
        // One admin's mail server having a bad day must not stop the rest
        // from being warned.
        this.log.error(`could not tell ${recipient.email} about the float: ${String(error)}`)
      })
    }

    this.log.warn(
      `float ${level}: ${ghs(balance)} (threshold ${ghs(threshold)}) — told ` +
        recipients.map((r) => r.email).join(', '),
    )
  }
}
