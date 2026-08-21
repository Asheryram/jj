import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler'

/**
 * Rate limiting for the sign-in and password routes.
 *
 * Deliberately scoped to those routes rather than applied globally. The webhook
 * endpoints are the reason: Paystack and DataHub decide when to call, they burst
 * on retry, and a 429 there is a payment or a delivery this platform never hears
 * about. Guarding everything would put that at risk to solve a problem that only
 * exists where a secret can be guessed.
 */
@Injectable()
export class LoginThrottleGuard extends ThrottlerGuard {
  /**
   * Say it in words the person reads, not the framework's class name.
   *
   * The default message is `ThrottlerException: Too Many Requests`, which reaches
   * the sign-in form as-is. Someone who has mistyped their password four times is
   * already frustrated; a framework noise word is not the thing to show them. It
   * gives a duration because "try again later" just invites an instant retry.
   */
  protected async throwThrottlingException(
    _context: unknown,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const seconds = Math.max(1, Math.ceil(detail.timeToBlockExpire))
    const minutes = Math.ceil(seconds / 60)
    const wait = seconds >= 60 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : `${seconds} seconds`

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'TOO_MANY_ATTEMPTS',
        message: `Too many attempts. Please wait ${wait} and try again.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    )
  }
}
