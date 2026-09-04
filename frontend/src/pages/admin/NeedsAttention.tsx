import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type NeedsAttentionOrder } from '../../lib/api'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
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
import { AlertIcon, CheckIcon } from '../../components/icons'

/**
 * Orders nobody can resolve automatically — see `ReconcilerService.needsAttention`.
 *
 * Two different shapes of "nobody can resolve this" show up here:
 *
 *  · **Stuck.** DataHub occasionally gives back a reference whose status check
 *    gets stuck reporting "processing" forever, and the reconciler correctly
 *    refuses to guess at closing it out — settling it wrong risks either
 *    crediting an agent for a sale that never happened, or refunding a
 *    customer who already received their bundle.
 *  · **Flagged.** An order was already settled one way, and a later signal —
 *    the provider's own webhook, another admin, or the reconciler's own sweep
 *    — disagreed with that. Nothing here ever undoes that automatically; see
 *    `FulfilmentService.settle`'s conflict detection. This only makes sure a
 *    human finds out, which is the whole point of this page existing.
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
  const [acknowledging, setAcknowledging] = useState<NeedsAttentionOrder | null>(null)
  const [ackNote, setAckNote] = useState('')

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

  const submitAck = async () => {
    if (!acknowledging) return
    if (ackNote.trim().length < 5) return
    setBusyId(acknowledging.id)
    try {
      await api.acknowledgeOrderConflict(acknowledging.id, ackNote.trim())
      pushToast({ tone: 'success', title: `${acknowledging.reference} acknowledged` })
      setAcknowledging(null)
      setAckNote('')
      await load()
    } catch (caught) {
      pushToast({ tone: 'error', title: caught instanceof ApiError ? caught.message : 'We could not save that.' })
    } finally {
      setBusyId(null)
    }
  }

  const conflicts = (rows ?? []).filter((r) => r.conflict)
  const stuck = (rows ?? []).filter((r) => !r.conflict)

  return (
    <div>
      <PageHead
        title="Needs your attention"
        subtitle="Stuck at the provider, or flagged after settling one way and then hearing another — the reconciler will not guess at either."
      />

      {rows !== null && conflicts.length > 0 && (
        <Card className="mt-3 border-red-200 dark:border-red-800">
          <CardHead
            title="Flagged for review"
            subtitle="Already settled one way, then told another — check nothing was paid out twice"
          />
          <div className="space-y-2 p-4 sm:p-5">
            {conflicts.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-950/30 p-3"
              >
                <div>
                  <p className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-50">
                    {row.reference} · {row.productName} · {cedis(row.salePrice)}
                    <Badge tone="danger">Conflict</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{row.reason}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    to {row.recipient} · placed {dateTime(row.createdAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  loading={busyId === row.id}
                  onClick={() => {
                    setAcknowledging(row)
                    setAckNote('')
                  }}
                >
                  Acknowledge
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

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
          ) : stuck.length === 0 ? (
            <EmptyState
              icon={<CheckIcon className="size-6" />}
              title="Nothing stuck right now"
              detail="Every order has either delivered, failed, or is still within the provider's normal reply window."
            />
          ) : (
            stuck.map((row) => (
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

      {acknowledging && (
        <Modal open onClose={() => setAcknowledging(null)} title={`Acknowledge ${acknowledging.reference}`}>
          <div className="space-y-4">
            <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
              {acknowledging.reason}
            </Callout>
            <Callout tone="info">
              This does not change the order or move any money — it only clears the flag once you have
              checked what actually happened, against Paystack's or DataHub's own dashboard, or the
              customer directly. If anything needs fixing (a refund clawed back, an extra one issued),
              do that separately first.
            </Callout>
            <Field label="What did you check?" htmlFor="ack-note">
              <TextInput
                id="ack-note"
                placeholder="Checked DataHub's dashboard — the bundle was never actually sent"
                value={ackNote}
                onChange={(event) => setAckNote(event.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button block loading={busyId === acknowledging.id} onClick={() => void submitAck()}>
                Acknowledge
              </Button>
              <Button
                block
                variant="outline"
                disabled={busyId === acknowledging.id}
                onClick={() => setAcknowledging(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
