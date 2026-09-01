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

/**
 * The reverse direction: what Paystack calls the network on a completed
 * charge — `authorization.bank` — read back into our own names.
 *
 * Money coming in uses different words than money going out: a mobile money
 * charge's authorization has reported "MTN" and "Vodafone" on this account,
 * not the transfer codes above. Matched case-insensitively against every
 * spelling seen so far; anything else comes back null rather than a guess,
 * the same rule `momoCodeFor` follows for money leaving.
 */
const BANK_NAMES: Record<string, Network> = {
  mtn: 'MTN',
  vodafone: 'Telecel',
  vod: 'Telecel',
  telecel: 'Telecel',
  airteltigo: 'AirtelTigo',
  'airtel tigo': 'AirtelTigo',
  airtel: 'AirtelTigo',
  tigo: 'AirtelTigo',
  atl: 'AirtelTigo',
}

export function networkFromPaystackBank(bank: string | null | undefined): Network | null {
  if (!bank) return null
  return BANK_NAMES[bank.trim().toLowerCase()] ?? null
}
