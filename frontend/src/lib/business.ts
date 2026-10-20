/**
 * Who is behind the site, for the legal pages and the footer.
 *
 * Read from the environment, never typed in here: a registered name, address or
 * phone number that is wrong on a legal page is worse than one that is missing,
 * and none of these are facts the code can know. Anything unset is simply left
 * out of the page, nothing is invented to fill the gap.
 *
 * Build time, like every other VITE_ variable: change it, then redeploy.
 */
const read = (value: string | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export const BUSINESS = {
  /** The name the business is registered under, if it differs from the trading name. */
  legalName: read(import.meta.env.VITE_BUSINESS_LEGAL_NAME),
  registrationNumber: read(import.meta.env.VITE_BUSINESS_REGISTRATION_NUMBER),
  address: read(import.meta.env.VITE_BUSINESS_ADDRESS),
  email: read(import.meta.env.VITE_BUSINESS_EMAIL),
  phone: read(import.meta.env.VITE_BUSINESS_PHONE),
  /** Last time the legal pages were reviewed, shown on each of them. */
  legalUpdated: read(import.meta.env.VITE_LEGAL_UPDATED) ?? 'October 2026',
}

export const TRADING_NAME = 'JKBK DATA HUB'

/** A mailto link that opens a pre-filled request, or null when no contact email is configured. */
export function mailtoLink(subject: string, body: string): string | null {
  if (!BUSINESS.email) return null
  return `mailto:${BUSINESS.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
