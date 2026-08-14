import { Module } from '@nestjs/common'
import { AdminController, ReportsController } from './admin.controller'
import { AdminService } from './admin.service'
import { SettingsService } from '../settings/settings.service'

@Module({
  controllers: [AdminController, ReportsController],
  providers: [AdminService, SettingsService],
})
export class AdminModule {}
