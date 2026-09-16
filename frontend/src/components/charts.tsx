import { cedisCompact } from '../lib/format'
import { cn } from './ui'

/**
 * Hand-rolled SVG charts. A charting library would be the heaviest thing on
 * the page and these dashboards need three shapes, not thirty (NFR-1.1).
 * Every chart is labelled in text as well as drawn, so it is not colour-only.
 */

/**
 * Rounds up to a "nice" axis ceiling (1/2/5/10 × a power of ten), the way
 * every chart library's default axis behaves, so the y-axis reads 500 or
 * 250, never 287.
 */
function niceCeiling(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const fraction = value / magnitude
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return niceFraction * magnitude
}

/**
 * The axis floor and ceiling to actually draw against, not the raw data
 * min/max: rounded to the same "nice" numbers as `niceCeiling`, and pinned
 * at 0 unless the data itself goes negative (a loss-making day's profit, an
 * over-cost margin), in which case the floor gets the same nice-rounding
 * treatment the ceiling always has.
 */
function niceAxisBounds(min: number, max: number): { axisMin: number; axisMax: number } {
  const axisMax = max > 0 ? niceCeiling(max) : 0
  const axisMin = min < 0 ? -niceCeiling(-min) : 0
  return { axisMin, axisMax: axisMax > axisMin ? axisMax : axisMin + 1 }
}

/**
 * Beyond a handful of points, a label under every single one crowds
 * unreadably, thin to every Nth once density passes a threshold. Shared by
 * every chart with a per-point x-axis strip.
 */
function xAxisStep(pointCount: number): number {
  return pointCount > 45 ? 14 : pointCount > 20 ? 7 : 1
}

