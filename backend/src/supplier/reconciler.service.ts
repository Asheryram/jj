import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { FulfilmentService } from '../orders/fulfilment.service'
import { PaymentsService } from '../payments/payments.service'
import { SupplierService } from './supplier.service'
import { DatahubClient, mapProviderStatus } from './datahub.client'
import { MailerService } from '../mail/mailer.service'
import { escape, wrap } from '../mail/templates'
import { appUrl } from '../common/app-links'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'

/**
 * Closes orders that DataHub GH accepted but never reported back on.
 *
 * NFR-3.2 / NFR-3.3, webhooks get lost. They are dropped by a restart, a
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

  /**
   * How often to sweep.
   *
   * DataHub's own guidance for the order-status chase is 30-60s, but the
   * other three checks here (abandoned payments, stale top-ups, stale
   * approvals) already have their own 15-minute-plus staleness windows
   * before anything becomes actionable, checking those every 60s finds
   * nothing new that checking every 10 minutes would not have found within
   * a few minutes anyway. A 60s cadence also sat well inside Neon's
   * 5-minute autosuspend window, so the database compute could never go
   * idle long enough to scale down. Landing exactly on 5 minutes would not
   * reliably fix that either, ordinary timing jitter means the gap between
   * sweeps is sometimes a hair under the threshold, never quite earning a
   * suspend. Ten minutes gives a real, comfortable margin past it.
   *
   * This no longer has to also be fast enough for a customer watching their
   * own receipt page, see `checkOrderNow`, which handles that case directly
   * and is what actually keeps a lost webhook resolving live on screen. This
   * interval only has to be fast enough for orders nobody is watching.
   */
  private readonly intervalMs = 10 * 60_000
  /**
   * How long an order may sit before we chase it. Long enough that the webhook
   * gets first refusal, chasing immediately would double the request volume for
   * no benefit and risk their rate limit.
   */
  private readonly graceMs = 90_000
  /** Keyed by order id. See `checkOrderNow`'s own comment for why this throttles it. */
  private readonly lastProviderCheckAt = new Map<string, number>()
  private static readonly MIN_PROVIDER_CHECK_GAP_MS = 30_000

  /**
   * How long a paid order may wait for the recipient's number to be approved
   * before the money goes back.
   *
   * There has to be a limit. Approval is manual on DataHub's side with no
   * promised turnaround, and their submission endpoint is currently down
   * entirely, so "it will come through shortly" is a hope, not a fact, and
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
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
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
   * Close out checkouts nobody paid for, and rescue the ones they did.
   *
   * A customer who opens the Paystack page and walks away leaves an order in
   * `awaiting_payment` for ever, which clutters every report with sales that
   * never happened. Asking Paystack settles it either way: they say `abandoned`
   * and the order closes, or they say `success`, a payment whose webhook went
   * missing, and it is fulfilled, late but correctly.
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
   * Rescue a wallet top-up whose webhook never arrived and whose customer
   * never came back to confirm it.
   *
   * `resolveAbandonedPayments` above only ever looks at the `Order` table, so
   * it never sees a top-up: a `Payment` with `purpose: 'topup'` has no order
   * attached at all. Without this, a top-up's only two paths to being
   * credited are Paystack's webhook and the customer manually returning to
   * `/pay/return`, and Mobile Money in Ghana routinely means leaving the
   * browser entirely to approve a PIN prompt and never coming back to it. If
   * the webhook is also lost, that money sits confirmed at Paystack and
   * uncredited in the wallet forever, with nothing ever checking again and no
   * admin screen that would even show it as stuck.
   */
  private async resolveStaleTopUps(): Promise<number> {
    const cutoff = new Date(Date.now() - 15 * 60_000)
    const stale = await this.prisma.payment.findMany({
      where: { purpose: 'topup', status: 'pending', createdAt: { lt: cutoff } },
      select: { reference: true },
      take: 25,
      orderBy: { createdAt: 'asc' },
    })

    let resolved = 0
    for (const payment of stale) {
      const result = await this.payments.confirm(payment.reference).catch(() => null)
      if (!result || result.status === 'pending') continue
      this.log.log(`top-up ${payment.reference}: resolved as ${result.status}`)
      resolved++
    }

    return resolved
  }

  /**
   * Give up on approvals that never came, and record what is owed.
   *
   * The customer paid for a bundle we could not deliver. Whatever the reason sits
   * with the provider, the obligation is ours, so this closes the order through
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
        `${order.reference}: ${order.recipient} was never approved within the hold, ` +
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
    // Payments do not depend on the supplier being live, money can be owed and
    // owing whether or not DataHub is simulated, so these run before the guard
    // below rather than being switched off with it.
    let settled = await this.resolveAbandonedPayments()
    settled += await this.resolveStaleTopUps()
    settled += await this.expireStaleApprovals()

    await this.alertStuckOrders()

    if (!this.supplier.isLive) return { checked: 0, settled }

    const cutoff = new Date(Date.now() - this.graceMs)
    const waiting = await this.prisma.order.findMany({
      where: {
        status: { in: ['pending', 'processing'] },
        providerReference: { not: null },
        /**
         * A `manual_`-prefixed reference is DataHub routing this order to
         * one of their own staff, not their automated pipeline, it was
         * never going to show up in `/order-status`, which only knows
         * about the automated path. Checking it here isn't a real attempt
         * at reconciliation, it's a guaranteed `not_found` on every single
         * sweep, forever, until a human clears it, verified against the
         * actual log: every "does not recognise" line this ever produced
         * was for a `manual_` reference, never once for a real one. That
         * made an every-60-seconds error log entry for something already
         * correctly waiting on the Needs Attention page, not a new problem
         * each time. These still reach that page (its own query has no such
         * exclusion), just not this wasted round trip.
         */
        NOT: { providerReference: { startsWith: 'manual_' } },
        createdAt: { lt: cutoff },
      },
      select: { id: true, reference: true, providerReference: true },
      // Bounded so a large backlog cannot blow their rate limit in one sweep.
      take: 25,
      orderBy: { createdAt: 'asc' },
    })

    for (const order of waiting) {
      if (await this.checkWithProvider(order)) settled++
    }

    if (waiting.length > 0) {
      this.log.log(`sweep: checked ${waiting.length}, settled ${settled}`)
    }
    return { checked: waiting.length, settled }
  }

  /** Ask DataHub about one order and settle it if they now have an answer. Returns whether it settled. */
  private async checkWithProvider(order: {
    id: string
    reference: string
    providerReference: string | null
  }): Promise<boolean> {
    const result = await this.datahub.orderStatus(order.providerReference as string)

    if (result.kind === 'unavailable') {
      this.log.warn(`could not check ${order.reference}: ${result.reason}`)
      return false
    }

    if (result.kind === 'not_found') {
      // They accepted a reference and now do not recognise it. Never resolved
      // automatically, refunding risks paying back a delivered bundle, and
      // completing risks crediting a sale that never happened.
      this.log.error(
        `${order.reference}: DataHub does not recognise ${order.providerReference}, needs manual checking`,
      )
      return false
    }

    await this.prisma.supplierDispatch.updateMany({
      where: { orderId: order.id, providerReference: order.providerReference },
      data: { providerStatus: result.providerStatus },
    })

    const mapped = mapProviderStatus(result.providerStatus)
    if (mapped === null) return false // still working on it

    await this.fulfilment.settleFromProvider(
      order.id,
      mapped === 'completed' ? 'delivered' : 'rejected',
      `Reconciled: DataHub GH reported ${result.providerStatus}`,
    )
    this.log.log(
      `reconciled ${order.reference} → ${mapped} (webhook never arrived; DataHub said ${result.providerStatus})`,
    )
    return true
  }

  /**
   * Check one order against DataHub right now, for whoever is actively
   * watching it settle on screen, `Store.watchOrder` polls exactly this
   * path. `sweep()` still covers every order eventually, but only once
   * every ten minutes now (see `intervalMs`'s own comment), comfortably too
   * slow for the five minutes a customer's own screen keeps watching. This
   * is what keeps a lost webhook resolving live instead of only ever
   * catching up in the background after the customer has given up and
   * looked away.
   *
   * Throttled per order to the ~30-60s DataHub itself asks for, since the
   * frontend's own poll runs far tighter than that (every 1.5-5s) and would
   * otherwise hit them once per screen refresh instead of once per real check.
   */
  async checkOrderNow(order: {
    id: string
    reference: string
    status: string
    providerReference: string | null
    createdAt: Date
  }): Promise<boolean> {
    if (!this.supplier.isLive) return false
    if (order.status !== 'pending' && order.status !== 'processing') return false
    if (!order.providerReference || order.providerReference.startsWith('manual_')) return false
    if (Date.now() - order.createdAt.getTime() < this.graceMs) return false

    const lastChecked = this.lastProviderCheckAt.get(order.id)
    if (lastChecked !== undefined && Date.now() - lastChecked < ReconcilerService.MIN_PROVIDER_CHECK_GAP_MS) {
      return false
    }
    this.lastProviderCheckAt.set(order.id, Date.now())

    const settled = await this.checkWithProvider(order)
    if (settled) this.lastProviderCheckAt.delete(order.id)
    return settled
  }

  /**
   * An admin looking at a stuck order who does not want to wait on
   * `checkOrderNow`'s throttle or `sweep()`'s own ten-minute clock.
   *
   * Deliberately skips both: the throttle exists to stop a customer's own
   * tight polling from hammering DataHub, and an admin clicking a button
   * once is not that. Throws instead of quietly doing nothing, unlike the
   * other two check paths, an admin who asks for this deserves to be told
   * why, not a result that looks identical whether it worked or was refused.
   */
  async checkOrderByAdmin(orderId: string): Promise<{ settled: boolean }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, reference: true, status: true, providerReference: true },
    })
    if (!order) throw new NotFoundError('We could not find that order.')
    if (order.status !== 'pending' && order.status !== 'processing') {
      throw new ConflictError('ALREADY_SETTLED', `That order is already ${order.status}, there is nothing to check.`)
    }
    if (!order.providerReference) {
      throw new ValidationError('DataHub never gave this order a reference, there is nothing to ask them about.')
    }
    if (order.providerReference.startsWith('manual_')) {
      throw new ValidationError("Routed to DataHub's manual queue, only their own staff can clear it.")
    }
    if (!this.supplier.isLive) {
      throw new ValidationError('The supplier integration is simulated right now, there is nothing real to check.')
    }

    this.lastProviderCheckAt.set(order.id, Date.now())
    const settled = await this.checkWithProvider(order)
    if (settled) this.lastProviderCheckAt.delete(order.id)
    return { settled }
  }

  private async platformName(): Promise<string> {
    const branding = await this.prisma.branding.findFirst({ where: { userId: null } })
    return branding?.shopName ?? 'JamesDataConsult'
  }

  /**
   * Email active admins whenever an order is stuck waiting on the delivery
   * partner, someone paid and has not received their bundle yet, and nobody
   * was finding out except by opening Needs attention themselves.
   *
   * Deliberately not a one-time alert like `SubscriptionsService.alertExpiring`:
   * this repeats on every sweep, every ten minutes, for as long as any order is
   * still stuck. A subscription lapsing is a single event worth telling someone
   * once; a customer still waiting for a bundle they paid for is an ongoing
   * problem that deserves a standing reminder until it is actually fixed.
   */
  private async alertStuckOrders(): Promise<void> {
    const stuck = (await this.needsAttention()).filter((row) => !row.conflict)
    if (stuck.length === 0) return

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
      this.log.warn(`${stuck.length} order(s) stuck, nobody to tell`)
      return
    }

    const shopName = await this.platformName()
    const count = stuck.length
    const appLink = appUrl(this.config, '/admin/needs-attention')
    const explanation = `${count} order${count === 1 ? '' : 's'} ${count === 1 ? 'has' : 'have'} been waiting too long for the delivery partner. Whoever paid has not received their bundle yet.`
    const appLinkHtml = `<p style="margin:0"><a href="${appLink}" style="display:inline-block;background:#0B3B8F;color:#fff;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;text-decoration:none">Open Needs attention</a></p>`
    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${explanation}</p>${appLinkHtml}` +
      `<p style="margin:18px 0 0;font-size:12.5px;line-height:1.6;color:#64748b">This checks again in ten minutes and keeps emailing while any order is still stuck.</p>`
    const text =
      `${explanation}\n\nOpen Needs attention: ${appLink}\n\n` +
      `This checks again in ten minutes and keeps emailing while any order is still stuck.`
    const subject = `${count} order${count === 1 ? '' : 's'} stuck, waiting on delivery`
    const html = wrap(
      shopName,
      count === 1 ? 'An order is stuck' : 'Orders are stuck',
      body,
      `You are getting this because you are an active admin on ${escape(shopName)}.`,
    )

    for (const recipient of recipients) {
      await this.mailer
        .send({ to: recipient.email, subject, html, text })
        .catch((error) => this.log.error(`could not tell ${recipient.email} about stuck orders: ${String(error)}`))
    }

    this.log.warn(`${count} order(s) stuck, told ${recipients.map((r) => r.email).join(', ')}`)
  }

  /**
   * Orders nobody can resolve automatically.
   *
   * Two different shapes of "nobody can resolve this", both surfaced here
   * because each one is money that has moved with no confirmed outcome:
   *
   *  · Still open and stuck: dispatched but never given a provider reference,
   *    or long past any plausible delivery.
   *  · Already closed, but disputed: `FulfilmentService.settle` flagged
   *    `conflictNote` because a settlement source reported an outcome that
   *    disagreed with one this order was already settled with, regardless
   *    of age, since a conflict does not get less real by waiting.
   */
  async needsAttention(olderThanMinutes = 15) {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000)
    const rows = await this.prisma.order.findMany({
      where: {
        OR: [
          { status: { in: ['pending', 'processing'] }, createdAt: { lt: cutoff } },
          { conflictNote: { not: null } },
        ],
      },
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
        conflictNote: true,
      },
    })

    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      providerReference: r.providerReference,
      productName: r.productName,
      recipient: r.recipient,
      salePrice: r.salePrice,
      paidWith: r.paidWith,
      createdAt: r.createdAt.toISOString(),
      conflict: r.conflictNote !== null,
      // Without a provider reference we never got a usable reply, so there is
      // nothing to ask them about, this one needs a human looking at their
      // dashboard. A `manual_`-prefixed one is routed to DataHub's own staff
      // and was never going to show up in `/order-status` at all (see
      // `sweep`'s own exclusion), worth saying plainly here, since "accepted
      // but never reported back" reads as something might still be coming,
      // when the honest answer is that only a person at DataHub, contacted
      // directly, ever will.
      reason:
        r.conflictNote ??
        (r.providerReference?.startsWith('manual_')
          ? `Routed to DataHub's manual queue, only their own staff can clear it, quote them ${r.providerReference}`
          : r.providerReference
            ? 'Accepted by DataHub but never reported back'
            : 'No reply from DataHub, may or may not have been placed'),
    }))
  }

  /**
   * A human has checked a flagged conflict and is closing it out.
   *
   * Deliberately does not touch the order's money or status at all, see
   * `SettleResult`'s doc comment on why nothing here ever auto-resolves one
   * of these. This only clears the flag, once whoever looked has confirmed
   * (against Paystack's or DataHub's own dashboard, or the customer directly)
   * whether anything needs fixing by hand and done it separately.
   */
  async acknowledgeConflict(orderId: string, adminId: string, note: string): Promise<void> {
    const reason = note.trim()
    if (reason.length < 5) {
      throw new ValidationError('Say what you checked. It is kept on the record.')
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { reference: true, conflictNote: true },
    })
    if (!order) throw new NotFoundError('We could not find that order.')
    if (!order.conflictNote) {
      throw new ConflictError('NO_CONFLICT', 'That order has no flagged conflict to acknowledge.')
    }

    await this.prisma.order.update({ where: { id: orderId }, data: { conflictNote: null } })
    this.log.log(`${order.reference}: conflict acknowledged by ${adminId}, ${reason}`)
  }

  /**
   * Settle an order by hand, when nothing automatic ever will.
   *
   * `sweep()` only resolves an order once DataHub's own status reaches a
   * recognised terminal word, `SUCCESSFUL`, `FAILED`, `CANCELLED`. Anything
   * else, including a status they never change again, is deliberately left
   * alone forever rather than guessed at (see `mapProviderStatus`), the
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

    this.log.warn(`${order.reference}: resolving by hand as ${outcome} by ${adminId}, ${reason}`)
    const result = await this.fulfilment.settleFromProvider(
      orderId,
      outcome,
      `Marked ${outcome} by hand, ${reason}`,
      undefined,
      true,
    )

    /**
     * This pre-check and the atomic claim inside `settle` are not the same
     * guard, the read above proves nothing about what is still true by the
     * time `settle`'s own write runs a moment later. The provider's webhook,
     * the reconciler's own sweep, or a second admin can all settle the same
     * order in between. Without checking `result`, the caller here was told
     * "done" even when their click was silently discarded because something
     * else won that race a moment earlier, which is worse than an error,
     * because it hides that the order was NOT settled the way they just
     * asked for.
     */
    if (!result.applied) {
      throw new ConflictError(
        'ALREADY_SETTLED',
        result.conflict
          ? `Something else (the provider's own report, or another admin) already settled this order as ` +
            `${result.actualOutcome} just now. Nothing was changed. Check the order before doing anything else.`
          : `That order was already settled as ${result.actualOutcome}.`,
      )
    }
  }
}
