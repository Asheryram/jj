import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes } from 'node:crypto'
import * as bcrypt from 'bcryptjs'
import type { SetupTokenPurpose } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ValidationError } from '../common/domain-errors'
import { MailerService } from '../mail/mailer.service'
import { resetMail, setupMail } from '../mail/templates'

/**
 * How long a link lives.
 *
 * A setup link has to survive being written down and used later in the day; a
 * reset link is answering "I am locked out right now" and has no reason to
 * outlive the sitting. Both are short enough that a link found in an old message
 * is already dead.
 */
const LIFETIME_MS: Record<SetupTokenPurpose, number> = {
  setup: 48 * 3_600_000,
  reset: 60 * 60_000,
}

/** Short enough to type, long enough that guessing is not a strategy. */
const TOKEN_BYTES = 32

/**
 * The minimum password we will accept.
 *
 * Length only, deliberately. Composition rules — a capital, a digit, a symbol —
 * push people towards `Password1!` and towards writing it down, and this account
 * can move money. Ten characters of anything beats eight characters of theatre.
 */
const MIN_PASSWORD = 10

/**
 * One-time links for setting a password.
 *
 * This exists so that no password is ever seeded, emailed, or known by anyone but
 * its owner. Before it, the only way an admin account existed was the seed
 * creating one with a password published in `.env.example` — which is fine on a
 * laptop and is a live credential in production.
 *
 * The same machinery serves three jobs, because they are the same job: an account
 * proving it may set a password without knowing the old one. Bootstrapping the
 * first superadmin, a superadmin creating an admin, and a future forgotten-password
 * flow all mint a token and consume it identically.
 */
@Injectable()
export class SetupTokensService {
  private readonly log = new Logger(SetupTokensService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
  ) {}

  /** Only ever the hash is stored, so a leaked table yields no working links. */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private link(token: string): string {
    const base = (this.config.get<string>('PUBLIC_APP_URL')?.trim() || 'http://localhost:5173').replace(
      /\/$/,
      '',
    )
    return `${base}/set-password?token=${token}`
  }

  /**
   * Mint a link for one account, cancelling any earlier unused one.
   *
   * Cancelling matters: two live links for the same account means a superadmin who
   * re-sends because the first went astray has left the first one working.
   */
  async issue(userId: string, purpose: SetupTokenPurpose): Promise<{ link: string }> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url')

    await this.prisma.$transaction(async (tx) => {
      await tx.setupToken.deleteMany({ where: { userId, usedAt: null } })
      await tx.setupToken.create({
        data: {
          userId,
          tokenHash: this.hash(token),
          purpose,
          expiresAt: new Date(Date.now() + LIFETIME_MS[purpose]),
        },
      })
    })

    return { link: this.link(token) }
  }

  /**
   * Mint a link and email it.
   *
   * The link comes back either way. Mail failing is not a reason to fail the
   * action that needed it — an unsent password link is still a working password
   * link, and the caller can hand it over by another route. `sent` says which
   * happened so nothing claims an email arrived when it did not.
   */
  async issueAndSend(
    userId: string,
    purpose: SetupTokenPurpose,
    invitedBy?: string,
  ): Promise<{ link: string; sent: boolean; reason?: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true },
    })

    const { link } = await this.issue(userId, purpose)

    // The platform's own name, so the message matches the product the recipient
    // is being asked to sign in to.
    const branding = await this.prisma.branding.findFirst({ where: { userId: null } })
    const shopName = branding?.shopName ?? 'JamesDataConsult'

    const mail =
      purpose === 'setup'
        ? setupMail({ to: user.email, name: user.name, shopName, link, invitedBy })
        : resetMail({ to: user.email, name: user.name, shopName, link })

    const result = await this.mailer.send(mail)
    return { link, sent: result.sent, reason: result.reason }
  }

  /**
   * Somebody asking for their own reset link, by email.
   *
   * Two things it deliberately does not do.
   *
   * It never says whether the address exists. A "no such account" reply turns this
   * into a way to discover who has access, so the answer is the same either way and
   * the caller cannot tell an unknown address from a real one.
   *
   * It will not mint a second link within a minute of the last. Nothing here is
   * guessable, so the risk is not brute force — it is using the platform to send
   * somebody a hundred emails.
   */
  async requestReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, role: true, status: true, passwordHash: true },
    })

    // Customers sign in with a wallet they can top up again; agents and admins
    // have a business behind the account. Both are fine to reset — but a
    // never-set password is a `setup`, not a `reset`.
    if (!user || user.status !== 'active') return

    const recent = await this.prisma.setupToken.findFirst({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } },
    })
    if (recent) {
      this.log.warn(`reset for ${email} throttled — one was issued in the last minute`)
      return
    }

    await this.issueAndSend(user.id, user.passwordHash ? 'reset' : 'setup')
  }

  /**
   * Whether a link is still good, without spending it.
   *
   * The page behind the link calls this before showing a password field, so
   * somebody following a dead link is told so instead of typing a new password
   * twice and then being refused.
   */
  async check(token: string): Promise<{ valid: boolean; name?: string; purpose?: string }> {
    const row = await this.prisma.setupToken.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { user: { select: { name: true, status: true } } },
    })

    if (!row || row.usedAt || row.expiresAt < new Date()) return { valid: false }
    if (row.user.status !== 'active') return { valid: false }
    return { valid: true, name: row.user.name, purpose: row.purpose }
  }

  /**
   * Spend a link and set the password.
   *
   * The lookup, the expiry check and the write are one transaction, so a link
   * cannot be used twice by two requests arriving together. Nothing here reveals
   * whose account it was on failure — a dead link says only that it is dead.
   */
  async consume(token: string, password: string): Promise<{ email: string }> {
    if (password.length < MIN_PASSWORD) {
      throw new ValidationError(
        `Use at least ${MIN_PASSWORD} characters. A phrase you will remember is better than a short complicated one.`,
      )
    }

    const passwordHash = await bcrypt.hash(password, 10)

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.setupToken.findUnique({
        where: { tokenHash: this.hash(token) },
        include: { user: { select: { id: true, email: true, status: true } } },
      })

      // One message for every failure. Distinguishing "expired" from "already
      // used" from "never existed" tells an attacker which links were real.
      if (!row || row.usedAt || row.expiresAt < new Date() || row.user.status !== 'active') {
        throw new ValidationError(
          'That link has expired or has already been used. Ask for a new one.',
        )
      }

      await tx.user.update({ where: { id: row.user.id }, data: { passwordHash } })
      await tx.setupToken.update({ where: { id: row.id }, data: { usedAt: new Date() } })

      // Every other outstanding link for this account dies with it, so an old
      // one cannot be used to take the account back.
      await tx.setupToken.deleteMany({
        where: { userId: row.user.id, usedAt: null, id: { not: row.id } },
      })

      this.log.log(`password set for ${row.user.email} via ${row.purpose} link`)
      return { email: row.user.email }
    })
  }
}
