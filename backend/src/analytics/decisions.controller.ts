import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Roles } from '../common/auth'
import { DecisionsService } from './decisions.service'

/**
 * Its own controller, not `AnalyticsController`: that one is guarded on the
 * analytics warehouse being reachable, and this reads the production
 * database directly, so it still works when the warehouse is down.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@Roles('admin')
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  /** What to do this week, ranked, with the evidence and what each is worth. */
  @Get('decisions')
  get() {
    return this.decisions.decisions()
  }
}
