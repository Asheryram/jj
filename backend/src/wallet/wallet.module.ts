import { Module } from '@nestjs/common'
import { WalletController } from './wallet.controller'
import { WalletService } from './wallet.service'
import { PaymentsModule } from '../payments/payments.module'

@Module({
  imports: [PaymentsModule],
  controllers: [WalletController],
  providers: [WalletService],
})
export class WalletModule {}
