import { Funnel, Heatmap, Kpi, Legend, PALETTE, RankBars, StackedColumns, TrendChart } from '../../../components/insightCharts'
import type { Insights } from '../../../lib/api'
import { bucketLabel, cedis, count, MiniStat, networkName, Panel, pct } from './shared'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function busiest(heatmap: number[][]) {
  const byDay = heatmap.map((row) => row.reduce((a, b) => a + b, 0))
  const byHour = Array.from({ length: 24 }, (_, h) => heatmap.reduce((sum, row) => sum + row[h], 0))
  const day = byDay.indexOf(Math.max(...byDay))
  // The busiest 3-hour window, which is what staffing and top-ups actually plan around.
  let best = 0
  let bestStart = 0
  for (let h = 0; h < 24; h++) {
    const window = byHour[h] + byHour[(h + 1) % 24] + byHour[(h + 2) % 24]
    if (window > best) {
      best = window
      bestStart = h
    }
  }
  const total = byHour.reduce((a, b) => a + b, 0)
  const clock = (h: number) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'am' : 'pm')
  return { day: WEEKDAYS[day], window: `${clock(bestStart)} to ${clock((bestStart + 3) % 24)}`, windowShare: total > 0 ? best / total : 0, total }
}

export default function SalesTab({ data }: { data: Insights }) {
  const { sales, meta } = data
  const labels = sales.series.map((s) => bucketLabel(s.bucket, meta.granularity))
  const peak = busiest(sales.heatmap)
  const f = sales.funnel
  const totalNetwork = sales.networkShare.reduce((sum, n) => sum + n.orders, 0)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Orders paid for" value={count(sales.kpis.paid.value)} compared={sales.kpis.paid} emphasis />
        <Kpi label="Checkouts started" value={count(sales.kpis.placed.value)} compared={sales.kpis.placed} />
        <Kpi label="Checkouts that paid" value={pct(sales.kpis.conversion.value)} compared={sales.kpis.conversion} points />
        <Kpi label="Paying customers" value={count(sales.kpis.buyers.value)} compared={sales.kpis.buyers} />
        <Kpi label="Average order" value={cedis(sales.kpis.avgOrderValue.value)} compared={sales.kpis.avgOrderValue} />
      </div>

      <Panel question="How many orders, period by period?" answer={`${count(f.paid)} paid orders, ${count(f.delivered)} delivered.`}>
        <TrendChart
          labels={labels}
          format={(v) => count(v)}
          series={[
            { label: 'Checkouts started', colour: PALETTE.slate, values: sales.series.map((s) => s.placed), dashed: true },
            { label: 'Paid', colour: PALETTE.brand, values: sales.series.map((s) => s.paid), area: true },
            { label: 'Delivered', colour: PALETTE.profit, values: sales.series.map((s) => s.delivered) },
          ]}
        />
        <div className="mt-3">
          <Legend
            items={[
              { label: 'Checkouts started', colour: PALETTE.slate, dashed: true },
              { label: 'Paid', colour: PALETTE.brand },
              { label: 'Delivered', colour: PALETTE.profit },
            ]}
          />
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          question="When do people buy?"
          answer={peak.total > 0 ? `Busiest on ${peak.day}s, and ${pct(peak.windowShare * 100)} of orders land between ${peak.window}.` : 'No paid orders yet.'}
        >
          <Heatmap grid={sales.heatmap} unit="paid orders" />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Keep floats topped up before the busy hours.</p>
        </Panel>
        <Panel
          className="lg:col-span-2"
          question="Where do checkouts drop off?"
          answer={f.placed > 0 ? `${pct((f.neverPaid / f.placed) * 100)} of checkouts were never paid.` : 'No checkouts yet.'}
        >
          <Funnel
            steps={[
              { label: 'Checkout started', value: f.placed },
              { label: 'Paid', value: f.paid, note: f.neverPaid > 0 ? `${count(f.neverPaid)} left without paying (declined, timed out or abandoned).` : undefined },
              { label: 'Delivered', value: f.delivered, note: f.failedAfterPay > 0 ? `${count(f.failedAfterPay)} failed after paying and were refunded.` : undefined },
            ]}
          />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          question="Are customers coming back?"
          answer={
            sales.buyers.total > 0
              ? `${pct((sales.buyers.boughtTwiceOrMore / sales.buyers.total) * 100)} of paying customers bought more than once in this period.`
              : 'No paying customers yet.'
          }
        >
          <div className="mb-4 grid grid-cols-3 gap-2">
            <MiniStat label="Paying customers" value={count(sales.buyers.total)} />
            <MiniStat label="New this period" value={count(sales.buyers.new)} />
            <MiniStat label="Bought more than once" value={count(sales.buyers.boughtTwiceOrMore)} tone="good" />
          </div>
          <Legend
            items={[
              { label: 'Had bought before', colour: PALETTE.brand },
              { label: 'First ever order', colour: PALETTE.brandSoft },
            ]}
          />
          <div className="mt-3">
            <StackedColumns
              labels={labels}
              format={(v) => count(v)}
              height={200}
              stacks={[
                { label: 'Had bought before', colour: PALETTE.brand, values: sales.series.map((s) => s.buyers - s.newBuyers) },
                { label: 'First ever order', colour: PALETTE.brandSoft, values: sales.series.map((s) => s.newBuyers) },
              ]}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Customers who paid each {meta.granularity}, split by whether it was their first order ever.</p>
        </Panel>
        <Panel
          className="lg:col-span-2"
          question="Which network do customers buy?"
          answer={sales.networkShare[0] ? `${networkName(sales.networkShare[0].key)}: ${pct((sales.networkShare[0].orders / Math.max(1, totalNetwork)) * 100)} of paid orders.` : 'No paid orders yet.'}
        >
          <RankBars
            format={(v) => count(v)}
            rows={sales.networkShare.map((n) => ({
              key: n.key,
              label: networkName(n.key),
              value: n.orders,
              detail: `${pct((n.orders / Math.max(1, totalNetwork)) * 100)} of paid orders`,
            }))}
          />
        </Panel>
      </div>
    </div>
  )
}
