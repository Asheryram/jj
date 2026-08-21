import { Module } from '@nestjs/common'
import { WithdrawalsController } from './withdrawals.controller'
import { WithdrawalsService } from './withdrawals.service'
import { PaymentsModule } from '../payments/payments.module'

@Module({
  imports: [PaymentsModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
})
export class WithdrawalsModule {}
