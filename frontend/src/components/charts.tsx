import { cedisCompact } from '../lib/format'
import { cn } from './ui'

/**
 * Hand-rolled SVG charts. A charting library would be the heaviest thing on
 * the page and these dashboards need three shapes, not thirty (NFR-1.1).
 * Every chart is labelled in text as well as drawn, so it is not colour-only.
 */

export function BarChart({
  data,
  height = 160,
  valueLabel = cedisCompact,
}: {
  data: { day: string; revenue: number }[]
  height?: number
  valueLabel?: (value: number) => string
}) {
  const max = Math.max(...data.map((d) => d.revenue), 1)

  return (
    <div>
      <div className="flex items-end gap-1.5 sm:gap-3" style={{ height }}>
        {data.map((point) => {
          const pct = (point.revenue / max) * 100
          return (
            <div key={point.day} className="group flex h-full min-w-0 flex-1 flex-col justify-end">
              <span className="tabular mb-1 text-center text-[10px] font-semibold text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 sm:text-[11px]">
                {valueLabel(point.revenue)}
              </span>
              <div
                className="w-full rounded-t-md bg-brand-500 transition-colors group-hover:bg-brand-600"
                style={{ height: `${Math.max(pct, 2)}%` }}
                role="img"
                aria-label={`${point.day}: ${valueLabel(point.revenue)}`}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex gap-1.5 sm:gap-3">
        {data.map((point) => (
          <span
            key={point.day}
            className="min-w-0 flex-1 truncate text-center text-[11px] text-slate-500"
          >
            {point.day}
          </span>
        ))}
      </div>
    </div>
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
 * One colour per category (six of them), so nothing ever wraps around and
 * shows two segments in the same hue. Ordered by lightness rather than by
 * palette so neighbouring slices stay tellable apart.
 */
const DONUT_COLOURS = [
  'var(--color-brand-600)',
  'var(--color-brand-400)',
  'var(--color-sky-500)',
  'var(--color-amber-400)',
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
      <svg viewBox="0 0 100 100" className="size-32 shrink-0 -rotate-90">
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
              <span className="truncate text-slate-600">{segment.label}</span>
            </span>
            <span className="tabular shrink-0 font-semibold text-slate-800">
              {total > 0 ? Math.round((segment.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
