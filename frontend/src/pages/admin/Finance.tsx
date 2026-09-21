import { useEffect, useState } from 'react'
import ReservePanel from './ReservePanel'
import FloatPanel from './FloatPanel'
import { api, type FinanceStatement } from '../../lib/api'
import { cedis } from '../../lib/format'
import { Card, CardHead, PageHead, Segmented } from '../../components/ui'

function MoneyBand({
  label,
  value,
  dot,
  strong,
}: {
  label: string
  value: string
  dot?: string
  strong?: boolean
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        {dot && <span className={`size-2 rounded-full ${dot}`} />}
        {label}
      </dt>
      <dd
        className={
          strong
            ? 'tabular mt-1 text-lg font-bold text-brand-700 dark:text-brand-300'
            : 'tabular mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50'
        }
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * Everything Overview used to carry about where the money actually is and
 * where it actually went: what's held versus owed (`ReservePanel`), the
 * prepaid DataHub float (`FloatPanel`), and the ledger-derived cost
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
  const refunds = statement?.costs.refunds ?? 0
  /** referralBonuses and payoutFees are both historical-only kinds, nothing live writes either; agentMarginWriteoffs is the rare uncollectable-clawback case. */
  const otherCosts =
    (statement?.costs.referralBonuses ?? 0) +
    (statement?.costs.payoutFees ?? 0) +
    (statement?.costs.agentMarginWriteoffs ?? 0)
  const myMargin = statement?.profit ?? 0

  return (
    <div>
      <PageHead title="Finance" subtitle="What's held, what's owed, and where every cedi went." />

      <ReservePanel />

      {/* `id` is the admin Overview "Get set up" checklist's jump target,
          linking here as `/admin/finance#float-panel`. */}
      <div className="mt-3 scroll-mt-20" id="float-panel">
        <FloatPanel />
      </div>

      {/* FR-6.6, where every cedi that came in actually went. */}
      <Card className="mt-3">
        <CardHead
          title="Where the money goes"
          subtitle={`${range === '7' ? 'Last 7 days' : range === '30' ? 'Last 30 days' : 'All time'}, from the ledger`}
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
              { label: 'You', value: myMargin, className: 'bg-brand-600' },
              { label: 'Agents', value: agentShare, className: 'bg-brand-300' },
              ...(refunds > 0
                ? [{ label: 'Refunds', value: refunds, className: 'bg-red-400' }]
                : []),
              ...(otherCosts > 0
                ? [{ label: 'Other', value: otherCosts, className: 'bg-slate-300 dark:bg-slate-600' }]
                : []),
            ].map((band) => (
              <div
                key={band.label}
                className={band.className}
                style={{
                  width: `${trackedRevenue > 0 ? (band.value / trackedRevenue) * 100 : 0}%`,
                }}
                role="img"
                aria-label={`${band.label}: ${cedis(band.value)}`}
              />
            ))}
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MoneyBand label="Customers paid" value={cedis(trackedRevenue)} />
            <MoneyBand label="To DataHub GH" value={cedis(supplierSpend)} dot="bg-slate-400" />
            <MoneyBand label="Paystack fee" value={cedis(paystackFee)} dot="bg-amber-400" />
            <MoneyBand label="Your margin" value={cedis(myMargin)} dot="bg-brand-600" strong />
            <MoneyBand label="To your agents" value={cedis(agentShare)} dot="bg-brand-300" />
            {refunds > 0 && <MoneyBand label="Refunds" value={cedis(refunds)} dot="bg-red-400" />}
            {otherCosts > 0 && (
              <MoneyBand label="Other" value={cedis(otherCosts)} dot="bg-slate-300 dark:bg-slate-600" />
            )}
          </dl>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            From the ledger, not the price you were quoted at sale time, so it reflects what
            DataHub actually charged and what Paystack actually kept, not the catalogue estimate.
          </p>
        </div>
      </Card>
    </div>
  )
}
