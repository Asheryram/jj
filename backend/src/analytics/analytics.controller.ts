import { BadRequestException, Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Roles } from '../common/auth'
import { AnalyticsAvailableGuard } from './analytics-available.guard'
import { EtlService } from './etl.service'
import { InsightsService } from './insights.service'
import { addDays, toDateInt } from './date'

function isDateInt(value: number): boolean {
  if (!Number.isInteger(value) || String(value).length !== 8) return false
  const month = Math.floor((value % 10_000) / 100)
  const day = value % 100
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

/**
 * The /analytics page, admin only.
 *
 * `AnalyticsAvailableGuard` turns "the warehouse isn't configured or isn't
 * reachable" into one clean 503 rather than a raw database error.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@Roles('admin')
@UseGuards(AnalyticsAvailableGuard)
export class AnalyticsController {
  constructor(
    private readonly etl: EtlService,
    private readonly insights: InsightsService,
  ) {}

  /**
   * Everything the page shows for `from`..`to` (YYYYMMDD, inclusive), with
   * the same figures for the equally long period just before. Defaults to
   * the 30 days ending today.
   */
  @Get('insights')
  getInsights(@Query('from') from?: string, @Query('to') to?: string) {
    const today = toDateInt(new Date())
    const toInt = to ? Number(to) : today
    const fromInt = from ? Number(from) : addDays(toInt, -29)
    if (!isDateInt(fromInt) || !isDateInt(toInt) || fromInt > toInt) {
      throw new BadRequestException('"from" and "to" must be YYYYMMDD dates, with "from" on or before "to".')
    }
    if (toInt > today) throw new BadRequestException(`"to" cannot be after today (${today}).`)
    return this.insights.insights(fromInt, toInt)
  }

  /** "Refresh now": pull the latest from production without waiting for the hourly run. */
  @Post('refresh')
  refresh() {
    return this.etl.runNow()
  }

  /** Superadmin only: rebuilds every order fact and the reserve history from `date` onward. */
  @Post('recompute-from')
  @Roles('superadmin')
  recomputeFrom(@Query('date') date?: string) {
    const dateInt = Number(date)
    const today = toDateInt(new Date())
    if (!date || !isDateInt(dateInt) || dateInt > today) {
      throw new BadRequestException(`"date" must be a YYYYMMDD date on or before today (${today}).`)
    }
    return this.etl.recomputeFrom(dateInt)
  }
}
