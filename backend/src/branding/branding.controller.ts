import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags } from '@nestjs/swagger'
import { IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import type { Response } from 'express'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { NotFoundError } from '../common/domain-errors'
import { BrandingService } from './branding.service'

export class SubmitBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  shopName?: string

  /** #rrggbb. Validated again in the service, which also derives the ramp. */
  @IsOptional()
  @IsHexColor({ message: 'Use a hex colour like #0B3B8F.' })
  brandColor?: string
}

export class RejectBrandingDto {
  @IsString()
  @MinLength(5, { message: 'Tell the agent why, so they can fix it.' })
  @MaxLength(500)
  note!: string
}

/**
 * How a shop identifies itself: name, logo and colour.
 *
 * The read endpoint is unauthenticated on purpose — a guest shopping through an
 * agent's link has no account, and the shop has to render for them. Nothing here
 * exposes anything private: a shop's name, mark and colour are what every visitor
 * sees anyway.
 */
@ApiTags('branding')
@Controller('branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  /** What to render. `seller` is an agent's code, absent for the platform. */
  @Get()
  forShop(@Query('seller') seller?: string) {
    return this.branding.forShop(seller ?? null)
  }

  /**
   * A shop's logo.
   *
   * Cached for a day: a logo changes rarely, and this is fetched on every cold
   * page load. `must-revalidate` is deliberately absent — a stale mark for a few
   * hours is a far better trade than a database round trip per visitor.
   */
  @Get('logo/:key')
  @Header('Cache-Control', 'public, max-age=86400')
  async logo(@Param('key') key: string, @Res() res: Response) {
    const found = await this.branding.logo(key)
    if (!found) throw new NotFoundError('No logo has been set for that shop.')
    res.setHeader('Content-Type', found.mime)
    res.send(found.bytes)
  }

  // ── An agent's own branding ───────────────────────────────────────────────

  /** What the signed-in agent has live, and anything awaiting review. */
  @Roles('agent')
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.branding.mine(user.id)
  }

  /**
   * Propose branding. It is reviewed before it goes live.
   *
   * `multipart/form-data`, because a logo comes with it. The 200KB limit here is
   * twice the service's own cap so an oversized file is refused with a readable
   * message about logo size rather than by the upload layer.
   */
  @Roles('agent')
  @Post('mine')
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: 200 * 1024 } }))
  submit(
    @CurrentUser() user: AuthUser,
    @Body() dto: SubmitBrandingDto,
    @UploadedFile() logo?: { buffer: Buffer },
  ) {
    return this.branding.submit(
      { id: user.id, name: user.name, referralCode: user.referralCode },
      { shopName: dto.shopName, brandColor: dto.brandColor, logo },
    )
  }
}

/**
 * The platform owner's side: their own branding, and the agents' review queue.
 *
 * Separate controller so `@Roles('admin')` covers all of it — an agent must not
 * be able to approve their own submission.
 */
@ApiTags('admin')
@Controller('admin/branding')
@Roles('admin')
export class AdminBrandingController {
  constructor(private readonly branding: BrandingService) {}

  /** Set the platform's own name, colour or logo. Applies at once. */
  @Post()
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: 200 * 1024 } }))
  setPlatform(@Body() dto: SubmitBrandingDto, @UploadedFile() logo?: { buffer: Buffer }) {
    return this.branding.setPlatform({
      shopName: dto.shopName,
      brandColor: dto.brandColor,
      logo,
    })
  }

  @Get('requests')
  queue(@Query('status') status?: 'pending' | 'approved' | 'rejected') {
    return this.branding.queue(status ?? 'pending')
  }

  /** The submitted logo, so it can be seen before it is approved. */
  @Get('requests/:id/logo')
  @Header('Cache-Control', 'no-store')
  async requestLogo(@Param('id') id: string, @Res() res: Response) {
    const found = await this.branding.requestLogo(id)
    if (!found) throw new NotFoundError('That request has no logo.')
    res.setHeader('Content-Type', found.mime)
    res.send(found.bytes)
  }

  @Post('requests/:id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.branding.approve(id, user.id)
  }

  @Post('requests/:id/reject')
  reject(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RejectBrandingDto,
  ) {
    return this.branding.reject(id, user.id, dto.note)
  }
}
