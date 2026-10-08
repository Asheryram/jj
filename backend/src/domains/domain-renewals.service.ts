import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { PaystackClient } from '../payments/paystack.client'
import { MailerService } from '../mail/mailer.service'
import { escape, wrap } from '../mail/templates'
import { appUrl } from '../common/app-links'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'
import { SettingsService } from '../settings/settings.service'
import { DomainsService, GRACE_PERIOD_DAYS, addInterval } from './domains.service'
import { VercelClient } from './vercel.client'

/** Renewals due, grace run out, Paystack payments left unconfirmed. */
const SWEEP_INTERVAL_MS = 60 * 60_000
/**
 * Approved addresses waiting on hosting. Same cadence as the order
 * reconciler, so the database can still sleep between checks; an approval
 * also schedules a few quick checks of its own (see `soon`).
 */
const GO_LIVE_INTERVAL_MS = 10 * 60_000
const HTTPS_CHECK_TIMEOUT_MS = 10_000
/** How long a Paystack domain payment is chased in the background after it starts. */
const PAYSTACK_WATCH_MS = 30 * 60_000
const PAYSTACK_WATCH_TICK_MS = 15_000

/**
 * Keeps agents' shop addresses paid and live.
 *
 *  - Go-live: an approved address is checked on hosting until it serves the
 *    shop over HTTPS, then `DomainsService.goLive` charges and switches it on.
 *  - Renewals: when a period ends, earnings-paying agents are charged
 *    automatically; Paystack-paying agents are asked to pay. Either way an
 *    unpaid renewal gets GRACE_PERIOD_DAYS before the address switches off.
 *  - Paystack: the agent can always pay through Paystack themselves; the
 *    payment is confirmed in the background, never only by the return page.
 */
