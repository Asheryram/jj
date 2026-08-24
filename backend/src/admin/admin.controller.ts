import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { AdminService, type Tier } from './admin.service'
import { ApprovalsService } from '../orders/approvals.service'
import { LedgerService } from '../finance/ledger.service'
import { RefundsService } from '../orders/refunds.service'
import { ApplicationsService } from './applications.service'
import { FloatMonitorService } from '../supplier/float-monitor.service'
import { SettingsService } from '../settings/settings.service'
import { SolvencyService } from '../finance/solvency.service'

const TIERS = ['supplierCost', 'adminPrice', 'standardPrice'] as const

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

export class ApplyMarkupDto {
  /**
   * Percentage over supplier cost. Fractional is allowed — a price of GHS 6.40
   * against a cost of GHS 4.70 is a markup of 36.17%, and forcing that to a
   * whole number would move the price every time the cost is refreshed.
   *
   * Two of them, because they answer different questions: what an agent buys at,
   * and what a stranger pays at the counter. The walk-up one is allowed to sit
   * below the agent one — James chooses whether he would rather earn from his
   * own counter or from agent volume.
   */
  @IsNumber({}, { message: 'Enter a percentage, like 15 or 12.5.' })
  @Min(0)
  @Max(500)
  agentPercent!: number

  @IsNumber({}, { message: 'Enter a percentage, like 25 or 22.5.' })
  @Min(0)
  @Max(500)
  walkupPercent!: number

  /**
   * `unpriced` touches only products that arrived from a supplier and have never
   * been on sale. `all` re-prices everything in scope.
   */
  @IsIn(['unpriced', 'all'])
  scope!: 'unpriced' | 'all'

  /** Restrict to one category. Omitted means every category. */
  @IsOptional()
  @IsIn(['data', 'airtime', 'voice', 'sms', 'afa', 'checker'])
  category?: 'data' | 'airtime' | 'voice' | 'sms' | 'afa' | 'checker'
}

export class ApproveRefundDto {
  /**
   * Which Mobile Money network to send it back on.
   *
   * Required for a Mobile Money refund and asked for rather than derived: number
   * portability means a prefix cannot tell you which network carries a line.
   */
  @IsOptional()
  @IsIn(['MTN', 'Telecel', 'AirtelTigo'])
  momoNetwork?: 'MTN' | 'Telecel' | 'AirtelTigo'
}

export class RejectRefundDto {
  /**
   * Why the refund is being refused. Required, and kept: this is a decision not
   * to return money somebody paid, and it has to survive being questioned later.
   */
  @IsString()
  @MinLength(5, { message: 'Give a reason for refusing this refund.' })
  @MaxLength(500)
  note!: string
}

/** Keys whose value is a number rather than a switch. */
const NUMERIC_SETTING_KEYS = ['floatWatchAt', 'floatRiskAt'] as const

export class SetSettingDto {
  @IsIn([
    'simulateFailure',
    'registrationOpen',
    'agentsAutoApprove',
    'floatWatchAt',
    'floatRiskAt',
  ])
  key!:
    | 'simulateFailure'
    | 'registrationOpen'
    | 'agentsAutoApprove'
    | 'floatWatchAt'
    | 'floatRiskAt'

  /**
   * A whole number for the numeric keys, a boolean for the switches.
   *
   * Only the shape is checked here. The ranges belong to SettingsService, which
   * knows that a referral rate caps at 100 while a float threshold is pesewas
   * with no ceiling, and that at-risk has to sit below watch — a rule that needs
   * the other value and so cannot live on a DTO at all.
   */
  @ValidateIf((dto: SetSettingDto) =>
    (NUMERIC_SETTING_KEYS as readonly string[]).includes(dto.key),
  )
  @IsInt({ message: 'That setting takes a whole number.' })
  @Min(0)
  @ValidateIf(
    (dto: SetSettingDto) => !(NUMERIC_SETTING_KEYS as readonly string[]).includes(dto.key),
  )
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
  constructor(
    private readonly admin: AdminService,
    private readonly approvals: ApprovalsService,
    private readonly ledger: LedgerService,
    private readonly solvency: SolvencyService,
    private readonly refunds: RefundsService,
    private readonly applications: ApplicationsService,
    private readonly float: FloatMonitorService,
    private readonly platformSettings: SettingsService,
  ) {}

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

