import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PaystackClient } from '../payments/paystack.client'
import { SettingsService } from '../settings/settings.service'
import { MailerService } from '../mail/mailer.service'
import { escape, wrap } from '../mail/templates'

/**
 * What is owed, against what there is to pay it with — plus whether Paystack's
 * own live balance agrees with what our own records say it should.
 *
 * The "what is owed" half is not a bug in any one place — it is that money
 * arriving from customers all lands in a single Paystack balance, and several
 * different claims are made on it: agent earnings, refunds owed, customer
 * wallets, money already committed to a payout. All of it is computed here
 * entirely from this platform's own records — never from Paystack — so it
 * means the same thing regardless of account tier or settlement behaviour.
 *
 * The "does the live balance agree" half is a genuinely different question,
 * and it always asks it the same way: everything ever collected, net of
 * Paystack's fee, less every payout and refund transfer this platform has
 * actually sent — all-time, always, regardless of account tier. No live call
 * is needed to compute it; it is entirely this platform's own arithmetic,
 * and it is what the Reserve panel shows.
 *
 * What `paystackBusinessAccount` (a setting, off by default) decides is not
 * that arithmetic — it decides whether anyone is actually watching Paystack's
 * live balance for a real mismatch at all:
 *
 *  - **Off** — nobody has confirmed this account is being watched in a way
 *    worth trusting, so `checkAndAlert` never calls Paystack at all. No live
 *    request, no email, ever, from this service.
 *  - **On** — the background check (`checkAndAlert`, every 30 minutes) fetches
 *    the live balance and compares it against the same all-time figure the
 *    Reserve panel shows. If the live balance reads meaningfully *lower* than
 *    that — money that should be there is not — an admin gets an email. It
 *    only ever fires on a shortfall, not a surplus: Paystack holding *more*
 *    than expected is not the kind of problem this exists to catch.
 *
 * Either way, `position()` — what the Reserve panel reads — never calls
 * Paystack at all. The live balance is fetched solely by `reconcile()` /
 * `checkAndAlert()`, and only when the setting is on.
 */
const SHORTFALL_ALERTED_KEY = 'solvencyBalanceMismatchAlerted'
/** Half an hour. This drifts slowly compared to the float, which is checked on every order. */
const CHECK_INTERVAL_MS = 30 * 60_000
/** Pesewas of slack before a mismatch is worth mentioning — timing noise, not a real gap. */
const DISCREPANCY_TOLERANCE = 100

export interface BalanceReconciliation {
  /** What our own records say Paystack's balance should hold right now, in pesewas. */
  expected: number
  /** What Paystack actually reports right now, in pesewas. */
  observed: number
  /** expected - observed. Positive means Paystack holds less than our records predict. */
  shortfall: number
  /** `shortfall` exceeds the rounding tolerance — a real shortage worth an email. Never fires on a surplus. */
  flagged: boolean
}

