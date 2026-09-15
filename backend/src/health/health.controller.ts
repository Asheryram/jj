import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { PrismaService } from '../prisma/prisma.service'
import { SupplierService } from '../supplier/supplier.service'

/**
 * How long a real database check stays good enough to reuse.
 *
 * Has to clear Neon's own 5-minute autosuspend window, not just be "less
 * than every ping": a minute-old cache still forces a real query once a
 * minute, which is still far more often than every 5 minutes and would keep
 * blocking autosuspend on its own, just as badly as never caching at all.
 * Ten minutes gives a real, comfortable idle gap on the far side of that
 * threshold.
 */
const DATABASE_CHECK_CACHE_MS = 10 * 60_000

@ApiTags('health')
@Controller('health')
export class HealthController {
  private lastDatabaseCheck: { database: string; databaseLatencyMs: number; checkedAt: number } | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly supplier: SupplierService,
  ) {}

  /**
   * NFR-3.1, includes a real database round trip, not just "the process is up".
   *
   * Also reports whether the provider integration is live or simulated. During
   * acceptance testing that is the single most useful thing to be able to check
   * without reading logs: whether the money and the bundles were real.
   *
   * The database round trip itself is cached (see `DATABASE_CHECK_CACHE_MS`)
   * rather than run on every call. This is Render's own health check target,
   * pinged far more often than that, and every ping used to mean a real
   * query, which kept the database permanently active and unable to ever
   * autosuspend on Neon's free tier, whether or not a real customer was
   * doing anything. A recent "yes it answered" is still a genuine database
   * check, satisfying NFR-3.1 without paying for a fresh round trip on every
   * single ping.
   */
  @Get()
  async check() {
    const cached = this.lastDatabaseCheck
    // Never reuse a "down" result: a real outage should surface on the very
    // next ping, not stay masked behind up to a minute of stale good news.
    const cacheIsFresh =
      cached !== null && cached.database === 'up' && Date.now() - cached.checkedAt < DATABASE_CHECK_CACHE_MS

    const { database, databaseLatencyMs } = cacheIsFresh ? cached : await this.checkDatabase()

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      databaseLatencyMs,
      providers: {
        // Reports what actually happens, not what is configured. A key in .env
        // does not make an integration exist, and saying "live" when nothing is
        // sent would be the most expensive kind of wrong.
        datahub: this.supplier.providerState,
        paystack: process.env.PAYSTACK_SECRET_KEY ? 'live' : 'simulated',
      },
      uptimeSeconds: Math.round(process.uptime()),
    }
  }

  private async checkDatabase(): Promise<{ database: string; databaseLatencyMs: number }> {
    const started = Date.now()
    let database = 'up'

    try {
      await this.prisma.$queryRaw`SELECT 1`
    } catch {
      database = 'down'
    }

    const databaseLatencyMs = Date.now() - started
    this.lastDatabaseCheck = { database, databaseLatencyMs, checkedAt: Date.now() }
    return { database, databaseLatencyMs }
  }
}
