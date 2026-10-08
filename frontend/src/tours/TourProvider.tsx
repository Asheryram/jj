import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, cn } from '../components/ui'
import { useStore } from '../state/store'
import { ALL_TOURS } from './index'
import type { Tour, TourRole } from './types'

interface TourContextValue {
  /** Start a tour from its first step. Replaying a finished tour is the same call. */
  start: (tourId: string) => void
  /** The tours this person can take, page tours first. */
  tours: Tour[]
  /** The page tour for the screen currently open, if there is one. */
  pageTour: Tour | null
  isDone: (tourId: string) => boolean
}

const TourContext = createContext<TourContextValue | null>(null)

export function roleOf(role: string | undefined): TourRole | null {
  if (role === 'admin' || role === 'superadmin') return 'admin'
  if (role === 'agent') return 'agent'
  return null
}

export function useTour(): TourContextValue {
  const value = useContext(TourContext)
  if (!value) throw new Error('useTour must be used inside TourProvider')
  return value
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { session, markTourDone } = useStore()
  const location = useLocation()
  const navigate = useNavigate()
  const role = roleOf(session?.role)
  const [active, setActive] = useState<{ tour: Tour; index: number } | null>(null)

  const tours = useMemo(
    () => (role ? ALL_TOURS.filter((t) => t.role === role && (!t.superadminOnly || session?.role === 'superadmin')) : []),
    [role, session?.role],
  )
  const pageTour = useMemo(
    () => tours.find((t) => t.kind === 'page' && t.route === location.pathname) ?? null,
    [tours, location.pathname],
  )
  const done = useMemo(() => new Set(session?.toursCompleted ?? []), [session?.toursCompleted])

  const start = useCallback(
    (tourId: string) => {
      const tour = tours.find((t) => t.id === tourId)
      if (!tour) return
      if (location.pathname !== (tour.steps[0]?.route ?? tour.route)) navigate(tour.steps[0]?.route ?? tour.route)
      setActive({ tour, index: 0 })
    },
    [tours, location.pathname, navigate],
  )

  // A session change (log out, switching profile) ends any tour in progress.
  useEffect(() => setActive(null), [session?.id])

  const value = useMemo(
    () => ({ start, tours, pageTour, isDone: (id: string) => done.has(id) }),
    [start, tours, pageTour, done],
  )

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && (
        <TourOverlay
          tour={active.tour}
          index={active.index}
          onIndex={(index) => setActive({ tour: active.tour, index })}
          onClose={(finished) => {
            if (finished) void markTourDone(active.tour.id)
            setActive(null)
          }}
        />
      )}
    </TourContext.Provider>
  )
}

/** **bold** to <strong>, nothing else, so tour text stays plain data. */
function renderText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-slate-900 dark:text-slate-50">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  )
}

const PAD = 6
const CARD_W = 340

