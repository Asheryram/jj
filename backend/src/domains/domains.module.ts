import { Module } from '@nestjs/common'
import { AdminDomainsController, DomainPricingController, DomainsController, SuperadminWalletController } from './domains.controller'
import { DomainsService } from './domains.service'
import { DomainRenewalsService } from './domain-renewals.service'
import { PaystackClient } from '../payments/paystack.client'
import { VercelClient } from './vercel.client'

@Module({
  controllers: [DomainsController, AdminDomainsController, DomainPricingController, SuperadminWalletController],
  // PaystackClient provided directly, not by importing PaymentsModule: that
  // module already imports this one (to check a checkout's domain), and it
  // holds no state, so every module that needs it just gets its own
  // instance, the same pattern FinanceModule and PaymentsModule each use.
  providers: [DomainsService, DomainRenewalsService, PaystackClient, VercelClient],
  exports: [DomainsService],
})
export class DomainsModule {}
