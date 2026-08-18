import type { Network } from '../data/types'

export const NETWORKS: Network[] = ['MTN', 'Telecel', 'AirtelTigo']

/**
 * There is no prefix table here any more, and there should not be one.
 *
 * One used to map 024 → MTN, 020 → Telecel and so on, first to decorate the
 * recipient field and later to refuse an order whose number looked like the wrong
 * carrier. Both uses were wrong, for two reasons that cannot be engineered away:
 *
 *  · **Portability.** Ghana lets a subscriber keep their number when they change
 *    carrier, so a 020 line can genuinely be on MTN. No table can be right about
 *    that, so every "this is a Telecel number" claim was a guess presented as a
 *    fact.
 *  · **New allocations.** The NCA hands carriers new ranges, and each one we had
 *    not heard of turned a real customer away. That happened with 053, a live MTN
 *    range the table missed.
 *
 * Deliverability is now decided by the only parties who actually know: the
 * supplier, who refuses what it cannot send, and the network itself. An order
 * that cannot be delivered fails and the money goes back — which is a worse
 * outcome than a correct up-front check and a much better one than refusing
 * customers we could have served.
 *
 * The bundle already states its own network on screen, so nothing was lost by
 * removing the chip that guessed at the recipient's.
 */

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

export type PhoneCheck = { ok: true; phone: string } | { ok: false; reason: string }

/**
 * Check the shape of a Ghana mobile number. Shape only.
 *
 * Ten digits starting with a zero is the entire claim being made, because it is
 * the only claim this side can make correctly. Which carrier the number is on,
 * and whether a bundle can reach it, are questions for the supplier.
 *
 * NFR-4.3 — the reasons returned here are the exact words shown to the user.
 */
export function checkPhone(input: string): PhoneCheck {
  const phone = normalisePhone(input)
  if (!phone) return { ok: false, reason: 'Enter the number that should receive this bundle.' }
  if (phone.length < 10) return { ok: false, reason: 'A Ghana number needs 10 digits.' }
  if (phone.length > 10) return { ok: false, reason: "That's more than 10 digits — check it again." }
  return { ok: true, phone }
}

/** Pretty-print for confirmation screens: 024 411 8820 */
export function prettyPhone(phone: string): string {
  const p = normalisePhone(phone)
  if (p.length !== 10) return p
  return `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`
}
