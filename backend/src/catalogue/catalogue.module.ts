import { Module } from '@nestjs/common'
import { CatalogueController } from './catalogue.controller'
import { CatalogueService } from './catalogue.service'
import { SettingsService } from '../settings/settings.service'

@Module({
  controllers: [CatalogueController],
  providers: [CatalogueService, SettingsService],
})
export class CatalogueModule {}
