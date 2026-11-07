import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { NotFoundError } from '../common/domain-errors'

export interface TimelineEvent {
  at: string
  /** money: money moved. provider: the delivery partner. person: someone decided. system: the platform did it. */
  kind: 'money' | 'provider' | 'person' | 'system'
  title: string
  detail: string | null
  /** Who did it, for a person's action. */
  who: string | null
}

const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`

/** What an admin action did, in words, from the route it hit. */
function describeAction(path: string, body: unknown): string {
  const b = (body ?? {}) as { note?: string; outcome?: string; alreadyRefunded?: boolean; delivered?: boolean }
  const note = b.note ? `"${b.note}"` : null
  if (path.endsWith('/resolve')) {
    const how = b.outcome === 'delivered' ? 'Marked delivered by hand' : b.alreadyRefunded ? 'Marked failed, already refunded by hand' : 'Marked failed by hand'
    return [how, note].filter(Boolean).join(': ')
  }
  if (path.endsWith('/reorder')) return ['Reordered', note].filter(Boolean).join(': ')
  if (path.endsWith('/reverse-outcome')) return ['Outcome reversed', note].filter(Boolean).join(': ')
  if (path.endsWith('/reject')) return [b.delivered === false ? 'Refund refused' : 'Refund refused, marked delivered', note].filter(Boolean).join(': ')
  if (path.endsWith('/approve')) return 'Refund approved'
  if (path.endsWith('/reopen')) return ['Refund reopened', note].filter(Boolean).join(': ')
  if (path.endsWith('/settle-manually')) return ['Refund recorded as paid another way', note].filter(Boolean).join(': ')
  if (path.endsWith('/check')) return 'Checked with the delivery partner'
  if (path.endsWith('/provider-reference')) {
    const r = body as { reference?: string; reorderedByHand?: boolean }
    return [r.reorderedByHand ? `Ordered again by hand on the partner's dashboard, reference ${r.reference ?? ''}` : `Reference ${r.reference ?? ''} added from the partner's dashboard`, note]
      .filter(Boolean)
      .join(': ')
  }
  if (path.endsWith('/retry-dispatch')) return ['Dispatch retried', note].filter(Boolean).join(': ')
  if (path.endsWith('/acknowledge-conflict')) return ['Conflict acknowledged', note].filter(Boolean).join(': ')
  return path
}

/**
 * One order's whole story in order: payment, every delivery attempt, every
 * person's decision, every money movement. Built only from what is already
 * recorded, so nothing here can disagree with the pages it summarises.
 *
 * The incident it exists for took database queries to untangle: an order
 * reordered, failed by hand, refunded by hand and reordered again. Read here,
 * the same history takes seconds.
 */
@Injectable()
export class OrderTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async forOrder(orderId: string): Promise<TimelineEvent[]> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true, refundRequest: true, dispatches: { orderBy: { createdAt: 'asc' } } },
    })
    if (!order) throw new NotFoundError('We could not find that order.')

    const ids = [order.id, order.refundRequest?.id].filter((v): v is string => Boolean(v))
    const [actions, ledger] = await Promise.all([
      this.prisma.adminAction.findMany({
        where: { OR: ids.map((id) => ({ path: { contains: id } })) },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { orderRef: order.reference, kind: { in: ['refund', 'supplier_cost'] } },
        orderBy: { occurredAt: 'asc' },
      }),
    ])
    const people = await this.prisma.user.findMany({
      where: { id: { in: [...new Set([...actions.map((a) => a.actorId), order.refundRequest?.decidedBy].filter((v): v is string => Boolean(v)))] } },
      select: { id: true, name: true },
    })
    const name = (id: string | null | undefined) => (id ? (people.find((p) => p.id === id)?.name ?? 'Someone') : null)

    const events: TimelineEvent[] = [
      {
        at: order.createdAt.toISOString(),
        kind: 'system',
        title: `Order placed: ${order.productName} for ${order.recipient}`,
        detail: `${ghs(order.salePrice)}, ${order.paidWith === 'wallet' ? 'from wallet' : 'Mobile Money'}${order.soldByAgentName ? `, sold by ${order.soldByAgentName}` : ''}`,
        who: null,
      },
    ]

    if (order.payment) {
      events.push({
        at: (order.payment.paidAt ?? order.payment.updatedAt).toISOString(),
        kind: 'money',
        title: order.payment.status === 'paid' ? `Customer paid ${ghs(order.payment.amount)}` : `Payment ${order.payment.status}`,
        detail: order.payment.network ? `${order.payment.network} Mobile Money` : null,
        who: null,
      })
    }

    for (const d of order.dispatches) {
      const outcome =
        d.outcome === 'pending'
          ? 'accepted'
          : d.outcome === 'needs_approval'
            ? 'refused: number not set up'
            : d.outcome === 'unknown'
              ? 'no answer'
              : d.outcome
      events.push({
        at: d.createdAt.toISOString(),
        kind: 'provider',
        title: `Attempt ${d.attempt} sent to the delivery partner: ${outcome}`,
        detail:
          [
            d.providerCharged != null ? `charged ${ghs(d.providerCharged)}` : null,
            d.providerReference ? `ref ${d.providerReference}` : null,
            d.providerStatus ? `last status ${d.providerStatus}` : null,
            d.reason,
          ]
            .filter(Boolean)
            .join(' · ') || null,
        who: null,
      })
    }

    for (const e of ledger) {
      if (e.kind === 'supplier_cost' && e.amount > 0) {
        events.push({ at: e.occurredAt.toISOString(), kind: 'money', title: `Delivery partner gave back ${ghs(e.amount)}`, detail: e.description, who: null })
      }
      if (e.kind === 'refund') {
        events.push({ at: e.occurredAt.toISOString(), kind: 'money', title: `Refund of ${ghs(-e.amount)} booked`, detail: e.description, who: null })
      }
    }

    const r = order.refundRequest
    if (r) {
      events.push({ at: r.createdAt.toISOString(), kind: 'system', title: `Refund of ${ghs(r.amount)} queued`, detail: r.reason, who: null })
      if (r.paidAt) {
        events.push({
          at: r.paidAt.toISOString(),
          kind: 'money',
          title: r.resolvedManually ? `Refund paid by hand, ${ghs(r.amount)}` : `Refund sent to the customer, ${ghs(r.amount)}`,
          detail: r.transferNote,
          who: null,
        })
      }
    }

    for (const a of actions) {
      events.push({ at: a.createdAt.toISOString(), kind: 'person', title: describeAction(a.path, a.body), detail: null, who: name(a.actorId) })
    }

    if (order.completedAt) {
      events.push({ at: order.completedAt.toISOString(), kind: 'provider', title: 'Delivered', detail: null, who: null })
    }

    events.push({
      at: new Date().toISOString(),
      kind: 'system',
      title: `Now: ${order.status === 'failed' && r && !r.paidAt && r.status === 'pending' ? 'failed, refund waiting' : order.status}`,
      detail: r ? `Refund ${r.status}${r.note ? `: ${r.note}` : ''}` : null,
      who: null,
    })

    return events.sort((x, y) => x.at.localeCompare(y.at))
  }
}
