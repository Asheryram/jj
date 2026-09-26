import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { api, type MyAnnouncement } from '../lib/api'
import { dateTime } from '../lib/format'
import { Badge, Button, Modal } from './ui'

/**
 * Surfaces unread announcements the moment an agent or admin signs in,
 * instead of waiting for them to notice a nav badge and go find the
 * Announcements page themselves, which they hardly ever do.
 *
 * One dialog for the whole unread queue, not one popup per announcement.
 * Several unread notices step through inside this same modal ("2 of 3", Back/
 * Next) rather than closing and reopening a fresh dialog for each, which
 * reads as popup spam and trains people to reflexively dismiss the next one
 * without reading it. Acknowledging one marks only that one read and, unless
 * it was the last, advances to the next; closing the dialog early (the X,
 * Escape, the backdrop) just hides it for this sign-in, nothing already
 * unread gets silently marked read by being dismissed. It will not reappear
 * until the next login, the nav badge stays as the persistent reminder, and
 * the Announcements page itself is still there for anyone who wants to
 * browse the full list instead.
 */
export function UnreadAnnouncementsModal() {
  const { session, refreshUnreadAnnouncements } = useStore()
  const [queue, setQueue] = useState<MyAnnouncement[] | null>(null)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  /** So going Back to one already acknowledged this session doesn't still say "New". */
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!session || (session.role !== 'agent' && session.role !== 'admin')) {
      setQueue(null)
      return
    }
    let live = true
    api
      .myAnnouncements()
      .then((rows) => {
        if (!live) return
        // Oldest first: read them in the order they were actually sent,
        // unlike the Announcements page's newest-first list, which is for
        // browsing back through history, not catching up on a backlog.
        const unread = rows
          .filter((row) => row.readAt === null)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        setQueue(unread)
        setIndex(0)
        setAcknowledged(new Set())
      })
      .catch(() => live && setQueue(null))
    return () => {
      live = false
    }
    // Only re-checked on a fresh sign-in (a different session id), not on
    // every navigation, so dismissing it does not fight the user by popping
    // straight back up on the very next page.
  }, [session?.id, session?.role])

  if (!queue || queue.length === 0) return null
  const current = queue[index]
  const isLast = index === queue.length - 1

  const acknowledge = async () => {
    setBusy(true)
    try {
      await api.markAnnouncementRead(current.id).catch(() => undefined)
      setAcknowledged((prev) => new Set(prev).add(current.id))
      void refreshUnreadAnnouncements()
      if (isLast) setQueue([])
      else setIndex((i) => i + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => setQueue([])}
      title={queue.length > 1 ? `Announcement ${index + 1} of ${queue.length}` : 'Announcement'}
      // Always wins over a page's own modal (e.g. Dashboard's WhatsApp-join
      // popup), both default to the same stacking layer otherwise, and
      // whichever mounts later silently covers the other's buttons.
      zIndex={60}
      footer={
        <div className="flex items-center gap-2">
          {index > 0 && (
            <Button variant="outline" disabled={busy} onClick={() => setIndex((i) => i - 1)}>
              Back
            </Button>
          )}
          <Button block loading={busy} onClick={() => void acknowledge()}>
            {isLast ? "Got it, mark as read" : 'Got it, next'}
          </Button>
        </div>
      }
    >
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-semibold text-slate-900 dark:text-slate-50">{current.title}</p>
          {!acknowledged.has(current.id) && <Badge tone="brand">New</Badge>}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">
          {current.message}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{dateTime(current.createdAt)}</p>
      </div>
    </Modal>
  )
}
