import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { Request, Response } from 'express'
import { tap, type Observable } from 'rxjs'
import { PrismaService } from '../prisma/prisma.service'
import { isAdminRole, type AuthUser } from './auth'

/** Field names whose values never belong in an audit trail. */
const SECRET_FIELD = /pass|token|secret|otp|pin|key/i
/** Past this, a body is summarised rather than stored whole (an upload, a big import). */
const MAX_BODY_CHARS = 4000

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_FIELD.test(k) ? '[redacted]' : redact(v, depth + 1)]),
  )
}

/**
 * Who did what, for every write made by an admin or superadmin.
 *
 * Global, so nothing has to remember to log: approving a payout, marking it
 * sent, logging or reversing capital, changing a setting or routing,
 * resolving an order by hand are all covered, and so is any admin action
 * added later. GET requests are skipped (reading changes nothing). Runs
 * after `AuthGuard`, so `req.user` is the verified caller. Written in the
 * background and never allowed to fail the request it describes.
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  private readonly log = new Logger(AdminAuditInterceptor.name)

  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp()
    const req = http.getRequest<Request & { user?: AuthUser }>()
    const user = req.user
    if (!user || !isAdminRole(user.role) || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next.handle()
    }

    const write = (statusCode: number) => {
      const redacted = redact(req.body)
      const text = redacted === undefined ? '' : JSON.stringify(redacted)
      const body = (text.length > MAX_BODY_CHARS ? { truncated: true, size: text.length } : redacted) as
        | Prisma.InputJsonValue
        | undefined
      void this.prisma.adminAction
        .create({
          data: {
            actorId: user.id,
            actorRole: user.role,
            method: req.method,
            path: req.originalUrl.slice(0, 500),
            body: body ?? undefined,
            statusCode,
          },
        })
        .catch((error: unknown) => this.log.error(`could not record admin action ${req.method} ${req.originalUrl}: ${String(error)}`))
    }

    return next.handle().pipe(
      tap({
        next: () => write(http.getResponse<Response>().statusCode),
        error: (error: { status?: number; getStatus?: () => number }) =>
          write(error?.getStatus?.() ?? error?.status ?? 500),
      }),
    )
  }
}
