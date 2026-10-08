import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma, type BillingInterval, type DomainMode, type DomainRenewalMethod } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../finance/ledger.service'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'
import { VercelClient } from './vercel.client'

/**
 * Where an agent's domain stands, in the order it moves through:
 * waiting for approval, refused, setting up on hosting, ready but unpaid,
 * live, behind on a renewal, switched off for non-payment, suspended.
 */
export type DomainStage =
  | 'waiting'
  | 'refused'
  | 'setting_up'
  | 'payment_needed'
  | 'live'
  | 'grace'
  | 'lapsed'
  | 'suspended'

export interface MineView {
  domain: string
  mode: DomainMode
  stage: DomainStage
  allowed: boolean
  active: boolean
  suspended: boolean
  requestedAt: string
  reviewedAt: string | null
  reason: string | null
  billingInterval: BillingInterval
  /** Pesewas, per `billingInterval`, frozen at request time. */
  priceAmount: number
  paymentMethod: DomainRenewalMethod
  /** Plain words from the hosting check, while setting up. */
  hostingStatus: string | null
  nextRenewalAt: string | null
  /** Set while a renewal is unpaid and the domain is running on borrowed time. */
  graceEndsAt: string | null
}

export interface AdminDomainView extends MineView {
  id: string
  userId: string
  agentName: string
  agentCode: string
  /** The superadmin's share per cycle, frozen at request time. */
  costAmount: number
}

/** What a domain costs, for one (mode, interval) pair. */
export interface DomainPriceView {
  mode: DomainMode
  interval: BillingInterval
  /** The superadmin's share, pesewas. Only for an admin/superadmin caller. */
  costAmount?: number
  /** What an agent pays, pesewas. Always present. */
  priceAmount: number
}

/** Labels no agent can claim as their own subdomain. */
const RESERVED_LABELS = new Set([
  'www', 'app', 'api', 'admin', 'mail', 'ftp', 'ns1', 'ns2', 'root',
  'support', 'help', 'status', 'cdn', 'static', 'assets', 'blog',
  'dashboard', 'portal', 'shop', 'superadmin', 'test',
])

/** Letters/digits/hyphens, 2-63 characters, never starting or ending with a hyphen. */
const SUBDOMAIN_LABEL_PATTERN = /^(?!-)[a-z0-9-]{2,63}(?<!-)$/

/** How long a domain keeps serving after a renewal goes unpaid, before it is switched off. */
export const GRACE_PERIOD_DAYS: number = 5

type DomainRow = Prisma.CustomDomainGetPayload<object>

/**
 * Agents' shop addresses on the platform domain (`kofi.<root>`), and what
 * they pay for them.
 *
 * Subdomains only for now: a request for an agent's own domain is refused.
 * Every paid cycle is split two ways: the superadmin's share (`costAmount`,
 * frozen when the agent signed up) is credited to the superadmin's wallet,
 * the rest is the business's. The agent chose up front whether a cycle is
 * taken from their earnings automatically or paid by them through Paystack.
 *
 * A domain is only charged and made live once hosting actually serves it
 * (`readyAt`), never for time it sat waiting. `goLive` is the one path that
 * flips a domain live, whoever triggers it.
 */
@Injectable()
export class DomainsService {
  private readonly log = new Logger(DomainsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ledger: LedgerService,
    private readonly vercel: VercelClient,
  ) {}

  /**
   * A short-lived cache for `isTrustedOrigin`, keyed by hostname: that check
   * runs on every CORS preflight from every visitor to every agent domain.
   */
  private readonly originCache = new Map<string, { allowed: boolean; expiresAt: number }>()
  private static readonly ORIGIN_CACHE_TTL_MS = 60_000

  /** The root a platform subdomain is built on, e.g. `jkbkdatahub.com`. */
  private rootDomain(): string {
    const root = this.config.get<string>('PLATFORM_ROOT_DOMAIN')?.trim().toLowerCase()
    if (!root) {
      throw new ValidationError('Shop addresses are not set up on this server yet (PLATFORM_ROOT_DOMAIN is not configured).')
    }
    return root
  }

