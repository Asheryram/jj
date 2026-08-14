import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Network } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { toTransaction } from '../common/mappers'
import { ValidationError } from '../common/domain-errors'

/** Smallest and largest single top-up. Keeps a fat-fingered amount recoverable. */
const MIN_TOPUP = 100 // GHS 1.00
const MAX_TOPUP = 500_000 // GHS 5,000.00

@Injectable()
export class WalletService {
  private readonly log = new Logger(WalletService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get paystackLive(): boolean {
    return Boolean(this.config.get<string>('PAYSTACK_SECRET_KEY'))
  }

  /** FR-2.1 / FR-2.4 — balance and ledger together; the page shows both. */
  async summary(userId: string) {
    const [user, rows] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { balance: true },
      }),
      this.prisma.transaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ])

    return { balance: user.balance, transactions: rows.map(toTransaction) }
  }

  /**
   * FR-2.2 — top up.
   *
   * With no Paystack key this credits the wallet directly, which is the correct
   * stand-in for acceptance testing but is NOT the production flow. Live, the
   * client initialises a transaction, the user pays, and the wallet is credited
   * only from the verified webhook — the browser saying "it worked" is never
   * proof of payment (skills-breakdown.md §4.4.2). The seam is here: swap the
   * body of this method for `initialise()` returning an authorisation URL, and
   * move the credit into the webhook handler.
   */
  async topUp(userId: string, amount: number, network: Network) {
    if (!Number.isInteger(amount) || amount < MIN_TOPUP) {
      throw new ValidationError(`The smallest top-up is GHS ${(MIN_TOPUP / 100).toFixed(2)}.`)
    }
    if (amount > MAX_TOPUP) {
      throw new ValidationError(
        `The largest single top-up is GHS ${(MAX_TOPUP / 100).toFixed(2)}. Split it into smaller amounts.`,
      )
    }

    if (this.paystackLive) {
      // Refuse rather than credit for free. If a key is configured, somebody
      // expects real money to move, and silently faking it here would be the
      // free-money bug the skills doc warns about.
      throw new ValidationError(
        'Paystack is configured, so top-ups must go through the payment flow. Direct crediting is disabled.',
      )
    }

    const reference = `PSK-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: amount } },
        select: { balance: true },
      })

      const row = await tx.transaction.create({
        data: {
          userId,
          type: 'topup',
          amount,
          balanceAfter: updated.balance,
          description: `Wallet top-up · ${momoLabel(network)}`,
          reference,
        },
      })

      return { balance: updated.balance, transaction: toTransaction(row) }
    })

    this.log.log(`simulated top-up ${reference}: +${amount}p for ${userId}`)
    return result
  }
}

export function momoLabel(network: Network): string {
  if (network === 'MTN') return 'MTN MoMo'
  if (network === 'Telecel') return 'Telecel Cash'
  return 'AirtelTigo Money'
}
