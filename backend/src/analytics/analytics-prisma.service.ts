import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma-analytics/client'

/**
 * The warehouse's own Prisma client, a completely separate connection and
 * database from `PrismaService`. Never import `@prisma/client` (the main
 * app's generated client) and this one interchangeably, their models do not
 * overlap at all, see `prisma-analytics/schema.prisma`'s own comment for why
 * this is a second database rather than a second schema in the same one.
 *
 * Deliberately never throws out of `onModuleInit`, unlike `PrismaService`
 * for the main database. That database is required for the app to mean
 * anything at all; this one is documented everywhere as disposable and
 * never a source of truth. A platform that hasn't provisioned the second
 * database yet, or whose warehouse is briefly unreachable, must still take
 * real orders. `isAvailable` is what `EtlService` and `AnalyticsController`
 * check before touching this client, so a missing or unreachable warehouse
 * shows up as "analytics isn't ready yet", not a crashed API.
 */
@Injectable()
export class AnalyticsPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AnalyticsPrismaService.name)
  private available = false

  get isAvailable(): boolean {
    return this.available
  }

  async onModuleInit(): Promise<void> {
    if (!process.env.ANALYTICS_DATABASE_URL) {
      this.log.warn('ANALYTICS_DATABASE_URL is not set, /analytics will be unavailable until it is configured.')
      return
    }
    try {
      await this.$connect()
      this.available = true
      this.log.log('connected to the analytics warehouse')
    } catch (error) {
      this.log.error(
        `could not reach the analytics warehouse, /analytics will be unavailable: ${String(error)}. Locally: cd backend && npm run analytics:db:create && npm run analytics:migrate`,
      )
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.available) await this.$disconnect()
  }
}
