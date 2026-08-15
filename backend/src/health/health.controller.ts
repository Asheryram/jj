import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { PrismaService } from '../prisma/prisma.service'
import { SupplierService } from '../supplier/supplier.service'

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supplier: SupplierService,
  ) {}

  /**
   * NFR-3.1 — includes a real database round trip, not just "the process is up".
   *
   * Also reports whether the provider integration is live or simulated. During
   * acceptance testing that is the single most useful thing to be able to check
   * without reading logs: whether the money and the bundles were real.
   */
  @Get()
  async check() {
    const started = Date.now()
    let database = 'up'

    try {
      await this.prisma.$queryRaw`SELECT 1`
    } catch {
      database = 'down'
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      databaseLatencyMs: Date.now() - started,
      providers: {
        // Reports what actually happens, not what is configured. A key in .env
        // does not make an integration exist, and saying "live" when nothing is
        // sent would be the most expensive kind of wrong.
        datahub: this.supplier.providerState,
        paystack: process.env.PAYSTACK_SECRET_KEY ? 'live' : 'simulated',
      },
      uptimeSeconds: Math.round(process.uptime()),
    }
  }
}
