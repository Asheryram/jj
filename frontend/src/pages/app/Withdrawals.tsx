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

/**
 * FR-2.6 — request a payout.
 *
 * The amount leaves the agent's balance when the request is made, so it cannot be
 * spent twice while it waits. James approves it and sends the MoMo; a rejection
 * puts it straight back.
 */
/** What the bootstrap seeds when nobody has given a real number yet. */
const PLACEHOLDER_PHONE = '0000000000'

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
          <TableWrap caption="Your withdrawal requests">
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
                <tr key={request.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <Td className="text-slate-600 dark:text-slate-300">{dateTime(request.requestedAt)}</Td>
                  <Td>
                    <p className="tabular font-medium text-slate-900 dark:text-slate-50">{request.agentPhone}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{request.momoNetwork}</p>
                  </Td>
                  <Td align="right" className="tabular font-semibold text-slate-900 dark:text-slate-50">
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
        onSubmit={(amount, network, number) => {
          requestWithdrawal(amount, network, number)
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
  onSubmit: (amount: number, network: Network, number: string) => void
}) {
  const [value, setValue] = useState('')
  const [network, setNetwork] = useState<Network>('MTN')
  /**
   * Prefilled from the account, but blank when the account still holds the
   * bootstrap placeholder — `0000000000` is not a number any transfer can reach,
   * and offering it as a default would invite sending real money nowhere.
   */
  const [phone, setPhone] = useState(defaultPhone === PLACEHOLDER_PHONE ? '' : defaultPhone)
  const [error, setError] = useState('')
  const [phoneError, setPhoneError] = useState('')

  const parsed = value.trim() ? parseCedis(value) : null

  const submit = () => {
    if (parsed === null) {
      setError('Enter an amount like 50 or 50.00.')
      return
    }
    // The minimum itself is admin-configurable (Settings → Smallest
    // withdrawal), so it is not guessed here — the server's own rejection
    // carries the real, current amount rather than a number that could drift
    // from it.
    if (parsed > balance) {
      setError(`You only have ${cedis(balance)} available.`)
      return
    }
    if (!/^0\d{9}$/.test(phone.trim())) {
      setPhoneError('A Ghana number needs 10 digits, like 0209876543.')
      return
    }
    setError('')
    setPhoneError('')
    setValue('')
    onSubmit(parsed, network, phone.trim())
  }

  return (
    <Modal open={open} onClose={onClose} title="Request a withdrawal">
      <div className="space-y-4">
        <div className="flex items-baseline justify-between rounded-xl bg-slate-50 dark:bg-slate-800 px-3.5 py-3">
          <span className="text-sm text-slate-600 dark:text-slate-300">Available</span>
          <span className="tabular text-lg font-bold text-slate-900 dark:text-slate-50">{cedis(balance)}</span>
        </div>

        <Field label="Amount to withdraw" htmlFor="wd-amount" error={error}>
          <div className="relative">
            <span className="absolute inset-y-0 left-3.5 flex items-center text-sm font-semibold text-slate-500 dark:text-slate-400">
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
          className="text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline"
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

        <Field
          label="Paid to"
          htmlFor="wd-phone"
          error={phoneError}
          hint="The Mobile Money number to send it to. It does not have to be the number you sign in with."
        >
          <TextInput
            id="wd-phone"
            inputMode="numeric"
            placeholder="0209876543"
            className="tabular"
            invalid={Boolean(phoneError)}
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value.replace(/[^0-9]/g, '').slice(0, 10))
              setPhoneError('')
            }}
          />
        </Field>

        <Button block size="lg" onClick={submit}>
          Send request
        </Button>
      </div>
    </Modal>
  )
}
