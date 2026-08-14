import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { AdminService, type Tier } from './admin.service'

const TIERS = ['supplierCost', 'adminPrice', 'standardPrice', 'maxRetailPrice'] as const

export class SetTierDto {
  @IsIn(TIERS)
  tier!: Tier

  @IsInt({ message: 'Enter a price like 7.50.' })
  @Min(0)
  value!: number
}

export class SetActiveDto {
  @IsBoolean()
  active!: boolean
}

export class SetAvailabilityDto {
  @IsBoolean()
  available!: boolean
}

export class SetSupplierCostDto {
  /** Integer pesewas — what the provider charges us for this SKU. */
  @IsInt({ message: 'Enter what the provider charges you, like 5.50.' })
  @Min(1)
  costPrice!: number
}

export class SetSettingDto {
  @IsIn(['referralEnabled', 'referralRatePercent', 'simulateFailure', 'registrationOpen'])
  key!: 'referralEnabled' | 'referralRatePercent' | 'simulateFailure' | 'registrationOpen'

  /** Boolean for the switches, a whole percentage for `referralRatePercent`. */
  @ValidateIf((dto: SetSettingDto) => dto.key === 'referralRatePercent')
  @IsInt({ message: 'A referral rate is a whole number of percent.' })
  @Min(0)
  @Max(100)
  @ValidateIf((dto: SetSettingDto) => dto.key !== 'referralRatePercent')
  @IsBoolean()
  value!: boolean | number
}

export class ReportQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  days?: number
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.overview()
  }

  @Get('users')
  users() {
    return this.admin.users()
  }

  @Patch('users/:id/status')
  toggleStatus(@Param('id') id: string) {
    return this.admin.toggleUserStatus(id)
  }

  @Patch('products/:id/tier')
  setTier(@Param('id') id: string, @Body() dto: SetTierDto) {
    return this.admin.setTier(id, dto.tier, dto.value)
  }

  @Patch('products/:id/active')
  setActive(@Param('id') id: string, @Body() dto: SetActiveDto) {
    return this.admin.setProductActive(id, dto.active)
  }

  /** The DataHub GH stand-in catalogue. */
  @Get('supplier')
  supplier() {
    return this.admin.supplierCatalogue()
  }

  /** Switch a provider SKU out of stock to exercise the refund path. */
  @Patch('supplier/:code/availability')
  setAvailability(@Param('code') code: string, @Body() dto: SetAvailabilityDto) {
    return this.admin.setSupplierAvailability(code, dto.available)
  }

  /**
   * The one place `supplier_cost` can change. Stands in for the DataHub GH
   * price-list call; `PATCH /products/:id/tier` refuses that tier on purpose.
   */
  @Patch('supplier/:code/cost')
  setSupplierCost(@Param('code') code: string, @Body() dto: SetSupplierCostDto) {
    return this.admin.setSupplierCost(code, dto.costPrice)
  }

  @Post('supplier/sync')
  sync() {
    return this.admin.syncSupplierCosts()
  }

  @Get('settings')
  settings() {
    return this.admin.settingsAll()
  }

  @Patch('settings')
  setSetting(@Body() dto: SetSettingDto) {
    return this.admin.setSetting(dto.key, dto.value)
  }

  @Get('reports/revenue')
  revenue(@Query('days') days?: string) {
    return this.admin.revenueByDay(days ? Number(days) : 7)
  }
}

/** Agent-facing reporting. Same service, own route, own role. */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly admin: AdminService) {}

  @Get('my-earnings')
  @Roles('agent')
  myEarnings(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.admin.agentEarningsByDay(user.id, days ? Number(days) : 7)
  }

  /** Dashboard headline numbers for whoever is signed in. */
  @Get('my-summary')
  @Roles('agent', 'customer')
  mySummary(@CurrentUser() user: AuthUser) {
    return this.admin.mySummary(user)
  }
}
