import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common'
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger'
import { IsString, MinLength } from 'class-validator'
import type { Request } from 'express'
import { PaymentsService } from './payments.service'
import { PaystackClient } from './paystack.client'

export class ConfirmPaymentDto {
  @IsString()
  @MinLength(4)
  reference!: string
}

interface PaystackWebhookBody {
  event?: string
  data?: { reference?: string; status?: string }
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
   * Unauthenticated — no @Roles() on it — because Paystack cannot log in to us.
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
    )
    return { received: true, ...result }
  }

  /**
   * Called when the customer comes back from Paystack.
   *
   * The browser supplies only a reference, which is a public string it already
   * knows — every decision is made from a fresh server-to-Paystack verify. This
   * exists because the webhook can be late or lost, and the person standing
   * there should not have to wait on it.
   */
  @Post('confirm')
  confirm(@Body() dto: ConfirmPaymentDto) {
    return this.payments.confirm(dto.reference)
  }
}