@Injectable()
export class DomainRenewalsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(DomainRenewalsService.name)
  private timer: NodeJS.Timeout | null = null
  private goLiveTimer: NodeJS.Timeout | null = null
  private readonly watching = new Map<string, number>()
  private watchTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly domains: DomainsService,
    private readonly paystack: PaystackClient,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly vercel: VercelClient,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweep().catch((e) => this.log.error(`domain sweep failed: ${String(e)}`)), SWEEP_INTERVAL_MS)
    this.timer.unref?.()
    this.goLiveTimer = setInterval(
      () => void this.checkPendingGoLive().catch((e) => this.log.error(`go-live check failed: ${String(e)}`)),
      GO_LIVE_INTERVAL_MS,
    )
    this.goLiveTimer.unref?.()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.goLiveTimer) clearInterval(this.goLiveTimer)
    if (this.watchTimer) clearInterval(this.watchTimer)
  }

  /** A few quick go-live checks right after an approval, instead of waiting for the next round. */
  soon(): void {
    for (const delay of [20_000, 60_000, 180_000, 420_000]) {
      setTimeout(() => void this.checkPendingGoLive().catch(() => undefined), delay).unref?.()
    }
  }

  // ─── Go-live ────────────────────────────────────────────────────────────────

  async checkPendingGoLive(): Promise<void> {
    const pending = await this.prisma.customDomain.findMany({ where: { allowed: true, active: false, suspended: false } })
    for (const row of pending) {
      try {
        if (!row.readyAt) {
          const ready = await this.hostingReady(row.domain)
          if (!ready.ok) {
            if (ready.reason !== row.hostingStatus) {
              await this.prisma.customDomain.update({ where: { id: row.id }, data: { hostingStatus: ready.reason } })
            }
            continue
          }
          await this.prisma.customDomain.update({ where: { id: row.id }, data: { readyAt: new Date(), hostingStatus: null } })
        }
        // Ready but never paid, or switched off unpaid: only an earnings
        // payer is charged automatically here, and only before the first period.
        if (!row.nextRenewalAt) {
          const outcome = await this.domains.goLive(row.id)
          if (outcome === 'live') this.log.log(`${row.domain} is live`)
        }
      } catch (error) {
        this.log.error(`go-live for ${row.domain} failed: ${String(error)}`)
      }
    }
  }

  /** Hosting has it (when automated) and it answers over HTTPS. */
  private async hostingReady(domain: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (this.vercel.configured) {
      const check = await this.vercel.check(domain)
      if (check.kind === 'error' && /not added/i.test(check.reason)) {
        await this.vercel.addDomain(domain)
        return { ok: false, reason: 'Added to hosting, waiting for its security certificate.' }
      }
      if (check.kind !== 'ready') return { ok: false, reason: check.reason }
    }
    try {
      const response = await fetch(`https://${domain}/`, { redirect: 'follow', signal: AbortSignal.timeout(HTTPS_CHECK_TIMEOUT_MS) })
      if (response.ok) return { ok: true }
      return { ok: false, reason: `Not serving yet (HTTP ${response.status}).` }
    } catch {
      return {
        ok: false,
        reason: this.vercel.configured ? 'Waiting for its security certificate.' : 'Add this address to the hosting project, then click Mark as live.',
      }
    }
  }

  // ─── Renewals ───────────────────────────────────────────────────────────────

  async sweep(): Promise<void> {
    const due = await this.prisma.customDomain.findMany({
      where: { active: true, suspended: false, graceEndsAt: null, nextRenewalAt: { lte: new Date() } },
      include: { user: { select: { name: true, email: true } } },
    })
    for (const row of due) {
      if (row.paymentMethod === 'balance' || row.priceAmount <= 0) {
        const result = await this.domains.chargeCycle(row.id)
        if (result.ok) continue
      }
      await this.prisma.customDomain.update({
        where: { id: row.id },
        data: { graceEndsAt: new Date(Date.now() + GRACE_PERIOD_DAYS * 86_400_000) },
      })
      this.log.warn(`${row.domain} renewal unpaid, ${GRACE_PERIOD_DAYS} days of grace`)
      await this.alertGrace(row.domain, row.user.name, row.user.email, row.paymentMethod === 'paystack', row.priceAmount)
    }

    const expired = await this.prisma.customDomain.findMany({
      where: { active: true, graceEndsAt: { lte: new Date() } },
      include: { user: { select: { name: true, email: true } } },
    })
    for (const row of expired) {
      await this.prisma.customDomain.update({ where: { id: row.id }, data: { active: false, graceEndsAt: null } })
      this.log.warn(`${row.domain} switched off, renewal unpaid past grace`)
      await this.alertDeactivated(row.domain, row.user.name, row.user.email)
    }

    // Paystack payments nobody came back to confirm.
    const pendingPaystack = await this.prisma.domainRenewal.findMany({
      where: { status: 'pending', method: 'paystack', paystackReference: { not: null }, createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) } },
      select: { paystackReference: true },
    })
    for (const r of pendingPaystack) {
      await this.confirmPaystackPayment(r.paystackReference as string).catch(() => undefined)
    }
  }

  // ─── Paying ─────────────────────────────────────────────────────────────────

  /** A domain the agent can pay for right now: approved, not suspended, on hosting, and not live-and-current. */
  private async payable(userId: string) {
    const domain = await this.prisma.customDomain.findUnique({
      where: { userId },
      include: { user: { select: { email: true, name: true } } },
    })
    if (!domain) throw new NotFoundError('You have no shop address on file.')
    if (domain.suspended) throw new ConflictError('SUSPENDED', 'This address was switched off by the admin. Contact them to have it restored.')
    if (!domain.allowed) throw new ConflictError('NOT_APPROVED', 'This address has not been approved yet.')
    if (!domain.readyAt) throw new ConflictError('NOT_READY', 'This address is still being set up. You can pay once it is ready.')
    if (domain.active && !domain.graceEndsAt) throw new ConflictError('NOT_DUE', 'This address is paid up.')
    if (domain.priceAmount <= 0) throw new ValidationError('This address has no price set, nothing to pay.')
    return domain
  }

  async payByBalance(userId: string): Promise<{ ok: boolean }> {
    const domain = await this.payable(userId)
    const result = await this.domains.chargeCycle(domain.id)
    if (!result.ok) {
      throw new ConflictError('INSUFFICIENT_BALANCE', `Your earnings don't cover GHS ${(domain.priceAmount / 100).toFixed(2)}. Pay by Mobile Money or card instead.`)
    }
    await this.prisma.customDomain.update({ where: { id: domain.id }, data: { active: true, graceEndsAt: null, hostingStatus: null } })
    return result
  }

  /**
   * Start a Paystack payment. Paystack's fee is added on top, as at checkout,
   * so the superadmin's share and the business's both arrive whole.
   */
  async startPaystackPayment(userId: string, origin: string | undefined): Promise<{ authorizationUrl: string; reference: string; amount: number }> {
    const domain = await this.payable(userId)
    const feeBp = await this.settings.get('paystackFeeBp')
    const feeAmount = Math.ceil((domain.priceAmount * feeBp) / 10_000)
    const amount = domain.priceAmount + feeAmount

    const reference = `DOMREN-${domain.id}-${Date.now()}`
    const result = await this.paystack.initialise({
      reference,
      amount,
      email: domain.user.email,
      callbackUrl: appUrl(this.config, `/app/shop-look?domainPayment=${encodeURIComponent(reference)}`, origin),
      metadata: { purpose: 'domain_renewal', domainId: domain.id },
    })
    if (!result.ok) throw new ValidationError(`Could not start that payment: ${result.reason}`)

    const periodStart = new Date()
    await this.prisma.domainRenewal.create({
      data: {
        domainId: domain.id,
        amount,
        feeAmount,
        shareAmount: domain.costAmount,
        method: 'paystack',
        status: 'pending',
        periodStart,
        periodEnd: addInterval(periodStart, domain.billingInterval),
        paystackReference: reference,
      },
    })
    this.watch(reference)
    return { authorizationUrl: result.authorizationUrl, reference, amount }
  }

  /**
   * Apply a Paystack domain payment once Paystack confirms it. Called by the
   * return page, the background watch and the hourly sweep; only the first
   * to claim it applies it. The amount must be the full amount asked for.
   */
  async confirmPaystackPayment(reference: string): Promise<{ ok: boolean }> {
    const renewal = await this.prisma.domainRenewal.findUnique({ where: { paystackReference: reference }, include: { domain: true } })
    if (!renewal) throw new NotFoundError('We could not find that payment.')
    if (renewal.status === 'paid') return { ok: true }
    if (renewal.status === 'failed') return { ok: false }

    const outcome = await this.paystack.verify(reference)
    if (outcome.kind !== 'found') return { ok: false }
    if (outcome.status !== 'success') {
      if (['failed', 'abandoned', 'reversed'].includes(outcome.status) && Date.now() - renewal.createdAt.getTime() > PAYSTACK_WATCH_MS) {
        await this.prisma.domainRenewal.updateMany({ where: { id: renewal.id, status: 'pending' }, data: { status: 'failed' } })
      }
      return { ok: false }
    }
    if (outcome.amount < renewal.amount || (outcome.currency || 'GHS') !== 'GHS') {
      this.log.error(`domain payment ${reference}: paid ${outcome.amount} ${outcome.currency}, expected ${renewal.amount} GHS, not applied`)
      return { ok: false }
    }

    const domain = renewal.domain
    const now = new Date()
    // A renewal paid in grace continues from the end of the period it renews,
    // so paying late never buys extra days; a first payment starts now.
    const periodStart = domain.active && domain.nextRenewalAt && domain.nextRenewalAt < now ? domain.nextRenewalAt : now
    const periodEnd = addInterval(periodStart, domain.billingInterval)

    const applied = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.domainRenewal.updateMany({
        where: { id: renewal.id, status: 'pending' },
        data: { status: 'paid', paidAt: now, paystackFee: outcome.fee ?? null, periodStart, periodEnd },
      })
      if (claim.count === 0) return false
      const current = await tx.customDomain.findUniqueOrThrow({ where: { id: domain.id } })
      await tx.customDomain.update({
        where: { id: domain.id },
        data: {
          nextRenewalAt: periodEnd,
          graceEndsAt: null,
          hostingStatus: null,
          // Live again only if nothing else stands in the way.
          active: current.allowed && !current.suspended && current.readyAt !== null,
        },
      })
      await this.domains.bookPaidCycle(tx, {
        renewalId: renewal.id,
        domain: domain.domain,
        agentId: domain.userId,
        revenue: renewal.amount,
        share: renewal.shareAmount,
        paystackFee: outcome.fee ?? 0,
      })
      return true
    })
    if (applied) {
      this.watching.delete(reference)
    }
    return { ok: true }
  }

  /** Check a just-started Paystack payment every few seconds for a while, so a closed tab still counts. */
  private watch(reference: string): void {
    this.watching.set(reference, Date.now())
    if (this.watchTimer) return
    this.watchTimer = setInterval(() => {
      for (const [ref, started] of this.watching) {
        if (Date.now() - started > PAYSTACK_WATCH_MS) {
          this.watching.delete(ref)
          continue
        }
        void this.confirmPaystackPayment(ref).catch(() => undefined)
      }
      if (this.watching.size === 0 && this.watchTimer) {
        clearInterval(this.watchTimer)
        this.watchTimer = null
      }
    }, PAYSTACK_WATCH_TICK_MS)
    this.watchTimer.unref?.()
  }

  // ─── Telling the agent ──────────────────────────────────────────────────────

  private async platformName(): Promise<string> {
    const branding = await this.prisma.branding.findFirst({ where: { userId: null } })
    return branding?.shopName ?? 'JamesDataConsult'
  }

  private async alertGrace(domain: string, agentName: string, email: string, viaPaystack: boolean, price: number): Promise<void> {
    const ghs = `GHS ${(price / 100).toFixed(2)}`
    const explanation = viaPaystack
      ? `${domain} is due for renewal (${ghs}). Pay by Mobile Money or card within ${GRACE_PERIOD_DAYS} days to keep it live.`
      : `${domain} is due for renewal (${ghs}) and your earnings couldn't cover it. It stays live for ${GRACE_PERIOD_DAYS} more days, pay before then to keep it.`
    await this.email(email, agentName, `${domain} needs a payment`, 'Your shop address needs a payment', explanation, 'Pay now')
  }

  private async alertDeactivated(domain: string, agentName: string, email: string): Promise<void> {
    const explanation = `${domain} has been switched off because its renewal went unpaid. Pay on your Shop look page any time to bring it straight back.`
    await this.email(email, agentName, `${domain} was switched off`, 'Your shop address was switched off', explanation, 'Pay and reactivate')
  }

  private async email(to: string, agentName: string, subject: string, heading: string, explanation: string, button: string): Promise<void> {
    const shopName = await this.platformName()
    const link = appUrl(this.config, '/app/shop-look')
    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${escape(explanation)}</p>` +
      `<p style="margin:0"><a href="${link}" style="display:inline-block;background:#0B3B8F;color:#fff;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;text-decoration:none">${button}</a></p>`
    await this.mailer
      .send({ to, subject, html: wrap(shopName, heading, body, `Hello ${escape(agentName)}.`), text: `${explanation}\n\n${button}: ${link}` })
      .catch((error) => this.log.error(`could not email ${to} about ${subject}: ${String(error)}`))
  }
}
