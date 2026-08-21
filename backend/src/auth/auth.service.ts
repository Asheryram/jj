import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import type { User } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { toSession } from '../common/mappers'
import type { TokenPayload } from '../common/auth'
import { ConflictError, ForbiddenError, UnauthorisedError } from '../common/domain-errors'
import type { LoginDto, RegisterDto } from './auth.dto'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** FR-1.3 */
  async login(dto: LoginDto) {
    // Stored lowercase at registration, so compare lowercase. Otherwise someone
    // who typed a capital when signing up can never log in again.
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
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
        status: dto.accountType === 'agent' ? 'pending' : 'active',
      },
    })

    return this.issue(user)
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new UnauthorisedError('Please log in again.')
    return { user: toSession(user), balance: user.balance }
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
