import { useCallback } from 'react'
import { useStore } from '../state/store'

/**
 * Prefix a public shop path with the active sell link.
 *
 * While a buyer is in an agent's shop, every link inside it has to stay inside
 * it — `/s/KWAME77/shop`, not `/shop`. Two reasons, and the second is the one
 * that matters:
 *
 *  1. The URL says whose shop you are in, so it survives being copied, shared,
 *     or bookmarked. A buyer who sends `/shop` to a friend sends them to the
 *     platform; `/s/KWAME77/shop` sends them to Kwame.
 *  2. It stops the platform quietly poaching a customer the agent brought in. If
 *     the nav walked buyers back to unattributed pages, agents would find their
 *     links stopped converting and stop sharing them.
 *
 * With no sell link in force the paths are returned untouched, so the platform's
 * own shop keeps clean URLs.
 */
export function useShopPath(): (path: string) => string {
  const { sellerCode } = useStore()

  return useCallback(
    (path: string) => {
      if (!sellerCode) return path
      // `/` is the shop's front door, which under a sell link is `/s/CODE` itself
      // — not `/s/CODE/`, which would render as a trailing-slash duplicate.
      if (path === '/') return `/s/${sellerCode}`
      return `/s/${sellerCode}${path.startsWith('/') ? path : `/${path}`}`
    },
    [sellerCode],
  )
}

/**
 * The sign-up path, carrying the current sell link as the referrer.
 *
 * The "Become an agent" call to action appears on an agent's own storefront, so
 * whoever it converts arrived on that agent's traffic. Sending them to a bare
 * `/register` would hand the recruit to the platform and credit nobody — the same
 * leak as an unscoped shop link, just on the recruiting side instead of the
 * selling side.
 *
 * The field stays editable on the form (FR-1.2), so a visitor can still clear or
 * change it.
 */
export function useRegisterPath(): string {
  const { sellerCode } = useStore()
  return sellerCode ? `/register?ref=${sellerCode}` : '/register'
}

/**
 * The same rule, for the handful of places that already know the code and are
 * outside a component — building an agent's own shareable link, for instance.
 */
export function shopPathFor(sellerCode: string | null, path: string): string {
  if (!sellerCode) return path
  if (path === '/') return `/s/${sellerCode}`
  return `/s/${sellerCode}${path.startsWith('/') ? path : `/${path}`}`
}
