import { useState } from 'react'
import { useStore } from '../../state/store'
import { cedis, dateTime, parseCedis } from '../../lib/format'
import { NETWORKS } from '../../lib/networks'
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
  Select,
  StatTile,
  TableWrap,
  Td,
  TextInput,
  Th,
} from '../../components/ui'
import { AlertIcon, CashIcon, ClockIcon } from '../../components/icons'

/** FR-2.6 — request a payout; approval is manual for v1. */
export default function Withdrawals() {
  const { agentBalance: balance, withdrawals, requestWithdrawal, session } = useStore()
  const [open, setOpen] = useState(false)

  const mine = withdrawals.filter((w) => w.agentPhone === session?.phone)
  const pending = mine.filter((w) => w.status === 'pending')
  const paidOut = mine
    .filter((w) => w.status === 'approved')
    .reduce((sum, w) => sum + w.amount, 0)

  return (
    <div>
      <PageHead
        title="Withdraw earnings"
        subtitle="Move your earnings to your Mobile Money account."
        action={
          <Button size="lg" onClick={() => setOpen(true)} disabled={balance <= 0}>
            <CashIcon className="size-4" /> Request withdrawal
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Available to withdraw" value={cedis(balance)} tone="brand" />
        <StatTile
          label="Awaiting approval"
          value={cedis(pending.reduce((s, w) => s + w.amount, 0))}
          hint={`${pending.length} request${pending.length === 1 ? '' : 's'}`}
          icon={<ClockIcon className="size-5" />}
        />
        <StatTile label="Paid out to date" value={cedis(paidOut)} />
      </div>

      <div className="mt-3">
        <Callout tone="info" title="How payouts work right now" icon={<AlertIcon className="size-4" />}>
          James reviews and pays each request by hand, usually within 24 hours. You will get an SMS
          once the money has been sent. Automatic payouts are planned for a later version.
        </Callout>
      </div>

      <Card className="mt-3">
        <CardHead title="Your requests" subtitle={`${mine.length} in total`} />
        {mine.length === 0 ? (
          <EmptyState
            icon={<CashIcon className="size-6" />}
            title="No withdrawal requests yet"
            detail="When you are ready to take money out, request a withdrawal and it will show here."
            action={<Button onClick={() => setOpen(true)}>Request withdrawal</Button>}
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Requested</Th>
                <Th>To</Th>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {mine.map((request) => (
                <tr key={request.id} className="hover:bg-slate-50">
                  <Td className="text-slate-600">{dateTime(request.requestedAt)}</Td>
                  <Td>
                    <p className="tabular font-medium text-slate-900">{request.agentPhone}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{request.momoNetwork}</p>
                  </Td>
                  <Td align="right" className="tabular font-semibold text-slate-900">
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
                        ? 'Paid'
                        : request.status === 'rejected'
                          ? 'Rejected'
                          : 'Awaiting review'}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <RequestModal
        open={open}
        onClose={() => setOpen(false)}
        balance={balance}
        defaultPhone={session?.phone ?? ''}
        onSubmit={(amount, network) => {
          requestWithdrawal(amount, network)
          setOpen(false)
        }}
      />
    </div>
  )
}

function RequestModal({
  open,
  onClose,
  balance,
  defaultPhone,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  balance: number
  defaultPhone: string
  onSubmit: (amount: number, network: Network) => void
}) {
  const [value, setValue] = useState('')
  const [network, setNetwork] = useState<Network>('MTN')
  const [error, setError] = useState('')

  const parsed = value.trim() ? parseCedis(value) : null

  const submit = () => {
    if (parsed === null) {
      setError('Enter an amount like 50 or 50.00.')
      return
    }
    if (parsed < 1000) {
      setError('The smallest withdrawal is GHS 10.00.')
      return
    }
    if (parsed > balance) {
      setError(`You only have ${cedis(balance)} available.`)
      return
    }
    setError('')
    setValue('')
    onSubmit(parsed, network)
  }

  return (
    <Modal open={open} onClose={onClose} title="Request a withdrawal">
      <div className="space-y-4">
        <div className="flex items-baseline justify-between rounded-xl bg-slate-50 px-3.5 py-3">
          <span className="text-sm text-slate-600">Available</span>
          <span className="tabular text-lg font-bold text-slate-900">{cedis(balance)}</span>
        </div>

        <Field label="Amount to withdraw" htmlFor="wd-amount" error={error}>
          <div className="relative">
            <span className="absolute inset-y-0 left-3.5 flex items-center text-sm font-semibold text-slate-400">
              GHS
            </span>
            <TextInput
              id="wd-amount"
              inputMode="decimal"
              placeholder="0.00"
              className="pl-13 text-lg font-bold"
              invalid={Boolean(error)}
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setError('')
              }}
            />
          </div>
        </Field>

        <button
          type="button"
          onClick={() => setValue((balance / 100).toFixed(2))}
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          Withdraw everything ({cedis(balance)})
        </button>

        <Field label="Mobile Money network" htmlFor="wd-network">
          <Select
            id="wd-network"
            value={network}
            onChange={(event) => setNetwork(event.target.value as Network)}
          >
            {NETWORKS.map((option) => (
              <option key={option} value={option}>
                {option === 'MTN'
                  ? 'MTN Mobile Money'
                  : option === 'Telecel'
                    ? 'Telecel Cash'
                    : 'AirtelTigo Money'}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Paid to" htmlFor="wd-phone" hint="Your registered number. Contact James to change it.">
          <TextInput id="wd-phone" value={defaultPhone} readOnly className="bg-slate-50 tabular" />
        </Field>

        <Button block size="lg" onClick={submit}>
          Send request
        </Button>
      </div>
    </Modal>
  )
}
