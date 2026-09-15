import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { FeedbackCategory, FeedbackStatus, Role } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { MailerService } from '../mail/mailer.service'
import { escape, wrap } from '../mail/templates'
import { appUrl } from '../common/app-links'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'
import type { AuthUser } from '../common/auth'

export interface FeedbackView {
  id: string
  category: FeedbackCategory
  message: string
  status: FeedbackStatus
  note: string | null
  createdAt: string
  decidedAt: string | null
}

export interface AdminFeedbackView extends FeedbackView {
  userId: string
  agentName: string
  agentCode: string
  decidedBy: string | null
  escalated: boolean
  escalatedAt: string | null
}

/**
 * A suggestion or a problem report, sent in from inside the app by an agent
 * actually using it. See the `FeedbackReport` model's own doc comment for
 * why this is a separate, simpler shape than the refusal-style queues
 * (`RefundRequest`, `BrandingRequest`) it otherwise resembles.
 */
@Injectable()
export class FeedbackService {
  private readonly log = new Logger(FeedbackService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  async submit(user: AuthUser, category: FeedbackCategory, rawMessage: string): Promise<FeedbackView> {
    const message = rawMessage.trim()
    if (message.length < 5) {
      throw new ValidationError('Say a little more, five characters minimum.')
    }
    if (message.length > 2000) {
      throw new ValidationError('Keep it under 2000 characters.')
    }

    const row = await this.prisma.feedbackReport.create({
      data: {
        userId: user.id,
        agentName: user.name,
        agentCode: user.referralCode,
        category,
        message,
      },
    })
    return toFeedbackView(row)
  }

  /** An agent's own submissions, newest first, so they can see what happened to them. */
  async mine(userId: string): Promise<FeedbackView[]> {
    const rows = await this.prisma.feedbackReport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toFeedbackView)
  }

  /**
   * Admin sees the whole inbox: everything agents send in. Superadmin sees
   * only what's been escalated to them, since the platform operator has no
   * reason to be the first reader of a "please add a filter to Reports"
   * suggestion, and treating that as noise defeats the point of escalating
   * anything at all. `escalatedOnly` lets admin narrow to the same view
   * voluntarily; for a superadmin it's always effectively on, not just the
   * default.
   *
   * `status` and `category` narrow independently of each other and of the
   * escalated restriction.
   */
  async list(
    viewerRole: Role,
    status?: FeedbackStatus,
    category?: FeedbackCategory,
    escalatedOnly?: boolean,
  ): Promise<AdminFeedbackView[]> {
    const rows = await this.prisma.feedbackReport.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
        ...(viewerRole === 'superadmin' || escalatedOnly ? { escalated: true } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toAdminView)
  }

  /**
   * Change its status. Unlike a refusal, no reason is required, since this
   * isn't turning somebody down, so there is nothing owed to anyone by way
   * of justification, though an admin can still leave a note.
   *
   * A superadmin deciding on something never escalated to them is refused
   * the same way a missing id is. Not distinguished, so this can't be used
   * to probe for ids of items they otherwise cannot see via `list`.
   */
  async decide(
    id: string,
    viewerRole: Role,
    adminId: string,
    status: FeedbackStatus,
    note?: string,
  ): Promise<AdminFeedbackView> {
    const existing = await this.prisma.feedbackReport.findUnique({ where: { id } })
    if (!existing || (viewerRole === 'superadmin' && !existing.escalated)) {
      throw new NotFoundError('We could not find that feedback.')
    }

    const row = await this.prisma.feedbackReport.update({
      where: { id },
      data: {
        status,
        decidedBy: adminId,
        decidedAt: new Date(),
        ...(note !== undefined ? { note: note.trim() || null } : {}),
      },
    })

    return toAdminView(row)
  }

  /**
   * One item by id, for the link an escalation email sends someone to. The
   * queue's own filters (status/category/escalated) would otherwise have to
   * happen to already match, or the linked item silently would not appear.
   * Same visibility rule as `list`/`decide`: not found, not refused, for a
   * superadmin asking about something never escalated to them.
   */
  async byId(id: string, viewerRole: Role): Promise<AdminFeedbackView> {
    const row = await this.prisma.feedbackReport.findUnique({ where: { id } })
    if (!row || (viewerRole === 'superadmin' && !row.escalated)) {
      throw new NotFoundError('We could not find that feedback.')
    }
    return toAdminView(row)
  }

