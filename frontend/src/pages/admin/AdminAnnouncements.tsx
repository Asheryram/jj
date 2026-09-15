import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError, type AnnouncementHistoryRow, type MyAnnouncement } from '../../lib/api'
import { useStore } from '../../state/store'
import { dateTime } from '../../lib/format'
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Field,
  PageHead,
  Segmented,
  Spinner,
  Textarea,
  TextInput,
  cn,
} from '../../components/ui'
import { HelpIcon, SearchIcon, XIcon } from '../../components/icons'

type Audience = 'all' | 'agents' | 'admins' | 'selected'
type Recipient = { id: string; name: string; referralCode: string; role: 'agent' | 'admin' }

const AUDIENCE_LABEL: Record<Audience, string> = {
  all: 'Everyone',
  agents: 'Agents only',
  admins: 'Admins only',
  selected: 'Chosen recipients',
}

/**
 * A one-way notice to the team, for something like scheduled maintenance or a
 * new feature, sent by email and kept as an in-app notification on the other
 * side (`Feedback`'s counterpart in the other direction). Not the same as
 * `Settings`'s site-wide banner: this has a chosen audience, a send history,
 * and a per-recipient read state. Composing is admin/superadmin only, but an
 * admin can also be on the receiving end, see the inbox card below.
 */
