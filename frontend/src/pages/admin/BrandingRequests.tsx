import { useCallback, useEffect, useState } from 'react'
import { apiAsset, api, ApiError, type BrandingRequestRow } from '../../lib/api'
import { useStore } from '../../state/store'
import { deriveBrand } from '../../lib/branding'
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
  QuickReasons,
  Segmented,
  Spinner,
  TextInput,
} from '../../components/ui'
import { AlertIcon, CheckIcon, StoreIcon } from '../../components/icons'

type Filter = 'pending' | 'approved' | 'rejected'

/**
 * The agents' branding queue, split out from the platform owner's own
 * branding screen (`BrandingReview.tsx`): "what does my own platform look
 * like" and "what is this specific agent asking to look like" are different
 * jobs, done at different times, for different reasons, and were sharing one
 * page only because they both touch the word "branding".
 *
 * The queue is the reason agent branding is not self-serve. An agent shop
 * collects card and Mobile Money details, so one convincingly named and badged as
 * a bank is a fraud risk carried by the platform. The review screen therefore
 * shows the submitted logo at a real size and the proposed name in full, the two
 * things that would be used to impersonate somebody.
 */
export default function BrandingRequests() {
  return (
    <div>
      <PageHead
        title="Agent branding requests"
        subtitle="Shop names and logos your agents have asked to use. Nothing here is live until approved."
      />
      <AgentQueue />
    </div>
  )
}

/** Agents waiting to be reviewed. */
function AgentQueue() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<BrandingRequestRow[] | null>(null)
  const [filter, setFilter] = useState<Filter>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<BrandingRequestRow | null>(null)
  /**
   * The one field this whole queue exists to scrutinise for impersonation
   * risk (see the file's own header comment) was a fixed 56×56px thumbnail
   * with no way to actually look closely at it. This zooms it full-size.
   */
  const [zoomedLogo, setZoomedLogo] = useState<{ url: string; agentName: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await api.brandingQueue(filter))
    } catch {
      setRows([])
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const approve = async (row: BrandingRequestRow) => {
    setBusyId(row.id)
    try {
      await api.approveBranding(row.id)
      await load()
      pushToast({ tone: 'success', title: `${row.agentCode}'s shop updated` })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not approve that.',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <Card className="mt-3">
        <CardHead
          title="Agent requests"
          subtitle="Nothing here is live yet. Look at the name and logo before approving, a shop that looks like a bank is your liability."
          action={
            <Segmented<Filter>
              options={[
                { value: 'pending', label: 'Waiting' },
                { value: 'approved', label: 'Approved' },
                { value: 'rejected', label: 'Refused' },
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
              icon={<StoreIcon className="size-6" />}
              title={filter === 'pending' ? 'Nothing waiting' : 'Nothing here'}
              detail={
                filter === 'pending'
                  ? 'No agent has asked to change their shop look.'
                  : 'No requests in this state yet.'
              }
            />
          ) : (
            rows.map((row) => {
              const derived = row.brandColor ? deriveBrand(row.brandColor) : null
              return (
                <div key={row.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {row.logoUrl ? (
                        <button
                          type="button"
                          onClick={() =>
                            setZoomedLogo({ url: apiAsset(row.logoUrl) ?? '', agentName: row.agentName })
                          }
                          className="shrink-0 rounded-xl outline-offset-2 hover:opacity-90"
                          aria-label={`Zoom in on ${row.agentName}'s proposed logo`}
                        >
                          <img
                            src={apiAsset(row.logoUrl) ?? undefined}
                            alt={`${row.agentName}'s proposed logo`}
                            className="size-14 rounded-xl border border-slate-200 dark:border-slate-700 object-contain"
                          />
                        </button>
                      ) : (
                        <span className="flex size-14 items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-xs text-slate-400 dark:text-slate-500">
                          no logo
                        </span>
                      )}
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-50">
                          {row.shopName ?? <span className="text-slate-400 dark:text-slate-500">name unchanged</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {row.agentName} · {row.agentCode} · {dateTime(row.createdAt)}
                        </p>
                        {derived && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <span
                              className="size-4 rounded-full border border-slate-200 dark:border-slate-700"
                              style={{ backgroundColor: derived.ramp[700] }}
                            />
                            <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                              {row.brandColor}
                            </span>
                            {derived.adjusted && (
                              <span className="text-xs text-slate-500 dark:text-slate-400">(darkened)</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {row.status === 'pending' ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          loading={busyId === row.id}
                          onClick={() => void approve(row)}
                        >
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setRejecting(row)}>
                          Refuse
                        </Button>
                      </div>
                    ) : (
                      <Badge tone={row.status === 'approved' ? 'success' : 'danger'}>
                        {row.status === 'approved' ? (
                          <>
                            <CheckIcon className="size-3.5" /> approved
                          </>
                        ) : (
                          'refused'
                        )}
                      </Badge>
                    )}
                  </div>

                  {row.note && <p className="mt-2 text-xs text-red-700 dark:text-red-400">Refused: {row.note}</p>}
                </div>
              )
            })
          )}
        </div>
      </Card>

      <RefuseModal
        request={rejecting}
        onClose={() => setRejecting(null)}
        onRefused={async () => {
          await load()
        }}
      />

      {zoomedLogo && (
        <Modal open onClose={() => setZoomedLogo(null)} title={`${zoomedLogo.agentName}'s proposed logo`}>
          <img
            src={zoomedLogo.url}
            alt={`${zoomedLogo.agentName}'s proposed logo, enlarged`}
            className="mx-auto max-h-[60vh] w-full rounded-xl border border-slate-200 dark:border-slate-700 object-contain"
          />
        </Modal>
      )}
    </>
  )
}

/** Refusing needs a reason, and the agent is shown it so they can fix it. */
function RefuseModal({
  request,
  onClose,
  onRefused,
}: {
  request: BrandingRequestRow | null
  onClose: () => void
  onRefused: () => Promise<void>
}) {
  const { pushToast } = useStore()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const key = request?.id ?? 'none'
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setNote('')
    setError('')
  }

  if (!request) return null

  const submit = async () => {
    if (note.trim().length < 5) {
      setError('Say why, so they can fix it and try again.')
      return
    }
    setBusy(true)
    try {
      await api.rejectBranding(request.id, note.trim())
      await onRefused()
      pushToast({ tone: 'info', title: `Refused ${request.agentCode}'s branding` })
      onClose()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Refuse, ${request.agentCode}`}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Callout tone="info" icon={<AlertIcon className="size-4" />}>
          The agent sees this message, so write it as something they can act on.
        </Callout>

        <QuickReasons
          options={[
            'Looks like a bank or network logo',
            'Name impersonates another business',
            'Logo image is too low quality to use',
          ]}
          onPick={(text) => {
            setNote(text)
            setError('')
          }}
        />

        <Field label="Why are you refusing it?" htmlFor="refuse-branding" error={error}>
          <TextInput
            id="refuse-branding"
            placeholder="The logo is MTN's, use your own mark"
            value={note}
            invalid={Boolean(error)}
            onChange={(event) => {
              setNote(event.target.value)
              setError('')
            }}
          />
        </Field>

        <div className="flex gap-2">
          <Button type="submit" block variant="outline" loading={busy}>
            Refuse
          </Button>
          <Button type="button" block disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
