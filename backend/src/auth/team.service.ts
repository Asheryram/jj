import { Injectable, Logger } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'
import { SetupTokensService } from './setup-tokens.service'

/**
 * The accounts that run the platform, managed by whoever runs the platform.
 *
 * A superadmin creates the business owner's admin account and hands over a
 * one-time link. They never choose or see that password, which is the point: the
 * alternative — seeding an admin with a password published in `.env.example` — is
 * a live credential in production and cannot be rotated without a deploy.
 */
@Injectable()
export class TeamService {
  private readonly log = new Logger(TeamService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: SetupTokensService,
  ) {}

  /** Everyone with platform access, and whether they have signed in yet. */
  async list() {
    const rows = await this.prisma.user.findMany({
      where: { role: { in: ['admin', 'superadmin'] } },
      orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        passwordHash: true,
        joinedAt: true,
      },
    })

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      status: row.status,
      /** No password chosen yet — their setup link is still outstanding. */
      pendingSetup: !row.passwordHash,
      joinedAt: row.joinedAt.toISOString(),
    }))
  }

  /**
   * Create an admin and return the link they use to set their own password.
   *
   * The link is returned rather than sent, because there is no mail provider yet.
   * That is honest about the channel: the superadmin passes it on however they
   * already talk to this person, and the link dies in 48 hours or on first use.
   */
  async createAdmin(input: { name: string; email: string; phone: string }, invitedBy?: string) {
    const email = input.email.trim().toLowerCase()

    const clash = await this.prisma.user.findUnique({ where: { email } })
    if (clash) {
      throw new ConflictError(
        'EMAIL_IN_USE',
        `${email} already has an account here. Send them a new sign-in link instead of creating a second one.`,
      )
    }

    // Checked here rather than left to the unique index, so the message names
    // which field clashed. A superadmin typing in somebody's details needs to
    // know whether to change the email or the phone.
    const phoneClash = await this.prisma.user.findFirst({ where: { phone: input.phone } })
    if (phoneClash) {
      throw new ConflictError(
        'PHONE_IN_USE',
        `${input.phone} is already on another account. Use a different number for this one.`,
      )
    }

    const created = await this.prisma.user.create({
      data: {
        name: input.name.trim(),
        email,
        phone: input.phone,
        // No password until they set one, which is what the nullable column is
        // for. `login` compares against a dummy hash when it is null, so the
        // account simply cannot be signed into yet.
        passwordHash: null,
        role: 'admin',
        // Admins do not sell, so this is only an identifier. Kept unique and
        // obviously not a sell code.
        referralCode: `ADM${randomBytes(3).toString('hex').toUpperCase()}`,
        status: 'active',
      },
    })

    const { link, sent, reason } = await this.tokens.issueAndSend(
      created.id,
      'setup',
      invitedBy,
    )
    this.log.log(`admin ${email} created; setup link ${sent ? 'emailed' : 'issued but not emailed'}`)

    // The link is returned whether or not it was emailed. When mail is not
    // working the superadmin is the delivery channel, and needs to be told that
    // rather than assuming an email went out.
    return { id: created.id, email, setupLink: link, emailed: sent, emailProblem: reason ?? null }
  }

  /**
   * Issue a fresh link for someone who is locked out or never used their first.
   *
   * Deliberately a superadmin action rather than a public "forgot password" form:
   * there is no mail provider to send to, so a public version could only hand the
   * link to whoever asked — which is every attacker who knows an admin's email.
   */
  async resendLink(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, passwordHash: true },
    })
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      throw new NotFoundError('We could not find that account.')
    }

    const purpose = user.passwordHash ? 'reset' : 'setup'
    const { link, sent, reason } = await this.tokens.issueAndSend(user.id, purpose)

    this.log.warn(`${purpose} link re-issued for ${user.email}`)
    return {
      email: user.email,
      purpose,
      setupLink: link,
      emailed: sent,
      emailProblem: reason ?? null,
    }
  }

  /**
   * Suspend or restore platform access.
   *
   * The last active superadmin cannot be suspended. Locking the operator out of
   * their own platform is not a mistake that can be undone from inside it, and the
   * bootstrap only helps if the account is still active.
   */
  async setStatus(userId: string, status: 'active' | 'suspended', actingId: string) {
    if (userId === actingId && status === 'suspended') {
      throw new ValidationError('You cannot suspend your own account.')
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundError('We could not find that account.')

    if (user.role === 'superadmin' && status === 'suspended') {
      const others = await this.prisma.user.count({
        where: { role: 'superadmin', status: 'active', id: { not: userId } },
      })
      if (others === 0) {
        throw new ConflictError(
          'LAST_SUPERADMIN',
          'That is the only active superadmin. Promote somebody else first.',
        )
      }
    }

    await this.prisma.user.update({ where: { id: userId }, data: { status } })

    // Any outstanding link dies with the suspension, or it would be a way back in.
    if (status === 'suspended') {
      await this.prisma.setupToken.deleteMany({ where: { userId, usedAt: null } })
    }

    this.log.warn(`${user.email} is now ${status}`)
    return { id: userId, status }
  }
}
