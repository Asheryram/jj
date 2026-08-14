import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SupplierService } from '../supplier/supplier.service'
import type { OrderSplit, SplitShare } from '../domain/pricing'

/**
 * Moves an order out of `processing` once the provider answers, and settles all
 * the money that depends on that answer.
 *
 * In production this is a BullMQ worker driven by the DataHub GH callback
 * (FR-4.4). Here it is an in-process timer calling the simulated adapter — same
 * boundary, same states, same ledger writes, so swapping the transport later does
 * not touch `settle()`.
 */
@Injectable()
export class FulfilmentService implements OnApplicationBootstrap {
  private readonly log = new Logger(FulfilmentService.name)
  private readonly pending = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly supplier: SupplierService,
  ) {}

  /**
   * NFR-3.2 / NFR-3.3 — recover orders that were mid-flight when the process
   * stopped. Without this an API restart during acceptance testing leaves paid
   * orders stuck in `processing` forever, with the money already debited.
   */
  async onApplicationBootstrap(): Promise<void> {
    const stranded = await this.prisma.order.findMany({
      where: { status: { in: ['pending', 'processing'] } },
      select: { id: true, reference: true },
      take: 200,
    })

    if (stranded.length === 0) return

    this.log.warn(`recovering ${stranded.length} order(s) left in processing by a restart`)
    // Staggered so a large backlog does not open 200 transactions at once.
    stranded.forEach((order, index) => this.schedule(order.id, 500 + index * 150))
  }

  /** Ask the provider after its usual latency. */
  scheduleFor(orderId: string): void {
    this.schedule(orderId, this.supplier.delayMs)
  }

  private schedule(orderId: string, delayMs: number): void {
    // Guard against two timers for one order — a recovery sweep racing a fresh
    // placement would otherwise dispatch twice.
    if (this.pending.has(orderId)) return

    const timer = setTimeout(() => {
      this.pending.delete(orderId)
      void this.run(orderId).catch((error) =>
        this.log.error(`fulfilment failed for ${orderId}: ${String(error)}`),
      )
    }, delayMs)

    // Do not hold the event loop open on shutdown for a pending simulated call.
    timer.unref?.()
    this.pending.set(orderId, timer)
  }

  private async run(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) return

    // Idempotency: a replayed callback, a recovery sweep, and the original timer
    // can all arrive. Only a non-terminal order is still settleable.
    if (order.status === 'completed' || order.status === 'failed') return

    const result = await this.supplier.dispatch(order)
    await this.settle(orderId, result.outcome, result.reason, result.voucher)
  }

  /**
   * Apply the provider's answer and settle every account it touches, in one
   * transaction. Either the order completes and everybody in the chain is
   * credited, or it fails and everybody is made whole — never half of each.
   */
  private async settle(
    orderId: string,
    outcome: 'delivered' | 'rejected',
    reason?: string,
    voucher?: { serial: string; pin: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Re-read inside the transaction; the status may have moved since dispatch.
      const order = await tx.order.findUnique({ where: { id: orderId } })
      if (!order || order.status === 'completed' || order.status === 'failed') return

      const split = order.split as unknown as OrderSplit
      const agentShares = split.shares.filter((s) => s.role === 'agent' && s.margin > 0)

      if (outcome === 'delivered') {
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'completed',
            completedAt: new Date(),
            voucherSerial: voucher?.serial ?? null,
            voucherPin: voucher?.pin ?? null,
          },
        })

        // Split-at-sale: the seller's margin and their referrer's bonus are both
        // credited the moment the order completes, so an agent sees a referral
        // bonus land without anybody running a payout job.
        for (const share of agentShares) {
          await this.creditAgent(tx, share, order.reference, order.productName, order.recipient)
        }
        return
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: 'failed', refunded: true },
      })

      // FR-2.7 — the buyer's money goes back before anything else is considered.
      if (order.paidWith === 'wallet' && order.buyerUserId) {
        await this.refundWallet(tx, order.buyerUserId, order.salePrice, order.reference, order.productName)
      } else {
        // A Mobile Money payer has no wallet to credit, and reversing a MoMo
        // collection is neither instant nor guaranteed. So the amount is held
        // against their number as a claimable credit and they are sent a link —
        // NFR-3.3 without depending on a reversal that may never land.
        await tx.claimableCredit.upsert({
          where: { reference: order.reference },
          create: {
            phone: order.buyerPhone,
            amount: order.salePrice,
            reference: order.reference,
          },
          update: {},
        })
      }

      // Nobody profits from a failed delivery.
      for (const share of agentShares) {
        await this.reverseAgent(tx, share, order.reference, order.productName)
      }

      this.log.warn(`refunded ${order.reference}: ${reason ?? 'provider rejected'}`)
    })
  }

  /**
   * Credit one agent's margin and append the ledger row.
   *
   * The `(userId, reference, type)` unique index makes this safe to run twice:
   * a duplicated callback hits the constraint and the balance is not touched
   * again. Checked first so a legitimate re-run is a no-op rather than a 500.
   */
  private async creditAgent(
    tx: Prisma.TransactionClient,
    share: SplitShare,
    reference: string,
    productName: string,
    recipient: string,
  ): Promise<void> {
    const type = share.depth === 0 ? 'sale' : 'downline'

    const already = await tx.earning.findUnique({
      where: { userId_reference_type: { userId: share.userId, reference, type } },
      select: { id: true },
    })
    if (already) return

    // The agent may have been deleted between placement and settlement.
    const agent = await tx.user.findUnique({
      where: { id: share.userId },
      select: { id: true },
    })
    if (!agent) {
      this.log.warn(`share for missing user ${share.userId} on ${reference} — skipped`)
      return
    }

    const updated = await tx.user.update({
      where: { id: share.userId },
      data: { balance: { increment: share.margin } },
      select: { balance: true },
    })

    await tx.earning.create({
      data: {
        userId: share.userId,
        type,
        amount: share.margin,
        balanceAfter: updated.balance,
        description:
          share.depth === 0
            ? `Your sale · ${productName} → ${recipient}`
            // depth 1 is the seller's referrer, paid a bonus out of James's
            // margin rather than a margin of their own.
            : `Referral bonus · ${productName} sold by your referral`,
        productName,
        reference,
        depth: share.depth,
      },
    })
  }

  private async reverseAgent(
    tx: Prisma.TransactionClient,
    share: SplitShare,
    reference: string,
    productName: string,
  ): Promise<void> {
    const already = await tx.earning.findUnique({
      where: { userId_reference_type: { userId: share.userId, reference, type: 'reversal' } },
      select: { id: true },
    })
    if (already) return

    const agent = await tx.user.findUnique({
      where: { id: share.userId },
      select: { balance: true },
    })
    if (!agent) return

    // A reversal must never drive a balance negative — the agent may already have
    // withdrawn. Clamp to what is actually there and log the shortfall rather
    // than letting CHECK (balance >= 0) abort the whole refund.
    const recoverable = Math.min(share.margin, agent.balance)
    if (recoverable < share.margin) {
      this.log.warn(
        `partial reversal on ${reference}: wanted ${share.margin}p, recovered ${recoverable}p from ${share.userId}`,
      )
    }
    if (recoverable === 0) return

    const updated = await tx.user.update({
      where: { id: share.userId },
      data: { balance: { decrement: recoverable } },
      select: { balance: true },
    })

    await tx.earning.create({
      data: {
        userId: share.userId,
        type: 'reversal',
        amount: -recoverable,
        balanceAfter: updated.balance,
        description: `Reversed · ${productName} failed at provider`,
        productName,
        reference,
        depth: share.depth,
      },
    })
  }

  private async refundWallet(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    reference: string,
    productName: string,
  ): Promise<void> {
    const already = await tx.transaction.findUnique({
      where: { userId_reference_type: { userId, reference, type: 'refund' } },
      select: { id: true },
    })
    if (already) return

    const updated = await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: amount } },
      select: { balance: true },
    })

    await tx.transaction.create({
      data: {
        userId,
        type: 'refund',
        amount,
        balanceAfter: updated.balance,
        description: `Refund · ${productName} failed at provider`,
        reference,
      },
    })
  }
}
