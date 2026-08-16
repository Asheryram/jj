import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { DatahubClient } from '../supplier/datahub.client'
import { FulfilmentService } from './fulfilment.service'

/**
 * Orders paid for and held because DataHub has not approved the recipient.
 *
 * DataHub will not deliver an MTN bundle to a number that is not on their
 * beneficiary list. Rather than refuse the sale — which turned every first-time
 * MTN customer away — the order is taken and parked in `awaiting_approval`, and
 * this is where it gets resolved.
 *
 * Their `/beneficiaries` submission endpoint answers 502 on every valid request
 * (validation passes, then their upstream returns an HTML page), so approval is
 * a manual job in their dashboard. What this service can do is make the list of
 * who is waiting obvious, and turn an approval into delivered bundles without
 * anybody re-entering an order.
 *
 * Three operations:
 *
 *  · **pending** — who is waiting, how many orders each is holding up, and how
 *    much of the customers' money is parked against them.
 *  · **recheck** — ask `/verify` which numbers have been approved since, and
 *    immediately re-dispatch the orders waiting on the ones that have. This is
 *    the one-click retry; approval is DataHub's to grant, so their answer is the
 *    only thing that may release an order.
 *  · **submit** — try their API anyway. It will start working the day they fix
 *    it, and until then it reports the failure rather than pretending.
 */
@Injectable()
export class ApprovalsService {
  private readonly log = new Logger(ApprovalsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly datahub: DatahubClient,
    private readonly fulfilment: FulfilmentService,
  ) {}

  /**
   * Everyone waiting, with the money each is holding up.
   *
   * Ordered by value held rather than by age: the number blocking GHS 200 of
   * paid orders is the one worth approving first, and it is also the one whose
   * customers are most likely to ask for their money back.
   */
  async pending() {
    const held = await this.prisma.order.findMany({
      where: { status: 'awaiting_approval' },
      select: {
        recipient: true,
        salePrice: true,
        productName: true,
        createdAt: true,
      },
    })

    const registry = await this.prisma.beneficiaryRequest.findMany({
      where: { approvedAt: null },
    })

    const byPhone = new Map<
      string,
      { phone: string; ordersHeld: number; valueHeld: number; lastProduct: string | null; oldest: Date }
    >()

    for (const order of held) {
      const row = byPhone.get(order.recipient)
      if (row) {
        row.ordersHeld++
        row.valueHeld += order.salePrice
        if (order.createdAt < row.oldest) row.oldest = order.createdAt
        continue
      }
      byPhone.set(order.recipient, {
        phone: order.recipient,
        ordersHeld: 1,
        valueHeld: order.salePrice,
        lastProduct: order.productName,
        oldest: order.createdAt,
      })
    }

    // A number can be in the registry with no held order — a past attempt that
    // was already refunded. Still worth approving, just less urgent.
    for (const entry of registry) {
      if (byPhone.has(entry.phone)) continue
      byPhone.set(entry.phone, {
        phone: entry.phone,
        ordersHeld: 0,
        valueHeld: 0,
        lastProduct: entry.lastProduct,
        oldest: entry.lastSeenAt,
      })
    }

    const networkKeys = new Map(registry.map((row) => [row.phone, row.networkKey]))

    return [...byPhone.values()]
      .sort((a, b) => b.valueHeld - a.valueHeld || b.ordersHeld - a.ordersHeld)
      .map((row) => ({
        phone: row.phone,
        networkKey: networkKeys.get(row.phone) ?? 'YELLO',
        ordersHeld: row.ordersHeld,
        valueHeld: row.valueHeld,
        lastProduct: row.lastProduct,
        waitingSince: row.oldest.toISOString(),
      }))
  }

  /**
   * Re-dispatch every held order for a number now that it is approved.
   *
   * Goes back through the ordinary fulfilment path rather than a special one, so
   * an order released here settles through exactly the same ledger code as one
   * that never needed approving.
   */
  private async releaseOrdersFor(phone: string): Promise<number> {
    const held = await this.prisma.order.findMany({
      where: { status: 'awaiting_approval', recipient: phone },
      select: { id: true, reference: true },
    })

    for (const order of held) {
      // Back to `processing`: it is genuinely in flight again, and leaving it in
      // `awaiting_approval` would let a second recheck dispatch it twice.
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'processing' },
      })
      this.fulfilment.scheduleFor(order.id)
      this.log.log(`${order.reference} released — ${phone} approved`)
    }

    return held.length
  }

  /**
   * Ask DataHub which pending numbers they have approved since we last looked.
   *
   * Rate-limited to 30/min on their side, so this runs in small batches with a
   * pause between them rather than firing everything at once.
   */
  async recheck(): Promise<{ checked: number; approved: string[]; released: number }> {
    const waiting = await this.prisma.beneficiaryRequest.findMany({
      where: { approvedAt: null },
      select: { phone: true, networkKey: true },
      take: 60,
    })

    const approved: string[] = []
    let released = 0

    for (const [index, row] of waiting.entries()) {
      // Their limit is 30 a minute. Twenty at a time with a breath in between
      // stays well inside it even if this is run twice in quick succession.
      if (index > 0 && index % 20 === 0) await sleep(3000)

      const result = await this.datahub.verify(row.networkKey, row.phone).catch(() => null)
      if (result?.verified) {
        approved.push(row.phone)
        await this.prisma.beneficiaryRequest.update({
          where: { phone: row.phone },
          data: { approvedAt: new Date() },
        })
        released += await this.releaseOrdersFor(row.phone)
      }
    }

    if (approved.length > 0) {
      this.log.log(
        `DataHub approved ${approved.length} number(s), releasing ${released} held order(s)`,
      )
    }
    return { checked: waiting.length, approved, released }
  }

  /**
   * Try to submit the pending numbers through their API.
   *
   * Expected to fail while their upstream is down. It returns the reason rather
   * than swallowing it, because "we submitted your number" is exactly the kind of
   * claim that must not be made when nothing was submitted.
   */
  async submit(): Promise<{ submitted: number; error: string | null }> {
    const waiting = await this.prisma.beneficiaryRequest.findMany({
      where: { approvedAt: null },
      select: { phone: true },
      // Their documented ceiling is 30 per request.
      take: 30,
    })

    if (waiting.length === 0) return { submitted: 0, error: null }

    const result = await this.datahub.submitBeneficiaries(waiting.map((row) => row.phone))
    if (!result.ok) {
      this.log.warn(`beneficiary submission failed: ${result.reason}`)
      return { submitted: 0, error: result.reason }
    }

    this.log.log(`submitted ${result.submitted} number(s) for approval`)
    return { submitted: result.submitted, error: null }
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
