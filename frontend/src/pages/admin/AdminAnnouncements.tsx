import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type AnnouncementHistoryRow } from '../../lib/api'
import { useStore } from '../../state/store'
import { dateTime } from '../../lib/format'
import { Badge, Button, Card, CardHead, EmptyState, PageHead, Spinner } from '../../components/ui'
import { HelpIcon, PlusIcon } from '../../components/icons'

type Audience = 'all' | 'agents' | 'admins' | 'selected'

const AUDIENCE_LABEL: Record<Audience, string> = {
  all: 'Everyone',
  agents: 'Agents only',
  admins: 'Admins only',
  selected: 'Chosen recipients',
}

/**
 * What the team has sent, "what did I send" kept apart from "what did I get"
 * (`ReceivedAnnouncements`), and from writing a new one (`ComposeAnnouncement`,
 * reached from the button below). Three different questions, three pages.
 */
export default function AdminAnnouncements() {
  const { session } = useStore()
  const navigate = useNavigate()
  const [history, setHistory] = useState<AnnouncementHistoryRow[] | null>(null)

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api.announcementHistory())
    } catch {
      setHistory([])
    }
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  return (
    <div>
      <PageHead
        title="Announcements"
        subtitle="A one-way notice to agents and admins, for scheduled maintenance or something new, emailed and shown in-app."
        action={
          <div className="flex flex-wrap gap-2">
            {session?.role === 'admin' && (
              <Button variant="outline" onClick={() => navigate('/admin/announcements/received')}>
                Received
              </Button>
            )}
            <Button className="gap-1.5" onClick={() => navigate('/admin/announcements/new')}>
              <PlusIcon className="size-4" />
              New announcement
            </Button>
          </div>
        }
      />

      <Card className="mt-3">
        <CardHead title="Sent" subtitle="Newest first" />
        <div className="space-y-2 p-4 sm:p-5">
          {history === null ? (
            <div className="py-8 text-center">
              <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
            </div>
          ) : history.length === 0 ? (
            <EmptyState
              icon={<HelpIcon className="size-6" />}
              title="Nothing sent yet"
              detail="Your first announcement will show up here."
              action={
                <Button className="gap-1.5" onClick={() => navigate('/admin/announcements/new')}>
                  <PlusIcon className="size-4" />
                  New announcement
                </Button>
              }
            />
          ) : (
            history.map((row) => (
              <div key={row.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-slate-50">{row.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
                      {row.message}
                    </p>
                    <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                      {row.createdByName} · {dateTime(row.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={row.audience === 'all' ? 'brand' : 'neutral'}>{AUDIENCE_LABEL[row.audience]}</Badge>
                    <span className="tabular text-xs text-slate-500 dark:text-slate-400">
                      {row.readCount}/{row.recipientCount} read
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  )
}
