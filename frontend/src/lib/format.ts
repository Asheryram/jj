import type { Pesewas } from '../data/types'

/**
 * Money formatting. Input is always integer pesewas — see data/types.ts.
 * Never do arithmetic on the formatted string.
 */
export function cedis(amount: Pesewas, opts: { sign?: boolean } = {}): string {
  const negative = amount < 0
  const abs = Math.abs(amount)
  const body = (abs / 100).toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const prefix = negative ? '−' : opts.sign ? '+' : ''
  return `${prefix}GHS ${body}`
}

/** Compact form for stat tiles: GHS 3.2k, GHS 1.4M. */
export function cedisCompact(amount: Pesewas): string {
  const value = amount / 100
  if (Math.abs(value) >= 1_000_000) return `GHS ${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `GHS ${(value / 1_000).toFixed(1)}k`
  return `GHS ${value.toFixed(2)}`
}

/** Parse a user-typed cedi amount ("12.50") into pesewas. Returns null if invalid. */
export function parseCedis(input: string): Pesewas | null {
  const trimmed = input.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null
  return Math.round(Number.parseFloat(trimmed) * 100)
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export function shortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function dateTime(iso: string): string {
  const d = new Date(iso)
  const hours = d.getHours()
  const minutes = d.getMinutes().toString().padStart(2, '0')
  const suffix = hours >= 12 ? 'pm' : 'am'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${shortDate(iso)}, ${hour12}:${minutes}${suffix}`
}

export function longDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** Mask the middle of a phone number for display in shared/admin contexts. */
export function maskPhone(phone: string): string {
  if (phone.length < 7) return phone
  return `${phone.slice(0, 4)}•••${phone.slice(-3)}`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
