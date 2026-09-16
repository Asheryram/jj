import { Module } from '@nestjs/common'
import { SupplierModule } from '../supplier/supplier.module'
import { AnalyticsAvailableGuard } from './analytics-available.guard'
import { AnalyticsPrismaService } from './analytics-prisma.service'
import { EtlService } from './etl.service'
import { AnalyticsController } from './analytics.controller'

/**
 * `SupplierModule` for `FloatMonitorService`, the daily float snapshot reads
 * it directly. `SolvencyService` needs no import here at all, `FinanceModule`
 * is `@Global()` (same reason `PrismaService`/`MailerService` need none).
 */
@Module({
  imports: [SupplierModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsPrismaService, EtlService, AnalyticsAvailableGuard],
})
export class AnalyticsModule {}
