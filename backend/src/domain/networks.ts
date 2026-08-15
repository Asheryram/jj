import type { Network } from '@prisma/client'

/**
 * Ghana mobile prefixes, by carrier.
 *
 * Mirrored in `frontend/src/lib/networks.ts` — the two must agree, because the
 * client uses it to stop a doomed order early and the server uses it to refuse
 * one. The server is the authority; the client copy only saves a round trip.
 *
 * Two known limits, both of which cost real sales when this table is wrong:
 *
 *  · **Portability.** Ghana lets a subscriber keep their number when they change
 *    carrier, so a 020 line can genuinely be on MTN. This table cannot see that.
 *  · **New ranges.** The NCA allocates new prefixes, and one we have not heard
 *    of turns a real customer away. That is exactly what happened with 053, a
 *    live MTN range this table originally missed.
 *
 * The second is handled by treating an unknown prefix as "no information" and
 * letting the order through. The first is not handled at all: a ported number
 * whose prefix belongs to another carrier is refused. That is a deliberate
 * trade — a refused sale is recoverable, a bundle sent to the wrong network is
 * not — but it is a real cost, and DataHub's /verify cannot soften it because it
 * reports beneficiary-list membership, not which network a number is on.
 */
const PREFIXES: Record<Network, readonly string[]> = {
  MTN: ['024', '025', '053', '054', '055', '059'],
  Telecel: ['020', '050'],
  AirtelTigo: ['026', '027', '056', '057'],
}

/** The carrier a prefix belongs to, or null when we have never seen it. */
export function detectNetwork(phone: string): Network | null {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 3) return null
  const prefix = digits.slice(0, 3)
  for (const network of Object.keys(PREFIXES) as Network[]) {
    if (PREFIXES[network].includes(prefix)) return network
  }
  return null
}

/**
 * Whether this number may be sent a bundle on this network.
 *
 * `null` from `detectNetwork` means an unrecognised prefix, and that is allowed
 * through on purpose: not knowing a range is our gap, not the customer's.
 */
export function networkMismatch(
  phone: string,
  bundleNetwork: Network | null,
): { detected: Network } | null {
  if (!bundleNetwork) return null
  const detected = detectNetwork(phone)
  if (!detected || detected === bundleNetwork) return null
  return { detected }
}
