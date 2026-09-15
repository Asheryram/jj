import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError, type AdminFeedbackReport, type FeedbackCategory, type FeedbackStatus } from '../../lib/api'
import { useStore } from '../../state/store'
import { dateTime } from '../../lib/format'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  EmptyState,
  Field,
  PageHead,
  Segmented,
  Spinner,
  Textarea,
  Toggle,
} from '../../components/ui'
import { HelpIcon } from '../../components/icons'

type StatusFilter = FeedbackStatus | 'all'
type CategoryFilter = FeedbackCategory | 'all'

/**
 * What agents have sent in from inside the app. See `FeedbackReport` on the
 * backend. Admin sees the whole inbox; superadmin sees only what's been
 * escalated to them, see `FeedbackService.list`'s own doc comment for why.
 *
 * Escalating is the one action that isn't shared: only admin sees the
 * button, since superadmin already only sees escalated items and escalating
 * to yourself has no meaning. See `FeedbackService.escalate`.
 */
export default function AdminFeedback() {
  const { session, pushToast } = useStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const isSuperadmin = session?.role === 'superadmin'

  const [rows, setRows] = useState<AdminFeedbackReport[] | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [escalatedOnly, setEscalatedOnly] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      setRows(
        await api.adminFeedback({
          status: statusFilter === 'all' ? undefined : statusFilter,
          category: categoryFilter === 'all' ? undefined : categoryFilter,
          escalated: escalatedOnly || undefined,
        }),
      )
    } catch {
      setRows([])
    }
  }, [statusFilter, categoryFilter, escalatedOnly])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * The item an escalation email's "Open this ticket" link points at,
   * loaded on its own. The inbox's own filters would otherwise have to
   * happen to already match, or a linked item would silently not appear.
   * Shown in its own card above the filtered list regardless of what the
   * filters are currently set to.
   */
  const linkedItemId = searchParams.get('item')
  const [linkedItem, setLinkedItem] = useState<AdminFeedbackReport | null | 'loading' | 'error'>(null)
  useEffect(() => {
    if (!linkedItemId) {
      setLinkedItem(null)
      return
    }
    let live = true
    setLinkedItem('loading')
    api
      .adminFeedbackItem(linkedItemId)
      .then((item) => live && setLinkedItem(item))
      .catch(() => live && setLinkedItem('error'))
    return () => {
      live = false
    }
  }, [linkedItemId])

  const dismissLinkedItem = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('item')
    setSearchParams(next, { replace: true })
  }

  /**
   * Patches whichever of `rows`/`linkedItem` currently holds this row,
   * rather than re-fetching under the current filter. A re-fetch was the
   * first version of this: marking something "reviewed" while viewing the
   * "Open" tab made it vanish mid-task, right when an admin most likely
   * wants to follow up by marking it resolved next. The row now stays where
   * it was clicked until the admin actually changes the filter or reloads.
   */
  const applyUpdate = (updated: AdminFeedbackReport) => {
    setRows((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? prev)
    setLinkedItem((prev) => (prev && prev !== 'loading' && prev !== 'error' && prev.id === updated.id ? updated : prev))
  }

  const decide = async (row: AdminFeedbackReport, status: FeedbackStatus) => {
    setBusyId(row.id)
    try {
      const updated = await api.decideFeedback(row.id, status, noteDrafts[row.id])
      applyUpdate(updated)
      pushToast({ tone: 'success', title: `Marked ${status}` })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not save that.',
      })
    } finally {
      setBusyId(null)
    }
  }

  const escalate = async (row: AdminFeedbackReport) => {
    setBusyId(row.id)
    try {
      const updated = await api.escalateFeedback(row.id)
      applyUpdate(updated)
      pushToast({
        tone: 'success',
        title: 'Escalated to the platform team',
        detail: 'Active superadmins have been emailed.',
      })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not escalate that.',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <PageHead
        title="Feedback"
        subtitle={
          isSuperadmin
            ? 'Only what admin has escalated as needing the platform side, not the full agent inbox.'
            : 'Suggestions and problem reports agents have sent in from inside the app.'
        }
      />

      {linkedItemId && linkedItem === 'loading' && (
        <Card className="mt-3">
          <div className="py-6 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        </Card>
      )}
      {linkedItemId && linkedItem === 'error' && (
        <Callout tone="danger" className="mt-3">
          That link no longer resolves. The item may have been deleted, or it was never escalated to you.
        </Callout>
      )}
      {linkedItemId && linkedItem && linkedItem !== 'loading' && linkedItem !== 'error' && (
        <Card className="mt-3 border-brand-200 dark:border-brand-800">
          <CardHead
            title="Linked from your email"
            action={
              <Button size="sm" variant="ghost" onClick={dismissLinkedItem}>
                Dismiss
              </Button>
            }
          />
          <div className="p-4 sm:p-5">
            <FeedbackRow
              row={linkedItem}
              isAdmin={session?.role === 'admin'}
              busy={busyId === linkedItem.id}
              note={noteDrafts[linkedItem.id] ?? linkedItem.note ?? ''}
              onNoteChange={(text) => setNoteDrafts((prev) => ({ ...prev, [linkedItem.id]: text }))}
              onDecide={(status) => void decide(linkedItem, status)}
              onEscalate={() => void escalate(linkedItem)}
            />
          </div>
        </Card>
      )}

      <Card className="mt-3">
        <CardHead
          title="Inbox"
          subtitle="Newest first, this is a suggestion box, not a wait line."
          action={
            <Segmented<StatusFilter>
              options={[
                { value: 'open', label: 'Open' },
                { value: 'reviewed', label: 'Reviewed' },
                { value: 'resolved', label: 'Resolved' },
                { value: 'all', label: 'All' },
              ]}
              value={statusFilter}
              onChange={setStatusFilter}
            />
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 px-4 py-3 sm:px-5">
          <Segmented<CategoryFilter>
            options={[
              { value: 'all', label: 'All kinds' },
              { value: 'suggestion', label: 'Suggestions' },
              { value: 'issue', label: 'Issues' },
            ]}
            value={categoryFilter}
            onChange={setCategoryFilter}
          />
          {/* Superadmin only ever sees escalated items anyway, see the page
              subtitle above, so the toggle would just be a permanently-on
              no-op for them. */}
          {!isSuperadmin && (
            <Toggle
              id="escalated-only"
              label="Escalated only"
              checked={escalatedOnly}
              onChange={setEscalatedOnly}
            />
          )}
        </div>
        <div className="space-y-3 p-4 sm:p-5">
          {rows === null ? (
            <div className="py-8 text-center">
              <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<HelpIcon className="size-6" />}
              title="Nothing here"
              detail={
                isSuperadmin
                  ? 'Nothing escalated to the platform team right now.'
                  : escalatedOnly
                    ? 'Nothing escalated to the platform team right now.'
                    : statusFilter === 'open'
                      ? 'No open feedback right now.'
                      : 'Nothing in this view yet.'
              }
            />
          ) : (
            rows.map((row) => (
              <div key={row.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <FeedbackRow
                  row={row}
                  isAdmin={session?.role === 'admin'}
                  busy={busyId === row.id}
                  note={noteDrafts[row.id] ?? row.note ?? ''}
                  onNoteChange={(text) => setNoteDrafts((prev) => ({ ...prev, [row.id]: text }))}
                  onDecide={(status) => void decide(row, status)}
                  onEscalate={() => void escalate(row)}
                />
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  )
}

/** One feedback item's badges, message, and actions, shared between the inbox list and the linked-from-email card. */
function FeedbackRow({
  row,
  isAdmin,
  busy,
  note,
  onNoteChange,
  onDecide,
  onEscalate,
}: {
  row: AdminFeedbackReport
  isAdmin: boolean
  busy: boolean
  note: string
  onNoteChange: (text: string) => void
  onDecide: (status: FeedbackStatus) => void
  onEscalate: () => void
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={row.category === 'issue' ? 'warning' : 'neutral'}>
              {row.category === 'issue' ? 'Issue' : 'Suggestion'}
            </Badge>
            <StatusPill status={row.status} />
            {row.escalated && <Badge tone="danger">Escalated</Badge>}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">{row.message}</p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {row.agentName} · {row.agentCode} · {dateTime(row.createdAt)}
          </p>
        </div>

        {isAdmin && !row.escalated && (
          <Button size="sm" variant="outline" loading={busy} onClick={onEscalate}>
            Escalate to superadmin
          </Button>
        )}
      </div>

      {row.status !== 'resolved' && (
        <div className="mt-3 space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
          <Field label="Note (optional)" htmlFor={`feedback-note-${row.id}`}>
            <Textarea
              id={`feedback-note-${row.id}`}
              rows={2}
              placeholder="What's being done, or why it won't be"
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {row.status === 'open' && (
              <Button size="sm" variant="outline" loading={busy} onClick={() => onDecide('reviewed')}>
                Mark reviewed
              </Button>
            )}
            <Button size="sm" loading={busy} onClick={() => onDecide('resolved')}>
              Mark resolved
            </Button>
          </div>
        </div>
      )}

      {row.status === 'resolved' && row.note && (
        <p className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-2.5 text-xs text-slate-600 dark:text-slate-300">
          {row.note}
        </p>
      )}
      {row.status === 'resolved' && (
        <Button size="sm" variant="ghost" className="mt-2" loading={busy} onClick={() => onDecide('open')}>
          Reopen
        </Button>
      )}
    </>
  )
}

function StatusPill({ status }: { status: FeedbackStatus }) {
  if (status === 'resolved') return <Badge tone="success">Resolved</Badge>
  if (status === 'reviewed') return <Badge tone="info">Reviewed</Badge>
  return <Badge tone="warning">Open</Badge>
}
