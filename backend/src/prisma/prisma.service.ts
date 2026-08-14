import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PrismaService.name)

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect()
      this.log.log('connected to postgres')
    } catch (error) {
      // The single most common local failure is Docker not being up. Say so,
      // rather than letting a driver error scroll past.
      this.log.error(
        'could not reach postgres. Is the container running? Try: cd backend && npm run db:up',
      )
      throw error
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
