import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { FulfilmentService } from '../orders/fulfilment.service'
import { PaymentsService } from '../payments/payments.service'
import { SupplierService } from './supplier.service'
import { DatahubClient, mapProviderStatus } from './datahub.client'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'

/**
 * Closes orders that DataHub GH accepted but never reported back on.
 *
 * NFR-3.2 / NFR-3.3 — webhooks get lost. They are dropped by a restart, a
 * tunnel that rotated, ten seconds of downtime, or simply never sent. Without
 * this, a lost callback strands a paid order in `processing` forever: the buyer
 * is charged, the agent is not credited, and nobody finds out until someone
 * complains.
 *
 * So the webhook is treated as an optimisation, not as the source of truth. This
 * asks `/order-status` directly for anything that has been waiting too long, and
 * settles through exactly the same ledger code the webhook uses.
 *
 * A plain interval rather than a cron dependency: one job, one cadence, and the
 * timer is unref'd so it never holds the process open.
 */
@Injectable()
export class ReconcilerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(ReconcilerService.name)
  private timer: NodeJS.Timeout | null = null

  /** How often to sweep. Their own guidance is 30–60s polling. */
  private readonly intervalMs = 60_000
  /**
   * How long an order may sit before we chase it. Long enough that the webhook
   * gets first refusal — chasing immediately would double the request volume for
   * no benefit and risk their rate limit.
   */
  private readonly graceMs = 90_000

  /**
   * How long a paid order may wait for the recipient's number to be approved
   * before the money goes back.
   *
   * There has to be a limit. Approval is manual on DataHub's side with no
   * promised turnaround, and their submission endpoint is currently down
   * entirely — so "it will come through shortly" is a hope, not a fact, and
   * holding a stranger's money on it indefinitely is not something the customer
   * agreed to. Six hours is long enough for a same-day approval to land and
   * short enough that nobody is left wondering overnight.
   *
   * Set APPROVAL_HOLD_HOURS to change it; 0 disables the hold entirely and
   * refunds immediately, which is the conservative setting if approvals turn out
   * to be slow.
   */
  private get approvalHoldMs(): number {
    const hours = Number(process.env.APPROVAL_HOLD_HOURS ?? 6)
    return (Number.isFinite(hours) ? Math.max(0, hours) : 6) * 3_600_000
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly datahub: DatahubClient,
    private readonly supplier: SupplierService,
    private readonly fulfilment: FulfilmentService,
    private readonly payments: PaymentsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.sweep().catch((error) => this.log.error(`sweep failed: ${String(error)}`))
    }, this.intervalMs)
    this.timer.unref?.()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /**
   * Close out checkouts nobody paid for — and rescue the ones they did.
   *
   * A customer who opens the Paystack page and walks away leaves an order in
   * `awaiting_payment` for ever, which clutters every report with sales that
   * never happened. Asking Paystack settles it either way: they say `abandoned`
   * and the order closes, or they say `success` — a payment whose webhook went
   * missing — and it is fulfilled, late but correctly.
   *
   * Deliberately generous with the delay. Mobile Money in Ghana involves the
   * customer leaving the browser to approve a prompt on their handset, and
   * closing an order out from under someone still typing their PIN would be
   * worse than leaving it open a while.
   */
  private async resolveAbandonedPayments(): Promise<number> {
    const cutoff = new Date(Date.now() - 15 * 60_000)
    const stale = await this.prisma.order.findMany({
      where: { status: 'awaiting_payment', createdAt: { lt: cutoff } },
      select: { reference: true },
      take: 25,
      orderBy: { createdAt: 'asc' },
    })

    let resolved = 0
    for (const order of stale) {
      const result = await this.payments.confirm(order.reference).catch(() => null)
      if (!result || result.status === 'pending') continue
      this.log.log(`${order.reference}: checkout resolved as ${result.status}`)
      resolved++
    }

    return resolved
  }

  /**
   * Give up on approvals that never came, and record what is owed.
   *
   * The customer paid for a bundle we could not deliver. Whatever the reason sits
   * with the provider, the obligation is ours — so this closes the order through
   * the ordinary rejection path, which queues a refund request for authorisation.
   * It does not pay anybody: money leaving is a decision, and a background job on
   * a timer is not in a position to make it.
   */
  private async expireStaleApprovals(): Promise<number> {
    const holdMs = this.approvalHoldMs
    const expired = await this.prisma.order.findMany({
      where: {
        status: 'awaiting_approval',
        createdAt: { lt: new Date(Date.now() - holdMs) },
      },
      select: { id: true, reference: true, recipient: true },
      take: 25,
      orderBy: { createdAt: 'asc' },
    })

    for (const order of expired) {
      this.log.warn(
        `${order.reference}: ${order.recipient} was never approved within the hold — ` +
          'closing the order and queueing a refund for approval',
      )
      await this.fulfilment.settleFromProvider(
        order.id,
        'rejected',
        'The recipient number was not approved for delivery in time.',
      )
    }

    return expired.length
  }

  /**
   * One pass. Public so it can be triggered by hand from an admin route or a
   * test, rather than only on the clock.
   */
  async sweep(): Promise<{ checked: number; settled: number }> {
    // Payments do not depend on the supplier being live — money can be owed and
    // owing whether or not DataHub is simulated — so these run before the guard
    // below rather than being switched off with it.
    let settled = await this.resolveAbandonedPayments()
    settled += await this.expireStaleApprovals()

    if (!this.supplier.isLive) return { checked: 0, settled }

    const cutoff = new Date(Date.now() - this.graceMs)
    const waiting = await this.prisma.order.findMany({
      where: {
        status: { in: ['pending', 'processing'] },
        providerReference: { not: null },
        createdAt: { lt: cutoff },
      },
      select: { id: true, reference: true, providerReference: true },
      // Bounded so a large backlog cannot blow their rate limit in one sweep.
      take: 25,
      orderBy: { createdAt: 'asc' },
    })

    for (const order of waiting) {
      const result = await this.datahub.orderStatus(order.providerReference as string)

      if (result.kind === 'unavailable') {
        this.log.warn(`could not check ${order.reference}: ${result.reason}`)
        continue
      }

      if (result.kind === 'not_found') {
        // They accepted a reference and now do not recognise it. Never resolved
        // automatically — refunding risks paying back a delivered bundle, and
        // completing risks crediting a sale that never happened.
        this.log.error(
          `${order.reference}: DataHub does not recognise ${order.providerReference} — needs manual checking`,
        )
        continue
      }

      await this.prisma.supplierDispatch.updateMany({
        where: { orderId: order.id, providerReference: order.providerReference },
        data: { providerStatus: result.providerStatus },
      })

      const mapped = mapProviderStatus(result.providerStatus)
      if (mapped === null) continue // still working on it

      await this.fulfilment.settleFromProvider(
        order.id,
        mapped === 'completed' ? 'delivered' : 'rejected',
        `Reconciled: DataHub GH reported ${result.providerStatus}`,
      )
      settled++
      this.log.log(
        `reconciled ${order.reference} → ${mapped} (webhook never arrived; DataHub said ${result.providerStatus})`,
      )
    }

    if (waiting.length > 0) {
      this.log.log(`sweep: checked ${waiting.length}, settled ${settled}`)
    }
    return { checked: waiting.length, settled }
  }

  /**
   * Orders nobody can resolve automatically: dispatched but never given a
   * provider reference, or long past any plausible delivery. Surfaced to admin
   * because each one is money that has moved with no confirmed outcome.
   */
  async needsAttention(olderThanMinutes = 15) {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000)
    const rows = await this.prisma.order.findMany({
      where: { status: { in: ['pending', 'processing'] }, createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true,
        reference: true,
        providerReference: true,
        productName: true,
        recipient: true,
        salePrice: true,
        paidWith: true,
        createdAt: true,
      },
    })

    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      // Without a provider reference we never got a usable reply, so there is
      // nothing to ask them about — this one needs a human looking at their
      // dashboard.
      reason: r.providerReference
        ? 'Accepted by DataHub but never reported back'
        : 'No reply from DataHub — may or may not have been placed',
    }))
  }

  /**
   * Settle an order by hand, when nothing automatic ever will.
   *
   * `sweep()` only resolves an order once DataHub's own status reaches a
   * recognised terminal word — `SUCCESSFUL`, `FAILED`, `CANCELLED`. Anything
   * else, including a status they never change again, is deliberately left
   * alone forever rather than guessed at (see `mapProviderStatus`) — the
   * conservative failure mode is right for automation, but it means a
   * genuinely-delivered order whose provider reply is permanently stuck (a
   * `manual_` reference that needed a person at DataHub to close out, for
   * one real case) has no path to resolution without this. Runs through the
   * exact same `settleFromProvider` the webhook and the sweep use, so the
   * ledger, agent crediting, and the split invariant are all still correct
   * regardless of which of the three ever actually decides an order.
   */
  async resolveManually(
    orderId: string,
    outcome: 'delivered' | 'rejected',
    adminId: string,
    note: string,
  ): Promise<void> {
    const reason = note.trim()
    if (reason.length < 5) {
      throw new ValidationError('Say why you are resolving this by hand. It is kept on the record.')
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, reference: true },
    })
    if (!order) throw new NotFoundError('We could not find that order.')
    if (order.status !== 'pending' && order.status !== 'processing') {
      throw new ConflictError('ALREADY_SETTLED', `That order is already ${order.status}.`)
    }

    this.log.warn(`${order.reference}: resolved by hand as ${outcome} by ${adminId} — ${reason}`)
    await this.fulfilment.settleFromProvider(orderId, outcome, `Marked ${outcome} by hand — ${reason}`)
  }
}
