import { Module } from '@nestjs/common'
import { AdminBrandingController, BrandingController } from './branding.controller'
import { BrandingService } from './branding.service'

@Module({
  controllers: [BrandingController, AdminBrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
