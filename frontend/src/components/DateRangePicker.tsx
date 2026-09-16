import { useState } from 'react'
import { Button, cn, Modal } from './ui'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from './icons'

/**
 * The 11 one-click presets a business user actually reaches for. `last7`/
 * `last30`/`last90` map to Analytics.tsx's existing `recent` mode (with
 * `recentDays` set accordingly) rather than being distinct `RangeMode`
 * values themselves; everything else maps 1:1 to a `RangeMode` of the same
 * name. Kept here, not imported from Analytics.tsx, so this component has
 * no dependency on that page's internals beyond this one small union.
 */
export type PresetKey =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'last90'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear'
  | 'quarterToDate'
  | 'yearToDate'

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'last90', label: 'Last 90 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'thisYear', label: 'This year' },
  { key: 'lastYear', label: 'Last year' },
  { key: 'quarterToDate', label: 'Quarter to date' },
  { key: 'yearToDate', label: 'Year to date' },
]

const WEEKDAY_HEADS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function toDateInt(y: number, m0: number, d: number): number {
  return y * 10_000 + (m0 + 1) * 100 + d
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
}

/** "16 Sep", a self-contained duplicate of Analytics.tsx's `dayLabel` so this component has no cross-import. */
function shortDate(dateInt: number): string {
  const y = Math.floor(dateInt / 10_000)
  const m0 = Math.floor((dateInt % 10_000) / 100) - 1
  const d = dateInt % 100
  return new Date(Date.UTC(y, m0, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function monthLabel(y: number, m0: number): string {
  return new Date(Date.UTC(y, m0, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

interface CalendarCell {
  dateInt: number
  day: number
  inMonth: boolean
}

/** A 5- or 6-week grid (always a multiple of 7 cells), leading/trailing days from the adjacent months included so every row is full. */
function buildCalendarCells(y: number, m0: number): CalendarCell[] {
  const cells: CalendarCell[] = []
  const firstDow = new Date(Date.UTC(y, m0, 1)).getUTCDay()
  const prevM0 = m0 === 0 ? 11 : m0 - 1
  const prevY = m0 === 0 ? y - 1 : y
  const daysPrev = daysInMonth(prevY, prevM0)
  for (let i = firstDow - 1; i >= 0; i--) {
    const day = daysPrev - i
    cells.push({ dateInt: toDateInt(prevY, prevM0, day), day, inMonth: false })
  }
  const daysThis = daysInMonth(y, m0)
  for (let day = 1; day <= daysThis; day++) cells.push({ dateInt: toDateInt(y, m0, day), day, inMonth: true })
  const nextM0 = m0 === 11 ? 0 : m0 + 1
  const nextY = m0 === 11 ? y + 1 : y
  let day = 1
  while (cells.length % 7 !== 0) {
    cells.push({ dateInt: toDateInt(nextY, nextM0, day), day, inMonth: false })
    day++
  }
  return cells
}

function todayDateInt(): number {
  const n = new Date()
  return toDateInt(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())
}

/**
 * One button that always shows the resolved range, opening a single panel
 * (presets left, calendar right, stacking vertically under `sm`) in place of
 * the segmented-control-plus-conditional-input row this replaces. Presets
 * commit and close immediately; the calendar's custom selection needs an
 * explicit Apply, since the user is mid-pick until both ends are chosen.
 *
 * Fully controlled: `label`/`comparisonLabel`/`compareMode` are computed by
 * the caller from its own range/mode state, and every action here (a preset,
 * a custom range, a comparison-mode change) is reported back via callback
 * rather than held here, the same pattern `Segmented`/`TextInput` already use
 * elsewhere on this page.
 */
export function DateRangePicker({
  label,
  comparisonLabel,
  compareMode,
  onCompareModeChange,
  onPreset,
  onCustomRange,
}: {
  label: string
  comparisonLabel: string
  compareMode: 'previous' | 'lastYear'
  onCompareModeChange: (mode: 'previous' | 'lastYear') => void
  onPreset: (preset: PresetKey) => void
  onCustomRange: (from: number, to: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date()
    return { y: n.getUTCFullYear(), m0: n.getUTCMonth() }
  })
  const [pendingStart, setPendingStart] = useState<number | null>(null)
  const [pendingEnd, setPendingEnd] = useState<number | null>(null)

  const openPanel = () => {
    setPendingStart(null)
    setPendingEnd(null)
    const n = new Date()
    setViewMonth({ y: n.getUTCFullYear(), m0: n.getUTCMonth() })
    setOpen(true)
  }

  const navMonth = (delta: number) => {
    setViewMonth((v) => {
      const total = v.y * 12 + v.m0 + delta
      return { y: Math.floor(total / 12), m0: ((total % 12) + 12) % 12 }
    })
  }

  const handleDayClick = (dateInt: number) => {
    if (pendingStart === null || pendingEnd !== null) {
      setPendingStart(dateInt)
      setPendingEnd(null)
    } else if (dateInt < pendingStart) {
      setPendingEnd(pendingStart)
      setPendingStart(dateInt)
    } else {
      setPendingEnd(dateInt)
    }
  }

  const applyCustom = () => {
    if (pendingStart === null || pendingEnd === null) return
    onCustomRange(pendingStart, pendingEnd)
    setOpen(false)
  }

  const cells = buildCalendarCells(viewMonth.y, viewMonth.m0)
  const today = todayDateInt()

  return (
    <div>
      <button
        type="button"
        onClick={openPanel}
        className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-[15px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        {label}
        <ChevronDownIcon className="size-4 text-slate-400 dark:text-slate-500" />
      </button>

      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        vs. {comparisonLabel}
        <button
          type="button"
          onClick={() => onCompareModeChange(compareMode === 'previous' ? 'lastYear' : 'previous')}
          className="ml-2 font-medium text-brand-700 underline decoration-dotted hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
        >
          {compareMode === 'previous' ? 'Compare to last year instead' : 'Compare to previous period instead'}
        </button>
      </p>

      <Modal open={open} onClose={() => setOpen(false)} title="Select date range">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex flex-col gap-0.5 sm:w-40 sm:shrink-0 sm:border-r sm:border-slate-100 sm:pr-3 sm:dark:border-slate-800">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  onPreset(p.key)
                  setOpen(false)
                }}
                className="rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => navMonth(-1)}
                aria-label="Previous month"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <ChevronLeftIcon className="size-4.5" />
              </button>
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{monthLabel(viewMonth.y, viewMonth.m0)}</span>
              <button
                type="button"
                onClick={() => navMonth(1)}
                aria-label="Next month"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <ChevronRightIcon className="size-4.5" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-400 dark:text-slate-500">
              {WEEKDAY_HEADS.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((cell) => {
                const isStart = cell.dateInt === pendingStart
                const isEnd = cell.dateInt === pendingEnd
                const inRange = pendingStart !== null && pendingEnd !== null && cell.dateInt > pendingStart && cell.dateInt < pendingEnd
                return (
                  <button
                    key={cell.dateInt}
                    type="button"
                    onClick={() => handleDayClick(cell.dateInt)}
                    className={cn(
                      'aspect-square rounded-lg text-sm tabular transition-colors',
                      !cell.inMonth && 'text-slate-300 dark:text-slate-600',
                      cell.inMonth && !isStart && !isEnd && !inRange && 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
                      inRange && 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200',
                      (isStart || isEnd) && 'bg-brand-600 font-semibold text-white',
                      cell.dateInt === today && !isStart && !isEnd && 'ring-1 ring-inset ring-brand-400',
                    )}
                  >
                    {cell.day}
                  </button>
                )
              })}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {pendingStart !== null && pendingEnd !== null
                  ? `Custom: ${shortDate(pendingStart)} - ${shortDate(pendingEnd)}`
                  : pendingStart !== null
                    ? `${shortDate(pendingStart)} - pick an end date`
                    : 'Pick a start date'}
              </p>
              <Button onClick={applyCustom} disabled={pendingStart === null || pendingEnd === null}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
