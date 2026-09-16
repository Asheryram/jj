import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { AnalyticsPrismaService } from './analytics-prisma.service'

/**
 * Turns "the warehouse isn't connected" into one clean 503 for every
 * `/analytics` route, instead of each handler hitting a raw Prisma
 * "can't reach database" error the moment `ANALYTICS_DATABASE_URL` is unset
 * or unreachable. The frontend already treats a failed analytics call as
 * empty data (see `Analytics.tsx`'s own `.catch(() => [])` on every fetch),
 * this just keeps what actually lands in the server log readable too.
 */
@Injectable()
export class AnalyticsAvailableGuard implements CanActivate {
  constructor(private readonly warehouse: AnalyticsPrismaService) {}

  canActivate(_context: ExecutionContext): boolean {
    if (!this.warehouse.isAvailable) {
      throw new ServiceUnavailableException('Analytics is not configured yet.')
    }
    return true
  }
}