  /**
   * Ask for a subdomain, or change the one on file. One row per agent.
   * Re-submitting the same approved address only updates how it is paid;
   * anything else starts the review again from scratch.
   */
  async request(
    userId: string,
    input: { mode: DomainMode; label?: string; domain?: string; billingInterval: BillingInterval; paymentMethod?: DomainRenewalMethod },
  ): Promise<MineView> {
    if (input.mode !== 'subdomain') {
      throw new ValidationError('Your own domain is not available yet. Choose a shop address on our domain instead.')
    }
    const domain = this.composeSubdomain(input.label)
    const paymentMethod = input.paymentMethod ?? 'balance'
    const pricing = await this.prisma.domainPricing.findUnique({
      where: { mode_interval: { mode: input.mode, interval: input.billingInterval } },
    })
    const priceAmount = pricing?.priceAmount ?? 0
    const costAmount = Math.min(pricing?.costAmount ?? 0, priceAmount)

    const takenByOther = await this.prisma.customDomain.findUnique({ where: { domain } })
    if (takenByOther && takenByOther.userId !== userId) {
      throw new ConflictError('DOMAIN_TAKEN', 'That address is already taken by another agent.')
    }

    const mine = await this.prisma.customDomain.findUnique({ where: { userId } })
    if (mine && mine.domain === domain && mine.allowed && mine.billingInterval === input.billingInterval) {
      const row = await this.prisma.customDomain.update({ where: { id: mine.id }, data: { paymentMethod } })
      return toMineView(row)
    }

    let row: DomainRow
    try {
      row = await this.prisma.customDomain.upsert({
        where: { userId },
        create: { userId, domain, mode: input.mode, billingInterval: input.billingInterval, priceAmount, costAmount, paymentMethod },
        update: {
          domain,
          mode: input.mode,
          billingInterval: input.billingInterval,
          priceAmount,
          costAmount,
          paymentMethod,
          allowed: false,
          active: false,
          suspended: false,
          readyAt: null,
          hostingStatus: null,
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
        throw new ConflictError('DOMAIN_TAKEN', 'That address is already taken by another agent.')
      }
      throw error
    }
    // A changed address frees the old one on hosting.
    if (mine && mine.domain !== domain && mine.allowed) void this.detach(mine.domain)
    this.originCache.clear()
    return toMineView(row)
  }

  /** Switch between paying from earnings and paying through Paystack. */
  async setPaymentMethod(userId: string, paymentMethod: DomainRenewalMethod): Promise<MineView> {
    const row = await this.prisma.customDomain.findUnique({ where: { userId } })
    if (!row) throw new NotFoundError('You have no shop address on file.')
    const updated = await this.prisma.customDomain.update({ where: { id: row.id }, data: { paymentMethod } })
    return toMineView(updated)
  }

  private composeSubdomain(rawLabel: string | undefined): string {
    const label = (rawLabel ?? '').trim().toLowerCase()
    if (!SUBDOMAIN_LABEL_PATTERN.test(label)) {
      throw new ValidationError('Pick a name of letters, digits and hyphens, 2-63 characters, like "kwame".')
    }
    if (RESERVED_LABELS.has(label)) throw new ValidationError(`"${label}" is reserved, pick a different one.`)
    return `${label}.${this.rootDomain()}`
  }

  async mine(userId: string): Promise<MineView | null> {
    const row = await this.prisma.customDomain.findUnique({ where: { userId } })
    return row ? toMineView(row) : null
  }

  /** The agent gives up their address. It stops loading at once. */
  async remove(userId: string): Promise<void> {
    const row = await this.prisma.customDomain.findUnique({ where: { userId } })
    if (!row) throw new NotFoundError('You have no shop address on file.')
    await this.prisma.customDomain.delete({ where: { id: row.id } })
    this.originCache.clear()
    if (row.allowed) void this.detach(row.domain)
  }

  async list(pendingOnly: boolean): Promise<AdminDomainView[]> {
    const rows = await this.prisma.customDomain.findMany({
      where: pendingOnly ? { reviewedAt: null } : {},
      orderBy: { requestedAt: 'desc' },
      include: { user: { select: { name: true, referralCode: true } } },
    })
    return rows.map(toAdminView)
  }

  async pendingCount(): Promise<number> {
    return this.prisma.customDomain.count({ where: { reviewedAt: null } })
  }

  /**
   * The superadmin's decisions:
   *  - `allowed: true` approves: the address is added to hosting and goes
   *    live (and is charged) once hosting serves it;
   *  - `allowed: false` refuses or revokes: off hosting, offline;
   *  - `active: false` suspends: offline, and paying cannot bring it back;
   *  - `active: true` lifts a suspension, or confirms by hand that hosting
   *    serves it when hosting isn't automated, and puts it live. Never
   *    charges again for a period already paid.
   */
  async review(id: string, adminId: string, input: { allowed?: boolean; active?: boolean; reason?: string }): Promise<AdminDomainView> {
    if (input.allowed === undefined && input.active === undefined) {
      throw new ValidationError('Say what you are changing.')
    }
    const existing = await this.prisma.customDomain.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError('No domain request found.')

    if (input.allowed === false) {
      await this.prisma.customDomain.update({
        where: { id },
        data: {
          allowed: false,
          active: false,
          readyAt: null,
          hostingStatus: null,
          reviewedAt: new Date(),
          reviewedBy: adminId,
          reason: input.reason ?? existing.reason,
        },
      })
      this.originCache.clear()
      void this.detach(existing.domain)
    } else if (input.allowed === true) {
      await this.prisma.customDomain.update({
        where: { id },
        data: { allowed: true, suspended: false, reviewedAt: new Date(), reviewedBy: adminId, reason: null },
      })
      await this.attach(id)
    }

    if (input.active === false) {
      await this.prisma.customDomain.update({ where: { id }, data: { active: false, suspended: true } })
      this.originCache.clear()
    } else if (input.active === true) {
      const row = await this.prisma.customDomain.findUniqueOrThrow({ where: { id } })
      if (!row.allowed) throw new ConflictError('NOT_APPROVED', 'Approve this address first.')
      // Without hosting automation, "live" from the admin means they confirmed it serves.
      await this.prisma.customDomain.update({
        where: { id },
        data: { suspended: false, readyAt: row.readyAt ?? new Date(), hostingStatus: null },
      })
      await this.goLive(id)
    }

    const current = await this.prisma.customDomain.findUniqueOrThrow({
      where: { id },
      include: { user: { select: { name: true, referralCode: true } } },
    })
    return toAdminView(current)
  }

  /** Put an approved address on hosting. Best effort: the go-live check retries. */
  async attach(id: string): Promise<void> {
    const row = await this.prisma.customDomain.findUniqueOrThrow({ where: { id } })
    if (!this.vercel.configured) {
      await this.prisma.customDomain.update({
        where: { id },
        data: { hostingStatus: 'Add this address to the hosting project, then click Mark as live.' },
      })
      return
    }
    const added = await this.vercel.addDomain(row.domain)
    await this.prisma.customDomain.update({
      where: { id },
      data: { hostingStatus: added.ok ? 'Added to hosting, waiting for its security certificate.' : `Hosting: ${added.reason}` },
    })
  }

  /** Take an address off hosting. Best effort, never throws. */
  private async detach(domain: string): Promise<void> {
    if (!this.vercel.configured) return
    const removed = await this.vercel.removeDomain(domain)
    if (!removed.ok) this.log.warn(`could not remove ${domain} from hosting: ${removed.reason}`)
  }

  /**
   * The one way a domain goes live. Requires approval, no suspension, and
   * hosting serving it. A period already paid goes straight back live with
   * no new charge. Otherwise a free price, or an earnings payment that
   * covers it, starts the first period; a Paystack choice, or earnings that
   * fall short, leaves it ready and waiting for the agent to pay.
   */
  async goLive(id: string): Promise<'live' | 'payment_needed' | 'not_ready'> {
    const row = await this.prisma.customDomain.findUniqueOrThrow({ where: { id } })
    if (!row.allowed || row.suspended || !row.readyAt) return 'not_ready'
    if (row.active) return 'live'

    const paidThrough = row.nextRenewalAt && row.nextRenewalAt > new Date()
    if (paidThrough) {
      await this.activate(id)
      return 'live'
    }
    if (row.priceAmount <= 0 || row.paymentMethod === 'balance') {
      const charged = await this.chargeCycle(id)
      if (charged.ok) {
        await this.activate(id)
        return 'live'
      }
    }
    await this.prisma.customDomain.update({ where: { id }, data: { hostingStatus: null } })
    return 'payment_needed'
  }

  private async activate(id: string): Promise<void> {
    await this.prisma.customDomain.update({ where: { id }, data: { active: true, graceEndsAt: null, hostingStatus: null } })
    this.originCache.clear()
  }

  /**
   * Charge one cycle from the agent's earnings. Postgres decides whether the
   * balance covers it, so two attempts can't both pass. A shortfall is not
   * an error: it returns `ok: false` and the caller decides (grace for a
   * live domain, "payment needed" for one going live).
   */
  async chargeCycle(domainId: string): Promise<{ ok: boolean }> {
    const domain = await this.prisma.customDomain.findUniqueOrThrow({ where: { id: domainId } })
    const periodStart = new Date()
    const periodEnd = addInterval(periodStart, domain.billingInterval)

    return this.prisma.$transaction(async (tx) => {
      if (domain.priceAmount <= 0) {
        await tx.customDomain.update({ where: { id: domainId }, data: { nextRenewalAt: periodEnd, graceEndsAt: null } })
        await tx.domainRenewal.create({
          data: { domainId, amount: 0, method: 'balance', status: 'paid', periodStart, periodEnd, paidAt: periodStart },
        })
        return { ok: true }
      }

      const affected = await tx.$executeRaw`
        UPDATE users SET balance = balance - ${domain.priceAmount}
        WHERE id = ${domain.userId} AND balance >= ${domain.priceAmount}
      `
      if (affected === 0) {
        await tx.domainRenewal.create({
          data: { domainId, amount: domain.priceAmount, method: 'balance', status: 'failed', periodStart, periodEnd },
        })
        return { ok: false }
      }

      const after = await tx.user.findUniqueOrThrow({ where: { id: domain.userId }, select: { balance: true } })
      await tx.earning.create({
        data: {
          userId: domain.userId,
          type: 'domain_fee',
          amount: -domain.priceAmount,
          balanceAfter: after.balance,
          description: `Shop address · ${domain.domain} · ${domain.billingInterval}`,
          reference: `DOM-${domain.id.slice(0, 8).toUpperCase()}-${periodStart.getTime()}`,
          depth: 0,
        },
      })
      await tx.customDomain.update({ where: { id: domainId }, data: { nextRenewalAt: periodEnd, graceEndsAt: null } })
      const renewal = await tx.domainRenewal.create({
        data: {
          domainId,
          amount: domain.priceAmount,
          shareAmount: domain.costAmount,
          method: 'balance',
          status: 'paid',
          periodStart,
          periodEnd,
          paidAt: periodStart,
        },
      })
      await this.bookPaidCycle(tx, { renewalId: renewal.id, domain: domain.domain, agentId: domain.userId, revenue: domain.priceAmount, share: domain.costAmount, paystackFee: 0 })
      return { ok: true }
    })
  }

  /**
   * The money side of a paid cycle, shared by both payment methods: the
   * whole payment is revenue, the superadmin's share is credited to their
   * wallet and booked as the business's cost, and Paystack's own fee (if
   * paid that way) is booked too. Idempotent per renewal.
   */
  async bookPaidCycle(
    tx: Prisma.TransactionClient,
    input: { renewalId: string; domain: string; agentId: string; revenue: number; share: number; paystackFee: number },
  ): Promise<void> {
    const entries: Parameters<LedgerService['record']>[0] = [
      {
        idempotencyKey: LedgerService.key('domain_renewal', input.renewalId, 'revenue'),
        kind: 'revenue',
        amount: input.revenue,
        affectsProfit: true,
        description: `Shop address · ${input.domain}`,
        userId: input.agentId,
        occurredAt: new Date(),
      },
    ]
    if (input.paystackFee > 0) {
      entries.push({
        idempotencyKey: LedgerService.key('domain_renewal', input.renewalId, 'payment_fee'),
        kind: 'payment_fee',
        amount: -input.paystackFee,
        affectsProfit: true,
        description: `Paystack fee · shop address ${input.domain}`,
        occurredAt: new Date(),
      })
    }

    const superadmin =
      input.share > 0
        ? await tx.user.findFirst({ where: { role: 'superadmin', status: 'active' }, orderBy: { joinedAt: 'asc' }, select: { id: true } })
        : null
    if (superadmin && input.share > 0) {
      const after = await tx.user.update({
        where: { id: superadmin.id },
        data: { balance: { increment: input.share } },
        select: { balance: true },
      })
      await tx.earning.create({
        data: {
          userId: superadmin.id,
          type: 'domain_share',
          amount: input.share,
          balanceAfter: after.balance,
          description: `Share of shop address · ${input.domain}`,
          reference: `DSH-${input.renewalId.slice(0, 8).toUpperCase()}`,
          depth: 0,
        },
      })
      entries.push({
        idempotencyKey: LedgerService.key('domain_renewal', input.renewalId, 'superadmin_share'),
        kind: 'superadmin_share',
        amount: -input.share,
        affectsProfit: true,
        description: `Superadmin share · shop address ${input.domain}`,
        userId: superadmin.id,
        occurredAt: new Date(),
      })
    } else if (input.share > 0) {
      this.log.warn(`no active superadmin to credit the ${input.share}p share of ${input.domain}, kept by the business`)
    }
    await this.ledger.record(entries, tx)
  }

  /** The superadmin's balance, every share credited to it, and their own payouts. */
  async superadminWallet(userId: string) {
    const [user, shares, withdrawals, earned] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } }),
      this.prisma.earning.findMany({
        where: { userId, type: 'domain_share' },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, amount: true, description: true, createdAt: true },
      }),
      this.prisma.withdrawal.findMany({
        where: { userId },
        orderBy: { requestedAt: 'desc' },
        take: 50,
        select: { id: true, amount: true, transferFee: true, status: true, agentPhone: true, momoNetwork: true, requestedAt: true, paidAt: true },
      }),
      this.prisma.earning.aggregate({ where: { userId, type: 'domain_share' }, _sum: { amount: true } }),
    ])
    return {
      balance: user.balance,
      totalEarned: earned._sum.amount ?? 0,
      shares: shares.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
      withdrawals: withdrawals.map((w) => ({ ...w, requestedAt: w.requestedAt.toISOString(), paidAt: w.paidAt?.toISOString() ?? null })),
    }
  }

  async pricingList(includeCost: boolean): Promise<DomainPriceView[]> {
    const rows = await this.prisma.domainPricing.findMany()
    const byKey = new Map(rows.map((r) => [`${r.mode}:${r.interval}`, r]))
    const modes: DomainMode[] = includeCost ? ['subdomain', 'custom'] : ['subdomain']
    const intervals: BillingInterval[] = ['monthly', 'yearly']
    return modes.flatMap((mode) =>
      intervals.map((interval) => {
        const row = byKey.get(`${mode}:${interval}`)
        return { mode, interval, priceAmount: row?.priceAmount ?? 0, ...(includeCost ? { costAmount: row?.costAmount ?? 0 } : {}) }
      }),
    )
  }

  /** The superadmin's share per cycle. Never above the price agents pay. */
  async setCost(mode: DomainMode, interval: BillingInterval, costAmount: number): Promise<DomainPriceView[]> {
    if (!Number.isInteger(costAmount) || costAmount < 0) throw new ValidationError('A share is a whole number of pesewas, 0 or more.')
    const existing = await this.prisma.domainPricing.findUnique({ where: { mode_interval: { mode, interval } } })
    if (existing && existing.priceAmount > 0 && costAmount > existing.priceAmount) {
      throw new ValidationError(`That's more than agents pay (GHS ${(existing.priceAmount / 100).toFixed(2)}). Ask the admin to raise the price first.`)
    }
    await this.prisma.domainPricing.upsert({
      where: { mode_interval: { mode, interval } },
      create: { mode, interval, costAmount },
      update: { costAmount },
    })
    this.log.warn(`domain pricing ${mode}/${interval}: superadmin share set to ${costAmount}`)
    return this.pricingList(true)
  }

  /** What agents pay per cycle, admin only. Never below the superadmin's share. */
  async setPrice(mode: DomainMode, interval: BillingInterval, priceAmount: number): Promise<DomainPriceView[]> {
    if (!Number.isInteger(priceAmount) || priceAmount < 0) throw new ValidationError('A price is a whole number of pesewas, 0 or more.')
    const existing = await this.prisma.domainPricing.findUnique({ where: { mode_interval: { mode, interval } } })
    const cost = existing?.costAmount ?? 0
    if (priceAmount < cost) {
      throw new ValidationError(`That's below the superadmin's share, GHS ${(cost / 100).toFixed(2)}. Set a price at or above it.`)
    }
    await this.prisma.domainPricing.upsert({
      where: { mode_interval: { mode, interval } },
      create: { mode, interval, priceAmount },
      update: { priceAmount },
    })
    this.log.warn(`domain pricing ${mode}/${interval}: price set to ${priceAmount}`)
    return this.pricingList(true)
  }

  /**
   * The endpoint a browser calls to find whose shop an address is. Approved,
   * live, not suspended, and the agent still active.
   */
  async resolve(rawHost: string): Promise<string | null> {
    const domain = normalizeDomain(rawHost)
    const row = await this.prisma.customDomain.findUnique({
      where: { domain },
      select: { allowed: true, active: true, suspended: true, user: { select: { referralCode: true, role: true, status: true } } },
    })
    if (!row || !row.allowed || !row.active || row.suspended) return null
    if (row.user.role !== 'agent' || row.user.status !== 'active') return null
    return row.user.referralCode
  }

  /** Whether a browser `Origin` is trusted for CORS: the same question as `resolve`, cached. */
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

