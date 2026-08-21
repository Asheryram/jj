import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'
import { MailerService } from '../mail/mailer.service'

/**
 * Agents waiting to be let in.
 *
 * An agent sells under the platform's name, sets the prices customers pay, and
 * accrues money the platform owes them. That is a relationship somebody should
 * agree to before it starts, rather than one that begins the moment a form is
 * submitted — so registration creates the account and stops.
 *
 * Nothing else had to be locked down for this to be safe: both places that
 * resolve a seller already required `active`, so a waiting agent's shop link does
 * not sell and no order can be attributed to them. This queue only decides when
 * that changes.
 *
 * The same shape as the refund and branding queues on purpose. A refusal carries a
 * reason, the reason is shown to the person refused, and deciding twice is
 * refused rather than silently repeated.
 */
@Injectable()
export class ApplicationsService {
  private readonly log = new Logger(ApplicationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  /** Who is waiting, oldest first — the longest wait is the most urgent. */
  async pending() {
    const rows = await this.prisma.user.findMany({
      where: { role: 'agent', status: 'pending' },
      orderBy: { joinedAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        referralCode: true,
        uplineCode: true,
        joinedAt: true,
      },
    })

    // Who referred them, resolved to a name. An applicant who came through an
    // existing agent is a different proposition from one who found the form.
    const uplineCodes = [...new Set(rows.map((r) => r.uplineCode).filter(Boolean))] as string[]
    const uplines = uplineCodes.length
      ? await this.prisma.user.findMany({
          where: { referralCode: { in: uplineCodes } },
          select: { referralCode: true, name: true },
        })
      : []
    const nameFor = new Map(uplines.map((u) => [u.referralCode, u.name]))

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      referralCode: row.referralCode,
      referredBy: row.uplineCode ? (nameFor.get(row.uplineCode) ?? row.uplineCode) : null,
      appliedAt: row.joinedAt.toISOString(),
    }))
  }

  /** How many are waiting, for the dashboard. */
  async pendingCount(): Promise<number> {
    return this.prisma.user.count({ where: { role: 'agent', status: 'pending' } })
  }

  async approve(userId: string, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.role !== 'agent') throw new NotFoundError('We could not find that application.')
    if (user.status !== 'pending') {
      throw new ConflictError('ALREADY_DECIDED', `That application was already ${user.status}.`)
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'active', statusNote: null, decidedAt: new Date(), decidedBy: adminId },
    })

    const shopName = await this.platformName()
    // Told, not left to discover. An agent who is not told they are approved does
    // not start selling, which defeats the point of approving them.
    await this.mailer.send({
      to: user.email,
      subject: `You are approved to sell on ${shopName}`,
      text: [
        `Hello ${user.name},`,
        '',
        `Your agent account on ${shopName} has been approved. You can sign in and start selling now.`,
        '',
        `Your shop link is the one to share: it carries your code ${user.referralCode}, so every`,
        'sale through it is yours and earns you your margin.',
        '',
        'Sign in and open "Sell & refer" to find it.',
      ].join('\n'),
      html: `<p>Hello ${user.name},</p>
        <p>Your agent account on ${shopName} has been approved. You can sign in and start selling now.</p>
        <p>Your shop link carries your code <strong>${user.referralCode}</strong>, so every sale through it is yours and earns you your margin. Sign in and open <strong>Sell &amp; refer</strong> to find it.</p>`,
    })

    this.log.log(`agent ${user.referralCode} approved by ${adminId}`)
    return { id: userId, status: 'active' as const }
  }

  /**
   * Turn an application down, with a reason.
   *
   * The reason is required and is shown to the applicant when they next try to
   * sign in, as well as being emailed. Somebody refused without being told why
   * will simply apply again.
   */
  async reject(userId: string, adminId: string, note: string) {
    const reason = note.trim()
    if (reason.length < 5) {
      throw new ValidationError('Give a reason. The applicant is shown it.')
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.role !== 'agent') throw new NotFoundError('We could not find that application.')
    if (user.status !== 'pending') {
      throw new ConflictError('ALREADY_DECIDED', `That application was already ${user.status}.`)
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'rejected', statusNote: reason, decidedAt: new Date(), decidedBy: adminId },
    })

    const shopName = await this.platformName()
    await this.mailer.send({
      to: user.email,
      subject: `About your ${shopName} agent application`,
      text: [
        `Hello ${user.name},`,
        '',
        `Your application to sell on ${shopName} was not approved.`,
        '',
        reason,
        '',
        'If you think this is a mistake, reply to this message or call us.',
      ].join('\n'),
      html: `<p>Hello ${user.name},</p>
        <p>Your application to sell on ${shopName} was not approved.</p>
        <p style="padding:12px 14px;background:#f8fafc;border-radius:10px">${reason}</p>
        <p>If you think this is a mistake, reply to this message or call us.</p>`,
    })

    this.log.warn(`agent application ${user.referralCode} refused by ${adminId}: ${reason}`)
    return { id: userId, status: 'rejected' as const }
  }

  private async platformName(): Promise<string> {
    const branding = await this.prisma.branding.findFirst({ where: { userId: null } })
    return branding?.shopName ?? 'JamesDataConsult'
  }
}
