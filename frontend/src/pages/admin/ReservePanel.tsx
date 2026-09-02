import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type ReservePosition } from '../../lib/api'
import { cedis } from '../../lib/format'
import { Callout, Card, CardHead, Spinner, cn } from '../../components/ui'
import { AlertIcon, CashIcon, CheckIcon } from '../../components/icons'

/**
 * What is owed, against what Paystack is holding — and whether Paystack's own
 * figure agrees with our own records.
 *
 * Two different questions, both worth a place here. The liabilities list
 * below is entirely computed from this platform's own records — agent
 * earnings, refunds owed, customer wallets — and means the same thing
 * regardless of account tier or how Paystack happens to settle. The
 * reconciliation box is a different question: does Paystack's live balance
 * actually match what our own records say it should hold since it last
 * settled? That stays meaningful on any account, including one that settles
 * every sale out automatically and so never retains much of a balance at
 * all — because it never assumes a balance is being kept on purpose, only
 * that recent activity should already be reflected.
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

  const { balance, liabilities, reconciliation, balanceError, inTransit } = position
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
          {liabilities.queuedPayouts > 0 && (
            <Row
              label="Payouts requested, not yet sent"
              value={liabilities.queuedPayouts}
              negative
              hint="Already off an agent's balance — still theirs until it actually lands"
            />
          )}
          {liabilities.manualRefundAdvances > 0 && (
            <Row
              label="Owed for refunds paid out of pocket"
              value={liabilities.manualRefundAdvances}
              negative
              hint="Someone covered these personally — settle them on the Float panel"
            />
          )}
          <Row label="Total owed to other people" value={liabilities.total} negative strong />
        </dl>

        <div
          className={cn(
            'flex items-start gap-3 rounded-xl border p-4',
            reconciliation?.flagged
              ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40'
              : !reconciliation
                ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60'
                : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40',
          )}
        >
          <span
            className={cn(
              'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full',
              reconciliation?.flagged
                ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
                : !reconciliation
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400',
            )}
          >
            {reconciliation?.flagged ? <AlertIcon className="size-5" /> : <CashIcon className="size-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Does the balance match your records?
            </p>
            <p
              className={cn(
                'tabular text-2xl font-bold',
                reconciliation?.flagged
                  ? 'text-red-700 dark:text-red-400'
                  : !reconciliation
                    ? 'text-slate-500 dark:text-slate-400'
                    : 'text-emerald-800 dark:text-emerald-300',
              )}
            >
              {!reconciliation
                ? 'Not enough to check yet'
                : reconciliation.flagged
                  ? `${cedis(Math.abs(reconciliation.shortfall))} ${reconciliation.shortfall > 0 ? 'short' : 'over'}`
                  : 'Matches'}
            </p>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
              {!reconciliation ? (
                <>
                  Either the balance couldn&apos;t be read, or there&apos;s no settlement history yet to
                  compare against.
                </>
              ) : reconciliation.flagged ? (
                <>
                  Your own records say Paystack should hold {cedis(reconciliation.expected)} since it
                  last settled, but it reports {cedis(reconciliation.observed)}. This usually means a
                  payment or a transfer never actually reached their balance, or the other way
                  around — worth checking against your Paystack dashboard.
                </>
              ) : (
                <>
                  Paystack reports {cedis(reconciliation.observed)}, which matches what your own
                  records expect since it last settled — nothing looks missing on either side.
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
