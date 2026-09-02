import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PaystackClient } from '../payments/paystack.client'
import { MailerService } from '../mail/mailer.service'
import { escape, wrap } from '../mail/templates'

/**
 * What is owed, against what there is to pay it with.
 *
 * The problem this exists for is not a bug in any one place — it is that money
 * arriving from customers all lands in a single Paystack balance, and four
 * different claims are made on it:
 *
 *  · agent earnings, which are theirs and merely held by us,
 *  · refunds owed to customers whose orders failed,
 *  · customer wallet balances, which are theirs and not yet spent,
 *  · and the supplier float plus James's own profit, which genuinely are his.
 *
 * Only the last is free to spend. Nothing in the system enforced that, so topping
 * up DataHub float or drawing profit could quietly consume money that belongs to
 * an agent — and the shortfall only shows up when someone asks to be paid.
 *
 * There is no way to segregate it at the provider: Paystack settles to one
 * account, and splitting at collection would pay agents for orders that later
 * fail. So the fix is accounting rather than plumbing — compute the reserve, make
 * it unmissable, and check it before promising anybody money.
 */
const SHORTFALL_ALERTED_KEY = 'solvencyShortfallAlerted'
/** Half an hour. This drifts slowly compared to the float, which is checked on every order. */
const CHECK_INTERVAL_MS = 30 * 60_000

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
    const snapshot = await this.position()
    // Unknown is not a shortfall — Paystack being briefly unreachable must
    // never itself trigger a "you are short" email.
    if (snapshot.covered === null) return

    const wasAlerted = await this.wasAlerted()
    if (!snapshot.covered && !wasAlerted) {
      await this.setAlerted(true)
      await this.alertShortfall(snapshot)
    } else if (snapshot.covered && wasAlerted) {
      await this.setAlerted(false)
      this.log.log('solvency shortfall cleared')
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

  /** Tell whoever can act on it that money held cannot cover what is owed. */
  private async alertShortfall(snapshot: Awaited<ReturnType<SolvencyService['position']>>): Promise<void> {
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
      this.log.warn('solvency shortfall — nobody to tell')
      return
    }

    const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`
    const held = snapshot.balance ?? 0
    const shortfall = snapshot.liabilities.total - held
    const shopName = await this.platformName()

    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">Paystack is holding ` +
      `${escape(ghs(held))}, but ${escape(ghs(snapshot.liabilities.total))} is owed to agents, ` +
      `customers, and pending obligations — ${escape(ghs(shortfall))} short.</p>` +
      `<p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;color:#1e293b">Do not top up the ` +
      `supplier float or draw profit until this clears. Check the Reserve panel for the breakdown — ` +
      `this note will not repeat until the shortfall is resolved.</p>`
    const text =
      `Paystack is holding ${ghs(held)}, but ${ghs(snapshot.liabilities.total)} is owed to agents, ` +
      `customers, and pending obligations — ${ghs(shortfall)} short.\n\n` +
      'Do not top up the supplier float or draw profit until this clears. Check the Reserve panel ' +
      'for the breakdown — this note will not repeat until the shortfall is resolved.'

    const subject = `Not enough held to cover what is owed — short by ${ghs(shortfall)}`
    const html = wrap(
      shopName,
      'Money held cannot cover what is owed',
      body,
      `You are getting this because you are an active admin on ${escape(shopName)}.`,
    )

    for (const recipient of recipients) {
      await this.mailer
        .send({ to: recipient.email, subject, html, text })
        .catch((error) =>
          this.log.error(`could not tell ${recipient.email} about the shortfall: ${String(error)}`),
        )
    }

    this.log.warn(
      `solvency shortfall ${ghs(shortfall)} — told ${recipients.map((r) => r.email).join(', ')}`,
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

    const [balanceResult, settlementResult] = await Promise.all([
      this.paystack.balance(),
      this.paystack.lastSettlementAt(),
    ])
    const balance = balanceResult.ok ? balanceResult.balance : null
    const settledSince = settlementResult.ok ? settlementResult.at : null
    const inTransit = await this.collectedSince(settledSince)

    return {
      /** What Paystack holds. Null when they could not be reached — not zero. */
      balance,
      balanceError: balanceResult.ok ? null : balanceResult.reason,
      /**
       * Paystack is one reservoir: every sale flows in immediately, but nothing
       * flows out to us until their next settlement. `balance` only ever answers
       * "what can I spend right now" — a sale from ten minutes ago is real money,
       * just not yet in that number. This is the difference: money already
       * collected, net of their fee, since the last time they actually settled.
       */
      inTransit: {
        amount: inTransit,
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
      /** Balance less every obligation. What is genuinely free to spend. */
      available: balance === null ? null : balance - liabilities,
      /** Whether the money held covers what is owed. */
      covered: balance === null ? null : balance >= liabilities,
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
}
