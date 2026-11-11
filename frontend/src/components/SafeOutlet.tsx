import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useStore } from '../state/store'
import { Button, Callout } from './ui'
import { AlertIcon } from './icons'

/**
 * Catches a page that breaks while drawing, so only that page shows a message
 * and the rest of the app (menu, header, other pages) keeps working. Without
 * this, one bad response anywhere blanked the whole app until a full reload.
 */
class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; attempt: number }> {
  state = { error: null as Error | null, attempt: 0 }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('A page failed to draw:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return <div key={this.state.attempt}>{this.props.children}</div>
    return (
      <div className="mx-auto max-w-lg py-10">
        <Callout tone="danger" title="Something went wrong on this page" icon={<AlertIcon className="size-4" />}>
          <p>The rest of the app still works. Try again, or open another page from the menu.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}>
              Try again
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload the page
            </Button>
          </div>
        </Callout>
      </div>
    )
  }
}

/**
 * The page area of every shell: a page that breaks is caught on its own, and
 * moving to another page starts that one fresh.
 */
export function SafeOutlet() {
  const { pathname } = useLocation()
  return (
    <PageErrorBoundary key={pathname}>
      <Outlet />
    </PageErrorBoundary>
  )
}

/**
 * A thin bar while the phone has no connection; when it comes back, the app
 * reads its data again by itself instead of needing a reload.
 */
export function ConnectionBar() {
  const { refresh } = useStore()
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [backAt, setBackAt] = useState<number | null>(null)

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => {
      setOffline(false)
      setBackAt(Date.now())
      void refresh().catch(() => undefined)
      // Pages that load their own data listen for this too.
      window.dispatchEvent(new Event('app:online'))
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [refresh])

  useEffect(() => {
    if (!backAt) return
    const timer = window.setTimeout(() => setBackAt(null), 3000)
    return () => window.clearTimeout(timer)
  }, [backAt])

  if (!offline && !backAt) return null
  return (
    <div
      role="status"
      className={
        'fixed inset-x-0 top-0 z-[60] px-4 py-1.5 text-center text-xs font-semibold text-white ' +
        (offline ? 'bg-slate-800' : 'bg-emerald-600')
      }
    >
      {offline ? 'You are offline. What is on screen stays; it updates when you are back online.' : 'Back online, updating.'}
    </div>
  )
}
