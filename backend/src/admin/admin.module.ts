import { Module } from '@nestjs/common'
import { AdminController, ReportsController } from './admin.controller'
import { AdminService } from './admin.service'
import { SupplierModule } from '../supplier/supplier.module'
@Module({
  imports: [SupplierModule],
  controllers: [AdminController, ReportsController],
  providers: [AdminService],
})
export class AdminModule {}
