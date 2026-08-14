import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common'
import type { Response } from 'express'
import { Prisma } from '@prisma/client'
import { DomainError } from './domain-errors'

/**
 * One error envelope for the whole API: `{ code, message, detail? }`.
 *
 * The frontend reads `message` and shows it verbatim (NFR-4.3), so anything
 * that reaches here without a human-readable message gets a generic one — a
 * Postgres constraint name must never surface in the UI.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('error')

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>()

    if (exception instanceof DomainError) {
      // Server-side domain failures (a broken invariant) are our bug — log them.
      if (exception.status >= 500) this.log.error(exception.message, exception.detail)
      res.status(exception.status).json({
        code: exception.code,
        message: exception.message,
        ...(exception.detail ? { detail: exception.detail } : {}),
      })
      return
    }

    if (exception instanceof HttpException) {
      const body = exception.getResponse()
      const message =
        typeof body === 'string'
          ? body
          : // ValidationPipe returns { message: string[] }. Show the first, which
            // is the most specific, rather than a joined wall of text.
            (Array.isArray((body as { message?: unknown }).message)
              ? ((body as { message: string[] }).message[0] as string)
              : ((body as { message?: string }).message ?? exception.message))
      res.status(exception.getStatus()).json({
        code: (body as { code?: string })?.code ?? httpCodeFor(exception.getStatus()),
        message,
      })
      return
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 unique violation — almost always a duplicate registration or a
      // replayed idempotency key. Both have friendly readings.
      if (exception.code === 'P2002') {
        const target = String((exception.meta as { target?: string[] })?.target ?? '')
        const field = target.includes('phone')
          ? 'phone number'
          : target.includes('email')
            ? 'email address'
            : target.includes('referral')
              ? 'referral code'
              : 'value'
        res.status(409).json({
          code: 'ALREADY_EXISTS',
          message: `That ${field} is already registered.`,
        })
        return
      }
      // A CHECK constraint fired. That is a bug on our side, not a user error.
      this.log.error(`prisma ${exception.code}: ${exception.message}`)
      res.status(500).json({
        code: 'DATABASE_REJECTED',
        message: 'We could not complete that safely, so nothing was changed.',
      })
      return
    }

    this.log.error(exception instanceof Error ? exception.stack : String(exception))
    res.status(500).json({
      code: 'INTERNAL',
      message: 'Something went wrong on our side. Please try again.',
    })
  }
}

function httpCodeFor(status: number): string {
  if (status === 401) return 'UNAUTHORISED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 429) return 'RATE_LIMITED'
  return status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'
}
