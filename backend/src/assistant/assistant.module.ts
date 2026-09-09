import { Module } from '@nestjs/common'
import { AssistantController } from './assistant.controller'
import { AssistantService } from './assistant.service'
import { AgentsModule } from '../agents/agents.module'
import { DomainsModule } from '../domains/domains.module'
import { SupplierModule } from '../supplier/supplier.module'
import { OrdersModule } from '../orders/orders.module'

@Module({
  imports: [AgentsModule, DomainsModule, SupplierModule, OrdersModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
