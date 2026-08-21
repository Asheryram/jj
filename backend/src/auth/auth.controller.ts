import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import { LoginThrottleGuard } from './login-throttle.guard'
import { IsEmail, IsString, MaxLength, Matches, MinLength } from 'class-validator'
import { Transform } from 'class-transformer'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { AuthService } from './auth.service'
import { LoginDto, RegisterDto } from './auth.dto'
import { SetupTokensService } from './setup-tokens.service'
import { TeamService } from './team.service'

export class SetPasswordDto {
  @IsString()
  @MinLength(10)
  token!: string

  @IsString()
  @MinLength(10, {
    message: 'Use at least 10 characters. A phrase you will remember is best.',
  })
  @MaxLength(200)
  password!: string
}

export class ForgotPasswordDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter the email address on your account.' })
  email!: string
}

export class CreateAdminDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter the email address they will sign in with.' })
  email!: string

  @Matches(/^0\d{9}$/, { message: 'A Ghana number needs 10 digits.' })
  phone!: string
}

@ApiTags('auth')
@Controller('auth')
// Every route on this controller either checks a secret or hands one out, so
// every one of them is worth counting. See LoginThrottleGuard for why this is not
// applied to the whole API.
@UseGuards(LoginThrottleGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: SetupTokensService,
  ) {}

  // Tighter than the controller default: this is the one route where guessing
  // right is worth real money. Ten a minute is far more than a person typing.
  @Throttle({ burst: { limit: 8, ttl: 60_000 }, grind: { limit: 25, ttl: 900_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto)
  }

  @Throttle({ burst: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto)
  }

  /**
   * Ask for a password reset link.
   *
   * Always answers the same way, whether or not the address has an account. A
   * reply that distinguished them would turn this into a way to find out who has
   * access to the platform.
   */
  /**
   * Low, because the cost of abuse here lands on someone else.
   *
   * Every call sends mail to a real inbox. Unlimited, it is a way to bury a
   * person's email under reset links they did not ask for — and to burn the
   * daily send quota so the ones that matter never arrive. There is already a
   * per-address wait inside `requestReset`; this is the per-caller half.
   */
  @Throttle({ burst: { limit: 4, ttl: 60_000 }, grind: { limit: 10, ttl: 900_000 } })
  @Post('forgot-password')
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.tokens.requestReset(dto.email)
    return {
      ok: true,
      message: 'If that address has an account, a reset link is on its way to it.',
    }
  }

  /**
   * Is this setup link still good?
   *
   * Called before showing a password field, so somebody following a dead link is
   * told so rather than typing a new password twice and then being refused.
   * Public: the whole point is that the holder is not signed in yet.
   */
  @Throttle({ burst: { limit: 20, ttl: 60_000 } })
  @Get('set-password')
  checkLink(@Query('token') token?: string) {
    return this.tokens.check(token ?? '')
  }

  /**
   * Spend a setup link and set the password.
   *
   * Public for the same reason. Safety comes from the token: 32 random bytes,
   * stored only as a hash, single use, and short-lived.
   */
  @Throttle({ burst: { limit: 10, ttl: 60_000 } })
  @Post('set-password')
  setPassword(@Body() dto: SetPasswordDto) {
    return this.tokens.consume(dto.token, dto.password).then(() => ({ ok: true }))
  }

  /**
   * Called on page load to turn a stored token back into a session.
   *
   * Not counted. This runs on every page load and every tab, so a shared office
   * address doing ordinary work would trip a limit meant for someone guessing —
   * and the failure mode is the platform locking out the people running it. There
   * is nothing to guess here anyway: it validates a token it was handed.
   */
  @SkipThrottle()
  @Get('me')
  @Roles()
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id)
  }
}

/**
 * Platform accounts, managed by the person who runs the platform.
 *
 * `@Roles('superadmin')` and nothing else: an admin must not be able to create
 * another admin or lift their own role. The business owner runs the business; the
 * operator decides who has the keys.
 */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform/team')
@Roles('superadmin')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list() {
    return this.team.list()
  }

  /** Create an admin. Returns the one-time link for them to set a password. */
  @Post()
  create(@Body() dto: CreateAdminDto, @CurrentUser() user: AuthUser) {
    return this.team.createAdmin(dto, user.name)
  }

  /** A fresh link for somebody locked out, or who never used their first. */
  @Post(':id/link')
  resend(@Param('id') id: string) {
    return this.team.resendLink(id)
  }

  @Post(':id/suspend')
  suspend(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.team.setStatus(id, 'suspended', user.id)
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.team.setStatus(id, 'active', user.id)
  }
}
