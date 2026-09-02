import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type ManualRefundAdvance, type RefundRequest } from '../../lib/api'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
import { prettyPhone } from '../../lib/networks'
import type { Network } from '../../data/types'
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
  const [sending, setSending] = useState<RefundRequest | null>(null)
  const [settling, setSettling] = useState<RefundRequest | null>(null)
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

  const approve = async (row: RefundRequest, momoNetwork?: Network) => {
    setBusyId(row.id)
    try {
      await api.approveRefund(row.id, momoNetwork)
      await load()
      pushToast({
        tone: 'success',
        title: `${cedis(row.amount)} on its way back`,
        detail:
          row.method === 'wallet'
            ? `Back in ${row.buyerName}'s wallet.`
            : `Sent to ${prettyPhone(row.buyerPhone)} on ${momoNetwork}. We will confirm when it lands.`,
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
              <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
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
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <Td>
                      <p className="font-medium text-slate-900 dark:text-slate-50">{row.buyerName}</p>
                      <p className="tabular mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {prettyPhone(row.buyerPhone)}
                      </p>
                    </Td>
                    <Td>
                      <p className="tabular text-sm text-slate-800 dark:text-slate-100">{row.orderRef}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{row.productName}</p>
                    </Td>
                    <Td>
                      <p className="max-w-xs text-sm text-slate-700 dark:text-slate-200">{row.reason}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral">
                          {row.method === 'wallet'
                            ? 'to wallet'
                            : row.method === 'transfer'
                              ? `to ${row.momoNetwork ?? 'Mobile Money'}`
                              : 'claim link'}
                        </Badge>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{dateTime(row.createdAt)}</span>
                      </div>
                      {row.note && (
                        <p className="mt-1 text-xs text-red-700 dark:text-red-400">Refused: {row.note}</p>
                      )}
                      {/* A transfer that did not go says so here, rather than
                          looking like an approval that quietly achieved nothing. */}
                      {row.transferNote && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{row.transferNote}</p>
                      )}
                      {row.transferStatus === 'success' && (
                        <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                          Confirmed delivered{row.paidAt ? ` · ${dateTime(row.paidAt)}` : ''}
                        </p>
                      )}
                    </Td>
                    <Td align="right" className="tabular font-bold text-slate-900 dark:text-slate-50">
                      {cedis(row.amount)}
                    </Td>
                    <Td align="right">
                      {row.status === 'pending' ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              loading={busyId === row.id}
                              onClick={() =>
                                row.method === 'transfer'
                                  ? setSending(row)
                                  : void approve(row)
                              }
                            >
                              Refund
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setRejecting(row)}>
                              Refuse
                            </Button>
                          </div>
                          {/* Only offered once an automatic transfer has actually bounced —
                              a Starter Business Paystack account refuses every third-party
                              payout outright, and this is the way through that wall. Hidden
                              otherwise so the normal path stays the obvious one. */}
                          {row.method === 'transfer' && row.transferStatus === 'failed' && (
                            <button
                              type="button"
                              onClick={() => setSettling(row)}
                              className="text-xs font-semibold text-brand-700 dark:text-brand-300 underline underline-offset-2"
                            >
                              Paid another way?
                            </button>
                          )}
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

      <ManualAdvancesCard />

      <SendRefundModal
        request={sending}
        onClose={() => setSending(null)}
        onSend={async (row, network) => {
          setSending(null)
          await approve(row, network)
        }}
      />

      <RefuseModal
        request={rejecting}
        onClose={() => setRejecting(null)}
        onRefused={async () => {
          await load()
        }}
      />

      <SettleManuallyModal
        request={settling}
        onClose={() => setSettling(null)}
        onSettled={async () => {
          await load()
        }}
      />
    </div>
  )
}

/**
 * Refunds sent from someone's own pocket, not yet taken back out.
 *
 * Created by `SettleManuallyModal` above, the moment a Mobile Money transfer
 * gets marked as sent by hand instead of through Paystack — so this belongs
 * right here with the rest of the refund queue, not tucked into the Float
 * panel just because both happen to be tracked on the same capital ledger.
 * This is Paystack's money, not the DataHub float: the customer's original
 * payment is still sitting wherever Paystack settles to for you, since the
 * refund never actually left through them.
 */
function ManualAdvancesCard() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<ManualRefundAdvance[] | null>(null)
  const [reimbursing, setReimbursing] = useState<string | null>(null)

  const refresh = useCallback(
    () => api.manualRefundAdvances().then(setRows).catch(() => undefined),
    [],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const reimburse = async (orderRef: string) => {
    setReimbursing(orderRef)
    try {
      await api.reimburseManualRefund(orderRef)
      pushToast({ tone: 'success', title: `Marked ${orderRef} as reimbursed` })
      await refresh()
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not save that.',
      })
    } finally {
      setReimbursing(null)
    }
  }

  if (!rows || rows.length === 0) return null

  return (
    <Card className="mt-3">
      <CardHead
        title="Paid out of pocket, not yet reimbursed"
        subtitle="Money owed back to whoever personally covered one of these when Paystack couldn't send it"
      />
      <div className="p-4 sm:p-5">
        <Callout tone="warning" icon={<CashIcon className="size-4" />}>
          The customer's original payment for each of these is still sitting wherever Paystack
          settles to for you — it was never sent back out through them. Take the amount back for
          yourself from there first, then mark it reimbursed below. This is separate from your
          DataHub float.
        </Callout>

        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <li key={r.orderRef} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="tabular text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {r.orderRef} · {cedis(r.amount)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{r.description}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{dateTime(r.occurredAt)}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                loading={reimbursing === r.orderRef}
                onClick={() => void reimburse(r.orderRef)}
              >
                Reimbursed
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
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
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5 text-sm">
          <p className="font-semibold text-slate-900 dark:text-slate-50">
            {request.buyerName} · {cedis(request.amount)}
          </p>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{request.reason}</p>
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

/**
 * Which network to send a Mobile Money refund on.
 *
 * Pre-filled when it is already known: Paystack reports which network carried
 * the original payment, and that is read back here rather than asked again.
 * When it is not on file — a guest whose payment predates this, or one
 * Paystack did not report cleanly — this falls back to asking, because a
 * prefix cannot be trusted to say which network carries a line: Ghana's
 * number portability means a guess here once turned real customers away.
 *
 * Either way it stays a choice, not a fact stated at them: whoever is
 * approving can see and change it before anything is sent.
 *
 * The number is shown large and unmissable, because it is the whole identity of
 * the person being paid: a guest has no account, and this is where the money
 * goes.
 */
function SendRefundModal({
  request,
  onClose,
  onSend,
}: {
  request: RefundRequest | null
  onClose: () => void
  onSend: (row: RefundRequest, network: Network) => Promise<void>
}) {
  const [network, setNetwork] = useState<Network>('MTN')

  const key = request?.id ?? 'none'
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setNetwork(request?.momoNetwork ?? 'MTN')
  }

  if (!request) return null

  const known = request.momoNetwork !== null

  return (
    <Modal open onClose={onClose} title={`Send ${cedis(request.amount)} back`}>
      <div className="space-y-4">
        <div className="rounded-xl border-2 border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-900/40 p-4 text-center">
          <p className="text-sm text-brand-900 dark:text-brand-200">Sending to</p>
          <p className="tabular mt-1 text-2xl font-bold tracking-wide text-brand-900 dark:text-brand-200">
            {prettyPhone(request.buyerPhone)}
          </p>
          <p className="mt-1 text-sm text-brand-900 dark:text-brand-200">{request.buyerName}</p>
        </div>

        <Field label="Which Mobile Money network?" htmlFor="refund-network">
          <Segmented<Network>
            className="w-full"
            options={[
              { value: 'MTN', label: 'MTN' },
              { value: 'Telecel', label: 'Telecel' },
              { value: 'AirtelTigo', label: 'AirtelTigo' },
            ]}
            value={network}
            onChange={setNetwork}
          />
        </Field>

        {known ? (
          <Callout tone="info" icon={<CheckIcon className="size-4" />}>
            This is what they paid with, reported by Paystack — not a guess. Worth a glance before
            sending, but you shouldn&apos;t need to change it.
          </Callout>
        ) : (
          <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
            We cannot tell the network from the number — a Ghanaian line keeps its number when it
            moves. If you are not sure, ask them before sending.
          </Callout>
        )}

        <div className="flex gap-2">
          <Button block onClick={() => void onSend(request, network)}>
            Send {cedis(request.amount)}
          </Button>
          <Button block variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * The fallback for a Paystack account that cannot send transfers at all.
 *
 * A Starter Business account refuses every third-party payout outright — not
 * a retry-able failure, an account-level wall. This records that the money
 * left some other way (the admin's own Mobile Money, cash) instead of
 * pretending the platform sent it, and closes the refund the same way a
 * confirmed transfer would: the order is marked refunded and the customer's
 * receipt reflects it.
 *
 * The note is required for the same reason a refusal's reason is required —
 * nothing else here confirms the claim, so the record is what answers a
 * dispute later.
 */
function SettleManuallyModal({
  request,
  onClose,
  onSettled,
}: {
  request: RefundRequest | null
  onClose: () => void
  onSettled: () => Promise<void>
}) {
  const { pushToast } = useStore()
  const [network, setNetwork] = useState<Network>('MTN')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const key = request?.id ?? 'none'
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setNetwork(request?.momoNetwork ?? 'MTN')
    setNote('')
    setError('')
  }

  if (!request) return null

  const submit = async () => {
    if (note.trim().length < 5) {
      setError('Say how and where this was sent. It is kept on the record.')
      return
    }
    setBusy(true)
    try {
      await api.settleRefundManually(request.id, note.trim(), network)
      await onSettled()
      pushToast({
        tone: 'success',
        title: `${cedis(request.amount)} marked as sent`,
        detail: `Recorded against ${prettyPhone(request.buyerPhone)} on ${network}.`,
      })
      onClose()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Mark ${cedis(request.amount)} as sent`}>
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5 text-sm">
          <p className="font-semibold text-slate-900 dark:text-slate-50">{request.buyerName}</p>
          <p className="tabular mt-0.5 text-slate-600 dark:text-slate-300">
            {prettyPhone(request.buyerPhone)}
          </p>
        </div>

        <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
          Only use this once the money has actually left your hands. This closes the refund and
          tells the customer it has been sent — there is no automatic transfer behind it this time.
        </Callout>

        <Field label="Which Mobile Money network did you send it on?" htmlFor="settle-network">
          <Segmented<Network>
            className="w-full"
            options={[
              { value: 'MTN', label: 'MTN' },
              { value: 'Telecel', label: 'Telecel' },
              { value: 'AirtelTigo', label: 'AirtelTigo' },
            ]}
            value={network}
            onChange={setNetwork}
          />
        </Field>

        <Field label="How and where did you send it?" htmlFor="settle-note" error={error}>
          <TextInput
            id="settle-note"
            placeholder="Sent from my personal MTN MoMo, ref 88578647868"
            value={note}
            invalid={Boolean(error)}
            onChange={(event) => {
              setNote(event.target.value)
              setError('')
            }}
          />
        </Field>

        <div className="flex gap-2">
          <Button block loading={busy} onClick={() => void submit()}>
            Mark as sent
          </Button>
          <Button block variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
