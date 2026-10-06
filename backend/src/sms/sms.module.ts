import { Global, Module } from '@nestjs/common'
import { SmsService } from './sms.service'

/** Global for the same reason as `MailModule`: orders, refunds and payouts all send a text. */
@Global()
@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
