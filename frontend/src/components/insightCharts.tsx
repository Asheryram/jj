import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from './ui'

/**
 * Charts for the Analytics page.
 *
 * Hand-built SVG like the rest of the app (no chart library), but measured to
 * the real container width so text and lines stay crisp instead of being
 * stretched from a fixed viewBox. Every chart can be hovered or touched for
 * exact figures, and every one also states its key numbers in text, so
 * nothing depends on colour alone.
 */

/** Distinguishable in light and dark mode, and for the common colour-vision deficiencies. */
export const PALETTE = {
  brand: '#2d5bbb',
  brandSoft: '#84a5e5',
  profit: '#059669',
  loss: '#e11d48',
  amber: '#d97706',
  sky: '#0284c7',
  violet: '#7c3aed',
  slate: '#94a3b8',
}

/** One colour per provider, used everywhere a provider appears. */
export const PROVIDER_COLOURS: Record<string, string> = {
  'datahub-gh': '#2d5bbb',
  gmpl: '#d97706',
}

export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/** 1/2/2.5/5 x a power of ten, so axis labels read 500 or 250, never 287. */
function niceStep(range: number, ticks: number): number {
  const raw = range / Math.max(1, ticks)
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1))
  const f = raw / magnitude
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * magnitude
}

function axis(min: number, max: number, ticks = 4): { lo: number; hi: number; values: number[] } {
  const lo0 = Math.min(0, min)
  const hi0 = Math.max(0, max)
  if (hi0 === lo0) return { lo: 0, hi: 1, values: [0, 1] }
  const step = niceStep(hi0 - lo0, ticks)
  const lo = Math.floor(lo0 / step) * step
  const hi = Math.ceil(hi0 / step) * step
  const values: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) values.push(Math.round(v * 1e6) / 1e6)
  return { lo, hi, values }
}

/** Label every Nth point once they would crowd. */
function labelEvery(count: number, width: number): number {
  const fit = Math.max(2, Math.floor(width / 64))
  return Math.max(1, Math.ceil(count / fit))
}

/** Whether point `i` gets an x-axis label: every Nth, plus the last, never two touching. */
function showLabel(i: number, count: number, every: number): boolean {
  const last = count - 1
  if (i === last) return true
  return i % every === 0 && last - i >= Math.ceil(every * 0.6)
}

/** Left padding that fits the widest y-axis label instead of clipping it. */
function leftPad(labels: string[]): number {
  return Math.max(28, Math.max(...labels.map((l) => l.length)) * 5.6 + 12)
}

// ─── Tooltip ────────────────────────────────────────────────────────────────

function Tooltip({ x, width, title, rows }: { x: number; width: number; title: string; rows: { label: string; value: string; colour?: string }[] }) {
  const left = Math.min(Math.max(x, 80), Math.max(80, width - 80))
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 w-max min-w-36 max-w-56 -translate-x-1/2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
      style={{ left }}
    >
      <p className="mb-1 font-semibold text-slate-900 dark:text-slate-50">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-3 text-slate-600 dark:text-slate-300">
          <span className="flex items-center gap-1.5">
            {r.colour && <span className="size-2 rounded-full" style={{ background: r.colour }} />}
            {r.label}
          </span>
          <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">{r.value}</span>
        </p>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; colour: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span
            className="h-0.5 w-4 rounded-full"
            style={i.dashed ? { backgroundImage: `linear-gradient(90deg, ${i.colour} 50%, transparent 50%)`, backgroundSize: '6px 2px' } : { background: i.colour }}
          />
          {i.label}
        </span>
      ))}
    </div>
  )
}

// ─── Trend: lines and areas over time ──────────────────────────────────────

export interface TrendSeries {
  label: string
  colour: string
  values: (number | null)[]
  area?: boolean
  dashed?: boolean
}

