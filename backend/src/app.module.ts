import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { PrismaModule } from './prisma/prisma.module'
import { PricingModule } from './pricing/pricing.module'
import { AuthModule } from './auth/auth.module'
import { CatalogueModule } from './catalogue/catalogue.module'
import { OrdersModule } from './orders/orders.module'
import { WalletModule } from './wallet/wallet.module'
import { AgentsModule } from './agents/agents.module'
import { WithdrawalsModule } from './withdrawals/withdrawals.module'
import { AdminModule } from './admin/admin.module'
import { HealthController } from './health/health.controller'
import { SupplierModule } from './supplier/supplier.module'
import { SettingsModule } from './settings/settings.module'
import { PaymentsModule } from './payments/payments.module'
import { FinanceModule } from './finance/finance.module'
import { AuthGuard } from './common/auth'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // NFR-2.4 — refuse to boot without the things that decide correctness,
      // rather than failing at the first request that needs one.
      validate: (env: Record<string, unknown>) => {
        const required = ['DATABASE_URL', 'JWT_SECRET']
        const missing = required.filter((key) => !env[key])
        if (missing.length > 0) {
          throw new Error(
            `Missing required environment variable(s): ${missing.join(', ')}. ` +
              'Copy backend/.env.example to backend/.env and fill them in.',
          )
        }
        if (String(env.JWT_SECRET).length < 16) {
          throw new Error('JWT_SECRET must be at least 16 characters.')
        }

        /**
         * In production, refuse to boot on a development default.
         *
         * Every item below is safe locally and dangerous live, and each fails
         * silently rather than loudly: the seed password is published in
         * .env.example, a wide-open CORS origin lets any site spend a logged-in
         * customer's wallet, and a missing PUBLIC_APP_URL sends every paying
         * customer back to localhost after Paystack — where their receipt does
         * not exist. Better to not start than to start wrong.
         */
        if (env.NODE_ENV === 'production') {
          const unsafe: string[] = []

          if (!env.SEED_PASSWORD || env.SEED_PASSWORD === 'demo1234') {
            unsafe.push('SEED_PASSWORD is the published example value')
          }
          if (String(env.JWT_SECRET).length < 32) {
            unsafe.push('JWT_SECRET should be at least 32 characters in production')
          }
          if (!env.CORS_ORIGINS) {
            unsafe.push('CORS_ORIGINS must name the real front-end origin(s)')
          }
          if (!env.PUBLIC_APP_URL) {
            unsafe.push('PUBLIC_APP_URL must be the address customers return to after paying')
          }
          if (env.PAYSTACK_SECRET_KEY && String(env.PAYSTACK_SECRET_KEY).startsWith('sk_test')) {
            unsafe.push('PAYSTACK_SECRET_KEY is a test key — no real money would be collected')
          }

          if (unsafe.length > 0) {
            throw new Error(
              ['Refusing to start in production:', ...unsafe.map((line) => `  · ${line}`)].join('\n'),
            )
          }
        }

        return env
      },
    }),
    PrismaModule,
    FinanceModule,
    SettingsModule,
    SupplierModule,
    PricingModule,
    AuthModule,
    CatalogueModule,
    OrdersModule,
    WalletModule,
    AgentsModule,
    WithdrawalsModule,
    AdminModule,
    PaymentsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global so a new controller is authenticated by default. A route is public
    // only by omitting @Roles(), which is a visible choice in the code.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
