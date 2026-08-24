import { Injectable, Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import type { User } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { toSession } from '../common/mappers'
import type { TokenPayload } from '../common/auth'
import { ConflictError, ForbiddenError, UnauthorisedError } from '../common/domain-errors'
import type { LoginDto, RegisterDto } from './auth.dto'

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly settings: SettingsService,
  ) {}

  /** FR-1.3 */
  async login(dto: LoginDto) {
    // Stored lowercase at registration, so compare lowercase. Otherwise someone
    // who typed a capital when signing up can never log in again.
    /**
   * One credential per person, on whichever profile holds it.
   *
   * An email is no longer unique on its own — a person may hold an admin profile
   * and an agent profile, and they share an address because they are the same
   * human. Exactly one of those rows carries a password, and it is the one you
   * sign in as; the others are reached by switching afterwards. So the password
   * is what identifies the login, not the email alone.
   */
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.trim().toLowerCase(), passwordHash: { not: null } },
    })

    // Same message and the same amount of work whether the address exists or the
    // password is wrong — otherwise the response tells an attacker which email
    // addresses are registered.
    const hash = user?.passwordHash ?? NON_EXISTENT_HASH
    const ok = await bcrypt.compare(dto.password, hash)
    if (!user || !ok) throw new UnauthorisedError()

    if (user.status === 'suspended') {
      throw new ForbiddenError(
        'This account is suspended. Contact James on 020 987 6543 to restore it.',
      )
    }

    if (user.status === 'rejected') {
      // The reason, if there is one. Being turned down and told nothing is worse
      // than being turned down.
      throw new ForbiddenError(
        user.statusNote
          ? `This application was not approved: ${user.statusNote}`
          : 'This application was not approved. Contact James on 020 987 6543.',
      )
    }

    // `pending` is deliberately allowed through. A waiting agent signing in and
    // being told their password is wrong would send them round in circles; they
    // are let in, and the app shows them what they are waiting for.

    return this.issue(user)
  }

  /** FR-1.1, FR-1.2, FR-1.6, FR-1.7 */
  async register(dto: RegisterDto) {
    const referral = dto.referralCode?.trim().toUpperCase() || null

    // An unknown code is worth failing on rather than silently dropping: the
    // upline would never see their recruit, and nobody would know why.
    let uplineCode: string | null = null
    if (referral) {
      const upline = await this.prisma.user.findUnique({ where: { referralCode: referral } })
      if (!upline) {
        throw new ConflictError(
          'UNKNOWN_REFERRAL_CODE',
          `We do not recognise the referral code ${referral}. Check it, or clear the field to sign up directly.`,
        )
      }
      // Only a seller can have a downline. Signing up under a customer would
      // create a chain link that can never be paid.
      uplineCode = upline.role === 'customer' ? null : upline.referralCode
    }

    /**
     * One account per person on the public form, across every role.
     *
     * Load-bearing rather than belt-and-braces since email and phone became
     * unique per role: without this a stranger could register an agent account on
     * somebody's address, and the two rows would then look like one person's two
     * profiles. A second profile is only ever created by the owner of an existing
     * account — never here.
     */
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ phone: dto.phone }, { email: dto.email.toLowerCase() }] },
      select: { phone: true },
    })
    if (existing) {
      throw new ConflictError(
        'ALREADY_EXISTS',
        existing.phone === dto.phone
          ? 'That phone number already has an account. Log in instead.'
          : 'That email address already has an account. Log in instead.',
      )
    }

    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        phone: dto.phone,
        email: dto.email.toLowerCase(),
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: dto.accountType,
        referralCode: await this.freshReferralCode(dto.name),
        uplineCode,
        // A new agent's default markup. They can price per product afterwards.
        markupPercent: 8,
        balance: 0,
        /**
         * An agent applies; a customer simply signs up.
         *
         * The difference is what the account can do. A customer spends their own
         * money and represents nobody, so approving them would be a queue for
         * its own sake. An agent sells under the platform's name, sets prices
         * customers pay, and accrues money the platform owes them — that is a
         * relationship somebody should agree to before it starts.
         *
         * Both places that resolve a seller already require `active`, so a
         * pending agent's shop link does not sell and no order can be attributed
         * to them. Nothing else had to change to make this safe.
         */
        /**
         * An agent waits only if the platform says applications are reviewed.
         *
         * `agentsAutoApprove` is on by default, because the common case is James
         * signing up somebody he already knows and an approval queue between them
         * is friction for its own sake. Turned off, every sign-up lands in Agent
         * applications for a decision, which is what you want once strangers are
         * finding the form.
         */
        status:
          dto.accountType === 'agent' && !(await this.settings.all()).agentsAutoApprove
            ? 'pending'
            : 'active',
      },
    })

    return this.issue(user)
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new UnauthorisedError('Please log in again.')
    return {
      user: toSession(user),
      balance: user.balance,
      profiles: await this.profilesFor(user.email),
    }
  }

  /**
   * Change the phone number on every profile this person holds.
   *
   * It has to be every profile, not just the one signed in: they share a number
   * because they are the same person, and leaving the others behind would mean a
   * payout going to whichever profile happened to be stale. The bootstrap seeds
   * `0000000000`, which is a placeholder no Mobile Money transfer can ever reach —
   * so until this is set, an agent profile cannot be paid.
   */
  async updatePhone(userId: string, phone: string) {
    const me = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!me) throw new UnauthorisedError('Please log in again.')

    // Somebody else's number, on any profile. Their own profiles are expected to
    // share it, which is why the check excludes their own address.
    const taken = await this.prisma.user.findFirst({
      where: { phone, email: { not: me.email } },
      select: { id: true },
    })
    if (taken) {
      throw new ConflictError(
        'PHONE_IN_USE',
        `${phone} is already on somebody else's account.`,
      )
    }

    const { count } = await this.prisma.user.updateMany({
      where: { email: me.email },
      data: { phone },
    })

    this.log.log(`${me.email} changed their number on ${count} profile(s)`)
    const updated = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    return { user: toSession(updated), profiles: await this.profilesFor(me.email) }
  }

  /**
   * Every profile this person holds, for the switcher.
   *
   * Keyed on the email because that is what identifies the human: profiles share
   * an address precisely because they are the same person, and registration
   * refuses an address that already belongs to somebody. Ordered so the switcher
   * reads the same way every time.
   */
  async profilesFor(email: string) {
    const rows = await this.prisma.user.findMany({
      where: { email },
      select: { id: true, role: true, status: true, referralCode: true },
    })

    const rank: Record<string, number> = { superadmin: 0, admin: 1, agent: 2, customer: 3 }
    return rows
      .sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9))
      .map((row) => ({
        id: row.id,
        role: row.role,
        status: row.status,
        referralCode: row.referralCode,
      }))
  }

  /**
   * Add another profile to the signed-in person's own account.
   *
   * The invariant this maintains, and the reason it is the only way a second
   * profile can exist: **at most one row per email carries a password.** A new
   * profile gets `passwordHash: null`, so it cannot be signed into directly and
   * there is never a second way into one identity. Public registration refuses an
   * address that already exists, so nobody but the owner can reach this.
   *
   * Only downwards. An agent cannot grant themselves anything, and nobody grants
   * themselves superadmin — the platform role is handed out by the bootstrap and
   * the team screen, never claimed.
   */
  async createProfile(userId: string, role: 'admin' | 'agent') {
    const me = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!me) throw new UnauthorisedError('Please log in again.')

    if (me.role !== 'admin' && me.role !== 'superadmin') {
      throw new ForbiddenError('Only the platform team can add a profile.')
    }
    if (role === 'admin' && me.role !== 'superadmin') {
      throw new ForbiddenError('Only the platform owner can add an admin profile.')
    }

    const already = await this.prisma.user.findFirst({
      where: { email: me.email, role },
      select: { id: true },
    })
    if (already) {
      throw new ConflictError('PROFILE_EXISTS', `You already have ${role === 'admin' ? 'an admin' : 'an agent'} profile.`)
    }

    const created = await this.prisma.user.create({
      data: {
        name: me.name,
        email: me.email,
        // The same number. Unique per role now, so their own profiles may share it.
        phone: me.phone,
        // Never a password of its own — see the invariant above.
        passwordHash: null,
        role,
        // An agent profile sells, so it needs a code somebody can read out. An
        // admin profile does not, so it gets an identifier that cannot be mistaken
        // for one.
        referralCode:
          role === 'agent'
            ? await this.freshReferralCode(me.name)
            : `ADM${Date.now().toString(36).toUpperCase().slice(-6)}`,
        // Their own profile, added by them — there is nobody to approve it.
        status: 'active',
        markupPercent: 8,
        balance: 0,
      },
    })

    this.log.log(`${me.email} added a ${role} profile`)
    return { id: created.id, role: created.role, referralCode: created.referralCode }
  }

  /**
   * Swap the session for one of this person's other profiles.
   *
   * Safe because both rows share an email, and an email only ever covers one
   * person: registration refuses an address already in use, and only the owner
   * can add a profile. So this cannot reach anybody else's account, and there is
   * no password involved — the caller already proved who they are.
   */
  async switchProfile(userId: string, targetId: string) {
    const [me, target] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.user.findUnique({ where: { id: targetId } }),
    ])

    if (!me) throw new UnauthorisedError('Please log in again.')
    if (!target || target.email !== me.email) {
      throw new ForbiddenError('That is not one of your profiles.')
    }
    if (target.status === 'suspended' || target.status === 'rejected') {
      throw new ForbiddenError('That profile is not active.')
    }

    this.log.log(`${me.email} switched from ${me.role} to ${target.role}`)
    return this.issue(target)
  }

  private async issue(user: User) {
    const payload: TokenPayload = {
      sub: user.id,
      role: user.role,
      code: user.referralCode,
      phone: user.phone,
      name: user.name,
    }
    return {
      accessToken: await this.jwt.signAsync(payload),
      // Sent with every token so the client always knows which hats this person
      // has, without a second request on every page load.
      profiles: await this.profilesFor(user.email),
      user: toSession(user),
      balance: user.balance,
    }
  }

  /**
   * FR-1.7 — a referral code is unique, and it is also a thing people read out
   * over the phone. So: first name plus digits, no ambiguous characters, and a
   * uniqueness check rather than trusting entropy.
   */
  private async freshReferralCode(name: string): Promise<string> {
    const stem =
      (name.trim().split(/\s+/)[0] ?? 'AGENT')
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 6) || 'AGENT'

    for (let attempt = 0; attempt < 20; attempt++) {
      const code = `${stem}${Math.floor(10 + Math.random() * 89)}`
      const taken = await this.prisma.user.findUnique({
        where: { referralCode: code },
        select: { id: true },
      })
      if (!taken) return code
    }
    // Twenty collisions on a two-digit suffix means the stem is saturated. Fall
    // back to something certainly free rather than looping forever.
    return `${stem}${Date.now().toString(36).toUpperCase().slice(-5)}`
  }
}

/**
 * A real bcrypt hash of a value nothing will ever match. Comparing against it
 * keeps the timing of a failed login for an unknown number the same as for a
 * known one.
 */
const NON_EXISTENT_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8DkxaWTOa2SLm6cUUUxQuQzFRVi1Iu'
