import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { Role } from '@prisma/client'
import { ForbiddenError, UnauthorisedError } from './domain-errors'

export interface AuthUser {
  id: string
  role: Role
  referralCode: string
  phone: string
  name: string
}

/** What we sign. Kept small — a JWT is not a cache. */
export interface TokenPayload {
  sub: string
  role: Role
  code: string
  phone: string
  name: string
}

export const ROLES_KEY = 'jdc:roles'

/**
 * Whether a role satisfies what a route asked for.
 *
 * A superadmin passes every `admin` check. They run the platform the business
 * sits on, and an operator who can create the owner's account but not help them
 * when something breaks is not much use — the alternative is handing over the
 * owner's password, which is exactly what the setup-link mechanism exists to
 * avoid.
 *
 * It does NOT work the other way. An admin is never treated as a superadmin, so
 * they cannot create another admin, lift their own role, or suspend the operator.
 * Route decorators are still written as the narrowest role that should reach
 * them; this only widens upwards.
 */
function satisfies(role: Role, required: Role[]): boolean {
  if (required.includes(role)) return true
  return role === 'superadmin' && required.includes('admin')
}

/**
 * Require a signed-in user, optionally in one of the listed roles.
 *
 * `@Roles()` with no arguments means "any authenticated user". A route with no
 * decorator at all is public — buying needs no account (FR-4.8), so public is
 * the correct default here rather than an oversight.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles)

/**
 * The signed-in user, or `undefined` on a public route reached by a guest.
 * Guests are first-class in this product, so handlers must cope with undefined.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user,
)

/**
 * Applied globally. Always decodes a Bearer token if one is present so public
 * routes can behave differently for a signed-in visitor (an agent shopping in
 * their own store, for example), and enforces `@Roles()` where it is declared.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>()
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null

    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<TokenPayload>(token)
        req.user = {
          id: payload.sub,
          role: payload.role,
          referralCode: payload.code,
          phone: payload.phone,
          name: payload.name,
        }
      } catch {
        // An expired or forged token is treated as absent. Routes that need a
        // user reject below with a message about signing in, which is more
        // useful than "malformed token".
        req.user = undefined
      }
    }

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])

    if (required === undefined) return true // public route

    if (!req.user) throw new UnauthorisedError('Please log in to continue.')

    if (required.length > 0 && !satisfies(req.user.role, required)) {
      throw new ForbiddenError('Your account does not have access to that.')
    }

    return true
  }
}
