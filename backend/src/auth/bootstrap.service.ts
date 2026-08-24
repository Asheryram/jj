import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { SetupTokensService } from './setup-tokens.service'

/**
 * Getting the first real account into a fresh deployment.
 *
 * The problem this solves is small and load-bearing: a production database starts
 * empty, and somebody has to be able to sign in to it. Every easy answer to that
 * is a bad one — a seeded password is a published credential, a default account is
 * a known target, and a public "claim this platform" endpoint is a race with
 * whoever finds it first.
 *
 * So on boot, the address in `SUPERADMIN_EMAIL` is made a superadmin if it is not
 * one already. If that account has no usable password, a one-time setup link is
 * minted and written to the server log — which is the one channel that is already
 * private, needs no mail provider, and is only readable by whoever deployed the
 * thing.
 *
 * Nothing here ever sets a password. The operator follows the link and chooses
 * their own, and the same mechanism then lets them create the business owner's
 * account without knowing that password either.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly log = new Logger('Bootstrap')

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokens: SetupTokensService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get<string>('SUPERADMIN_EMAIL')?.trim().toLowerCase()

    if (!email) {
      // Not fatal in development, where the seed provides accounts. The
      // production boot guard in app.module refuses to start without it.
      this.log.warn(
        'No SUPERADMIN_EMAIL set — nobody can be given platform access on a fresh database.',
      )
      return
    }

    // Their password-holding profile, whatever role it currently has — this is
    // the row that gets promoted, not a secondary profile they added later.
    const existing = await this.prisma.user.findFirst({
      where: { email, passwordHash: { not: null } },
    })

    if (existing) {
      // Promote rather than complain: the address in the environment is the
      // operator by definition, and an operator locked out of their own platform
      // by a stale role is a worse outcome than a surprising promotion.
      if (existing.role !== 'superadmin') {
        await this.prisma.user.update({ where: { id: existing.id }, data: { role: 'superadmin' } })
        this.log.warn(`${email} promoted to superadmin.`)
      }

      if (!this.hasUsablePassword(existing.passwordHash)) {
        await this.announce(existing.id, email, 'has no password yet')
      }
      return
    }

    const created = await this.prisma.user.create({
      data: {
        name: 'Platform operator',
        email,
        // A placeholder rather than a real number. It is required by the schema
        // and is not used to log in — email is.
        phone: '0000000000',
        // Null, not a placeholder: the column is nullable precisely to mean
        // "no password chosen yet", and `login` already treats a null hash as
        // unmatchable by comparing against a dummy hash.
        passwordHash: null,
        role: 'superadmin',
        referralCode: 'PLATFORM',
        status: 'active',
      },
    })

    await this.announce(created.id, email, 'created')
  }

  /** A password nobody has set yet. */
  private hasUsablePassword(hash: string | null): boolean {
    return Boolean(hash)
  }

  private async announce(userId: string, email: string, what: string): Promise<void> {
    // Emailed first. The operator of a deployed platform should not have to read
    // container logs to get into it — on a hosted box those logs may be awkward
    // to reach, or rotated away before anybody looks.
    const { link, sent, reason } = await this.tokens.issueAndSend(userId, 'setup')

    if (sent) {
      this.log.warn(
        `Superadmin ${what}: ${email}. A one-time setup link has been emailed to them. ` +
          'It expires in 48 hours and stops working once used.',
      )
      return
    }

    // Mail did not go. The log is the fallback, and it is the right one: private
    // by default, and readable by exactly the person who deployed this.
    const line = '──────────────────────────────────────────────────────────────────'
    this.log.warn(
      [
        '',
        line,
        ` Superadmin ${what}: ${email}`,
        '',
        ` The email could NOT be sent: ${reason ?? 'unknown reason'}`,
        ' So the link is here instead. Open it once to set your password.',
        ' It expires in 48 hours and stops working as soon as it is used:',
        '',
        ` ${link}`,
        line,
        '',
      ].join('\n'),
    )
  }
}
