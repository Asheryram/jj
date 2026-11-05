import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator'
import { CurrentUser, RequireActive, Roles, type AuthUser } from '../common/auth'
import { TreasuryService } from './treasury.service'

export class TreasuryWithdrawDto {
  @IsIn(['provider_refill', 'owner_drawing'], { message: 'Choose what this withdrawal is for.' })
  purpose!: 'provider_refill' | 'owner_drawing'

  @ValidateIf((dto: TreasuryWithdrawDto) => dto.purpose === 'provider_refill')
  @IsIn(['datahub-gh', 'gmpl'], { message: 'Choose which provider float this refills.' })
  provider?: 'datahub-gh' | 'gmpl'

  /** Pesewas. The real floor and ceiling are checked in `TreasuryService.withdraw`. */
  @IsInt({ message: 'Enter an amount like 50.00.' })
  @Min(1, { message: 'Enter an amount greater than zero.' })
  amount!: number

  @IsString()
  destinationId!: string

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string
}

export class TreasuryDestinationDto {
  @IsString()
  @MinLength(2, { message: 'Give this number a name, like "James MTN".' })
  @MaxLength(60)
  label!: string

  @Matches(/^0\d{9}$/, { message: 'A Ghana number needs 10 digits, like 0209876543.' })
  phone!: string

  @IsIn(['MTN', 'Telecel', 'AirtelTigo'], { message: 'Choose the Mobile Money network.' })
  network!: 'MTN' | 'Telecel' | 'AirtelTigo'
}

export class TreasuryDestinationActiveDto {
  @IsBoolean()
  active!: boolean
}

export class ClassifyTopupDto {
  @IsIn(['settlement_momo', 'own_money', 'not_topup'], { message: 'Say where this top-up came from.' })
  source!: 'settlement_momo' | 'own_money' | 'not_topup'
}

export class MarkNotSentDto {
  @IsString()
  @MinLength(5, { message: 'Say what you checked on Paystack.' })
  @MaxLength(500)
  note!: string
}

export class BalanceBooksDto {
  /** Pesewas: what Paystack and the settlement MoMo really hold together right now. */
  @IsInt({ message: 'Enter the Paystack and MoMo total like 802.00.' })
  @Min(0)
  paystackAndMomo!: number

  @IsInt({ message: 'Enter the DataHub float like 220.00.' })
  @Min(0)
  datahub!: number

  @IsInt({ message: 'Enter the GMPL float like 398.00.' })
  @Min(0)
  gmpl!: number

  /** Treat the owner's own capital spent on bundles as already repaid to him. */
  @IsBoolean()
  capitalRepaid!: boolean

  @IsString()
  @MaxLength(500)
  note!: string

  /** Work out the adjustments without saving anything. */
  @IsBoolean()
  preview!: boolean

  /** Required to save: the balances were read at this moment, not earlier. */
  @IsOptional()
  @IsBoolean()
  readJustNow?: boolean
}

/**
 * The Paystack balance as a treasury, see `TreasuryService`. Admins move money
 * and classify top-ups; only a superadmin decides where money may be sent.
 */
@ApiTags('treasury')
@ApiBearerAuth()
@Controller('admin/treasury')
@Roles('admin')
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  @Get()
  overview() {
    return this.treasury.overview()
  }

  @Post('withdrawals')
  @RequireActive()
  withdraw(@Body() dto: TreasuryWithdrawDto, @CurrentUser() user: AuthUser) {
    return this.treasury.withdraw(dto, user)
  }

  @Post('withdrawals/:id/mark-not-sent')
  @Roles('superadmin')
  markNotSent(@Param('id') id: string, @Body() dto: MarkNotSentDto, @CurrentUser() user: AuthUser) {
    return this.treasury.markNotSent(id, user, dto.note)
  }

  /** Ask Paystack what became of a transfer, see `TreasuryService.check`. */
  @Post('withdrawals/:id/check')
  check(@Param('id') id: string) {
    return this.treasury.check(id)
  }

  @Post('topups/sync')
  syncTopups() {
    return this.treasury.syncTopups()
  }

  @Post('topups/:id/classify')
  classifyTopup(@Param('id') id: string, @Body() dto: ClassifyTopupDto, @CurrentUser() user: AuthUser) {
    return this.treasury.classifyTopup(id, dto.source, user)
  }

  /** Superadmin only: set the records to the real balances, see `TreasuryService.balanceBooks`. */
  @Post('balance-books')
  @Roles('superadmin')
  balanceBooks(@Body() dto: BalanceBooksDto, @CurrentUser() user: AuthUser) {
    return this.treasury.balanceBooks(dto, user)
  }

  @Post('destinations')
  @Roles('superadmin')
  addDestination(@Body() dto: TreasuryDestinationDto, @CurrentUser() user: AuthUser) {
    return this.treasury.addDestination(dto, user)
  }

  @Patch('destinations/:id')
  @Roles('superadmin')
  setDestinationActive(
    @Param('id') id: string,
    @Body() dto: TreasuryDestinationActiveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.treasury.setDestinationActive(id, dto.active, user)
  }
}
