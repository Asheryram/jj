import { useCallback, useEffect, useRef, useState } from 'react'
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
  Segmented,
  Spinner,
  TextInput,
} from '../../components/ui'
import { AlertIcon, CheckIcon, StoreIcon } from '../../components/icons'

type Filter = 'pending' | 'approved' | 'rejected'

/**
 * The platform's own branding, and the agents' branding queue.
 *
 * Both on one screen because they are the same job seen from two sides: what the
 * platform looks like, and what each agent is asking to look like.
 *
 * The queue is the reason agent branding is not self-serve. An agent shop
 * collects card and Mobile Money details, so one convincingly named and badged as
 * a bank is a fraud risk carried by the platform. The review screen therefore
 * shows the submitted logo at a real size and the proposed name in full — the two
 * things that would be used to impersonate somebody.
 */
export default function BrandingReview() {
  return (
    <div>
      <PageHead
        title="Branding"
        subtitle="Your own shop's name, logo and colour — and the changes your agents have asked for."
      />
      <PlatformBranding />
      <AgentQueue />
    </div>
  )
}

/** James's own branding. No queue — it is his platform. */
function PlatformBranding() {
  const { pushToast } = useStore()
  const [shopName, setShopName] = useState('')
  const [color, setColor] = useState('')
  const [logo, setLogo] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .branding(null)
      .then((b) => {
        setShopName(b.shopName)
        setColor(b.brandColor)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const derived = deriveBrand(color || '#0B3B8F')

  const save = async () => {
    const form = new FormData()
    if (shopName.trim()) form.set('shopName', shopName.trim())
    if (derived) form.set('brandColor', derived.requested)
    if (logo) form.set('logo', logo)

    setBusy(true)
    try {
      await api.setPlatformBranding(form)
      setLogo(null)
      if (fileInput.current) fileInput.current.value = ''
      pushToast({
        tone: 'success',
        title: 'Branding updated',
        // It applies at once, but the theme is read when the app loads, so a
        // reload is what makes it visible. Saying so avoids "it did nothing".
        detail: 'Reload the page to see the new colour everywhere.',
      })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not save that.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mt-3">
      <CardHead
        title="Your platform"
        subtitle="Applies everywhere except an agent's own shop, where their approved branding wins."
      />
      <div className="space-y-4 p-4 sm:p-5">
        {!loaded ? (
          <div className="py-6 text-center">
            <Spinner className="mx-auto size-6 text-brand-600" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Platform name" htmlFor="platform-name">
                <TextInput
                  id="platform-name"
                  value={shopName}
                  maxLength={40}
                  onChange={(event) => setShopName(event.target.value)}
                />
              </Field>
              <Field label="Brand colour" htmlFor="platform-color">
                <div className="flex items-center gap-2">
                  <input
                    id="platform-color"
                    type="color"
                    value={derived?.requested ?? '#0B3B8F'}
                    onChange={(event) => setColor(event.target.value)}
                    className="h-11 w-16 cursor-pointer rounded-xl border border-slate-200 bg-white p-1"
                  />
                  <TextInput
                    value={color}
                    className="font-mono"
                    invalid={!derived}
                    onChange={(event) => setColor(event.target.value)}
                  />
                </div>
              </Field>
            </div>

            <Field
              label="Logo"
              htmlFor="platform-logo"
              hint="PNG, JPEG or WebP under 100KB. SVG is refused — it can carry scripts."
            >
              <input
                ref={fileInput}
                id="platform-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="block w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-700"
                onChange={(event) => setLogo(event.target.files?.[0] ?? null)}
              />
            </Field>

            {derived && (
              <div className="flex flex-wrap items-center gap-1.5">
                {Object.entries(derived.ramp).map(([step, hex]) => (
                  <div
                    key={step}
                    className="size-8 rounded-lg border border-slate-200"
                    style={{ backgroundColor: hex }}
                    title={`${step} · ${hex}`}
                  />
                ))}
                {derived.adjusted && (
                  <span className="ml-2 text-xs text-slate-500">
                    buttons darkened so white text stays readable
                  </span>
                )}
              </div>
            )}

            <Button loading={busy} onClick={() => void save()}>
              Save platform branding
            </Button>
          </>
        )}
      </div>
    </Card>
  )
}

/** Agents waiting to be reviewed. */
function AgentQueue() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<BrandingRequestRow[] | null>(null)
  const [filter, setFilter] = useState<Filter>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<BrandingRequestRow | null>(null)

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
          subtitle="Nothing here is live yet. Look at the name and logo before approving — a shop that looks like a bank is your liability."
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
              <Spinner className="mx-auto size-6 text-brand-600" />
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
                <div key={row.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {row.logoUrl ? (
                        <img
                          src={apiAsset(row.logoUrl) ?? undefined}
                          alt={`${row.agentName}'s proposed logo`}
                          className="size-14 rounded-xl border border-slate-200 object-contain"
                        />
                      ) : (
                        <span className="flex size-14 items-center justify-center rounded-xl border border-dashed border-slate-300 text-xs text-slate-400">
                          no logo
                        </span>
                      )}
                      <div>
                        <p className="font-semibold text-slate-900">
                          {row.shopName ?? <span className="text-slate-400">name unchanged</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {row.agentName} · {row.agentCode} · {dateTime(row.createdAt)}
                        </p>
                        {derived && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <span
                              className="size-4 rounded-full border border-slate-200"
                              style={{ backgroundColor: derived.ramp[700] }}
                            />
                            <span className="font-mono text-xs text-slate-600">
                              {row.brandColor}
                            </span>
                            {derived.adjusted && (
                              <span className="text-xs text-slate-500">(darkened)</span>
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

                  {row.note && <p className="mt-2 text-xs text-red-700">Refused: {row.note}</p>}
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
    <Modal open onClose={onClose} title={`Refuse — ${request.agentCode}`}>
      <div className="space-y-4">
        <Callout tone="info" icon={<AlertIcon className="size-4" />}>
          The agent sees this message, so write it as something they can act on.
        </Callout>

        <Field label="Why are you refusing it?" htmlFor="refuse-branding" error={error}>
          <TextInput
            id="refuse-branding"
            placeholder="The logo is MTN's — use your own mark"
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
            Refuse
          </Button>
          <Button block disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
