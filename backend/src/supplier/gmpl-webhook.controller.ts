import { createHmac, timingSafeEqual } from 'node:crypto'
import { Body, Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiExcludeController } from '@nestjs/swagger'
import type { Request } from 'express'
import { PrismaService } from '../prisma/prisma.service'
import { FulfilmentService } from '../orders/fulfilment.service'

interface GmplWebhookBody {
  id?: string
  type?: string
  created_at?: string
  data?: {
    order_id?: string
    reference?: string
    reference_code?: string
    status?: string
    network?: string
    amount?: string | number
    error_message?: string
    [k: string]: unknown
  }
}

/**
 * Header format `t=<unix-seconds>,v1=<hex hmac-sha256>`, verified over
 * `${t}.${rawBody}` (not the body alone, binding the signature to the
 * timestamp is what makes the 300s freshness check below mean anything;
 * without it a captured signature would stay valid forever), keyed by the
 * `whsec_…` secret from registering the subscription. Same constant-time
 * comparison reasoning as `PaystackClient.signatureValid`.
 */
export function gmplSignatureValid(
  rawBody: Buffer | string | undefined,
  header: string | undefined,
  secret: string | null,
): boolean {
  if (!secret || !header || !rawBody) return false

  const parts = Object.fromEntries(
    header.split(',').map((part) => part.split('=') as [string, string]),
  )
  const timestamp = Number(parts.t)
  if (!Number.isFinite(timestamp) || !parts.v1) return false
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false

  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(parts.v1, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Receives GMPL's event callbacks (`order.*`, `purchase.*`).
 *
 * Unlike DataHub's, this webhook IS properly signed: `X-Telecom-Signature`,
 * verified above against the raw body, so there is no path-secret workaround
 * needed here, see `DatahubWebhookController`'s own header for why that one
 * needs it. Answering 200 to a bad signature is deliberate, same reasoning as
 * `PaymentsController.webhook`: nothing is done with the request either way,
 * and a non-2xx would only earn a forger unlimited retries.
 *
 * Two different ids resolve an order, because GMPL's own event schema uses
 * two different ones: `order.*` events carry their `publicId` (this
 * platform's `providerReference`), `purchase.success`/`purchase.failed`
 * carry their internal order id instead (`Order.gmplInternalOrderId`). See
 * `GmplClient`'s own file header.
 *
 * Excluded from Swagger: publishing the shape of an unauthenticated write
 * endpoint helps nobody but an attacker.
 */
@ApiExcludeController()
@Controller('webhooks/gmpl')
export class GmplWebhookController {
  private readonly log = new Logger('GmplWebhook')

  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfilment: FulfilmentService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-telecom-signature') signature: string | undefined,
    @Body() body: GmplWebhookBody,
  ) {
    const secret = this.config.get<string>('GMPL_WEBHOOK_SECRET') ?? null
    if (!gmplSignatureValid(request.rawBody, signature, secret)) {
      this.log.warn('rejected a webhook with a bad or missing signature')
      return { received: true, applied: false, reason: 'bad signature' }
    }

    const { type, data } = body
    if (!type || !data) {
      this.log.warn(`webhook with no type or data: ${JSON.stringify(body).slice(0, 200)}`)
      return { received: true, applied: false, reason: 'missing type or data' }
    }

    if (type.startsWith('order.')) {
      const reference = data.order_id
      if (!reference) return { received: true, applied: false, reason: 'missing order_id' }

      const order = await this.prisma.order.findUnique({ where: { providerReference: reference } })
      if (!order) {
        this.log.warn(`webhook for unknown provider reference ${reference}`)
        return { received: true, applied: false, reason: 'unknown reference' }
      }

      // Their vocabulary, logged verbatim, so an unexpected value of theirs
      // is visible rather than being coerced into ours and lost.
      await this.prisma.supplierDispatch.updateMany({
        where: { orderId: order.id, providerReference: reference },
        data: { providerStatus: data.status ?? type },
      })

      /**
       * `order.approved` = every recipient delivered, which for a single
       * order (this integration never places a bulk one, see
       * `GmplClient`/`GmplSource`) means the one and only recipient, so this
       * is genuinely terminal, the same weight `purchase.success` carries on
       * the auto-fulfilment path. `order.partially_approved` is their
       * bulk-batch outcome ("some delivered, the rest refunded") and isn't
       * meaningful for a single-recipient order at all, left non-terminal
       * rather than guessed at. `order.received`/`order.processing` are
       * mid-flight, logged and left alone.
       */
      if (type !== 'order.approved' && type !== 'order.rejected') {
        this.log.log(`${order.reference}: webhook reported ${type}, not terminal yet`)
        return { received: true, applied: false, reason: `not terminal (${type})` }
      }

      const outcome = type === 'order.approved' ? 'delivered' : 'rejected'
      const result = await this.fulfilment.settleFromProvider(order.id, outcome, `GMPL reported ${type}`)
      if (!result.applied) {
        return {
          received: true,
          applied: false,
          reason: result.conflict ? 'conflicts with an earlier settlement, flagged for review' : 'already settled',
        }
      }
      this.log.log(`${order.reference} → ${outcome} (GMPL reported ${type})`)
      return { received: true, applied: true, status: outcome }
    }

    if (type === 'purchase.success' || type === 'purchase.failed') {
      const reference = data.order_id
      if (!reference) return { received: true, applied: false, reason: 'missing order_id' }

      const order = await this.prisma.order.findUnique({ where: { gmplInternalOrderId: reference } })
      if (!order) {
        this.log.warn(`webhook for unknown gmpl internal order id ${reference}`)
        return { received: true, applied: false, reason: 'unknown reference' }
      }

      const outcome = type === 'purchase.success' ? 'delivered' : 'rejected'
      const reason = `GMPL reported ${type}${data.error_message ? `: ${data.error_message}` : ''}`
      const result = await this.fulfilment.settleFromProvider(order.id, outcome, reason)

      if (!result.applied) {
        return {
          received: true,
          applied: false,
          reason: result.conflict ? 'conflicts with an earlier settlement, flagged for review' : 'already settled',
        }
      }
      this.log.log(`${order.reference} → ${outcome} (GMPL reported ${type})`)
      return { received: true, applied: true, status: outcome }
    }

    // wallet.updated etc: wallet monitoring is out of scope this pass.
    return { received: true, applied: false, reason: `ignored (${type})` }
  }
}
