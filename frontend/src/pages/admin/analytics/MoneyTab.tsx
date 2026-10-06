import { Delta, Kpi, Legend, PALETTE, PROVIDER_COLOURS, RankBars, StackedColumns, Waterfall } from '../../../components/insightCharts'
import type { Insights, MoneyCut } from '../../../lib/api'
import { bucketLabel, categoryName, cedis, cedisAxis, cedisCompact, cedisSigned, channelName, count, networkName, Panel, pct, providerName } from './shared'

function CutPanel({ question, rows, name, colour }: { question: string; rows: MoneyCut[]; name: (key: string) => string; colour?: (key: string) => string }) {
  const total = rows.reduce((sum, r) => sum + r.profit, 0)
  const top = rows[0]
  return (
    <Panel question={question} answer={top ? `${name(top.key)}: ${cedis(top.profit)} (${pct((top.profit / Math.max(1, total)) * 100)})` : 'No sales yet.'}>
      <RankBars
        format={cedisCompact}
        rows={rows.map((r) => ({
          key: r.key,
          label: name(r.key),
          value: r.profit,
          colour: colour?.(r.key),
          detail: (
            <span className="flex flex-wrap items-center gap-x-2">
              {count(r.orders)} orders, {pct((r.profit / Math.max(1, r.revenue)) * 100, 1)} margin
              <Delta value={r.profit} previous={r.previousProfit} />
            </span>
          ),
        }))}
      />
    </Panel>
  )
}

export default function MoneyTab({ data }: { data: Insights }) {
  const { money, meta } = data
  const t = money.totals
  const p = money.previousTotals
  const labels = money.series.map((s) => bucketLabel(s.bucket, meta.granularity))
  const delivered = data.summary.delivered.value

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Profit" value={cedis(t.profit)} compared={{ value: t.profit, previous: p.profit }} emphasis />
        <Kpi label="Sales delivered" value={cedis(t.revenue)} compared={{ value: t.revenue, previous: p.revenue }} />
        <Kpi
          label="Profit margin"
          value={pct((t.profit / Math.max(1, t.revenue)) * 100, 1)}
          compared={{ value: (t.profit / Math.max(1, t.revenue)) * 100, previous: (p.profit / Math.max(1, p.revenue)) * 100 }}
          points
        />
        <Kpi label="Profit per order" value={cedis(delivered > 0 ? t.profit / delivered : 0)} hint={`over ${count(delivered)} orders`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Panel
          className="lg:col-span-2"
          question="Where does each cedi of sales go?"
          answer={`You keep ${pct((t.profit / Math.max(1, t.revenue)) * 100, 1)} of every sale.`}
        >
          <Waterfall
            format={cedisSigned}
            steps={[
              { label: 'Sales delivered', value: t.revenue, total: true },
              { label: 'Bundle cost', value: -t.supplierCost },
              { label: 'Paystack fees', value: -t.paystackFee },
              { label: 'Agent earnings', value: -t.agentMargin },
              ...(t.adjustments !== 0 ? [{ label: 'Refunds and fixes', value: t.adjustments }] : []),
              { label: 'Profit', value: t.profit, total: true },
            ]}
          />
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            From the ledger, for orders placed in this period. A sale only counts once it is delivered.
          </p>
        </Panel>

        <Panel className="lg:col-span-3" question="How did sales split, period by period?" answer={`Each bar is one ${meta.granularity}'s sales; the green part is what you kept.`}>
          <Legend
            items={[
              { label: 'Profit', colour: PALETTE.profit },
              { label: 'Agent earnings', colour: PALETTE.violet },
              { label: 'Paystack fees', colour: PALETTE.amber },
              { label: 'Bundle cost', colour: PALETTE.slate },
            ]}
          />
          <div className="mt-3">
            <StackedColumns
              labels={labels}
              format={cedisCompact}
              axisFormat={cedisAxis}
              stacks={[
                { label: 'Bundle cost', colour: PALETTE.slate, values: money.series.map((s) => s.supplierCost) },
                { label: 'Paystack fees', colour: PALETTE.amber, values: money.series.map((s) => s.paystackFee) },
                { label: 'Agent earnings', colour: PALETTE.violet, values: money.series.map((s) => s.agentMargin) },
                { label: 'Profit', colour: PALETTE.profit, values: money.series.map((s) => Math.max(0, s.profit)) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <CutPanel question="Which network makes the most?" rows={money.byNetwork} name={networkName} />
        <CutPanel question="Which product type makes the most?" rows={money.byCategory} name={categoryName} />
        <CutPanel question="Which provider is more profitable?" rows={money.byProvider} name={providerName} colour={(k) => PROVIDER_COLOURS[k] ?? PALETTE.brand} />
        <CutPanel question="Agents or your own shop?" rows={money.byChannel} name={channelName} colour={(k) => (k === 'agent' ? PALETTE.violet : PALETTE.brand)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel question="Which products earn the most?" answer={money.topProducts[0] ? `${money.topProducts[0].name} (${networkName(money.topProducts[0].network)}) leads.` : 'No delivered orders yet.'}>
          <ProductTable rows={money.topProducts} />
        </Panel>
        <Panel
          question="Which products barely pay?"
          answer={
            money.thinProducts.length === 0
              ? 'Every product sold kept at least 3% of its price.'
              : `${money.thinProducts.length} product${money.thinProducts.length === 1 ? '' : 's'} kept under 3%. Check their prices.`
          }
        >
          {money.thinProducts.length > 0 ? (
            <ProductTable rows={money.thinProducts} />
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing to fix here.</p>
          )}
        </Panel>
      </div>
    </div>
  )
}

function ProductTable({ rows }: { rows: Insights['money']['topProducts'] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[22rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
            <th className="px-1 pb-2 font-medium">Product</th>
            <th className="px-1 pb-2 text-right font-medium">Orders</th>
            <th className="px-1 pb-2 text-right font-medium">Profit</th>
            <th className="px-1 pb-2 text-right font-medium">Margin</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <tr key={r.productId}>
              <td className="px-1 py-2">
                <span className="font-medium text-slate-800 dark:text-slate-100">{r.name}</span>
                <span className="ml-1.5 text-xs text-slate-500">{networkName(r.network)}</span>
              </td>
              <td className="px-1 py-2 text-right tabular-nums">{count(r.orders)}</td>
              <td className={`px-1 py-2 text-right font-semibold tabular-nums ${r.profit < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>{cedis(r.profit)}</td>
              <td className={`px-1 py-2 text-right tabular-nums ${r.marginPct < 3 ? 'text-amber-600 dark:text-amber-400' : ''}`}>{pct(r.marginPct, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
