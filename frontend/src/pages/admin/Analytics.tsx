import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DateRangePicker, type PresetKey } from '../../components/DateRangePicker'
import { RefreshIcon } from '../../components/icons'
import { Button, cn, Spinner } from '../../components/ui'
import { api, ApiError, type Insights } from '../../lib/api'
import { useStore } from '../../state/store'
import AgentsTab from './analytics/AgentsTab'
import CashTab from './analytics/CashTab'
import MoneyTab from './analytics/MoneyTab'
import OperationsTab from './analytics/OperationsTab'
import OverviewTab from './analytics/OverviewTab'
import SalesTab from './analytics/SalesTab'
import { PRESET_LABELS, presetRange, rangeLabel } from './analytics/shared'

const TABS = [
  { key: 'overview', label: 'Overview', question: 'How is the business doing, and what needs a decision?' },
  { key: 'money', label: 'Money', question: 'Are we making money, and where?' },
  { key: 'sales', label: 'Sales', question: 'Who buys, when, and how many come back?' },
  { key: 'operations', label: 'Operations', question: 'Are orders getting through, and how fast?' },
  { key: 'agents', label: 'Agents', question: 'Which agents drive the business, and are they paid?' },
  { key: 'cash', label: 'Cash', question: 'Can we keep selling tomorrow?' },
] as const
type TabKey = (typeof TABS)[number]['key']

function isPreset(value: string | null): value is PresetKey {
  return value !== null && value in PRESET_LABELS
}

function asOf(iso: string | null): string {
  if (!iso) return 'not built yet'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} hr${hours === 1 ? '' : 's'} ago` : new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

/**
 * Analytics, rebuilt around the questions an owner actually asks. One call
 * returns the whole page for a date range, compared with the period just
 * before it; the tab, range and preset live in the URL so a view can be
 * bookmarked or shared with another admin.
 */
export default function Analytics() {
  const { pushToast } = useStore()
  const [params, setParams] = useSearchParams()

  const tab: TabKey = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview') as TabKey
  const preset = params.get('preset')
  const range = useMemo(() => {
    const from = Number(params.get('from'))
    const to = Number(params.get('to'))
    if (!isPreset(preset) && from > 0 && to >= from) return { from, to }
    return presetRange(isPreset(preset) ? preset : 'last30')
  }, [params, preset])
  const label = isPreset(preset) ? PRESET_LABELS[preset] : params.get('from') ? rangeLabel(range.from, range.to) : PRESET_LABELS.last30

  const [data, setData] = useState<Insights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const update = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) {
      if (v === null) merged.delete(k)
      else merged.set(k, v)
    }
    setParams(merged, { replace: true })
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.analyticsInsights(range))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Analytics could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    try {
      await api.analyticsRefresh()
      await load()
      pushToast({ tone: 'success', title: 'Analytics updated with the latest orders' })
    } catch (caught) {
      pushToast({ tone: 'error', title: caught instanceof ApiError ? caught.message : 'Could not refresh analytics.' })
    } finally {
      setRefreshing(false)
    }
  }

  const current = TABS.find((t) => t.key === tab) ?? TABS[0]

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 pb-16 pt-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Analytics</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {data ? (
              <>
                {rangeLabel(data.meta.from, data.meta.to)}, compared with {rangeLabel(data.meta.previousFrom, data.meta.previousTo)}. Updated {asOf(data.meta.dataAsOf)}.
              </>
            ) : (
              'Business figures from your orders and ledger.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2" data-tour="analytics-range">
          <DateRangePicker
            label={label}
            onPreset={(p) => update({ preset: p, from: null, to: null })}
            onCustomRange={(from, to) => update({ preset: null, from: String(from), to: String(to) })}
          />
          <Button variant="outline" size="sm" onClick={() => void refresh()} loading={refreshing} aria-label="Refresh with the latest orders" data-tour="analytics-refresh">
            <RefreshIcon className="size-4" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      <nav className="sticky top-14 z-20 -mx-4 mt-4 border-b border-slate-200 bg-slate-50/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 dark:border-slate-800 dark:bg-slate-950/95" aria-label="Analytics sections" data-tour="analytics-tabs">
        <div className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => update({ tab: t.key === 'overview' ? null : t.key })}
              aria-current={t.key === tab ? 'page' : undefined}
              className={cn(
                'shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors',
                t.key === tab
                  ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <p className="mb-4 mt-4 text-sm font-medium text-slate-600 dark:text-slate-300">{current.question}</p>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <p className="font-semibold">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>Try again</Button>
        </div>
      ) : !data ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      ) : (
        <div className={cn('transition-opacity', loading && 'pointer-events-none opacity-60')} aria-busy={loading}>
          {tab === 'overview' && <OverviewTab data={data} onTab={(t) => update({ tab: t })} />}
          {tab === 'money' && <MoneyTab data={data} />}
          {tab === 'sales' && <SalesTab data={data} />}
          {tab === 'operations' && <OperationsTab data={data} />}
          {tab === 'agents' && <AgentsTab data={data} />}
          {tab === 'cash' && <CashTab data={data} />}
        </div>
      )}
    </main>
  )
}
