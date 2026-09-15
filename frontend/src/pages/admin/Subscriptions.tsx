import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type ServiceSubscription } from '../../lib/api'
import { useStore } from '../../state/store'
import { dateTime } from '../../lib/format'
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Field,
  Modal,
  PageHead,
  Spinner,
  TextInput,
} from '../../components/ui'
import { AlertIcon, ClockIcon } from '../../components/icons'

/**
 * Third-party services this platform depends on to keep running, watched
 * for an approaching expiry. See `ServiceSubscription` on the backend for
 * why the date is entered by hand rather than discovered automatically.
 */
export default function Subscriptions() {
  const { session, pushToast } = useStore()
  // Superadmin actually holds these accounts and billing relationships, so
  // renewing one is theirs to do. Admin runs the business and needs to see
  // what could take it down, which is why viewing stays shared, see
  // `SubscriptionsController`'s own doc comment for the same split applied
  // to `/admin/domains` and `/admin/team`.
  const canManage = session?.role === 'superadmin'
  const [rows, setRows] = useState<ServiceSubscription[] | null>(null)
  const [editing, setEditing] = useState<ServiceSubscription | 'new' | null>(null)
  const [removing, setRemoving] = useState<ServiceSubscription | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setRows(await api.subscriptions())
    } catch {
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await api.deleteSubscription(removing.id)
      await load()
      pushToast({ tone: 'success', title: `${removing.name} removed` })
      setRemoving(null)
    } catch (caught) {
      pushToast({ tone: 'error', title: caught instanceof ApiError ? caught.message : 'We could not remove that.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHead
        title="Subscriptions"
        subtitle={
          canManage
            ? 'What this platform pays for to keep running. Add a renewal date and get told before it lapses.'
            : "What this platform pays for to keep running. The platform team renews these; you're seeing what's coming up."
        }
        action={canManage ? <Button onClick={() => setEditing('new')}>Add a service</Button> : undefined}
      />

      <Card className="mt-3">
        <CardHead title="Tracked services" />
        <div className="space-y-2 p-4 sm:p-5">
          {rows === null ? (
            <div className="py-8 text-center">
              <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<ClockIcon className="size-6" />}
              title="Nothing tracked yet"
              detail={
                canManage
                  ? 'Add hosting, the domain, Paystack, DataHub, and anything else with a renewal date.'
                  : 'The platform team has not added anything to watch yet.'
              }
              action={canManage ? <Button onClick={() => setEditing('new')}>Add a service</Button> : undefined}
            />
          ) : (
            rows.map((row) => (
              <div key={row.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-semibold text-slate-900 dark:text-slate-50">{row.name}</p>
                      {row.provider && (
                        <span className="text-xs text-slate-500 dark:text-slate-400">{row.provider}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Expires {dateTime(row.expiresAt)}
                    </p>
                    {row.notes && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{row.notes}</p>}
                    {row.renewalUrl && (
                      <a
                        href={row.renewalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-sm font-medium text-brand-700 dark:text-brand-300 hover:underline"
                      >
                        Renew it
                      </a>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <ExpiryBadge row={row} />
                    {canManage && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(row)}>
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {editing && (
        <EditModal
          subscription={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}

      {removing && (
        <Modal open onClose={() => setRemoving(null)} title={`Remove ${removing.name}`}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              This stops watching {removing.name} for an approaching expiry. It does not cancel or affect the
              service itself.
            </p>
            <div className="flex gap-2">
              <Button block variant="danger" loading={busy} onClick={() => void remove()}>
                Remove
              </Button>
              <Button block variant="outline" disabled={busy} onClick={() => setRemoving(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function ExpiryBadge({ row }: { row: ServiceSubscription }) {
  if (row.status === 'expired') {
    return (
      <Badge tone="danger">
        <AlertIcon className="size-3.5" /> expired {Math.abs(row.daysUntilExpiry)}d ago
      </Badge>
    )
  }
  if (row.status === 'expiring_soon') {
    return (
      <Badge tone="warning">
        <ClockIcon className="size-3.5" /> {row.daysUntilExpiry}d left
      </Badge>
    )
  }
  return <Badge tone="success">{row.daysUntilExpiry}d left</Badge>
}

/** ISO date (yyyy-mm-dd) for a date input, from an ISO datetime string or nothing for a new row. */
function toDateInputValue(iso?: string): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function EditModal({
  subscription,
  onClose,
  onSaved,
}: {
  subscription: ServiceSubscription | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { pushToast } = useStore()
  const [name, setName] = useState(subscription?.name ?? '')
  const [provider, setProvider] = useState(subscription?.provider ?? '')
  const [expiresAt, setExpiresAt] = useState(toDateInputValue(subscription?.expiresAt))
  const [alertDaysBefore, setAlertDaysBefore] = useState(String(subscription?.alertDaysBefore ?? 14))
  const [renewalUrl, setRenewalUrl] = useState(subscription?.renewalUrl ?? '')
  const [notes, setNotes] = useState(subscription?.notes ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (name.trim().length < 2) {
      setError('Name it, two characters minimum.')
      return
    }
    if (!expiresAt) {
      setError('Pick an expiry date.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const body = {
        name: name.trim(),
        provider: provider.trim() || undefined,
        renewalUrl: renewalUrl.trim() || undefined,
        notes: notes.trim() || undefined,
        expiresAt: new Date(`${expiresAt}T00:00:00`).toISOString(),
        alertDaysBefore: Number(alertDaysBefore) || 14,
      }
      if (subscription) {
        await api.updateSubscription(subscription.id, body)
      } else {
        await api.createSubscription(body)
      }
      pushToast({ tone: 'success', title: subscription ? 'Updated' : 'Added' })
      await onSaved()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={subscription ? `Edit ${subscription.name}` : 'Add a service'}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Field label="Name" htmlFor="sub-name">
          <TextInput
            id="sub-name"
            placeholder="Render hosting"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Provider (optional)" htmlFor="sub-provider">
          <TextInput
            id="sub-provider"
            placeholder="Render"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
          />
        </Field>
        <Field label="Expires on" htmlFor="sub-expires" error={error}>
          <TextInput
            id="sub-expires"
            type="date"
            value={expiresAt}
            invalid={Boolean(error)}
            onChange={(event) => {
              setExpiresAt(event.target.value)
              setError('')
            }}
          />
        </Field>
        <Field label="Warn this many days before" htmlFor="sub-alert-days" hint="A domain worth extra lead time can use a bigger number than a plan you just need a card on file for.">
          <TextInput
            id="sub-alert-days"
            type="number"
            min={1}
            max={365}
            value={alertDaysBefore}
            onChange={(event) => setAlertDaysBefore(event.target.value)}
          />
        </Field>
        <Field label="Where to renew it (optional)" htmlFor="sub-renewal-url">
          <TextInput
            id="sub-renewal-url"
            placeholder="https://dashboard.render.com/billing"
            value={renewalUrl}
            onChange={(event) => setRenewalUrl(event.target.value)}
          />
        </Field>
        <Field label="Notes (optional)" htmlFor="sub-notes">
          <TextInput
            id="sub-notes"
            placeholder="Billed annually, card ending 4242"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>

        <div className="flex gap-2">
          <Button type="submit" block loading={busy}>
            {subscription ? 'Save changes' : 'Add it'}
          </Button>
          <Button type="button" block variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
