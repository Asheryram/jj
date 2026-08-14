/**
 * The origin to build shareable links from.
 *
 * `window.location.origin` rather than a hardcoded domain, because an agent's
 * sell link is the thing they actually send to customers — and during testing
 * the app is reached over localhost, a LAN address or an ngrok tunnel, none of
 * which is the production domain. A link nobody can open is a broken feature,
 * not a cosmetic detail.
 *
 * `VITE_SITE_ORIGIN` overrides it, for the case where the app is served on an
 * internal host but links must point at the public one.
 */
export const SITE_ORIGIN: string =
  (import.meta.env.VITE_SITE_ORIGIN as string | undefined)?.replace(/\/$/, '') ||
  (typeof window !== 'undefined' ? window.location.origin : 'https://jamesdataconsult.com')

/** An agent's storefront link (FR-5.7). */
export function sellLinkFor(referralCode: string): string {
  return `${SITE_ORIGIN}/s/${referralCode}`
}

/** A sign-up link that pre-fills the inviter's code (FR-1.2). */
export function referralLinkFor(referralCode: string): string {
  return `${SITE_ORIGIN}/register?ref=${referralCode}`
}
