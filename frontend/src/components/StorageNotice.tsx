import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useShopPath } from '../lib/shopPath'
import { Button } from './ui'

/** localStorage key remembering that the notice was read, so it shows once per device. */
const SEEN_KEY = 'jdc.storageNoticeSeen'

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * A one-time notice about what this site keeps on the device.
 *
 * Deliberately not a consent banner with an "accept all / reject all" choice:
 * the site only stores what it needs to work (sign-in, the shop link, the theme,
 * see `CookiePolicy` in `pages/Legal.tsx`), no analytics or advertising, so there
 * is nothing optional to ask permission for and a fake choice would mislead. If
 * anything non-essential is ever added, this is where the real choice goes.
 */
export default function StorageNotice() {
  const shopPath = useShopPath()
  const [visible, setVisible] = useState(() => !alreadySeen())

  if (!visible) return null

  const dismiss = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* private mode: it simply shows again next visit */
    }
    setVisible(false)
  }

  return (
    <div
      role="region"
      aria-label="Cookies and storage"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This site only stores what it needs to work, such as keeping you signed in and
          remembering your theme. No advertising or tracking.{' '}
          <Link
            to={shopPath('/cookies')}
            className="font-semibold text-brand-700 dark:text-brand-300 underline"
          >
            See exactly what
          </Link>
          .
        </p>
        <Button size="sm" onClick={dismiss} className="shrink-0">
          Got it
        </Button>
      </div>
    </div>
  )
}
