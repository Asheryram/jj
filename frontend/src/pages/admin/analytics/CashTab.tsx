import { Link } from 'react-router-dom'
import { Legend, Meter, PALETTE, PROVIDER_COLOURS, RankBars, TrendChart } from '../../../components/insightCharts'
import { cn } from '../../../components/ui'
import type { Insights } from '../../../lib/api'
import { cedis, cedisAxis, cedisCompact, Panel, providerName, shortDate } from './shared'

export default function CashTab({ data }: { data: Insights }) {
  const { cash } = data
  const l = cash.now.liabilities
  const historyLabels = cash.history.map((h) => shortDate(h.date))
  const floatDates = [...new Set(cash.floatHistory.map((f) => f.date))].sort((a, b) => a - b)
  const floatProviders = [...new Set(cash.floatHistory.map((f) => f.provider))]

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel
          question="How much can the business actually spend?"
          answer={cash.now.freeToSpend >= 0 ? 'After everything owed, this is yours.' : 'More is owed than the business holds. Hold off on moving money out.'}
        >
          <p className={cn('text-3xl font-bold tracking-tight tabular-nums', cash.now.freeToSpend < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
            {cedis(cash.now.freeToSpend)}
          </p>
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between text-slate-600 dark:text-slate-300">
              <dt>Should be at Paystack</dt>
              <dd className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">{cedis(cash.now.expectedAtPaystack)}</dd>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-300">
              <dt>Owed to other people</dt>
              <dd className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">−{cedis(l.total)}</dd>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-300">
              <dt>Spent on bundles, not yet repaid</dt>
              <dd className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">−{cedis(cash.now.spentOnBundles)}</dd>
            </div>
          </dl>
          <Link to="/admin/finance" className="mt-4 inline-block text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">Open Finance</Link>
        </Panel>

        <Panel question="Who is the money owed to?" answer={`${cedis(l.total)} in total.`} className="lg:col-span-2">
          <RankBars
            format={cedisCompact}
            colour={PALETTE.amber}
            rows={[
              { key: 'agents', label: 'Agents, earned and not withdrawn', value: l.agentEarnings },
              { key: 'customers', label: 'Customers (wallets and refunds)', value: l.customerMoney },
              { key: 'undelivered', label: 'Paid orders not delivered yet', value: l.undeliveredOrders },
              { key: 'payouts', label: 'Payouts approved, not sent', value: l.queuedPayouts },
              { key: 'refundAdv', label: 'Refunds paid by hand, to repay', value: l.manualRefundAdvances },
              { key: 'payoutAdv', label: 'Payouts paid by hand, to repay', value: l.manualPayoutAdvances },
              { key: 'superadmin', label: "Superadmin's share, not withdrawn", value: l.superadminShare ?? 0 },
            ].filter((r) => r.value !== 0)}
          />
        </Panel>
      </div>

      <Panel
        question="Why isn't free to spend the same as profit?"
        answer={
          Math.abs(cash.bridge.earnedProfit - cash.bridge.freeToSpend) < 500
            ? 'They match: the profit you have earned is sitting in Paystack as cash.'
            : 'Profit is what sales earned. Free to spend is the cash left after everything owed. Here is the difference.'
        }
      >
        <dl className="max-w-xl space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-600 dark:text-slate-300">Profit earned, all time (finished sales)</dt>
            <dd className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">{cedis(cash.bridge.earnedProfit)}</dd>
          </div>
          {cash.bridge.profitInFloats !== 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600 dark:text-slate-300">Profit moved into supplier floats (still yours, but stock now)</dt>
              <dd className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">−{cedis(cash.bridge.profitInFloats)}</dd>
            </div>
          )}
          {Math.abs(cash.bridge.other) >= 1 && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600 dark:text-slate-300">Other (Paystack fees on failed orders, payout fees, rounding)</dt>
              <dd className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">{cash.bridge.other < 0 ? '−' : '+'}{cedis(Math.abs(cash.bridge.other))}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 dark:border-slate-700">
            <dt className="font-semibold text-slate-900 dark:text-slate-50">Free to spend now</dt>
            <dd className="font-bold tabular-nums text-slate-900 dark:text-slate-50">{cedis(cash.bridge.freeToSpend)}</dd>
          </div>
        </dl>
        {Math.abs(cash.bridge.other) >= 2000 && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
            The "other" line is bigger than fees and rounding usually explain. Check Finance for a capital entry or a hand-sent refund or payout that may be recorded wrongly.
          </p>
        )}
      </Panel>

      <Panel question="How long will each float last?" answer="At the pace of the last seven days.">
        <div className="grid gap-3 md:grid-cols-2">
          {cash.floats.map((f) => {
            const tone = f.daysLeft === null || f.daysLeft >= 5 ? 'good' : f.daysLeft >= 2 ? 'warn' : 'bad'
            const gap = f.balance !== null && f.expected !== null ? f.balance - f.expected : null
            return (
              <div key={f.provider} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-50">
                    <span className="size-2.5 rounded-full" style={{ background: PROVIDER_COLOURS[f.provider] ?? PALETTE.slate }} />
                    {providerName(f.provider)}
                  </span>
                  <span className={cn('text-sm font-bold tabular-nums', tone === 'bad' ? 'text-rose-600 dark:text-rose-400' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                    {f.daysLeft === null ? 'no recent spend' : f.daysLeft >= 30 ? '30+ days left' : `${f.daysLeft.toFixed(1)} days left`}
                  </span>
                </div>
                <Meter value={f.daysLeft ?? 30} max={14} tone={tone} />
                <dl className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                  <div className="flex justify-between"><dt>Usable now</dt><dd className="font-semibold tabular-nums">{f.usable === null ? 'not read yet' : cedis(f.usable)}</dd></div>
                  <div className="flex justify-between"><dt>Spent a day, on average</dt><dd className="font-semibold tabular-nums">{cedis(f.avgDailySpend)}</dd></div>
                  <div className="flex justify-between">
                    <dt>Provider says / books say</dt>
                    <dd className="font-semibold tabular-nums">
                      {f.balance === null ? 'none' : cedis(f.balance)} / {f.expected === null ? 'none' : cedis(f.expected)}
                    </dd>
                  </div>
                  {gap !== null && Math.abs(gap) >= 100 && (
                    <p className={cn('pt-1', gap < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400')}>
                      {gap < 0
                        ? `The float holds ${cedis(-gap)} less than the books expect. Check for a top-up logged twice or an unlogged withdrawal.`
                        : `The float holds ${cedis(gap)} more than the books expect. A top-up may not have been logged.`}
                    </p>
                  )}
                  {f.observedAt && <p className="pt-1 text-slate-400">Last read {new Date(f.observedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>}
                </dl>
              </div>
            )
          })}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel question="Is free cash growing?" answer="End of each day, from the reserve history.">
          <Legend
            items={[
              { label: 'Free to spend', colour: PALETTE.profit },
              { label: 'Owed to others', colour: PALETTE.amber },
            ]}
          />
          <div className="mt-3">
            <TrendChart
              labels={historyLabels}
              format={cedisCompact}
              axisFormat={cedisAxis}
              emptyText="No reserve history for this period."
              series={[
                { label: 'Free to spend', colour: PALETTE.profit, values: cash.history.map((h) => h.freeToSpend), area: true },
                { label: 'Owed to others', colour: PALETTE.amber, values: cash.history.map((h) => h.liabilities) },
              ]}
            />
          </div>
        </Panel>
        <Panel question="How have the floats moved?" answer="Each provider's balance, read once a day.">
          <Legend items={floatProviders.map((p) => ({ label: providerName(p), colour: PROVIDER_COLOURS[p] ?? PALETTE.slate }))} />
          <div className="mt-3">
            <TrendChart
              labels={floatDates.map(shortDate)}
              format={cedisCompact}
              axisFormat={cedisAxis}
              emptyText="Float readings start building up from today, one per day."
              series={floatProviders.map((p) => ({
                label: providerName(p),
                colour: PROVIDER_COLOURS[p] ?? PALETTE.slate,
                values: floatDates.map((d) => cash.floatHistory.find((f) => f.date === d && f.provider === p)?.balance ?? null),
              }))}
            />
          </div>
        </Panel>
      </div>
    </div>
  )
}
