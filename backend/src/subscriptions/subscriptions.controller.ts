import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { SubscriptionsService } from './subscriptions.service'

export class CreateSubscriptionDto {
  @IsString()
  @MinLength(2, { message: 'Name it, two characters minimum.' })
  @MaxLength(200)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  provider?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  renewalUrl?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string

  @IsDateString()
  expiresAt!: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  alertDaysBefore?: number
}

export class UpdateSubscriptionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  provider?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  renewalUrl?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string

  @IsOptional()
  @IsDateString()
  expiresAt?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  alertDaysBefore?: number
}

/**
 * Third-party services this platform depends on, watched for an approaching
 * expiry. Viewing is shared: admin runs the business and needs to see what
 * could take it down. Changing anything is superadmin-only, the same
 * "platform belongs to the operator" split as `/admin/domains` and
 * `/admin/team`. These are accounts and billing relationships superadmin
 * actually holds, not something admin has the access to renew even if they
 * wanted to.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/subscriptions')
@Roles('admin', 'superadmin')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  list() {
    return this.subscriptions.list()
  }

  @Post()
  @Roles('superadmin')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptions.create(user.id, {
      name: dto.name,
      provider: dto.provider,
      renewalUrl: dto.renewalUrl,
      notes: dto.notes,
      expiresAt: new Date(dto.expiresAt),
      alertDaysBefore: dto.alertDaysBefore,
    })
  }

  @Patch(':id')
  @Roles('superadmin')
  update(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.subscriptions.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.provider !== undefined ? { provider: dto.provider } : {}),
      ...(dto.renewalUrl !== undefined ? { renewalUrl: dto.renewalUrl } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...(dto.expiresAt !== undefined ? { expiresAt: new Date(dto.expiresAt) } : {}),
      ...(dto.alertDaysBefore !== undefined ? { alertDaysBefore: dto.alertDaysBefore } : {}),
    })
  }

  @Delete(':id')
  @Roles('superadmin')
  remove(@Param('id') id: string) {
    return this.subscriptions.remove(id)
  }
}