export function stageOf(row: DomainRow): DomainStage {
  if (row.suspended) return 'suspended'
  if (!row.reviewedAt) return 'waiting'
  if (!row.allowed) return 'refused'
  if (row.active) return row.graceEndsAt ? 'grace' : 'live'
  if (!row.readyAt) return 'setting_up'
  // Ready, not live: never paid yet, or switched off after an unpaid renewal.
  return row.nextRenewalAt ? 'lapsed' : 'payment_needed'
}

function toMineView(row: DomainRow): MineView {
  return {
    domain: row.domain,
    mode: row.mode,
    stage: stageOf(row),
    allowed: row.allowed,
    active: row.active,
    suspended: row.suspended,
    requestedAt: row.requestedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reason: row.reason,
    billingInterval: row.billingInterval,
    priceAmount: row.priceAmount,
    paymentMethod: row.paymentMethod,
    hostingStatus: row.hostingStatus,
    nextRenewalAt: row.nextRenewalAt?.toISOString() ?? null,
    graceEndsAt: row.graceEndsAt?.toISOString() ?? null,
  }
}

function toAdminView(row: DomainRow & { user: { name: string; referralCode: string } }): AdminDomainView {
  return { ...toMineView(row), id: row.id, userId: row.userId, agentName: row.user.name, agentCode: row.user.referralCode, costAmount: row.costAmount }
}

/** Lower-cased, trimmed, and stripped of a port. */
function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}

/** A billing cycle's length from its start, calendar-aware. */
export function addInterval(from: Date, interval: BillingInterval): Date {
  const next = new Date(from)
  if (interval === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1)
  else next.setUTCFullYear(next.getUTCFullYear() + 1)
  return next
}
