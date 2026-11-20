import type { BillingInterval } from '@prisma/client'

/**
 * The cycle a Paystack renewal payment buys, see `applyRenewalPaid`: from when
 * it was paid, or, when the domain is already paid up past that moment (a
 * second payment, or the balance sweep got there first), from the end of the
 * cycle it already has, so the payment buys a cycle rather than nothing.
 */
export function renewalPeriodFor(
  domain: { active: boolean; graceEndsAt: Date | null; nextRenewalAt: Date | null; billingInterval: BillingInterval },
  paidAt: Date,
): { periodStart: Date; periodEnd: Date; alreadyPaidUp: boolean } {
  const paidUpUntil =
    domain.active && !domain.graceEndsAt && domain.nextRenewalAt && domain.nextRenewalAt > paidAt
      ? domain.nextRenewalAt
      : null
  const periodStart = paidUpUntil ?? paidAt
  return { periodStart, periodEnd: addInterval(periodStart, domain.billingInterval), alreadyPaidUp: paidUpUntil !== null }
}

/** A billing cycle's length from its start, calendar-aware (a month is not always 30 days). */
export function addInterval(from: Date, interval: BillingInterval): Date {
  const next = new Date(from)
  if (interval === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1)
  else next.setUTCFullYear(next.getUTCFullYear() + 1)
  return next
}
