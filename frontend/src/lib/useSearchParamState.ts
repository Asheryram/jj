import { useSearchParams } from 'react-router-dom'

/**
 * A single URL search param, read and written like a piece of local state.
 *
 * Several list pages (Orders, Wallet, Earnings, Pricing) kept their filter
 * and search text in a plain `useState`, which reset to its default the
 * moment you navigated away and back, a filter chosen a minute ago looked
 * like it had never been touched. Backing it by the URL instead means the
 * back button, a bookmark, or simply returning to the tab all land you where
 * you left off, the same way `Catalogue.tsx`'s own category/network filters
 * already work.
 *
 * `{ replace: true }` on every write, so filtering as you type does not
 * flood browser history with one entry per keystroke.
 */
export function useSearchParamState(
  key: string,
  defaultValue = '',
): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? defaultValue

  const setValue = (next: string) => {
    const updated = new URLSearchParams(params)
    if (next && next !== defaultValue) updated.set(key, next)
    else updated.delete(key)
    setParams(updated, { replace: true })
  }

  return [value, setValue]
}
