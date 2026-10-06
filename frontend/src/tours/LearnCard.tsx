import { useState } from 'react'
import { cn } from '../components/ui'
import { useTour } from './TourProvider'
import type { Tour } from './types'

const COLLAPSED_KEY = 'jdc.learn.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The "Learn" checklist: every tour this person can take, with a tick on the
 * ones they have finished and a Replay on those, so someone who forgot how a
 * screen works can walk it again. Shown on the admin Overview and the agent
 * Dashboard. Collapses to one line once someone no longer needs it open.
 */
export function LearnCard({ title }: { title: string }) {
  const { tours, isDone, start } = useTour()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  if (tours.length === 0) return null

  const doneCount = tours.filter((t) => isDone(t.id)).length
  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      // A preference, nothing more.
    }
  }

  const groups: { label: string; hint: string; items: Tour[] }[] = [
    { label: 'Learn each page', hint: 'What every part of the screen is for.', items: tours.filter((t) => t.kind === 'page') },
    { label: 'What do I do when...', hint: 'Step by step through real situations.', items: tours.filter((t) => t.kind === 'task') },
  ].filter((g) => g.items.length > 0)

  return (
    <section data-tour="learn-card" className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <button type="button" onClick={toggle} aria-expanded={!collapsed} className="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900 dark:text-slate-50">{title}</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            {doneCount === tours.length ? 'All explored. Replay any tour whenever you need a reminder.' : `${doneCount} of ${tours.length} explored`}
          </span>
        </span>
        <span className="hidden h-2 w-28 shrink-0 rounded-full bg-slate-100 sm:block dark:bg-slate-800">
          <span className="block h-2 rounded-full bg-emerald-500" style={{ width: `${(doneCount / tours.length) * 100}%` }} />
        </span>
        <svg viewBox="0 0 20 20" className={cn('size-4 shrink-0 text-slate-400 transition-transform', !collapsed && 'rotate-180')} aria-hidden="true">
          <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {!collapsed && (
        <div className="grid grid-cols-1 gap-5 border-t border-slate-100 px-4 py-4 sm:px-5 lg:grid-cols-2 dark:border-slate-800">
          {groups.map((group) => (
            <div key={group.label} className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{group.label}</p>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{group.hint}</p>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {group.items.map((tour) => {
                  const done = isDone(tour.id)
                  return (
                    <li key={tour.id} className="flex min-w-0 items-center gap-3 py-2.5">
                      <span
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded-full border',
                          done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600',
                        )}
                        aria-label={done ? 'Explored' : 'Not explored yet'}
                      >
                        {done && (
                          <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                            <path d="M2.5 6.2 5 8.5 9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{tour.title}</span>
                        <span className="line-clamp-2 block text-xs text-slate-500 dark:text-slate-400">{tour.summary}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => start(tour.id)}
                        className={cn(
                          'shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold',
                          done
                            ? 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                            : 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-300',
                        )}
                      >
                        {done ? 'Replay' : 'Start'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** "Take the tour" for the page currently open. Renders nothing on a page without one. */
export function TourButton() {
  const { pageTour, start, isDone } = useTour()
  if (!pageTour) return null
  return (
    <button
      type="button"
      onClick={() => start(pageTour.id)}
      title={isDone(pageTour.id) ? 'Replay the tour of this page' : 'Take a short tour of this page'}
      aria-label={isDone(pageTour.id) ? 'Replay the tour of this page' : 'Take a short tour of this page'}
      className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 p-2 sm:px-2.5 sm:py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M7.9 7.6a2.2 2.2 0 1 1 3 2.1c-.6.3-.9.7-.9 1.3v.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="10" cy="13.9" r=".9" fill="currentColor" />
      </svg>
      <span className="hidden sm:inline">{isDone(pageTour.id) ? 'Replay tour' : 'Take the tour'}</span>
    </button>
  )
}
