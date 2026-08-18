import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type RefundRequest } from '../../lib/api'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
import { prettyPhone } from '../../lib/networks'
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
  StatTile,
  TableWrap,
  Td,
  TextInput,
  Th,
} from '../../components/ui'
import { AlertIcon, CashIcon, CheckIcon } from '../../components/icons'

type Filter = 'pending' | 'approved' | 'rejected'

/**
 * Money owed back to customers, waiting on a decision.
 *
 * Refunds are not automatic. A failed delivery records the debt and stops, so
 * this queue is the only way money goes back — which is the point: an outbound
 * payment should have a person behind it. The cost of not having one was
 * demonstrated, when a rule that refunded every failed order paid eight customers
 * GHS 196 they had never paid.
 *
 * The queue is ordered oldest-first on purpose. Somebody has paid for something
 * they did not receive and is waiting; the longest wait is the most urgent thing
 * on the screen, not the largest amount.
 */
export default function Refunds() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<RefundRequest[] | null>(null)
  const [filter, setFilter] = useState<Filter>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<RefundRequest | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setRows(await api.refundQueue(filter))
      setError('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not load the refund queue.')
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const owed = (rows ?? []).reduce((sum, row) => sum + row.amount, 0)

  const approve = async (row: RefundRequest) => {
    setBusyId(row.id)
    try {
      await api.approveRefund(row.id)
      await load()
      pushToast({
        tone: 'success',
        title: `${cedis(row.amount)} refunded`,
        detail:
          row.method === 'wallet'
            ? `Back in ${row.buyerName}'s wallet.`
            : `Held for ${prettyPhone(row.buyerPhone)} to claim. Send them the link.`,
      })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not approve that refund.',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <PageHead
        title="Refunds"
        subtitle="Money owed back to customers whose orders failed. Nothing is returned until you approve it."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile
          label={filter === 'pending' ? 'Owed to customers' : 'In this view'}
          value={cedis(owed)}
          hint={`${(rows ?? []).length} request${(rows ?? []).length === 1 ? '' : 's'}`}
          tone={filter === 'pending' && owed > 0 ? 'warning' : 'neutral'}
          icon={<CashIcon className="size-5" />}
        />
        <StatTile
          label="Oldest waiting"
          value={
            rows && rows.length > 0 && filter === 'pending'
              ? dateTime(rows[0].createdAt)
              : '—'
          }
          hint="Somebody has paid and received nothing"
          icon={<AlertIcon className="size-5" />}
        />
      </div>

      <div className="mt-4">
        <Segmented<Filter>
          options={[
            { value: 'pending', label: 'Waiting' },
            { value: 'approved', label: 'Refunded' },
            { value: 'rejected', label: 'Refused' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>

      <Card className="mt-3">
        <CardHead title="Refund requests" />
        <div className="p-4 sm:p-5">
          {error && (
            <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
              {error}
            </Callout>
          )}

          {rows === null ? (
            <div className="py-10 text-center">
              <Spinner className="mx-auto size-6 text-brand-600" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<CheckIcon className="size-6" />}
              title={filter === 'pending' ? 'Nobody is waiting for money' : 'Nothing here'}
              detail={
                filter === 'pending'
                  ? 'Every failed order has been settled one way or the other.'
                  : 'No refunds in this state yet.'
              }
            />
          ) : (
            <TableWrap caption="Refund requests">
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Order</Th>
                  <Th>Why it failed</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <Td>
                      <p className="font-medium text-slate-900">{row.buyerName}</p>
                      <p className="tabular mt-0.5 text-xs text-slate-500">
                        {prettyPhone(row.buyerPhone)}
                      </p>
                    </Td>
                    <Td>
                      <p className="tabular text-sm text-slate-800">{row.orderRef}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{row.productName}</p>
                    </Td>
                    <Td>
                      <p className="max-w-xs text-sm text-slate-700">{row.reason}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral">
                          {row.method === 'wallet' ? 'to wallet' : 'claim link'}
                        </Badge>
                        <span className="text-xs text-slate-500">{dateTime(row.createdAt)}</span>
                      </div>
                      {row.note && (
                        <p className="mt-1 text-xs text-red-700">Refused: {row.note}</p>
                      )}
                    </Td>
                    <Td align="right" className="tabular font-bold text-slate-900">
                      {cedis(row.amount)}
                    </Td>
                    <Td align="right">
                      {row.status === 'pending' ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            loading={busyId === row.id}
                            onClick={() => void approve(row)}
                          >
                            Refund
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setRejecting(row)}>
                            Refuse
                          </Button>
                        </div>
                      ) : (
                        <Badge tone={row.status === 'approved' ? 'success' : 'danger'}>
                          {row.status === 'approved' ? 'refunded' : 'refused'}
                        </Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
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
    </div>
  )
}

/**
 * Refusing a refund needs a reason, and keeps it.
 *
 * This is a decision not to return money somebody paid. It has to be possible —
 * an order can fail on our side and still have been delivered — but it must not
 * be possible quietly, because the record is what answers the question months
 * later when the customer asks again.
 */
function RefuseModal({
  request,
  onClose,
  onRefused,
}: {
  request: RefundRequest | null
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
      setError('Say why. This is kept on the record.')
      return
    }
    setBusy(true)
    try {
      await api.rejectRefund(request.id, note.trim())
      await onRefused()
      pushToast({ tone: 'info', title: `Refund refused for ${request.orderRef}` })
      onClose()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Refuse refund — ${request.orderRef}`}>
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm">
          <p className="font-semibold text-slate-900">
            {request.buyerName} · {cedis(request.amount)}
          </p>
          <p className="mt-1 text-slate-600">{request.reason}</p>
        </div>

        <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
          This customer paid and did not get their bundle. Only refuse if you know the bundle
          actually arrived, or the payment never did.
        </Callout>

        <Field label="Why are you refusing it?" htmlFor="refuse-note" error={error}>
          <TextInput
            id="refuse-note"
            placeholder="Bundle was delivered — confirmed with the customer"
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
            Refuse refund
          </Button>
          <Button block disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
