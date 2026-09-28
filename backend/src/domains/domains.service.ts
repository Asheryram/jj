import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma, type BillingInterval, type DomainMode } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../finance/ledger.service'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'

export interface MineView {
  domain: string
  mode: DomainMode
  allowed: boolean
  active: boolean
  requestedAt: string
  reviewedAt: string | null
  reason: string | null
  billingInterval: BillingInterval
  /** Pesewas, per `billingInterval`, frozen at request/last-renewal time. */
  priceAmount: number
  nextRenewalAt: string | null
  /** Set while a renewal charge has failed and this is running on borrowed time. */
  graceEndsAt: string | null
}

export interface AdminDomainView extends MineView {
  id: string
  userId: string
  agentName: string
  agentCode: string
}

/** What a domain costs, for one (mode, interval) pair. */
export interface DomainPriceView {
  mode: DomainMode
  interval: BillingInterval
  /**
   * Asher's own wholesale cost, pesewas. Present only for an admin/superadmin
   * caller, the same "hidden from agents" treatment `supplierCost` gets on a
   * catalogue product, see `toPublicProduct`.
   */
  costAmount?: number
  /** What an agent actually pays, pesewas. Always present. */
  priceAmount: number
}

/** Labels no agent can claim as their own subdomain. */
const RESERVED_LABELS = new Set([
  'www', 'app', 'api', 'admin', 'mail', 'ftp', 'ns1', 'ns2', 'root',
  'support', 'help', 'status', 'cdn', 'static', 'assets', 'blog',
  'dashboard', 'portal', 'shop', 'superadmin', 'test',
])

/** A label for a platform subdomain: letters/digits/hyphens, 2-63 characters, never starting or ending with a hyphen. */
const SUBDOMAIN_LABEL_PATTERN = /^(?!-)[a-z0-9-]{2,63}(?<!-)$/

/**
 * An agent's own domain, pointed at their `/s/<code>` shop, see the
 * `CustomDomain` model for why `allowed` and `active` are kept separate.
 */
/** How long a domain keeps serving after a renewal charge fails, before `DomainRenewalsService` deactivates it. */
export const GRACE_PERIOD_DAYS: number = 5

