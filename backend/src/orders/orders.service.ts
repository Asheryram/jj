import { Injectable, Logger } from '@nestjs/common'
import { randomInt } from 'node:crypto'
import { Prisma, type Network, type Order, type OrderStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { PricingService } from '../pricing/pricing.service'
import { SettingsService } from '../settings/settings.service'
import { FulfilmentService } from './fulfilment.service'
import { PaymentsService } from '../payments/payments.service'
import { SupplierService, hasAutomatedFulfilment } from '../supplier/supplier.service'
import { DatahubClient } from '../supplier/datahub.client'
import { GmplClient, gmplSendOutcome, toGmplNetwork } from '../supplier/gmpl.client'
import { datahubNetworkKeyFor } from './approvals.service'
import type { SupplierProviderCode } from '../settings/settings.service'
import { ReconcilerService } from '../supplier/reconciler.service'
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
    private readonly gmpl: GmplClient,
    private readonly reconciler: ReconcilerService,
  ) {}

  /**
   * FR-4.3, place an order.
   *
   * Everything that decides money happens inside one transaction: the chain is
   * read, the split computed, the wallet debited, the order written. The provider
   * call is deliberately NOT in here, never hold a transaction open across an
   * outbound HTTP call (skills-breakdown.md §4.4.3). It is dispatched after
   * commit, and the order sits in `processing` until it answers.
   */
  async place(dto: PlaceOrderDto, user: AuthUser | undefined, origin?: string) {
    /**
     * A wallet purchase debits the balance inside this same call, there is
     * no Paystack step afterward to make it recoverable, unlike `momo`. An
     * idempotency key is optional everywhere else because a `momo` retry just
     * lands on the same `awaiting_payment` order, but a `wallet` retry with no
     * key would debit twice for one intended purchase on a flaky connection.
     * The frontend already always sends one; this is the backend not trusting
     * that to remain true forever, for the one path an irreversible debit
     * cannot depend on client cooperation.
     */
    if (dto.payWith === 'wallet' && !dto.idempotencyKey) {
      throw new ValidationError('A wallet purchase needs an idempotency key.')
    }

    const seller = await this.effectiveSeller(dto.sellerCode ?? null, user)
    const sellerCode = seller?.code ?? null

    // Replaying a key returns the original rather than erroring: the client that
    // retried cannot tell whether the first attempt was lost in the request or
    // the response, and a 409 would leave a real order stranded.
    if (dto.idempotencyKey) {
      const existing = await this.existingOrderFor(dto.idempotencyKey)
      if (existing) return existing
    }

    const buyerPhone = dto.buyerPhone ?? dto.recipient

    /**
     * Refuse before any money moves, not after.
     *
     * MTN will not deliver to a number that is not on DataHub's beneficiary list.
     * Until now the check here was advisory and nothing acted on it, so the order
     * was created, the customer paid, the dispatch came back `needs_approval`, and
     * the money sat in an approval hold for six hours before being refunded by
     * hand. Every one of those was a sale that could never have completed and a
     * refund somebody had to approve.
     *
     * So the sale is refused up front. `verifyRecipient` records the number as it
     * refuses, so it reaches the approvals queue whether the customer was stopped
     * at the checkout or got as far as submitting, one place, counted once.
     *
     * Only a definite refusal stops it. `verifyRecipient` returns verified for
     * both "they say it is fine" and "we could not ask them", because a provider
     * outage is not the customer's fault.
     */
    const registration = await this.verifyRecipient(dto.productId, dto.recipient)
    if (registration.checked && !registration.verified) {
      throw new ConflictError('RECIPIENT_NOT_REGISTERED', registration.message)
    }

    /**
     * Whether real money has to be collected before this order moves.
     *
     * A wallet payment is already money in hand, it was collected when the
     * wallet was topped up, so it is debited inside the transaction below and
     * the order proceeds. Mobile Money means Paystack, and nothing proceeds
     * until they say it arrived.
     *
     * With no Paystack key this is false and Mobile Money is simulated, which is
     * the right stand-in for acceptance testing and is announced at boot.
     */
    const needsPayment = dto.payWith === 'momo' && this.payments.live

    /**
     * The pre-check above proves nothing about what is still true by the
     * time this transaction actually commits, a genuine double-tap (exactly
     * the scenario `idempotencyKey` exists to protect against) can have both
     * requests pass that read before either creates its order. Postgres
     * correctly stops the loser at the unique constraint, but that used to
     * surface as a raw, unhandled `P2002`, a bare `409 ALREADY_EXISTS: "That
     * value is already registered"` instead of the original order or payment
     * URL, which is precisely the outcome `idempotencyKey` exists to avoid.
     * Caught here and resolved to the winner's own order instead.
     *
     * `reference`'s own collision (unrelated to idempotency, just two
     * six-digit random picks landing on the same value) is bounded odds, not
     * a replay, so a few attempts with a fresh one is the right response, not
     * treating a stranger's order as this customer's.
     */
    let order: Order | undefined
    let reference = await this.freshReference()
    for (let attempt = 0; !order; attempt++) {
      try {
        order = await this.prisma.$transaction(async (tx) => {
          const { product, salePrice, split } = await this.priceInside(tx, dto.productId, sellerCode, dto.recipient)

          // FR-2.3, a wallet payment is debited as the order is created, and only a
          // customer holds a spendable wallet. An agent's balance is earnings.
          if (dto.payWith === 'wallet') {
            if (!user || user.role !== 'customer') {
              throw new ValidationError(
                'Only a customer account holds a spendable wallet. Pay with Mobile Money instead.',
              )
            }
            // Same server-side gate as `WalletService.topUp()`: the product has
            // moved past customer wallets, but a legacy `customer`-role account
            // could still reach this branch directly even with the option
            // hidden from checkout. Checked here too, not just at top-up, since
            // this is the other place real money would move through it.
            if (!(await this.settings.get('walletEnabled', tx))) {
              throw new ValidationError('Wallet payment is not available right now. Pay with Mobile Money instead.')
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
              // Frozen alongside the price it was actually sold against, see
              // the field's own doc comment in schema.prisma for why dispatch
              // must read this instead of re-resolving the product live.
              supplierCodeAtSale: product.supplierCode,
              soldByCode: sellerCode,
              // Frozen at sale time, same reasoning as `productName`/`buyerPhone`
              // above: an agent's own name/code can change or be deleted later,
              // and a historical commission report should still say who earned it.
              soldByAgentName: seller?.name ?? null,
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
        const conflict = uniqueConstraintField(error)

        if (conflict === 'reference' && attempt < 3) {
          reference = await this.freshReference()
          continue
        }

        if (conflict === 'idempotency' && dto.idempotencyKey) {
          const existing = await this.existingOrderFor(dto.idempotencyKey)
          if (existing) return existing
        }

        throw error
      }
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
        sellerCode: order.soldByCode,
        origin,
      })
      return { ...toOrder(order), paymentUrl }
    }

    // Committed and paid for. Now ask the provider, and let the result land
    // asynchronously, the shape a real DataHub GH callback arrives in (FR-4.4).
    this.fulfilment.scheduleFor(order.id)

    return toOrder(order)
  }

  /**
   * What a replayed (or raced) idempotency key resolves to, undefined if
   * nothing has that key yet. Shared by the pre-check and by the actual
   * unique-constraint collision, so both agree on what "the same request,
   * again" means: a still-unpaid order needs its payment link handed back,
   * not just a receipt, or a customer who reloaded checkout is looking at an
   * order with no way to pay for it.
   */
  private async existingOrderFor(idempotencyKey: string) {
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey } })
    if (!existing) return undefined

    if (existing.status === 'awaiting_payment') {
      const paymentUrl = await this.payments.paymentUrlForOrder(existing.id)
      if (paymentUrl) return { ...toOrder(existing), paymentUrl }
    }
    return toOrder(existing)
  }

  /**
   * Remember a number the provider has not approved, so somebody can go and
   * approve it.
   *
   * DataHub's `/beneficiaries` endpoint 502s, so approving one there cannot be
   * automated, the only route is James doing it by hand in their dashboard,
   * and he can only do that if he knows which numbers to enter. GMPL's own
   * queue is submitted through their API instead, see
   * `ApprovalsService.submit`. Either way, `attempts` counts how many sales
   * each one has cost, which is the order to work through them in.
   *
   * `networkKey` is written in whichever vocabulary `provider` actually
   * speaks: DataHub's own (`product.supplier.networkKey`, e.g. YELLO) for a
   * DataHub row, GMPL's (`MTN`/`TELECEL`, derived from `product.network`) for
   * a GMPL one — never `product.supplier.networkKey` there, that column
   * holds GMPL's *bundle id* for a GMPL SKU, not a network name.
   */
  private async noteApprovalNeeded(
    productId: string,
    recipient: string,
    /**
     * The GMPL precheck result `verifyRecipient` already made, when this is
     * the direct GMPL decline, so `recordedAt`/`lastSendError` can be set
     * from the reply actually received, never a second, redundant call just
     * to ask the same question again. Undefined for a DataHub decline,
     * DataHub's own provider branch has no such reply to pass in.
     */
    gmplOutcome?: { recordedAt: Date | null; lastSendError: string | null },
  ): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { name: true, standardPrice: true, network: true, supplier: { select: { networkKey: true, provider: true } } },
    })
    const provider: SupplierProviderCode = (product?.supplier?.provider as SupplierProviderCode | undefined) ?? 'datahub-gh'
    const network: Network = product?.network ?? 'MTN'
    const networkKey = provider === 'gmpl' ? toGmplNetwork(network) : (product?.supplier?.networkKey ?? 'YELLO')
    const outcome = provider === 'gmpl' ? gmplOutcome : undefined

    await this.prisma.beneficiaryRequest.upsert({
      where: { phone_provider: { phone: recipient, provider } },
      create: {
        phone: recipient,
        provider,
        networkKey,
        lastProduct: product?.name ?? null,
        lastValue: product?.standardPrice ?? null,
        recordedAt: outcome?.recordedAt ?? null,
        lastSendError: outcome?.lastSendError ?? null,
      },
      update: {
        attempts: { increment: 1 },
        lastProduct: product?.name ?? null,
        lastValue: product?.standardPrice ?? null,
        // A number approved earlier and refused again is pending once more.
        approvedAt: null,
        // A fresh success clears any earlier failure and advances
        // `recordedAt`; a fresh failure only updates the reason, it must
        // never blank out a `recordedAt` an earlier attempt already earned.
        ...(outcome
          ? outcome.recordedAt
            ? { recordedAt: outcome.recordedAt, lastSendError: null }
            : { lastSendError: outcome.lastSendError }
          : {}),
      },
    })

    this.log.warn(`${recipient} needs ${provider === 'gmpl' ? 'GMPL' : 'DataHub'} approval, sale refused`)

    /**
     * Reach the other provider immediately, not only whenever an admin next
     * happens to open the Approvals screen (`ApprovalsService.pending`'s own
     * `ensureCounterparts` is the lazy fallback for everything that is not a
     * fresh decline, this is the eager path for one that just happened).
     * Routing can move a network from one provider to the other at any
     * time, and whichever provider did not see this particular sale
     * deserves to learn about the number just as promptly as the one that
     * did, GMPL especially, their own docs ask for the real recipient
     * before a charge, not whenever we next happen to batch it.
     *
     * Deliberately not awaited by the caller: this customer is being told
     * "declined" based on the provider that actually declined them, right
     * now, a second live call to a provider they are not even buying from
     * must not add its own latency to that response. Errors are logged,
     * never surfaced, the lazy fallback in `ApprovalsService` still catches
     * anything missed here the next time the Approvals screen loads.
     */
    void this.registerWithOtherProvider(provider, network, recipient).catch((error: unknown) =>
      this.log.error(`${recipient}: failed to register with the other provider, ${String(error)}`),
    )
  }

  /**
   * The counterpart half of `noteApprovalNeeded`: tell whichever provider
   * did NOT just decline this sale about the number too.
   *
   * Only for MTN/Telecel, GMPL never sells AirtelTigo, so DataHub is the
   * only provider that could ever need to know about one of those, and it
   * already does (the branch that called this). Skipped entirely if a row
   * for the other provider already exists, an existing row (approved or
   * not) already reflects whatever that provider has actually said, and
   * must never be reset by a sale it was never asked about.
   */
  private async registerWithOtherProvider(
    provider: SupplierProviderCode,
    network: Network,
    recipient: string,
  ): Promise<void> {
    if (network === 'AirtelTigo') return
    const other: SupplierProviderCode = provider === 'gmpl' ? 'datahub-gh' : 'gmpl'

    const existing = await this.prisma.beneficiaryRequest.findUnique({
      where: { phone_provider: { phone: recipient, provider: other } },
    })
    if (existing) return

    if (other === 'gmpl') {
      // A real, working API call, `record: true` registers it on their own
      // Pending MTN Approval queue immediately. If they already know this
      // number (e.g. it was never actually new to them), the row is created
      // pre-approved rather than falsely parked as pending.
      const gmplNetwork = toGmplNetwork(network)
      const result = await this.gmpl.precheckBeneficiary(gmplNetwork, [recipient], true)
      // `enforced` false (sandbox, or the kill switch) means `known: true`
      // is an honest "nothing is blocking you right now", never a real
      // decision, see `GmplClient.precheckBeneficiary`'s own doc comment.
      // Pre-approving off that would be wrong the moment a live key, or a
      // re-enabled switch, starts actually enforcing Up2U again.
      const genuinelyKnown = result.kind === 'ok' && result.enforced && (result.results[0]?.known ?? false)
      const { recordedAt, lastSendError } = gmplSendOutcome(result)
      await this.prisma.beneficiaryRequest.createMany({
        data: [
          {
            phone: recipient,
            provider: 'gmpl',
            networkKey: gmplNetwork,
            attempts: 0,
            approvedAt: genuinelyKnown ? new Date() : null,
            recordedAt,
            lastSendError,
          },
        ],
        skipDuplicates: true,
      })
    } else {
      // DataHub's own submission endpoint is broken (502 on every valid
      // request, see `ApprovalsService`'s own class comment), there is no
      // live call to make here, only the tracking row so it shows up for
      // an admin to copy into their dashboard by hand.
      await this.prisma.beneficiaryRequest.createMany({
        data: [{ phone: recipient, provider: 'datahub-gh', networkKey: datahubNetworkKeyFor(network), attempts: 0 }],
        skipDuplicates: true,
      })
    }
  }

  /**
   * Price the order from rows read inside the transaction.
   *
   * A price posted by the browser is never trusted. Even the price the browser
   * *displayed* is only a quote, if an upline changed theirs a second ago, the
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
    // table unable to be right (a 020 line can genuinely be on MTN) so it
    // turned away customers who could have been served, and a new NCA range did
    // the same to everyone on it. Deliverability is the supplier's answer to give:
    // it refuses what it cannot send, and a refused order refunds.
    // Do not take money for something we cannot deliver.
    //
    // While live, a product whose provider SKU has no automated-fulfilment
    // mapping can never be fulfilled. Dispatch used to catch this, but only
    // after the buyer had paid: the order failed, the money came back, and
    // the customer was left wondering what they had done wrong. Refusing
    // here costs them nothing.
    const supplierRow = await tx.product
      .findUnique({ where: { id: productId }, select: { supplier: true } })
      .then((r) => r?.supplier ?? null)

    /**
     * Defence in depth behind `CatalogueService.snapshot`'s own routing
     * filter: that's what keeps a non-selected provider's bundle off the
     * storefront in the first place, this is what stops an order for one
     * anyway, a stale cached listing, a direct API call, a sell link saved
     * from before the last routing change. Checked regardless of whether
     * either provider is live, routing is a catalogue decision, not a
     * money-is-real one. `network: null` products (checkers, AFA) are never
     * routable at all, see `providerFor`'s own comment, so this is a no-op
     * for them.
     */
    if (supplierRow) {
      const settingsNow = await this.settings.all(tx)
      const selectedProvider = this.settings.providerFor(settingsNow.networkProviderRouting, row.network, row.category)
      // No network (result checkers): not routable, sold by its own provider.
      if (row.network !== null && supplierRow.provider !== selectedProvider) {
        throw new ConflictError(
          'PRODUCT_INACTIVE',
          `${row.name} is not on sale at the moment. Pick another bundle.`,
        )
      }

      /**
       * Same reasoning as the routing check just above: a supplier reporting
       * out of stock is a catalogue fact, not a real-money one, so it is
       * refused here regardless of whether this provider is live, not only
       * gated behind it. `CatalogueService.snapshot` already keeps an
       * out-of-stock bundle out of the storefront for a browsing customer;
       * this is what stops an order placed anyway, the same defence in depth
       * as the routing check above it.
       */
      if (!supplierRow.available) {
        throw new ConflictError(
          'PRODUCT_OUT_OF_STOCK',
          `${row.name} is out of stock with our delivery partner right now. Please choose another bundle.`,
        )
      }
    }

    // The provider `SupplierService.dispatch()` would actually resolve to for
    // this order, defaulting to DataHub the same way it does, so an entirely
    // unmapped product (no supplier row at all) is still refused here exactly
    // as before, not silently let through because there is no `.provider` to
    // check liveness against.
    const effectiveProvider = supplierRow?.provider ?? 'datahub-gh'

    if (this.supplier.isLiveFor(effectiveProvider)) {
      if (!supplierRow || !hasAutomatedFulfilment(supplierRow)) {
        throw new ConflictError(
          'NO_AUTOMATED_FULFILMENT',
          `${row.name} cannot be delivered automatically at the moment. Please choose another bundle.`,
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
    // transaction, so the rate cannot move between pricing and writing.
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
   * FR-2.5 / NFR-3.3, debit without a read-check-write race.
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
    // `id` is TEXT, not uuid, Prisma maps String @id to text, so no cast here.
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
  ): Promise<{ code: string; name: string } | null> {
    const code = posted?.trim().toUpperCase() || null
    if (code) {
      const seller = await this.prisma.user.findUnique({
        where: { referralCode: code },
        select: { role: true, status: true, name: true },
      })
      // An unknown or suspended seller falls back to the standard price rather
      // than failing the sale, the buyer did nothing wrong and should still be
      // able to buy (FR-3.5).
      if (!seller || seller.role !== 'agent' || seller.status !== 'active') return null
      return { code, name: seller.name }
    }
    return user?.role === 'agent' ? { code: user.referralCode, name: user.name } : null
  }

  /**
   * A human-quotable reference (FR-4.9, a guest tracks an order with this and
   * their phone number). Six digits, checked for collisions rather than trusted.
   */
  private async freshReference(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      // 9 digits (~900 million possibilities), not 6 (~900 thousand), a
      // reference is shown on receipts and typed into Track, so it stays
      // public and guessable-in-principle either way, but the old space was
      // small enough to make enumerating real references a real option for
      // whoever tried, not just a theoretical one. `randomInt` over
      // `Math.random()` for the same reason: no reason to make it any more
      // predictable than it has to be.
      const candidate = `JDC-${randomInt(100_000_000, 999_999_999)}`
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
   * Orders visible to the caller. NFR-2.5, row-level scoping, not just a role
   * check, so agent A cannot read agent B's orders by changing a query param.
   */
  async list(user: AuthUser, limit = 100) {
    const where = await this.scopeFor(user)
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    })

    if (!isAdminRole(user.role)) return rows.map(toOrder)
    return this.enrichForAdmin(rows)
  }

  /**
   * Admin's paginated, filterable order list (`GET /admin/orders`).
   *
   * `list()` above is capped at 500 rows and filtered client-side, fine for
   * an agent or customer's own small history, but an admin's table is the
   * whole platform's, and 500 most-recent-of-everything can already be
   * hours old on a busy day, silently dropping older `failed` orders off the
   * end before anyone searches for them. This runs the filter (status, date
   * range, text search) and the count in the database instead, so "show me
   * every failed order from last Tuesday" is an actual query, not a client
   * array scan over whatever happened to already be loaded.
   *
   * `q` matches the same columns the old client-side search did, reference,
   * recipient, buyer name/phone, sell-link code, the agent name frozen at
   * sale, and product name, with one deliberate reduction: it does not reach
   * into `split` to match an upline agent's name several levels up a chain.
   * That was only ever useful under multi-level referral, which is off, and
   * a JSON-text search across every order would give up the date-range
   * filter's index in the process.
   */
  async adminList(filter: {
    status?: OrderStatus
    from?: Date
    to?: Date
    q?: string
    /**
     * Orders still open (`pending`/`processing`) whose most recent dispatch
     * attempt timed out with no `providerReference` ever obtained, the exact
     * shape `ReconcilerService.needsAttention()` calls "stuck" and this
     * order's own `dispatchUnresolved` field flags per-row. Overrides
     * `status` when set, since "unresolved" only ever means an open order.
     */
    unresolvedOnly?: boolean
    page?: number
    pageSize?: number
  }) {
    const page = Math.max(1, Math.floor(filter.page ?? 1))
    const pageSize = Math.min(Math.max(1, Math.floor(filter.pageSize ?? 50)), 2000)
    const where = this.adminOrdersWhere(filter)

    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return { rows: await this.enrichForAdmin(rows), total, page, pageSize }
  }

  private adminOrdersWhere(filter: {
    status?: OrderStatus
    from?: Date
    to?: Date
    q?: string
    unresolvedOnly?: boolean
  }): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {}
    if (filter.unresolvedOnly) {
      // A retried order can carry an early `unknown` attempt and still have
      // gone on to resolve normally, but by the time that happens its status
      // has already moved to `completed`/`failed`, so pairing this with the
      // open-status filter is safe: nothing still `pending`/`processing`
      // with an `unknown`, reference-less attempt on file has resolved yet.
      where.status = { in: ['pending', 'processing'] }
      where.dispatches = { some: { outcome: 'unknown', providerReference: null } }
    } else if (filter.status) {
      where.status = filter.status
    }
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      }
    }
    const q = filter.q?.trim()
    if (q) {
      where.OR = [
        { reference: { contains: q, mode: 'insensitive' } },
        { recipient: { contains: q, mode: 'insensitive' } },
        { buyer: { contains: q, mode: 'insensitive' } },
        { buyerPhone: { contains: q, mode: 'insensitive' } },
        { soldByCode: { contains: q, mode: 'insensitive' } },
        { soldByAgentName: { contains: q, mode: 'insensitive' } },
        { productName: { contains: q, mode: 'insensitive' } },
      ]
    }
    return where
  }

  /**
   * The admin-only fields layered onto a plain order row: what the supplier
   * actually charged versus the catalogue estimate, the real Paystack fee,
   * DataHub's own routing/ticket details, and where an open refund stands.
   * Shared by `list()` (an admin's own capped, unfiltered view) and
   * `adminList()` (the paginated, filtered one), so the two can never quietly
   * drift into showing different figures for the same order.
   */
  private async enrichForAdmin(rows: Order[]) {
    /**
     * Admin also gets what the supplier actually charged, alongside the
     * estimate frozen into `split` at sale time, the two can disagree (see
     * `SupplierService.dispatch`'s COST MISMATCH log), and only admin needs
     * to see by how much. Not exposed to an agent or customer: it is the
     * platform's real wholesale cost, not theirs to see.
     *
     * Read from the `supplier_cost` ledger entry itself, not re-derived from
     * `SupplierDispatch`, `FulfilmentService.recordDelivered` can fall back
     * to a sibling order's real charge when this one's own dispatch didn't
     * report one (see `lastRealCost`), so the dispatch row alone no longer
     * always matches what was actually booked. The ledger entry is that
     * booking, so reading it back here can never disagree with it.
     */
    /**
     * Whether the *most recent* dispatch attempt for a still-open order came
     * back `unknown`, the purchase call timed out before any reply arrived
     * at all, so there is no `providerReference` for the reconciler to ever
     * check with, and this order will sit in `processing` looking exactly
     * like a normal, healthy in-flight one until somebody happens to open it.
     * Computed only for `pending`/`processing` rows, a completed or failed
     * order's dispatch history is no longer this urgent.
     */
    const openOrderIds = rows.filter((r) => r.status === 'pending' || r.status === 'processing').map((r) => r.id)
    const dispatchesForOpenOrders =
      openOrderIds.length > 0
        ? await this.prisma.supplierDispatch.findMany({
            where: { orderId: { in: openOrderIds } },
            orderBy: { createdAt: 'desc' },
            select: { orderId: true, outcome: true },
          })
        : []
    const unresolvedOrderIds = new Set<string>()
    const seenOrderId = new Set<string>()
    for (const dispatch of dispatchesForOpenOrders) {
      // Already sorted newest-first, so the first row seen per order is its
      // latest attempt, anything after that for the same order is history.
      if (seenOrderId.has(dispatch.orderId)) continue
      seenOrderId.add(dispatch.orderId)
      if (dispatch.outcome === 'unknown') unresolvedOrderIds.add(dispatch.orderId)
    }

    const costEntries = await this.prisma.ledgerEntry.findMany({
      where: { kind: 'supplier_cost', orderRef: { in: rows.map((r) => r.reference) } },
      select: { orderRef: true, amount: true },
    })
    const orderIdByRef = new Map(rows.map((r) => [r.reference, r.id]))
    const actualCostByOrderId = new Map<string, number>()
    for (const entry of costEntries) {
      const orderId = entry.orderRef ? orderIdByRef.get(entry.orderRef) : undefined
      // Summed: a retried or reordered order can be charged once per attempt.
      if (orderId) actualCostByOrderId.set(orderId, (actualCostByOrderId.get(orderId) ?? 0) - entry.amount)
    }

    /**
     * What Paystack actually kept, per `Payment.fee`, not `split.processingFee`,
     * which is only the estimate charged to the buyer at checkout to cover it.
     * The two are usually close but are never guaranteed equal, and this is the
     * same figure the ledger's `payment_fee` entries and the Overview page's
     * cost breakdown already use, reading the estimate here would show a
     * number that quietly disagreed with the rest of the platform.
     *
     * Null for a wallet-paid order on purpose: the fee was already paid once,
     * at top-up time, not again on every spend from that balance.
     */
    const payments = await this.prisma.payment.findMany({
      where: { orderId: { in: rows.map((r) => r.id) } },
      select: { orderId: true, fee: true },
    })
    const feeByOrderId = new Map<string, number | null>()
    for (const p of payments) {
      if (p.orderId) feeByOrderId.set(p.orderId, p.fee)
    }

    /**
     * Where a failed order's refund actually stands, a person always
     * decides this (see `RefundRequest`'s own doc comment), so unlike
     * delivery there is no "automatic" version to compare against. `pending`
     * is the one that matters most to surface: a failed order sitting there
     * is money nobody has actually paid back yet, waiting on a click.
     * `approved` is already covered by `Order.refunded` and isn't repeated
     * here; this exists for `pending` and `rejected`, which nothing else shows.
     */
    const refundRequests = await this.prisma.refundRequest.findMany({
      where: { orderId: { in: rows.map((r) => r.id) } },
      select: { orderId: true, status: true, createdAt: true },
    })
    const refundStatusByOrderId = new Map<string, 'pending' | 'approved' | 'rejected'>()
    /**
     * A failed order has no dedicated "when it failed" column the way a
     * delivered one has `completedAt`, but the refund request that pays it
     * back is written inside the exact same transaction that flips the order
     * to `failed` (see `FulfilmentService.settle`'s rejected branch), so its
     * `createdAt` is, for every practical purpose, that same moment.
     */
    const refundCreatedAtByOrderId = new Map<string, Date>()
    for (const r of refundRequests) {
      refundStatusByOrderId.set(r.orderId, r.status)
      refundCreatedAtByOrderId.set(r.orderId, r.createdAt)
    }

    /**
     * Which actual supplier fulfilled this sale, DataHub or GMPL, batched
     * across the whole page rather than one `resolveSupplierProvider` call
     * per row (this can be up to 2000 rows, see `adminList`). Admin has had
     * no way to tell the two apart on this screen since GMPL went live,
     * every order silently read as if DataHub always fulfilled it.
     */
    const supplierCodes = [...new Set(rows.map((r) => r.supplierCodeAtSale).filter((c): c is string => Boolean(c)))]
    const supplierRows =
      supplierCodes.length > 0
        ? await this.prisma.supplierProduct.findMany({
            where: { code: { in: supplierCodes } },
            select: { code: true, provider: true },
          })
        : []
    const providerByCode = new Map(supplierRows.map((s) => [s.code, s.provider as SupplierProviderCode]))
    const providerFor = (code: string | null): SupplierProviderCode =>
      code ? (providerByCode.get(code) ?? 'datahub-gh') : 'datahub-gh'

    return rows.map((row) => ({
      ...toOrder(row),
      actualSupplierCost: actualCostByOrderId.get(row.id) ?? null,
      paystackFee: feeByOrderId.get(row.id) ?? null,
      /** Which supplier actually fulfilled this order, see `providerFor` above. */
      provider: providerFor(row.supplierCodeAtSale),
      /** See `refundCreatedAtByOrderId` above, null for anything that isn't `failed`. */
      failedAt: row.status === 'failed' ? (refundCreatedAtByOrderId.get(row.id)?.toISOString() ?? null) : null,
      /**
       * How the order's own reference reads, not something either side chose
       * on this platform. A `manual_`-prefixed reference only ever comes from
       * DataHub, their own naming for routing one of their staff to clear it
       * by hand rather than it going through their automated path; GMPL has
       * no equivalent, so every GMPL reference lands in 'code' instead,
       * alongside DataHub's own plain, automated ones (check `provider`
       * above to tell those two apart). Nothing about the order or the
       * recipient predicts a DataHub 'manual' from a DataHub 'code': the
       * exact same bundle to the exact same number has gone either way on
       * different days. It matters to admin because a manual-routed order
       * can take many hours longer to settle, and is the shape most likely
       * to get permanently stuck and need `resolveManually`. Null until the
       * provider has actually replied with a reference at all, distinct from
       * 'code', which is a positive answer, not just the absence of 'manual'.
       */
      fulfilmentReference: row.providerReference == null
        ? null
        : row.providerReference.startsWith('manual_')
          ? ('manual' as const)
          : ('code' as const),
      /**
       * DataHub's own numeric ticket ID for a manual-routed order, pulled
       * straight out of the reference they already gave us, `manual_<this>_
       * <their-timestamp>`. Confirmed against a real duplicate-order error
       * they once sent, which named the same order by this exact number
       * (`existingOrder.orderNumber`) as well as by this same reference. Not
       * a new thing to store: every manual order that has ever existed
       * already carries it, so this shows up for old orders too, not just
       * ones placed from now on. It's what admin would quote back to
       * DataHub's support when a manual order needs chasing.
       */
      manualOrderNumber:
        row.providerReference?.startsWith('manual_') && row.providerReference.split('_').length >= 2
          ? row.providerReference.split('_')[1]
          : null,
      /**
       * True when an admin forced this order's outcome through `resolveManually`
       * rather than DataHub's own webhook or the reconciler's polling ever
       * confirming it, a completely different thing from `fulfilmentReference`
       * being 'manual', which is about DataHub routing the purchase to their own
       * staff. This one is about who on our side decided the outcome.
       */
      resolvedManually: row.resolvedManually,
      /** See the query above. Only ever true for a `pending`/`processing` row. */
      dispatchUnresolved: unresolvedOrderIds.has(row.id),
      /**
       * `pending`/`rejected` only, `approved` is already `Order.refunded`,
       * shown as the existing "Refunded" badge, so this deliberately doesn't
       * repeat it. Null when there's no refund request at all (nothing was
       * ever owed back).
       */
      refundStatus: (() => {
        const status = refundStatusByOrderId.get(row.id)
        return status && status !== 'approved' ? status : null
      })(),
    }))
  }

  private async scopeFor(user: AuthUser): Promise<Prisma.OrderWhereInput> {
    if (isAdminRole(user.role)) return {}

    if (user.role === 'customer') {
      // Only purchases made signed in to this account. Matching guest orders
      // on the registered phone used to be included too, but a phone number
      // is never verified here, so anyone registering with somebody else's
      // number could read all their guest orders (recipients, checker
      // vouchers). A guest order stays reachable by reference plus phone
      // on the Track page, exactly as before.
      return { buyerUserId: user.id }
    }

    // An agent sees what they sold, and what they bought themselves. Not
    // their downline's sales any more: referral sharing is off, so an upline
    // earns nothing on them, and seeing them exposed another agent's buyers
    // and margins.
    return { OR: [{ soldByCode: user.referralCode }, { buyerUserId: user.id }] }
  }

  async byId(id: string, user: AuthUser | undefined) {
    let row = await this.prisma.order.findUnique({ where: { id } })
    if (!row) throw new NotFoundError('We could not find that order.')

    // Whoever is polling this is almost always watching their own receipt
    // page settle, see `checkOrderNow`'s own comment. Re-read afterwards
    // only when it actually resolved something, so this stays a no-op read
    // in the ordinary case where the order was not even due a check yet.
    if (await this.reconciler.checkOrderNow(row)) {
      row = await this.prisma.order.findUnique({ where: { id } })
      if (!row) throw new NotFoundError('We could not find that order.')
    }

    const paymentCollected = await this.paymentCollectedFlag(row.id, row.status)

    // A guest polling their own just-placed order has no session, so ownership is
    // proven by the reference in the URL plus nothing else, the id is a uuid and
    // unguessable, which is the same bearer-token logic a payment link uses.
    if (!user) return { ...toTrackedOrder(row), paymentCollected }

    if (isAdminRole(user.role)) return { ...toOrder(row), paymentCollected }

    // The buyer's own account, or the agent who sold it. Not a phone match
    // (never verified, see `scopeFor`), and not an upline (referral sharing
    // is off, an upline earns nothing on a downline sale and has no reason
    // to see its buyer or its margin).
    const mine = row.buyerUserId === user.id || (row.soldByCode !== null && row.soldByCode === user.referralCode)

    return mine ? { ...toOrder(row), paymentCollected } : { ...toTrackedOrder(row), paymentCollected }
  }

  /**
   * Only meaningful when `status === 'failed'`, and only computed then: a
   * `RefundRequest` exists exactly when `FulfilmentService.settle` decided
   * money had actually been collected (see its own `collected` check), so
   * its presence is the one clean signal that tells apart two very different
   * failures a buyer can land on, a Mobile Money charge that never went
   * through at all (nothing to give back) from a payment that succeeded and
   * a delivery that then failed (a refund genuinely owed). Without it, both
   * read identically as "failed", and showing refund language for a charge
   * that was never taken is its own broken promise, shared by `byId` and
   * `track`, the two places a buyer ever sees their own order's status.
   */
  private async paymentCollectedFlag(orderId: string, status: string): Promise<boolean | undefined> {
    if (status !== 'failed') return undefined
    const refund = await this.prisma.refundRequest.findUnique({ where: { orderId }, select: { id: true } })
    return refund !== null
  }

  /** FR-4.9, a guest looks up an order with its reference and their number. */
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

    const paymentCollected = await this.paymentCollectedFlag(row.id, row.status)
    return { ...toTrackedOrder(row), paymentCollected }
  }

  /**
   * Ask DataHub GH whether they will actually deliver to this number.
   *
   * Local validation (10 digits, a recognised prefix) only proves the number is
   * well-formed. DataHub keeps its own beneficiary list, and an MTN number that
   * is not on it fails *after* the customer has paid, the money then has to be
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

    // Only meaningful when we are actually going to call somebody real.
    if (!supplier || !this.supplier.isLiveFor(supplier.provider)) {
      return { checked: false, verified: true, message: '' }
    }

    if (supplier.provider === 'gmpl') {
      // Their MTN Up2U precheck, the same role DataHub's /verify plays
      // below, but a different provider with a different check. TELECEL
      // never blocks, so nothing here is worth asking about.
      if (supplier.network !== 'MTN') return { checked: false, verified: true, message: '' }

      /**
       * `record: true`: their own docs are explicit that this is meant to
       * be called with the real recipient right before charging, so an
       * unknown number reaches MTN's own approval queue the moment it is
       * discovered, not only whenever an admin next happens to run a bulk
       * resubmit from the Approvals screen. Confirmed against their
       * published docs, not reverse-engineered.
       */
      const result = await this.gmpl.precheckBeneficiary('MTN', [recipient], true)
      // Maintenance: their own docs say not to place the order yet, same
      // "provider outage is not the customer's fault" treatment as an
      // unreachable check below, not a refusal.
      if (result.kind === 'ok' && !result.acceptingOrders) {
        return { checked: false, verified: true, message: '' }
      }
      const entry = result.kind === 'ok' ? result.results[0] : null
      if (entry && entry.valid && !entry.known) {
        // Same reasoning as the DataHub refusal below: this is the only
        // point in the flow that sees a refused number, so it is recorded
        // here, into the same `BeneficiaryRequest` table (now provider-aware,
        // see `noteApprovalNeeded`), or GMPL's own queue is just as invisible
        // to an admin as DataHub's would be if this call were skipped.
        await this.noteApprovalNeeded(productId, recipient, gmplSendOutcome(result)).catch((error: unknown) =>
          this.log.error(`${recipient}: failed to record approval-needed, ${String(error)}`),
        )
        return {
          checked: true,
          verified: false,
          message:
            `${prettyGhanaPhone(recipient)} is not yet approved by our delivery partner for MTN, so ` +
            'this bundle cannot be sent to it yet. Please try again a little later, or contact support.',
        }
      }
      return { checked: true, verified: true, message: '' }
    }

    // Only meaningful for the networks DataHub's /verify covers.
    const checkable = supplier.networkKey !== null && VERIFIABLE_NETWORK_KEYS.includes(supplier.networkKey)
    if (!checkable) {
      return { checked: false, verified: true, message: '' }
    }

    const result = await this.datahub.verify(supplier.networkKey as string, recipient)

    /**
     * Three answers, and only one of them stops a sale.
     *
     * `registered` proceeds. `not_registered` is a refusal, and the checkout has
     * to honour it, the money must not be taken for a bundle that cannot be
     * delivered. `unknown` proceeds too: their API being unreachable is our
     * problem, not the customer's, and the approval hold already covers an order
     * that turns out to be undeliverable.
     */
    if (result.kind === 'not_registered') {
      /**
       * Record it here, because this is where the customer is turned away.
       *
       * The checkout disables its pay button on this answer, so the order is never
       * submitted and `place` never runs, which means recording it there would
       * capture nothing at all. This is the only point in the flow that sees a
       * refused number, and getting it in front of an admin is the entire reason
       * the refusal is worth anything: they copy it into DataHub's dashboard, and
       * that customer can come back and buy.
       */
      await this.noteApprovalNeeded(productId, recipient).catch((error: unknown) =>
        this.log.error(`${recipient}: failed to record approval-needed, ${String(error)}`),
      )

      return {
        checked: true,
        verified: false,
        message:
          `${prettyGhanaPhone(recipient)} is not on our delivery partner's approved list, so ` +
          'this bundle cannot be sent to it yet. We have passed the number on to be added, ' +
          'please try again a little later, or contact support.',
      }
    }

    if (result.kind === 'unknown') {
      this.log.warn(`could not verify ${recipient}: ${result.reason}, allowing the sale`)
    }

    return { checked: true, verified: true, message: '' }
  }

  /** NFR-3.3, money held for a Mobile Money payer whose order failed. */
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

  toResponse(order: Order) {
    return toOrder(order)
  }
}

/** 024 411 8820, for a message a person reads, not a log line. */
function prettyGhanaPhone(phone: string): string {
  const p = phone.replace(/\D/g, '')
  return p.length === 10 ? `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` : phone
}

/**
 * Which unique column a `P2002` actually fired on, in `place()`'s own terms,
 * `null` for anything else (including a non-Prisma error, which this must
 * never swallow). Same `String(meta.target).includes(...)` shape as the
 * global exception filter's own P2002 handling, kept local here because the
 * two conflicts it distinguishes only mean something to `place()` itself.
 */
function uniqueConstraintField(error: unknown): 'idempotency' | 'reference' | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return null
  const target = String((error.meta as { target?: string[] })?.target ?? '')
  if (target.includes('idempotency')) return 'idempotency'
  if (target.includes('reference')) return 'reference'
  return null
}
