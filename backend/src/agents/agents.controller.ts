import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { AgentsService } from './agents.service'
import { SetMarkupDto, SetPriceDto } from './agents.dto'

/**
 * Everything scoped to "me". There is deliberately no `/agents/:id/earnings` —
 * NFR-2.5 is easier to hold when the only readable identity is the token's.
 */
@ApiTags('agents')
@ApiBearerAuth()
@Controller('agents/me')
@Roles('agent')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get('earnings')
  earnings(@CurrentUser() user: AuthUser) {
    return this.agents.earnings(user.id)
  }

  @Get('prices')
  prices(@CurrentUser() user: AuthUser) {
    return this.agents.prices(user.id)
  }

  @Put('prices/:productId')
  setPrice(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body() dto: SetPriceDto,
  ) {
    return this.agents.setPrice(user.id, productId, dto.resalePrice)
  }

  @Delete('prices/:productId')
  clearPrice(@CurrentUser() user: AuthUser, @Param('productId') productId: string) {
    return this.agents.clearPrice(user.id, productId)
  }

  @Get('downline')
  downline(@CurrentUser() user: AuthUser) {
    return this.agents.downline(user.referralCode)
  }

  @Put('markup')
  setMarkup(@CurrentUser() user: AuthUser, @Body() dto: SetMarkupDto) {
    return this.agents.setMarkup(user.id, dto.markupPercent)
  }
}
