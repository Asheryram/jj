import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator'
import type { BillingInterval, DomainMode, DomainRenewalMethod } from '@prisma/client'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { DomainsService } from './domains.service'
import { DomainRenewalsService } from './domain-renewals.service'

/**
 * A reasonable domain shape, labels of letters/digits/hyphens (never
 * starting or ending with one), at least one dot, a letters-only TLD of 2+
 * characters. Not a full RFC 1035 validator; just enough to reject "not a
 * domain" before it reaches the database.
 */
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,}$/i

export class RequestDomainDto {
  @IsIn(['subdomain', 'custom'])
  mode!: DomainMode

  /** Only read when `mode` is `subdomain`. */
  @ValidateIf((dto: RequestDomainDto) => dto.mode === 'subdomain')
  @IsString()
  @MaxLength(63)
  label?: string

  /** Only read when `mode` is `custom`. */
  @ValidateIf((dto: RequestDomainDto) => dto.mode === 'custom')
  @IsString()
  @MaxLength(253)
  @Matches(DOMAIN_PATTERN, { message: 'Enter a valid domain, like blayshop.com.' })
  domain?: string

  @IsIn(['monthly', 'yearly'])
  billingInterval!: BillingInterval

  /** Taken from earnings automatically, or paid by the agent through Paystack. */
  @IsOptional()
  @IsIn(['balance', 'paystack'])
  paymentMethod?: DomainRenewalMethod
}

export class SetPaymentMethodDto {
  @IsIn(['balance', 'paystack'])
  paymentMethod!: DomainRenewalMethod
}

export class SetDomainPriceDto {
  @IsIn(['subdomain', 'custom'])
  mode!: DomainMode

  @IsIn(['monthly', 'yearly'])
  interval!: BillingInterval

  @IsInt()
  @Min(0)
  amount!: number
}

export class ReviewDomainDto {
  @IsOptional()
  @IsBoolean()
  allowed?: boolean

  @IsOptional()
  @IsBoolean()
  active?: boolean

  /** Shown to the agent on a refusal. Ignored when approving. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}

/** An agent's own domain, pointed at their shop. */
@ApiTags('domains')
@Controller('domains')
export class DomainsController {
  constructor(
    private readonly domains: DomainsService,
    private readonly renewals: DomainRenewalsService,
  ) {}

  /** What a subdomain or a domain of their own would cost, agent-facing, never `costAmount`. */
  @Roles('agent')
  @Get('pricing')
  pricing() {
    return this.domains.pricingList(false)
  }

  @Roles('agent')
  @Post('request')
  request(@CurrentUser() user: AuthUser, @Body() dto: RequestDomainDto) {
    return this.domains.request(user.id, {
      mode: dto.mode,
      label: dto.label,
      domain: dto.domain,
      billingInterval: dto.billingInterval,
      paymentMethod: dto.paymentMethod,
    })
  }

  @Roles('agent')
  @Patch('mine/payment-method')
  setPaymentMethod(@CurrentUser() user: AuthUser, @Body() dto: SetPaymentMethodDto) {
    return this.domains.setPaymentMethod(user.id, dto.paymentMethod)
  }

  @Roles('agent')
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.domains.mine(user.id)
  }

  /** Drop the agent's own domain and go back to the plain /s/&lt;code&gt; link. */
  @Roles('agent')
  @Delete('mine')
  remove(@CurrentUser() user: AuthUser) {
    return this.domains.remove(user.id)
  }

  /** Retry this cycle's charge from balance, usable in grace or once already deactivated. */
  @Roles('agent')
  @Post('mine/renew/pay-balance')
  payByBalance(@CurrentUser() user: AuthUser) {
    return this.renewals.payByBalance(user.id)
  }

  /** Start a live Paystack charge for the same, when balance alone can't cover it. */
  @Roles('agent')
  @Post('mine/renew/pay-paystack')
  startPaystack(@CurrentUser() user: AuthUser, @Headers('origin') origin?: string) {
    return this.renewals.startPaystackPayment(user.id, origin)
  }

  /** The return-page verify, the same "never trust the redirect" pattern `PaymentsController.confirm` uses. */
  @Roles('agent')
  @Get('mine/renew/pay-paystack/confirm')
  confirmPaystack(@Query('reference') reference: string) {
    return this.renewals.confirmPaystackPayment(reference)
  }

  /**
   * What a visitor's browser actually calls, on every page load of a custom
   * domain, before the app knows which shop it is rendering. Public, a
   * guest arriving at an agent's domain has no account yet.
   */
  @Get('resolve')
  @ApiExcludeEndpoint()
  async resolve(@Query('host') host?: string) {
    if (!host) return { code: null }
    return { code: await this.domains.resolve(host) }
  }
}

/**
 * The superadmin's review queue.
 *
 * `@Roles('superadmin')`, not `admin`, approving a domain is vouching that
 * whoever asked for it actually controls it, the same trust decision as
 * creating an admin account in the first place. James runs the business on
 * this platform; Asher runs the platform itself, and this is platform-level.
 */
@ApiTags('admin')
@Controller('admin/domains')
@Roles('superadmin')
export class AdminDomainsController {
  constructor(
    private readonly domains: DomainsService,
    private readonly renewals: DomainRenewalsService,
  ) {}

  @Get()
  list(@Query('pending') pending?: string) {
    return this.domains.list(pending === 'true')
  }

  /**
   * Wrapped in an object rather than returned bare: Nest's Express adapter
   * sends a raw number via `response.send(String(body))`, which defaults
   * Content-Type to text/html and trips the client's JSON sniffing.
   */
  @Get('pending-count')
  async pendingCount(): Promise<{ count: number }> {
    return { count: await this.domains.pendingCount() }
  }

  @Patch(':id')
  async review(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: ReviewDomainDto) {
    const row = await this.domains.review(id, user.id, dto)
    // An approval goes live as soon as hosting serves it, not at the next round of checks.
    if (dto.allowed === true) this.renewals.soon()
    return row
  }
}

/**
 * What a domain costs, split by who is allowed to set which half, see
 * `CustomDomain.mode`/`DomainPricing`'s own doc comment. No class-level
 * `@Roles` here, unlike the two controllers above, exactly because the two
 * writes below need different ones.
 */
@ApiTags('admin')
@Controller('admin/domain-pricing')
export class DomainPricingController {
  constructor(private readonly domains: DomainsService) {}

  /** Admin sees this to know what floor `price` has to clear; superadmin sees it because it's theirs. */
  @Get()
  @Roles('admin', 'superadmin')
  list() {
    return this.domains.pricingList(true)
  }

  /** Asher's own wholesale cost. */
  @Patch('cost')
  @Roles('superadmin')
  setCost(@Body() dto: SetDomainPriceDto) {
    return this.domains.setCost(dto.mode, dto.interval, dto.amount)
  }

  /** James's own retail price, must clear `costAmount`. */
  @Patch('price')
  @Roles('admin')
  setPrice(@Body() dto: SetDomainPriceDto) {
    return this.domains.setPrice(dto.mode, dto.interval, dto.amount)
  }
}

/**
 * The superadmin's own wallet: their share of agents' shop-address payments,
 * and the payouts they have taken from it (requested like an agent's, at
 * POST /withdrawals, and approved by another admin).
 */
@ApiTags('admin')
@Controller('admin/superadmin-wallet')
@Roles('superadmin')
export class SuperadminWalletController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  wallet(@CurrentUser() user: AuthUser) {
    return this.domains.superadminWallet(user.id)
  }
}
