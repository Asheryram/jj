import { useState } from 'react'
import { useStore } from '../../state/store'
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
  Modal,
  PageHead,
  Segmented,
  StatTile,
  TableWrap,
  Td,
  Th,
} from '../../components/ui'
import { AlertIcon, CashIcon, CheckIcon, ClockIcon, XIcon } from '../../components/icons'

type Filter = 'pending' | 'all'

/** FR-2.6, FR-6.4, FR-7.3 — manual approval queue for v1. */
export default function AdminWithdrawals() {
  const { withdrawals, decideWithdrawal } = useStore()
  const [filter, setFilter] = useState<Filter>('pending')
  const [reviewing, setReviewing] = useState<WithdrawalRequest | null>(null)

  const pending = withdrawals.filter((w) => w.status === 'pending')
  const visible = filter === 'pending' ? pending : withdrawals
  const approved = withdrawals.filter((w) => w.status === 'approved')

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
          label="Approved to date"
          value={cedis(approved.reduce((s, w) => s + w.amount, 0))}
          hint={`${approved.length} payouts`}
          icon={<CashIcon className="size-5" />}
        />
        <StatTile
          label="Largest pending"
          value={cedis(pending.length > 0 ? Math.max(...pending.map((w) => w.amount)) : 0)}
        />
      </div>

      <div className="mt-3">
        <Callout tone="warning" title="You send the money yourself" icon={<AlertIcon className="size-4" />}>
          Approving a request here records the decision and debits the agent&apos;s wallet. Sending the
          Mobile Money is still a manual step you do outside the platform — automatic payouts come in
          a later version.
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
                <tr key={request.id} className="hover:bg-slate-50">
                  <Td>
                    <p className="font-medium text-slate-900">{request.agentName}</p>
                    <p className="tabular mt-0.5 text-xs text-slate-500">{request.id}</p>
                  </Td>
                  <Td className="text-slate-600">{dateTime(request.requestedAt)}</Td>
                  <Td>
                    <p className="tabular text-slate-800">{request.agentPhone}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{request.momoNetwork}</p>
                  </Td>
                  <Td align="right" className="tabular font-bold text-slate-900">
                    {cedis(request.amount)}
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        request.status === 'approved'
                          ? 'success'
                          : request.status === 'rejected'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {request.status === 'approved'
                        ? 'Approved'
                        : request.status === 'rejected'
                          ? 'Rejected'
                          : 'Pending'}
                    </Badge>
                  </Td>
                  <Td align="right">
                    {request.status === 'pending' ? (
                      <Button size="sm" onClick={() => setReviewing(request)}>
                        Review
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-500">Decided</span>
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
            <div className="rounded-xl bg-slate-50 p-4 text-center">
              <p className="text-sm text-slate-500">{reviewing.agentName} is requesting</p>
              <p className="tabular mt-1 text-3xl font-bold text-slate-900">
                {cedis(reviewing.amount)}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                to {reviewing.momoNetwork} · {reviewing.agentPhone}
              </p>
            </div>

            {/* Make the payout details trivially copyable — this is a manual step. */}
            <CopyField label="Send to number" value={reviewing.agentPhone} mono />
            <CopyField label="Amount" value={(reviewing.amount / 100).toFixed(2)} mono />

            <Callout tone="info">
              Send the Mobile Money first, then approve here so the ledger matches what actually
              happened.
            </Callout>

            <div className="flex gap-2">
              <Button
                block
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
    </div>
  )
}
