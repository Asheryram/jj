import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'

export interface MineView {
  domain: string
  allowed: boolean
  active: boolean
  requestedAt: string
  reviewedAt: string | null
  reason: string | null
}

export interface AdminDomainView extends MineView {
  id: string
  userId: string
  agentName: string
  agentCode: string
}

/**
 * An agent's own domain, pointed at their `/s/<code>` shop — see the
 * `CustomDomain` model for why `allowed` and `active` are kept separate.
 */
@Injectable()
export class DomainsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A short-lived cache for `isTrustedOrigin`, keyed by hostname.
   *
   * That check runs on every CORS preflight from every visitor to every
   * custom domain — a busy shop can generate one per request. A minute of
   * staleness (a just-revoked domain staying "trusted" a little longer) is a
   * far better trade than a Postgres round trip on every single OPTIONS
   * request. Deliberately in-memory and per-instance: this is a courtesy
   * cache, not a source of truth, so it does not need to survive a restart
   * or agree across replicas.
   */
  private readonly originCache = new Map<string, { allowed: boolean; expiresAt: number }>()
  private static readonly ORIGIN_CACHE_TTL_MS = 60_000

  /**
   * Propose a domain, or change the one already on file.
   *
   * One row per agent (`userId` is unique), so this is an upsert, not a plain
   * create. Re-submitting the exact domain that is already `allowed` is a
   * no-op — resetting it to pending on every duplicate click would suspend a
   * live shop for no reason. Anything else (a new domain, or resubmitting one
   * that was refused or never reviewed) resets the review from scratch: an
   * approval only ever covers the exact string it was granted for.
   */
  async request(userId: string, rawDomain: string): Promise<MineView> {
    const domain = normalizeDomain(rawDomain)

    const takenByOther = await this.prisma.customDomain.findUnique({ where: { domain } })
    if (takenByOther && takenByOther.userId !== userId) {
      throw new ConflictError('DOMAIN_TAKEN', 'That domain is already registered to another account.')
    }

    const mine = await this.prisma.customDomain.findUnique({ where: { userId } })
    if (mine && mine.domain === domain && mine.allowed) {
      return toMineView(mine)
    }

    const row = await this.prisma.customDomain.upsert({
      where: { userId },
      create: { userId, domain },
      update: {
        domain,
        allowed: false,
        active: false,
        requestedAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
        reason: null,
      },
    })
    return toMineView(row)
  }

  async mine(userId: string): Promise<MineView | null> {
    const row = await this.prisma.customDomain.findUnique({ where: { userId } })
    return row ? toMineView(row) : null
  }

  /** The superadmin's review queue. `pending` means never yet decided. */
  async list(pendingOnly: boolean): Promise<AdminDomainView[]> {
    const rows = await this.prisma.customDomain.findMany({
      where: pendingOnly ? { reviewedAt: null } : {},
      orderBy: { requestedAt: 'desc' },
      include: { user: { select: { name: true, referralCode: true } } },
    })
    return rows.map((row) => ({
      ...toMineView(row),
      id: row.id,
      userId: row.userId,
      agentName: row.user.name,
      agentCode: row.user.referralCode,
    }))
  }

  /**
   * Approve, refuse or suspend — whichever of `allowed`/`active` is present.
   *
   * Refusing (`allowed: false`) also takes the domain offline: an approval
   * that was just revoked has no business still serving traffic, even though
   * the public resolve endpoint's own `allowed && active` check would already
   * catch it — this keeps the record itself from claiming something false.
   * Approving does NOT also flip `active` on — DNS still has to be confirmed
   * before it actually serves anything.
   */
  async review(
    id: string,
    adminId: string,
    input: { allowed?: boolean; active?: boolean; reason?: string },
  ): Promise<AdminDomainView> {
    if (input.allowed === undefined && input.active === undefined) {
      throw new ValidationError('Say what you are changing — allowed, active, or both.')
    }

    const existing = await this.prisma.customDomain.findUnique({
      where: { id },
      include: { user: { select: { name: true, referralCode: true } } },
    })
    if (!existing) throw new NotFoundError('No domain request found.')

    const row = await this.prisma.customDomain.update({
      where: { id },
      data: {
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.allowed !== undefined
          ? {
              allowed: input.allowed,
              active: input.allowed ? existing.active : false,
              reviewedAt: new Date(),
              reviewedBy: adminId,
              reason: input.allowed ? null : (input.reason ?? existing.reason),
            }
          : {}),
      },
      include: { user: { select: { name: true, referralCode: true } } },
    })

    return {
      ...toMineView(row),
      id: row.id,
      userId: row.userId,
      agentName: row.user.name,
      agentCode: row.user.referralCode,
    }
  }

  /**
   * The only endpoint a browser actually calls. Both flags must be true — a
   * domain that is approved but not yet DNS-confirmed must not resolve, and
   * neither should one an admin suspended.
   *
   * Also requires the agent themselves still be active, mirroring
   * `CatalogueService.seller()` — a suspended agent's shop link stops selling
   * everywhere else, and their custom domain is not a back door around that.
   */
  async resolve(rawHost: string): Promise<string | null> {
    const domain = normalizeDomain(rawHost)
    const row = await this.prisma.customDomain.findUnique({
      where: { domain },
      select: {
        allowed: true,
        active: true,
        user: { select: { referralCode: true, role: true, status: true } },
      },
    })

    if (!row || !row.allowed || !row.active) return null
    if (row.user.role !== 'agent' || row.user.status !== 'active') return null
    return row.user.referralCode
  }

  /**
   * Whether a browser `Origin` should be trusted for CORS — exactly the same
   * question `resolve` answers, reused rather than duplicated, just cached
   * because of how often this specific caller asks it. See `originCache`.
   */
  async isTrustedOrigin(hostname: string): Promise<boolean> {
    const domain = normalizeDomain(hostname)
    const cached = this.originCache.get(domain)
    const now = Date.now()
    if (cached && cached.expiresAt > now) return cached.allowed

    const allowed = (await this.resolve(domain)) !== null
    this.originCache.set(domain, { allowed, expiresAt: now + DomainsService.ORIGIN_CACHE_TTL_MS })
    return allowed
  }
}

function toMineView(row: {
  domain: string
  allowed: boolean
  active: boolean
  requestedAt: Date
  reviewedAt: Date | null
  reason: string | null
}): MineView {
  return {
    domain: row.domain,
    allowed: row.allowed,
    active: row.active,
    requestedAt: row.requestedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reason: row.reason,
  }
}

/** Lower-cased, trimmed, and stripped of a port — a Host header can carry one. */
function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}
