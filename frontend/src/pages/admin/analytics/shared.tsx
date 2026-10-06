import type { ReactNode } from 'react'
import { CATEGORY_META } from '../../../components/categories'
import type { PresetKey } from '../../../components/DateRangePicker'
import { cn } from '../../../components/ui'
import type { Category } from '../../../data/types'
import type { InsightsGranularity } from '../../../lib/api'
import { cedis, cedisCompact } from '../../../lib/format'

export { cedis, cedisCompact }

// ─── Dates (Ghana is UTC+0 all year, so UTC dates are Ghana dates) ──────────

export function dateInt(d: Date): number {
  return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}

export function fromDateInt(n: number): Date {
  return new Date(Date.UTC(Math.floor(n / 10_000), Math.floor((n % 10_000) / 100) - 1, n % 100))
}

function shift(n: number, days: number): number {
  const d = fromDateInt(n)
  d.setUTCDate(d.getUTCDate() + days)
  return dateInt(d)
}

export function presetRange(preset: PresetKey): { from: number; to: number } {
  const now = new Date()
  const today = dateInt(now)
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday':
      return { from: shift(today, -1), to: shift(today, -1) }
    case 'last7':
      return { from: shift(today, -6), to: today }
    case 'last30':
      return { from: shift(today, -29), to: today }
    case 'last90':
      return { from: shift(today, -89), to: today }
    case 'thisMonth':
      return { from: dateInt(new Date(Date.UTC(y, m, 1))), to: today }
    case 'lastMonth':
      return { from: dateInt(new Date(Date.UTC(y, m - 1, 1))), to: dateInt(new Date(Date.UTC(y, m, 0))) }
    case 'thisYear':
    case 'yearToDate':
      return { from: dateInt(new Date(Date.UTC(y, 0, 1))), to: today }
    case 'lastYear':
      return { from: dateInt(new Date(Date.UTC(y - 1, 0, 1))), to: dateInt(new Date(Date.UTC(y - 1, 11, 31))) }
    case 'quarterToDate':
      return { from: dateInt(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))), to: today }
  }
}

export const PRESET_LABELS: Record<PresetKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  last90: 'Last 90 days',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  thisYear: 'This year',
  lastYear: 'Last year',
  quarterToDate: 'Quarter to date',
  yearToDate: 'Year to date',
}

export function shortDate(n: number): string {
  return fromDateInt(n).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function rangeLabel(from: number, to: number): string {
  if (from === to) return fromDateInt(from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const sameYear = Math.floor(from / 10_000) === Math.floor(to / 10_000)
  const end = fromDateInt(to).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return `${sameYear ? shortDate(from) : fromDateInt(from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })} to ${end}`
}

export function bucketLabel(bucket: number, granularity: InsightsGranularity): string {
  if (granularity === 'month') return fromDateInt(bucket).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  return shortDate(bucket)
}

export function granularityWord(granularity: InsightsGranularity): string {
  return granularity === 'day' ? 'day' : granularity === 'week' ? 'week' : 'month'
}

// ─── Names ──────────────────────────────────────────────────────────────────

export function providerName(provider: string): string {
  if (provider === 'gmpl') return 'GMPL'
  if (provider === 'datahub-gh') return 'DataHub'
  return provider
}

export function networkName(network: string): string {
  return network === 'UNKNOWN' ? 'No network (vouchers)' : network
}

export function categoryName(category: string): string {
  return CATEGORY_META[category as Category]?.short ?? category
}

export function channelName(channel: string): string {
  return channel === 'agent' ? 'Agent stores' : 'Your own shop'
}

// ─── Numbers ────────────────────────────────────────────────────────────────

/** Axis wording: "GHS 600", "GHS 1.2k", never decimals. */
export function cedisAxis(pesewas: number): string {
  const v = pesewas / 100
  const sign = v < 0 ? '−' : ''
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${sign}GHS ${(a / 1_000_000).toFixed(1)}M`
  if (a >= 1_000) return `${sign}GHS ${(a / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`
  return `${sign}GHS ${Math.round(a)}`
}

/** "−GHS 4.0k" rather than "GHS -4.0k". */
export function cedisSigned(pesewas: number): string {
  return pesewas < 0 ? `−${cedisCompact(-pesewas)}` : cedisCompact(pesewas)
}

/** "up 12%", "down 4%", or "154 times" for a jump past tripling. */
export function changeWords(value: number, previous: number): string {
  if (previous <= 0) return ''
  const ratio = value / previous
  if (ratio >= 3) return `${ratio >= 10 ? Math.round(ratio).toLocaleString('en-GH') : ratio.toFixed(1)} times the previous period`
  const change = (ratio - 1) * 100
  if (Math.abs(change) < 0.5) return 'about the same as the previous period'
  return `${change > 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(0)}% on the previous period`
}

export function pct(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`
}

export function count(value: number): string {
  return Math.round(value).toLocaleString('en-GH')
}

/** "45 sec", "12 min", "3.5 hrs", "2 days" from seconds. */
export function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'none yet'
  if (seconds < 90) return `${Math.round(seconds)} sec`
  const minutes = seconds / 60
  if (minutes < 90) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hrs`
  return `${Math.round(hours / 24)} days`
}

export function hoursText(hours: number | null): string {
  return hours === null ? 'none yet' : duration(hours * 3600)
}

// ─── Layout ─────────────────────────────────────────────────────────────────

/**
 * A card that leads with the business question it answers, then the answer
 * in one line, then the chart. Reading only the bold lines should be enough.
 */
export function Panel({
  question,
  answer,
  children,
  action,
  className,
}: {
  question: string
  answer?: ReactNode
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900', className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">{question}</h3>
          {answer && <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-50">{answer}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-lg font-bold tabular-nums',
          tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'bad' ? 'text-rose-600 dark:text-rose-400' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-50',
        )}
      >
        {value}
      </p>
    </div>
  )
}
