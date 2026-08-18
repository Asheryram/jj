import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Network } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { PaymentsService } from '../payments/payments.service'
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
    private readonly payments: PaymentsService,
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
   * With a Paystack key this returns somewhere to pay and credits nothing: the
   * wallet moves only when Paystack tells our server the money arrived, through
   * a signed webhook or our own verify call. The browser saying "it worked" is
   * never proof of payment (skills-breakdown.md §4.4.2).
   *
   * Without a key it credits directly, which is the right stand-in for
   * acceptance testing and is announced at boot. It used to *refuse* when a key
   * was present, which was the safe half of the job and left the wallet unusable
   * the moment real credentials arrived.
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
      // Real money. Hand back a payment page; the credit happens on confirmation.
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, phone: true, email: true },
      })
      const { reference, paymentUrl } = await this.payments.startTopUp(user, amount)
      this.log.log(`top-up ${reference} started: ${amount}p for ${userId}`)
      return { paymentUrl, reference }
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
