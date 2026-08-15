import { Global, Module } from '@nestjs/common'
import { SettingsService } from './settings.service'

/**
 * Settings, provided once.
 *
 * It used to be listed in the `providers` array of three separate modules, which
 * builds three instances. That is harmless only for as long as the service stays
 * stateless — the moment someone adds a cache to avoid hitting the database on
 * every read, an admin toggling the referral rate updates one copy while
 * checkout keeps pricing from another, and the bug looks like "the setting did
 * not save".
 *
 * Global because nearly every module needs it and none of them own it.
 */
@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
