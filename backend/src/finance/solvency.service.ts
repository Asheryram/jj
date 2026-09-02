import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PaystackClient } from '../payments/paystack.client'
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
 * and deliberately does not lean on retaining a balance at all: Paystack
 * sweeps whatever is settleable to the linked bank or Mobile Money account at
 * each settlement — fast and automatic on a Starter account, slower and more
 * deliberate on a business one — so the *right* balance to expect right now
 * is never "everything ever owed," it is "whatever our own records say should
 * have piled up since the last time they actually settled." That number stays
 * small and current on any tier, which is what makes a real disagreement with
 * it worth an email: it means something registered here never reached
 * Paystack's balance, or the other way around — a missed webhook, a reversed
 * charge, or worse — not "you have not saved enough profit yet."
 *
 * That comparison is deliberately background-only. `position()` — what the
 * Reserve panel reads — never calls Paystack's live balance at all; it only
 * ever shows what this platform's own records say should be true. The live
 * balance is fetched solely by `reconcile()` / `checkAndAlert()`, and a real
 * mismatch goes to an admin's inbox, not this panel — an account that settles
 * every sale out immediately reads GHS 0.00 between sales as a matter of
 * course, and surfacing that next to "what we expect" on every page load
 * would read as a standing false alarm rather than the rare thing worth an
 * email.
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
  /** `shortfall` exceeds the rounding tolerance in either direction — worth telling someone about. */
  flagged: boolean
}

