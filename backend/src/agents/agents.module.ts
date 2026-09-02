import { Module } from '@nestjs/common'
import { AgentsController } from './agents.controller'
import { AgentsService } from './agents.service'

@Module({
  controllers: [AgentsController],
  providers: [AgentsService],
  // Exported so AdminModule can look up a specific agent's earnings — the
  // self-scoped `/agents/me/*` routes stay exactly that, and an admin-facing
  // equivalent lives under `/admin` instead of loosening this module's guard.
  exports: [AgentsService],
})
export class AgentsModule {}
