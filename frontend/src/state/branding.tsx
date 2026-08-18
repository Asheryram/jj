import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type PublicBranding } from '../lib/api'
import { deriveBrand } from '../lib/branding'

/**
 * The shop's identity — its name, mark and colour — applied at runtime.
 *
 * ── Why this can be done at all ──────────────────────────────────────────────
 *
 * Tailwind v4 compiles `bg-brand-700` to `background-color: var(--color-brand-700)`
 * and declares the variable once at `:root`. So re-theming the entire product is
 * a matter of writing ten custom properties — no per-agent stylesheet, no
 * rebuild, no flash of the wrong brand beyond the first paint.
 *
 * ── What it does not touch ───────────────────────────────────────────────────
 *
 * Only the brand ramp. The accent yellow, the network dots and every semantic
 * colour (red for danger, emerald for success) stay put on purpose: an agent
 * choosing a red brand must not turn every error message into their brand
 * colour, and a customer needs "failed" to look like failure whoever's shop they
 * are in.
 *
 * ── Honest limits, worth knowing before promising a white label ───────────────
 *
 * The Paystack checkout page and the customer's bank statement show the
 * platform's registered business name, not the agent's, because there is one
 * merchant account behind every shop. SMS and receipts are the platform's too.
 * A shop can look like an agent's right up to the moment money moves.
 */
const DEFAULT: PublicBranding = {
  shopName: 'JamesDataConsult',
  brandColor: '#0B3B8F',
  ramp: deriveBrand('#0B3B8F')!.ramp,
  logoUrl: null,
  custom: false,
}

const BrandingContext = createContext<PublicBranding>(DEFAULT)

export function useBranding(): PublicBranding {
  return useContext(BrandingContext)
}

/**
 * Fetches the branding for whichever shop is being viewed and writes its ramp
 * onto the document.
 *
 * `sellerCode` comes from the store, which reads it from the `/s/<code>` route —
 * so an agent's link themes the pages, and the platform's own pages do not.
 */
export function BrandingProvider({
  sellerCode,
  children,
}: {
  sellerCode: string | null
  children: ReactNode
}) {
  const [branding, setBranding] = useState<PublicBranding>(DEFAULT)

  useEffect(() => {
    let live = true

    // Back to the platform's look straight away, before asking the server whose
    // shop this is. Without this, leaving an agent's shop kept their colours on
    // screen for as long as the request took — which on a slow connection is long
    // enough to read, and looks like the admin pages belong to the agent.
    setBranding(DEFAULT)

    api
      .branding(sellerCode)
      .then((result) => {
        if (live) setBranding(result)
      })
      // A shop that cannot read its branding still has to sell. The default is a
      // complete, working theme, so failing quietly here is the right call —
      // an error banner about a colour would be noise on a checkout page.
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [sellerCode])

  useEffect(() => {
    const root = document.documentElement
    for (const [step, hex] of Object.entries(branding.ramp)) {
      root.style.setProperty(`--color-brand-${step}`, hex)
    }
    // The tab title and the browser theme colour are part of the shop's identity
    // too, and the second one is what a phone paints around the page.
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', branding.ramp[700])

    return () => {
      // Cleared rather than left behind: navigating from an agent's shop to the
      // platform's own pages must not keep the agent's colour.
      for (const step of Object.keys(branding.ramp)) {
        root.style.removeProperty(`--color-brand-${step}`)
      }
    }
  }, [branding])

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>
}
