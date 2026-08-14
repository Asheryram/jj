import { Injectable, Logger } from '@nestjs/common'
import type { Network, WithdrawalStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { toWithdrawal } from '../common/mappers'
import {
  ConflictError,
  InsufficientBalanceError,
  NotFoundError,
  ValidationError,
} from '../common/domain-errors'
import type { AuthUser } from '../common/auth'
import { momoLabel } from '../wallet/wallet.service'

/** FR-2.6 — the smallest amount worth a manual MoMo transfer. */
const MIN_WITHDRAWAL = 1000 // GHS 10.00

@Injectable()
export class WithdrawalsService {
  private readonly log = new Logger(WithdrawalsService.name)

  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    // An agent sees only their own requests; James sees the whole queue.
    const rows = await this.prisma.withdrawal.findMany({
      where: user.role === 'admin' ? {} : { userId: user.id },
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
  async request(user: AuthUser, amount: number, momoNetwork: Network) {
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
        throw new InsufficientBalanceError(current?.balance ?? 0, amount)
      }

      const after = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { balance: true, name: true, phone: true },
      })

      const row = await tx.withdrawal.create({
        data: {
          userId: user.id,
          agentName: after.name,
          agentPhone: after.phone,
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
   * time, and the actual MoMo transfer happens outside this system in v1.
   * Rejection is what has to move money — it puts the held amount back.
   */
  async decide(id: string, status: WithdrawalStatus) {
    if (status !== 'approved' && status !== 'rejected') {
      throw new ValidationError('A withdrawal is either approved or rejected.')
    }

    return this.prisma.$transaction(async (tx) => {
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

      this.log.log(`withdrawal ${id} ${status}`)
      return toWithdrawal(updated)
    })
  }
}
