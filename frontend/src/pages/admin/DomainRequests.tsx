import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type AdminDomainRow } from '../../lib/api'
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
  Modal,
  PageHead,
  Segmented,
  Spinner,
  TextInput,
} from '../../components/ui'
import { AlertIcon, GlobeIcon } from '../../components/icons'

type Filter = 'pending' | 'all'

/**
 * Superadmin-only (see `AdminDomainsController`) — approving a domain is
 * vouching that whoever asked for it actually controls it, the same trust
 * decision as creating an admin account. It sits outside James's own admin
 * nav for that reason.
 *
 * `allowed` and `active` are independent on purpose (see the `CustomDomain`
 * model): a domain can be approved but waiting on DNS, or approved and later
 * suspended without losing that approval record. So a row is one of four
 * real states, not three — waiting, approved-not-live, live, or refused —
 * and each gets its own action.
 */
export default function DomainRequests() {
  return (
    <div>
      <PageHead
        title="Custom domains"
        subtitle="Domains agents have asked to point at their own shop."
      />
      <ActionLegend />
      <DomainQueue />
    </div>
  )
}

const LEGEND: { term: string; meaning: string }[] = [
  {
    term: 'Approve',
    meaning:
      "Grants a waiting request permission to use that domain at all. Does not make it live yet — DNS still has to be pointed here first.",
  },
  {
    term: 'Refuse',
    meaning: 'Turns down a waiting request. Needs a reason, which the agent is shown.',
  },
  {
    term: 'Mark as live',
    meaning:
      'Flips an approved domain active — use this once you have actually confirmed it resolves here. This is what makes it start serving the agent\'s shop.',
  },
  {
    term: 'Suspend',
    meaning:
      "Takes a live domain offline temporarily, without withdrawing its approval. Reversible with one click — \"Mark as live\" brings it straight back.",
  },
  {
    term: 'Revoke',
    meaning:
      "Fully withdraws approval — not a pause. Needs a reason, takes the domain offline immediately if it was live, and it will not work again until someone re-approves it.",
  },
  {
    term: 'Approve after all',
    meaning: 'Reconsiders a refused or revoked domain, putting it back in the approved state.',
  },
]