@Injectable()
export class SolvencyService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(SolvencyService.name)
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackClient,
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
    const short = reconciliation.shortfall > 0
    const shopName = await this.platformName()

    const explanation = short
      ? `Paystack reports ${escape(ghs(reconciliation.observed))}, but your own records say it ` +
        `should hold ${escape(ghs(reconciliation.expected))} since it last settled — ` +
        `${escape(ghs(reconciliation.shortfall))} short.`
      : `Paystack reports ${escape(ghs(reconciliation.observed))}, which is ` +
        `${escape(ghs(-reconciliation.shortfall))} more than your own records say it should hold ` +
        `since it last settled.`

    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${explanation}</p>` +
      `<p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;color:#1e293b">This usually means ` +
      `a payment or a transfer registered here never actually reached Paystack's balance, or the ` +
      `other way around. Check recent orders, refunds and payouts against your Paystack dashboard — ` +
      `this note will not repeat until the mismatch clears.</p>`
    const text =
      `${explanation}\n\n` +
      'This usually means a payment or a transfer registered here never actually reached ' +
      "Paystack's balance, or the other way around. Check recent orders, refunds and payouts " +
      'against your Paystack dashboard — this note will not repeat until the mismatch clears.'

    const subject = short
      ? `Paystack balance is short by ${ghs(reconciliation.shortfall)}`
      : `Paystack balance is ${ghs(-reconciliation.shortfall)} more than expected`
    const html = wrap(
      shopName,
      'Your Paystack balance does not match your records',
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
    const liabilities = owedToAgents + owedToCustomers + undelivered + queuedPayouts + owedForManualRefunds

    /**
     * What should be sitting in Paystack's balance right now, entirely from
     * this platform's own records — never from Paystack's live balance
     * itself. Paystack's own figure is still checked, just not here: it is
     * compared against this same expectation on a clock by `checkAndAlert`,
     * and the result goes to an admin's inbox rather than this panel. A
     * Starter account settles near-instantly, so its live balance reads
     * GHS 0.00 between sales as a matter of course — showing it next to
     * "what we expect" here would read as a permanent false alarm rather
     * than the rare, real mismatch an email is for.
     */
    const settlementResult = await this.paystack.lastSettlementAt()
    const settledSince = settlementResult.ok ? settlementResult.at : null
    const [collected, transferred] = await Promise.all([
      this.collectedSince(settledSince),
      this.transfersSince(settledSince),
    ])
    const expectedAtPaystack = collected - transferred

    return {
      /** What our own records say should be at Paystack right now, net of transfers already sent. */
      expectedAtPaystack,
      /**
       * Paystack is one reservoir: every sale flows in immediately, but nothing
       * flows out to us until their next settlement. This is money already
       * collected, net of their fee, since the last time they actually settled
       * — before subtracting anything already transferred back out.
       */
      inTransit: {
        amount: collected,
        settledSince,
        error: settlementResult.ok ? null : settlementResult.reason,
      },
      liabilities: {
        agentEarnings: owedToAgents,
        customerMoney: owedToCustomers,
        undeliveredOrders: undelivered,
        /** Requested, balance already debited, not yet actually sent. */
        queuedPayouts,
        /** Owed to whoever personally covered a refund Paystack refused to send. */
        manualRefundAdvances: owedForManualRefunds,
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

  /** Net of Paystack's own fee — what will actually land once this settles. */
  private async collectedSince(at: Date | null): Promise<number> {
    const paid = await this.prisma.payment.aggregate({
      where: { status: 'paid', ...(at ? { paidAt: { gt: at } } : {}) },
      _sum: { amount: true, fee: true },
    })
    return (paid._sum.amount ?? 0) - (paid._sum.fee ?? 0)
  }

  /**
   * Pesewas actually transferred out through Paystack since a given moment —
   * agent payouts and Mobile Money refunds, the two ways money leaves this
   * platform through them. Both draw from the same balance that settlement
   * sweeps, so both reduce what's left the same way a settlement does.
   *
   * Keyed on `paidAt` — when Paystack itself confirmed the transfer, not when
   * it was merely approved — because an approved-but-not-yet-sent transfer
   * has not touched their balance yet.
   */
  private async transfersSince(at: Date | null): Promise<number> {
    const [payouts, refunds] = await Promise.all([
      this.prisma.withdrawal.aggregate({
        where: { paidAt: at ? { gt: at } : { not: null } },
        _sum: { amount: true },
      }),
      this.prisma.refundRequest.aggregate({
        where: { method: 'transfer', paidAt: at ? { gt: at } : { not: null } },
        _sum: { amount: true },
      }),
    ])
    return (payouts._sum.amount ?? 0) + (refunds._sum.amount ?? 0)
  }

  /**
   * Does Paystack's live balance agree with what our own records predict?
   *
   * Fetches its own balance and settlement date, for callers — like the
   * background check — who have not already read them for another reason.
   * `position()` computes the same thing via `reconcileAgainst` instead, to
   * avoid asking Paystack for the balance twice in one request.
   */
  async reconcile(): Promise<BalanceReconciliation | null> {
    const [balanceResult, settlementResult] = await Promise.all([
      this.paystack.balance(),
      this.paystack.lastSettlementAt(),
    ])
    if (!balanceResult.ok) return null
    const settledSince = settlementResult.ok ? settlementResult.at : null
    return this.reconcileAgainst(balanceResult.balance, settledSince)
  }

  /**
   * The comparison itself, given a balance and settlement date already in
   * hand. `expected` is entirely derived from this platform's own records —
   * every Mobile Money payment confirmed paid since the last settlement,
   * net of Paystack's fee, less every payout and refund transfer they have
   * since confirmed sent. Right after a settlement this should read close to
   * zero and grow from there until the next one resets it — the same shape
   * `FloatMonitorService.expectedBalance` uses for the DataHub float, applied
   * to Paystack's balance instead.
   */
  private async reconcileAgainst(
    balance: number | null,
    settledSince: Date | null,
  ): Promise<BalanceReconciliation | null> {
    if (balance === null) return null

    const [collected, transferred] = await Promise.all([
      this.collectedSince(settledSince),
      this.transfersSince(settledSince),
    ])
    const expected = collected - transferred
    const shortfall = expected - balance

    return {
      expected,
      observed: balance,
      shortfall,
      flagged: Math.abs(shortfall) > DISCREPANCY_TOLERANCE,
    }
  }
}
