import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { IsIn, IsInt, Matches, Min } from 'class-validator'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { WithdrawalsService } from './withdrawals.service'

export class RequestWithdrawalDto {
  @IsInt({ message: 'Enter an amount like 50.00.' })
  @Min(1000, { message: 'The smallest withdrawal is GHS 10.00.' })
  amount!: number

  @IsIn(['MTN', 'Telecel', 'AirtelTigo'], { message: 'Choose the network to be paid on.' })
  momoNetwork!: 'MTN' | 'Telecel' | 'AirtelTigo'

  /**
   * The Mobile Money number to pay.
   *
   * Asked for rather than taken from the account, because the two are not always
   * the same: the number somebody signs in with is not necessarily the wallet they
   * want their earnings in, and a placeholder on the account — the bootstrap seeds
   * `0000000000` — would send a real transfer nowhere. Stored on the withdrawal, so
   * the record shows where the money was sent rather than where the account
   * happened to point later.
   */
  @Matches(/^0\d{9}$/, { message: 'A Ghana number needs 10 digits, like 0209876543.' })
  momoNumber!: string
}

export class DecideWithdrawalDto {
  @IsIn(['approved', 'rejected'])
  status!: 'approved' | 'rejected'
}

@ApiTags('withdrawals')
@ApiBearerAuth()
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  /** Agents see their own; admin sees the queue. Scoped in the service. */
  @Get()
  @Roles('agent', 'admin')
  list(@CurrentUser() user: AuthUser) {
    return this.withdrawals.list(user)
  }

  @Post()
  @Roles('agent')
  request(@CurrentUser() user: AuthUser, @Body() dto: RequestWithdrawalDto) {
    return this.withdrawals.request(user, dto.amount, dto.momoNetwork, dto.momoNumber)
  }

  @Patch(':id')
  @Roles('admin')
  decide(@Param('id') id: string, @Body() dto: DecideWithdrawalDto) {
    return this.withdrawals.decide(id, dto.status)
  }
}
