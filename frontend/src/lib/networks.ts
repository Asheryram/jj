import type { Network } from '../data/types'

/**
 * Prefix → network, used ONLY to show a network chip beside the input.
 *
 * Never a gate, and that is deliberate. Two things make a prefix table unable to
 * decide whether a number can receive a bundle:
 *
 *  · **Number portability.** Ghana lets a subscriber keep their number when they
 *    change carrier, so a 024 line can genuinely be on AirtelTigo. No prefix
 *    table can be right about that, ever.
 *  · **New allocations.** The NCA hands carriers new ranges, and every one we
 *    have not heard about turns a real customer away at checkout. That is what
 *    happened with 053, a live MTN range this table originally missed.
 *
 * So deliverability is answered by the people who actually deliver: DataHub's
 * /verify where it applies, and failing that the order itself, which refunds if
 * the network rejects it. This table only decorates.
 */
const NETWORK_HINTS: Record<Network, string[]> = {
  MTN: ['024', '025', '053', '054', '055', '059'],
  Telecel: ['020', '050'],
  AirtelTigo: ['026', '027', '056', '057'],
}

/** @deprecated Cosmetic only — see NETWORK_HINTS. Kept for the Settings page. */
export const NETWORK_PREFIXES = NETWORK_HINTS

export const NETWORKS: Network[] = ['MTN', 'Telecel', 'AirtelTigo']

/**
 * Network chips are deliberately neutral, identified by a small brand-accurate
 * dot beside the name rather than by a filled colour.
 *
 * The platform's own palette is Deep Blue + Golden Yellow, and both collide with
 * a carrier: our yellow is effectively MTN's, and our blue is close to
 * AirtelTigo's. If chips stayed filled, a yellow pill would read as "MTN" on a
 * page where yellow also means "press this" — so saturated fills belong to the
 * brand, and carriers keep the dot.
 */
export const NETWORK_STYLES: Record<Network, { chip: string; dot: string; label: string }> = {
  MTN: { chip: 'bg-slate-100 text-slate-700', dot: 'bg-mtn', label: 'MTN' },
  Telecel: { chip: 'bg-slate-100 text-slate-700', dot: 'bg-telecel', label: 'Telecel' },
  AirtelTigo: {
    chip: 'bg-slate-100 text-slate-700',
    dot: 'bg-airteltigo',
    label: 'AirtelTigo',
  },
}

/** Strip spaces, dashes and the +233 / 233 country prefix down to 0XXXXXXXXX. */
export function normalisePhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.startsWith('233') && digits.length >= 12) return `0${digits.slice(3)}`
  if (digits.length === 9 && !digits.startsWith('0')) return `0${digits}`
  return digits
}

export function detectNetwork(input: string): Network | null {
  const phone = normalisePhone(input)
  if (phone.length < 3) return null
  const prefix = phone.slice(0, 3)
  for (const network of NETWORKS) {
    if (NETWORK_HINTS[network].includes(prefix)) return network
  }
  return null
}

export type PhoneCheck =
  | { ok: true; phone: string; network: Network | null }
  | { ok: false; reason: string }

/**
 * Check the shape of a Ghana mobile number. Shape only.
 *
 * Ten digits starting with a zero is the entire claim being made here, because
 * it is the only claim this side can make correctly. It used to also reject an
 * unrecognised prefix, and reject a number whose prefix disagreed with the
 * bundle's network — both were wrong, and both turned away customers who could
 * have been served. See NETWORK_HINTS for why.
 *
 * `network` comes back as a hint for the chip, and is null when the prefix is
 * unfamiliar. Null means "we do not know", never "this will not work".
 *
 * NFR-4.3 — the reasons returned here are the exact words shown to the user.
 */
export function checkPhone(input: string): PhoneCheck {
  const phone = normalisePhone(input)
  if (!phone) return { ok: false, reason: 'Enter the number that should receive this bundle.' }
  if (phone.length < 10) return { ok: false, reason: 'A Ghana number needs 10 digits.' }
  if (phone.length > 10) return { ok: false, reason: "That's more than 10 digits — check it again." }
  return { ok: true, phone, network: detectNetwork(phone) }
}

/** Pretty-print for confirmation screens: 024 411 8820 */
export function prettyPhone(phone: string): string {
  const p = normalisePhone(phone)
  if (p.length !== 10) return p
  return `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`
}
