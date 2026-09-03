import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger'
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { DomainsService } from './domains.service'

/**
 * A reasonable domain shape — labels of letters/digits/hyphens (never
 * starting or ending with one), at least one dot, a letters-only TLD of 2+
 * characters. Not a full RFC 1035 validator; just enough to reject "not a
 * domain" before it reaches the database.
 */
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,}$/i

export class RequestDomainDto {
  @IsString()
  @MaxLength(253)
  @Matches(DOMAIN_PATTERN, { message: 'Enter a valid domain, like blayshop.com.' })
  domain!: string
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
  constructor(private readonly domains: DomainsService) {}

  @Roles('agent')
  @Post('request')
  request(@CurrentUser() user: AuthUser, @Body() dto: RequestDomainDto) {
    return this.domains.request(user.id, dto.domain)
  }

  @Roles('agent')
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.domains.mine(user.id)
  }

  /**
   * What a visitor's browser actually calls, on every page load of a custom
   * domain, before the app knows which shop it is rendering. Public — a
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
 * `@Roles('superadmin')`, not `admin` — approving a domain is vouching that
 * whoever asked for it actually controls it, the same trust decision as
 * creating an admin account in the first place. James runs the business on
 * this platform; Asher runs the platform itself, and this is platform-level.
 */
@ApiTags('admin')
@Controller('admin/domains')
@Roles('superadmin')
export class AdminDomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  list(@Query('pending') pending?: string) {
    return this.domains.list(pending === 'true')
  }

  @Patch(':id')
  review(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: ReviewDomainDto) {
    return this.domains.review(id, user.id, dto)
  }
}
