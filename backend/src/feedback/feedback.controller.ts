import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { FeedbackService } from './feedback.service'

export class SubmitFeedbackDto {
  @IsIn(['suggestion', 'issue'])
  category!: 'suggestion' | 'issue'

  @IsString()
  @MinLength(5, { message: 'Say a little more, five characters minimum.' })
  @MaxLength(2000, { message: 'Keep it under 2000 characters.' })
  message!: string
}

export class DecideFeedbackDto {
  @IsIn(['open', 'reviewed', 'resolved'])
  status!: 'open' | 'reviewed' | 'resolved'

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string
}

/** An agent's own suggestions and issue reports. */
@ApiTags('feedback')
@ApiBearerAuth()
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @Roles('agent')
  submit(@CurrentUser() user: AuthUser, @Body() dto: SubmitFeedbackDto) {
    return this.feedback.submit(user, dto.category, dto.message)
  }

  @Get('mine')
  @Roles('agent')
  mine(@CurrentUser() user: AuthUser) {
    return this.feedback.mine(user.id)
  }
}

/** Admin and superadmin's shared view of what agents have sent in. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/feedback')
@Roles('admin', 'superadmin')
export class AdminFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: 'open' | 'reviewed' | 'resolved',
    @Query('category') category?: 'suggestion' | 'issue',
    @Query('escalated') escalated?: string,
  ) {
    return this.feedback.list(user.role, status, category, escalated === 'true')
  }

  @Get('open-count')
  openCount(@CurrentUser() user: AuthUser) {
    return this.feedback.openCount(user.role)
  }

  /** One item by id, what an escalation email's "Open this ticket" link resolves. */
  @Get(':id')
  byId(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.feedback.byId(id, user.role)
  }

  @Patch(':id')
  decide(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: DecideFeedbackDto) {
    return this.feedback.decide(id, user.role, user.id, dto.status, dto.note)
  }

  /**
   * Admin-only, not superadmin. See `FeedbackService.escalate`'s own doc
   * comment. Escalating to yourself has no meaning when you already see this
   * whole queue.
   */
  @Post(':id/escalate')
  @Roles('admin')
  escalate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    // Where the email's "Open this ticket" link should point, the admin
    // panel this request actually came from, not a hardcoded config value.
    // Never trusted blindly; see `FeedbackService.feedbackItemUrl`.
    @Headers('origin') origin?: string,
  ) {
    return this.feedback.escalate(id, user.id, user.name, origin)
  }
}
