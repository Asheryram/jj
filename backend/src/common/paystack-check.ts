import { ConflictError } from './domain-errors'

/**
 * Before paying by hand (or cancelling) a payout or refund whose Paystack
 * transfer never got a clear answer.
 *
 * `unknown` (Paystack never replied) and `otp` (Paystack is waiting for an
 * OTP) both mean the transfer may still go out. Paying it again by hand at
 * that point pays twice, and a later Paystack success is deliberately
 * ignored once a row is settled manually, so nothing would flag it. Allowed
 * only once the admin confirms they checked Paystack's dashboard and it did
 * not go out.
 */
export function requirePaystackChecked(transferStatus: string | null, confirmed: boolean): void {
  if ((transferStatus === 'unknown' || transferStatus === 'otp') && !confirmed) {
    throw new ConflictError(
      'CHECK_PAYSTACK',
      'Paystack may still send this one. Check the transfer on their dashboard first, and only go ahead if it did not go out.',
    )
  }
}
