import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Kpi, Legend, PALETTE, StackedColumns } from '../../../components/insightCharts'
import { Button, cn, Spinner } from '../../../components/ui'
import { api, ApiError, type AnalyticsDecisions, type Decision } from '../../../lib/api'
import { cedis, cedisAxis, Panel, providerName } from './shared'

/**
 * What to do this week, not what happened. Leads with how the business is
 * moving, then a short ranked list of decisions, each with its evidence,
 * what it is worth and one link to act. Reads live production data, so it
 * works even when the analytics warehouse is behind or down.
 */
export default function DecisionsTab() {
  const [data, setData] = useState<AnalyticsDecisions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.analyticsDecisions())
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not work out this week’s decisions.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
        <p className="font-semibold">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  const worth = data.decisions.reduce((sum, d) => sum + (d.monthlyImpact ?? 0), 0)

  return (
    <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}>
      <PulseRow data={data} />

      <section aria-labelledby="decisions-heading">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="decisions-heading" className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {data.decisions.length === 0 ? 'Nothing needs a decision this week' : `Do this week (${data.decisions.length})`}
          </h2>
          {worth > 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Worth about <span className="font-semibold text-emerald-700 dark:text-emerald-400">{cedis(worth)} a month</span> together
            </p>
          )}
        </div>
        <div className="space-y-3">
          {data.decisions.map((decision) => (
            <DecisionCard key={decision.id} decision={decision} />
          ))}
        </div>
      </section>

      <WeeksPanel data={data} />
      <PriceSimulator products={data.products} />

      <p className="text-xs text-slate-500 dark:text-slate-400">
        From live orders and the ledger, last 4 weeks unless a card says otherwise. Worked out{' '}
        {new Date(data.at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}.
      </p>
    </div>
  )
}

function percent(change: number | null): string | undefined {
  if (change === null) return undefined
  const rounded = Math.round(change * 100)
  return rounded === 0 ? 'steady' : `${rounded > 0 ? 'up' : 'down'} ${Math.abs(rounded)}%`
}

/** The one sentence a busy owner reads first: which way, and why. */
function headline(p: NonNullable<AnalyticsDecisions['pulse']>): string {
  const sales = percent(p.salesChange)
  const profit = percent(p.profitChange)
  const parts = [`Last week, sales were ${sales ?? 'new'} and profit ${profit ?? 'new'} on the four weeks before.`]
  if ((p.agentsChange ?? 0) < -0.1 && (p.ownShopChange ?? 0) >= 0) {
    parts.push('Agent sales are falling while your own shop holds up: the agents are where the gap is.')
  } else if ((p.agentsChange ?? 0) < -0.1) {
    parts.push('Agent sales are falling.')
  } else if ((p.ownShopChange ?? 0) < -0.1) {
    parts.push('Your own shop is selling less.')
  }
  if ((p.salesChange ?? 0) < 0 && (p.profitChange ?? 0) >= 0) {
    parts.push('Profit held because more of it now comes from your own shop, which keeps more per sale.')
  }
  return parts.join(' ')
}

function PulseRow({ data }: { data: AnalyticsDecisions }) {
  const p = data.pulse
  if (!p) return null
  const before = data.weeks.filter((w) => w.complete).slice(-5, -1)
  const avg = (pick: (w: (typeof before)[number]) => number) =>
    before.length ? Math.round(before.reduce((s, w) => s + pick(w), 0) / before.length) : 0
  return (
    <div>
      <p className="mb-3 text-sm text-slate-700 dark:text-slate-200">{headline(p)}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Sales last week" value={cedis(p.sales)} compared={{ value: p.sales, previous: avg((w) => w.sales) }} hint="vs 4-week average" />
        <Kpi label="Profit last week" value={cedis(p.profit)} compared={{ value: p.profit, previous: avg((w) => w.profit) }} hint="vs 4-week average" emphasis />
        <Kpi
          label="Agents selling"
          value={String(p.activeAgents)}
          compared={{ value: p.activeAgents, previous: p.activeAgentsBefore }}
          hint={`usually ${p.activeAgentsBefore}`}
        />
        <Kpi
          label="This week so far"
          value={data.thisWeek ? cedis(data.thisWeek.sales) : cedis(0)}
          hint={data.thisWeek ? `${cedis(data.thisWeek.profit)} profit` : 'no sales yet'}
        />
      </div>
    </div>
  )
}

