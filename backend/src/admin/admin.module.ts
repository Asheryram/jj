import { Module } from '@nestjs/common'
import { AdminController, ReportsController } from './admin.controller'
import { AdminService } from './admin.service'
import { ApplicationsService } from './applications.service'
import { SettingsModule } from '../settings/settings.module'
import { SupplierModule } from '../supplier/supplier.module'
import { OrdersModule } from '../orders/orders.module'
import { AgentsModule } from '../agents/agents.module'
@Module({
  imports: [SupplierModule, OrdersModule, SettingsModule, AgentsModule],
  controllers: [AdminController, ReportsController],
  providers: [AdminService, ApplicationsService],
})
export class AdminModule {}
