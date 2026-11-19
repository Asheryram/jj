import { Module } from '@nestjs/common'
import { SupplierModule } from '../supplier/supplier.module'
import { AnalyticsAvailableGuard } from './analytics-available.guard'
import { AnalyticsPrismaService } from './analytics-prisma.service'
import { EtlService } from './etl.service'
import { InsightsService } from './insights.service'
import { AnalyticsController } from './analytics.controller'
import { DecisionsController } from './decisions.controller'
import { DecisionsService } from './decisions.service'

/** `SupplierModule` for `FloatMonitorService`; `SolvencyService` comes from the global `FinanceModule`. */
@Module({
  imports: [SupplierModule],
  controllers: [AnalyticsController, DecisionsController],
  providers: [AnalyticsPrismaService, EtlService, InsightsService, AnalyticsAvailableGuard, DecisionsService],
})
export class AnalyticsModule {}
