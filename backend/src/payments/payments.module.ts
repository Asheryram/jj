import { Module } from '@nestjs/common'
import { PaymentsController } from './payments.controller'
import { PaymentsService } from './payments.service'
import { PaystackClient } from './paystack.client'
import { FulfilmentModule } from '../orders/fulfilment.module'
import { DomainsModule } from '../domains/domains.module'

/**
 * Taking money.
 *
 * Imports FulfilmentModule rather than OrdersModule: a confirmed payment is what
 * releases an order for fulfilment, and reaching for the whole orders module
 * would make the two mutually dependent — Orders needs this one to start a
 * charge. Settlement still has exactly one owner.
 *
 * Also imports DomainsModule — `PaymentsService.callbackUrl` checks a
 * checkout's own custom domain against `DomainsService.resolve` before ever
 * sending Paystack there.
 */
@Module({
  imports: [FulfilmentModule, DomainsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaystackClient],
  exports: [PaymentsService, PaystackClient],
})
export class PaymentsModule {}
