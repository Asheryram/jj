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
      <div aria-hidden="true" className="flex gap-2">
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
 */
export function LineChart({
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
  const width = 100
  const rawMax = Math.max(...data.map((d) => d.revenue), 0)
  const rawMin = Math.min(...data.map((d) => d.revenue), 0)
  const { axisMin, axisMax } = niceAxisBounds(rawMin, rawMax)
  const span = axisMax - axisMin
  const total = data.reduce((sum, d) => sum + d.revenue, 0)

  // 6px of headroom top and bottom so a point at the max/min isn't drawn
  // right on the edge of the viewBox, clipped by its own stroke width.
  const points = data.map((point, index) => ({
    ...point,
    x: data.length > 1 ? (index / (data.length - 1)) * width : width / 2,
    y: height - 6 - ((point.revenue - axisMin) / span) * (height - 12),
  }))
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1].x.toFixed(2)},${height} L${points[0].x.toFixed(2)},${height} Z`
      : ''

  const xLabelStep = xAxisStep(data.length)
  const showXLabel = (index: number) => xLabelStep === 1 || index % xLabelStep === 0 || index === data.length - 1

  return (
    <figure className="m-0">
      <div aria-hidden="true" className="flex gap-2">
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
