import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type PublicLicenseStatus } from '../lib/api'

type Level = PublicLicenseStatus['level']

interface LicenseContextValue {
  /** `ok` unless selling is paused. `restricted` pauses buying and sign-ups; `suspended` pauses the public shop. */
  level: Level
  /** While paused: what the business wants the public told (may be empty). */
  notice: string
  /** Selling pauses within a day; only ever true if the owner chose to warn agents. */
  pausesSoon: boolean
  refresh: () => void
}

const LicenseContext = createContext<LicenseContextValue>({ level: 'ok', notice: '', pausesSoon: false, refresh: () => undefined })

/** How the front end learns, without being signed in, whether selling is paused. */
const POLL_MS = 5 * 60_000

/**
 * Whether the shop is currently selling.
 *
 * Asked once on load, again when the tab regains focus, every few minutes, and
 * straight away whenever the API refuses something because selling is paused
 * (see `request` in lib/api.ts), so the page changes the moment it is true.
 *
 * Anything that goes wrong asking leaves the answer as `ok`. A shop that cannot
 * find out whether it is paused carries on selling: the API enforces the real
 * rule, and this only decides what to show.
 */
export function LicenseProvider({ children }: { children: ReactNode }) {
  const [level, setLevel] = useState<Level>('ok')
  const [notice, setNotice] = useState('')
  const [pausesSoon, setPausesSoon] = useState(false)

  const load = useCallback(async () => {
    try {
      const status = await api.licenseStatus()
      setLevel(status.level)
      setNotice(status.notice ?? '')
      setPausesSoon(status.pausesSoon === true)
    } catch {
      // Unknown means carry on.
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    const refresh = () => void load()
    window.addEventListener('focus', refresh)
    window.addEventListener('license:refresh', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('license:refresh', refresh)
    }
  }, [load])

  const value = useMemo(() => ({ level, notice, pausesSoon, refresh: () => void load() }), [level, notice, pausesSoon, load])
  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>
}

export function useLicense(): LicenseContextValue {
  return useContext(LicenseContext)
}
