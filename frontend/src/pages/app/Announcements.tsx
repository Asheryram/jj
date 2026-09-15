import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type MyAnnouncement } from '../../lib/api'
import { dateTime } from '../../lib/format'
import { Badge, Card, cn, EmptyState, PageHead, Spinner } from '../../components/ui'
import { HelpIcon } from '../../components/icons'
import { useStore } from '../../state/store'

/**
 * Notices sent from admin or the platform team, newest first. Opening one
 * marks it read. `?item=<id>`, from an announcement email's "Open in app"
 * link, scrolls straight to that one and highlights it briefly rather than
 * leaving whoever clicked it to scan the whole list for it.
 */
export default function Announcements() {
  const { refreshUnreadAnnouncements } = useStore()
  const [searchParams] = useSearchParams()
  const linkedId = searchParams.get('item')
  const [rows, setRows] = useState<MyAnnouncement[] | null>(null)
  const scrolledToLinked = useRef(false)

  const load = useCallback(async () => {
    try {
      setRows(await api.myAnnouncements())
    } catch {
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Marking read happens as soon as the list is actually shown, not per
  // click: a one-way notice has nothing further to "open", the whole
  // message is already on the page, so the natural read signal is having
  // been shown it at all.
  useEffect(() => {
    if (!rows) return
    const unread = rows.filter((row) => row.readAt === null)
    if (unread.length === 0) return
    void Promise.all(unread.map((row) => api.markAnnouncementRead(row.id).catch(() => undefined))).then(
      () => void refreshUnreadAnnouncements(),
    )
  }, [rows, refreshUnreadAnnouncements])

  useEffect(() => {
    if (!rows || !linkedId || scrolledToLinked.current) return
    const el = document.getElementById(`announcement-${linkedId}`)
    if (!el) return
    scrolledToLinked.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [rows, linkedId])

  return (
    <div>
      <PageHead title="Announcements" subtitle="Notices from admin and the platform team." />

      <Card className="mt-3">
        <div className="space-y-2 p-4 sm:p-5">
          {rows === null ? (
            <div className="py-8 text-center">
              <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState icon={<HelpIcon className="size-6" />} title="Nothing yet" detail="Announcements from admin will show up here." />
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                id={`announcement-${row.id}`}
                className={cn(
                  'rounded-xl border p-3.5 transition-colors',
                  row.id === linkedId
                    ? 'border-brand-300 bg-brand-50/60 dark:border-brand-700 dark:bg-brand-900/20'
                    : 'border-slate-200 dark:border-slate-700',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="font-semibold text-slate-900 dark:text-slate-50">{row.title}</p>
                  {row.readAt === null && <Badge tone="brand">New</Badge>}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{row.message}</p>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{dateTime(row.createdAt)}</p>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  )
}