  /**
   * What our suppliers sell, as they report it.
   *
   * Read-only, and there are deliberately no writes beside it. Cost and stock
   * used to be editable here — a hand-typed cost meant our idea of what we pay
   * could drift from the invoice, and a hand-set stock flag meant the shop could
   * claim a SKU was available when the supplier had withdrawn it. Both are the
   * supplier's to state; `sync` below is how they change.
   */
  @Get('supplier')
  supplier() {
    return this.admin.supplierCatalogue()
  }

  /**
   * What is left in the provider float, and the thresholds that watch it.
   *
   * Null until the first purchase: the provider has no balance endpoint, so the
   * figure only exists in the reply to an order. The screen has to say when it
   * was read, or it implies a live number it cannot have.
   */
  @Get('supplier/float')
  async float_() {
    const [observation, settings] = await Promise.all([
      this.float.latest(),
      this.platformSettings.all(),
    ])
    return {
      observation,
      watchAt: settings.floatWatchAt,
      riskAt: settings.floatRiskAt,
    }
  }

  /** Re-read every configured supplier's catalogue. */
  @Post('supplier/sync')
  sync() {
    return this.admin.syncFromProvider()
  }

  /**
   * Put products on sale at a markup over supplier cost.
   *
   * The markup is stored, not just the price it produces, so the next time a
   * supplier's cost moves the price moves with it and the margin holds.
   */
  @Post('products/markup')
  markup(@Body() dto: ApplyMarkupDto) {
    return this.admin.applyMarkup({
      agentPercent: dto.agentPercent,
      walkupPercent: dto.walkupPercent,
      scope: dto.scope,
      category: dto.category,
    })
  }

  /**
   * Numbers a customer tried to buy for that DataHub has not approved.
   *
   * Their submission endpoint is down, so this is the list James works through
   * by hand in their dashboard.
   */
  @Get('beneficiaries')
  beneficiaries() {
    return this.approvals.pending()
  }

  /** Ask DataHub which of them have been approved since we last looked. */
  @Post('beneficiaries/recheck')
  recheckBeneficiaries() {
    return this.approvals.recheck()
  }

  /** Try their submission API. Reports the failure rather than hiding it. */
  @Post('beneficiaries/submit')
  submitBeneficiaries() {
    return this.approvals.submit()
  }

  /**
   * Profit and loss, and the cash that moved alongside it.
   *
   * Read from the ledger rather than recomputed from orders: the ledger is the
   * only place that knows what the supplier actually charged and what the payment
   * processor kept, and it is idempotent, so this figure cannot be inflated by a
   * retried webhook.
   */
  @Get('finance/statement')
  statement(@Query('days') days?: string) {
    const window = Math.min(365, Math.max(1, Number(days) || 30))
    const since = new Date(Date.now() - window * 86_400_000)
    return this.ledger.statement(since)
  }

  /** The individual lines, newest first. */
  /**
   * What is owed against what Paystack is holding.
   *
   * The figure that decides whether the float can be topped up or profit drawn
   * without spending an agent's earnings.
   */
  /**
   * Money owed back to customers, waiting on a decision.
   *
   * Refunds are not automatic — a failed delivery records the debt and stops, so
   * this queue is the only way the money moves.
   */
  /**
   * Agents waiting to be let in.
   *
   * Registration creates the account and stops. An agent sells under your name
   * and sets the prices customers pay, so somebody agrees to that before it
   * starts.
   */
  @Get('applications')
  applicationQueue() {
    return this.applications.pending()
  }

  @Post('applications/:id/approve')
  approveApplication(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.applications.approve(id, user.id)
  }

  @Post('applications/:id/reject')
  rejectApplication(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RejectRefundDto,
  ) {
    return this.applications.reject(id, user.id, dto.note)
  }

  @Get('refunds')
  refundQueue(@Query('status') status?: 'pending' | 'approved' | 'rejected') {
    return this.refunds.list(status)
  }

  @Post('refunds/:id/approve')
  approveRefund(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ApproveRefundDto,
  ) {
    return this.refunds.approve(id, user.id, dto.momoNetwork)
  }

  @Post('refunds/:id/reject')
  rejectRefund(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RejectRefundDto,
  ) {
    return this.refunds.reject(id, user.id, dto.note)
  }

  @Get('finance/position')
  position() {
    return this.solvency.position()
  }

  @Get('finance/entries')
  ledgerEntries(@Query('limit') limit?: string) {
    return this.ledger.entries(Math.min(500, Math.max(1, Number(limit) || 200)))
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
