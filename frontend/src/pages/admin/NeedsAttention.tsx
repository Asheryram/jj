import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type NeedsAttentionOrder } from '../../lib/api'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
import {
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
import { AlertIcon, CheckIcon } from '../../components/icons'

/**
 * Orders nobody can resolve automatically — see `ReconcilerService.needsAttention`.
 *
 * The reason this page exists at all: DataHub occasionally gives back a
 * reference whose status check gets stuck reporting "processing" forever,
 * and the reconciler correctly refuses to guess at closing it out — settling
 * it wrong risks either crediting an agent for a sale that never happened, or
 * refunding a customer who already received their bundle. Without somewhere
 * surfacing that, the only way anyone finds out is a customer complaining
 * after they already got it.
 *
 * A dedicated page, not a card on Overview: this is an operational queue —
 * something to act on — and every other queue like it (Refunds, Withdrawals,
 * Number approvals) already lives on its own page rather than inline on the
 * dashboard. Overview only ever says how many are waiting.
 */
export default function NeedsAttention() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<NeedsAttentionOrder[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [resolving, setResolving] = useState<NeedsAttentionOrder | null>(null)
  const [outcome, setOutcome] = useState<'delivered' | 'rejected'>('delivered')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      setRows(await api.needsAttentionOrders())
    } catch {
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async () => {
    if (!resolving) return
    if (note.trim().length < 5) return
    setBusyId(resolving.id)
    try {
      await api.resolveOrder(resolving.id, outcome, note.trim())
      pushToast({ tone: 'success', title: `${resolving.reference} marked ${outcome}` })
      setResolving(null)
      setNote('')
      await load()
    } catch (caught) {
      pushToast({ tone: 'error', title: caught instanceof ApiError ? caught.message : 'We could not save that.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <PageHead
        title="Needs your attention"
        subtitle="Stuck at the provider — the reconciler will not guess at these, so they wait for a decision."
      />

      <Card className="mt-3">
        <CardHead
          title="Stuck orders"
          subtitle="Oldest first — the longest wait is the most urgent thing here, not the largest amount."
        />
        <div className="space-y-2 p-4 sm:p-5">
          {rows === null ? (
            <div className="py-8 text-center">
              <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<CheckIcon className="size-6" />}
              title="Nothing stuck right now"
              detail="Every order has either delivered, failed, or is still within the provider's normal reply window."
            />
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3"
              >
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">
                    {row.reference} · {row.productName} · {cedis(row.salePrice)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {row.reason} · to {row.recipient} · placed {dateTime(row.createdAt)}
                    {row.providerReference ? ` · ref ${row.providerReference}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  loading={busyId === row.id}
                  onClick={() => {
                    setResolving(row)
                    setOutcome('delivered')
                    setNote('')
                  }}
                >
                  Resolve by hand
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>

      {resolving && (
        <Modal open onClose={() => setResolving(null)} title={`Resolve ${resolving.reference} by hand`}>
          <div className="space-y-4">
            <Callout tone="info" icon={<AlertIcon className="size-4" />}>
              This runs through the same settlement path a real confirmation would — the agent is credited (or the
              refund queued) exactly as if DataHub or Paystack had reported it themselves.
            </Callout>
            <Segmented<'delivered' | 'rejected'>
              options={[
                { value: 'delivered', label: 'Actually delivered' },
                { value: 'rejected', label: 'Actually failed' },
              ]}
              value={outcome}
              onChange={setOutcome}
            />
            <Field label="Why are you resolving this by hand?" htmlFor="needs-attention-note">
              <TextInput
                id="needs-attention-note"
                placeholder="Customer confirmed they received the bundle"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button block loading={busyId === resolving.id} onClick={() => void submit()}>
                Confirm
              </Button>
              <Button block variant="outline" disabled={busyId === resolving.id} onClick={() => setResolving(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
