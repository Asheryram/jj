import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { ThrottlerModule } from '@nestjs/throttler'
import { SettingsModule } from '../settings/settings.module'
import { AuthController, TeamController } from './auth.controller'
import { AuthService } from './auth.service'
import { SetupTokensService } from './setup-tokens.service'
import { TeamService } from './team.service'
import { BootstrapService } from './bootstrap.service'

@Module({
  imports: [
    /**
     * Two windows, because the two attacks look different.
     *
     * `burst` stops someone firing a password list at one account as fast as the
     * network allows. `grind` stops the patient version — a few tries a minute,
     * all day, which slips under any per-minute limit. Registered here rather
     * than globally so only these routes are guarded.
     *
     * In-memory, so each instance counts separately. That is honest for one
     * container and worth revisiting behind more than one; it still cuts an
     * unlimited attack down to a rate a person would notice.
     */
    SettingsModule,
    ThrottlerModule.forRoot([
      { name: 'burst', ttl: 60_000, limit: 10 },
      { name: 'grind', ttl: 900_000, limit: 40 },
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      // Registered async so the secret comes from validated config rather than
      // a bare process.env read at import time.
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          // jsonwebtoken types this as a template-literal union, which a plain
          // env string cannot satisfy. The value is validated at boot instead.
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '12h') as `${number}h`,
        },
      }),
      global: true,
    }),
  ],
  controllers: [AuthController, TeamController],
  providers: [AuthService, SetupTokensService, TeamService, BootstrapService],
  exports: [SetupTokensService],
})
export class AuthModule {}
