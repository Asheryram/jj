import type { Network } from '../data/types'

/**
 * FR-4.2 — validate the recipient number and detect its network.
 *
 * The prefix table is DATA, not logic (NFR-5.1). In production this comes from
 * the API so James can add a newly allocated prefix without a deployment.
 * Confirm current allocations with the NCA before launch.
 */
export const NETWORK_PREFIXES: Record<Network, string[]> = {
  MTN: ['024', '025', '054', '055', '059'],
  Telecel: ['020', '050'],
  AirtelTigo: ['026', '027', '056', '057'],
}

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
    if (NETWORK_PREFIXES[network].includes(prefix)) return network
  }
  return null
}

export type PhoneCheck =
  | { ok: true; phone: string; network: Network }
  | { ok: false; reason: string }

/**
 * NFR-4.3 — the reasons returned here are the exact words shown to the user.
 * No error codes, no "validation failed".
 */
export function checkPhone(input: string, expected?: Network | null): PhoneCheck {
  const phone = normalisePhone(input)
  if (!phone) return { ok: false, reason: 'Enter the number that should receive this bundle.' }
  if (phone.length < 10) return { ok: false, reason: 'A Ghana number needs 10 digits.' }
  if (phone.length > 10) return { ok: false, reason: "That's more than 10 digits — check it again." }
  const network = detectNetwork(phone)
  if (!network) {
    return { ok: false, reason: `${phone.slice(0, 3)} isn't a network we recognise.` }
  }
  if (expected && network !== expected) {
    return {
      ok: false,
      reason: `That's a ${network} number, but you selected a ${expected} bundle.`,
    }
  }
  return { ok: true, phone, network }
}

/** Pretty-print for confirmation screens: 024 411 8820 */
export function prettyPhone(phone: string): string {
  const p = normalisePhone(phone)
  if (p.length !== 10) return p
  return `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`
}
