import { useEffect, useState } from 'react'
import ReservePanel from './ReservePanel'
import FloatPanel from './FloatPanel'
import { api, type FinanceStatement } from '../../lib/api'
import { cedis } from '../../lib/format'
import { Card, CardHead, PageHead, Segmented } from '../../components/ui'

function share(part: number, whole: number): string | undefined {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}% of what customers paid` : undefined
}

function Line({
  label,
  value,
  dot,
  strong,
  hint,
}: {
  label: string
  value: number
  dot?: string
  strong?: boolean
  hint?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="text-slate-600 dark:text-slate-300">
        <span className={`flex items-center gap-1.5 ${strong ? 'font-semibold text-slate-900 dark:text-slate-50' : ''}`}>
          {dot && <span className={`size-2 shrink-0 rounded-full ${dot}`} />}
          {label}
        </span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
      </dt>
      <dd
        className={
          strong
            ? 'tabular shrink-0 font-bold text-brand-700 dark:text-brand-300'
            : 'tabular shrink-0 font-semibold text-slate-900 dark:text-slate-50'
        }
      >
        {value < 0 ? '−' : ''}
        {cedis(Math.abs(value))}
      </dd>
    </div>
  )
}

/**
 * Everything Overview used to carry about where the money actually is and
 * where it actually went: what's held versus owed (`ReservePanel`), the
 * prepaid supplier floats (`FloatPanel`), and the ledger-derived cost
 * breakdown ("Where the money goes"). Split out because Overview's job is
 * "what needs my attention and how's today going", not a full financial
 * statement, three dense money panels stacked between a revenue chart and a
 * top-agents list was neither.
 */
export default function Finance() {
  const [statement, setStatement] = useState<FinanceStatement | null>(null)
  const [range, setRange] = useState<'7' | '30' | 'all'>('7')

  useEffect(() => {
    let live = true
    api
      .financeStatement(range === 'all' ? 'all' : Number(range))
      .then((result) => live && setStatement(result))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [range])

  const trackedRevenue = statement?.revenue ?? 0
  const supplierSpend = statement?.costs.supplier ?? 0
  const paystackFee = statement?.costs.paymentFees ?? 0
  const agentShare = statement?.costs.agentMargins ?? 0
  /** Refunds, plus the fees the business paid to send money: refund transfers and your own treasury transfers. */
  const refundsAndFees = (statement?.costs.refunds ?? 0) + (statement?.costs.transferFees ?? 0)
  /**
   * Whatever else is booked against profit (historical referral bonuses,
   * uncollectable agent write-offs). Derived as the remainder so the
   * statement always adds up to `profit`, whatever new kind of cost appears.
   * Agents' own payout fees are not here: they come out of what the agent was
   * owed, not out of the business (`affectsProfit` false).
   */
  const otherCosts = statement
    ? trackedRevenue - supplierSpend - paystackFee - agentShare - refundsAndFees - statement.profit
    : 0
  const booked = statement?.profit ?? 0
  const stillOpen = statement?.stillOpen ?? 0
  const earned = statement?.earned ?? 0
  const takenOut = statement?.settlements.ownerDrawings ?? 0
  const rangeLabel = range === '7' ? 'Last 7 days' : range === '30' ? 'Last 30 days' : 'All time'

  return (
    <div>
      <PageHead title="Finance" subtitle="What's held, what's owed, and where every cedi went." />

      <div data-tour="finance-reserve">
        <ReservePanel />
      </div>

      {/* `id` is the admin Overview "Get set up" checklist's jump target,
          linking here as `/admin/finance#float-panel`. */}
      <div className="mt-3 scroll-mt-20" id="float-panel" data-tour="finance-float-panel">
        <FloatPanel />
      </div>

      {/* FR-6.6, where every cedi that came in actually went. */}
      <div data-tour="finance-where-money-goes">
      <Card className="mt-3">
        <CardHead
          title="Where the money goes"
          subtitle={`${rangeLabel}: from what customers paid down to the profit you keep`}
          action={
            <Segmented<'7' | '30' | 'all'>
              options={[
                { value: '7', label: '7 days' },
                { value: '30', label: '30 days' },
                { value: 'all', label: 'All time' },
              ]}
              value={range}
              onChange={setRange}
            />
          }
        />
        <div className="p-4 sm:p-5">
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            {[
              { label: 'Supplier', value: supplierSpend, className: 'bg-slate-400' },
              { label: 'Paystack fee', value: paystackFee, className: 'bg-amber-400' },
              { label: 'Agents', value: agentShare, className: 'bg-brand-300' },
              { label: 'Refunds and fees', value: refundsAndFees, className: 'bg-red-400' },
              { label: 'Other', value: otherCosts, className: 'bg-slate-300 dark:bg-slate-600' },
              { label: 'You', value: booked, className: 'bg-brand-600' },
            ]
              .filter((band) => band.value > 0)
              .map((band) => (
                <div
                  key={band.label}
                  className={band.className}
                  style={{ width: `${trackedRevenue > 0 ? (band.value / trackedRevenue) * 100 : 0}%` }}
                  role="img"
                  aria-label={`${band.label}: ${cedis(band.value)}`}
                />
              ))}
          </div>

          {/* A statement, not a set of loose totals: every line below adds up to the one under it. */}
          <dl className="mt-4 max-w-xl divide-y divide-slate-100 text-sm dark:divide-slate-800">
            <Line label="Customers paid" value={trackedRevenue} />
            <Line label="Paid to suppliers" value={-supplierSpend} dot="bg-slate-400" hint={share(supplierSpend, trackedRevenue)} />
            <Line label="Paystack fees on sales" value={-paystackFee} dot="bg-amber-400" hint={share(paystackFee, trackedRevenue)} />
            <Line label="Agents' commission" value={-agentShare} dot="bg-brand-300" hint={share(agentShare, trackedRevenue)} />
            {refundsAndFees !== 0 && (
              <Line label="Refunds and transfer fees" value={-refundsAndFees} dot="bg-red-400" hint="Money given back, and Paystack's fee for sending it and your own transfers" />
            )}
            {otherCosts !== 0 && <Line label="Other" value={-otherCosts} dot="bg-slate-300 dark:bg-slate-600" hint="Referral bonuses and write-offs" />}
            <Line label="Your margin, as booked" value={booked} dot="bg-brand-600" strong />
            {stillOpen !== 0 && (
              <Line
                label="Less orders not finished yet"
                value={-stillOpen}
                hint="Still being delivered (their cost and commission are not in yet), or failed with the refund still owed. Counts once they settle"
              />
            )}
            <Line label={range === 'all' ? 'Profit earned' : 'Profit earned in this period'} value={earned} strong />
            {range === 'all' && takenOut !== 0 && (
              <>
                <Line label="Taken out by you" value={-takenOut} hint="From the Paystack balance page. Not a cost, so it never lowers profit earned" />
                <Line label="Profit still in the business" value={earned - takenOut} strong />
              </>
            )}
          </dl>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {rangeLabel}, from the ledger, not the price quoted at sale time, so it is what your suppliers actually
            charged and what Paystack actually kept. All time, "Profit earned" is the same figure as on All orders.
          </p>
        </div>
      </Card>
      </div>
    </div>
  )
}
