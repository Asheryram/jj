import { Module } from '@nestjs/common'
import { OrdersController } from './orders.controller'
import { OrdersService } from './orders.service'
import { FulfilmentService } from './fulfilment.service'
import { SupplierService } from '../supplier/supplier.service'
import { SettingsService } from '../settings/settings.service'

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, FulfilmentService, SupplierService, SettingsService],
  exports: [OrdersService, FulfilmentService],
})
export class OrdersModule {}
