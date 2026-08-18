import { Module } from '@nestjs/common'
import { FulfilmentService } from './fulfilment.service'
import { SupplierModule } from '../supplier/supplier.module'

/**
 * Settlement, on its own.
 *
 * It sits in a module of its own because two different things start it and both
 * would otherwise have to import each other: an order is dispatched when it is
 * placed (OrdersModule) and again when a payment is confirmed (PaymentsModule).
 * Orders also needs Payments, to start a charge — so without this split the two
 * modules form a cycle and Nest needs forwardRef to resolve it.
 *
 * The ledger writer having exactly one owner is the point. Every path that
 * completes or refunds an order lands in this service.
 */
@Module({
  imports: [SupplierModule],
  providers: [FulfilmentService],
  exports: [FulfilmentService],
})
export class FulfilmentModule {}
