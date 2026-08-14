import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

@Module({
  imports: [
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
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
