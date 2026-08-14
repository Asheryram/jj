import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { AuthService } from './auth.service'
import { LoginDto, RegisterDto } from './auth.dto'

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto)
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto)
  }

  /** Called on page load to turn a stored token back into a session. */
  @Get('me')
  @Roles()
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id)
  }
}