export function BarChart({
  data,
  height = 160,
  valueLabel = cedisCompact,
  label = 'Daily totals',
}: {
  data: { day: string; revenue: number }[]
  height?: number
  valueLabel?: (value: number) => string
  label?: string
}) {
  const rawMax = Math.max(...data.map((d) => d.revenue), 1)
  const axisMax = niceCeiling(rawMax)
  const total = data.reduce((sum, d) => sum + d.revenue, 0)

  // The standout points get a permanent label instead of a hover-only one:
  // the highest bar, the most recent day, and the lowest. At a small enough
  // count every bar can carry one without crowding, so it does.
  const maxIndex = data.reduce((best, d, i) => (d.revenue > data[best].revenue ? i : best), 0)
  const minIndex = data.reduce((best, d, i) => (d.revenue < data[best].revenue ? i : best), 0)
  const highlighted = new Set(data.length > 0 ? [maxIndex, minIndex, data.length - 1] : [])
  const labelEveryBar = data.length <= 10

  // Beyond a handful of bars, a day label under every single one truncates
  // to nothing readable, an axis-style "every Nth" tick reads better than
  // crowding does.
  const xLabelStep = xAxisStep(data.length)
  const showXLabel = (index: number) =>
    xLabelStep === 1 || index % xLabelStep === 0 || index === data.length - 1 || highlighted.has(index)

  return (
    <figure className="m-0">
      {/*
        Hover tooltips are useless to a screen reader and to anyone who cannot
        hover, so the same numbers exist as a real table underneath, read out in
        order. The drawing itself is hidden from assistive tech to avoid saying
        everything twice.
      */}
      {/* `overflow-x-hidden` clips only at this row's own right/left edge, so
          a thinned label's intentional spill into an empty neighbour column
          (below) still shows, it just can't push past the chart's own
          boundary and force the page to scroll horizontally on a narrow
          (mobile, or a squeezed 2-column) container. */}
      <div aria-hidden="true" className="flex gap-2 overflow-x-hidden">
        <div className="flex shrink-0 flex-col justify-between text-right text-[10px] text-slate-400 dark:text-slate-500" style={{ height }}>
          <span>{valueLabel(axisMax)}</span>
          <span>{valueLabel(axisMax / 2)}</span>
          <span>{valueLabel(0)}</span>
        </div>
        {/* Everything sized off the bars, not the axis-label column: its width
            varies with `valueLabel`'s output, so the x-axis row below lives in
            this same flex-1 column rather than guessing that width. */}
        <div className="min-w-0 flex-1">
          <div className="relative">
            <div className="absolute inset-0 flex flex-col justify-between" style={{ height }}>
              <div className="border-t border-slate-100 dark:border-slate-800" />
              <div className="border-t border-slate-100 dark:border-slate-800" />
              <div className="border-t border-slate-200 dark:border-slate-700" />
            </div>
            <div className="relative flex items-end gap-1.5 sm:gap-3" style={{ height }}>
              {data.map((point, index) => {
                const pct = (point.revenue / axisMax) * 100
                const alwaysShown = labelEveryBar || highlighted.has(index)
                return (
                  <div key={point.day} className="group flex h-full min-w-0 flex-1 flex-col justify-end">
                    <span
                      className={cn(
                        'tabular mb-1 text-center text-[10px] font-semibold text-slate-600 dark:text-slate-300 transition-opacity sm:text-[11px]',
                        alwaysShown ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      )}
                    >
                      {valueLabel(point.revenue)}
                    </span>
                    <div
                      className="w-full rounded-t-md bg-brand-600 transition-colors group-hover:bg-brand-700"
                      style={{ height: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
          <div className="mt-2 flex gap-1.5 sm:gap-3">
            {data.map((point, index) => (
              <span
                key={point.day}
                className={cn(
                  'min-w-0 flex-1 text-center text-[11px] text-slate-500 dark:text-slate-400',
                  // A shown label's neighbours are text-empty far more often
                  // than not, once thinning has kicked in, so it can spill
                  // into their space instead of clipping to its own column's
                  // sliver. `truncate` stays for the dense (unthinned) case,
                  // where every column really does need to fit itself alone.
                  xLabelStep === 1 ? 'truncate' : 'overflow-visible whitespace-nowrap',
                )}
              >
                {showXLabel(index) ? point.day : ''}
              </span>
            ))}
          </div>
        </div>
      </div>

      <figcaption className="sr-only">
        <table>
          <caption>
            {label}, {data.length} days, {valueLabel(total)} in total
          </caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.day}>
                <th scope="row">{point.day}</th>
                <td>{valueLabel(point.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  )
}

/** A horizontal reference line drawn at a fixed value, e.g. an alert threshold. */
export interface ChartThreshold {
  value: number
  label: string
  tone?: 'warning' | 'danger'
}

/**
 * A trend over time: revenue, profit, a rate drifting up or down. `BarChart`
 * above is for discrete, comparable buckets (hour of day, one bar each); a
 * continuous series read better as a line, and forcing one into bars implies
 * unrelated categories that aren't there.
 *
 * Same accessible-table-underneath pattern as `BarChart`: the drawing is
 * `aria-hidden`, the real numbers exist as a table for anyone not looking at
 * the SVG. A native `<title>` per point gives a hover value on desktop
 * without any extra state, the point markers are large enough to be a real
 * hover/tap target on a phone.
 *
 * `previous`, index-aligned with `data` (not date-aligned: it is the equal
 * length period immediately before), draws a second, dashed, lighter line on
 * the same axes so "this period vs last period" reads off one chart instead
 * of a number in one place and a line in another. `thresholds` draws a fixed
 * reference line, e.g. the same alert floor/ceiling used in `attentionItems`,
 * so a viewer can see how close a metric is to tripping the alert, not just
 * whether it did.
 */
export function LineChart({
  data,
  previous,
  height = 160,
  valueLabel = cedisCompact,
  label = 'Daily totals',
  thresholds,
}: {
  data: { day: string; revenue: number }[]
  previous?: number[]
  height?: number
  valueLabel?: (value: number) => string
  label?: string
  thresholds?: ChartThreshold[]
}) {
  const width = 100
  const allValues = [...data.map((d) => d.revenue), ...(previous ?? []), ...(thresholds ?? []).map((t) => t.value)]
  const rawMax = Math.max(...allValues, 0)
  const rawMin = Math.min(...allValues, 0)
  const { axisMin, axisMax } = niceAxisBounds(rawMin, rawMax)
  const span = axisMax - axisMin
  const total = data.reduce((sum, d) => sum + d.revenue, 0)

  const yFor = (value: number) => height - 6 - ((value - axisMin) / span) * (height - 12)
  const xFor = (index: number) => (data.length > 1 ? (index / (data.length - 1)) * width : width / 2)

  // 6px of headroom top and bottom so a point at the max/min isn't drawn
  // right on the edge of the viewBox, clipped by its own stroke width.
  const points = data.map((point, index) => ({ ...point, x: xFor(index), y: yFor(point.revenue) }))
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1].x.toFixed(2)},${height} L${points[0].x.toFixed(2)},${height} Z`
      : ''

  const previousPoints = (previous ?? []).map((value, index) => ({ x: xFor(index), y: yFor(value) }))
  const previousPath = previousPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

  const xLabelStep = xAxisStep(data.length)
  const showXLabel = (index: number) => xLabelStep === 1 || index % xLabelStep === 0 || index === data.length - 1

  return (
    <figure className="m-0">
      {(previous || thresholds) && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          {previous && (
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full bg-brand-600" /> This period
            </span>
          )}
          {previous && (
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full border-t-2 border-dashed border-slate-400 dark:border-slate-500" /> Previous period
            </span>
          )}
          {thresholds?.map((t) => (
            <span key={t.label} className="flex items-center gap-1.5">
              <span
                className={cn(
                  'h-0.5 w-4 rounded-full border-t-2 border-dashed',
                  t.tone === 'danger' ? 'border-red-500' : 'border-amber-500',
                )}
              />
              {t.label} ({valueLabel(t.value)})
            </span>
          ))}
        </div>
      )}
      {/* `overflow-x-hidden`: see the identical note in `BarChart`. */}
      <div aria-hidden="true" className="flex gap-2 overflow-x-hidden">
        <div className="flex shrink-0 flex-col justify-between text-right text-[10px] text-slate-400 dark:text-slate-500" style={{ height }}>
          <span>{valueLabel(axisMax)}</span>
          <span>{valueLabel((axisMax + axisMin) / 2)}</span>
          <span>{valueLabel(axisMin)}</span>
        </div>
        {/* Same reasoning as `BarChart`: the x-axis row lives in this same
            flex-1 column rather than guessing the label column's width. */}
        <div className="min-w-0 flex-1">
          <div className="relative">
            <div className="absolute inset-0 flex flex-col justify-between" style={{ height }}>
              <div className="border-t border-slate-100 dark:border-slate-800" />
              <div className="border-t border-slate-100 dark:border-slate-800" />
              <div className="border-t border-slate-200 dark:border-slate-700" />
            </div>
            {/*
              `preserveAspectRatio="none"` stretches this SVG's 100-unit-wide
              viewBox to the container's actual (much wider) pixel width, and
              that stretch is anisotropic: horizontal and vertical end up at
              different scales. A path's shape survives that fine, a line is
              a line either way, but any geometry defined by a single radius
              does not: a `<circle>` drawn in this same coordinate space comes
              out stretched into an oval, and even the line's own round caps
              and joins smear at each vertex for the same reason. So the line
              itself stays in here, the point markers below are ordinary HTML
              circles instead, positioned by percentage/pixel, immune to the
              SVG's own distortion.
            */}
            <svg
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              style={{ height }}
              className="relative w-full overflow-visible"
            >
              <path d={areaPath} fill="var(--color-brand-100)" className="dark:opacity-20" />
              {thresholds?.map((t) => (
                <line
                  key={t.label}
                  x1="0"
                  x2={width}
                  y1={yFor(t.value)}
                  y2={yFor(t.value)}
                  stroke={t.tone === 'danger' ? 'var(--color-red-500)' : 'var(--color-amber-500)'}
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {previous && (
                <path
                  d={previousPath}
                  fill="none"
                  stroke="var(--color-slate-400)"
                  strokeWidth="1.5"
                  strokeDasharray="5 4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <path
                d={linePath}
                fill="none"
                stroke="var(--color-brand-600)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {points.map((p) => (
              <span
                key={p.day}
                title={`${p.day}: ${valueLabel(p.revenue)}`}
                className="absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-700 dark:bg-brand-300"
                style={{ left: `${p.x}%`, top: p.y }}
              />
            ))}
          </div>
          <div className="mt-2 flex gap-1.5 sm:gap-3">
            {data.map((point, index) => (
              <span
                key={point.day}
                className={cn(
                  'min-w-0 flex-1 text-center text-[11px] text-slate-500 dark:text-slate-400',
                  xLabelStep === 1 ? 'truncate' : 'overflow-visible whitespace-nowrap',
                )}
              >
                {showXLabel(index) ? point.day : ''}
              </span>
            ))}
          </div>
        </div>
      </div>

      <figcaption className="sr-only">
        <table>
          <caption>
            {label}, {data.length} days, {valueLabel(total)} in total
          </caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Amount</th>
              {previous && <th scope="col">Same day, previous period</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((point, index) => (
              <tr key={point.day}>
                <th scope="row">{point.day}</th>
                <td>{valueLabel(point.revenue)}</td>
                {previous && <td>{previous[index] !== undefined ? valueLabel(previous[index]) : ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  )
}

export function Sparkline({
  values,
  className,
}: {
  values: number[]
  className?: string
}) {
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const width = 100
  const height = 28

  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width
    const y = height - ((value - min) / span) * (height - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('h-8 w-full', className)}
      aria-hidden="true"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/**
 * One colour per category (six of them), so nothing ever wraps around and shows
 * two segments in the same hue. Sky and amber are avoided on purpose: they read
 * as near-misses of the brand's Deep Blue and Golden Yellow.
 */
const DONUT_COLOURS = [
  'var(--color-brand-700)',
  'var(--color-accent-500)',
  'var(--color-brand-300)',
  'var(--color-teal-500)',
  'var(--color-violet-400)',
  'var(--color-slate-400)',
]

export function Donut({
  segments,
  total,
  centreLabel,
  centreValue,
}: {
  segments: { label: string; value: number }[]
  total: number
  centreLabel: string
  centreValue: string
}) {
  const radius = 42
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="flex flex-wrap items-center gap-5">
      {/* The ring is decoration: the legend beside it already states every share
          as a percentage in text, so it is not colour-only. */}
      <svg viewBox="0 0 100 100" className="size-32 shrink-0 -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-slate-100)" strokeWidth="14" />
        {segments.map((segment, index) => {
          const fraction = total > 0 ? segment.value / total : 0
          const dash = fraction * circumference
          const element = (
            <circle
              key={segment.label}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={DONUT_COLOURS[index % DONUT_COLOURS.length]}
              strokeWidth="14"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            />
          )
          offset += dash
          return element
        })}
        <text
          x="50"
          y="47"
          textAnchor="middle"
          className="rotate-90 fill-slate-500 text-[7px]"
          style={{ transformOrigin: '50px 50px' }}
        >
          {centreLabel}
        </text>
        <text
          x="50"
          y="58"
          textAnchor="middle"
          className="rotate-90 fill-slate-900 text-[11px] font-bold"
          style={{ transformOrigin: '50px 50px' }}
        >
          {centreValue}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-2">
        {segments.map((segment, index) => (
          <li key={segment.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: DONUT_COLOURS[index % DONUT_COLOURS.length] }}
              />
              <span className="truncate text-slate-600 dark:text-slate-300">{segment.label}</span>
            </span>
            <span className="tabular shrink-0 font-semibold text-slate-800 dark:text-slate-100">
              {total > 0 ? Math.round((segment.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Growing-severity ramp: fast (brand) through slow (red), fixed bucket order, not chosen per caller. */
const DISTRIBUTION_COLOURS = ['bg-brand-600', 'bg-brand-300', 'bg-amber-400', 'bg-red-500']

/**
 * A compact stacked-bar view of a bucketed turnaround metric (e.g.
 * <1h / 1-4h / 4-24h / 24h+), shown next to the single averaged number it
 * explains. One slow outlier can hide inside a fine-looking mean; this shows
 * the shape the average was computed from instead of trusting the mean alone.
 */
export function DistributionBar({ buckets }: { buckets: { label: string; count: number }[] }) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0)
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {total === 0
          ? null
          : buckets.map(
              (b, i) =>
                b.count > 0 && (
                  <div
                    key={b.label}
                    className={DISTRIBUTION_COLOURS[i % DISTRIBUTION_COLOURS.length]}
                    style={{ width: `${(b.count / total) * 100}%` }}
                    title={`${b.label}: ${b.count}`}
                  />
                ),
            )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
        {buckets.map((b) => (
          <span key={b.label}>
            {b.label}: <span className="tabular font-medium text-slate-700 dark:text-slate-200">{b.count}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * A "who/what is bigger than what else" comparison, top agents, dispatch
 * reliability by network, refund reasons: exactly the shape a horizontal bar
 * makes legible at a glance, where the matching table only gives exact
 * values after mental subtraction. Meant beside its table, not instead of
 * it. `threshold` draws the same reference line `LineChart` draws
 * horizontally, so an alert floor/ceiling is visible on the chart itself,
 * not only implied by a colour once it's already been crossed.
 */
export function RankedBarChart({
  rows,
  valueLabel = (value: number) => String(value),
  threshold,
  toneForValue,
}: {
  rows: { label: string; value: number }[]
  valueLabel?: (value: number) => string
  threshold?: ChartThreshold
  toneForValue?: (value: number) => 'warning' | 'danger' | undefined
}) {
  const max = Math.max(...rows.map((r) => r.value), threshold?.value ?? 0, 1)
  return (
    <div className="space-y-2.5">
      {rows.map((row) => {
        const tone = toneForValue?.(row.value)
        return (
          <div key={row.label} className="flex items-center gap-2 text-sm">
            <span className="w-16 shrink-0 truncate text-slate-600 dark:text-slate-300 sm:w-24 md:w-28" title={row.label}>
              {row.label}
            </span>
            <div className="relative h-4 min-w-0 flex-1 rounded-sm bg-slate-100 dark:bg-slate-800">
              <div
                className={cn(
                  'h-full rounded-sm',
                  tone === 'danger' ? 'bg-red-500' : tone === 'warning' ? 'bg-amber-400' : 'bg-brand-600',
                )}
                style={{ width: `${row.value > 0 ? Math.max((row.value / max) * 100, 2) : 0}%` }}
              />
              {threshold && (
                <div
                  className={cn('absolute inset-y-0 w-0.5', threshold.tone === 'danger' ? 'bg-red-600' : 'bg-amber-600')}
                  style={{ left: `${Math.min((threshold.value / max) * 100, 100)}%` }}
                  title={threshold.label}
                />
              )}
            </div>
            <span className="tabular w-14 shrink-0 text-right font-semibold text-slate-800 dark:text-slate-100">
              {valueLabel(row.value)}
            </span>
          </div>
        )
      })}
      {threshold && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Line: {threshold.label} ({valueLabel(threshold.value)})
        </p>
      )}
    </div>
  )
}

/**
 * Revenue as bars with profit margin % overlaid as a connected line of dots,
 * one chart in place of two separate views (a revenue-only donut plus a
 * profit table elsewhere on the page) that could otherwise show a network or
 * category as revenue-dominant and barely profitable with nothing making
 * that contradiction visible. Bar centres and dot x-positions are both
 * `(index + 0.5) / count`, the same fraction, computed the same way, so an
 * HTML bar row and an SVG-positioned line always land in registration
 * without hand-tuned offsets.
 *
 * `onSelect`, when given, turns each bar into a real button (not just a
 * decorative shape under `aria-hidden`) so the whole thing stays keyboard-
 * and screen-reader-usable once clicking a bar actually does something, e.g.
 * drilling from a network into its own top products. `selected` highlights
 * whichever bar's drill-down is currently open; toggling it off (clicking the
 * same bar again) is the caller's job, this just reports which label was
 * clicked.
 */
export function RevenueMarginChart({
  rows,
  height = 200,
  onSelect,
  selected,
}: {
  rows: { label: string; revenue: number; marginPct: number }[]
  height?: number
  onSelect?: (label: string) => void
  selected?: string | null
}) {
  const barsHeight = height - 24
  const maxRevenue = Math.max(...rows.map((r) => r.revenue), 1)
  const revenueAxisMax = niceCeiling(maxRevenue)
  const marginValues = rows.map((r) => r.marginPct)
  const marginAxisMax = niceCeiling(Math.max(...marginValues, 0, 20))
  const marginAxisMin = Math.min(...marginValues, 0) < 0 ? -niceCeiling(-Math.min(...marginValues, 0)) : 0
  const marginSpan = marginAxisMax - marginAxisMin || 1

  const dotX = (index: number) => ((index + 0.5) / rows.length) * 100
  const dotY = (marginPct: number) => 10 + ((marginAxisMax - marginPct) / marginSpan) * (barsHeight - 20)
  const linePath = rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${dotX(i).toFixed(2)},${dotY(r.marginPct).toFixed(2)}`).join(' ')

  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand-600/80" /> Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-accent-600" /> Profit margin %
        </span>
      </div>
      <div className="relative" style={{ height }}>
        <div className="absolute inset-x-0 top-0 flex" style={{ height: barsHeight }}>
          {rows.map((row) => {
            const isSelected = selected === row.label
            const barShape = (
              <div
                className={cn(
                  'w-3/5 max-w-10 rounded-t-md transition-colors',
                  isSelected ? 'bg-brand-800 dark:bg-brand-400' : 'bg-brand-600/80',
                )}
                style={{ height: `${Math.max((row.revenue / revenueAxisMax) * 100, 2)}%` }}
              />
            )
            return onSelect ? (
              <button
                key={row.label}
                type="button"
                onClick={() => onSelect(row.label)}
                aria-pressed={isSelected}
                aria-label={`${row.label}: ${cedisCompact(row.revenue)} revenue, ${row.marginPct.toFixed(1)}% margin, view its top products`}
                className={cn(
                  'flex h-full flex-1 flex-col items-center justify-end rounded-t-md outline-none',
                  'focus-visible:ring-2 focus-visible:ring-brand-400',
                  isSelected && 'bg-brand-50 dark:bg-brand-900/30',
                )}
              >
                <span className="tabular mb-1 text-center text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                  {cedisCompact(row.revenue)}
                </span>
                {barShape}
              </button>
            ) : (
              <div key={row.label} className="flex h-full flex-1 flex-col items-center justify-end" aria-hidden="true">
                <span className="tabular mb-1 text-center text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                  {cedisCompact(row.revenue)}
                </span>
                {barShape}
              </div>
            )
          })}
        </div>
        <svg
          aria-hidden="true"
          viewBox={`0 0 100 ${barsHeight}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-x-0 top-0 h-full w-full overflow-visible"
          style={{ height: barsHeight }}
        >
          <path
            d={linePath}
            fill="none"
            stroke="var(--color-accent-600)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {rows.map((row, i) => (
          <span
            key={row.label}
            aria-hidden="true"
            title={`${row.label}: ${row.marginPct.toFixed(1)}% margin`}
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent-600 dark:border-slate-900"
            style={{ left: `${dotX(i)}%`, top: dotY(row.marginPct) }}
          />
        ))}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 flex">
          {rows.map((row) => (
            <span key={row.label} className="min-w-0 flex-1 truncate px-0.5 text-center text-[11px] text-slate-500 dark:text-slate-400">
              {row.label}
            </span>
          ))}
        </div>
      </div>
      {onSelect && (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Click a bar to see that network's top products.</p>
      )}
      <figcaption className="sr-only">
        <table>
          <caption>Revenue and profit margin, by segment</caption>
          <thead>
            <tr>
              <th scope="col">Segment</th>
              <th scope="col">Revenue</th>
              <th scope="col">Profit margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{cedisCompact(row.revenue)}</td>
                <td>{row.marginPct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  )
}
