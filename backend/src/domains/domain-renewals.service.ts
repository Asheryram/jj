import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../finance/ledger.service'
import { PaystackClient } from '../payments/paystack.client'
import { MailerService } from '../mail/mailer.service'
import { escape, wrap } from '../mail/templates'
import { appUrl } from '../common/app-links'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'
import { DomainsService, GRACE_PERIOD_DAYS, addInterval } from './domains.service'

/** Twice a day, the same cadence `SubscriptionsService` checks expiring third-party services on. */
const SWEEP_INTERVAL_MS = 12 * 60 * 60_000

/** Every 6 hours, see `checkPendingGoLive`. Independent of `SWEEP_INTERVAL_MS`, a different concern on its own clock. */
const GO_LIVE_CHECK_INTERVAL_MS = 6 * 60 * 60_000

/** How long a single reachability check waits before giving up on a domain, one at a time, not worth blocking the whole sweep over a slow one. */
const GO_LIVE_CHECK_TIMEOUT_MS = 10_000

/**
 * The recurring side of domain billing: sweeping for a cycle that has come
 * due, giving a failed one its grace window, and deactivating whatever runs
 * out that window still unpaid. `DomainsService.chargeCycle` does the actual
 * charge, in one place, whether it is called from here or from a domain's
 * first activation; this only decides when to call it and what to do once
 * grace has run out.
 */
