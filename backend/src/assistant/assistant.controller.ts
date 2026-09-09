import { Body, Controller, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { AssistantService } from './assistant.service'
import { AskAssistantDto } from './assistant.dto'

@ApiTags('assistant')
@ApiBearerAuth()
@Controller('assistant')
@Roles('agent', 'admin', 'superadmin')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post()
  ask(@CurrentUser() user: AuthUser, @Body() dto: AskAssistantDto) {
    return this.assistant.ask(user, dto.message, dto.history)
  }
}
