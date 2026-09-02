import { Injectable, Logger } from '@nestjs/common'
import type { Network, WithdrawalStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../finance/ledger.service'
import { SolvencyService } from '../finance/solvency.service'
import { PaystackClient } from '../payments/paystack.client'
import { momoCodeFor } from '../payments/momo'

import { toWithdrawal } from '../common/mappers'
import {
  ConflictError,
  InsufficientBalanceError,
  NotFoundError,
  ValidationError,
} from '../common/domain-errors'
import type { AuthUser } from '../common/auth'
import { momoLabel } from '../wallet/wallet.service'
import { isAdminRole } from '../common/auth'

/** FR-2.6 — the smallest amount worth a manual MoMo transfer. */
const MIN_WITHDRAWAL = 1000 // GHS 10.00

@Injectable()
export class WithdrawalsService {
  private readonly log = new Logger(WithdrawalsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly solvency: SolvencyService,
    private readonly paystack: PaystackClient,
  ) {}

  async list(user: AuthUser) {
    // An agent sees only their own requests; James sees the whole queue.
    const rows = await this.prisma.withdrawal.findMany({
      where: isAdminRole(user.role) ? {} : { userId: user.id },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    })
    return rows.map(toWithdrawal)
  }

  /**
   * FR-2.6 — request a payout.
   *
   * The balance is held the moment the request is made, not when James approves
   * it. Otherwise an agent could request their whole balance twice and, if both
   * were approved, be paid twice for money they only earned once.
   */
  async request(user: AuthUser, amount: number, momoNetwork: Network, momoNumber: string) {
    if (!Number.isInteger(amount) || amount < MIN_WITHDRAWAL) {
      throw new ValidationError(
        `The smallest withdrawal is GHS ${(MIN_WITHDRAWAL / 100).toFixed(2)}.`,
      )
    }

    return this.prisma.$transaction(async (tx) => {
      const pending = await tx.withdrawal.count({
        where: { userId: user.id, status: 'pending' },
      })
      if (pending >= 3) {
        throw new ConflictError(
          'TOO_MANY_PENDING',
          'You already have three requests waiting for review. James clears them within 24 hours.',
        )
      }

      // Same conditional-update discipline as the wallet debit: Postgres decides
      // whether the balance covers it, so two simultaneous requests cannot both
      // pass a stale check.
      // `id` is TEXT, not uuid — Prisma maps String @id to text, so no cast here.
      const affected = await tx.$executeRaw`
        UPDATE users SET balance = balance - ${amount}
        WHERE id = ${user.id} AND balance >= ${amount}
      `

      if (affected === 0) {
        const current = await tx.user.findUnique({
          where: { id: user.id },
          select: { balance: true },
        })
        throw new InsufficientBalanceError(current?.balance ?? 0, amount, 'withdrawal')
      }

      const after = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { balance: true, name: true, phone: true },
      })

      const row = await tx.withdrawal.create({
        data: {
          userId: user.id,
          agentName: after.name,
          // The number the agent asked to be paid on, not whatever their profile
          // says — see RequestWithdrawalDto.momoNumber.
          agentPhone: momoNumber,
          amount,
          momoNetwork,
          status: 'pending',
        },
      })

      // The debit is recorded now, described as held rather than paid — the agent
      // must be able to see where the money went in their own ledger.
      await tx.earning.create({
        data: {
          userId: user.id,
          type: 'withdrawal',
          amount: -amount,
          balanceAfter: after.balance,
          description: `Withdrawal requested · ${momoLabel(momoNetwork)} ${after.phone}`,
          reference: `WDR-${row.id.slice(0, 8).toUpperCase()}`,
          depth: 0,
        },
      })

      return toWithdrawal(row)
    })
  }

  /**
   * FR-6.5 — James approves or rejects.
   *
   * Approval is a bookkeeping act: the money was already deducted at request
   * time. The MoMo transfer itself is still made by hand on Paystack — approving
   * here debits the agent's balance and records the payout, it does not move the
   * money. Paystack's Transfer API would automate it; until then the balance is
   * checked first so an agent is never marked paid against money that is not there.
   * Rejection is what has to move money — it puts the held amount back.
   */
  async decide(id: string, status: WithdrawalStatus) {
    if (status !== 'approved' && status !== 'rejected') {
      throw new ValidationError('A withdrawal is either approved or rejected.')
    }

    // Checked before the transaction, because it is an outbound HTTP call and a
    // transaction must never be held open across one.
    if (status === 'approved') {
      const pending = await this.prisma.withdrawal.findUnique({ where: { id } })
      if (pending?.status === 'pending') {
        const check = await this.solvency.canPayout(pending.amount)
        if (!check.ok && check.reason) {
          throw new ConflictError('INSUFFICIENT_PAYOUT_BALANCE', check.reason)
        }
      }
    }

    const decided = await this.prisma.$transaction(async (tx) => {
      const row = await tx.withdrawal.findUnique({ where: { id } })
      if (!row) throw new NotFoundError('We could not find that withdrawal request.')

      if (row.status !== 'pending') {
        throw new ConflictError(
          'ALREADY_DECIDED',
          `That request was already ${row.status}.`,
        )
      }

      const updated = await tx.withdrawal.update({
        where: { id },
        data: { status, decidedAt: new Date() },
      })

      if (status === 'rejected') {
        const after = await tx.user.update({
          where: { id: row.userId },
          data: { balance: { increment: row.amount } },
          select: { balance: true },
        })

        // Typed `withdrawal` rather than `sale` — it is not income, it is the
        // hold being released. The Earnings page groups it with the request it
        // cancels, which is where a reader looks for it.
        await tx.earning.create({
          data: {
            userId: row.userId,
            type: 'withdrawal',
            amount: row.amount,
            balanceAfter: after.balance,
            description: 'Withdrawal rejected — amount returned to your balance',
            reference: `WDR-${row.id.slice(0, 8).toUpperCase()}-R`,
            depth: 0,
          },
        })
      }

      if (status === 'approved') {
        // Cash out, but NOT a cost: this margin was booked as a cost the moment
        // the sale completed. Recording it again here would charge the business
        // twice for the same earning — which is exactly what `affectsProfit`
        // exists to prevent.
        await this.ledger.record(
          [
            {
              idempotencyKey: LedgerService.key('withdrawal', row.id, 'payout'),
              kind: 'payout',
              amount: -row.amount,
              affectsProfit: false,
              description: `Paid out to ${row.agentName} · ${row.agentPhone}`,
              withdrawalId: row.id,
              userId: row.userId,
              occurredAt: new Date(),
            },
          ],
          tx,
        )
      }

      this.log.log(`withdrawal ${id} ${status}`)
      return toWithdrawal(updated)
    })

    // Committed. Now actually send the money.
    //
    // Outside the transaction on purpose: this is an outbound HTTP call, and
    // holding a transaction open across one blocks every other write on these
    // rows for as long as Paystack takes to answer.
    if (status === 'approved') {
      await this.sendPayout(id).catch((error) => {
        // A failure here does not undo the approval — the decision was made and
        // the agent's balance is already debited. `sendPayout` handles a refusal
        // by giving the money back; this only catches the unexpected.
        this.log.error(`payout for ${id} threw: ${String(error)}`)
      })
    }

    return decided
  }

  /**
   * Pay an approved withdrawal out to the agent's Mobile Money.
   *
   * The agent's balance was debited when they asked, so nothing is deducted here
   * — this moves money that is already accounted for. Three outcomes, and each
   * has to leave the books honest:
   *
   *  · **Accepted.** The withdrawal stays `approved` and waits for Paystack's
   *    webhook to say `paid` or `failed`. Approved is not delivered.
   *  · **Refused.** Nothing left the account, so the agent gets their balance
   *    back immediately and the request is marked failed with the reason.
   *  · **Unknown.** No usable answer. Nothing is returned and nothing is retried,
   *    because the money may be on its way — the same rule as a supplier dispatch,
   *    and for the same reason: paying twice is worse than paying late.
   */
  private async sendPayout(withdrawalId: string): Promise<void> {
    const row = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } })
    if (!row || row.status !== 'approved') return

    // Already handed over. Guards a double approval or a retried request from
    // creating a second transfer.
    if (row.transferCode) {
      this.log.warn(`payout ${withdrawalId} already has a transfer — not sending again`)
      return
    }

    if (!this.paystack.configured) {
      await this.prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          transferStatus: 'manual',
          transferNote:
            'No Paystack key on this server, so this one has to be sent by hand.',
        },
      })
      this.log.warn(`payout ${withdrawalId} left for manual sending — Paystack is not configured`)
      return
    }

    const networkCode = momoCodeFor(row.momoNetwork)
    if (!networkCode) {
      await this.failPayout(row.id, `We do not know how to pay out to ${row.momoNetwork}.`)
      return
    }

    // One recipient per agent number, reused across payouts.
    let recipientCode = row.recipientCode
    if (!recipientCode) {
      const existing = await this.prisma.withdrawal.findFirst({
        where: { agentPhone: row.agentPhone, recipientCode: { not: null } },
        select: { recipientCode: true },
      })
      recipientCode = existing?.recipientCode ?? null
    }

    if (!recipientCode) {
      const created = await this.paystack.createRecipient({
        name: row.agentName,
        phone: row.agentPhone,
        networkCode,
      })
      if (!created.ok) {
        await this.failPayout(row.id, `Paystack would not accept the number: ${created.reason}`)
        return
      }
      recipientCode = created.recipientCode
    }

    await this.prisma.withdrawal.update({
      where: { id: row.id },
      data: { recipientCode },
    })

    /**
     * The reference is derived from the withdrawal, never from the clock.
     *
     * Paystack rejects a duplicate reference, so this is what makes a retry safe:
     * the same withdrawal can only ever produce one transfer, however many times
     * this runs.
     */
    const result = await this.paystack.transfer({
      recipientCode,
      amount: row.amount,
      reference: `WDR-${row.id}`,
      reason: `${row.agentName} — agent earnings`,
    })

    if (result.kind === 'sent') {
      // Guarded on still being `approved`: `paystack.transfer()` can take up to
      // 30 seconds, long enough for their webhook to arrive and resolve this
      // withdrawal first. An unconditional write here would then clobber a
      // real `transferStatus: 'success'` back to whatever this stale reply
      // says, purely a bookkeeping inconsistency — `status` itself is untouched
      // either way — but a needless one to leave in.
      await this.prisma.withdrawal.updateMany({
        where: { id: row.id, status: 'approved' },
        data: { transferCode: result.transferCode, transferStatus: result.status },
      })
      this.log.log(
        `payout ${row.id}: GHS ${(row.amount / 100).toFixed(2)} sent to ${row.agentPhone} (${result.status})`,
      )
      return
    }

    if (result.kind === 'otp') {
      // Not a failure and not a success. The money has not moved and cannot
      // without somebody typing a code, so it is left visible rather than
      // silently stuck or wrongly reversed.
      await this.prisma.withdrawal.update({
        where: { id: row.id },
        data: {
          transferCode: result.transferCode,
          transferStatus: 'otp',
          transferNote:
            'Paystack is asking for an OTP for every transfer. Turn transfer OTP off in ' +
            'your Paystack dashboard (Settings → Preferences) for payouts to send themselves, ' +
            'or approve this one in their dashboard.',
        },
      })
      this.log.error(`payout ${row.id} is waiting for an OTP in the Paystack dashboard`)
      return
    }

    if (result.kind === 'failed') {
      await this.failPayout(
        row.id,
        result.insufficientBalance
          ? 'Your Paystack balance could not cover this payout. Top up and approve it again.'
          : result.reason,
      )
      return
    }

    // unknown — may or may not have been created.
    await this.prisma.withdrawal.update({
      where: { id: row.id },
      data: {
        transferStatus: 'unknown',
        transferNote:
          `We did not get an answer from Paystack: ${result.reason} The money may be on its ` +
          'way. Check the transfer in their dashboard before doing anything else — do not ' +
          'approve it again.',
      },
    })
    this.log.error(`payout ${row.id} unresolved and NOT retried: ${result.reason}`)
  }

  /**
   * Give the money back, because it never left.
   *
   * The agent's balance was debited when they asked, so a refused transfer means
   * they are down the amount and nobody has it. Returning it is the whole point
   * of distinguishing a refusal from an unknown outcome.
   */
  private async failPayout(withdrawalId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.withdrawal.findUnique({ where: { id: withdrawalId } })
      if (!row || row.status === 'failed' || row.status === 'paid') return

      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'failed', transferStatus: 'failed', transferNote: reason },
      })

      const after = await tx.user.update({
        where: { id: row.userId },
        data: { balance: { increment: row.amount } },
        select: { balance: true },
      })

      await tx.earning.create({
        data: {
          userId: row.userId,
          type: 'withdrawal',
          amount: row.amount,
          balanceAfter: after.balance,
          description: 'Payout could not be sent — amount returned to your balance',
          reference: `WDR-${row.id.slice(0, 8).toUpperCase()}-F`,
          depth: 0,
        },
      })

      // The payout line comes back off the books too: no money left the platform.
      await tx.ledgerEntry.deleteMany({
        where: { idempotencyKey: LedgerService.key('withdrawal', row.id, 'payout') },
      })
    })

    this.log.warn(`payout ${withdrawalId} failed and was returned: ${reason}`)
  }
}
