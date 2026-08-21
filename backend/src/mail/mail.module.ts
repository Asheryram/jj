import { Global, Module } from '@nestjs/common'
import { MailerService } from './mailer.service'

/**
 * Global because several unrelated things need to send a message — account setup,
 * password resets, and later agent notifications — and none of them should have to
 * import a module for the privilege. It holds no state.
 */
@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailModule {}
