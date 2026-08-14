import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { OrdersService } from './orders.service'
import { PlaceOrderDto, TrackOrderDto } from './orders.dto'

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * Public on purpose. FR-4.8 — a guest arriving on an agent's sell link must be
   * able to complete a purchase, or the sell link is worthless. A signed-in
   * caller is still recognised, because the token is decoded on every route.
   */
  @Post()
  place(@Body() dto: PlaceOrderDto, @CurrentUser() user: AuthUser | undefined) {
    return this.orders.place(dto, user)
  }

  /** FR-4.9 — reference plus phone number, no account needed. */
  @Post('track')
  track(@Body() dto: TrackOrderDto) {
    return this.orders.track(dto)
  }

  @Get()
  @Roles()
  @ApiBearerAuth()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    return this.orders.list(user, limit ? Number(limit) : undefined)
  }

  /** Money held for a failed Mobile Money order (NFR-3.3). */
  @Get('credits')
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
}
