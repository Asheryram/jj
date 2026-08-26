import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'jdc.theme'

function stored(): Theme {
  try {
    return window.localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    // Private browsing can block storage — default to light, same as a first visit.
    return 'light'
  }
}

interface ThemeValue {
  theme: Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

/**
 * The chosen theme, applied as `data-theme` on `<html>` — see the
 * `@custom-variant dark` rule in index.css, which is what actually makes every
 * `dark:` utility respond to it.
 *
 * `index.html` sets the attribute once, synchronously, before this ever runs —
 * that is what stops a returning dark-mode visitor seeing a flash of light on
 * load. This provider just keeps React's idea of the theme in sync with it.
 *
 * A Context, not a bare hook: `BrandingProvider` also needs to know which theme
 * is live, to pick the light or dark brand ramp. Two independent `useState`
 * hooks would each keep their own answer, so the toggle button flipping its
 * copy would leave branding rendering the old one until something unrelated
 * happened to re-render it. One shared value avoids that entirely.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(stored)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      try {
        window.localStorage.setItem(KEY, next)
      } catch {
        // Choice just won't survive a reload — not worth failing over.
      }
      return next
    })
  }, [])

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
