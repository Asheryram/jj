import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { WalletService } from './wallet.service'
import { TopUpDto } from './wallet.dto'
import { LicenseGate } from '../license/license.gate'

/** Customers only, an agent's balance is an earnings account, not a wallet. */
@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
@Roles('customer')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.wallet.summary(user.id)
  }

  @LicenseGate('always', 'Top-ups are paused for a short while. Please try again later.')
  @Post('topup')
  topUp(@CurrentUser() user: AuthUser, @Body() dto: TopUpDto) {
    return this.wallet.topUp(user.id, dto.amount, dto.network)
  }
}
