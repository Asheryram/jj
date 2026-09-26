import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
 * FR-2.6, request a payout.
 *
 * The amount leaves the agent's balance when the request is made, so it cannot be
 * spent twice while it waits. James approves it and sends the MoMo; a rejection
 * puts it straight back.
 */
/** What the bootstrap seeds when nobody has given a real number yet. */
const PLACEHOLDER_PHONE = '0000000000'

export default function Withdrawals() {
  const {
    agentBalance: balance,
    withdrawals,
    requestWithdrawal,
    cancelWithdrawal,
    session,
    payoutTransferFee,
  } = useStore()
  const [params] = useSearchParams()
  // `?open=1`, the "Withdraw" buttons on Dashboard/Earnings used to land here
  // and stop, one more click away from the thing they were actually for.
  const [open, setOpen] = useState(() => params.get('open') === '1')
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  /**
   * Not `agentPhone === session.phone`, the payout number is whatever was
   * typed on the request (see RequestModal below: "does not have to be the
   * number you sign in with"), so matching on it silently dropped an agent's
   * own request the moment they withdrew to a different Mobile Money number
   * than their login phone. `userId` is unambiguous and always theirs.
   */
  const mine = withdrawals.filter((w) => w.userId === session?.id)
  const pending = mine.filter((w) => w.status === 'pending')
  /** Only `paid`, `approved` is a decision made, not yet confirmed sent. */
  const paidOut = mine
    .filter((w) => w.status === 'paid')
    .reduce((sum, w) => sum + w.amount, 0)

  return (
    <div>
      <PageHead
        title="Withdraw earnings"
        subtitle="Move your earnings to your Mobile Money account."
        action={
          <Button size="lg" onClick={() => setOpen(true)} disabled={balance <= payoutTransferFee}>
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
          {payoutTransferFee > 0 && (
            <>
              {' '}
              A flat {cedis(payoutTransferFee)} transfer fee is deducted from your balance when a
              request is approved, on top of the amount you asked for.
            </>
          )}
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
                <Th align="right" />
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
                        request.status === 'paid'
                          ? 'success'
                          : request.status === 'approved'
                            ? 'info'
                            : request.status === 'rejected' || request.status === 'failed'
                              ? 'danger'
                              : 'warning'
                      }
                    >
                      {request.status === 'paid'
                        ? 'Paid'
                        : request.status === 'approved'
                          ? 'On its way'
                          : request.status === 'rejected'
                            ? 'Rejected'
                            : request.status === 'failed'
                              ? 'Could not be sent, returned to you'
                              : 'Awaiting review'}
                    </Badge>
                    {/* "Why it hasn't gone", a rejection or a stalled transfer
                        with no reason shown here reads as unexplained, sending
                        an agent to support for something already on record. */}
                    {request.transferNote && (
                      <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
                        {request.transferNote}
                      </p>
                    )}
                  </Td>
                  <Td align="right">
                    {request.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={cancellingId === request.id}
                        onClick={async () => {
                          setCancellingId(request.id)
                          await cancelWithdrawal(request.id)
                          setCancellingId(null)
                        }}
                      >
                        Cancel
                      </Button>
                    )}
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
        payoutTransferFee={payoutTransferFee}
        onSubmit={async (amount, network, number) => {
          // Reported back to the modal, only closing and clearing on success
          // is the point; the server validates the minimum and the current
          // balance, and a rejected request used to close the form and blank
          // the amount anyway, silently discarding what the agent had just typed.
          const ok = await requestWithdrawal(amount, network, number)
          if (ok) setOpen(false)
          return ok
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
  payoutTransferFee,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  balance: number
  defaultPhone: string
  payoutTransferFee: number
  onSubmit: (amount: number, network: Network, number: string) => Promise<boolean>
}) {
  const [value, setValue] = useState('')
  const [network, setNetwork] = useState<Network>('MTN')
  /**
   * Prefilled from the account, but blank when the account still holds the
   * bootstrap placeholder, `0000000000` is not a number any transfer can reach,
   * and offering it as a default would invite sending real money nowhere.
   */
  const [phone, setPhone] = useState(defaultPhone === PLACEHOLDER_PHONE ? '' : defaultPhone)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [phoneError, setPhoneError] = useState('')

  const parsed = value.trim() ? parseCedis(value) : null

  /**
   * The real ceiling on what can be requested, not the raw balance.
   *
   * Approving a withdrawal reserves `amount + payoutTransferFee` the moment
   * it is asked for (see `WithdrawalsService.request`), so requesting the
   * whole balance would leave nothing to hold the fee against and the
   * request would be refused outright, not approved-then-silently-short.
   * Capped here so that refusal is never reached: what's offered as
   * "everything" already accounts for it.
   */
  const maxRequestable = Math.max(0, balance - payoutTransferFee)

  const submit = async () => {
    if (parsed === null) {
      setError('Enter an amount like 50 or 50.00.')
      return
    }
    // The minimum itself is admin-configurable (Settings → Smallest
    // withdrawal), so it is not guessed here, the server's own rejection
    // carries the real, current amount rather than a number that could drift
    // from it.
    if (parsed > maxRequestable) {
      setError(
        payoutTransferFee > 0
          ? `You can withdraw at most ${cedis(maxRequestable)}, GHS ${(payoutTransferFee / 100).toFixed(2)} of your ${cedis(balance)} is held back for the transfer fee.`
          : `You only have ${cedis(balance)} available.`,
      )
      return
    }
    if (!/^0\d{9}$/.test(phone.trim())) {
      setPhoneError('A Ghana number needs 10 digits, like 0209876543.')
      return
    }
    setError('')
    setPhoneError('')
    // Cleared only once `onSubmit` reports success, a rejection (below the
    // minimum, balance changed, too many pending) used to blank the amount
    // and close the form regardless, losing everything the agent had just
    // typed.
    setBusy(true)
    try {
      const ok = await onSubmit(parsed, network, phone.trim())
      if (ok) setValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Request a withdrawal">
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800 px-3.5 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-slate-600 dark:text-slate-300">Available to withdraw</span>
            <span className="tabular text-lg font-bold text-slate-900 dark:text-slate-50">
              {cedis(maxRequestable)}
            </span>
          </div>
          {payoutTransferFee > 0 && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {cedis(balance)} total, GHS {(payoutTransferFee / 100).toFixed(2)} of it is held back to
              cover Paystack's transfer fee.
            </p>
          )}
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
          onClick={() => setValue((maxRequestable / 100).toFixed(2))}
          className="text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline"
        >
          Withdraw the max ({cedis(maxRequestable)})
        </button>

        {payoutTransferFee > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            A flat {cedis(payoutTransferFee)} transfer fee is held on top of whatever you request
            here, and kept when this is approved.
          </p>
        )}

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

        <Button block size="lg" loading={busy} disabled={busy} onClick={() => void submit()}>
          Send request
        </Button>
      </div>
    </Modal>
  )
}
