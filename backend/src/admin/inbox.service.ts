import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { MailerService } from '../mail/mailer.service'
import { escape } from '../mail/templates'
import { PrismaService } from '../prisma/prisma.service'
import { SolvencyService } from '../finance/solvency.service'
import { ReconcilerService } from '../supplier/reconciler.service'
import { FloatMonitorService, providerLabel } from '../supplier/float-monitor.service'
import { SettingsService, KNOWN_PROVIDERS } from '../settings/settings.service'

/** 1 needs doing now, 2 needs doing today, 3 worth knowing. */
export type Urgency = 1 | 2 | 3

export interface InboxItem {
  id: string
  urgency: Urgency
  title: string
  detail: string
  /** Pesewas involved, when there is one figure that matters. */
  amount: number | null
  /** Where to go to deal with it, and what the button says. */
  link: string
  action: string
}

const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`

/** How often "now" items are checked for an alert email. */
const ALERT_EVERY_MS = 10 * 60_000
/** The "now" items admins have already been emailed about, so each is sent once. */
const ALERTED_KEY = 'inboxAlertedIds'

/**
 * Everything waiting on a person, across every admin page, most urgent first.
 *
 * Admins used to have to know that a stuck payout lives on Needs attention, a
 * refund on Refunds, a held order on Number approvals, a top-up on the Paystack
 * balance page. Each source here is the one those pages already read, so the
 * two can never disagree; this only gathers them and says what to do.
 *
 * Read-only, and each source fails on its own: one provider being unreachable
 * must not blank the whole list.
 */
@Injectable()
export class AdminInboxService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(AdminInboxService.name)
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly solvency: SolvencyService,
    private readonly reconciler: ReconcilerService,
    private readonly float: FloatMonitorService,
    private readonly settings: SettingsService,
    private readonly mailer: MailerService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.alertNew().catch((error) => this.log.error(`today alert failed: ${String(error)}`))
    }, ALERT_EVERY_MS)
    this.timer.unref?.()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /**
   * Email admins about each new "now" item, once. Today only helps when
   * someone opens it; a payout stuck on an OTP or a possible double payment
   * should reach them where they are. Items that have cleared are forgotten,
   * so the same problem coming back later is announced again.
   */
  async alertNew(): Promise<number> {
    const now = (await this.today()).items.filter((i) => i.urgency === 1 && !i.id.startsWith('error:'))
    const row = await this.prisma.setting.findUnique({ where: { key: ALERTED_KEY } })
    const already = new Set(Array.isArray(row?.value) ? (row.value as string[]) : [])
    const fresh = now.filter((i) => !already.has(i.id))

    await this.prisma.setting.upsert({
      where: { key: ALERTED_KEY },
      create: { key: ALERTED_KEY, value: now.map((i) => i.id) },
      update: { value: now.map((i) => i.id) },
    })
    if (fresh.length === 0) return 0

    const admins = await this.prisma.user.findMany({
      where: { role: { in: ['admin', 'superadmin'] }, status: 'active' },
      select: { email: true },
    })
    const lines = fresh.map((i) => `${i.title}${i.amount != null ? ` (${ghs(i.amount)})` : ''}: ${i.detail}`)
    const subject = fresh.length === 1 ? `Needs you now: ${fresh[0].title}` : `${fresh.length} things need you now`
    const text = [...lines, 'Open Today in the admin dashboard to deal with them.'].join('\n\n')
    const html = `${lines.map((l) => `<p style="margin:0 0 12px">${escape(l)}</p>`).join('')}<p>Open <strong>Today</strong> in the admin dashboard to deal with them.</p>`
    for (const { email } of admins) {
      await this.mailer
        .send({ to: email, subject, html, text })
        .catch((error) => this.log.error(`could not alert ${email}: ${String(error)}`))
    }
    this.log.warn(`alerted ${admins.length} admin(s) about ${fresh.length} new urgent item(s)`)
    return fresh.length
  }

  async today(): Promise<{ items: InboxItem[]; at: string }> {
    const sources = await Promise.all([
      this.safe('transfers', () => this.transfers()),
      this.safe('treasury', () => this.treasury()),
      this.safe('refunds', () => this.refunds()),
      this.safe('withdrawals', () => this.withdrawals()),
      this.safe('orders', () => this.orders()),
      this.safe('floats', () => this.floats()),
      this.safe('topups', () => this.topups()),
    ])
    const items = sources.flat().sort((a, b) => a.urgency - b.urgency || (b.amount ?? 0) - (a.amount ?? 0))
    return { items, at: new Date().toISOString() }
  }

  private async safe(name: string, fn: () => Promise<InboxItem[]>): Promise<InboxItem[]> {
    try {
      return await fn()
    } catch (error) {
      this.log.warn(`today: ${name} could not be read: ${String(error)}`)
      return [
        {
          id: `error:${name}`,
          urgency: 3,
          title: `Could not check ${name} just now`,
          detail: 'Reload the page in a moment.',
          amount: null,
          link: '/admin/today',
          action: 'Reload',
        },
      ]
    }
  }

  /** Payouts and refunds stuck at Paystack, and possible double payments. */
  private async transfers(): Promise<InboxItem[]> {
    const rows = await this.solvency.stuckTransfers()
    return rows.map((row) => {
      const what = row.type === 'withdrawal' ? `Payout to ${row.who}` : `Refund to ${row.who}`
      if (row.transferStatus === 'sent_after_return') {
        return {
          id: `double:${row.type}:${row.id}`,
          urgency: 1,
          title: `Possible double payment: ${what}`,
          detail: 'Paystack says it was sent after it was already returned or paid by hand. Check and recover it.',
          amount: row.amount,
          link: '/admin/needs-attention',
          action: 'Review',
        }
      }
      return {
        id: `stuck:${row.type}:${row.id}`,
        urgency: 1,
        title: row.transferStatus === 'otp' ? `${what} needs an OTP in Paystack` : `${what}: no answer from Paystack`,
        detail:
          row.transferStatus === 'otp'
            ? 'Paystack will not send it until the code is entered, or "Confirm transfers before sending" is turned off.'
            : 'Check it with Paystack before doing anything else with it.',
        amount: row.amount,
        link: '/admin/needs-attention',
        action: 'Check with Paystack',
      }
    })
  }

  /** Float refills and owner withdrawals stuck at Paystack. */
  private async treasury(): Promise<InboxItem[]> {
    const rows = await this.prisma.treasuryTransfer.findMany({
      where: { status: { in: ['otp', 'unknown'] } },
      select: { id: true, status: true, amount: true, purpose: true },
    })
    return rows.map((row) => ({
      id: `treasury:${row.id}`,
      urgency: 1,
      title: `${row.purpose === 'provider_refill' ? 'Float refill' : 'Withdrawal'} ${row.status === 'otp' ? 'needs an OTP in Paystack' : 'has no answer from Paystack'}`,
      detail: `TRS-${row.id.slice(0, 8).toUpperCase()}. Nothing has left the balance until Paystack sends it.`,
      amount: row.amount,
      link: '/admin/treasury',
      action: 'Open Paystack balance',
    }))
  }

  private async refunds(): Promise<InboxItem[]> {
    const [pending, byHand] = await Promise.all([
      this.prisma.refundRequest.aggregate({ where: { status: 'pending' }, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.refundRequest.count({ where: { status: 'pending', order: { status: 'failed', resolvedManually: true } } }),
    ])
    const n = pending._count._all
    if (n === 0) return []
    return [
      {
        id: 'refunds',
        urgency: 2,
        title: `${n} refund${n === 1 ? '' : 's'} waiting for a decision`,
        detail:
          byHand > 0
            ? `${byHand} of them were marked failed by hand: check the customer was not already refunded.`
            : 'Customers who paid and did not get their bundle.',
        amount: pending._sum.amount ?? 0,
        link: '/admin/refunds',
        action: 'Open refunds',
      },
    ]
  }

  private async withdrawals(): Promise<InboxItem[]> {
    const pending = await this.prisma.withdrawal.aggregate({
      where: { status: 'pending' },
      _count: { _all: true },
      _sum: { amount: true },
    })
    const n = pending._count._all
    if (n === 0) return []
    return [
      {
        id: 'withdrawals',
        urgency: 2,
        title: `${n} agent withdrawal${n === 1 ? '' : 's'} to approve`,
        detail: 'Approving sends the money to the agent through Paystack.',
        amount: pending._sum.amount ?? 0,
        link: '/admin/withdrawals',
        action: 'Open withdrawals',
      },
    ]
  }

  /** Orders nobody can settle automatically: conflicts first, then stuck ones. */
  private async orders(): Promise<InboxItem[]> {
    const rows = await this.reconciler.needsAttention()
    const conflicts = rows.filter((r) => r.conflict)
    const stuck = rows.filter((r) => !r.conflict)
    const items: InboxItem[] = conflicts.map((r) => ({
      id: `conflict:${r.id}`,
      urgency: 1,
      title: `${r.reference}: provider and records disagree`,
      detail: r.reason,
      amount: r.salePrice,
      link: '/admin/needs-attention',
      action: 'Review',
    }))
    if (stuck.length > 0) {
      const manual = stuck.filter((r) => r.providerReference?.startsWith('manual_')).length
      items.push({
        id: 'stuck-orders',
        urgency: 2,
        title: `${stuck.length} paid order${stuck.length === 1 ? '' : 's'} not delivered yet`,
        detail:
          manual > 0
            ? `${manual} in DataHub's manual queue. Check each with DataHub, then mark it sent or failed.`
            : 'Waiting on the delivery partner for longer than usual.',
        amount: stuck.reduce((sum, r) => sum + r.salePrice, 0),
        link: '/admin/needs-attention',
        action: 'Open needs attention',
      })
    }
    return items
  }

  /** A float that is running low stops deliveries. */
  private async floats(): Promise<InboxItem[]> {
    const { floatWatchAt, floatRiskAt } = await this.settings.all()
    const items: InboxItem[] = []
    for (const provider of KNOWN_PROVIDERS) {
      const latest = await this.float.latest(provider)
      if (!latest || latest.balance >= floatWatchAt) continue
      const risk = latest.balance < floatRiskAt
      items.push({
        id: `float:${provider}`,
        urgency: risk ? 1 : 3,
        title: `${providerLabel(provider)} float is ${risk ? 'nearly empty' : 'getting low'}`,
        detail: `Last reading ${ghs(latest.balance)}. Refill it from the Paystack balance page.`,
        amount: latest.balance,
        link: '/admin/treasury',
        action: 'Refill',
      })
    }
    return items
  }

  private async topups(): Promise<InboxItem[]> {
    const rows = await this.prisma.paystackTopup.aggregate({
      where: { source: 'unclassified' },
      _count: { _all: true },
      _sum: { amount: true },
    })
    const n = rows._count._all
    if (n === 0) return []
    return [
      {
        id: 'topups',
        urgency: 3,
        title: `${n} Paystack top-up${n === 1 ? '' : 's'} to label`,
        detail: 'Say whether each was money back from the settlement MoMo or new money of your own.',
        amount: rows._sum.amount ?? 0,
        link: '/admin/treasury',
        action: 'Label top-ups',
      },
    ]
  }
}