@Injectable()
export class DomainsService {
  private readonly log = new Logger(DomainsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * A short-lived cache for `isTrustedOrigin`, keyed by hostname.
   *
   * That check runs on every CORS preflight from every visitor to every
   * custom domain, a busy shop can generate one per request. A minute of
   * staleness (a just-revoked domain staying "trusted" a little longer) is a
   * far better trade than a Postgres round trip on every single OPTIONS
   * request. Deliberately in-memory and per-instance: this is a courtesy
   * cache, not a source of truth, so it does not need to survive a restart
   * or agree across replicas.
   */
  private readonly originCache = new Map<string, { allowed: boolean; expiresAt: number }>()
  private static readonly ORIGIN_CACHE_TTL_MS = 60_000

  /** The wildcard root a platform subdomain is composed against, e.g. `jkbkdatahub.com`. */
  private rootDomain(): string {
    const root = this.config.get<string>('PLATFORM_ROOT_DOMAIN')?.trim().toLowerCase()
    if (!root) {
      throw new ValidationError(
        'Subdomains are not set up on this server yet (PLATFORM_ROOT_DOMAIN is not configured).',
      )
    }
    return root
  }

  /**
   * Propose a domain, or change the one already on file. Billed exactly the
   * same way whichever `mode` this is, see `CustomDomain.mode`'s own doc
   * comment for why: only how the domain string is built and reviewed
   * actually differs.
   *
   * One row per agent (`userId` is unique), so this is an upsert, not a plain
   * create. Re-submitting the exact domain that is already `allowed` is a
   * no-op, resetting it to pending on every duplicate click would suspend a
   * live shop for no reason. Anything else (a new domain, or resubmitting one
   * that was refused or never reviewed) resets the review from scratch: an
   * approval only ever covers the exact string it was granted for, and a mode
   * or billing-interval change on an already-live domain is exactly that,
   * a new domain, whatever renewal history the old row had stops applying.
   */
  async request(
    userId: string,
    input: { mode: DomainMode; label?: string; domain?: string; billingInterval: BillingInterval },
  ): Promise<MineView> {
    const domain =
      input.mode === 'subdomain'
        ? this.composeSubdomain(input.label)
        : normalizeDomain(input.domain ?? '')

    if (input.mode === 'custom' && !domain) {
      throw new ValidationError('Enter a valid domain, like blayshop.com.')
    }

    const price = await this.priceFor(input.mode, input.billingInterval)

    const takenByOther = await this.prisma.customDomain.findUnique({ where: { domain } })
    if (takenByOther && takenByOther.userId !== userId) {
      throw new ConflictError('DOMAIN_TAKEN', 'That domain is already registered to another account.')
    }

    const mine = await this.prisma.customDomain.findUnique({ where: { userId } })
    if (mine && mine.domain === domain && mine.allowed) {
      return toMineView(mine)
    }

    // The `findUnique` above proves nothing about what is still true by the
    // time this write runs: two agents submitting the same domain within the
    // same instant can both pass that check before either commits. The `domain`
    // column's own unique constraint is the real guard; a P2002 here means we
    // lost that race, not that something is broken, so it is remapped to the
    // same friendly conflict the earlier check throws, rather than let a raw
    // constraint violation reach the client.
    let row
    try {
      row = await this.prisma.customDomain.upsert({
        where: { userId },
        create: {
          userId,
          domain,
          mode: input.mode,
          billingInterval: input.billingInterval,
          priceAmount: price.priceAmount,
        },
        update: {
          domain,
          mode: input.mode,
          billingInterval: input.billingInterval,
          priceAmount: price.priceAmount,
          allowed: false,
          active: false,
          requestedAt: new Date(),
          reviewedAt: null,
          reviewedBy: null,
          reason: null,
          nextRenewalAt: null,
          graceEndsAt: null,
        },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('DOMAIN_TAKEN', 'That domain is already registered to another account.')
      }
      throw error
    }
    return toMineView(row)
  }

  /** Builds and validates `<label>.<PLATFORM_ROOT_DOMAIN>`, rejecting a reserved or malformed label before it reaches the database. */
  private composeSubdomain(rawLabel: string | undefined): string {
    const label = (rawLabel ?? '').trim().toLowerCase()
    if (!SUBDOMAIN_LABEL_PATTERN.test(label)) {
      throw new ValidationError('Pick a label of letters, digits and hyphens, 2-63 characters, like "kwame".')
    }
    if (RESERVED_LABELS.has(label)) {
      throw new ValidationError(`"${label}" is reserved, pick a different one.`)
    }
    return `${label}.${this.rootDomain()}`
  }

  async mine(userId: string): Promise<MineView | null> {
    const row = await this.prisma.customDomain.findUnique({ where: { userId } })
    return row ? toMineView(row) : null
  }

  /**
   * Drop the agent's own domain, live or not, and go back to the plain
   * `/s/<code>` link.
   *
   * The only self-service option before this was "submit a different domain",
   * which still leaves the old one on file mid-transition. A hard delete
   * rather than a status flag: nothing downstream (ledgers, orders) points at
   * a `CustomDomain` row, so there is no history here worth keeping, and
   * `resolve()` stops answering for it the instant the row is gone.
   */
  async remove(userId: string): Promise<void> {
    const deleted = await this.prisma.customDomain.deleteMany({ where: { userId } })
    if (deleted.count === 0) throw new NotFoundError('You have no domain on file.')
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

  /** How many requests are sitting unreviewed, the superadmin's nav badge. */
  async pendingCount(): Promise<number> {
    return this.prisma.customDomain.count({ where: { reviewedAt: null } })
  }

  /**
   * Approve, refuse or suspend, whichever of `allowed`/`active` is present.
   *
   * Refusing (`allowed: false`) also takes the domain offline: an approval
   * that was just revoked has no business still serving traffic, even though
   * the public resolve endpoint's own `allowed && active` check would already
   * catch it, this keeps the record itself from claiming something false.
   * Approving does NOT also flip `active` on, DNS still has to be confirmed
   * before it actually serves anything.
   *
   * Billing starts the instant `active` first turns true, not on `allowed`,
   * an agent should not be charged for time a domain sat waiting on DNS
   * before it ever actually served a single visitor. The first cycle is
   * charged immediately, right here, not left for the next `DomainRenewalsService`
   * sweep, the same as any other subscription starting the moment it does.
   */
  async review(
    id: string,
    adminId: string,
    input: { allowed?: boolean; active?: boolean; reason?: string },
  ): Promise<AdminDomainView> {
    if (input.allowed === undefined && input.active === undefined) {
      throw new ValidationError('Say what you are changing, allowed, active, or both.')
    }

    const existing = await this.prisma.customDomain.findUnique({
      where: { id },
      include: { user: { select: { name: true, referralCode: true } } },
    })
    if (!existing) throw new NotFoundError('No domain request found.')

    // Refusing forces active off regardless of what `input.active` also
    // asked for in the same call, same as before; otherwise an explicit
    // `active` wins, and failing that, whatever it already was.
    const nextActive = input.allowed === false ? false : (input.active ?? existing.active)
    const willFirstActivate = !existing.active && nextActive

    const row = await this.prisma.customDomain.update({
      where: { id },
      data: {
        active: nextActive,
        ...(input.allowed !== undefined
          ? {
              allowed: input.allowed,
              reviewedAt: new Date(),
              reviewedBy: adminId,
              reason: input.allowed ? null : (input.reason ?? existing.reason),
            }
          : {}),
      },
      include: { user: { select: { name: true, referralCode: true } } },
    })

    if (willFirstActivate) await this.chargeCycle(row.id)

    const current = willFirstActivate
      ? await this.prisma.customDomain.findUniqueOrThrow({
          where: { id },
          include: { user: { select: { name: true, referralCode: true } } },
        })
      : row

    return {
      ...toMineView(current),
      id: current.id,
      userId: current.userId,
      agentName: current.user.name,
      agentCode: current.user.referralCode,
    }
  }

  /**
   * Charge one billing cycle, balance only, no Paystack fallback here, that
   * is a deliberate choice the agent makes themselves from `renewalStatus`
   * once they are actually in grace (see `DomainRenewalsService.payByPaystack`).
   * Called both for a domain's first activation and for its ordinary
   * recurring renewals, one place, one behaviour either way.
   *
   * Same conditional-update discipline as every other balance debit in this
   * codebase: Postgres decides whether the balance covers it, not a stale
   * read, so two concurrent charge attempts against the same agent cannot
   * both pass. Failure is not an error here, it is the grace-period path,
   * the caller reads `ok` rather than catching anything.
   */
  async chargeCycle(domainId: string): Promise<{ ok: boolean }> {
    const domain = await this.prisma.customDomain.findUniqueOrThrow({ where: { id: domainId } })
    const periodStart = new Date()
    const periodEnd = addInterval(periodStart, domain.billingInterval)

    return this.prisma.$transaction(async (tx) => {
      if (domain.priceAmount <= 0) {
        // Free (no price configured, or an admin zeroed it out deliberately),
        // nothing to charge, just roll the period forward.
        await tx.customDomain.update({
          where: { id: domainId },
          data: { nextRenewalAt: periodEnd, graceEndsAt: null },
        })
        await tx.domainRenewal.create({
          data: {
            domainId,
            amount: 0,
            method: 'balance',
            status: 'paid',
            periodStart,
            periodEnd,
            paidAt: periodStart,
          },
        })
        return { ok: true }
      }

      const affected = await tx.$executeRaw`
        UPDATE users SET balance = balance - ${domain.priceAmount}
        WHERE id = ${domain.userId} AND balance >= ${domain.priceAmount}
      `

      if (affected === 0) {
        await tx.domainRenewal.create({
          data: {
            domainId,
            amount: domain.priceAmount,
            method: 'balance',
            status: 'failed',
            periodStart,
            periodEnd,
          },
        })
        // Grace only starts counting from the first failure, a domain
        // already in grace that fails again keeps the original deadline,
        // not a fresh five days every time it's retried and fails once more.
        if (!domain.graceEndsAt) {
          await tx.customDomain.update({
            where: { id: domainId },
            data: { graceEndsAt: new Date(Date.now() + GRACE_PERIOD_DAYS * 86_400_000) },
          })
        }
        return { ok: false }
      }

      const after = await tx.user.findUniqueOrThrow({
        where: { id: domain.userId },
        select: { balance: true },
      })
      await tx.earning.create({
        data: {
          userId: domain.userId,
          type: 'domain_fee',
          amount: -domain.priceAmount,
          balanceAfter: after.balance,
          description: `Domain renewal · ${domain.domain} · ${domain.billingInterval}`,
          reference: `DOM-${domain.id.slice(0, 8).toUpperCase()}-${periodStart.getTime()}`,
          depth: 0,
        },
      })
      await tx.customDomain.update({
        where: { id: domainId },
        data: { nextRenewalAt: periodEnd, graceEndsAt: null },
      })
      const renewal = await tx.domainRenewal.create({
        data: {
          domainId,
          amount: domain.priceAmount,
          method: 'balance',
          status: 'paid',
          periodStart,
          periodEnd,
          paidAt: periodStart,
        },
      })
      // Real revenue, the agent paying to keep serving from this domain,
      // not a cost or a pass-through the way `Withdrawal`'s own payout_fee is.
      await this.ledger.record(
        [
          {
            idempotencyKey: LedgerService.key('domain_renewal', renewal.id, 'revenue'),
            kind: 'revenue',
            amount: domain.priceAmount,
            affectsProfit: true,
            description: `Domain renewal · ${domain.domain}`,
            userId: domain.userId,
            occurredAt: periodStart,
          },
        ],
        tx,
      )
      return { ok: true }
    })
  }

  /** Every (mode, interval) price, `includeCost` only for an admin/superadmin caller, see `DomainPriceView.costAmount`. */
  async pricingList(includeCost: boolean): Promise<DomainPriceView[]> {
    const rows = await this.prisma.domainPricing.findMany()
    const byKey = new Map(rows.map((r) => [`${r.mode}:${r.interval}`, r]))
    const modes: DomainMode[] = ['subdomain', 'custom']
    const intervals: BillingInterval[] = ['monthly', 'yearly']

    return modes.flatMap((mode) =>
      intervals.map((interval) => {
        const row = byKey.get(`${mode}:${interval}`)
        return {
          mode,
          interval,
          priceAmount: row?.priceAmount ?? 0,
          ...(includeCost ? { costAmount: row?.costAmount ?? 0 } : {}),
        }
      }),
    )
  }

  /** Asher's own cost, superadmin only, enforced by the controller's `@Roles`. */
  async setCost(mode: DomainMode, interval: BillingInterval, costAmount: number): Promise<DomainPriceView[]> {
    if (!Number.isInteger(costAmount) || costAmount < 0) {
      throw new ValidationError('A cost is a whole number of pesewas, 0 or more.')
    }
    await this.prisma.domainPricing.upsert({
      where: { mode_interval: { mode, interval } },
      create: { mode, interval, costAmount },
      update: { costAmount },
    })
    this.log.warn(`domain pricing ${mode}/${interval}: cost set to ${costAmount}`)
    return this.pricingList(true)
  }

  /**
   * James's own retail price, admin only. Never below `costAmount`, the same
   * `sale_price = supplier_cost + margin` invariant `domain/pricing.ts`
   * enforces for a catalogue product, applied here to what an agent pays
   * per billing cycle instead of per sale.
   */
  async setPrice(mode: DomainMode, interval: BillingInterval, priceAmount: number): Promise<DomainPriceView[]> {
    if (!Number.isInteger(priceAmount) || priceAmount < 0) {
      throw new ValidationError('A price is a whole number of pesewas, 0 or more.')
    }
    const existing = await this.prisma.domainPricing.findUnique({ where: { mode_interval: { mode, interval } } })
    const cost = existing?.costAmount ?? 0
    if (priceAmount < cost) {
      throw new ValidationError(
        `That's below Asher's own cost for this, GHS ${(cost / 100).toFixed(2)}. Ask him to lower it first, or set a price at or above it.`,
      )
    }
    await this.prisma.domainPricing.upsert({
      where: { mode_interval: { mode, interval } },
      create: { mode, interval, priceAmount },
      update: { priceAmount },
    })
    this.log.warn(`domain pricing ${mode}/${interval}: price set to ${priceAmount}`)
    return this.pricingList(true)
  }

  /** `priceFor` reads the same table `pricingList` does, just one row, for `request()`'s own snapshot. */
  private async priceFor(mode: DomainMode, interval: BillingInterval): Promise<{ priceAmount: number }> {
    const row = await this.prisma.domainPricing.findUnique({ where: { mode_interval: { mode, interval } } })
    return { priceAmount: row?.priceAmount ?? 0 }
  }

  /**
   * The only endpoint a browser actually calls. Both flags must be true, a
   * domain that is approved but not yet DNS-confirmed must not resolve, and
   * neither should one an admin suspended.
   *
   * Also requires the agent themselves still be active, mirroring
   * `CatalogueService.seller()`, a suspended agent's shop link stops selling
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
   * Whether a browser `Origin` should be trusted for CORS, exactly the same
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
  mode: DomainMode
  allowed: boolean
  active: boolean
  requestedAt: Date
  reviewedAt: Date | null
  reason: string | null
  billingInterval: BillingInterval
  priceAmount: number
  nextRenewalAt: Date | null
  graceEndsAt: Date | null
}): MineView {
  return {
    domain: row.domain,
    mode: row.mode,
    allowed: row.allowed,
    active: row.active,
    requestedAt: row.requestedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reason: row.reason,
    billingInterval: row.billingInterval,
    priceAmount: row.priceAmount,
    nextRenewalAt: row.nextRenewalAt?.toISOString() ?? null,
    graceEndsAt: row.graceEndsAt?.toISOString() ?? null,
  }
}

/** Lower-cased, trimmed, and stripped of a port, a Host header can carry one. */
function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}

/** A billing cycle's length from its start, calendar-aware (a month is not always 30 days). */
export function addInterval(from: Date, interval: BillingInterval): Date {
  const next = new Date(from)
  if (interval === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1)
  else next.setUTCFullYear(next.getUTCFullYear() + 1)
  return next
}