const URGENCY_STYLE: Record<Decision['urgency'], { label: string; chip: string; stripe: string }> = {
  now: { label: 'Now', chip: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300', stripe: 'bg-rose-500' },
  this_week: { label: 'This week', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300', stripe: 'bg-amber-500' },
  when_you_can: { label: 'When you can', chip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', stripe: 'bg-slate-300 dark:bg-slate-600' },
}

function DecisionCard({ decision }: { decision: Decision }) {
  const style = URGENCY_STYLE[decision.urgency]
  return (
    <article className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 pl-5 sm:p-5 sm:pl-6 dark:border-slate-800 dark:bg-slate-900">
      <span className={cn('absolute inset-y-0 left-0 w-1', style.stripe)} aria-hidden />
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', style.chip)}>{style.label}</span>
        {decision.monthlyImpact !== null && decision.monthlyImpact > 0 && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            ≈ {cedis(decision.monthlyImpact)} a month
          </span>
        )}
      </div>
      <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-50">{decision.title}</h3>
      <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
        {decision.evidence.map((line) => (
          <li key={line} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-slate-400" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {decision.caveat && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{decision.caveat}</p>}
      <Link
        to={decision.action.to}
        className="mt-3 inline-flex items-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400"
      >
        {decision.action.label}
      </Link>
    </article>
  )
}

function WeeksPanel({ data }: { data: AnalyticsDecisions }) {
  const weeks = data.weeks
  if (weeks.length < 2) return null
  const label = (w: (typeof weeks)[number]) =>
    new Date(`${w.week}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + (w.complete ? '' : ' (so far)')
  return (
    <Panel question="Where are sales coming from, week by week?" answer="Agents' sales against your own shop, with the profit you kept.">
      <Legend
        items={[
          { label: 'Agents', colour: PALETTE.brand },
          { label: 'Your own shop', colour: PALETTE.violet },
          { label: 'Profit', colour: PALETTE.profit },
        ]}
      />
      <StackedColumns
        labels={weeks.map(label)}
        stacks={[
          { label: 'Agents', colour: PALETTE.brand, values: weeks.map((w) => w.agents) },
          { label: 'Your own shop', colour: PALETTE.violet, values: weeks.map((w) => w.ownShop) },
        ]}
        line={{ label: 'Profit', colour: PALETTE.profit, values: weeks.map((w) => w.profit) }}
        format={cedis}
        axisFormat={cedisAxis}
      />
    </Panel>
  )
}

/**
 * Try a price change on one bundle before making it. Uses that bundle's own
 * last 4 weeks: what it sold, and what you kept per sale after every cost.
 */
function PriceSimulator({ products }: { products: AnalyticsDecisions['products'] }) {
  const [productId, setProductId] = useState(products[0]?.productId ?? '')
  const [change, setChange] = useState('0.50')
  const product = products.find((p) => p.productId === productId) ?? products[0]

  const result = useMemo(() => {
    if (!product) return null
    const delta = Math.round(Number(change) * 100)
    if (!Number.isFinite(delta)) return null
    const now = product.avgProfit
    const next = now + delta
    const monthly = (perSale: number) => Math.round((perSale * product.sold * 30) / 28)
    return {
      delta,
      now,
      next,
      monthlyNow: monthly(now),
      monthlyNext: monthly(next),
      // Raising: how far sales can fall before you are worse off.
      // Cutting: how much more must sell just to stand still.
      breakEven: next <= 0 ? null : delta > 0 ? 1 - now / next : delta < 0 ? now / next - 1 : 0,
    }
  }, [product, change])

  if (!product) return null
  return (
    <Panel question="What if I change a price?" answer="Try it here before changing it on Prices.">
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Bundle</span>
          <select
            value={product.productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            {products.map((p) => (
              <option key={p.productId} value={p.productId}>
                {p.network ? `${p.network} ` : ''}
                {p.name} · {providerName(p.provider)} · {p.sold} sold
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Change per sale (GHS)</span>
          <input
            type="number"
            step="0.10"
            inputMode="decimal"
            value={change}
            onChange={(e) => setChange(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
      </div>
      {result && (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <Stat label="You keep per sale" value={`${cedis(result.now)} → ${cedis(result.next)}`} />
          <Stat label="A month, same sales" value={`${cedis(result.monthlyNow)} → ${cedis(result.monthlyNext)}`} />
          <Stat
            label={result.delta >= 0 ? 'Still worth it unless sales fall more than' : 'Needs this many more sales to break even'}
            value={result.breakEven === null ? 'never' : `${Math.round(result.breakEven * 100)}%`}
          />
          <Stat label="Average price paid now" value={cedis(product.avgSale)} />
        </dl>
      )}
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        The change is to your own price, so agents pass it on to their customers. Based on {product.sold} sales in the last 4 weeks;
        a bundle that sold only a few times is a rough guide.
      </p>
    </Panel>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value}</dd>
    </div>
  )
}
