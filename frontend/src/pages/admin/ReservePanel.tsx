import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type ReservePosition } from '../../lib/api'
import { cedis } from '../../lib/format'
import { Callout, Card, CardHead, Spinner, cn } from '../../components/ui'
import { AlertIcon, CashIcon, CheckIcon } from '../../components/icons'

/**
 * What is owed, against what Paystack is holding.
 *
 * This exists because money from customers all lands in one Paystack balance and
 * four different claims are made on it — agent earnings, customer wallets,
 * refunds owed, and the float and profit that genuinely are James's. Only the
 * last is free to spend, and nothing showed him where the line was. Topping up
 * DataHub float could quietly consume an agent's earnings, and the shortfall
 * would only surface when that agent asked to be paid.
 *
 * It cannot be segregated at the provider: Paystack settles to one account, and
 * splitting at collection would pay agents for orders that later fail. So the
 * answer is to put the number where he cannot miss it.
 *
 * "Free to spend" is the whole point of the panel. Everything above it is working.
 */
export default function ReservePanel() {
  const [position, setPosition] = useState<ReservePosition | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api
      .reservePosition()
      .then((result) => live && setPosition(result))
      .catch(
        (caught) =>
          live &&
          setError(
            caught instanceof ApiError ? caught.message : 'We could not read your balance.',
          ),
      )
    return () => {
      live = false
    }
  }, [])

  if (error) {
    return (
      <Card className="mt-3">
        <CardHead title="Money held and money owed" />
        <div className="p-4 sm:p-5">
          <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
            {error}
          </Callout>
        </div>
      </Card>
    )
  }

  if (!position) {
    return (
      <Card className="mt-3">
        <CardHead title="Money held and money owed" />
        <div className="py-10 text-center">
          <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
        </div>
      </Card>
    )
  }

  const { balance, liabilities, available, covered, balanceError, inTransit } = position
  const short = available !== null && available < 0
  const settledSince = inTransit.settledSince
    ? new Date(inTransit.settledSince).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      })
    : null

  return (
    <Card className="mt-3">
      <CardHead
        title="Money held and money owed"
        subtitle="Everything customers pay lands in one Paystack balance. Only part of it is yours."
      />

      <div className="space-y-3 p-4 sm:p-5">
        {balanceError && (
          <Callout tone="warning" title="Could not read your Paystack balance" icon={<AlertIcon className="size-4" />}>
            {balanceError} The amounts owed below are still correct — only the comparison is missing.
          </Callout>
        )}

        <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:border-slate-700">
          <Row
            label="Paystack is holding"
            value={balance}
            strong
            hint={
              inTransit.amount > 0
                ? `+ ${cedis(inTransit.amount)} already collected, still settling${settledSince ? ` (last settled ${settledSince})` : ''} — on its way, not lost`
                : undefined
            }
          />
          <Row label="Owed to agents" value={liabilities.agentEarnings} negative />
          <Row
            label="Customer wallets and refunds owed"
            value={liabilities.customerMoney}
            negative
            hint={
              position.pendingRefunds.count > 0
                ? `includes ${cedis(position.pendingRefunds.amount)} in ${position.pendingRefunds.count} refund${position.pendingRefunds.count === 1 ? '' : 's'} awaiting your approval`
                : undefined
            }
          />
          <Row
            label="Paid for, not yet delivered"
            value={liabilities.undeliveredOrders}
            negative
            hint="Either a bundle or a refund — not yours either way"
          />
          <Row label="Total owed to other people" value={liabilities.total} negative strong />
        </dl>

        <div
          className={cn(
            'flex items-start gap-3 rounded-xl border p-4',
            short ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40' : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40',
          )}
        >
          <span
            className={cn(
              'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full',
              short ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400',
            )}
          >
            {short ? <AlertIcon className="size-5" /> : <CashIcon className="size-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Free to spend</p>
            <p
              className={cn(
                'tabular text-2xl font-bold',
                short ? 'text-red-700 dark:text-red-400' : 'text-emerald-800 dark:text-emerald-300',
              )}
            >
              {available === null ? 'Unknown' : cedis(available)}
            </p>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
              {short ? (
                <>
                  You owe more than you are holding. Do not top up supplier float or draw profit
                  until this is positive — the shortfall will surface when someone asks to be paid.
                </>
              ) : covered === null ? (
                <>Read your Paystack balance to compare it against what you owe.</>
              ) : (
                <>
                  Safe to use for supplier float or your own profit. Everything above this is
                  somebody else's money.
                </>
              )}
            </p>
          </div>
        </div>

        {position.pendingRefunds.count > 0 && (
          <Callout
            tone="warning"
            title={`${position.pendingRefunds.count} refund${position.pendingRefunds.count === 1 ? '' : 's'} waiting on you — ${cedis(position.pendingRefunds.amount)}`}
            icon={<AlertIcon className="size-4" />}
          >
            These customers paid and did not get their bundle. The money is counted as owed from the
            moment the order failed, not from when you approve it — so it is already off your
            spendable balance. Clear them on the{' '}
            <Link to="/admin/refunds" className="font-semibold underline">
              Refunds
            </Link>{' '}
            page.
          </Callout>
        )}

        {position.pendingPayouts.count > 0 && (
          <Callout
            tone="info"
            title={`${position.pendingPayouts.count} payout${position.pendingPayouts.count === 1 ? '' : 's'} waiting — ${cedis(position.pendingPayouts.amount)}`}
            icon={<CheckIcon className="size-4" />}
          >
            Approving one checks your Paystack balance first, so an agent is never marked paid
            against money that is not there.
          </Callout>
        )}
      </div>
    </Card>
  )
}

function Row({
  label,
  value,
  negative,
  strong,
  hint,
}: {
  label: string
  value: number | null
  negative?: boolean
  strong?: boolean
  hint?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2.5">
      <dt className="text-sm text-slate-600 dark:text-slate-300">
        <span className={strong ? 'font-semibold text-slate-800 dark:text-slate-100' : undefined}>{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
      </dt>
      <dd
        className={cn(
          'tabular shrink-0 text-sm',
          strong ? 'font-bold text-slate-900 dark:text-slate-50' : 'font-semibold text-slate-700 dark:text-slate-200',
        )}
      >
        {value === null ? '—' : `${negative && value > 0 ? '−' : ''}${cedis(value)}`}
      </dd>
    </div>
  )
}
