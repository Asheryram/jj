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
import { SupplierService } from './supplier/supplier.service'
import { SettingsService } from './settings/settings.service'
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
        return env
      },
    }),
    PrismaModule,
    PricingModule,
    AuthModule,
    CatalogueModule,
    OrdersModule,
    WalletModule,
    AgentsModule,
    WithdrawalsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    SupplierService,
    SettingsService,
    // Global so a new controller is authenticated by default. A route is public
    // only by omitting @Roles(), which is a visible choice in the code.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
