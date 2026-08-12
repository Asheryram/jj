import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Per-route <title>, meta description and robots directive.
 *
 * A single-page app keeps the document title from the initial HTML unless
 * something updates it, which hurts twice: search engines and shared links see
 * one title for every page, and screen readers announce nothing on navigation
 * because the document never appears to change. This fixes both from one place.
 */
interface Meta {
  title: string
  description: string
  /** Signed-in surfaces should never be indexed. */
  noindex?: boolean
}

const SITE = 'JamesDataConsult'

/**
 * The canonical origin is the production domain, never `window.location.origin`.
 * Otherwise a demo served through an ngrok tunnel would tell crawlers the tunnel
 * is the canonical home of every page.
 */
const SITE_ORIGIN = import.meta.env.VITE_SITE_ORIGIN ?? 'https://jamesdataconsult.com'

const ROUTES: { match: (path: string) => boolean; meta: Meta }[] = [
  {
    match: (p) => p === '/',
    meta: {
      title: `Buy Data Bundles, Airtime & Result Checkers in Ghana | ${SITE}`,
      description:
        'Buy MTN, Telecel and AirtelTigo data bundles, airtime, voice and SMS bundles, MTN AFA registration and BECE/WASSCE result checkers. Pay with Mobile Money — no account needed, delivered in seconds.',
    },
  },
  {
    match: (p) => p === '/shop',
    meta: {
      title: `Data Bundles, Airtime, Voice & SMS Prices | ${SITE}`,
      description:
        'Compare non-expiry data bundles, airtime and voice or SMS packs across MTN, Telecel and AirtelTigo. Prices shown up front, paid by Mobile Money.',
    },
  },
  {
    match: (p) => p === '/checkers',
    meta: {
      title: `BECE & WASSCE Result Checker Vouchers | ${SITE}`,
      description:
        'Buy a BECE or WASSCE result checker voucher and get the serial number and PIN instantly on screen and by SMS. Independent reseller, not affiliated with WAEC.',
    },
  },
  {
    match: (p) => p === '/track',
    meta: {
      title: `Track Your Order | ${SITE}`,
      description:
        'Check the status of a data bundle, airtime or result checker order using your reference and phone number. No account required.',
    },
  },
  {
    match: (p) => p === '/register',
    meta: {
      title: `Become a Data Reseller Agent in Ghana | ${SITE}`,
      description:
        'Sign up as a JamesDataConsult agent, set your own resale prices, share your shop link and keep the margin on every sale. No float to fund, no stock to carry.',
    },
  },
  {
    match: (p) => p === '/login',
    meta: {
      title: `Agent Log In | ${SITE}`,
      description: 'Log in to your JamesDataConsult agent or admin account.',
      noindex: true,
    },
  },
  {
    match: (p) => p.startsWith('/s/'),
    meta: {
      title: `Buy From an Authorised Agent | ${SITE}`,
      description:
        'Buy data bundles, airtime and result checkers directly from an authorised JamesDataConsult agent. Pay with Mobile Money, delivered in seconds.',
    },
  },
  {
    match: (p) => p.startsWith('/buy/'),
    meta: {
      title: `Checkout | ${SITE}`,
      description: 'Confirm the recipient number and pay with Mobile Money.',
      noindex: true,
    },
  },
  {
    match: (p) => p.startsWith('/admin'),
    meta: {
      title: `Admin | ${SITE}`,
      description: 'Platform administration.',
      noindex: true,
    },
  },
  {
    match: (p) => p.startsWith('/app'),
    meta: {
      title: `My Account | ${SITE}`,
      description: 'Your orders, earnings and prices.',
      noindex: true,
    },
  },
]

const FALLBACK: Meta = {
  title: `${SITE} — Data Bundles, Airtime & Result Checkers`,
  description:
    'Buy data bundles, airtime and BECE/WASSCE result checkers in Ghana. Paid by Mobile Money, delivered in seconds.',
}

function setMetaTag(selector: string, attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

export default function RouteMeta() {
  const { pathname } = useLocation()
  const [announcement, setAnnouncement] = useState('')
  const isFirstRender = useRef(true)

  useEffect(() => {
    const meta = ROUTES.find((route) => route.match(pathname))?.meta ?? FALLBACK

    document.title = meta.title
    setMetaTag('meta[name="description"]', 'name', 'description', meta.description)
    setMetaTag('meta[property="og:title"]', 'property', 'og:title', meta.title)
    setMetaTag('meta[property="og:description"]', 'property', 'og:description', meta.description)
    setMetaTag(
      'meta[name="robots"]',
      'name',
      'robots',
      meta.noindex ? 'noindex, nofollow' : 'index, follow',
    )

    // Keep the canonical honest so query strings do not fragment indexing.
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = `${SITE_ORIGIN}${pathname}`
    setMetaTag('meta[property="og:url"]', 'property', 'og:url', canonical.href)

    // Announce the new page. Skipped on first paint, where the screen reader is
    // already reading the document title.
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    setAnnouncement(meta.title.split('|')[0].trim())
  }, [pathname])

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement && `${announcement} — page loaded`}
    </div>
  )
}