@Injectable()
export class SolvencyService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(SolvencyService.name)
  private timer: NodeJS.Timeout | null = null

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
   * it — the float is re-checked on every order and every logged capital
   * move. This had no equivalent: a shortfall here was invisible until an
   * admin opened the panel, or a payout was attempted and refused by
   * `canPayout`. A plain interval, unref'd so it never holds the process
   * open — the same pattern `ReconcilerService` already uses rather than
   * pulling in a cron dependency for one job.
   */
  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.checkAndAlert().catch((error) =>
        this.log.error(`solvency check failed: ${String(error)}`),
      )
    }, CHECK_INTERVAL_MS)
    this.timer.unref?.()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private async checkAndAlert(): Promise<void> {
    const reconciliation = await this.reconcile()
    // Null is not a mismatch — Paystack being briefly unreachable, or having
    // never settled at all yet, must never itself trigger a "something is
    // wrong" email.
    if (!reconciliation) return

    const wasAlerted = await this.wasAlerted()
    if (reconciliation.flagged && !wasAlerted) {
      await this.setAlerted(true)
      await this.alertMismatch(reconciliation)
    } else if (!reconciliation.flagged && wasAlerted) {
      await this.setAlerted(false)
      this.log.log('balance mismatch cleared')
    }
  }

  private async wasAlerted(): Promise<boolean> {
    const row = await this.prisma.setting.findUnique({ where: { key: SHORTFALL_ALERTED_KEY } })
    return row?.value === true
  }

  private async setAlerted(value: boolean): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: SHORTFALL_ALERTED_KEY },
      create: { key: SHORTFALL_ALERTED_KEY, value },
      update: { value },
    })
  }

  /** Tell whoever can act on it that Paystack's balance disagrees with our own records. */
  private async alertMismatch(reconciliation: BalanceReconciliation): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'admin', status: 'active' },
      select: { name: true, email: true },
    })
    const recipients =
      admins.length > 0
        ? admins
        : await this.prisma.user.findMany({
            where: { role: 'superadmin', status: 'active' },
            select: { name: true, email: true },
          })

    if (recipients.length === 0) {
      this.log.warn('balance mismatch — nobody to tell')
      return
    }

    const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`
    const shopName = await this.platformName()

    // Only ever a shortfall — `reconcile()` never flags a surplus, so there is
    // no "which direction" branch to phrase here.
    const explanation =
      `Paystack reports ${escape(ghs(reconciliation.observed))}, but your own records say it ` +
      `should hold ${escape(ghs(reconciliation.expected))}, all-time, net of every payout and ` +
      `refund you have sent — ${escape(ghs(reconciliation.shortfall))} short.`

    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${explanation}</p>` +
      `<p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;color:#1e293b">This usually means ` +
      `a payment or a transfer registered here never actually reached Paystack's balance — or ` +
      `Paystack paid out to your bank/Mobile Money account without it being logged here. Check ` +
      `recent orders, refunds and payouts against your Paystack dashboard — this note will not ` +
      `repeat until the shortfall clears.</p>`
    const text =
      `${explanation}\n\n` +
      'This usually means a payment or a transfer registered here never actually reached ' +
      "Paystack's balance — or Paystack paid out to your bank/Mobile Money account without it " +
      'being logged here. Check recent orders, refunds and payouts against your Paystack dashboard ' +
      '— this note will not repeat until the shortfall clears.'

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
      `balance mismatch ${ghs(reconciliation.shortfall)} — told ${recipients.map((r) => r.email).join(', ')}`,
    )
  }

  private async platformName(): Promise<string> {
    const branding = await this.prisma.branding.findFirst({ where: { userId: null } })
    return branding?.shopName ?? 'JamesDataConsult'
  }

  /**
   * The reserve position.
   *
   * `available` is the honest answer to "what can I actually spend": the balance
   * less every obligation. Negative means obligations already exceed the money
   * held — not a rounding matter, a shortfall somebody will eventually ask for.
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
      bundlesBought,
      reimbursedToDataHub,
    ] = await Promise.all([
      this.prisma.user.aggregate({ where: { role: 'agent' }, _sum: { balance: true } }),
      this.prisma.user.aggregate({ where: { role: 'customer' }, _sum: { balance: true } }),
      this.prisma.claimableCredit.aggregate({
        where: { claimed: false },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // "Waiting on a decision" — shown separately below so the Reserve panel
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
       * settles asynchronously — the transfer can sit on `otp`, `unknown`, or
       * `manual` for a real stretch of time, or simply be null for the moment
       * right after approval before it has been attempted at all. Until
       * `transferStatus` reads `success`, the agent has not been paid, so this
       * is still owed exactly like a `pending` request is — it was just
       * missing from here before, which let "Free to spend" briefly overstate
       * what was actually safe to use.
       *
       * `OR: [{ transferStatus: null }, ...]` is deliberate, not redundant:
       * `NOT: { transferStatus: 'success' }` alone silently excludes a null
       * `transferStatus` under SQL's three-valued logic — verified directly
       * against the database — which would have reopened exactly the gap this
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
      // and the bundle is not — so it is either a delivery or a refund, and
      // either way it is not James's to spend.
      this.prisma.order.aggregate({
        where: { status: { in: ['awaiting_approval', 'processing'] } },
        _sum: { salePrice: true },
        _count: { _all: true },
      }),
      // Refunds are authorised by a person, not paid automatically — but the
      // money is owed from the moment the delivery failed, not from the moment
      // somebody clicks approve. Counting it only at approval would make the
      // balance look spendable while a customer was still waiting for it.
      this.prisma.refundRequest.aggregate({
        where: { status: 'pending' },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // Same "approved but not actually sent yet" gap as `stuckPayouts` above,
      // scoped to `method: 'transfer'` — a wallet or claimable refund already
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
      // send — see `FloatMonitorService.outstandingManualRefunds`. Owed back
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
      // an account that cannot send transfers at all) — see
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
      /**
       * Every bundle ever bought, all-time. That money came out of the
       * DataHub float, never out of Paystack directly — the matching customer
       * payment for each one is still sitting in `expectedAtPaystack` in
       * full, untouched. But the float does not refill itself: sooner or
       * later, keeping it funded means moving some of that Paystack money
       * across to replace what buying those bundles has already spent. So it
       * is not free to spend on anything else, even though nothing has
       * physically left Paystack for it yet.
       */
      this.prisma.ledgerEntry.aggregate({
        where: { kind: 'supplier_cost' },
        _sum: { amount: true },
      }),
      /**
       * Money already moved from Paystack to DataHub specifically to settle
       * that spending — see `FloatMonitorService.logCapital`'s `source:
       * 'reimbursement'`. A plain `capital_in` top-up (fresh capital) never
       * counts here: it funds the float further, it does not pay back what
       * buying past bundles already cost.
       */
      this.prisma.ledgerEntry.aggregate({
        where: { kind: 'capital_in_reimbursement' },
        _sum: { amount: true },
      }),
    ])

    const undelivered = heldOrders._sum.salePrice ?? 0
    const owedToAgents = agents._sum.balance ?? 0
    /**
     * Requesting a withdrawal debits the agent's balance immediately (see
     * `WithdrawalsService.request`), so by the time it is sitting here as
     * "pending" or "approved but not sent" it has already left `owedToAgents`
     * above. Left out of the total it would vanish from both sides — same
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
    // supplier_cost entries are stored negative (money leaving the float).
    // Floored at zero: logging more reimbursement than has ever been spent
    // should not turn "already spent on bundles" into a negative number that
    // would add back onto `freeToSpend` instead of merely clearing it.
    const spentOnBundles = Math.max(
      0,
      -(bundlesBought._sum.amount ?? 0) - (reimbursedToDataHub._sum.amount ?? 0),
    )

    const expectedAtPaystack = await this.expectedBalance()

    return {
      /**
       * What our own records say should be at Paystack right now: everything
       * ever collected, net of Paystack's fee, less every payout and refund
       * transfer this platform has actually sent. Never Paystack's own live
       * balance — see the file header.
       */
      expectedAtPaystack,
      /**
       * Every bundle ever bought, all-time — see the query above for why
       * this is subtracted from `freeToSpend` even though none of it ever
       * physically left Paystack.
       */
      spentOnBundles,
      /**
       * What's actually free to spend: `expectedAtPaystack` less every claim
       * already on it, and less everything already spent buying bundles —
       * that money came out of the DataHub float, not Paystack, but keeping
       * the float funded means moving Paystack money across to replace it
       * sooner or later, so it is not free for anything else. Safe to show
       * now in a way the old "Free to spend" figure was not — every part of
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
   * Whether a payout can be honoured right now.
   *
   * Called before approving one, so an agent is told the truth rather than being
   * marked paid against money that is not there. Deliberately advisory: it
   * reports, and the caller decides — refusing outright would let an unreachable
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

  /** All-time, net of Paystack's own fee — every Mobile Money payment ever confirmed paid. */
  private async collectedSince(): Promise<number> {
    const paid = await this.prisma.payment.aggregate({
      where: { status: 'paid' },
      _sum: { amount: true, fee: true },
    })
    return (paid._sum.amount ?? 0) - (paid._sum.fee ?? 0)
  }

  /**
   * All-time pesewas actually transferred out through Paystack — agent
   * payouts and Mobile Money refunds, the two ways money leaves this
   * platform through them.
   *
   * Keyed on `paidAt` (not null) rather than `status`, so a merely approved,
   * not-yet-sent transfer is correctly not counted as having left the
   * balance yet.
   *
   * Both sides also require `transferCode: { not: null }` — a real Paystack
   * transfer always gets one back; neither `RefundsService.settleManually`
   * nor `WithdrawalsService.settleManually` ever sets one, because no
   * Paystack transfer happens there at all. Without this, a manually-settled
   * payout or refund (someone's own pocket covering it because there was
   * nowhere automatic to send it from) looked identical to a real one and
   * was subtracted here as if it had left Paystack's balance — on top of the
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
   * The only place in this service that calls Paystack's live balance —
   * `position()` never does. Returns null, without calling Paystack at all,
   * unless `paystackBusinessAccount` is on — nobody has asked this account to
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
      // Only a real shortage is worth an email — Paystack holding more than
      // expected is not the kind of problem this exists to catch.
      flagged: shortfall > DISCREPANCY_TOLERANCE,
    }
  }

  /**
   * What should be sitting in Paystack's balance right now, entirely from
   * this platform's own records: everything ever collected, net of
   * Paystack's fee, less every payout and refund transfer this platform has
   * actually sent. Always all-time, regardless of account tier or settings —
   * no live call, ever, to compute this.
   */
  private async expectedBalance(): Promise<number> {
    const [collected, transferred] = await Promise.all([
      this.collectedSince(),
      this.transfersSince(),
    ])
    return collected - transferred
  }
}
