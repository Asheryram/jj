import { statSync } from 'node:fs'
import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { PrismaService } from '../prisma/prisma.service'
import { SupplierService } from '../supplier/supplier.service'

@ApiTags('health')
@Controller('health')
export class KeepAliveController {
  @Get('ping')
  ping() {
    return { status: 'ok' }
  }
}

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

/**
 * When this server's code was built: the compiled file's own time, written by
 * `npm run build` inside the image. The image has no git history, so this,
 * not a commit id, is what says which push is running. A commit id is added
 * when the host provides one.
 */
const BUILT_AT = (() => {
  try {
    return statSync(__filename).mtime.toISOString()
  } catch {
    return null
  }
})()
const STARTED_AT = new Date().toISOString()
const COMMIT =
  process.env.GIT_COMMIT ??
  process.env.SOURCE_COMMIT ??
  process.env.RENDER_GIT_COMMIT ??
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  null

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
        gmpl: this.supplier.gmplProviderState,
        paystack: process.env.PAYSTACK_SECRET_KEY ? 'live' : 'simulated',
      },
      uptimeSeconds: Math.round(process.uptime()),
    }
  }

  /**
   * Which version of the server is live, and the last database update it
   * applied, so anyone can tell whether a push has landed. Public, like the
   * rest of /health: nothing here is secret.
   */
  @Get('version')
  async version() {
    let latestMigration: { name: string; appliedAt: string } | null = null
    try {
      const rows = await this.prisma.$queryRaw<{ migration_name: string; finished_at: Date }[]>`
        SELECT migration_name, finished_at FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY migration_name DESC LIMIT 1`
      if (rows[0]) latestMigration = { name: rows[0].migration_name, appliedAt: rows[0].finished_at.toISOString() }
    } catch {
      latestMigration = null
    }
    return {
      builtAt: BUILT_AT,
      startedAt: STARTED_AT,
      commit: COMMIT ? COMMIT.slice(0, 7) : null,
      latestMigration,
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
