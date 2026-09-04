import type { Pesewas } from '../data/types'

/**
 * Shown instead of a number that is not a number.
 *
 * An em dash, not `GHS 0.00`. A zero is a claim — it says the margin really is
 * nothing, or nobody has been paid — and if the value is actually unknown that
 * claim is false. This says "no figure" and is the one honest thing to print
 * when the input is not a number.
 */
const NO_VALUE = '—'

/**
 * Money formatting. Input is always integer pesewas — see data/types.ts.
 * Never do arithmetic on the formatted string.
 *
 * Guards against a non-finite input rather than trusting every caller. An
 * average over an empty list is `0 / 0`, a missing field is `undefined`, and
 * both used to arrive here and render as the literal text `GHS NaN` on a stat
 * tile. The arithmetic that produced it is still a bug worth fixing at the
 * source; this stops it reaching whoever is reading the screen.
 */
export function cedis(amount: Pesewas, opts: { sign?: boolean } = {}): string {
  if (!Number.isFinite(amount)) return NO_VALUE
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
  if (!Number.isFinite(amount)) return NO_VALUE
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

/**
 * Parse a timestamp, or admit that it could not be parsed.
 *
 * Two failures, and the second is the dangerous one.
 *
 * `new Date('')` is an Invalid Date whose every getter is NaN, and
 * `MONTHS[NaN]` is `undefined` — so a missing timestamp used to render as the
 * literal text `NaN undefined, NaN:NaNam`.
 *
 * But `new Date(null)` is not invalid at all: it is midnight on 1 January 1970.
 * A null timestamp would have quietly displayed as `1 Jan, 12:00am`, which is
 * far worse than NaN — NaN is visibly broken, whereas a wrong date looks like a
 * fact and would be read as one. So the input is checked before it is parsed,
 * not just the result afterwards.
 *
 * Types stop a nullable field being passed here, but they cannot stop the API
 * sending a null where it promised a string, and that is exactly when this runs.
 */
function parsed(iso: string): Date | null {
  if (typeof iso !== 'string' || iso.trim() === '') return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export function shortDate(iso: string): string {
  const d = parsed(iso)
  if (!d) return NO_VALUE
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function dateTime(iso: string): string {
  const d = parsed(iso)
  if (!d) return NO_VALUE
  const hours = d.getHours()
  const minutes = d.getMinutes().toString().padStart(2, '0')
  const suffix = hours >= 12 ? 'pm' : 'am'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${shortDate(iso)}, ${hour12}:${minutes}${suffix}`
}

export function longDate(iso: string): string {
  const d = parsed(iso)
  if (!d) return NO_VALUE
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * A trend fragment for a stat tile's hint — "+18% vs last period" or similar.
 *
 * Silent (returns null) when the prior period was zero: a jump from GHS 0 to
 * anything is not a percentage, it is the first sale of the period, and
 * "+∞%"/"—" both read as a bug rather than good news.
 */
export function trendText(thisPeriod: number, lastPeriod: number, label: string): string | null {
  if (lastPeriod === 0) return null
  const change = ((thisPeriod - lastPeriod) / lastPeriod) * 100
  const sign = change >= 0 ? '+' : ''
  return `${sign}${change.toFixed(0)}% vs ${label}`
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
