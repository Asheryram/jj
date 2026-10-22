import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { LicenseService } from './license.service'

export const LICENSE_GATE_KEY = 'jdc:licenseGate'

/**
 * How a route behaves while the subscription is lapsed (and only if
 * LICENSE_ENFORCE is on).
 *
 *   always         refused outright: it brings in new business (a sign-up, a
 *                  wallet top-up).
 *   unless-wallet  refused, except an order paid from a wallet balance the
 *                  customer already holds. That money is theirs and already
 *                  collected, so spending it is never held hostage.
 *
 * Deliberately a mark on the specific routes that earn money, not a list of
 * what to allow. Everything else keeps working by default, which is the
 * property that matters: payouts, refunds, the payment callbacks that finish
 * orders already paid for, login, and data export are never in the way.
 */
export type LicenseGateKind = 'always' | 'unless-wallet'

export const LicenseGate = (kind: LicenseGateKind, message: string) => SetMetadata(LICENSE_GATE_KEY, { kind, message })

interface GateOptions {
  kind: LicenseGateKind
  message: string
}

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly license: LicenseService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const gate = this.reflector.getAllAndOverride<GateOptions | undefined>(LICENSE_GATE_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!gate) return true

    const request = context.switchToHttp().getRequest<{ body?: { payWith?: unknown }; method?: string; url?: string }>()
    const status = this.license.status()
    // A wallet order spends money the customer already paid in, so it goes through,
    // unless the owner chose the strict setting and the app is fully suspended.
    const strictNow = status.strictSuspend && status.stage === 'suspended'
    if (gate.kind === 'unless-wallet' && request.body?.payWith === 'wallet' && !strictNow) return true

    if (status.exempt) return true

    if (!status.paused) {
      // Report only: lapsed, but not enforcing. Say so quietly and let it through.
      if (!status.enforced && (status.stage === 'restricted' || status.stage === 'suspended')) {
        this.license.noteWouldBlock(`${request.method ?? ''} ${request.url ?? ''}`.trim())
      }
      return true
    }

    // The same envelope as every other error, so the front end shows the message as it is.
    throw new ServiceUnavailableException({ code: 'SERVICE_PAUSED', message: gate.message })
  }
}