export function TrendChart({
  labels,
  series,
  format,
  axisFormat = format,
  height = 220,
  emptyText = 'Nothing in this period yet.',
}: {
  labels: string[]
  series: TrendSeries[]
  format: (value: number) => string
  /** Shorter wording for the y axis, e.g. no decimals. Defaults to `format`. */
  axisFormat?: (value: number) => string
  height?: number
  emptyText?: string
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const values = series.flatMap((s) => s.values.filter((v): v is number => v !== null))
  const { lo, hi, values: ticks } = axis(values.length ? Math.min(...values) : 0, values.length ? Math.max(...values) : 1)
  const padL = leftPad(ticks.map(axisFormat))
  const padR = 8
  const padT = 10
  const padB = 24
  const innerW = Math.max(1, width - padL - padR)
  const innerH = height - padT - padB
  const x = (i: number) => padL + (labels.length > 1 ? (i / (labels.length - 1)) * innerW : innerW / 2)
  const y = (v: number) => padT + innerH - ((v - lo) / (hi - lo)) * innerH
  const every = labelEvery(labels.length, innerW)

  const paths = series.map((s) => {
    let line = ''
    let area = ''
    let segmentStart: number | null = null
    s.values.forEach((v, i) => {
      if (v === null) {
        if (segmentStart !== null && s.area) area += ` L${x(i - 1)},${y(Math.max(lo, 0))} L${x(segmentStart)},${y(Math.max(lo, 0))} Z`
        segmentStart = null
        return
      }
      const cmd = segmentStart === null ? 'M' : 'L'
      if (segmentStart === null) segmentStart = i
      line += `${cmd}${x(i)},${y(v)} `
      area += `${cmd}${x(i)},${y(v)} `
    })
    if (segmentStart !== null && s.area) {
      area += ` L${x(s.values.length - 1)},${y(Math.max(lo, 0))} L${x(segmentStart)},${y(Math.max(lo, 0))} Z`
    }
    return { line, area }
  })

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - rect.left
    const i = labels.length > 1 ? Math.round(((px - padL) / innerW) * (labels.length - 1)) : 0
    setHover(Math.min(labels.length - 1, Math.max(0, i)))
  }

  if (values.length === 0) {
    return (
      <div ref={ref} className="flex items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500 dark:bg-slate-800/40 dark:text-slate-400" style={{ height }}>
        {emptyText}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} className="block touch-pan-y" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.label).join(', ')}>
          <g className="text-slate-200 dark:text-slate-800">
            {ticks.map((t) => (
              <line key={t} x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="currentColor" strokeDasharray={t === 0 ? undefined : '3 4'} />
            ))}
          </g>
          <g className="fill-slate-400 text-[10px] dark:fill-slate-500">
            {ticks.map((t) => (
              <text key={t} x={padL - 8} y={y(t) + 3} textAnchor="end">{axisFormat(t)}</text>
            ))}
            {labels.map((l, i) =>
              showLabel(i, labels.length, every) ? (
                <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>{l}</text>
              ) : null,
            )}
          </g>
          {paths.map((p, i) =>
            series[i].area ? <path key={`a${i}`} d={p.area} fill={series[i].colour} opacity={0.12} /> : null,
          )}
          {paths.map((p, i) => (
            <path key={`l${i}`} d={p.line} fill="none" stroke={series[i].colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={series[i].dashed ? '5 4' : undefined} />
          ))}
          {labels.length <= 31 &&
            series.map((s, si) =>
              s.dashed
                ? null
                : s.values.map((v, i) => (v === null ? null : <circle key={`${si}-${i}`} cx={x(i)} cy={y(v)} r={2.5} fill={s.colour} />)),
            )}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} className="stroke-slate-300 dark:stroke-slate-600" />
              {series.map((s, i) => {
                const v = s.values[hover]
                return v === null ? null : <circle key={i} cx={x(hover)} cy={y(v)} r={4.5} fill={s.colour} className="stroke-white dark:stroke-slate-900" strokeWidth={2} />
              })}
            </g>
          )}
        </svg>
      )}
      {hover !== null && (
        <Tooltip
          x={x(hover)}
          width={width}
          title={labels[hover]}
          rows={series.map((s) => ({ label: s.label, value: s.values[hover] === null ? 'none' : format(s.values[hover] as number), colour: s.colour }))}
        />
      )}
    </div>
  )
}