function TourOverlay({ tour, index, onIndex, onClose }: { tour: Tour; index: number; onIndex: (i: number) => void; onClose: (finished: boolean) => void }) {
  const step = tour.steps[index]
  const location = useLocation()
  const navigate = useNavigate()
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [searching, setSearching] = useState(true)
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })
  const cardRef = useRef<HTMLDivElement>(null)
  const last = index === tour.steps.length - 1

  // Cross-screen steps: go to the step's page first.
  useEffect(() => {
    if (step.route && location.pathname !== step.route) navigate(step.route)
  }, [step.route, location.pathname, navigate])

  // Find the element, waiting briefly for a page that is still loading its data.
  useEffect(() => {
    setRect(null)
    setSearching(true)
    if (!step.target) {
      setSearching(false)
      return
    }
    let tries = 0
    let el: Element | null = null
    const find = window.setInterval(() => {
      tries++
      el = document.querySelector(`[data-tour="${step.target}"]`)
      const visible = el && (el as HTMLElement).offsetParent !== null
      if (visible || tries > 60) {
        window.clearInterval(find)
        setSearching(false)
        if (visible && el) {
          if (window.innerWidth < 640) {
            // On a phone the card covers the bottom of the screen, so bring
            // the element into the space between the header and the card,
            // centred there when it fits, top-aligned under the header when not.
            const header = 64
            const card = cardRef.current?.offsetHeight ?? 260
            const room = window.innerHeight - card - header - 24
            const box = el.getBoundingClientRect()
            const offset = box.height < room ? header + (room - box.height) / 2 : header + 8
            window.scrollTo({ top: Math.max(0, box.top + window.scrollY - offset), behavior: 'instant' })
          } else {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }
          window.setTimeout(() => el && setRect(el.getBoundingClientRect()), 450)
        }
      }
    }, 100)
    return () => window.clearInterval(find)
  }, [step.target, location.pathname])

  // Keep the highlight on the element while the page scrolls or resizes.
  useEffect(() => {
    if (!step.target) return
    const measure = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight })
      const el = document.querySelector(`[data-tour="${step.target}"]`)
      if (el && (el as HTMLElement).offsetParent !== null) setRect(el.getBoundingClientRect())
    }
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [step.target])

  // On a phone the card covers the bottom of the screen, so something at the
  // very end of a page could never be scrolled up above it. Extra room below
  // the page while the tour runs fixes that, and is removed when it ends.
  useEffect(() => {
    if (window.innerWidth >= 640) return
    const previous = document.body.style.paddingBottom
    document.body.style.paddingBottom = '65dvh'
    return () => {
      document.body.style.paddingBottom = previous
    }
  }, [])

  useLayoutEffect(() => {
    if (!searching) cardRef.current?.querySelector<HTMLButtonElement>('[data-tour-next]')?.focus({ preventScroll: true })
  }, [searching, index])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose(false)
      else if (event.key === 'ArrowRight') last ? onClose(true) : onIndex(index + 1)
      else if (event.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, last, onClose, onIndex])

  const mobile = viewport.w < 640
  // Never wider than the screen, never taller than it: a long explanation
  // scrolls inside the card instead of pushing the buttons off screen.
  const width = Math.min(CARD_W, viewport.w - 24)
  let cardStyle: React.CSSProperties = {}
  if (!mobile) {
    if (rect) {
      const cardH = Math.min(cardRef.current?.offsetHeight ?? 220, viewport.h - 24)
      const below = viewport.h - rect.bottom
      const above = rect.top
      const top =
        below > cardH + 24
          ? rect.bottom + PAD + 12
          : above > cardH + 24
            ? rect.top - PAD - 12 - cardH
            : Math.max(12, viewport.h - cardH - 12)
      const left = Math.min(Math.max(12, rect.left), viewport.w - width - 12)
      cardStyle = { top, left, width, maxHeight: viewport.h - 24 }
    } else {
      cardStyle = { top: '50%', left: '50%', width: Math.min(CARD_W + 40, viewport.w - 24), maxHeight: viewport.h - 24, transform: 'translate(-50%, -50%)' }
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100]" aria-live="polite">
      {/* Blocks clicks on the page behind, so a stray tap can't act on something mid-tour. */}
      <div className={cn('absolute inset-0', !rect && 'bg-slate-950/60')} onClick={(e) => e.stopPropagation()} />
      {rect && (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-white transition-all duration-300 dark:ring-slate-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.6)',
          }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className={cn(
          'absolute flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900',
          mobile && 'inset-x-3 bottom-3 max-h-[min(60dvh,28rem)]',
        )}
        style={cardStyle}
      >
        <div className="shrink-0 px-4 pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-xs font-medium text-slate-500 dark:text-slate-400">
              {tour.title} · Step {index + 1} of {tour.steps.length}
            </p>
            <button
              type="button"
              onClick={() => onClose(false)}
              className="-my-1 shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              Skip tour
            </button>
          </div>
          <div className="h-1 rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-1 rounded-full bg-brand-600 transition-all dark:bg-brand-400" style={{ width: `${((index + 1) / tour.steps.length) * 100}%` }} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3">
          <h2 id="tour-title" className="text-base font-bold text-slate-900 dark:text-slate-50">
            {step.title}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed break-words text-slate-600 dark:text-slate-300">{renderText(step.body)}</p>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button variant="outline" size={mobile ? 'md' : 'sm'} onClick={() => onIndex(index - 1)} disabled={index === 0} className={mobile ? 'flex-1' : undefined}>
            Back
          </Button>
          <Button data-tour-next size={mobile ? 'md' : 'sm'} onClick={() => (last ? onClose(true) : onIndex(index + 1))} loading={searching} className={mobile ? 'flex-1' : undefined}>
            {last ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
