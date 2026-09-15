import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type AnnouncementHistoryRow } from '../../lib/api'
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
} from '../../components/ui'
import { HelpIcon, SearchIcon } from '../../components/icons'

type Audience = 'all' | 'selected'

/**
 * A one-way notice to agents, for something like scheduled maintenance or a
 * new feature, sent by email and kept as an in-app notification on their
 * side (`Feedback`'s counterpart in the other direction). Not the same as
 * `Settings`'s site-wide banner: this has a chosen audience, a send history,
 * and a per-agent read state.
 */
export default function AdminAnnouncements() {
  const { pushToast } = useStore()
  const [agents, setAgents] = useState<{ id: string; name: string; referralCode: string }[] | null>(null)
  const [history, setHistory] = useState<AnnouncementHistoryRow[] | null>(null)

  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [audience, setAudience] = useState<Audience>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [agentSearch, setAgentSearch] = useState('')
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
      .announcementAgents()
      .then(setAgents)
      .catch(() => setAgents([]))
  }, [loadHistory])

  const visibleAgents = (agents ?? []).filter((agent) => {
    const needle = agentSearch.trim().toLowerCase()
    if (!needle) return true
    return agent.name.toLowerCase().includes(needle) || agent.referralCode.toLowerCase().includes(needle)
  })

  const toggleAgent = (id: string) => {
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
      setError('Choose at least one agent, or switch to "All agents".')
      return
    }

    setBusy(true)
    setError('')
    try {
      const sent = await api.sendAnnouncement(
        title.trim(),
        message.trim(),
        audience === 'selected' ? [...selectedIds] : undefined,
      )
      setTitle('')
      setMessage('')
      setSelectedIds(new Set())
      await loadHistory()
      pushToast({
        tone: 'success',
        title: `Sent to ${sent.recipientCount} agent${sent.recipientCount === 1 ? '' : 's'}`,
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
        subtitle="A one-way notice to agents, for scheduled maintenance or something new, emailed and shown in-app."
      />

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
            <Segmented<Audience>
              options={[
                { value: 'all', label: 'All agents' },
                { value: 'selected', label: 'Choose agents' },
              ]}
              value={audience}
              onChange={setAudience}
            />
          </div>

          {audience === 'selected' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="border-b border-slate-100 dark:border-slate-800 p-2.5">
                <div className="relative">
                  <SearchIcon className="absolute inset-y-0 left-3 my-auto size-4 text-slate-500 dark:text-slate-400" />
                  <TextInput
                    placeholder="Search agents by name or code"
                    className="pl-9"
                    value={agentSearch}
                    onChange={(event) => setAgentSearch(event.target.value)}
                  />
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto p-2">
                {agents === null ? (
                  <div className="py-6 text-center">
                    <Spinner className="mx-auto size-5 text-brand-600 dark:text-brand-300" />
                  </div>
                ) : visibleAgents.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500 dark:text-slate-400">No agents match that search.</p>
                ) : (
                  visibleAgents.map((agent) => (
                    <label
                      key={agent.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(agent.id)}
                        onChange={() => toggleAgent(agent.id)}
                        className="size-4 rounded border-slate-300 dark:border-slate-600"
                      />
                      <span className="text-sm text-slate-800 dark:text-slate-100">{agent.name}</span>
                      <span className="tabular text-xs text-slate-500 dark:text-slate-400">{agent.referralCode}</span>
                    </label>
                  ))
                )}
              </div>
              {selectedIds.size > 0 && (
                <p className="border-t border-slate-100 dark:border-slate-800 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                  {selectedIds.size} agent{selectedIds.size === 1 ? '' : 's'} selected
                </p>
              )}
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
                    <Badge tone={row.audience === 'all' ? 'brand' : 'neutral'}>
                      {row.audience === 'all' ? 'All agents' : 'Chosen agents'}
                    </Badge>
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
