import { Module } from '@nestjs/common'
import { SettingsModule } from '../settings/settings.module'
import { SupplierModule } from '../supplier/supplier.module'
import { PaystackClient } from '../payments/paystack.client'
import { TreasuryController } from './treasury.controller'
import { TreasuryService } from './treasury.service'

/**
 * Moving money in and out of the Paystack balance on purpose, see
 * `TreasuryService`.
 *
 * Provides its own `PaystackClient` (stateless, the same way `FinanceModule`
 * does) rather than importing `PaymentsModule`: Payments needs this module
 * for its transfer webhook, so importing it back would be a cycle.
 */
@Module({
  imports: [SettingsModule, SupplierModule],
  controllers: [TreasuryController],
  providers: [TreasuryService, PaystackClient],
  exports: [TreasuryService],
})
export class TreasuryModule {}