export default function AdminAnnouncements() {
  const { session, pushToast, refreshUnreadAnnouncements } = useStore()
  const [recipients, setRecipients] = useState<Recipient[] | null>(null)
  const [history, setHistory] = useState<AnnouncementHistoryRow[] | null>(null)

  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [audience, setAudience] = useState<Audience>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [recipientSearch, setRecipientSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api.announcementHistory())
    } catch {
      setHistory([])
    }
  }, [])

  useEffect(() => {
    void loadHistory()
    api
      .announcementRecipients()
      .then(setRecipients)
      .catch(() => setRecipients([]))
  }, [loadHistory])

  const visibleRecipients = (recipients ?? []).filter((recipient) => {
    const needle = recipientSearch.trim().toLowerCase()
    if (!needle) return true
    return (
      recipient.name.toLowerCase().includes(needle) || recipient.referralCode.toLowerCase().includes(needle)
    )
  })

  // What the checkbox list below cannot show at a glance once it is scrolled
  // or filtered by search: exactly who is picked, in one place.
  const selectedRecipients = (recipients ?? []).filter((recipient) => selectedIds.has(recipient.id))

  const agentCount = (recipients ?? []).filter((r) => r.role === 'agent').length
  const adminCount = (recipients ?? []).filter((r) => r.role === 'admin').length

  const toggleRecipient = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async () => {
    if (title.trim().length < 3) {
      setError('Give it a title, three characters minimum.')
      return
    }
    if (message.trim().length < 5) {
      setError('Say a little more, five characters minimum.')
      return
    }
    if (audience === 'selected' && selectedIds.size === 0) {
      setError('Choose at least one person, or switch to "Everyone".')
      return
    }
    if (audience === 'agents' && agentCount === 0) {
      setError('There are no active agents to send this to.')
      return
    }
    if (audience === 'admins' && adminCount === 0) {
      setError('There are no active admins to send this to.')
      return
    }

    setBusy(true)
    setError('')
    try {
      const sent = await api.sendAnnouncement(
        title.trim(),
        message.trim(),
        audience,
        audience === 'selected' ? [...selectedIds] : undefined,
      )
      setTitle('')
      setMessage('')
      setSelectedIds(new Set())
      await loadHistory()
      pushToast({
        tone: 'success',
        title: `Sent to ${sent.recipientCount} ${sent.recipientCount === 1 ? 'person' : 'people'}`,
        detail: 'Emailed now, and waiting for them in-app.',
      })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not send that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHead
        title="Announcements"
        subtitle="A one-way notice to agents and admins, for scheduled maintenance or something new, emailed and shown in-app."
      />

      {session?.role === 'admin' && (
        <AdminInboxCard onCleared={() => void refreshUnreadAnnouncements()} />
      )}

      <Card className="mt-3">
        <CardHead title="New announcement" />
        <form
          className="space-y-4 p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field label="Title" htmlFor="announcement-title">
            <TextInput
              id="announcement-title"
              placeholder="Scheduled maintenance tonight"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>

          <Field label="Message" htmlFor="announcement-message" error={error}>
            <Textarea
              id="announcement-message"
              rows={4}
              placeholder="The app will be briefly unavailable between 11pm and midnight for maintenance."
              value={message}
              invalid={Boolean(error)}
              onChange={(event) => {
                setMessage(event.target.value)
                setError('')
              }}
            />
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Send to</p>
            <div className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
              <Segmented<Audience>
                options={[
                  { value: 'all', label: AUDIENCE_LABEL.all },
                  { value: 'agents', label: AUDIENCE_LABEL.agents },
                  { value: 'admins', label: AUDIENCE_LABEL.admins },
                  { value: 'selected', label: 'Choose people' },
                ]}
                value={audience}
                onChange={setAudience}
              />
            </div>
            {audience === 'all' && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Sending to {agentCount + adminCount} people: {agentCount} agent{agentCount === 1 ? '' : 's'} and{' '}
                {adminCount} admin{adminCount === 1 ? '' : 's'}.
              </p>
            )}
            {audience === 'agents' && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Sending to {agentCount} active agent{agentCount === 1 ? '' : 's'}, no admins.
              </p>
            )}
            {audience === 'admins' && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Sending to {adminCount} active admin{adminCount === 1 ? '' : 's'}, no agents.
              </p>
            )}
          </div>

          {audience === 'selected' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700">
              {selectedRecipients.length > 0 && (
                <div className="border-b border-slate-100 dark:border-slate-800 p-2.5">
                  <p className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Sending to {selectedRecipients.length} {selectedRecipients.length === 1 ? 'person' : 'people'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedRecipients.map((recipient) => (
                      <Badge key={recipient.id} tone="brand" className="py-1 pr-1">
                        {recipient.name}
                        {recipient.role === 'admin' && <span className="opacity-70">· Admin</span>}
                        <button
                          type="button"
                          onClick={() => toggleRecipient(recipient.id)}
                          aria-label={`Remove ${recipient.name}`}
                          className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/20"
                        >
                          <XIcon className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <div className="border-b border-slate-100 dark:border-slate-800 p-2.5">
                <div className="relative">
                  <SearchIcon className="absolute inset-y-0 left-3 my-auto size-4 text-slate-500 dark:text-slate-400" />
                  <TextInput
                    placeholder="Search by name or code"
                    className="pl-9"
                    value={recipientSearch}
                    onChange={(event) => setRecipientSearch(event.target.value)}
                  />
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto p-2">
                {recipients === null ? (
                  <div className="py-6 text-center">
                    <Spinner className="mx-auto size-5 text-brand-600 dark:text-brand-300" />
                  </div>
                ) : visibleRecipients.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500 dark:text-slate-400">No one matches that search.</p>
                ) : (
                  visibleRecipients.map((recipient) => (
                    <label
                      key={recipient.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(recipient.id)}
                        onChange={() => toggleRecipient(recipient.id)}
                        className="size-4 rounded border-slate-300 dark:border-slate-600"
                      />
                      <span className="text-sm text-slate-800 dark:text-slate-100">{recipient.name}</span>
                      {recipient.role === 'admin' ? (
                        <Badge tone="neutral">Admin</Badge>
                      ) : (
                        <span className="tabular text-xs text-slate-500 dark:text-slate-400">
                          {recipient.referralCode}
                        </span>
                      )}
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          <Button type="submit" loading={busy}>
            Send announcement
          </Button>
        </form>
      </Card>

      <Card className="mt-3">
        <CardHead title="Sent" subtitle="Newest first" />
        <div className="space-y-2 p-4 sm:p-5">
          {history === null ? (
            <div className="py-8 text-center">
              <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
            </div>
          ) : history.length === 0 ? (
            <EmptyState icon={<HelpIcon className="size-6" />} title="Nothing sent yet" detail="Your first announcement will show up here." />
          ) : (
            history.map((row) => (
              <div key={row.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-slate-50">{row.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{row.message}</p>
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

/**
 * An admin's own inbox, for the rare case they were themselves the target of
 * someone else's announcement. Embedded here rather than a separate route:
 * this page is already where an admin lands for anything announcement-shaped.
 */
function AdminInboxCard({ onCleared }: { onCleared: () => void }) {
  const [searchParams] = useSearchParams()
  const linkedId = searchParams.get('item')
  const [rows, setRows] = useState<MyAnnouncement[] | null>(null)
  const scrolledToLinked = useRef(false)

  useEffect(() => {
    api
      .myAnnouncements()
      .then(setRows)
      .catch(() => setRows([]))
  }, [])

  useEffect(() => {
    if (!rows) return
    const unread = rows.filter((row) => row.readAt === null)
    if (unread.length === 0) return
    void Promise.all(unread.map((row) => api.markAnnouncementRead(row.id).catch(() => undefined))).then(onCleared)
  }, [rows, onCleared])

  useEffect(() => {
    if (!rows || !linkedId || scrolledToLinked.current) return
    const el = document.getElementById(`announcement-${linkedId}`)
    if (!el) return
    scrolledToLinked.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [rows, linkedId])

  if (rows !== null && rows.length === 0) return null

  return (
    <Card className="mt-3">
      <CardHead title="Sent to you" subtitle="Notices from another admin or the platform team." />
      <div className="space-y-2 p-4 sm:p-5">
        {rows === null ? (
          <div className="py-6 text-center">
            <Spinner className="mx-auto size-5 text-brand-600 dark:text-brand-300" />
          </div>
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
  )
}
