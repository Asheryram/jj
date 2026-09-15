import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { MailerService } from '../mail/mailer.service'
import { escape, wrap } from '../mail/templates'
import { appUrl } from '../common/app-links'
import { NotFoundError, ValidationError } from '../common/domain-errors'

/** Half a day. Slow-moving by nature, an expiry date does not need per-minute watching the way a float does. */
const CHECK_INTERVAL_MS = 12 * 60 * 60_000

export type SubscriptionStatus = 'ok' | 'expiring_soon' | 'expired'

export interface ServiceSubscriptionView {
  id: string
  name: string
  provider: string | null
  renewalUrl: string | null
  notes: string | null
  expiresAt: string
  alertDaysBefore: number
  daysUntilExpiry: number
  status: SubscriptionStatus
  createdAt: string
  updatedAt: string
}

export interface SubscriptionInput {
  name: string
  provider?: string | null
  renewalUrl?: string | null
  notes?: string | null
  expiresAt: Date
  alertDaysBefore?: number
}

/**
 * Third-party services this platform depends on to keep running, watched
 * for an approaching expiry so a lapse is caught before it becomes a live
 * incident. See the `ServiceSubscription` model's own doc comment for why
 * the date has to be entered by hand rather than discovered automatically.
 */
@Injectable()
export class SubscriptionsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(SubscriptionsService.name)
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.checkExpiring().catch((error) =>
        this.log.error(`subscription expiry check failed: ${String(error)}`),
      )
    }, CHECK_INTERVAL_MS)
    this.timer.unref?.()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async list(): Promise<ServiceSubscriptionView[]> {
    const rows = await this.prisma.serviceSubscription.findMany({ orderBy: { expiresAt: 'asc' } })
    return rows.map(toView)
  }

  async create(adminId: string, input: SubscriptionInput): Promise<ServiceSubscriptionView> {
    this.validate(input)
    const row = await this.prisma.serviceSubscription.create({
      data: {
        name: input.name.trim(),
        provider: input.provider?.trim() || null,
        renewalUrl: input.renewalUrl?.trim() || null,
        notes: input.notes?.trim() || null,
        expiresAt: input.expiresAt,
        alertDaysBefore: input.alertDaysBefore ?? 14,
        createdBy: adminId,
      },
    })
    return toView(row)
  }

  /**
   * `expiresAt` changing re-arms the alert, since that is what "renewed"
   * actually means here. Any other field changing (a note, a corrected
   * link) leaves `alertedAt` alone, since none of that changes whether the
   * warning already sent is still accurate.
   */
  async update(id: string, input: Partial<SubscriptionInput>): Promise<ServiceSubscriptionView> {
    const existing = await this.prisma.serviceSubscription.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError('We could not find that subscription.')
    if (input.name !== undefined || input.expiresAt !== undefined) {
      this.validate({ name: input.name ?? existing.name, expiresAt: input.expiresAt ?? existing.expiresAt })
    }

    const expiryChanged = input.expiresAt !== undefined && input.expiresAt.getTime() !== existing.expiresAt.getTime()

    const row = await this.prisma.serviceSubscription.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.provider !== undefined ? { provider: input.provider?.trim() || null } : {}),
        ...(input.renewalUrl !== undefined ? { renewalUrl: input.renewalUrl?.trim() || null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        ...(input.alertDaysBefore !== undefined ? { alertDaysBefore: input.alertDaysBefore } : {}),
        ...(expiryChanged ? { alertedAt: null } : {}),
      },
    })
    return toView(row)
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.serviceSubscription.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError('We could not find that subscription.')
    await this.prisma.serviceSubscription.delete({ where: { id } })
  }

  private validate(input: { name: string; expiresAt: Date }): void {
    if (input.name.trim().length < 2) {
      throw new ValidationError('Name it, two characters minimum.')
    }
    if (Number.isNaN(input.expiresAt.getTime())) {
      throw new ValidationError('Enter a real date.')
    }
  }

  /**
   * Email active admins for anything that just crossed into its own alert
   * window, and has not already been told about. Claimed atomically, the
   * same reasoning as `claimTransition` elsewhere in this codebase: this
   * runs on a plain interval, so two overlapping ticks (a slow mail send
   * pushing one past the next timer fire) must not both send the same
   * warning twice.
   *
   * Deliberately a single email per crossing, not a repeating one while it
   * stays unrenewed. The list itself stays visible on the Subscriptions
   * page for as long as nothing changes, which is where a forgotten renewal
   * is meant to actually get noticed, not an inbox getting the same notice
   * every twelve hours.
   */
  private async checkExpiring(): Promise<void> {
    const rows = await this.prisma.serviceSubscription.findMany({ where: { alertedAt: null } })
    const due = rows.filter((row) => daysUntil(row.expiresAt) <= row.alertDaysBefore)

    for (const row of due) {
      const claim = await this.prisma.serviceSubscription.updateMany({
        where: { id: row.id, alertedAt: null },
        data: { alertedAt: new Date() },
      })
      if (claim.count === 1) {
        await this.alertExpiring(row)
      }
    }
  }

  private async platformName(): Promise<string> {
    const branding = await this.prisma.branding.findFirst({ where: { userId: null } })
    return branding?.shopName ?? 'JamesDataConsult'
  }

  private async alertExpiring(row: {
    id: string
    name: string
    provider: string | null
    renewalUrl: string | null
    expiresAt: Date
  }): Promise<void> {
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
    if (recipients.length === 0) {
      this.log.warn(`subscription ${row.id} (${row.name}) is expiring, nobody to tell`)
      return
    }

    const shopName = await this.platformName()
    const days = daysUntil(row.expiresAt)
    const already = days < 0
    const whenPhrase = already ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago` : `in ${days} day${days === 1 ? '' : 's'}`
    const providerPhrase = row.provider ? ` (${escape(row.provider)})` : ''
    const explanation = already
      ? `${escape(row.name)}${providerPhrase} expired ${whenPhrase}. If it has not already been renewed, this could already be affecting the platform.`
      : `${escape(row.name)}${providerPhrase} is due to expire ${whenPhrase}.`

    // No live request to read an `Origin` from here, this runs off a timer,
    // not a click, so this always falls back to `PUBLIC_APP_URL`. See `appUrl`.
    const appLink = appUrl(this.config, '/admin/subscriptions')
    const renewLinkHtml = row.renewalUrl
      ? `<p style="margin:0 0 10px"><a href="${escape(row.renewalUrl)}" style="display:inline-block;background:#0B3B8F;color:#fff;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;text-decoration:none">Renew it</a></p>`
      : ''
    const appLinkHtml = `<p style="margin:0"><a href="${appLink}" style="color:#0B3B8F;font-weight:600;font-size:13.5px;text-decoration:underline">Open Subscriptions in app</a></p>`
    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${explanation}</p>${renewLinkHtml}${appLinkHtml}` +
      `<p style="margin:18px 0 0;font-size:12.5px;line-height:1.6;color:#64748b">This will not repeat until this subscription's date is updated.</p>`
    const text =
      `${explanation}${row.renewalUrl ? `\n\nRenew it: ${row.renewalUrl}` : ''}\n\nOpen Subscriptions in app: ${appLink}` +
      `\n\nThis will not repeat until this subscription's date is updated.`

    const subject = already ? `${row.name} has expired` : `${row.name} expires ${whenPhrase}`
    const html = wrap(
      shopName,
      already ? 'A service has expired' : 'A service is expiring soon',
      body,
      `You are getting this because you are an active admin on ${escape(shopName)}.`,
    )

    for (const recipient of recipients) {
      await this.mailer
        .send({ to: recipient.email, subject, html, text })
        .catch((error) => this.log.error(`could not tell ${recipient.email} about ${row.name}: ${String(error)}`))
    }

    this.log.warn(`subscription ${row.id} (${row.name}) expiring ${whenPhrase}, told ${recipients.map((r) => r.email).join(', ')}`)
  }
}

function daysUntil(date: Date): number {
  const msPerDay = 86_400_000
  return Math.ceil((date.getTime() - Date.now()) / msPerDay)
}

function toView(row: {
  id: string
  name: string
  provider: string | null
  renewalUrl: string | null
  notes: string | null
  expiresAt: Date
  alertDaysBefore: number
  createdAt: Date
  updatedAt: Date
}): ServiceSubscriptionView {
  const daysUntilExpiry = daysUntil(row.expiresAt)
  const status: SubscriptionStatus =
    daysUntilExpiry < 0 ? 'expired' : daysUntilExpiry <= row.alertDaysBefore ? 'expiring_soon' : 'ok'
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    renewalUrl: row.renewalUrl,
    notes: row.notes,
    expiresAt: row.expiresAt.toISOString(),
    alertDaysBefore: row.alertDaysBefore,
    daysUntilExpiry,
    status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
