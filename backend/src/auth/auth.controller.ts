import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
/**
 * `@SkipThrottle()` takes the throttler names, and must.
 *
 * With no argument it defaults to `{ default: true }`, which matches nothing here
 * because the throttlers are named `burst` and `grind` — so the decorator was
 * silently doing nothing. The route it was protecting is `/auth/me`, which the app
 * calls on every page load, and the store clears the token whenever that call
 * fails: about ten page views in a minute quietly signed the user out and dropped
 * them onto the public shell. The decorator looked right and the failure looked
 * like broken links.
 */
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import { LoginThrottleGuard } from './login-throttle.guard'
import { IsEmail, IsIn, IsString, MaxLength, Matches, MinLength } from 'class-validator'
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

export class UpdatePhoneDto {
  @Matches(/^0\d{9}$/, { message: 'A Ghana number needs 10 digits, like 0209876543.' })
  phone!: string
}

export class SwitchProfileDto {
  @IsString()
  @MinLength(10)
  userId!: string
}

export class CreateProfileDto {
  @IsIn(['admin', 'agent'], { message: 'A profile is either admin or agent.' })
  role!: 'admin' | 'agent'
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
   * Swap the session for another of this person's profiles.
   *
   * No password: the caller already proved who they are, and every profile under
   * one email belongs to one person by construction — registration refuses an
   * address that already exists, and only the owner can add a profile.
   *
   * Not throttled with the sign-in routes. It cannot be used to guess anything,
   * and being rate-limited out of your own admin screens mid-shift would be a
   * worse outcome than the attack it prevents.
   */
  /**
   * Change your own phone number.
   *
   * Not an admin action: it is the number your own earnings are paid to, so
   * nobody else should be setting it. Applies to every profile you hold.
   */
  @SkipThrottle({ burst: true, grind: true })
  @Roles()
  @ApiBearerAuth()
  @Patch('me/phone')
  updatePhone(@CurrentUser() user: AuthUser, @Body() dto: UpdatePhoneDto) {
    return this.auth.updatePhone(user.id, dto.phone)
  }

  @SkipThrottle({ burst: true, grind: true })
  @Roles()
  @ApiBearerAuth()
  @Post('switch')
  switchProfile(@CurrentUser() user: AuthUser, @Body() dto: SwitchProfileDto) {
    return this.auth.switchProfile(user.id, dto.userId)
  }

  /**
   * Give yourself another profile — an agent one to see what agents see, or a
   * second admin one if you run the platform.
   *
   * Creates no password and sends no link: this account already has both.
   */
  @SkipThrottle({ burst: true, grind: true })
  @Roles('admin', 'superadmin')
  @ApiBearerAuth()
  @Post('profiles')
  createProfile(@CurrentUser() user: AuthUser, @Body() dto: CreateProfileDto) {
    return this.auth.createProfile(user.id, dto.role)
  }

  /**
   * Called on page load to turn a stored token back into a session.
   *
   * Not counted. This runs on every page load and every tab, so a shared office
   * address doing ordinary work would trip a limit meant for someone guessing —
   * and the failure mode is the platform locking out the people running it. There
   * is nothing to guess here anyway: it validates a token it was handed.
   */
  @SkipThrottle({ burst: true, grind: true })
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