// ─── Stacked columns, with an optional line on top ─────────────────────────

export function StackedColumns({
  labels,
  stacks,
  line,
  format,
  axisFormat = format,
  height = 240,
}: {
  labels: string[]
  stacks: { label: string; colour: string; values: number[] }[]
  line?: { label: string; colour: string; values: number[] }
  format: (value: number) => string
  axisFormat?: (value: number) => string
  height?: number
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const totals = labels.map((_, i) => stacks.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0))
  const lineValues = line?.values ?? []
  const { lo, hi, values: ticks } = axis(Math.min(0, ...lineValues), Math.max(1, ...totals, ...lineValues))
  const padL = leftPad(ticks.map(axisFormat))
  const padR = 8
  const padT = 10
  const padB = 24
  const innerW = Math.max(1, width - padL - padR)
  const innerH = height - padT - padB
  const slot = innerW / Math.max(1, labels.length)
  const barW = Math.max(2, Math.min(28, slot * 0.68))
  const cx = (i: number) => padL + slot * i + slot / 2
  const y = (v: number) => padT + innerH - ((v - lo) / (hi - lo)) * innerH
  const every = labelEvery(labels.length, innerW)

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const i = Math.floor((event.clientX - rect.left - padL) / slot)
    setHover(i >= 0 && i < labels.length ? i : null)
  }

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} className="block touch-pan-y" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={stacks.map((s) => s.label).join(', ')}>
          <g className="text-slate-200 dark:text-slate-800">
            {ticks.map((t) => (
              <line key={t} x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="currentColor" strokeDasharray={t === 0 ? undefined : '3 4'} />
            ))}
          </g>
          <g className="fill-slate-400 text-[10px] dark:fill-slate-500">
            {ticks.map((t) => (
              <text key={t} x={padL - 8} y={y(t) + 3} textAnchor="end">{axisFormat(t)}</text>
            ))}
            {labels.map((l, i) =>
              showLabel(i, labels.length, every) ? (
                <text key={i} x={cx(i)} y={height - 6} textAnchor="middle">{l}</text>
              ) : null,
            )}
          </g>
          {hover !== null && <rect x={padL + slot * hover} y={padT} width={slot} height={innerH} className="fill-slate-100 dark:fill-slate-800/60" />}
          {labels.map((_, i) => {
            let base = 0
            return (
              <g key={i}>
                {stacks.map((s) => {
                  const v = Math.max(0, s.values[i] ?? 0)
                  if (v === 0) return null
                  const top = y(base + v)
                  const h = y(base) - top
                  base += v
                  return <rect key={s.label} x={cx(i) - barW / 2} y={top} width={barW} height={Math.max(0.5, h)} fill={s.colour} rx={Math.min(3, barW / 4)} />
                })}
              </g>
            )
          })}
          {line && (
            <>
              <path
                d={line.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${cx(i)},${y(v)}`).join(' ')}
                fill="none"
                stroke={line.colour}
                strokeWidth={2.25}
                strokeLinejoin="round"
              />
              {line.values.map((v, i) => (
                <circle key={i} cx={cx(i)} cy={y(v)} r={labels.length <= 31 ? 3 : 0} fill={line.colour} className="stroke-white dark:stroke-slate-900" strokeWidth={1.5} />
              ))}
            </>
          )}
        </svg>
      )}
      {hover !== null && (
        <Tooltip
          x={cx(hover)}
          width={width}
          title={labels[hover]}
          rows={[
            ...stacks.map((s) => ({ label: s.label, value: format(s.values[hover] ?? 0), colour: s.colour })),
            ...(line ? [{ label: line.label, value: format(line.values[hover] ?? 0), colour: line.colour }] : []),
          ]}
        />
      )}
    </div>
  )
}

// ─── Waterfall: where each cedi of sales goes ──────────────────────────────

export function Waterfall({ steps, format }: { steps: { label: string; value: number; total?: boolean }[]; format: (v: number) => string }) {
  const start = steps[0]?.value ?? 0
  const scale = Math.max(1, ...steps.map((s) => Math.abs(s.value)), start)
  let running = 0
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const from = s.total ? 0 : running
        const to = s.total ? s.value : running + s.value
        if (!s.total || i === 0) running = to
        const left = (Math.min(from, to) / scale) * 100
        const w = (Math.abs(to - from) / scale) * 100
        const share = start > 0 && i > 0 ? Math.abs(s.value) / start : null
        const colour = s.total ? (s.value >= 0 ? (i === 0 ? PALETTE.brand : PALETTE.profit) : PALETTE.loss) : PALETTE.slate
        return (
          <div key={s.label} className="grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-2 text-sm sm:grid-cols-[9rem_1fr_7rem]">
            <span className={cn('truncate', s.total ? 'font-semibold text-slate-900 dark:text-slate-50' : 'text-slate-600 dark:text-slate-300')}>{s.label}</span>
            <div className="relative h-6 rounded-md bg-slate-100 dark:bg-slate-800/60">
              <div className="absolute inset-y-0 rounded-md" style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(0.6, w)}%`, background: colour }} />
            </div>
            <span className="text-right tabular-nums">
              <span className={cn('font-semibold', s.total ? 'text-slate-900 dark:text-slate-50' : 'text-slate-700 dark:text-slate-200')}>{format(s.value)}</span>
              {share !== null && <span className="ml-1 text-xs text-slate-400">{Math.round(share * 100)}%</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Heatmap: day of week x hour ───────────────────────────────────────────

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function Heatmap({ grid, unit = 'orders' }: { grid: number[][]; unit?: string }) {
  const max = Math.max(1, ...grid.flat())
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null)
  const hourLabel = (h: number) => (h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`)
  return (
    <div>
      <div className="grid grid-cols-[2.25rem_1fr] gap-x-1.5">
        <div />
        <div className="mb-1 grid grid-cols-[repeat(24,minmax(0,1fr))] text-[9px] text-slate-400">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center">{h % 6 === 0 ? hourLabel(h) : ''}</span>
          ))}
        </div>
        {grid.map((row, d) => (
          <div key={d} className="contents">
            <span className="flex items-center text-[11px] text-slate-500 dark:text-slate-400">{WEEKDAYS[d]}</span>
            <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[2px] py-[1px]">
              {row.map((v, h) => (
                <span
                  key={h}
                  onPointerEnter={() => setHover({ d, h })}
                  onPointerLeave={() => setHover(null)}
                  title={`${WEEKDAYS[d]} ${hourLabel(h)}: ${v} ${unit}`}
                  className={cn('aspect-square rounded-[3px]', v === 0 && 'bg-slate-100 dark:bg-slate-800/70')}
                  style={v > 0 ? { background: PALETTE.brand, opacity: 0.18 + 0.82 * (v / max) } : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 h-4 text-xs text-slate-500 dark:text-slate-400">
        {hover ? `${WEEKDAYS[hover.d]}, ${hourLabel(hover.h)} to ${hourLabel((hover.h + 1) % 24)}: ${grid[hover.d][hover.h]} ${unit}` : 'Darker means busier. Hover a square for the count.'}
      </p>
    </div>
  )
}

// ─── Funnel ────────────────────────────────────────────────────────────────

export function Funnel({ steps }: { steps: { label: string; value: number; note?: string }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 1)
  return (
    <div className="space-y-2.5">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null
        const kept = prev ? s.value / prev : null
        return (
          <div key={s.label}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-slate-700 dark:text-slate-200">{s.label}</span>
              <span className="tabular-nums">
                <span className="font-semibold text-slate-900 dark:text-slate-50">{s.value.toLocaleString()}</span>
                {kept !== null && <span className="ml-2 text-xs text-slate-500">{Math.round(kept * 100)}% of the step before</span>}
              </span>
            </div>
            <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800/70">
              <div className="h-3 rounded-full" style={{ width: `${(s.value / top) * 100}%`, background: i === steps.length - 1 ? PALETTE.profit : PALETTE.brand, opacity: 1 - i * 0.12 }} />
            </div>
            {s.note && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{s.note}</p>}
          </div>
        )
      })}
    </div>
  )
}

// ─── Ranked bars ───────────────────────────────────────────────────────────

export function RankBars({
  rows,
  format,
  colour = PALETTE.brand,
}: {
  rows: { label: ReactNode; key: string; value: number; detail?: ReactNode; colour?: string }[]
  format: (v: number) => string
  colour?: string
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)))
  if (rows.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">Nothing in this period.</p>
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{r.label}</span>
            <span className={cn('shrink-0 font-semibold tabular-nums', r.value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-50')}>{format(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800/70">
            <div className="h-2 rounded-full" style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: r.value < 0 ? PALETTE.loss : (r.colour ?? colour) }} />
          </div>
          {r.detail && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{r.detail}</div>}
        </li>
      ))}
    </ul>
  )
}

// ─── Change against the previous period ────────────────────────────────────

/**
 * "+12% vs previous", green when the change is good for the business. For a
 * figure where lower is better (time to deliver, failures), pass
 * `higherIsBetter={false}`. `points` compares percentages by their
 * difference ("+3.1 pts") rather than a percent of a percent.
 */
export function Delta({ value, previous, higherIsBetter = true, points = false }: { value: number; previous: number; higherIsBetter?: boolean; points?: boolean }) {
  const diff = value - previous
  if (!Number.isFinite(diff) || (previous === 0 && value === 0)) {
    return <span className="text-xs text-slate-400">no change</span>
  }
  if (!points && previous === 0) return <span className="text-xs text-slate-400">new this period</span>
  const pct = points ? diff : (diff / Math.abs(previous)) * 100
  if (Math.abs(pct) < 0.5) return <span className="text-xs text-slate-400">about the same</span>
  const good = (diff > 0) === higherIsBetter
  // Past tripling, a multiple reads better than "+15,395%".
  const times = !points && previous > 0 && value / previous >= 3 ? value / previous : null
  const text = points
    ? `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} pts`
    : times !== null
      ? `${times >= 10 ? Math.round(times).toLocaleString() : times.toFixed(1)}× before`
      : `${diff > 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%`
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums', good ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400')}>
      <svg viewBox="0 0 10 10" className={cn('size-2.5', diff < 0 && 'rotate-180')} aria-hidden="true">
        <path d="M5 1.5 9 7.5H1z" fill="currentColor" />
      </svg>
      {text}
    </span>
  )
}

/** A headline number with its change against the previous period. */
export function Kpi({
  label,
  value,
  compared,
  higherIsBetter = true,
  points = false,
  hint,
  emphasis = false,
}: {
  label: string
  value: string
  compared?: { value: number; previous: number }
  higherIsBetter?: boolean
  points?: boolean
  hint?: ReactNode
  emphasis?: boolean
}) {
  return (
    <div className={cn('rounded-2xl border p-4', emphasis ? 'border-slate-300 bg-white shadow-sm ring-1 ring-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:ring-slate-700' :'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900')}>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-slate-50">{value}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {compared && <Delta value={compared.value} previous={compared.previous} higherIsBetter={higherIsBetter} points={points} />}
        {hint && <span className="text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
      </div>
    </div>
  )
}

/** A horizontal meter, for "how many days of float are left". */
export function Meter({ value, max, tone }: { value: number; max: number; tone: 'good' | 'warn' | 'bad' }) {
  const colour = tone === 'good' ? PALETTE.profit : tone === 'warn' ? PALETTE.amber : PALETTE.loss
  return (
    <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800/70">
      <div className="h-2.5 rounded-full transition-[width]" style={{ width: `${Math.min(100, Math.max(2, (value / max) * 100))}%`, background: colour }} />
    </div>
  )
}

/** Stable label for a list of numbers, so memoised charts don't redraw for nothing. */
export function useLabels(buckets: number[], format: (bucket: number) => string): string[] {
  const key = buckets.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buckets.map(format), [key])
}
