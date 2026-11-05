import { useEffect, useState } from 'react'
import { api, type TimelineEvent } from '../lib/api'
import { dateTime } from '../lib/format'
import { Spinner, cn } from './ui'

const DOT = {
  money: 'bg-emerald-500',
  provider: 'bg-sky-500',
  person: 'bg-amber-500',
  system: 'bg-slate-400',
} as const

const LABEL = { money: 'Money', provider: 'Delivery partner', person: 'Person', system: 'Platform' } as const

/**
 * One order's whole story, oldest first: payment, each delivery attempt, who
 * decided what, every money movement. The deciding context for a reorder or a
 * refund decision, see backend `OrderTimelineService`.
 */
export function OrderTimeline({ orderId, className }: { orderId: string; className?: string }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    setEvents(null)
    setError(false)
    api
      .orderTimeline(orderId)
      .then((rows) => live && setEvents(rows))
      .catch(() => live && setError(true))
    return () => {
      live = false
    }
  }, [orderId])

  if (error) return <p className={cn('text-xs text-slate-500 dark:text-slate-400', className)}>History could not be loaded.</p>
  if (!events) return <Spinner className={cn('size-4 text-slate-400', className)} />

  return (
    <ol className={cn('space-y-2.5', className)}>
      {events.map((event, index) => (
        <li key={`${event.at}-${index}`} className="flex gap-2.5">
          <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[event.kind])} title={LABEL[event.kind]} />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-slate-800 dark:text-slate-100">{event.title}</p>
            {event.detail && <p className="break-words text-xs text-slate-500 dark:text-slate-400">{event.detail}</p>}
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {dateTime(event.at)}
              {event.who ? ` · ${event.who}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
