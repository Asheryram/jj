import { Module } from '@nestjs/common'
import { OrdersController } from './orders.controller'
import { OrdersService } from './orders.service'
import { FulfilmentService } from './fulfilment.service'
import { SupplierModule } from '../supplier/supplier.module'
import { DatahubWebhookController } from '../supplier/datahub-webhook.controller'
import { ReconcilerService } from '../supplier/reconciler.service'

@Module({
  imports: [SupplierModule],
  // The DataHub webhook and reconciler live here rather than in a module of
  // their own: both settle orders, and settlement is FulfilmentService's job.
  // Splitting them out would mean exporting the ledger writer, which is exactly
  // the thing that should have one owner.
  controllers: [OrdersController, DatahubWebhookController],
  providers: [
    OrdersService,
    FulfilmentService,
    ReconcilerService,
  ],
  exports: [OrdersService, FulfilmentService, ReconcilerService],
})
export class OrdersModule {}
