import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger'
import { IsString, MaxLength, MinLength } from 'class-validator'
import type { Request } from 'express'
import { PaymentsService } from './payments.service'
import { PaystackClient } from './paystack.client'
import { LoginThrottleGuard } from '../auth/login-throttle.guard'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { ValidationError } from '../common/domain-errors'

export class ConfirmPaymentDto {
  @IsString()
  @MinLength(4)
  reference!: string
}

export class ReviewTransferDto {
  @IsString()
  @MinLength(5, { message: 'Say what you found. It is kept on the record.' })
  @MaxLength(500)
  note!: string
}

interface PaystackWebhookBody {
  event?: string
  data?: { reference?: string; status?: string; transfer_code?: string }
}

function transferType(type: string): 'withdrawal' | 'refund' {
  if (type !== 'withdrawal' && type !== 'refund') throw new ValidationError('Unknown transfer type.')
  return type
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly paystack: PaystackClient,
  ) {}

  /**
   * Paystack's webhook. The fast path for "the money arrived".
   *
   * Unauthenticated (no @Roles() on it) because Paystack cannot log in to us.
   * That is safe here because the request is HMAC-verified against the raw body
   * before anything is read from it; an unsigned or wrongly-signed one is
   * refused.
   *
   * Answering 200 to a forgery is deliberate. Paystack retries non-2xx responses,
   * so a 401 would earn an attacker unlimited free attempts and fill their
   * dashboard with delivery failures; nothing is done with the request either
   * way. The genuine one gets a 200 within their timeout because the work it
   * triggers is small and already idempotent.
   *
   * Excluded from Swagger: publishing the shape of an unauthenticated write
   * endpoint helps nobody but an attacker.
   */
  @Post('paystack/webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async webhook(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-paystack-signature') signature: string | undefined,
    @Body() body: PaystackWebhookBody,
  ) {
    if (!this.paystack.signatureValid(request.rawBody, signature)) {
      return { received: true, applied: false, reason: 'bad signature' }
    }

    const result = await this.payments.applyWebhook(
      body.event ?? '',
      body.data?.reference ?? '',
      body.data?.transfer_code,
    )
    return { received: true, ...result }
  }

  /** Ask Paystack what became of a payout or refund, see `PaymentsService.checkTransfer`. */
  @Post('transfers/:type/:id/check')
  @Roles('admin')
  @ApiBearerAuth()
  checkTransfer(@Param('type') type: string, @Param('id') id: string) {
    return this.payments.checkTransfer(transferType(type), id)
  }

  /** Close a possible double payment once someone has dealt with it. */
  @Post('transfers/:type/:id/review')
  @Roles('admin')
  @ApiBearerAuth()
  reviewTransfer(
    @Param('type') type: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReviewTransferDto,
  ) {
    return this.payments.reviewSentAfterReturn(transferType(type), id, user.id, dto.note)
  }

  /**
   * Called when the customer comes back from Paystack.
   *
   * The browser supplies only a reference, which is a public string it already
   * knows, every decision is made from a fresh server-to-Paystack verify. This
   * exists because the webhook can be late or lost, and the person standing
   * there should not have to wait on it.
   *
   * Rate-limited (reusing `LoginThrottleGuard`'s generic burst/grind windows,
   * not anything login-specific) because it is unauthenticated, takes only a
   * reference, and answers differently for a real one, a live Paystack verify
   * call (than for a made-up one) an immediate `failed`. With no limit at
   * all that difference is a free existence oracle for enumerating real order
   * references, and each real one burns a call against this account's own
   * Paystack API quota. `webhook`, just above, stays deliberately unthrottled,
   * Paystack decides when to call that one, and it must never be the
   * endpoint a rate limit makes a real payment or delivery go unheard.
   */
  @Post('confirm')
  @UseGuards(LoginThrottleGuard)
  confirm(@Body() dto: ConfirmPaymentDto) {
    return this.payments.confirm(dto.reference)
  }
}
