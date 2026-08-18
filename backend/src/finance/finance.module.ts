import { Global, Module } from '@nestjs/common'
import { LedgerService } from './ledger.service'
import { SolvencyService } from './solvency.service'
import { PaystackClient } from '../payments/paystack.client'

/**
 * Global because money moves in several modules — payments, fulfilment,
 * withdrawals — and each of them has to be able to record it without every
 * module growing an import for the privilege. There is exactly one ledger.
 */
@Global()
@Module({
  // PaystackClient is provided directly rather than by importing PaymentsModule:
  // that module imports fulfilment, which would drag order settlement into every
  // module that only wants to read a balance. It holds no state.
  providers: [LedgerService, SolvencyService, PaystackClient],
  exports: [LedgerService, SolvencyService],
})
export class FinanceModule {}
