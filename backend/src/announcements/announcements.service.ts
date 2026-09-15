import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AnnouncementAudience } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { MailerService } from '../mail/mailer.service'
import { escape, wrap } from '../mail/templates'
import { appUrl } from '../common/app-links'
import { NotFoundError, ValidationError } from '../common/domain-errors'
import type { AuthUser } from '../common/auth'

export interface MyAnnouncement {
  id: string
  title: string
  message: string
  createdAt: string
  readAt: string | null
}

export interface AnnouncementHistoryRow {
  id: string
  title: string
  message: string
  audience: AnnouncementAudience
  createdByName: string
  createdAt: string
  recipientCount: number
  readCount: number
}

/**
 * A one-way notice from admin/superadmin to agents, sent by email and kept
 * as an in-app notification. See the `Announcement` model's own doc comment
 * for why this is a separate feature from `Setting.siteNotice`.
 */
@Injectable()
export class AnnouncementsService {
  private readonly log = new Logger(AnnouncementsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  /** Active agents, for the sender's picker when choosing specific recipients. */
  async activeAgents(): Promise<{ id: string; name: string; referralCode: string }[]> {
    return this.prisma.user.findMany({
      where: { role: 'agent', status: 'active' },
      select: { id: true, name: true, referralCode: true },
      orderBy: { name: 'asc' },
    })
  }

  /**
   * Send an announcement. The recipient list is resolved and frozen right
   * now, not kept as a live query against "active agents", so somebody who
   * joins tomorrow does not retroactively see today's notice as new.
   */
  async send(
    sender: AuthUser,
    title: string,
    message: string,
    audience: 'all' | string[],
    origin?: string,
  ): Promise<AnnouncementHistoryRow> {
    const trimmedTitle = title.trim()
    const trimmedMessage = message.trim()
    if (trimmedTitle.length < 3) {
      throw new ValidationError('Give it a title, three characters minimum.')
    }
    if (trimmedMessage.length < 5) {
      throw new ValidationError('Say a little more, five characters minimum.')
    }

    const recipients =
      audience === 'all'
        ? await this.activeAgents()
        : await this.prisma.user
            .findMany({
              where: { id: { in: audience }, role: 'agent', status: 'active' },
              select: { id: true, name: true, referralCode: true },
            })
            .then((rows) => rows)

    if (recipients.length === 0) {
      throw new ValidationError('Choose at least one active agent to send this to.')
    }

    const announcement = await this.prisma.announcement.create({
      data: {
        title: trimmedTitle,
        message: trimmedMessage,
        audience: audience === 'all' ? 'all' : 'selected',
        createdBy: sender.id,
        createdByName: sender.name,
        recipients: {
          create: recipients.map((agent) => ({ userId: agent.id })),
        },
      },
    })

    await this.emailRecipients(announcement.id, trimmedTitle, trimmedMessage, recipients, origin)

    return {
      id: announcement.id,
      title: announcement.title,
      message: announcement.message,
      audience: announcement.audience,
      createdByName: announcement.createdByName,
      createdAt: announcement.createdAt.toISOString(),
      recipientCount: recipients.length,
      readCount: 0,
    }
  }

  /** Sent one at a time, same reasoning as every other bulk-mail loop in this codebase: one bad mailbox must not stop the rest. */
  private async emailRecipients(
    announcementId: string,
    title: string,
    message: string,
    recipients: { id: string; name: string }[],
    origin?: string,
  ): Promise<void> {
    const shopName = await this.platformName()
    const subject = `${shopName}: ${title}`
    const link = appUrl(this.config, `/app/announcements?item=${encodeURIComponent(announcementId)}`, origin)
    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${escape(message).replace(/\n/g, '<br>')}</p>` +
      `<p style="margin:0"><a href="${link}" style="display:inline-block;background:#0B3B8F;color:#fff;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;text-decoration:none">Open in app</a></p>`
    const html = wrap(shopName, title, body, `You are getting this because you are an active agent on ${escape(shopName)}.`)

    let sent = 0
    let failed = 0
    for (const recipient of recipients) {
      const user = await this.prisma.user.findUnique({ where: { id: recipient.id }, select: { email: true, name: true } })
      if (!user) continue

      const text = `Hello ${user.name},\n\n${message}\n\nOpen in app: ${link}`
      const result = await this.mailer
        .send({ to: user.email, subject, html, text })
        .catch((error) => ({ sent: false, reason: String(error) }))

      await this.prisma.announcementRecipient.updateMany({
        where: { announcementId, userId: recipient.id },
        data: { emailSent: result.sent, emailError: result.sent ? null : (result.reason ?? 'unknown') },
      })

      if (result.sent) sent++
      else failed++
    }

    this.log.log(`announcement ${announcementId}: emailed ${sent} agent(s), ${failed} failed`)
  }

  private async platformName(): Promise<string> {
    const branding = await this.prisma.branding.findFirst({ where: { userId: null } })
    return branding?.shopName ?? 'JamesDataConsult'
  }

  /** An agent's own announcements, newest first, so the newest notice is the first thing they see. */
  async mine(userId: string): Promise<MyAnnouncement[]> {
    const rows = await this.prisma.announcementRecipient.findMany({
      where: { userId },
      include: { announcement: true },
      orderBy: { announcement: { createdAt: 'desc' } },
    })
    return rows.map((row) => ({
      id: row.announcement.id,
      title: row.announcement.title,
      message: row.announcement.message,
      createdAt: row.announcement.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    }))
  }

  /** How many an agent has not opened yet, for their own nav badge. */
  async unreadCount(userId: string): Promise<number> {
    return this.prisma.announcementRecipient.count({ where: { userId, readAt: null } })
  }

  async markRead(id: string, userId: string): Promise<void> {
    const updated = await this.prisma.announcementRecipient.updateMany({
      where: { announcementId: id, userId, readAt: null },
      data: { readAt: new Date() },
    })
    // A second call (already read, or never actually addressed to this agent)
    // is a no-op rather than an error: opening the same notice twice is not
    // a mistake worth surfacing to whoever clicked it.
    if (updated.count === 0) {
      const exists = await this.prisma.announcementRecipient.findUnique({
        where: { announcementId_userId: { announcementId: id, userId } },
      })
      if (!exists) throw new NotFoundError('We could not find that announcement.')
    }
  }

  /** Admin/superadmin's own sent history, with how many of each have actually been read. */
  async history(): Promise<AnnouncementHistoryRow[]> {
    const rows = await this.prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
      include: { recipients: { select: { readAt: true } } },
    })
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      message: row.message,
      audience: row.audience,
      createdByName: row.createdByName,
      createdAt: row.createdAt.toISOString(),
      recipientCount: row.recipients.length,
      readCount: row.recipients.filter((r) => r.readAt !== null).length,
    }))
  }
}
