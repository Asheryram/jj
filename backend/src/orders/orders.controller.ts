import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { LoginThrottleGuard } from '../auth/login-throttle.guard'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { LicenseGate } from '../license/license.gate'
import { OrdersService } from './orders.service'
import { ReconcilerService } from '../supplier/reconciler.service'
import { FulfilmentService } from './fulfilment.service'
import { RefundsService } from './refunds.service'
import {
  AcknowledgeConflictDto,
  PlaceOrderDto,
  ReorderDto,
  ProviderReferenceDto,
  ResolveOrderDto,
  RetryDispatchDto,
  ReverseOrderOutcomeDto,
  TrackOrderDto,
  VerifyRecipientDto,
} from './orders.dto'

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly reconciler: ReconcilerService,
    private readonly fulfilment: FulfilmentService,
    private readonly refunds: RefundsService,
  ) {}

  /**
   * Public on purpose. FR-4.8, a guest arriving on an agent's sell link must be
   * able to complete a purchase, or the sell link is worthless. A signed-in
   * caller is still recognised, because the token is decoded on every route.
   */
  // Per IP, generous enough for a busy agent's walk-in sales, tight enough
  // that a script cannot pump out unpaid orders.
  // Refused while the subscription is lapsed, unless it is paid from a wallet balance the
  // customer already holds (see LicenseGate). Orders already paid for still finish.
  @LicenseGate('unless-wallet', 'Ordering is paused for a short while. Please try again later.')
  @Post()
  @UseGuards(LoginThrottleGuard)
  @Throttle({ burst: { limit: 20, ttl: 60_000 }, grind: { limit: 120, ttl: 900_000 } })
  place(
    @Body() dto: PlaceOrderDto,
    @CurrentUser() user: AuthUser | undefined,
    // Where Paystack should send this buyer back to, if it's their own agent's
    // custom domain, see `PaymentsService.callbackUrl`. Never trusted blindly:
    // only used if it resolves to the domain that specific agent actually has
    // live and approved.
    @Headers('origin') origin?: string,
  ) {
    return this.orders.place(dto, user, origin)
  }

  /**
   * Ask the provider whether they will deliver to this number, before the buyer
   * pays. Public, because the checkout it protects is public (FR-4.8).
   */
  // Rate-limited: every call asks a real provider, and on GMPL registers
  // the number on MTN's approval queue under this business's account, so an
  // unlimited loop could flood that queue and the approvals list.
  @Post('verify-recipient')
  @UseGuards(LoginThrottleGuard)
  @Throttle({ burst: { limit: 20, ttl: 60_000 }, grind: { limit: 120, ttl: 900_000 } })
  verifyRecipient(@Body() dto: VerifyRecipientDto) {
    return this.orders.verifyRecipient(dto.productId, dto.recipient)
  }

  /** FR-4.9, reference plus phone number, no account needed. */
  // Rate-limited: reference plus phone answers differently for a real
  // pair, which unthrottled would let a script guess its way through.
  @Post('track')
  @UseGuards(LoginThrottleGuard)
  @Throttle({ burst: { limit: 10, ttl: 60_000 }, grind: { limit: 40, ttl: 900_000 } })
  track(@Body() dto: TrackOrderDto) {
    return this.orders.track(dto)
  }

  @Get()
  @Roles()
  @ApiBearerAuth()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    return this.orders.list(user, limit ? Number(limit) : undefined)
  }

  /** The caller's own orders, paginated, see `OrdersService.mine`. */
  @Get('mine')
  @Roles()
  @ApiBearerAuth()
  mine(
    @CurrentUser() user: AuthUser,
    @Query('view') view?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.orders.mine(user, { view, q, page: Number(page), pageSize: Number(pageSize), from, to })
  }

  /** Money held for a failed Mobile Money order (NFR-3.3). */
  @Get('credits')
  @UseGuards(LoginThrottleGuard)
  @Throttle({ burst: { limit: 10, ttl: 60_000 }, grind: { limit: 40, ttl: 900_000 } })
  credits(@Query('phone') phone?: string) {
    return this.orders.claimableCredits(phone ?? '')
  }

  /**
   * Public so the checkout screen can poll a just-placed order while the provider
   * confirms. The uuid is the bearer here; a guest has no session to check
   * against, and the split is stripped for callers who cannot prove ownership.
   */
  @Get(':id')
  byId(@Param('id') id: string, @CurrentUser() user: AuthUser | undefined) {
    return this.orders.byId(id, user)
  }

  /** What we asked the provider and what it answered. Admin diagnostics. */
  @Get(':id/dispatches')
  @Roles('admin')
  @ApiBearerAuth()
  dispatches(@Param('id') id: string) {
    return this.orders.dispatchesFor(id)
  }

  /**
   * Settle a stuck order by hand, see `ReconcilerService.resolveManually`.
   * For the case nothing automatic ever resolves: the provider's own status
   * never reaches a recognised terminal word, even though the real outcome
   * (delivered or not) is already known to whoever is looking at it.
   */
  @Post(':id/resolve')
  @Roles('admin')
  @ApiBearerAuth()
  async resolve(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: ResolveOrderDto) {
    const handRefund = dto.outcome === 'rejected' && dto.alreadyRefunded === true
    // Checked first, so a refusal here leaves the order exactly as it was.
    if (handRefund) await this.refunds.assertHandRefundPossible(id, dto.momoNetwork)
    await this.reconciler.resolveManually(id, dto.outcome, user.id, dto.note)
    if (handRefund) await this.refunds.recordHandRefund(id, user.id, dto.note, dto.momoNetwork)
  }

  /**
   * Ask DataHub about a stuck order right now, see
   * `ReconcilerService.checkOrderByAdmin`. For an admin looking at a
   * "processing" order who does not want to wait on the reconciler's own
   * ten-minute clock.
   */
  @Post(':id/check-now')
  @Roles('admin')
  @ApiBearerAuth()
  checkNow(@Param('id') id: string) {
    return this.reconciler.checkOrderByAdmin(id)
  }

  /** Type in the reference from the delivery partner's dashboard, see `ReconcilerService.attachProviderReference`. */
  @Post(':id/provider-reference')
  @Roles('admin')
  @ApiBearerAuth()
  providerReference(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: ProviderReferenceDto) {
    return this.reconciler.attachProviderReference(id, dto, user)
  }

  /**
   * Retry dispatch by hand, see `FulfilmentService.retryDispatch`. Only for
   * an order whose last attempt timed out before DataHub ever answered, so
   * there is no reference for the automatic reconciler to check with, an
   * admin who has confirmed nothing was actually sent (their own dashboard,
   * for this recipient) can send the request again.
   */
  @Post(':id/retry-dispatch')
  @Roles('admin')
  @ApiBearerAuth()
  retryDispatch(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: RetryDispatchDto) {
    return this.fulfilment.retryDispatch(id, user.id, dto.note)
  }

  /**
   * Reorder a failed order whose refund has not been paid yet, see
   * `FulfilmentService.reorder`. Only valid while the refund is still
   * pending: once it is approved or paid, this is refused, because reordering
   * on top of that would hand the customer both the money back and the bundle.
   */
  @Post(':id/reorder')
  @Roles('admin')
  @ApiBearerAuth()
  async reorder(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: ReorderDto) {
    await this.reconciler.noteProviderRefunds(id).catch(() => undefined)
    return this.fulfilment.reorder(id, user.id, dto.note, dto.supplierCode, dto.confirmMarkedFailed)
  }

  /**
   * Clear a flagged conflict, see `ReconcilerService.acknowledgeConflict`.
   * For an order a settlement source disagreed with itself on, after a human
   * has actually checked what really happened.
   */
  @Post(':id/acknowledge-conflict')
  @Roles('admin')
  @ApiBearerAuth()
  acknowledgeConflict(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AcknowledgeConflictDto,
  ) {
    return this.reconciler.acknowledgeConflict(id, user.id, dto.note)
  }

  /**
   * Superadmin-only: reverse a mistaken completed/failed outcome.
   * Wipes the ledger entries for this order and re-settles with the
   * opposite outcome, so agent credits, refund requests and profit
   * figures are all corrected in one step.
   */
  @Post(':id/reverse-outcome')
  @Roles('superadmin')
  @ApiBearerAuth()
  reverseOutcome(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReverseOrderOutcomeDto,
  ) {
    return this.reconciler.reverseOrderOutcome(id, user.id, dto.note, dto.expectedStatus)
  }
}