  /**
   * Admin's call that this needs the platform side, not a business decision.
   * See the model's own doc comment for the James/Asher split this mirrors.
   * Emails active superadmins immediately: unlike the status queue itself,
   * this is meant to reach someone now, not wait to be noticed on a next
   * visit to the page.
   */
  async escalate(id: string, adminId: string, adminName: string, origin?: string): Promise<AdminFeedbackView> {
    const existing = await this.prisma.feedbackReport.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError('We could not find that feedback.')
    if (existing.escalated) {
      throw new ConflictError('ALREADY_ESCALATED', 'This was already escalated to the platform team.')
    }

    const row = await this.prisma.feedbackReport.update({
      where: { id },
      data: { escalated: true, escalatedAt: new Date(), escalatedBy: adminId },
    })

    await this.alertEscalation(row, adminName, origin)

    return toAdminView(row)
  }

  /**
   * How many are still open, for the nav badge. Scoped the same way `list`
   * is: a superadmin's badge must match what clicking through to `list`
   * actually shows them, or the number would promise items they'd never see.
   */
  async openCount(viewerRole: Role): Promise<number> {
    return this.prisma.feedbackReport.count({
      where: { status: 'open', ...(viewerRole === 'superadmin' ? { escalated: true } : {}) },
    })
  }

  private async platformName(): Promise<string> {
    const branding = await this.prisma.branding.findFirst({ where: { userId: null } })
    return branding?.shopName ?? 'JamesDataConsult'
  }

  /** Tell every active superadmin, the one place in this queue that's aimed at them specifically. */
  private async alertEscalation(
    row: { id: string; agentName: string; agentCode: string; category: FeedbackCategory; message: string },
    adminName: string,
    origin?: string,
  ): Promise<void> {
    const recipients = await this.prisma.user.findMany({
      where: { role: 'superadmin', status: 'active' },
      select: { name: true, email: true },
    })
    if (recipients.length === 0) {
      this.log.warn(`feedback ${row.id} escalated by ${adminName}, no active superadmin to tell`)
      return
    }

    const shopName = await this.platformName()
    const kind = row.category === 'issue' ? 'an issue' : 'a suggestion'
    const explanation =
      `${escape(adminName)} flagged ${kind} from ${escape(row.agentName)} (${escape(row.agentCode)}) as ` +
      `something that needs the platform side, not a business decision.`
    const link = appUrl(this.config, `/admin/feedback?item=${encodeURIComponent(row.id)}`, origin)

    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${explanation}</p>` +
      `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin:0 0 20px;font-size:14px;line-height:1.6;color:#1e293b">${escape(row.message)}</div>` +
      `<p style="margin:0"><a href="${link}" style="display:inline-block;background:#0B3B8F;color:#fff;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;text-decoration:none">Open this ticket</a></p>`
    const text = `${explanation}\n\n${row.message}\n\nOpen this ticket: ${link}`

    const subject = `Escalated: ${row.category === 'issue' ? 'issue' : 'suggestion'} from ${row.agentName}`
    const html = wrap(
      shopName,
      'Something needs the platform team',
      body,
      `You are getting this because you are an active superadmin on ${escape(shopName)}.`,
    )

    for (const recipient of recipients) {
      await this.mailer
        .send({ to: recipient.email, subject, html, text })
        .catch((error) =>
          this.log.error(`could not tell ${recipient.email} about the escalation: ${String(error)}`),
        )
    }

    this.log.warn(`feedback ${row.id} escalated by ${adminName}, told ${recipients.map((r) => r.email).join(', ')}`)
  }
}

function toFeedbackView(row: {
  id: string
  category: FeedbackCategory
  message: string
  status: FeedbackStatus
  note: string | null
  createdAt: Date
  decidedAt: Date | null
}): FeedbackView {
  return {
    id: row.id,
    category: row.category,
    message: row.message,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  }
}

function toAdminView(row: {
  id: string
  category: FeedbackCategory
  message: string
  status: FeedbackStatus
  note: string | null
  createdAt: Date
  decidedAt: Date | null
  userId: string
  agentName: string
  agentCode: string
  decidedBy: string | null
  escalated: boolean
  escalatedAt: Date | null
}): AdminFeedbackView {
  return {
    ...toFeedbackView(row),
    userId: row.userId,
    agentName: row.agentName,
    agentCode: row.agentCode,
    decidedBy: row.decidedBy,
    escalated: row.escalated,
    escalatedAt: row.escalatedAt?.toISOString() ?? null,
  }
}
