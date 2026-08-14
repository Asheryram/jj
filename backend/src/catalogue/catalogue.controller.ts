import { Controller, Get, Param } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { CurrentUser, type AuthUser } from '../common/auth'
import { CatalogueService } from './catalogue.service'

@ApiTags('catalogue')
@Controller()
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  /** Public — the shop is open to everyone (FR-4.8). */
  @Get('catalogue')
  snapshot(@CurrentUser() user: AuthUser | undefined) {
    return this.catalogue.snapshot(user?.role)
  }

  @Get('sellers/:code')
  async seller(@Param('code') code: string) {
    // Null rather than 404: an expired or mistyped sell link should drop the
    // visitor into the standard-price shop, not onto an error page.
    return { seller: await this.catalogue.seller(code) }
  }
}
