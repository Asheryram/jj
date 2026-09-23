import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PaystackClient } from '../payments/paystack.client'
import { SettingsService } from '../settings/settings.service'
import { MailerService } from '../mail/mailer.service'
import { escape, wrap } from '../mail/templates'
import { splitDiscrepancy, type OrderSplit } from '../domain/pricing'
import { claimTransition } from '../common/alert-flag'

/**
 * What is owed, against what there is to pay it with, plus whether Paystack's
 * own live balance agrees with what our own records say it should.
 *
 * The "what is owed" half is not a bug in any one place, it is that money
 * arriving from customers all lands in a single Paystack balance, and several
 * different claims are made on it: agent earnings, refunds owed, customer
 * wallets, money already committed to a payout. All of it is computed here
 * entirely from this platform's own records (never from Paystack) so it
 * means the same thing regardless of account tier or settlement behaviour.
 *
 * The "does the live balance agree" half is a genuinely different question,
 * and it always asks it the same way: everything ever collected, net of
 * Paystack's fee, less every payout and refund transfer this platform has
 * actually sent, all-time, always, regardless of account tier. No live call
 * is needed to compute it; it is entirely this platform's own arithmetic,
 * and it is what the Reserve panel shows.
 *
 * What `paystackBusinessAccount` (a setting, off by default) decides is not
 * that arithmetic, it decides whether anyone is actually watching Paystack's
 * live balance for a real mismatch at all:
 *
 *  - **Off**, nobody has confirmed this account is being watched in a way
 *    worth trusting, so `checkAndAlert` never calls Paystack at all. No live
 *    request, no email, ever, from this service.
 *  - **On**, the background check (`checkAndAlert`, every 30 minutes) fetches
 *    the live balance and compares it against the same all-time figure the
 *    Reserve panel shows. If the live balance reads meaningfully *lower* than
 *    that (money that should be there is not) an admin gets an email. It
 *    only ever fires on a shortfall, not a surplus: Paystack holding *more*
 *    than expected is not the kind of problem this exists to catch.
 *
 * Either way, `position()` (what the Reserve panel reads) never calls
 * Paystack at all. The live balance is fetched solely by `reconcile()` /
 * `checkAndAlert()`, and only when the setting is on.
 */
const SHORTFALL_ALERTED_KEY = 'solvencyBalanceMismatchAlerted'
/** Half an hour. This drifts slowly compared to the float, which is checked on every order. */
const CHECK_INTERVAL_MS = 30 * 60_000
/** Pesewas of slack before a mismatch is worth mentioning, timing noise, not a real gap. */
const DISCREPANCY_TOLERANCE = 100

const SPLIT_MISMATCH_ALERTED_KEY = 'solvencySplitMismatchAlerted'
/**
 * How far back `checkSplitInvariant` looks, every 30 minutes.
 *
 * `split` is written once, at sale, and never touched again, an order that
 * already balanced cannot un-balance later, so re-checking every order ever
 * on every tick would be the exact "grows forever" shape this whole service
 * just got fixed out of elsewhere. A bug that starts writing bad splits shows
 * up here within a couple of ticks of the deploy that caused it either way;
 * `scripts/money-audit.ts` remains the full, all-time check, run on demand.
 */
const SPLIT_CHECK_WINDOW_MS = 48 * 60 * 60_000

const REFUND_ORDER_OVERLAP_ALERTED_KEY = 'solvencyRefundOrderOverlapAlerted'

export interface BalanceReconciliation {
  /** What our own records say Paystack's balance should hold right now, in pesewas. */
  expected: number
  /** What Paystack actually reports right now, in pesewas. */
  observed: number
  /** expected - observed. Positive means Paystack holds less than our records predict. */
  shortfall: number
  /** `shortfall` exceeds the rounding tolerance, a real shortage worth an email. Never fires on a surplus. */
  flagged: boolean
}

/**
 * How long a computed `expectedBalance()` stays good enough to reuse.
 *
 * `position()` (every Reserve panel load) and the 30-minute background poll
 * both ultimately call this, and both were re-summing every payment,
 * withdrawal and refund transfer ever made, from scratch, every single time,
 * cost that only ever grows, forever, as those tables do. A true O(1)
 * running total needs an atomically-incremented cache hooked into every
 * place a payment or transfer can confirm (a webhook, a manual settlement, a
 * retry), real work, done separately, on a number that directly drives real
 * payout decisions. This is the safe, contained half in the meantime: a
 * short memo so the same few minutes' worth of calls share one scan instead
 * of paying for it again on every request.
 */
