import { useState } from 'react'

/**
 * `useState` that remembers its value for this browser tab, so a filter or
 * search set on a page is still set on coming back to it. Session storage
 * only, per tab: it can be missing or blocked, so every read and write is
 * guarded and the page works the same without it.
 */
export function useRemembered<T extends string>(key: string, initial: T, allowed?: readonly T[]): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(`remember:${key}`) as T | null
      if (stored !== null && (!allowed || allowed.includes(stored))) return stored
    } catch {
      /* storage unavailable, use the default */
    }
    return initial
  })
  const set = (next: T) => {
    setValue(next)
    try {
      sessionStorage.setItem(`remember:${key}`, next)
    } catch {
      /* storage unavailable, the value still applies for this visit */
    }
  }
  return [value, set]
}
