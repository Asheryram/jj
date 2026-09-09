import { Module } from '@nestjs/common'
import { AssistantController } from './assistant.controller'
import { AssistantService } from './assistant.service'
import { AgentsModule } from '../agents/agents.module'
import { DomainsModule } from '../domains/domains.module'
import { SupplierModule } from '../supplier/supplier.module'
import { OrdersModule } from '../orders/orders.module'
import { AdminModule } from '../admin/admin.module'
import { BrandingModule } from '../branding/branding.module'
import { WithdrawalsModule } from '../withdrawals/withdrawals.module'

@Module({
  imports: [AgentsModule, DomainsModule, SupplierModule, OrdersModule, AdminModule, BrandingModule, WithdrawalsModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