@Injectable()
export class DomainRenewalsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(DomainRenewalsService.name)
  private timer: NodeJS.Timeout | null = null
  private goLiveTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly domains: DomainsService,
    private readonly ledger: LedgerService,
    private readonly paystack: PaystackClient,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.sweep().catch((error) => this.log.error(`domain renewal sweep failed: ${String(error)}`))
    }, SWEEP_INTERVAL_MS)
    this.timer.unref?.()

    this.goLiveTimer = setInterval(() => {
      void this.checkPendingGoLive().catch((error) =>
        this.log.error(`domain go-live check failed: ${String(error)}`),
      )
    }, GO_LIVE_CHECK_INTERVAL_MS)
    this.goLiveTimer.unref?.()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.goLiveTimer) clearInterval(this.goLiveTimer)
  }

  /**
   * Due cycles first (each may push a domain into grace), then domains whose
   * grace has actually run out, in that order: a domain should never be
   * deactivated in the same sweep its charge was first attempted, it is
   * meant to keep serving for the whole `GRACE_PERIOD_DAYS` window, not until
   * the next time this happens to run.
   */
  async sweep(): Promise<void> {
    const due = await this.prisma.customDomain.findMany({
      where: { active: true, graceEndsAt: null, nextRenewalAt: { lte: new Date() } },
      include: { user: { select: { name: true, email: true } } },
    })
    for (const row of due) {
      const result = await this.domains.chargeCycle(row.id)
      if (!result.ok) {
        this.log.warn(`domain ${row.id} (${row.domain}) renewal failed, entering grace`)
        await this.alertGrace(row.domain, row.user.name, row.user.email)
      }
    }

    const expired = await this.prisma.customDomain.findMany({
      where: { active: true, graceEndsAt: { lte: new Date() } },
      include: { user: { select: { name: true, email: true } } },
    })
    for (const row of expired) {
      await this.prisma.customDomain.update({ where: { id: row.id }, data: { active: false } })
      this.log.warn(`domain ${row.id} (${row.domain}) deactivated, grace period ran out unpaid`)
      await this.alertDeactivated(row.domain, row.user.name, row.user.email)
    }
  }

  /**
   * Approved domains still waiting on DNS, checked for whether they have
   * actually started resolving here yet, so "Mark as live" is a fallback an
   * admin can still reach for, not the only way a domain ever goes live.
   *
   * One at a time, not in parallel: these are outbound requests to
   * arbitrary third-party domains an agent typed in, a slow or hanging one
   * must not delay or crowd out checking the rest.
   */
  async checkPendingGoLive(): Promise<void> {
    const pending = await this.prisma.customDomain.findMany({
      where: { allowed: true, active: false },
    })
    for (const row of pending) {
      const reachable = await this.isReachable(row.domain)
      if (!reachable) continue

      // Re-checked through the exact same path a human clicking "Mark as
      // live" uses (`DomainsService.review`), not a shortcut around it: the
      // first cycle's charge, the suspended-agent guard, all of it applies
      // identically whether a person or this sweep is the one flipping it.
      // `'system'` is never actually written anywhere, `reviewedBy` is only
      // touched when `allowed` also changes, which it isn't here.
      try {
        await this.domains.review(row.id, 'system', { active: true })
        this.log.log(`domain ${row.id} (${row.domain}) resolved on its own, marked live`)
      } catch (error) {
        this.log.error(`domain ${row.id} (${row.domain}) resolved but could not be marked live: ${String(error)}`)
      }
    }
  }

  /**
   * A plain `GET https://<domain>/`, accepting any 2xx as "this is actually
   * serving something now". Not a check that it is specifically serving
   * THIS shop, DNS pointed here at all (rather than nowhere, or somewhere
   * else entirely) is the whole gap this closes, the same trust an admin
   * clicking "Mark as live" by hand is already extending. A DNS failure, a
   * connection refusal, or a certificate not issued yet (Vercel needs DNS
   * to resolve before it can even attempt one) all land in the `catch`,
   * exactly the "not ready yet, try again next sweep" outcome, not an error
   * worth logging loudly for every domain that just hasn't been pointed
   * here yet.
   */
  private async isReachable(domain: string): Promise<boolean> {
    try {
      const response = await fetch(`https://${domain}/`, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(GO_LIVE_CHECK_TIMEOUT_MS),
      })
      return response.ok
    } catch {
      return false
    }
  }

  private async platformName(): Promise<string> {
    const branding = await this.prisma.branding.findFirst({ where: { userId: null } })
    return branding?.shopName ?? 'JamesDataConsult'
  }

  private async alertGrace(domain: string, agentName: string, email: string): Promise<void> {
    const shopName = await this.platformName()
    const link = appUrl(this.config, '/app/shop-look')
    const explanation =
      `${escape(domain)} is due for renewal and your balance couldn't cover it. It will keep working ` +
      `for ${GRACE_PERIOD_DAYS} more day${GRACE_PERIOD_DAYS === 1 ? '' : 's'}, pay from your balance or by ` +
      `Mobile Money/card before then to keep it live.`
    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${explanation}</p>` +
      `<p style="margin:0"><a href="${link}" style="display:inline-block;background:#0B3B8F;color:#fff;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;text-decoration:none">Pay now</a></p>`
    const html = wrap(shopName, 'Your domain needs a payment', body, `Hello ${escape(agentName)}.`)
    const text = `${explanation}\n\nPay now: ${link}`
    await this.mailer
      .send({ to: email, subject: `${domain} needs a payment`, html, text })
      .catch((error) => this.log.error(`could not email ${email} about ${domain}'s grace period: ${String(error)}`))
  }

  private async alertDeactivated(domain: string, agentName: string, email: string): Promise<void> {
    const shopName = await this.platformName()
    const link = appUrl(this.config, '/app/shop-look')
    const explanation =
      `${escape(domain)} has been switched off, its renewal went unpaid past the grace period. ` +
      'Pay it from your dashboard any time to bring it straight back.'
    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${explanation}</p>` +
      `<p style="margin:0"><a href="${link}" style="display:inline-block;background:#0B3B8F;color:#fff;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;text-decoration:none">Pay and reactivate</a></p>`
    const html = wrap(shopName, 'Your domain was switched off', body, `Hello ${escape(agentName)}.`)
    const text = `${explanation}\n\nPay and reactivate: ${link}`
    await this.mailer
      .send({ to: email, subject: `${domain} was switched off`, html, text })
      .catch((error) => this.log.error(`could not email ${email} that ${domain} was deactivated: ${String(error)}`))
  }

  /**
   * The agent's own retry, from balance, usable any time a domain is behind
   * on its renewal, in grace or already deactivated. Reuses
   * `DomainsService.chargeCycle` exactly, then reactivates if this was what
   * had been switched off.
   */
  async payByBalance(userId: string): Promise<{ ok: boolean }> {
    const domain = await this.prisma.customDomain.findUnique({ where: { userId } })
    if (!domain) throw new NotFoundError('You have no domain on file.')
    if (!domain.graceEndsAt && domain.active) {
      throw new ConflictError('NOT_DUE', 'This domain is not behind on a payment.')
    }

    const result = await this.domains.chargeCycle(domain.id)
    if (result.ok && !domain.active) {
      await this.prisma.customDomain.update({ where: { id: domain.id }, data: { active: true } })
    }
    return result
  }

  /**
   * Start a live Paystack charge for one cycle, the fallback when the
   * balance path just failed. `amount`/`email` mirror an ordinary checkout
   * (`OrdersService.place`), just for a domain's own price instead of a
   * bundle's, and the reference is derived from the domain and the exact
   * moment asked, Paystack rejects a duplicate, which is what makes this
   * safe to retry.
   */
  async startPaystackPayment(
    userId: string,
    origin: string | undefined,
  ): Promise<{ authorizationUrl: string; reference: string }> {
    const domain = await this.prisma.customDomain.findUnique({
      where: { userId },
      include: { user: { select: { email: true, name: true } } },
    })
    if (!domain) throw new NotFoundError('You have no domain on file.')
    if (!domain.graceEndsAt && domain.active) {
      throw new ConflictError('NOT_DUE', 'This domain is not behind on a payment.')
    }
    if (domain.priceAmount <= 0) {
      throw new ValidationError('This domain has no price set, nothing to pay.')
    }

    const reference = `DOMREN-${domain.id}-${Date.now()}`
    const result = await this.paystack.initialise({
      reference,
      amount: domain.priceAmount,
      email: domain.user.email,
      callbackUrl: appUrl(this.config, `/app/shop-look?domainPayment=${encodeURIComponent(reference)}`, origin),
      metadata: { purpose: 'domain_renewal', domainId: domain.id },
    })
    if (!result.ok) {
      throw new ValidationError(`Could not start that payment: ${result.reason}`)
    }

    const periodStart = new Date()
    await this.prisma.domainRenewal.create({
      data: {
        domainId: domain.id,
        amount: domain.priceAmount,
        method: 'paystack',
        status: 'pending',
        periodStart,
        periodEnd: addInterval(periodStart, domain.billingInterval),
        paystackReference: reference,
      },
    })

    return { authorizationUrl: result.authorizationUrl, reference }
  }

  /**
   * Confirm a Paystack renewal payment, called from the return page the
   * same way `PaymentsService.confirm` handles an order's own checkout
   * return, a fresh server-to-Paystack verify, never the redirect trusted
   * on its own.
   */
  async confirmPaystackPayment(reference: string): Promise<{ ok: boolean }> {
    const renewal = await this.prisma.domainRenewal.findUnique({ where: { paystackReference: reference } })
    if (!renewal) throw new NotFoundError('We could not find that payment.')
    if (renewal.status === 'paid') return { ok: true }
    if (renewal.status === 'failed') return { ok: false }

    const outcome = await this.paystack.verify(reference)
    if (outcome.kind !== 'found' || outcome.status !== 'success') {
      if (outcome.kind === 'found' && outcome.status !== 'pending') {
        await this.prisma.domainRenewal.update({ where: { id: renewal.id }, data: { status: 'failed' } })
      }
      return { ok: false }
    }

    const claim = await this.prisma.domainRenewal.updateMany({
      where: { id: renewal.id, status: 'pending' },
      data: { status: 'paid', paidAt: new Date() },
    })
    if (claim.count === 0) return { ok: true } // Already applied by a concurrent confirm.

    const domain = await this.prisma.customDomain.update({
      where: { id: renewal.domainId },
      data: { active: true, graceEndsAt: null, nextRenewalAt: renewal.periodEnd },
    })
    await this.ledger.record([
      {
        idempotencyKey: LedgerService.key('domain_renewal', renewal.id, 'revenue'),
        kind: 'revenue',
        amount: renewal.amount,
        affectsProfit: true,
        description: `Domain renewal (Paystack) · ${domain.domain}`,
        userId: domain.userId,
        occurredAt: renewal.paidAt ?? new Date(),
      },
    ])
    return { ok: true }
  }
}