const EXPECTED_BALANCE_CACHE_MS = 2 * 60_000

@Injectable()
export class SolvencyService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(SolvencyService.name)
  private timer: NodeJS.Timeout | null = null
  private expectedBalanceCache: { value: number; computedAt: number } | null = null
  private spentOnBundlesCache: { value: number; computedAt: number } | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackClient,
    private readonly settings: SettingsService,
    private readonly mailer: MailerService,
  ) {}

  /**
   * Watch solvency on a clock, not just when someone happens to open the
   * Reserve panel.
   *
   * Everything else that can drift silently already has a trigger to catch
   * it, the float is re-checked on every order and every logged capital
   * move. This had no equivalent: a shortfall here was invisible until an
   * admin opened the panel, or a payout was attempted and refused by
   * `canPayout`. A plain interval, unref'd so it never holds the process
   * open, the same pattern `ReconcilerService` already uses rather than
   * pulling in a cron dependency for one job.
   */
  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.checkAndAlert().catch((error) =>
        this.log.error(`solvency check failed: ${String(error)}`),
      )
      void this.checkSplitInvariant().catch((error) =>
        this.log.error(`split invariant check failed: ${String(error)}`),
      )
      void this.checkCompletedRefundOverlap().catch((error) =>
        this.log.error(`completed/refund overlap check failed: ${String(error)}`),
      )
    }, CHECK_INTERVAL_MS)
    this.timer.unref?.()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private async checkAndAlert(): Promise<void> {
    const reconciliation = await this.reconcile()
    // Null is not a mismatch, Paystack being briefly unreachable, or having
    // never settled at all yet, must never itself trigger a "something is
    // wrong" email.
    if (!reconciliation) return

    // See `claimTransition`'s own doc comment, this check runs on a plain
    // 30-minute interval, so two ticks overlapping (a slow mail send pushing
    // one past the next timer fire) is the concrete case this guards against,
    // not a hypothetical one.
    if (reconciliation.flagged) {
      if (await claimTransition(this.prisma, SHORTFALL_ALERTED_KEY, false, true)) {
        await this.alertMismatch(reconciliation)
      }
    } else {
      if (await claimTransition(this.prisma, SHORTFALL_ALERTED_KEY, true, false)) {
        this.log.log('balance mismatch cleared')
      }
    }
  }

  /** Active admins, falling back to superadmins if none exist yet. */
  private async adminRecipients(): Promise<{ name: string; email: string }[]> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'admin', status: 'active' },
      select: { name: true, email: true },
    })
    return admins.length > 0
      ? admins
      : this.prisma.user.findMany({
          where: { role: 'superadmin', status: 'active' },
          select: { name: true, email: true },
        })
  }

  /** Tell whoever can act on it that Paystack's balance disagrees with our own records. */
  private async alertMismatch(reconciliation: BalanceReconciliation): Promise<void> {
    const recipients = await this.adminRecipients()
    if (recipients.length === 0) {
      this.log.warn('balance mismatch, nobody to tell')
      return
    }

    const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`
    const shopName = await this.platformName()

    // Only ever a shortfall, `reconcile()` never flags a surplus, so there is
    // no "which direction" branch to phrase here.
    const explanation =
      `Paystack is showing ${escape(ghs(reconciliation.observed))} right now. Adding up everything ` +
      `customers have ever paid you, and subtracting every payout and refund you've sent, your own ` +
      `records say it should be holding ${escape(ghs(reconciliation.expected))}, ` +
      `${escape(ghs(reconciliation.shortfall))} more than what's actually there.`

    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${explanation}</p>` +
      `<p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;color:#1e293b">This usually means ` +
      `a payment or a transfer registered here never actually reached Paystack's balance, or ` +
      `Paystack paid out to your bank/Mobile Money account without it being logged here. Check ` +
      `recent orders, refunds and payouts against your Paystack dashboard, this note will not ` +
      `repeat until the shortfall clears.</p>`
    const text =
      `${explanation}\n\n` +
      'This usually means a payment or a transfer registered here never actually reached ' +
      "Paystack's balance, or Paystack paid out to your bank/Mobile Money account without it " +
      'being logged here. Check recent orders, refunds and payouts against your Paystack dashboard ' +
      '- this note will not repeat until the shortfall clears.'

    const subject = `Paystack balance is short by ${ghs(reconciliation.shortfall)}`
    const html = wrap(
      shopName,
      'Your Paystack balance is short',
      body,
      `You are getting this because you are an active admin on ${escape(shopName)}.`,
    )

    for (const recipient of recipients) {
      await this.mailer
        .send({ to: recipient.email, subject, html, text })
        .catch((error) =>
          this.log.error(`could not tell ${recipient.email} about the mismatch: ${String(error)}`),
        )
    }

    this.log.warn(
      `balance mismatch ${ghs(reconciliation.shortfall)}, told ${recipients.map((r) => r.email).join(', ')}`,
    )
  }

  private async platformName(): Promise<string> {
    const branding = await this.prisma.branding.findFirst({ where: { userId: null } })
    return branding?.shopName ?? 'JamesDataConsult'
  }

  /**
   * `sale_price = supplier_cost + Σ margins` cannot be a database CHECK
   * constraint (see the schema header's own comment) so this is the
   * automated half of watching it: every recent order, every 30 minutes.
   * `scripts/money-audit.ts` is the full, all-time version of the same check,
   * for someone to run by hand.
   */
  private async checkSplitInvariant(): Promise<void> {
    const since = new Date(Date.now() - SPLIT_CHECK_WINDOW_MS)
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: since } },
      select: { reference: true, salePrice: true, split: true },
    })

    const broken = orders.filter(
      (o) => splitDiscrepancy(o.salePrice, o.split as unknown as OrderSplit) !== 0,
    )

    if (broken.length > 0) {
      if (await claimTransition(this.prisma, SPLIT_MISMATCH_ALERTED_KEY, false, true)) {
        await this.alertSplitMismatch(broken.map((o) => o.reference))
      }
    } else {
      if (await claimTransition(this.prisma, SPLIT_MISMATCH_ALERTED_KEY, true, false)) {
        this.log.log('split invariant mismatch cleared')
      }
    }
  }

  /** Tell whoever can act on it that a recent order's split does not add up. */
  private async alertSplitMismatch(references: string[]): Promise<void> {
    const recipients = await this.adminRecipients()
    if (recipients.length === 0) {
      this.log.warn(`split invariant broken on ${references.join(', ')}, nobody to tell`)
      return
    }

    const shopName = await this.platformName()
    const list = references.map((r) => escape(r)).join(', ')
    const explanation =
      `${references.length} recent order${references.length === 1 ? '' : 's'} (${list}) ` +
      `${references.length === 1 ? "doesn't" : "don't"} add up: what the customer paid doesn't ` +
      'match what it cost you plus what everyone earned from it. That should never happen, ' +
      `money appears to have been created or lost on ${references.length === 1 ? 'this sale' : 'at least one of these sales'}.`

    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${explanation}</p>` +
      `<p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;color:#1e293b">This needs a ` +
      `developer, not an approval, check what changed in how orders are priced or settled. ` +
      `This note will not repeat until every recent order balances again.</p>`
    const text =
      `${explanation}\n\nThis needs a developer, not an approval, check what changed in how ` +
      'orders are priced or settled. This note will not repeat until every recent order balances again.'

    const subject = `${references.length} order${references.length === 1 ? '' : 's'} do not add up`
    const html = wrap(
      shopName,
      'An order split does not add up',
      body,
      `You are getting this because you are an active admin on ${escape(shopName)}.`,
    )

    for (const recipient of recipients) {
      await this.mailer
        .send({ to: recipient.email, subject, html, text })
        .catch((error) =>
          this.log.error(`could not tell ${recipient.email} about the split mismatch: ${String(error)}`),
        )
    }

    this.log.error(
      `split invariant broken on ${references.join(', ')}, told ${recipients.map((r) => r.email).join(', ')}`,
    )
  }

  /**
   * The other half of a "delivered and refunded simultaneously" double-spend,
   * the same class of bug that produced the "8 customers credited GHS 196"
   * incident referenced on `RefundRequest`'s own doc comment, just on the
   * settlement side rather than the split-arithmetic side.
   *
   * No date window needed here, unlike `checkSplitInvariant`, `pending` is
   * naturally bounded to whatever is currently sitting in the Refunds queue
   * awaiting a decision, not "every refund ever," so scanning all of it on
   * every tick never grows with order/ledger history.
   */
  private async checkCompletedRefundOverlap(): Promise<void> {
    const overlaps = await this.prisma.refundRequest.findMany({
      where: { status: 'pending', order: { status: 'completed' } },
      select: { orderRef: true },
    })

    const references = overlaps.map((o) => o.orderRef)
    if (references.length > 0) {
      if (await claimTransition(this.prisma, REFUND_ORDER_OVERLAP_ALERTED_KEY, false, true)) {
        await this.alertRefundOrderOverlap(references)
      }
    } else {
      if (await claimTransition(this.prisma, REFUND_ORDER_OVERLAP_ALERTED_KEY, true, false)) {
        this.log.log('completed/refund overlap cleared')
      }
    }
  }

  /** Tell whoever can act on it that a delivered order still has an unresolved refund sitting open. */
  private async alertRefundOrderOverlap(references: string[]): Promise<void> {
    const recipients = await this.adminRecipients()
    if (recipients.length === 0) {
      this.log.warn(`completed order with an open refund on ${references.join(', ')}, nobody to tell`)
      return
    }

    const shopName = await this.platformName()
    const list = references.map((r) => escape(r)).join(', ')
    const explanation =
      `${references.length} order${references.length === 1 ? '' : 's'} (${list}) ` +
      `${references.length === 1 ? 'shows' : 'show'} as delivered, but still ${references.length === 1 ? 'has' : 'have'} a refund ` +
      'sitting in the queue waiting on a decision. If that refund is approved as it stands, the ' +
      'customer would be paid back for a bundle they already received.'

    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${explanation}</p>` +
      `<p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;color:#1e293b">Check each order before ` +
      `deciding its refund, if the bundle genuinely arrived, reject the refund rather than approving ` +
      `it. This note will not repeat until every completed order's refund is resolved.</p>`
    const text =
      `${explanation}\n\nCheck each order before deciding its refund, if the bundle genuinely arrived, ` +
      "reject the refund rather than approving it. This note will not repeat until every completed " +
      "order's refund is resolved."

    const subject = `${references.length} delivered order${references.length === 1 ? '' : 's'} with an open refund`
    const html = wrap(
      shopName,
      'A delivered order still has an open refund',
      body,
      `You are getting this because you are an active admin on ${escape(shopName)}.`,
    )

    for (const recipient of recipients) {
      await this.mailer
        .send({ to: recipient.email, subject, html, text })
        .catch((error) =>
          this.log.error(`could not tell ${recipient.email} about the refund overlap: ${String(error)}`),
        )
    }

    this.log.error(
      `completed order with an open refund on ${references.join(', ')}, told ${recipients.map((r) => r.email).join(', ')}`,
    )
  }

  /**
   * The reserve position.
   *
   * `available` is the honest answer to "what can I actually spend": the balance
   * less every obligation. Negative means obligations already exceed the money
   * held, not a rounding matter, a shortfall somebody will eventually ask for.
   */
  async position() {
    const [
      agents,
      customerWallets,
      credits,
      pendingPayouts,
      stuckPayouts,
      heldOrders,
      pendingRefunds,
      stuckRefunds,
      manualRefundAdvances,
      manualRefundReimbursements,
      manualPayoutAdvances,
      manualPayoutReimbursements,
    ] = await Promise.all([
      this.prisma.user.aggregate({ where: { role: 'agent' }, _sum: { balance: true } }),
      this.prisma.user.aggregate({ where: { role: 'customer' }, _sum: { balance: true } }),
      this.prisma.claimableCredit.aggregate({
        where: { claimed: false },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // "Waiting on a decision", shown separately below so the Reserve panel
      // can tell you how many need YOUR approval, distinct from `stuckPayouts`
      // (already decided, just not confirmed sent yet).
      this.prisma.withdrawal.aggregate({
        where: { status: 'pending' },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      /**
       * Approved, but the real Paystack transfer hasn't actually landed.
       *
       * `status` moves to `approved` the instant James decides, but Paystack
       * settles asynchronously, the transfer can sit on `otp`, `unknown`, or
       * `manual` for a real stretch of time, or simply be null for the moment
       * right after approval before it has been attempted at all. Until
       * `transferStatus` reads `success`, the agent has not been paid, so this
       * is still owed exactly like a `pending` request is, it was just
       * missing from here before, which let "Free to spend" briefly overstate
       * what was actually safe to use.
       *
       * `OR: [{ transferStatus: null }, ...]` is deliberate, not redundant:
       * `NOT: { transferStatus: 'success' }` alone silently excludes a null
       * `transferStatus` under SQL's three-valued logic, verified directly
       * against the database, which would have reopened exactly the gap this
       * exists to close for every withdrawal not yet attempted.
       */
      this.prisma.withdrawal.aggregate({
        where: {
          status: 'approved',
          OR: [{ transferStatus: null }, { transferStatus: { not: 'success' } }],
        },
        _sum: { amount: true },
      }),
      // Orders paid for and not yet delivered. The customer's money is in hand
      // and the bundle is not, so it is either a delivery or a refund, and
      // either way it is not James's to spend.
      this.prisma.order.aggregate({
        where: { status: { in: ['awaiting_approval', 'processing'] } },
        _sum: { salePrice: true },
        _count: { _all: true },
      }),
      // Refunds are authorised by a person, not paid automatically, but the
      // money is owed from the moment the delivery failed, not from the moment
      // somebody clicks approve. Counting it only at approval would make the
      // balance look spendable while a customer was still waiting for it.
      this.prisma.refundRequest.aggregate({
        where: { status: 'pending' },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // Same "approved but not actually sent yet" gap as `stuckPayouts` above,
      // scoped to `method: 'transfer'`, a wallet or claimable refund already
      // moved the money the moment it was approved. Same explicit-null
      // handling as above, for the same reason.
      this.prisma.refundRequest.aggregate({
        where: {
          status: 'approved',
          method: 'transfer',
          OR: [{ transferStatus: null }, { transferStatus: { not: 'success' } }],
        },
        _sum: { amount: true },
      }),
      // A `capital_in` tied to an order is `RefundsService.settleManually`
      // recording that someone personally covered a refund Paystack refused to
      // send, see `FloatMonitorService.outstandingManualRefunds`. Owed back
      // the same as any other debt from the moment it happened, not from
      // whenever it gets reimbursed.
      this.prisma.ledgerEntry.findMany({
        where: { kind: 'capital_in', orderRef: { not: null } },
        select: { orderRef: true, amount: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { kind: 'capital_out', orderRef: { not: null } },
        select: { orderRef: true },
      }),
      // The identical pattern, one column over: `WithdrawalsService.settleManually`
      // recording that someone personally covered a payout because there was
      // nowhere automatic to send it from yet (no Paystack key configured, or
      // an account that cannot send transfers at all), see
      // `transfersSince()` below for why this must never also look like a
      // real Paystack transfer.
      this.prisma.ledgerEntry.findMany({
        where: { kind: 'capital_in', withdrawalId: { not: null } },
        select: { withdrawalId: true, amount: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { kind: 'capital_out', withdrawalId: { not: null } },
        select: { withdrawalId: true },
      }),
    ])

    const undelivered = heldOrders._sum.salePrice ?? 0
    const owedToAgents = agents._sum.balance ?? 0
    /**
     * Requesting a withdrawal debits the agent's balance immediately (see
     * `WithdrawalsService.request`), so by the time it is sitting here as
     * "pending" or "approved but not sent" it has already left `owedToAgents`
     * above. Left out of the total it would vanish from both sides, same
     * class of gap `pendingRefunds` below already exists to close, for the
     * identical reason: a payout not yet actually sent is still owed, not yet
     * freed up.
     */
    const queuedPayouts = (pendingPayouts._sum.amount ?? 0) + (stuckPayouts._sum.amount ?? 0)
    const owedToCustomers =
      (customerWallets._sum.balance ?? 0) +
      (credits._sum.amount ?? 0) +
      (pendingRefunds._sum.amount ?? 0) +
      (stuckRefunds._sum.amount ?? 0)
    const reimbursedRefs = new Set(manualRefundReimbursements.map((r) => r.orderRef))
    const owedForManualRefunds = manualRefundAdvances
      .filter((advance) => !reimbursedRefs.has(advance.orderRef))
      .reduce((sum, advance) => sum + advance.amount, 0)
    const reimbursedWithdrawalIds = new Set(manualPayoutReimbursements.map((r) => r.withdrawalId))
    const owedForManualPayouts = manualPayoutAdvances
      .filter((advance) => !reimbursedWithdrawalIds.has(advance.withdrawalId))
      .reduce((sum, advance) => sum + advance.amount, 0)
    const liabilities =
      owedToAgents + owedToCustomers + undelivered + queuedPayouts + owedForManualRefunds + owedForManualPayouts
    const spentOnBundles = await this.spentOnBundles()

    const expectedAtPaystack = await this.expectedBalance()

    return {
      /**
       * What our own records say should be at Paystack right now: everything
       * ever collected, net of Paystack's fee, less every payout and refund
       * transfer this platform has actually sent. Never Paystack's own live
       * balance, see the file header.
       */
      expectedAtPaystack,
      /**
       * Every bundle ever bought, all-time, see the query above for why
       * this is subtracted from `freeToSpend` even though none of it ever
       * physically left Paystack.
       */
      spentOnBundles,
      /**
       * What's actually free to spend: `expectedAtPaystack` less every claim
       * already on it, and less everything already spent buying bundles,
       * that money came out of the DataHub float, not Paystack, but keeping
       * the float funded means moving Paystack money across to replace it
       * sooner or later, so it is not free for anything else. Safe to show
       * now in a way the old "Free to spend" figure was not, every part of
       * this is this platform's own tracked records, never Paystack's live
       * balance, so it cannot read GHS 0.00 just because a Starter account
       * happens to hold nothing at the moment.
       */
      freeToSpend: expectedAtPaystack - liabilities - spentOnBundles,
      liabilities: {
        agentEarnings: owedToAgents,
        customerMoney: owedToCustomers,
        undeliveredOrders: undelivered,
        /** Requested, balance already debited, not yet actually sent. */
        queuedPayouts,
        /** Owed to whoever personally covered a refund Paystack refused to send. */
        manualRefundAdvances: owedForManualRefunds,
        /** Owed to whoever personally covered a payout with nowhere automatic to send it from. */
        manualPayoutAdvances: owedForManualPayouts,
        total: liabilities,
      },
      pendingPayouts: {
        count: pendingPayouts._count._all,
        amount: pendingPayouts._sum.amount ?? 0,
      },
      unclaimedRefunds: {
        count: credits._count._all,
        amount: credits._sum.amount ?? 0,
      },
      /** Owed back, and waiting on somebody to authorise paying it. */
      pendingRefunds: {
        count: pendingRefunds._count._all,
        amount: pendingRefunds._sum.amount ?? 0,
      },
    }
  }

  /**
   * Withdrawals and refunds stuck on `otp` or `unknown`, the two Paystack
   * transfer states that never resolve themselves and need a person to
   * check Paystack's own dashboard, unlike one still genuinely in flight.
   *
   * `position()` above already counts these correctly in its liability
   * totals (`stuckPayouts`/`stuckRefunds`), but a total is not a worklist,
   * there was nowhere that said "here are the N requests, go look," which
   * is exactly the operational gap that led an admin straight to
   * `settleManually` on a row that may have already resolved itself at
   * Paystack. Comparable to `ReconcilerService.needsAttention` for orders;
   * this is the equivalent for the money side.
   */
  async stuckTransfers() {
    const [withdrawals, refunds] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where: { status: 'approved', transferStatus: { in: ['otp', 'unknown'] } },
        orderBy: { decidedAt: 'asc' },
        select: {
          id: true,
          agentName: true,
          agentPhone: true,
          amount: true,
          transferStatus: true,
          transferNote: true,
          decidedAt: true,
        },
      }),
      this.prisma.refundRequest.findMany({
        where: { status: 'approved', transferStatus: { in: ['otp', 'unknown'] } },
        orderBy: { decidedAt: 'asc' },
        select: {
          id: true,
          orderRef: true,
          buyerName: true,
          buyerPhone: true,
          amount: true,
          transferStatus: true,
          transferNote: true,
          decidedAt: true,
        },
      }),
    ])

    const rows = [
      ...withdrawals.map((w) => ({
        type: 'withdrawal' as const,
        id: w.id,
        reference: `WDR-${w.id.slice(0, 8).toUpperCase()}`,
        who: w.agentName,
        phone: w.agentPhone,
        amount: w.amount,
        transferStatus: w.transferStatus as 'otp' | 'unknown',
        note: w.transferNote,
        decidedAt: w.decidedAt?.toISOString() ?? null,
      })),
      ...refunds.map((r) => ({
        type: 'refund' as const,
        id: r.id,
        reference: r.orderRef,
        who: r.buyerName,
        phone: r.buyerPhone,
        amount: r.amount,
        transferStatus: r.transferStatus as 'otp' | 'unknown',
        note: r.transferNote,
        decidedAt: r.decidedAt?.toISOString() ?? null,
      })),
    ]

    // Oldest first, same convention as `ReconcilerService.needsAttention`,
    // the longest-stuck one is the most overdue for a look.
    return rows.sort((a, b) => (a.decidedAt ?? '').localeCompare(b.decidedAt ?? ''))
  }

  /**
   * Whether a payout can be honoured right now.
   *
   * Called before approving one, so an agent is told the truth rather than being
   * marked paid against money that is not there. Deliberately advisory: it
   * reports, and the caller decides, refusing outright would let an unreachable
   * Paystack block every payout, and the agent is owed the money either way.
   */
  async canPayout(amount: number): Promise<{ ok: boolean; reason: string | null }> {
    const result = await this.paystack.balance()
    if (!result.ok) {
      // Unknown, not "no". Blocking on our own inability to check would be the
      // wrong answer to a debt we already owe.
      this.log.warn(`could not check the balance before a payout: ${result.reason}`)
      return { ok: true, reason: null }
    }

    if (result.balance < amount) {
      return {
        ok: false,
        reason:
          `Paystack is holding GHS ${(result.balance / 100).toFixed(2)}, and this payout is ` +
          `GHS ${(amount / 100).toFixed(2)}. Top up before approving it, or the transfer will fail.`,
      }
    }

    return { ok: true, reason: null }
  }

  /** All-time, net of Paystack's own fee, every Mobile Money payment ever confirmed paid. */
  private async collectedSince(): Promise<number> {
    const paid = await this.prisma.payment.aggregate({
      where: { status: 'paid' },
      _sum: { amount: true, fee: true },
    })
    return (paid._sum.amount ?? 0) - (paid._sum.fee ?? 0)
  }

  /**
   * All-time pesewas actually transferred out through Paystack, agent
   * payouts and Mobile Money refunds, the two ways money leaves this
   * platform through them.
   *
   * Keyed on `paidAt` (not null) rather than `status`, so a merely approved,
   * not-yet-sent transfer is correctly not counted as having left the
   * balance yet.
   *
   * Both sides also require `transferCode: { not: null }`, a real Paystack
   * transfer always gets one back; neither `RefundsService.settleManually`
   * nor `WithdrawalsService.settleManually` ever sets one, because no
   * Paystack transfer happens there at all. Without this, a manually-settled
   * payout or refund (someone's own pocket covering it because there was
   * nowhere automatic to send it from) looked identical to a real one and
   * was subtracted here as if it had left Paystack's balance, on top of the
   * same amount already being subtracted, correctly, as "owed for a manual
   * advance" in `liabilities`. That double-counted it, understating
   * `freeToSpend` by every manually-settled payout or refund on the books.
   */
  private async transfersSince(): Promise<number> {
    const [payouts, refunds] = await Promise.all([
      this.prisma.withdrawal.aggregate({
        where: { paidAt: { not: null }, transferCode: { not: null } },
        _sum: { amount: true },
      }),
      this.prisma.refundRequest.aggregate({
        where: { method: 'transfer', paidAt: { not: null }, transferCode: { not: null } },
        _sum: { amount: true },
      }),
    ])
    return (payouts._sum.amount ?? 0) + (refunds._sum.amount ?? 0)
  }

  /**
   * Does Paystack's live balance agree with what our own records predict?
   *
   * The only place in this service that calls Paystack's live balance,
   * `position()` never does. Returns null, without calling Paystack at all,
   * unless `paystackBusinessAccount` is on, nobody has asked this account to
   * be watched, so nothing here spends a request or has an opinion.
   */
  async reconcile(): Promise<BalanceReconciliation | null> {
    const watching = await this.settings.get('paystackBusinessAccount')
    if (!watching) return null

    const [balanceResult, expected] = await Promise.all([
      this.paystack.balance(),
      this.expectedBalance(),
    ])
    if (!balanceResult.ok) return null

    const shortfall = expected - balanceResult.balance
    return {
      expected,
      observed: balanceResult.balance,
      shortfall,
      // Only a real shortage is worth an email, Paystack holding more than
      // expected is not the kind of problem this exists to catch.
      flagged: shortfall > DISCREPANCY_TOLERANCE,
    }
  }

  /**
   * What should be sitting in Paystack's balance right now, entirely from
   * this platform's own records: everything ever collected, net of
   * Paystack's fee, less every payout and refund transfer this platform has
   * actually sent, less every reimbursement James has moved across to
   * DataHub. Always all-time, regardless of account tier or settings, no
   * live call, ever, to compute this.
   *
   * The reimbursement term exists because that money genuinely leaves
   * Paystack, James moves it out himself, outside anything this app can see
   * or call, the same way a manually-settled refund or payout does. Without
   * it, a logged reimbursement (`FloatMonitorService.logCapital`) landed at
   * the float, correctly raising what it should hold, while this figure
   * carried on as if the same cedis were still sitting in Paystack
   * untouched. Same money, counted as present in two different pots at
   * once, which overstated `freeToSpend` by the full reimbursed amount.
   */
  private async expectedBalance(): Promise<number> {
    if (this.expectedBalanceCache && Date.now() - this.expectedBalanceCache.computedAt < EXPECTED_BALANCE_CACHE_MS) {
      return this.expectedBalanceCache.value
    }

    const [collected, transferred, reimbursedToDataHub] = await Promise.all([
      this.collectedSince(),
      this.transfersSince(),
      this.reimbursedToDataHub(),
    ])
    const value = collected - transferred - reimbursedToDataHub
    this.expectedBalanceCache = { value, computedAt: Date.now() }
    return value
  }

  /**
   * All-time pesewas James has logged moving from Paystack to DataHub as a
   * reimbursement, see `expectedBalance`'s own comment for why this has to
   * count as money having left Paystack, the exact figure
   * `spentOnBundles` reads to know the same debt has been settled.
   */
  private async reimbursedToDataHub(): Promise<number> {
    const result = await this.prisma.ledgerEntry.aggregate({
      where: { kind: 'capital_in_reimbursement' },
      _sum: { amount: true },
    })
    return result._sum.amount ?? 0
  }

  /**
   * Every bundle ever bought, all-time, less whatever has already been
   * reimbursed to the float for it. Same "no date bound, only ever grows"
   * shape as `expectedBalance()`, and the same short memo for the same
   * reason, see `EXPECTED_BALANCE_CACHE_MS`'s own comment.
   */
  private async spentOnBundles(): Promise<number> {
    if (this.spentOnBundlesCache && Date.now() - this.spentOnBundlesCache.computedAt < EXPECTED_BALANCE_CACHE_MS) {
      return this.spentOnBundlesCache.value
    }

    const [bundlesBought, reimbursedToDataHub] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({ where: { kind: 'supplier_cost' }, _sum: { amount: true } }),
      this.prisma.ledgerEntry.aggregate({ where: { kind: 'capital_in_reimbursement' }, _sum: { amount: true } }),
    ])

    // supplier_cost entries are stored negative (money leaving the float).
    // Floored at zero: logging more reimbursement than has ever been spent
    // should not turn "already spent on bundles" into a negative number that
    // would add back onto `freeToSpend` instead of merely clearing it.
    const value = Math.max(0, -(bundlesBought._sum.amount ?? 0) - (reimbursedToDataHub._sum.amount ?? 0))
    this.spentOnBundlesCache = { value, computedAt: Date.now() }
    return value
  }
}
