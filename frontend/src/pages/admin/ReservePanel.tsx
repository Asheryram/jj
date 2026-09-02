import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type ReservePosition } from '../../lib/api'
import { cedis } from '../../lib/format'
import { Callout, Card, CardHead, Spinner, cn } from '../../components/ui'
import { AlertIcon, CheckIcon } from '../../components/icons'

/**
 * What is owed, against what our own records say should be sitting at
 * Paystack — entirely computed from this platform's own transactions, never
 * from Paystack's live balance. That live figure is still checked, just not
 * here: it is compared against this same expectation on a clock in the
 * background, and a real mismatch goes to an admin's inbox rather than this
 * panel — a Starter account settles every sale out almost immediately, so
 * its live balance reads GHS 0.00 between sales as a matter of course, and
 * showing that here would read as a standing false alarm rather than the
 * rare, real thing worth an email.
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

  const { expectedAtPaystack, liabilities, inTransit } = position
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
        {inTransit.error && (
          <Callout tone="warning" title="Could not read your last settlement date" icon={<AlertIcon className="size-4" />}>
            {inTransit.error} The amounts below still cover everything ever collected — only "since your
            last settlement" is missing.
          </Callout>
        )}

        <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:border-slate-700">
          <Row
            label="Should be at Paystack"
            value={expectedAtPaystack}
            strong
            hint={
              settledSince
                ? `Collected since it last settled on ${settledSince}, net of transfers already sent — from your own records, not their live balance`
                : 'From your own records, not their live balance'
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
              hint={
                <>
                  Someone covered these personally — money still sitting at Paystack, never the
                  DataHub float. Settle them on the{' '}
                  <Link to="/admin/refunds" className="font-semibold underline">
                    Refunds
                  </Link>{' '}
                  page.
                </>
              }
            />
          )}
          <Row label="Total owed to other people" value={liabilities.total} negative strong />
        </dl>

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
  hint?: ReactNode
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
