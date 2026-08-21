import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type AgentApplication } from '../../lib/api'
import { useStore } from '../../state/store'
import { dateTime } from '../../lib/format'
import { prettyPhone } from '../../lib/networks'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  Field,
  Modal,
  Spinner,
  TextInput,
} from '../../components/ui'
import { AlertIcon, CheckIcon, UsersIcon } from '../../components/icons'

/**
 * Agents waiting to be let in.
 *
 * Registration creates the account and stops there. An agent sells under the
 * platform's name and sets the prices its customers pay, so somebody agrees to
 * that before it starts rather than after the first complaint.
 *
 * Shown at the top of Users rather than on a page of its own: whoever is looking
 * at people is the person who should notice that three of them are waiting.
 * Renders nothing at all when the queue is empty, so it is not permanent furniture.
 */
export default function AgentApplications() {
  const { pushToast, refresh } = useStore()
  const [rows, setRows] = useState<AgentApplication[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refusing, setRefusing] = useState<AgentApplication | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await api.applicationQueue())
    } catch {
      // An empty queue and an unreadable one look the same here, and the page
      // this sits on works either way. Failing quietly beats an error banner
      // above a list of users that loaded fine.
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const approve = async (row: AgentApplication) => {
    setBusyId(row.id)
    try {
      await api.approveApplication(row.id)
      await load()
      await refresh()
      pushToast({
        tone: 'success',
        title: `${row.name} can start selling`,
        detail: `We have emailed ${row.email}. Their shop link works now.`,
      })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not approve that.',
      })
    } finally {
      setBusyId(null)
    }
  }

  // Nothing waiting, nothing to show.
  if (rows !== null && rows.length === 0) return null

  return (
    <>
      <Card className="mt-3 border-amber-200">
        <CardHead
          title={
            rows === null
              ? 'Agent applications'
              : `${rows.length} agent${rows.length === 1 ? '' : 's'} waiting to be approved`
          }
          subtitle="They cannot sell until you approve them — their shop link falls back to your standard prices."
        />
        <div className="space-y-3 p-4 sm:p-5">
          {rows === null ? (
            <div className="py-6 text-center">
              <Spinner className="mx-auto size-6 text-brand-600" />
            </div>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{row.name}</p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {row.email} · <span className="tabular">{prettyPhone(row.phone)}</span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{row.referralCode}</Badge>
                    {row.referredBy ? (
                      <span className="text-xs text-slate-600">
                        referred by <strong className="font-semibold">{row.referredBy}</strong>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">signed up directly</span>
                    )}
                    <span className="text-xs text-slate-500">{dateTime(row.appliedAt)}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" loading={busyId === row.id} onClick={() => void approve(row)}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRefusing(row)}>
                    Refuse
                  </Button>
                </div>
              </div>
            ))
          )}

          <Callout tone="info" icon={<UsersIcon className="size-4" />}>
            Approving emails them straight away. Someone who is not told they are approved does not
            start selling.
          </Callout>
        </div>
      </Card>

      <RefuseModal
        application={refusing}
        onClose={() => setRefusing(null)}
        onRefused={async () => {
          await load()
          await refresh()
        }}
      />
    </>
  )
}

/**
 * Refusing needs a reason, and the applicant is shown it.
 *
 * Both when they next try to sign in and by email. Somebody refused without being
 * told why will simply apply again with a different address.
 */
function RefuseModal({
  application,
  onClose,
  onRefused,
}: {
  application: AgentApplication | null
  onClose: () => void
  onRefused: () => Promise<void>
}) {
  const { pushToast } = useStore()
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const key = application?.id ?? 'none'
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setNote('')
    setError('')
  }

  if (!application) return null

  const submit = async () => {
    if (note.trim().length < 5) {
      setError('Say why. They are shown this.')
      return
    }
    setBusy(true)
    try {
      await api.rejectApplication(application.id, note.trim())
      await onRefused()
      pushToast({ tone: 'info', title: `${application.name} was not approved` })
      onClose()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Refuse — ${application.name}`}>
      <div className="space-y-4">
        <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
          They are emailed this reason and shown it when they next sign in. Write it as something
          they can act on.
        </Callout>

        <Field label="Why are you refusing?" htmlFor="refuse-application" error={error}>
          <TextInput
            id="refuse-application"
            placeholder="We could not verify your details — call us to sort it out"
            value={note}
            invalid={Boolean(error)}
            onChange={(event) => {
              setNote(event.target.value)
              setError('')
            }}
          />
        </Field>

        <div className="flex gap-2">
          <Button block variant="outline" loading={busy} onClick={() => void submit()}>
            Refuse application
          </Button>
          <Button block disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** For the dashboard: a small approved marker, reused by Users. */
export function ApprovedBadge() {
  return (
    <Badge tone="success">
      <CheckIcon className="size-3.5" /> approved
    </Badge>
  )
}
