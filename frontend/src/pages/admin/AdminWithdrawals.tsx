import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { api, ApiError, type ManualPayoutAdvance } from '../../lib/api'
import { cedis, dateTime } from '../../lib/format'
import type { WithdrawalRequest } from '../../data/types'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  CopyField,
  EmptyState,
  Field,
  Modal,
  PageHead,
  Segmented,
  StatTile,
  TableWrap,
  Td,
  TextInput,
  Th,
} from '../../components/ui'
import { AlertIcon, CashIcon, CheckIcon, ClockIcon, XIcon } from '../../components/icons'

type Filter = 'pending' | 'all'

/**
 * FR-2.6, FR-6.4, FR-7.3 — the payout queue.
 *
 * Approving sends the transfer through Paystack automatically once this
 * server has real, transfer-capable credentials configured — the balance is
 * checked first, so an agent is never told they have been paid out of money
 * that is not there. Until then, or if Paystack itself refuses every
 * third-party payout outright (a Starter Business account does this by
 * design, not as a bug), the row stays "Decided" with a "Paid another way?"
 * link — see `SettleManuallyModal` below — so a request never has no way
 * forward at all.
 */
export default function AdminWithdrawals() {
  const { withdrawals, decideWithdrawal, users } = useStore()
  const [filter, setFilter] = useState<Filter>('pending')
  const [reviewing, setReviewing] = useState<WithdrawalRequest | null>(null)
  const [settling, setSettling] = useState<WithdrawalRequest | null>(null)

  const pending = withdrawals.filter((w) => w.status === 'pending')
  const visible = filter === 'pending' ? pending : withdrawals
  /**
   * `approved` is not delivered — it's a decision made, waiting on Paystack
   * (or a manual send) to actually confirm it. In steady state a request
   * spends only seconds to minutes there before moving on to `paid` or
   * `failed`, so a tile built on `approved` alone reads close to GHS 0.00
   * forever and never reflects real cumulative payout volume.
   */
  const paidOut = withdrawals.filter((w) => w.status === 'paid')

  /**
   * Whether the agent behind a request is currently suspended — a request
   * queued before a suspension otherwise looks identical to any other, and
   * approving it still sends real money out. The server refuses it either
   * way; this is so the admin sees it before opening the review modal, not
   * only after the approval bounces.
   */
  const isSuspended = (userId: string) => users.find((u) => u.id === userId)?.status === 'suspended'

  return (
    <div>
      <PageHead
        title="Withdrawal requests"
        subtitle="Agents asking to move their wallet balance to Mobile Money."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Awaiting your decision"
          value={String(pending.length)}
          hint={cedis(pending.reduce((s, w) => s + w.amount, 0))}
          tone={pending.length > 0 ? 'warning' : 'neutral'}
          icon={<ClockIcon className="size-5" />}
        />
        <StatTile
          label="Paid to date"
          value={cedis(paidOut.reduce((s, w) => s + w.amount, 0))}
          hint={`${paidOut.length} payouts`}
          icon={<CashIcon className="size-5" />}
        />
        <StatTile
          label="Largest pending"
          value={cedis(pending.length > 0 ? Math.max(...pending.map((w) => w.amount)) : 0)}
        />
      </div>

      <div className="mt-3">
        <Callout tone="info" title="Approving sends the money" icon={<AlertIcon className="size-4" />}>
          Approving hands the transfer to Paystack, which pays the agent&apos;s Mobile Money
          directly. It is checked against your Paystack balance first, so nobody is marked paid
          against money that is not there — and if a transfer is refused or reversed, the amount
          goes straight back to their balance.
        </Callout>
      </div>

      <div className="mt-3 mb-3">
        <Segmented<Filter>
          options={[
            { value: 'pending', label: `Pending ${pending.length}` },
            { value: 'all', label: `All ${withdrawals.length}` },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>

      <Card>
        <CardHead title={filter === 'pending' ? 'Pending requests' : 'All requests'} />
        {visible.length === 0 ? (
          <EmptyState
            icon={<CheckIcon className="size-6" />}
            title="Nothing waiting"
            detail="Every withdrawal request has been dealt with."
            action={
              <Button variant="outline" onClick={() => setFilter('all')}>
                View all requests
              </Button>
            }
          />
        ) : (
          <TableWrap caption="Agent withdrawal requests">
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Requested</Th>
                <Th>Pay to</Th>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
                <Th align="right" />
              </tr>
            </thead>
            <tbody>
              {visible.map((request) => (
                <tr key={request.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <Td>
                    <span className="flex items-center gap-1.5">
                      <p className="font-medium text-slate-900 dark:text-slate-50">{request.agentName}</p>
                      {isSuspended(request.userId) && <Badge tone="danger">Suspended</Badge>}
                    </span>
                    <p className="tabular mt-0.5 text-xs text-slate-500 dark:text-slate-400">{request.id}</p>
                  </Td>
                  <Td className="text-slate-600 dark:text-slate-300">{dateTime(request.requestedAt)}</Td>
                  <Td>
                    <p className="tabular text-slate-800 dark:text-slate-100">{request.agentPhone}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{request.momoNetwork}</p>
                  </Td>
                  <Td align="right" className="tabular font-bold text-slate-900 dark:text-slate-50">
                    {cedis(request.amount)}
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        request.status === 'paid'
                          ? 'success'
                          : request.status === 'approved'
                            ? 'success'
                            : request.status === 'rejected' || request.status === 'failed'
                              ? 'danger'
                              : 'warning'
                      }
                    >
                      {request.status === 'paid'
                        ? 'Paid'
                        : request.status === 'approved'
                          ? 'Approved'
                          : request.status === 'rejected'
                            ? 'Rejected'
                            : request.status === 'failed'
                              ? 'Failed'
                              : 'Pending'}
                    </Badge>
                    {/* A transfer that hasn't gone says so here, rather than
                        looking like an approval that quietly achieved nothing. */}
                    {request.transferNote && (
                      <p className="mt-1 max-w-xs text-xs text-amber-700 dark:text-amber-400">
                        {request.transferNote}
                      </p>
                    )}
                    {request.transferStatus === 'success' && request.paidAt && (
                      <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                        Confirmed sent · {dateTime(request.paidAt)}
                      </p>
                    )}
                  </Td>
                  <Td align="right">
                    {request.status === 'pending' ? (
                      <Button size="sm" onClick={() => setReviewing(request)}>
                        Review
                      </Button>
                    ) : request.status === 'approved' && request.transferStatus !== 'success' ? (
                      /* Automatic sending either had nowhere to go yet (no
                         live Paystack key configured) or hit a wall it can't
                         get past on its own (an account that refuses every
                         transfer, an OTP it can't answer) — offered here so
                         it never has no way forward at all. */
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs text-slate-500 dark:text-slate-400">Decided</span>
                        <button
                          type="button"
                          onClick={() => setSettling(request)}
                          className="text-xs font-semibold text-brand-700 dark:text-brand-300 underline underline-offset-2"
                        >
                          Paid another way?
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500 dark:text-slate-400">Decided</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Modal
        open={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        title="Review withdrawal request"
      >
        {reviewing && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-4 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">{reviewing.agentName} is requesting</p>
              <p className="tabular mt-1 text-3xl font-bold text-slate-900 dark:text-slate-50">
                {cedis(reviewing.amount)}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                to {reviewing.momoNetwork} · {reviewing.agentPhone}
              </p>
            </div>

            {/* Make the payout details trivially copyable — this is a manual step. */}
            <CopyField label="Send to number" value={reviewing.agentPhone} mono />
            <CopyField label="Amount" value={(reviewing.amount / 100).toFixed(2)} mono />

            {isSuspended(reviewing.userId) ? (
              <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
                {reviewing.agentName} is currently suspended. Reactivate them on the Users page
                first if you still want to pay this out, or reject the request instead.
              </Callout>
            ) : (
              <Callout tone="info">
                Send the Mobile Money first, then approve here so the ledger matches what actually
                happened.
              </Callout>
            )}

            <div className="flex gap-2">
              <Button
                block
                disabled={isSuspended(reviewing.userId)}
                onClick={() => {
                  decideWithdrawal(reviewing.id, 'approved')
                  setReviewing(null)
                }}
              >
                <CheckIcon className="size-4" /> Approve
              </Button>
              <Button
                block
                variant="danger"
                onClick={() => {
                  decideWithdrawal(reviewing.id, 'rejected')
                  setReviewing(null)
                }}
              >
                <XIcon className="size-4" /> Reject
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ManualAdvancesCard />

      <SettleManuallyModal request={settling} onClose={() => setSettling(null)} />
    </div>
  )
}

/**
 * Payouts sent from someone's own pocket, not yet taken back out.
 *
 * The mirror of Refunds.tsx's own version, one column over: created by
 * `SettleManuallyModal` below the moment a payout gets marked as sent by
 * hand instead of through Paystack. This is Paystack's money, not the
 * DataHub float — the agent's earnings were already debited when they
 * requested it, and the ledger cost was already booked at approval; only
 * who actually paid it out is unresolved here.
 */
function ManualAdvancesCard() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<ManualPayoutAdvance[] | null>(null)
  const [reimbursing, setReimbursing] = useState<string | null>(null)

  const refresh = useCallback(() => api.manualPayoutAdvances().then(setRows).catch(() => undefined), [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const reimburse = async (withdrawalId: string) => {
    setReimbursing(withdrawalId)
    try {
      await api.reimburseManualPayout(withdrawalId)
      pushToast({ tone: 'success', title: `Marked payout ${withdrawalId.slice(0, 8)} as reimbursed` })
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
        subtitle="Money owed back to whoever personally covered one of these when there was nowhere automatic to send it from"
      />
      <div className="p-4 sm:p-5">
        <Callout tone="warning" icon={<CashIcon className="size-4" />}>
          The agent's earnings for each of these are already debited and the payout is already
          booked as a real cost — it was never sent back out through Paystack. Take the amount
          back for yourself first, then mark it reimbursed below.
        </Callout>

        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <li key={r.withdrawalId} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="tabular text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {r.withdrawalId.slice(0, 8)} · {cedis(r.amount)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{r.description}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{dateTime(r.occurredAt)}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                loading={reimbursing === r.withdrawalId}
                onClick={() => void reimburse(r.withdrawalId)}
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
 * The fallback for an account that cannot send Paystack transfers yet, or at
 * all — the mirror of Refunds.tsx's own version. No network picker here: the
 * agent already chose it when they asked to be paid, so there is nothing
 * left to confirm beyond how and where it actually went.
 */
function SettleManuallyModal({
  request,
  onClose,
}: {
  request: WithdrawalRequest | null
  onClose: () => void
}) {
  const { settleWithdrawalManually } = useStore()
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
      setError('Say how and where this was sent. It is kept on the record.')
      return
    }
    setBusy(true)
    try {
      await settleWithdrawalManually(request.id, note.trim())
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Mark ${cedis(request.amount)} as sent`}>
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5 text-sm">
          <p className="font-semibold text-slate-900 dark:text-slate-50">{request.agentName}</p>
          <p className="tabular mt-0.5 text-slate-600 dark:text-slate-300">
            {request.agentPhone} · {request.momoNetwork}
          </p>
        </div>

        <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
          Only use this once the money has actually left your hands. This closes the request and
          tells the agent it has been sent — there is no automatic transfer behind it this time.
        </Callout>

        <Field label="How and where did you send it?" htmlFor="wd-settle-note" error={error}>
          <TextInput
            id="wd-settle-note"
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
