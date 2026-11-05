import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type InboxItem } from '../../lib/api'
import { cedis, dateTime } from '../../lib/format'
import { Button, Callout, Card, EmptyState, PageHead, Spinner, cn } from '../../components/ui'
import { CheckIcon, RefreshIcon } from '../../components/icons'

const URGENCY = {
  1: { label: 'Now', stripe: 'bg-red-500', text: 'text-red-700 dark:text-red-400' },
  2: { label: 'Today', stripe: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  3: { label: 'When you can', stripe: 'bg-slate-300 dark:bg-slate-600', text: 'text-slate-500 dark:text-slate-400' },
} as const

/**
 * Everything waiting on a person, across every admin page, most urgent first,
 * each with the one button that deals with it. See backend `AdminInboxService`.
 */
export default function Today() {
  const [data, setData] = useState<{ items: InboxItem[]; at: string } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api.today())
      setError('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load what needs doing.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = data ? ([1, 2, 3] as const).map((u) => data.items.filter((i) => i.urgency === u).length) : null

  return (
    <div>
      <PageHead
        title="Today"
        subtitle={
          data
            ? `${data.items.length === 0 ? 'Nothing' : `${data.items.length} thing${data.items.length === 1 ? '' : 's'}`} waiting on a person · as of ${dateTime(data.at)}`
            : 'Everything waiting on a person, most urgent first.'
        }
        action={
          <Button variant="outline" size="sm" loading={loading} onClick={() => void load()} aria-label="Check again">
            <RefreshIcon className="size-4" />
            <span className="hidden sm:inline">Check again</span>
          </Button>
        }
      />

      {error && <Callout tone="danger" className="mb-3">{error}</Callout>}

      {!data && !error ? (
        <div className="py-12 text-center">
          <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
        </div>
      ) : data && data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckIcon className="size-6" />}
            title="Nothing needs you right now"
            detail="No stuck payouts, waiting refunds, undelivered orders or low floats."
          />
        </Card>
      ) : data ? (
        <>
          {counts && (
            <div className="mb-3 flex flex-wrap gap-2 text-sm">
              {([1, 2, 3] as const).map((u, i) =>
                counts[i] > 0 ? (
                  <span key={u} className={cn('font-semibold', URGENCY[u].text)}>
                    {counts[i]} {URGENCY[u].label.toLowerCase()}
                  </span>
                ) : null,
              )}
            </div>
          )}
          <div className="space-y-2.5">
            {data.items.map((item) => (
              <Card key={item.id} className="overflow-hidden">
                <div className="flex">
                  <span className={cn('w-1.5 shrink-0', URGENCY[item.urgency].stripe)} />
                  <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className={cn('text-xs font-semibold uppercase tracking-wide', URGENCY[item.urgency].text)}>
                        {URGENCY[item.urgency].label}
                      </p>
                      <p className="mt-0.5 font-semibold text-slate-900 dark:text-slate-50">{item.title}</p>
                      <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{item.detail}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {item.amount != null && (
                        <span className="tabular font-bold text-slate-900 dark:text-slate-50">{cedis(item.amount)}</span>
                      )}
                      <Link to={item.link}>
                        <Button size="sm">{item.action}</Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
