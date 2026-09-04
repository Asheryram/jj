import { Body, Controller, Logger, Param, Post } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiExcludeController } from '@nestjs/swagger'
import { PrismaService } from '../prisma/prisma.service'
import { FulfilmentService } from '../orders/fulfilment.service'
import { NotFoundError } from '../common/domain-errors'
import { mapProviderStatus } from './datahub.client'

interface DatahubWebhookBody {
  event?: string
  timestamp?: string
  data?: {
    orderNumber?: number
    reference?: string
    network?: string
    phoneNumber?: string
    bundleSize?: string
    amountPaid?: number
    status?: string
    previousStatus?: string
    createdAt?: string
  }
}

/**
 * Receives DataHub GH's `order.status_updated` callback.
 *
 * ── The security problem, and what is done about it ─────────────────────────
 *
 * Their webhook is **unauthenticated**. There is no signature and no shared
 * secret; their own guidance is to "validate the User-Agent header", which is a
 * single forgeable string and not a control at all. Anyone who learns this URL
 * could otherwise mark orders SUCCESSFUL — and in this system that completes an
 * order and credits an agent, so it is a direct route to manufactured earnings.
 *
 * Three things stand in for the signature they do not send:
 *
 *  1. **The path carries a secret.** `DATAHUB_WEBHOOK_SECRET` is a random string
 *     in the URL registered with them. Unguessable, and the only thing an
 *     attacker would have to obtain. Compared in constant time.
 *  2. **The reference must already exist here**, attached to an order we placed.
 *     A forged callback for an invented reference matches nothing.
 *  3. **Only non-terminal orders move.** A replayed or duplicated callback for a
 *     settled order is a no-op, which their docs explicitly warn to expect.
 *
 * It is defence in depth around a provider weakness, not a substitute for a
 * signature — worth asking DataHub to add HMAC signing.
 *
 * Excluded from Swagger: publishing the shape of an unauthenticated write
 * endpoint helps nobody but an attacker.
 */
@ApiExcludeController()
@Controller('webhooks/datahub')
export class DatahubWebhookController {
  private readonly log = new Logger('DatahubWebhook')

  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfilment: FulfilmentService,
    private readonly config: ConfigService,
  ) {}

  @Post(':secret')
  async receive(@Param('secret') secret: string, @Body() body: DatahubWebhookBody) {
    const expected = this.config.get<string>('DATAHUB_WEBHOOK_SECRET')

    if (!expected || !safeEqual(secret, expected)) {
      // Deliberately vague and 404-shaped: an attacker probing for the right
      // path learns nothing about whether the endpoint exists.
      this.log.warn('rejected a webhook with a bad secret path')
      throw new NotFoundError('Not found.')
    }

    const reference = body.data?.reference
    const status = body.data?.status
    if (!reference || !status) {
      this.log.warn(`webhook with no reference or status: ${JSON.stringify(body).slice(0, 200)}`)
      return { received: true, applied: false, reason: 'missing reference or status' }
    }

    const order = await this.prisma.order.findUnique({ where: { providerReference: reference } })
    if (!order) {
      this.log.warn(`webhook for unknown provider reference ${reference}`)
      return { received: true, applied: false, reason: 'unknown reference' }
    }

    // Their vocabulary, logged verbatim, so an unexpected value of theirs is
    // visible rather than being coerced into ours and lost.
    await this.prisma.supplierDispatch.updateMany({
      where: { orderId: order.id, providerReference: reference },
      data: { providerStatus: status },
    })

    const mapped = mapProviderStatus(status)
    if (mapped === null) {
      // Still in flight on their side. Nothing to do but wait.
      return { received: true, applied: false, reason: `not terminal (${status})` }
    }

    /**
     * Deliberately not short-circuited on `order.status` here any more.
     *
     * A terminal order used to return early right above this comment, before
     * ever calling `settleFromProvider` — "expected, not exceptional, they
     * warn that duplicates happen" was true for a genuine replay, but the
     * same early return also silently swallowed the one case that matters: a
     * webhook reporting SUCCESSFUL for an order this platform had already
     * closed out as rejected (a stuck `manual_` reference resolved by hand,
     * say). That customer would then hold both a refund and a delivered
     * bundle, with literally nothing in the logs to ever find out from.
     *
     * `settle()` is the single funnel every settlement source goes through,
     * and it already tells a boring exact-replay apart from a genuine
     * conflict — see `FulfilmentService.flagConflict`. So the right amount of
     * short-circuiting here is none: let it decide, every time.
     */
    const result = await this.fulfilment.settleFromProvider(
      order.id,
      mapped === 'completed' ? 'delivered' : 'rejected',
      `DataHub GH reported ${status}`,
    )

    if (!result.applied) {
      return {
        received: true,
        applied: false,
        reason: result.conflict ? 'conflicts with an earlier settlement — flagged for review' : 'already settled',
      }
    }

    this.log.log(`${order.reference} → ${mapped} (DataHub said ${status})`)
    // 2xx within 10 seconds, as their requirements demand, or they retry.
    return { received: true, applied: true, status: mapped }
  }
}

/**
 * Constant-time comparison, so response timing cannot be used to discover the
 * secret one character at a time.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
