import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type NeedsAttentionOrder, type StuckTransfer } from '../../lib/api'
import type { Order } from '../../data/types'
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
  Spinner,
  TextInput,
} from '../../components/ui'
import { AlertIcon, CheckIcon } from '../../components/icons'
import { DispatchModal } from '../../components/DispatchModal'

/**
 * Orders nobody can resolve automatically, see `ReconcilerService.needsAttention`.
 *
 * Two different shapes of "nobody can resolve this" show up here:
 *
 *  · **Stuck.** DataHub occasionally gives back a reference whose status check
 *    gets stuck reporting "processing" forever, and the reconciler correctly
 *    refuses to guess at closing it out, settling it wrong risks either
 *    crediting an agent for a sale that never happened, or refunding a
 *    customer who already received their bundle.
 *  · **Flagged.** An order was already settled one way, and a later signal,
 *    the provider's own webhook, another admin, or the reconciler's own sweep,
 *    disagreed with that. Nothing here ever undoes that automatically; see
 *    `FulfilmentService.settle`'s conflict detection. This only makes sure a
 *    human finds out, which is the whole point of this page existing.
 *
 * A dedicated page, not a card on Overview: this is an operational queue,
 * something to act on, and every other queue like it (Refunds, Withdrawals,
 * Number approvals) already lives on its own page rather than inline on the
 * dashboard. Overview only ever says how many are waiting.
 */
export default function NeedsAttention() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<NeedsAttentionOrder[] | null>(null)
  const [transfers, setTransfers] = useState<StuckTransfer[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  /**
   * The full order behind a stuck row, fetched on demand: `NeedsAttentionOrder`
   * is a lean summary shape (no `status`, no dispatch history), but the actual
   * resolve decision needs the same attempt-by-attempt detail and the same
   * retry/check-now/mark-by-hand actions available from the main orders table,
   * not a thinner version of them. See `DispatchModal`.
   */
  const [inspecting, setInspecting] = useState<Order | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [acknowledging, setAcknowledging] = useState<NeedsAttentionOrder | null>(null)
  const [ackNote, setAckNote] = useState('')

  const load = useCallback(async () => {
    try {
      setRows(await api.needsAttentionOrders())
    } catch {
      setRows([])
    }
    try {
      setTransfers(await api.stuckTransfers())
    } catch {
      setTransfers([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openResolve = async (row: NeedsAttentionOrder) => {
    setOpening(row.id)
    try {
      setInspecting(await api.order(row.id))
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not open that order.',
      })
    } finally {
      setOpening(null)
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
        subtitle="Stuck at the provider, or flagged after settling one way and then hearing another, the reconciler will not guess at either."
      />

      {rows !== null && conflicts.length > 0 && (
        <Card className="mt-3 border-red-200 dark:border-red-800">
          <CardHead
            title="Flagged for review"
            subtitle="Already settled one way, then told another, check nothing was paid out twice"
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
          subtitle="Oldest first, the longest wait is the most urgent thing here, not the largest amount."
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
                  loading={opening === row.id}
                  onClick={() => void openResolve(row)}
                >
                  Resolve by hand
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>

      {transfers !== null && transfers.length > 0 && (
        <Card className="mt-3">
          <CardHead
            title="Stuck transfers"
            subtitle="Sitting on an OTP challenge or an unresolved reply from Paystack, check their dashboard before doing anything from here."
          />
          <div className="space-y-2 p-4 sm:p-5">
            {transfers.map((row) => (
              <div
                key={`${row.type}-${row.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3"
              >
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">
                    {row.reference} · {row.who} · {cedis(row.amount)}
                    <Badge tone="warning" className="ml-2">
                      {row.transferStatus}
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {row.note ?? 'No further detail from Paystack.'}
                    {row.decidedAt ? ` · approved ${dateTime(row.decidedAt)}` : ''}
                  </p>
                </div>
                <Link
                  to={row.type === 'withdrawal' ? '/admin/withdrawals' : '/admin/refunds'}
                  className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  {row.type === 'withdrawal' ? 'Go to Withdrawals' : 'Go to Refunds'}
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}

      <DispatchModal
        order={inspecting}
        onClose={() => {
          setInspecting(null)
          void load()
        }}
      />

      {acknowledging && (
        <Modal open onClose={() => setAcknowledging(null)} title={`Acknowledge ${acknowledging.reference}`}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submitAck()
            }}
          >
            <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
              {acknowledging.reason}
            </Callout>
            <Callout tone="info">
              This does not change the order or move any money, it only clears the flag once you have
              checked what actually happened, against Paystack's or DataHub's own dashboard, or the
              customer directly. If anything needs fixing (a refund clawed back, an extra one issued),
              do that separately first.
            </Callout>
            <Field label="What did you check?" htmlFor="ack-note">
              <TextInput
                id="ack-note"
                placeholder="Checked DataHub's dashboard, the bundle was never actually sent"
                value={ackNote}
                onChange={(event) => setAckNote(event.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" block loading={busyId === acknowledging.id}>
                Acknowledge
              </Button>
              <Button
                type="button"
                block
                variant="outline"
                disabled={busyId === acknowledging.id}
                onClick={() => setAcknowledging(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
