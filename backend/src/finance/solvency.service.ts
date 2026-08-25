import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PaystackClient } from '../payments/paystack.client'

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
@Injectable()
export class SolvencyService {
  private readonly log = new Logger(SolvencyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackClient,
  ) {}

  /**
   * The reserve position.
   *
   * `available` is the honest answer to "what can I actually spend": the balance
   * less every obligation. Negative means obligations already exceed the money
   * held — not a rounding matter, a shortfall somebody will eventually ask for.
   */
  async position() {
    const [agents, customerWallets, credits, pendingPayouts, heldOrders, pendingRefunds] =
      await Promise.all([
      this.prisma.user.aggregate({ where: { role: 'agent' }, _sum: { balance: true } }),
      this.prisma.user.aggregate({ where: { role: 'customer' }, _sum: { balance: true } }),
      this.prisma.claimableCredit.aggregate({
        where: { claimed: false },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: 'pending' },
        _sum: { amount: true },
        _count: { _all: true },
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
    ])

    const owedToAgents = agents._sum.balance ?? 0
    const owedToCustomers =
      (customerWallets._sum.balance ?? 0) +
      (credits._sum.amount ?? 0) +
      (pendingRefunds._sum.amount ?? 0)
    const undelivered = heldOrders._sum.salePrice ?? 0
    const liabilities = owedToAgents + owedToCustomers + undelivered

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
