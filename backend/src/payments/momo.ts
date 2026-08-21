import type { Network } from '@prisma/client'

/**
 * Our network names, as Paystack's Mobile Money bank codes.
 *
 * From `GET /bank?currency=GHS&type=mobile_money`, which returns MTN, VOD and
 * ATL. Two things make this worth stating in one place rather than inline:
 *
 *  · **Telecel is still VOD.** They renamed from Vodafone; Paystack did not. A
 *    reasonable guess of `TEL` fails every Telecel payout with an error that
 *    says nothing about why.
 *  · **It is used for money going out** — agent payouts and customer refunds —
 *    so a wrong code is a payment that bounces or, worse, one that lands on the
 *    wrong rail.
 */
const MOMO_CODES: Record<Network, string> = {
  MTN: 'MTN',
  Telecel: 'VOD',
  AirtelTigo: 'ATL',
}

export function momoCodeFor(network: Network | null | undefined): string | null {
  return network ? (MOMO_CODES[network] ?? null) : null
}
