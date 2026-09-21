/**
 * Curated colour choices for a shop, the fast path `ShopBranding.tsx` offers
 * before "or pick your own". Each is a single light-mode hex, `deriveBrand`
 * (see `./branding.ts`) already guarantees a readable ramp and a working dark
 * theme from one colour alone, so these carry no dark-mode partner of their
 * own, the same "off means we reuse your one colour" default a custom pick
 * gets.
 *
 * Chosen for visual distinctness from each other and from the networks and
 * banks an agent's shop must not be mistaken for (see `BrandingService`'s own
 * reasoning), not for any deeper meaning behind the names.
 */
export interface BrandTemplate {
  id: string
  label: string
  hex: string
}

export const BRAND_TEMPLATES: BrandTemplate[] = [
  { id: 'ocean', label: 'Ocean Blue', hex: '#0B3B8F' },
  { id: 'emerald', label: 'Emerald', hex: '#047857' },
  { id: 'royal', label: 'Royal Purple', hex: '#6D28D9' },
  { id: 'sunset', label: 'Sunset Orange', hex: '#C2410C' },
  { id: 'berry', label: 'Berry', hex: '#A21CAF' },
  { id: 'teal', label: 'Teal', hex: '#0F766E' },
  { id: 'crimson', label: 'Crimson', hex: '#B91C1C' },
  { id: 'charcoal', label: 'Charcoal', hex: '#334155' },
]

/** The template matching a hex exactly, so a live colour can highlight its origin. */
export function templateFor(hex: string | null): BrandTemplate | null {
  if (!hex) return null
  const normalised = hex.trim().toLowerCase()
  return BRAND_TEMPLATES.find((t) => t.hex.toLowerCase() === normalised) ?? null
}
