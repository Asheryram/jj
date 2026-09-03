import { Module } from '@nestjs/common'
import { AdminDomainsController, DomainsController } from './domains.controller'
import { DomainsService } from './domains.service'

@Module({
  controllers: [DomainsController, AdminDomainsController],
  providers: [DomainsService],
  exports: [DomainsService],
})
export class DomainsModule {}
