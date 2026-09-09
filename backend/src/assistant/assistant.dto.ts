import { Type } from 'class-transformer'
import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'

class ChatTurnDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant'

  @IsString()
  @MaxLength(4000)
  content!: string
}

export class AskAssistantDto {
  @IsString()
  @MaxLength(2000, { message: 'Keep your question under 2000 characters.' })
  message!: string

  /** The conversation so far, oldest first. Empty for the first message. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatTurnDto)
  history?: ChatTurnDto[]
}
