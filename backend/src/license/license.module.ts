import { Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { LicenseController } from './license.controller'
import { LicenseGuard } from './license.gate'
import { LicenseService } from './license.service'

/**
 * The subscription check, provided once (it holds the last answer in memory, so
 * two copies would disagree) and applied everywhere by a global guard. The guard
 * only acts on routes marked with `@LicenseGate`, so adding it changes nothing
 * about any other endpoint.
 */
@Global()
@Module({
  controllers: [LicenseController],
  providers: [LicenseService, { provide: APP_GUARD, useClass: LicenseGuard }],
  exports: [LicenseService],
})
export class LicenseModule {}
