import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type ReservePosition } from '../../lib/api'
import { cedis } from '../../lib/format'
import { Button, Callout, Card, CardHead, Spinner, cn } from '../../components/ui'
import { AlertIcon, CheckIcon, RefreshIcon } from '../../components/icons'

/**
 * What is owed, against what our own records say should be sitting at
 * Paystack — entirely computed from this platform's own transactions, never
 * from Paystack's live balance, and always all-time: everything ever
 * collected, less every payout and refund transfer this platform has
 * actually sent. That live figure is still checked, just not here — only in
 * the background, and only when `paystackBusinessAccount` is on (see
 * Settings) — and a real shortfall goes to an admin's inbox rather than this
 * panel.
 */
export default function ReservePanel() {
  const [position, setPosition] = useState<ReservePosition | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  /**
   * `position()` on the server recomputes every figure here fresh from the
   * database on every call — nothing is cached — so calling it again is
   * genuinely "recheck everything," not a cosmetic spin.
   */
  const load = useCallback(async () => {
    try {
      const result = await api.reservePosition()
      setPosition(result)
      setError('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not read your balance.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const refreshButton = (
    <Button size="sm" variant="outline" loading={refreshing} onClick={() => void refresh()}>
      <RefreshIcon className="size-4" /> Refresh
    </Button>
  )

  if (error) {
    return (
      <Card className="mt-3">
        <CardHead title="Money held and money owed" action={refreshButton} />
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

  const { expectedAtPaystack, liabilities } = position

  return (
    <Card className="mt-3">
      <CardHead
        title="Money held and money owed"
        subtitle="Everything customers pay lands in one Paystack balance. Only part of it is yours."
        action={refreshButton}
      />

      <div className="space-y-3 p-4 sm:p-5">
        <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:border-slate-700">
          <Row
            label="Should be at Paystack"
            value={expectedAtPaystack}
            strong
            hint="Everything ever collected, less every payout and refund actually sent — from your own records, not their live balance"
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
