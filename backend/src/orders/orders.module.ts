import { Module } from '@nestjs/common'
import { OrdersController } from './orders.controller'
import { OrdersService } from './orders.service'
import { FulfilmentModule } from './fulfilment.module'
import { SupplierModule } from '../supplier/supplier.module'
import { DatahubWebhookController } from '../supplier/datahub-webhook.controller'
import { ReconcilerService } from '../supplier/reconciler.service'
import { ApprovalsService } from './approvals.service'
import { RefundsService } from './refunds.service'
import { PaymentsModule } from '../payments/payments.module'

@Module({
  imports: [SupplierModule, FulfilmentModule, PaymentsModule],
  // The DataHub webhook and reconciler live here rather than in a module of
  // their own: both settle orders, and settlement is FulfilmentService's job.
  // Splitting them out would mean exporting the ledger writer, which is exactly
  // the thing that should have one owner.
  controllers: [OrdersController, DatahubWebhookController],
  providers: [OrdersService, ReconcilerService, ApprovalsService, RefundsService],
  exports: [OrdersService, ReconcilerService, ApprovalsService, RefundsService],
})
export class OrdersModule {}
