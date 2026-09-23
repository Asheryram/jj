import { BadRequestException, Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Roles } from '../common/auth'
import { AnalyticsAvailableGuard } from './analytics-available.guard'
import { AnalyticsPrismaService } from './analytics-prisma.service'
import { EtlService } from './etl.service'
import { addDays, toDateInt } from './date'

/**
 * Every rollup, read-only, admin only.
 *
 * `from`/`to` (YYYYMMDD integers, inclusive) name an exact window: a single
 * day (`from=to`), a calendar month, a calendar year, or any custom range,
 * built by the frontend's date-range picker. Default, when neither is given,
 * is the 30 days ending today, a rolling window rather than a fixed one, so
 * it keeps meaning "recent" as today moves forward.
 *
 * `AnalyticsAvailableGuard` turns "the warehouse isn't configured or isn't
 * reachable" into one clean 503 across every route here, rather than each
 * handler surfacing a raw Prisma connection error.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@Roles('admin')
@UseGuards(AnalyticsAvailableGuard)
export class AnalyticsController {
  constructor(
    private readonly warehouse: AnalyticsPrismaService,
    private readonly etl: EtlService,
  ) {}

  private range(from?: string, to?: string): { gte: number; lte: number } {
    const today = toDateInt(new Date())
    return { gte: from ? Number(from) : addDays(today, -30), lte: to ? Number(to) : today }
  }

  /** For a "Refresh now" button, does not wait on the daily 2am clock. */
  @Post('refresh')
  refresh() {
    return this.etl.runNow()
  }

  /**
   * The manual checkpoint-rewind escape hatch: recompute every day from
   * `date` through today, overwriting whatever was there before, without
   * wiping the whole warehouse for a full cold-start backfill. Meant for
   * "I fixed a bug in the ETL logic, recompute the affected days," not for
   * routine use, so this validates just enough to reject an obvious mistake
   * (garbage input, a future date) and otherwise trusts the caller.
   */
  @Post('recompute-from')
  recomputeFrom(@Query('date') date?: string) {
    const dateInt = Number(date)
    const today = toDateInt(new Date())
    if (!date || !Number.isInteger(dateInt) || String(dateInt).length !== 8 || dateInt > today) {
      throw new BadRequestException(`"date" must be a YYYYMMDD date on or before today (${today}).`)
    }
    return this.etl.recomputeFrom(dateInt)
  }

  /**
   * One-time cleanup for Bronze/Silver rows that finalized before automatic
   * pruning existed, see `EtlService.pruneRawHistory`'s own comment for what
   * is and is not safe to remove. Safe to call more than once, an already-
   * pruned range simply deletes nothing further.
   */
  @Post('prune-history')
  pruneHistory() {
    return this.etl.pruneHistory()
  }

  @Get('daily-summary')
  dailySummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailySummary.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('network-summary')
  networkSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyNetworkSummary.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('category-summary')
  categorySummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyCategorySummary.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  /** `network`/`category` are plain fields here, not part of the key, filtering to one network's products is a client-side job. */
  @Get('product-summary')
  productSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyProductSummary.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('dispatch-reliability')
  dispatchReliability(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyDispatchReliability.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  /** A leaderboard sums this over whatever range the caller asked for, entirely client-side. */
  @Get('agent-summary')
  agentSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyAgentSummary.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('agent-health')
  agentHealth(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyAgentHealth.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  /** Structure, not a trend: the latest snapshot at or before `to` (default today) is what's meaningful. */
  @Get('downline-depth')
  downlineDepth(@Query('to') to?: string) {
    const asOf = to ? Number(to) : toDateInt(new Date())
    return this.warehouse.dailyDownlineDepth.findMany({
      where: { date: { lte: asOf } },
      orderBy: [{ date: 'desc' }, { depth: 'asc' }],
    })
  }

  /**
   * Aggregated over the same `from`/`to` window as everything else, not a
   * separate fixed lookback: more days of history makes "which hour is
   * genuinely busiest" a steadier signal, not a noisier one, so there was
   * never a good reason to clamp this to a short window on its own.
   */
  @Get('hourly-volume')
  hourlyVolume(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.hourlyOrderVolume.findMany({
      where: { date: this.range(from, to) },
      orderBy: [{ date: 'asc' }, { hour: 'asc' }],
    })
  }

  @Get('checkout-funnel')
  checkoutFunnel(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyCheckoutFunnel.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('customer-behavior')
  customerBehavior(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyCustomerBehavior.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('margin-accuracy')
  marginAccuracy(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyMarginAccuracy.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('refund-summary')
  refundSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyRefundSummary.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('refund-network-summary')
  refundNetworkSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyRefundNetworkSummary.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('refund-reason-summary')
  refundReasonSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyRefundReasonSummary.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('payout-summary')
  payoutSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyPayoutSummary.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('feedback-summary')
  feedbackSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyFeedbackSummary.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('application-funnel')
  applicationFunnel(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyApplicationFunnel.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  /** A daily snapshot, not backfillable, see `EtlService`'s own doc comment. A past day with no row genuinely has none. */
  @Get('solvency-snapshot')
  solvencySnapshot(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailySolvencySnapshot.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('float-snapshot')
  floatSnapshot(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyFloatSnapshot.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }

  @Get('lost-revenue')
  lostRevenue(@Query('from') from?: string, @Query('to') to?: string) {
    return this.warehouse.dailyLostRevenueSummary.findMany({
      where: { date: this.range(from, to) },
      orderBy: { date: 'asc' },
    })
  }
}
