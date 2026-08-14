import { Global, Module } from '@nestjs/common'
import { PricingService } from './pricing.service'
import { SettingsService } from '../settings/settings.service'

/**
 * Global because orders, the catalogue, and the agent price editor all need the
 * same chain resolution, and duplicating the loader is how two copies of a money
 * rule start to drift.
 */
@Global()
@Module({
  providers: [PricingService, SettingsService],
  exports: [PricingService, SettingsService],
})
export class PricingModule {}