/** A reference for what each action actually changes — collapsed by default once you know it. */
function ActionLegend() {
  return (
    <details className="mt-3 rounded-xl border border-slate-200 dark:border-slate-700 open:bg-slate-50 dark:open:bg-slate-800/60">
      <summary className="cursor-pointer px-3.5 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
        What do these buttons do?
      </summary>
      <dl className="space-y-3 border-t border-slate-100 dark:border-slate-800 px-3.5 py-3.5">
        {LEGEND.map(({ term, meaning }) => (
          <div key={term}>
            <dt className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-50">{term}</dt>
            <dd className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

function DomainQueue() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<AdminDomainRow[] | null>(null)
  const [filter, setFilter] = useState<Filter>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<AdminDomainRow | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await api.adminDomains(filter === 'pending'))
    } catch {
      setRows([])
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (
    row: AdminDomainRow,
    body: { allowed?: boolean; active?: boolean },
    successTitle: string,
  ) => {
    setBusyId(row.id)
    try {
      await api.reviewDomain(row.id, body)
      await load()
      pushToast({ tone: 'success', title: successTitle })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not save that.',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <Card className="mt-3">
        <CardHead
          title="Requests"
          subtitle="Look up who owns a domain before approving it — a shop takes card and Mobile Money details."
          action={
            <Segmented<Filter>
              options={[
                { value: 'pending', label: 'Waiting' },
                { value: 'all', label: 'All' },
              ]}
              value={filter}
              onChange={setFilter}
            />
          }
        />
        <div className="space-y-3 p-4 sm:p-5">
          {rows === null ? (
            <div className="py-8 text-center">
              <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<GlobeIcon className="size-6" />}
              title={filter === 'pending' ? 'Nothing waiting' : 'No domains yet'}
              detail={
                filter === 'pending'
                  ? 'No agent has asked for a custom domain.'
                  : 'No agent has ever requested one.'
              }
            />
          ) : (
            rows.map((row) => (
              <DomainRow
                key={row.id}
                row={row}
                busy={busyId === row.id}
                onApprove={() => void act(row, { allowed: true }, `${row.domain} approved`)}
                onReject={() => setRejecting(row)}
                onGoLive={() => void act(row, { active: true }, `${row.domain} is now live`)}
                onSuspend={() => void act(row, { active: false }, `${row.domain} suspended`)}
                onReconsider={() => void act(row, { allowed: true }, `${row.domain} approved`)}
              />
            ))
          )}
        </div>
      </Card>

      <RejectModal
        request={rejecting}
        onClose={() => setRejecting(null)}
        onRejected={() => load()}
      />
    </>
  )
}

function DomainRow({
  row,
  busy,
  onApprove,
  onReject,
  onGoLive,
  onSuspend,
  onReconsider,
}: {
  row: AdminDomainRow
  busy: boolean
  onApprove: () => void
  onReject: () => void
  onGoLive: () => void
  onSuspend: () => void
  onReconsider: () => void
}) {
  const waiting = row.reviewedAt === null
  const refused = !waiting && !row.allowed
  const live = row.allowed && row.active
  const approvedNotLive = row.allowed && !row.active

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono font-semibold text-slate-900 dark:text-slate-50">{row.domain}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {row.agentName} · {row.agentCode} · requested {dateTime(row.requestedAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {waiting && <Badge tone="warning">waiting</Badge>}
          {live && <Badge tone="success">live</Badge>}
          {approvedNotLive && <Badge tone="info">approved, not live</Badge>}
          {refused && <Badge tone="danger">refused</Badge>}

          {waiting && (
            <>
              <Button size="sm" loading={busy} onClick={onApprove}>
                Approve
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
                Refuse
              </Button>
            </>
          )}
          {approvedNotLive && (
            <>
              <Button size="sm" loading={busy} onClick={onGoLive}>
                Mark as live
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
                Revoke
              </Button>
            </>
          )}
          {live && (
            <>
              <Button size="sm" variant="outline" loading={busy} onClick={onSuspend}>
                Suspend
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
                Revoke
              </Button>
            </>
          )}
          {refused && (
            <Button size="sm" loading={busy} onClick={onReconsider}>
              Approve after all
            </Button>
          )}
        </div>
      </div>

      {refused && row.reason && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-400">Refused: {row.reason}</p>
      )}
    </div>
  )
}

/** Refusing or revoking needs a reason — the agent is shown it either way. */
function RejectModal({
  request,
  onClose,
  onRejected,
}: {
  request: AdminDomainRow | null
  onClose: () => void
  onRejected: () => Promise<void>
}) {
  const { pushToast } = useStore()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const key = request?.id ?? 'none'
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setReason('')
    setError('')
  }

  if (!request) return null
  const wasLive = request.allowed

  const submit = async () => {
    if (reason.trim().length < 5) {
      setError('Say why, so the agent can fix it and try again.')
      return
    }
    setBusy(true)
    try {
      await api.reviewDomain(request.id, { allowed: false, reason: reason.trim() })
      await onRejected()
      pushToast({ tone: 'info', title: `${wasLive ? 'Revoked' : 'Refused'} ${request.domain}` })
      onClose()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`${wasLive ? 'Revoke' : 'Refuse'} — ${request.domain}`}>
      <div className="space-y-4">
        <Callout tone="info" icon={<AlertIcon className="size-4" />}>
          {wasLive
            ? 'This takes the domain offline immediately and clears its approval.'
            : 'The agent sees this message, so write it as something they can act on.'}
        </Callout>

        <Field label="Why?" htmlFor="reject-domain-reason" error={error}>
          <TextInput
            id="reject-domain-reason"
            placeholder="This domain impersonates a known bank"
            value={reason}
            invalid={Boolean(error)}
            onChange={(event) => {
              setReason(event.target.value)
              setError('')
            }}
          />
        </Field>

        <div className="flex gap-2">
          <Button block variant="outline" loading={busy} onClick={() => void submit()}>
            {wasLive ? 'Revoke' : 'Refuse'}
          </Button>
          <Button block disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
