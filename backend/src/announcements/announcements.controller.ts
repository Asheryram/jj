import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { AnnouncementsService } from './announcements.service'

export class SendAnnouncementDto {
  @IsString()
  @MinLength(3, { message: 'Give it a title, three characters minimum.' })
  @MaxLength(200)
  title!: string

  @IsString()
  @MinLength(5, { message: 'Say a little more, five characters minimum.' })
  @MaxLength(5000)
  message!: string

  /** Omitted, or empty, means every active agent. Otherwise the exact ids chosen. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  agentIds?: string[]
}

/** Sending to and reading announcements. Split by role below, same shape as `FeedbackController`. */
@ApiTags('announcements')
@ApiBearerAuth()
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  /** The agent picker for admin/superadmin composing a targeted announcement. */
  @Get('agents')
  @Roles('admin', 'superadmin')
  agents() {
    return this.announcements.activeAgents()
  }

  @Post()
  @Roles('admin', 'superadmin')
  send(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendAnnouncementDto,
    // Where the email's "Open in app" link should point, the sender's own
    // panel. Never trusted blindly, see `appUrl`.
    @Headers('origin') origin?: string,
  ) {
    const audience = dto.agentIds && dto.agentIds.length > 0 ? dto.agentIds : 'all'
    return this.announcements.send(user, dto.title, dto.message, audience, origin)
  }

  @Get('history')
  @Roles('admin', 'superadmin')
  history() {
    return this.announcements.history()
  }

  @Get('mine')
  @Roles('agent')
  mine(@CurrentUser() user: AuthUser) {
    return this.announcements.mine(user.id)
  }

  /**
   * Wrapped in an object rather than returned bare: Nest's Express adapter
   * sends a raw number via `response.send(String(body))`, which defaults
   * Content-Type to text/html and trips the client's JSON sniffing.
   */
  @Get('unread-count')
  @Roles('agent')
  async unreadCount(@CurrentUser() user: AuthUser): Promise<{ count: number }> {
    return { count: await this.announcements.unreadCount(user.id) }
  }

  @Post(':id/read')
  @Roles('agent')
  markRead(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.announcements.markRead(id, user.id)
  }
}
