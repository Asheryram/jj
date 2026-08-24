import { Injectable, Logger } from '@nestjs/common'
import type { Order, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { PricingService } from '../pricing/pricing.service'
import { SettingsService } from '../settings/settings.service'
import { FulfilmentService } from './fulfilment.service'
import { PaymentsService } from '../payments/payments.service'
import { SupplierService } from '../supplier/supplier.service'
import { DatahubClient } from '../supplier/datahub.client'
import { splitDiscrepancy, type OrderSplit } from '../domain/pricing'
import { toOrder, toTrackedOrder } from '../common/mappers'
import {
  ConflictError,
  InsufficientBalanceError,
  LedgerImbalanceError,
  NotFoundError,
  ValidationError,
} from '../common/domain-errors'
import type { AuthUser } from '../common/auth'
import type { PlaceOrderDto, TrackOrderDto } from './orders.dto'
import { isAdminRole } from '../common/auth'

/**
 * The networks DataHub's /verify can answer for. Their docs list it as
 * recommended for MTN and required for MTN XPRESS; it is silent on the rest, and
 * asking about a network it does not cover would turn "no answer" into "no".
 */
const VERIFIABLE_NETWORK_KEYS = ['YELLO', 'mtn_xpress']

@Injectable()
export class OrdersService {
  private readonly log = new Logger(OrdersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly fulfilment: FulfilmentService,
    private readonly payments: PaymentsService,
    private readonly supplier: SupplierService,
    private readonly datahub: DatahubClient,
  ) {}

  /**
   * FR-4.3 — place an order.
   *
   * Everything that decides money happens inside one transaction: the chain is
   * read, the split computed, the wallet debited, the order written. The provider
   * call is deliberately NOT in here — never hold a transaction open across an
   * outbound HTTP call (skills-breakdown.md §4.4.3). It is dispatched after
   * commit, and the order sits in `processing` until it answers.
   */
  async place(dto: PlaceOrderDto, user: AuthUser | undefined) {
    const sellerCode = await this.effectiveSeller(dto.sellerCode ?? null, user)

    // Replaying a key returns the original rather than erroring: the client that
    // retried cannot tell whether the first attempt was lost in the request or
    // the response, and a 409 would leave a real order stranded.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.order.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      })
      if (existing) {
        // An unpaid replay needs the payment link back, not a receipt. Dropping
        // it here left a customer who reloaded checkout looking at an order with
        // no way to pay for it.
        if (existing.status === 'awaiting_payment') {
          const paymentUrl = await this.payments.paymentUrlForOrder(existing.id)
          if (paymentUrl) return { ...toOrder(existing), paymentUrl }
        }
        return toOrder(existing)
      }
    }

    const buyerPhone = dto.buyerPhone ?? dto.recipient
    const reference = await this.freshReference()

    /**
     * Whether real money has to be collected before this order moves.
     *
     * A wallet payment is already money in hand — it was collected when the
     * wallet was topped up — so it is debited inside the transaction below and
     * the order proceeds. Mobile Money means Paystack, and nothing proceeds
     * until they say it arrived.
     *
     * With no Paystack key this is false and Mobile Money is simulated, which is
     * the right stand-in for acceptance testing and is announced at boot.
     */
    const needsPayment = dto.payWith === 'momo' && this.payments.live

    let order: Order
    try {
      order = await this.prisma.$transaction(async (tx) => {
      const { product, salePrice, split } = await this.priceInside(tx, dto.productId, sellerCode, dto.recipient)

      // FR-2.3 — a wallet payment is debited as the order is created, and only a
      // customer holds a spendable wallet. An agent's balance is earnings.
      if (dto.payWith === 'wallet') {
        if (!user || user.role !== 'customer') {
          throw new ValidationError(
            'Only a customer account holds a spendable wallet. Pay with Mobile Money instead.',
          )
        }
        await this.debitWallet(tx, user.id, salePrice, reference, `${product.name} → ${dto.recipient}`)
      }

      return tx.order.create({
        data: {
          reference,
          idempotencyKey: dto.idempotencyKey ?? null,
          productId: product.id,
          productName: product.name,
          network: product.network,
          category: product.category,
          recipient: dto.recipient,
          salePrice,
          split: split as unknown as Prisma.InputJsonValue,
          soldByCode: sellerCode,
          // `awaiting_payment` and nothing else until Paystack confirms the
          // money. Not `pending`: the restart-recovery sweep dispatches anything
          // pending-without-a-provider-reference, so an unpaid order parked there
          // was delivered free on the next reboot.
          status: needsPayment ? 'awaiting_payment' : 'processing',
          paidWith: dto.payWith,
          buyer: dto.buyerName?.trim() || user?.name || 'Guest',
          buyerPhone,
          buyerUserId: user?.id ?? null,
        },
      })
      })
    } catch (error) {
      // A refused sale is still information: somebody wanted this bundle and
      // could not have it because their number is not approved. Recorded here
      // rather than at the throw site because the throw unwinds the transaction,
      // and a note written inside it would roll back with everything else.
      if (error instanceof ConflictError && error.code === 'RECIPIENT_NOT_REGISTERED') {
        await this.noteApprovalNeeded(dto.productId, dto.recipient).catch(() => undefined)
      }
      throw error
    }

    if (needsPayment) {
      // Hand back somewhere to pay rather than a receipt. Fulfilment is started
      // by the payment being confirmed, not by this request returning.
      const { paymentUrl } = await this.payments.startOrderPayment({
        id: order.id,
        reference: order.reference,
        salePrice: order.salePrice,
        buyerPhone,
        productName: order.productName,
        recipient: order.recipient,
        buyerUserId: order.buyerUserId,
      })
      return { ...toOrder(order), paymentUrl }
    }

    // Committed and paid for. Now ask the provider, and let the result land
    // asynchronously — the shape a real DataHub GH callback arrives in (FR-4.4).
    this.fulfilment.scheduleFor(order.id)

    return toOrder(order)
  }

  /**
   * Remember a number DataHub has not approved, so somebody can go and approve it.
   *
   * Their `/beneficiaries` endpoint 502s, so this cannot be automated — the only
   * route is James doing it by hand in their dashboard, and he can only do that
   * if he knows which numbers to enter. `attempts` counts how many sales each
   * one has cost, which is the order to work through them in.
   */
  private async noteApprovalNeeded(productId: string, recipient: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { name: true, standardPrice: true, supplier: { select: { networkKey: true } } },
    })

    await this.prisma.beneficiaryRequest.upsert({
      where: { phone: recipient },
      create: {
        phone: recipient,
        networkKey: product?.supplier?.networkKey ?? 'YELLO',
        lastProduct: product?.name ?? null,
        lastValue: product?.standardPrice ?? null,
      },
      update: {
        attempts: { increment: 1 },
        lastProduct: product?.name ?? null,
        lastValue: product?.standardPrice ?? null,
        // A number approved earlier and refused again is pending once more.
        approvedAt: null,
      },
    })

    this.log.warn(`${recipient} needs DataHub approval — sale refused`)
  }

  /**
   * Price the order from rows read inside the transaction.
   *
   * A price posted by the browser is never trusted. Even the price the browser
   * *displayed* is only a quote — if an upline changed theirs a second ago, the
   * authoritative number is this one, computed here.
   */
  private async priceInside(
    tx: Prisma.TransactionClient,
    productId: string,
    sellerCode: string | null,
    recipient: string,
  ) {
    const row = await tx.product.findUnique({ where: { id: productId } })
    if (!row) throw new NotFoundError('We could not find that bundle.')
    if (!row.active) {
      throw new ConflictError(
        'PRODUCT_INACTIVE',
        `${row.name} is not on sale at the moment. Pick another bundle.`,
      )
    }

    // There is no prefix check here.
    //
    // One used to refuse an order whose number looked like the wrong carrier, on
    // a table mapping 024 → MTN and so on. Ghana's number portability makes that
    // table unable to be right — a 020 line can genuinely be on MTN — so it
    // turned away customers who could have been served, and a new NCA range did
    // the same to everyone on it. Deliverability is the supplier's answer to give:
    // it refuses what it cannot send, and a refused order refunds.
    // Do not take money for something we cannot deliver.
    //
    // While live, a product whose provider SKU has no network/capacity mapping
    // can never be fulfilled — DataHub sells whole-GB data bundles and nothing
    // else. Dispatch used to catch this, but only after the buyer had paid: the
    // order failed, the money came back, and the customer was left wondering
    // what they had done wrong. Refusing here costs them nothing.
    if (this.supplier.isLive) {
      const supplier = await tx.product
        .findUnique({ where: { id: productId }, select: { supplier: true } })
        .then((r) => r?.supplier ?? null)

      if (!supplier?.networkKey || !supplier?.capacityGb) {
        throw new ConflictError(
          'NO_AUTOMATED_FULFILMENT',
          `${row.name} cannot be delivered automatically at the moment. Please choose another bundle.`,
        )
      }
      if (!supplier.available) {
        throw new ConflictError(
          'PRODUCT_OUT_OF_STOCK',
          `${row.name} is out of stock with our delivery partner right now. Please choose another bundle.`,
        )
      }

      // An unapproved recipient is deliberately NOT refused here.
      //
      // DataHub will not deliver to a number that is not on their beneficiary
      // list, and this used to reject the sale at checkout. That was safe and it
      // was also the wrong trade: it turned away every first-time MTN customer
      // with a message about somebody else's approved list, and lost the sale
      // outright. The order is taken instead, held in `awaiting_approval`, and
      // either delivered once the number is approved or refunded automatically
      // when the hold expires. See FulfilmentService.
    }

    // The referral policy is applied inside `quote`, from rows read in this same
    // transaction — so the rate cannot move between pricing and writing.
    const { salePrice, split } = await this.pricing.quote(productId, sellerCode, tx)

    // The invariant, checked before anything is written: the buyer's money is
    // exactly the supplier's cost plus every margin. A mismatch means the pricing
    // domain and the ledger disagree, and committing would create or destroy
    // money. Roll back loudly instead.
    const discrepancy = splitDiscrepancy(salePrice, split)
    if (discrepancy !== 0) {
      this.log.error(
        `split imbalance of ${discrepancy}p on ${productId} via ${sellerCode ?? 'no seller'}`,
      )
      throw new LedgerImbalanceError(discrepancy, productId)
    }

    return { product: row, salePrice, split }
  }

  /**
   * FR-2.5 / NFR-3.3 — debit without a read-check-write race.
   *
   * A naive `read balance → compare → write` lets two concurrent orders both
   * pass the check and overdraw. This is a single conditional UPDATE: Postgres
   * decides, and an affected-row count of zero means the balance was not
   * sufficient at the moment of the write. `CHECK (balance >= 0)` in
   * scripts/constraints.sql backs it up if this is ever bypassed.
   */
  private async debitWallet(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    reference: string,
    description: string,
  ): Promise<void> {
    // `id` is TEXT, not uuid — Prisma maps String @id to text, so no cast here.
    const affected = await tx.$executeRaw`
      UPDATE users SET balance = balance - ${amount}
      WHERE id = ${userId} AND balance >= ${amount}
    `

    if (affected === 0) {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true },
      })
      throw new InsufficientBalanceError(current?.balance ?? 0, amount)
    }

    const after = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balance: true },
    })

    await tx.transaction.create({
      data: {
        userId,
        type: 'purchase',
        amount: -amount,
        balanceAfter: after.balance,
        description,
        reference,
      },
    })
  }

  /**
   * An agent shopping through their own link sells to themselves, which nets them
   * down to their own cost. That is intended (it is how an agent buys at cost),
   * so an explicit link always wins; their own code is only the fallback.
   */
  private async effectiveSeller(
    posted: string | null,
    user: AuthUser | undefined,
  ): Promise<string | null> {
    const code = posted?.trim().toUpperCase() || null
    if (code) {
      const seller = await this.prisma.user.findUnique({
        where: { referralCode: code },
        select: { role: true, status: true },
      })
      // An unknown or suspended seller falls back to the standard price rather
      // than failing the sale — the buyer did nothing wrong and should still be
      // able to buy (FR-3.5).
      if (!seller || seller.role !== 'agent' || seller.status !== 'active') return null
      return code
    }
    return user?.role === 'agent' ? user.referralCode : null
  }

  /**
   * A human-quotable reference (FR-4.9 — a guest tracks an order with this and
   * their phone number). Six digits, checked for collisions rather than trusted.
   */
  private async freshReference(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = `JDC-${Math.floor(100_000 + Math.random() * 899_999)}`
      const taken = await this.prisma.order.findUnique({
        where: { reference: candidate },
        select: { id: true },
      })
      if (!taken) return candidate
    }
    return `JDC-${Date.now().toString().slice(-9)}`
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /**
   * Orders visible to the caller. NFR-2.5 — row-level scoping, not just a role
   * check, so agent A cannot read agent B's orders by changing a query param.
   */
  async list(user: AuthUser, limit = 100) {
    const where = await this.scopeFor(user)
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    })
    return rows.map(toOrder)
  }

  private async scopeFor(user: AuthUser): Promise<Prisma.OrderWhereInput> {
    if (isAdminRole(user.role)) return {}

    if (user.role === 'customer') {
      // Their own purchases, including ones made as a guest before they signed
      // up — matched on the phone number they registered with.
      return { OR: [{ buyerUserId: user.id }, { buyerPhone: user.phone }] }
    }

    // An agent sees what they sold, plus what their downline sold, because their
    // earnings depend on it. Resolved to codes rather than joined, so a deep
    // chain stays one indexed IN query.
    const codes = await this.downlineCodes(user.referralCode)
    return { OR: [{ soldByCode: { in: codes } }, { buyerUserId: user.id }] }
  }

  /** The seller's own code plus every code beneath it, breadth-first. */
  private async downlineCodes(rootCode: string): Promise<string[]> {
    const codes = new Set<string>([rootCode])
    let frontier = [rootCode]

    // Bounded to match MAX_CHAIN_DEPTH in the pricing domain — a cycle in the
    // referral graph must not turn a list request into an infinite loop.
    for (let depth = 0; depth < 10 && frontier.length > 0; depth++) {
      const children: { referralCode: string }[] = await this.prisma.user.findMany({
        where: { uplineCode: { in: frontier }, role: 'agent' },
        select: { referralCode: true },
      })
      frontier = children.map((c) => c.referralCode).filter((c) => !codes.has(c))
      frontier.forEach((c) => codes.add(c))
    }

    return [...codes]
  }

  async byId(id: string, user: AuthUser | undefined) {
    const row = await this.prisma.order.findUnique({ where: { id } })
    if (!row) throw new NotFoundError('We could not find that order.')

    // A guest polling their own just-placed order has no session, so ownership is
    // proven by the reference in the URL plus nothing else — the id is a uuid and
    // unguessable, which is the same bearer-token logic a payment link uses.
    if (!user) return toTrackedOrder(row)

    if (isAdminRole(user.role)) return toOrder(row)

    const mine =
      row.buyerUserId === user.id ||
      row.buyerPhone === user.phone ||
      (row.soldByCode !== null && (await this.downlineCodes(user.referralCode)).includes(row.soldByCode))

    return mine ? toOrder(row) : toTrackedOrder(row)
  }

  /** FR-4.9 — a guest looks up an order with its reference and their number. */
  async track(dto: TrackOrderDto) {
    const reference = dto.reference.trim().toUpperCase()
    const digits = dto.phone.replace(/\D/g, '')
    // Match on the last 9 digits so 0244…, 233244… and +233244… all work.
    const tail = digits.slice(-9)

    const row = await this.prisma.order.findFirst({
      where: {
        reference,
        OR: [{ buyerPhone: { endsWith: tail } }, { recipient: { endsWith: tail } }],
      },
    })

    if (!row) {
      // One message for "no such reference" and "wrong phone number" together.
      // Distinguishing them would let anyone with a reference list confirm which
      // are real and probe for the number attached to them.
      throw new NotFoundError(
        'We could not find an order with that reference and phone number. Check both and try again.',
      )
    }

    return toTrackedOrder(row)
  }

  /**
   * Ask DataHub GH whether they will actually deliver to this number.
   *
   * Local validation (10 digits, a recognised prefix) only proves the number is
   * well-formed. DataHub keeps its own beneficiary list, and an MTN number that
   * is not on it fails *after* the customer has paid — the money then has to be
   * refunded and everybody's time is wasted. Asking first turns that into a
   * warning before checkout instead of a failure after it.
   *
   * Advisory, never blocking. Three reasons a "no" should not stop a sale:
   * their check covers MTN only, it can be unavailable, and a number can be
   * submitted for approval and start working. Refusing the sale on their say-so
   * would lose orders that would have gone through.
   */
  async verifyRecipient(productId: string, recipient: string) {
    const supplier = await this.prisma.product
      .findUnique({ where: { id: productId }, select: { supplier: true } })
      .then((p) => p?.supplier ?? null)

    // Only meaningful when we are actually going to call them, and only for the
    // networks their /verify covers.
    const checkable =
      this.supplier.isLive &&
      supplier?.networkKey !== undefined &&
      supplier?.networkKey !== null &&
      VERIFIABLE_NETWORK_KEYS.includes(supplier.networkKey)

    if (!checkable) {
      return { checked: false, verified: true, message: '' }
    }

    const result = await this.datahub.verify(supplier.networkKey as string, recipient)
    return {
      checked: true,
      verified: result.verified,
      message: result.verified
        ? ''
        : `${prettyGhanaPhone(recipient)} is not on our delivery partner's approved list, so this bundle cannot be sent to it yet. Contact support to have the number added.`,
    }
  }

  /** NFR-3.3 — money held for a Mobile Money payer whose order failed. */
  async claimableCredits(phone: string) {
    const tail = phone.replace(/\D/g, '').slice(-9)
    if (tail.length < 9) return []
    const rows = await this.prisma.claimableCredit.findMany({
      where: { phone: { endsWith: tail }, claimed: false },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((row) => ({
      phone: row.phone,
      amount: row.amount,
      reference: row.reference,
      createdAt: row.createdAt.toISOString(),
    }))
  }

  /** Admin view of what we asked the provider and what it said. */
  async dispatchesFor(orderId: string) {
    const rows = await this.prisma.supplierDispatch.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((row) => ({
      id: row.id,
      supplierCode: row.supplierCode,
      recipient: row.recipient,
      costPrice: row.costPrice,
      outcome: row.outcome,
      reason: row.reason,
      simulated: row.simulated,
      attempt: row.attempt,
      createdAt: row.createdAt.toISOString(),
      // What the provider said and did, rather than only our reading of it.
      // Without these an admin sees "failed" and has to guess between a dead
      // float, an unapproved recipient and a bundle the provider dropped.
      providerReference: row.providerReference,
      providerStatus: row.providerStatus,
      providerCharged: row.providerCharged,
      providerResponse: row.providerResponse,
    }))
  }

  /** Used by the fulfilment worker on boot to pick up orders left mid-flight. */
  async stuckOrderIds(olderThanMs: number): Promise<string[]> {
    const cutoff = new Date(Date.now() - olderThanMs)
    const rows = await this.prisma.order.findMany({
      where: { status: { in: ['pending', 'processing'] }, createdAt: { lt: cutoff } },
      select: { id: true },
      take: 200,
    })
    return rows.map((r) => r.id)
  }

  toResponse(order: Order) {
    return toOrder(order)
  }
}

/** 024 411 8820 — for a message a person reads, not a log line. */
function prettyGhanaPhone(phone: string): string {
  const p = phone.replace(/\D/g, '')
  return p.length === 10 ? `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` : phone
}
