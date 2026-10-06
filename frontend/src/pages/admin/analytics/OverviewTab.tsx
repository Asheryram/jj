import { Link } from 'react-router-dom'
import { Kpi, Meter, PALETTE, PROVIDER_COLOURS, RankBars, TrendChart } from '../../../components/insightCharts'
import { cn } from '../../../components/ui'
import type { Insights, InsightsAttention } from '../../../lib/api'
import { bucketLabel, cedis, cedisAxis, cedisCompact, changeWords, channelName, count, networkName, Panel, pct, providerName } from './shared'

export function AttentionList({ items }: { items: InsightsAttention[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
        <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
        Nothing needs your attention right now: floats, refunds, payouts and deliveries all look fine.
      </div>
    )
  }
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {items.map((item) => (
        <li key={item.title}>
          <Link
            to={item.link}
            className={cn(
              'flex h-full gap-3 rounded-2xl border px-4 py-3 transition-colors',
              item.level === 'danger'
                ? 'border-rose-200 bg-rose-50 hover:bg-rose-100/70 dark:border-rose-900 dark:bg-rose-950/40 dark:hover:bg-rose-950/60'
                : item.level === 'warning'
                  ? 'border-amber-200 bg-amber-50 hover:bg-amber-100/70 dark:border-amber-900 dark:bg-amber-950/30 dark:hover:bg-amber-950/50'
                  : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60',
            )}
          >
            <span
              className={cn(
                'mt-1.5 size-2 shrink-0 rounded-full',
                item.level === 'danger' ? 'bg-rose-500' : item.level === 'warning' ? 'bg-amber-500' : 'bg-slate-400',
              )}
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900 dark:text-slate-50">{item.title}</span>
              <span className="block text-xs text-slate-600 dark:text-slate-400">{item.detail}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function OverviewTab({ data, onTab }: { data: Insights; onTab: (tab: string) => void }) {
  const { summary, money, meta, cash } = data
  const labels = money.series.map((p) => bucketLabel(p.bucket, meta.granularity))
  const bestNetwork = money.byNetwork[0]
  const agentCut = money.byChannel.find((c) => c.key === 'agent')
  const totalProfit = money.totals.profit
  const tightest = [...cash.floats].filter((f) => f.daysLeft !== null).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))[0]

  return (
    <div className="space-y-5">
      <AttentionList items={data.attention} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Profit earned" value={cedis(summary.profit.value)} compared={summary.profit} emphasis hint={`${pct(summary.marginPct.value, 1)} of sales`} />
        <Kpi label="Sales delivered" value={cedis(summary.revenue.value)} compared={summary.revenue} />
        <Kpi label="Orders delivered" value={count(summary.delivered.value)} compared={summary.delivered} />
        <Kpi label="Paying customers" value={count(summary.buyers.value)} compared={summary.buyers} />
        <Kpi label="Average order" value={cedis(summary.avgOrderValue.value)} compared={summary.avgOrderValue} />
        <Kpi label="Profit margin" value={pct(summary.marginPct.value, 1)} compared={summary.marginPct} points />
        <Kpi label="Delivered successfully" value={pct(summary.successRate.value, 1)} compared={summary.successRate} points hint="of paid orders" />
        <Kpi label="Checkouts that paid" value={pct(summary.conversion.value)} compared={summary.conversion} points />
      </div>

      <Panel
        question="Is the business growing?"
        answer={
          summary.profit.previous > 0
            ? `Profit is ${changeWords(summary.profit.value, summary.profit.previous)}.`
            : `${cedis(summary.profit.value)} profit from ${count(summary.delivered.value)} delivered orders.`
        }
        action={
          <button type="button" onClick={() => onTab('money')} className="shrink-0 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
            Money details
          </button>
        }
      >
        <TrendChart
          labels={labels}
          format={cedisCompact}
          axisFormat={cedisAxis}
          series={[
            { label: 'Sales delivered', colour: PALETTE.brand, values: money.series.map((p) => p.revenue), area: true },
            { label: 'Profit', colour: PALETTE.profit, values: money.series.map((p) => p.profit) },
          ]}
        />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel
          question="Where does the profit come from?"
          answer={bestNetwork ? `${networkName(bestNetwork.key)} makes ${pct((bestNetwork.profit / Math.max(1, totalProfit)) * 100)} of it.` : 'No sales yet.'}
        >
          <RankBars
            format={cedisCompact}
            rows={money.byNetwork.map((n) => ({
              key: n.key,
              label: networkName(n.key),
              value: n.profit,
              detail: `${count(n.orders)} orders, ${cedisCompact(n.revenue)} sales`,
            }))}
          />
        </Panel>

        <Panel
          question="Agents or your own shop?"
          answer={agentCut ? `Agents bring ${pct((agentCut.profit / Math.max(1, totalProfit)) * 100)} of profit.` : 'All sales came through your own shop.'}
        >
          <RankBars
            format={cedisCompact}
            rows={money.byChannel.map((c) => ({
              key: c.key,
              label: channelName(c.key),
              value: c.profit,
              colour: c.key === 'agent' ? PALETTE.violet : PALETTE.brand,
              detail: `${count(c.orders)} orders`,
            }))}
          />
          <button type="button" onClick={() => onTab('agents')} className="mt-4 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
            See agents
          </button>
        </Panel>

        <Panel
          question="Can we keep selling tomorrow?"
          answer={
            cash.now.freeToSpend < 0
              ? 'No: more is owed than the business holds.'
              : tightest && tightest.daysLeft !== null && tightest.daysLeft < 3
                ? `Top up ${providerName(tightest.provider)} soon.`
                : 'Yes, floats and cash look healthy.'
          }
        >
          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Free to spend</p>
              <p className={cn('text-xl font-bold tabular-nums', cash.now.freeToSpend < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-50')}>
                {cedis(cash.now.freeToSpend)}
              </p>
            </div>
            {cash.floats.map((f) => (
              <div key={f.provider}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                    <span className="size-2 rounded-full" style={{ background: PROVIDER_COLOURS[f.provider] ?? PALETTE.slate }} />
                    {providerName(f.provider)} float
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                    {f.daysLeft === null ? 'no recent spend' : f.daysLeft >= 30 ? '30+ days' : `${f.daysLeft.toFixed(1)} days`}
                  </span>
                </div>
                <Meter value={f.daysLeft ?? 30} max={14} tone={f.daysLeft === null || f.daysLeft >= 5 ? 'good' : f.daysLeft >= 2 ? 'warn' : 'bad'} />
              </div>
            ))}
            <button type="button" onClick={() => onTab('cash')} className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
              Cash and floats
            </button>
          </div>
        </Panel>
      </div>
    </div>
  )
}
