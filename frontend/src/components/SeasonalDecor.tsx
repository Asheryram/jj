import { useState, type CSSProperties } from 'react'
import type { AmbienceScene, Decor } from '../lib/holidays'
import { LanternIcon, SnowflakeIcon } from './seasonalIcons'

/**
 * The set pieces that make a seasonal scene read as a place (see `Decor` in
 * holidays.ts), plus the page-wide colour grade (`SeasonalTint`). All of it
 * is fixed, `aria-hidden` and `pointer-events-none`: decoration only, it can
 * never take a tap meant for the page underneath. Motion lives in the
 * `decor-*` keyframes in index.css, so `prefers-reduced-motion` stills it.
 *
 * Anything hung from the top starts at `HEADER_PX`, just under the public
 * shell's sticky `h-16` header, so it hangs from the header's edge instead
 * of hiding behind it.
 */
const HEADER_PX = 64

function between(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

export function SeasonalTint({ tint }: { tint: NonNullable<AmbienceScene['tint']> }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[15]"
      style={{ background: tint.color, mixBlendMode: tint.blend, opacity: tint.opacity }}
    />
  )
}

export function SeasonalDecor({ decor }: { decor: Decor }) {
  switch (decor.kind) {
    case 'frost-corners':
      return <FrostCorners />
    case 'snowbank':
      return <Snowbank />
    case 'mist':
      return <Mist color={decor.color} />
    case 'bunting':
      return <Bunting colors={decor.colors} />
    case 'hanging-lanterns':
      return <HangingLanterns colors={decor.colors} />
    case 'field':
      return <WheatField />
    case 'light-rays':
      return <LightRays color={decor.color} />
    case 'bokeh':
      return <Bokeh colors={decor.colors} count={decor.count} />
  }
}

// ── Frost grown into the window corners ─────────────────────────────────────

type Corner = 'tl' | 'tr' | 'bl' | 'br'

interface Crystal {
  x: number
  y: number
  size: number
  opacity: number
  rotate: number
}

/** Dense and large right in the corner, thinning out and shrinking away from it, the way frost actually creeps across glass. */
function growCrystals(): Crystal[] {
  return Array.from({ length: 16 }, () => {
    const reach = Math.pow(Math.random(), 1.4) * 170
    const angle = between(0, Math.PI / 2)
    const closeness = 1 - reach / 170
    return {
      x: Math.cos(angle) * reach,
      y: Math.sin(angle) * reach,
      size: 10 + closeness * 34 + between(-4, 4),
      opacity: 0.25 + closeness * 0.6,
      rotate: between(0, 60),
    }
  })
}

function FrostCorners() {
  const [corners] = useState(() => ({ tl: growCrystals(), tr: growCrystals(), bl: growCrystals(), br: growCrystals() }))
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-20" style={{ top: HEADER_PX }}>
      {(Object.keys(corners) as Corner[]).map((corner) => (
        <FrostCorner key={corner} corner={corner} crystals={corners[corner]} />
      ))}
    </div>
  )
}

function FrostCorner({ corner, crystals }: { corner: Corner; crystals: Crystal[] }) {
  const top = corner[0] === 't'
  const left = corner[1] === 'l'
  const anchor: CSSProperties = {
    [top ? 'top' : 'bottom']: 0,
    [left ? 'left' : 'right']: 0,
  }
  return (
    <div
      className="decor-frost-corner absolute h-56 w-56"
      style={{
        ...anchor,
        transformOrigin: `${top ? 'top' : 'bottom'} ${left ? 'left' : 'right'}`,
        background: `radial-gradient(circle at ${left ? '0%' : '100%'} ${top ? '0%' : '100%'}, rgb(240 249 255 / 0.85), rgb(224 242 254 / 0.35) 38%, transparent 70%)`,
      }}
    >
      {crystals.map((c, i) => (
        <span
          key={i}
          className="absolute text-sky-100"
          style={{
            [top ? 'top' : 'bottom']: c.y,
            [left ? 'left' : 'right']: c.x,
            width: c.size,
            height: c.size,
            opacity: c.opacity,
            transform: `translate(${left ? '-50%' : '50%'}, ${top ? '-50%' : '50%'}) rotate(${c.rotate}deg)`,
            filter: 'drop-shadow(0 0 2px rgb(125 211 252 / 0.9))',
          }}
        >
          <SnowflakeIcon width="100%" height="100%" />
        </span>
      ))}
    </div>
  )
}

// ── Snow settled along the bottom edge ──────────────────────────────────────

function Snowbank() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[21] h-7 w-full"
      viewBox="0 0 1200 40"
      preserveAspectRatio="none"
      style={{ filter: 'drop-shadow(0 -3px 6px rgb(186 230 253 / 0.7))' }}
    >
      <defs>
        <linearGradient id="snowbank-shade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dbeafe" />
        </linearGradient>
      </defs>
      <path
        d="M0 18C80 6 150 24 240 14S400 2 480 15 640 28 720 13 880 4 960 16 1120 26 1200 12V40H0Z"
        fill="url(#snowbank-shade)"
      />
    </svg>
  )
}

// ── Low fog drifting across ─────────────────────────────────────────────────

function Mist({ color }: { color: string }) {
  const banks = [
    { bottom: '-8vh', durationS: 52, delayS: 0, width: '75vw' },
    { bottom: '6vh', durationS: 68, delayS: -20, width: '90vw' },
    { bottom: '22vh', durationS: 80, delayS: -45, width: '60vw' },
  ]
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-20 overflow-hidden">
      {banks.map((bank, i) => (
        <div
          key={i}
          className="decor-mist absolute left-0 h-[32vh]"
          style={{
            bottom: bank.bottom,
            width: bank.width,
            background: `radial-gradient(ellipse at center, color-mix(in srgb, ${color} 70%, transparent), transparent 70%)`,
            animationDuration: `${bank.durationS}s`,
            animationDelay: `${bank.delayS}s`,
          }}
        />
      ))}
    </div>
  )
}

// ── Flag bunting strung across the top ──────────────────────────────────────

interface Pennant {
  x: number
  y: number
  angle: number
  colorIndex: number
  delayS: number
}

const SWAGS = 3
const SWAG_WIDTH = 400
const PENNANTS_PER_SWAG = 9

/** Three sagging strings across a 1200-wide viewBox, pennants hung at even steps along each curve and tilted to follow it. */
const BUNTING_PENNANTS: Pennant[] = Array.from({ length: SWAGS * PENNANTS_PER_SWAG }, (_, n) => {
  const swag = Math.floor(n / PENNANTS_PER_SWAG)
  const t = ((n % PENNANTS_PER_SWAG) + 0.5) / PENNANTS_PER_SWAG
  const x0 = swag * SWAG_WIDTH
  const [p0, p1, p2] = [
    [x0, 4],
    [x0 + SWAG_WIDTH / 2, 44],
    [x0 + SWAG_WIDTH, 4],
  ]
  const x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
  const y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
  const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])
  const dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])
  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI, colorIndex: n, delayS: -((n * 0.37) % 3) }
})

function Bunting({ colors }: { colors: string[] }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 z-20 h-20 w-full"
      style={{ top: HEADER_PX }}
      viewBox="0 0 1200 80"
      preserveAspectRatio="xMidYMin slice"
    >
      {Array.from({ length: SWAGS }, (_, s) => (
        <path
          key={s}
          d={`M${s * SWAG_WIDTH} 4Q${s * SWAG_WIDTH + SWAG_WIDTH / 2} 44 ${(s + 1) * SWAG_WIDTH} 4`}
          fill="none"
          stroke="#78716c"
          strokeWidth="1.2"
        />
      ))}
      {BUNTING_PENNANTS.map((p, i) => (
        <g
          key={i}
          className="decor-pennant"
          style={{ transformOrigin: `${p.x}px ${p.y}px`, animationDelay: `${p.delayS}s` }}
        >
          <g transform={`rotate(${p.angle} ${p.x} ${p.y})`}>
            <path d={`M${p.x - 12} ${p.y}H${p.x + 12}L${p.x} ${p.y + 28}Z`} fill={colors[p.colorIndex % colors.length]} />
            <path d={`M${p.x - 12} ${p.y}H${p.x + 12}L${p.x + 12} ${p.y + 3}H${p.x - 12}Z`} fill="#000000" opacity="0.18" />
          </g>
        </g>
      ))}
    </svg>
  )
}

// ── Eid lanterns hanging from strings ───────────────────────────────────────

/** Spaced across the width, each on its own string length; the 2nd and 5th only show from `sm` up so a phone isn't crowded. */
const LANTERN_SLOTS = [
  { left: 7, drop: 70, size: 34, wide: false },
  { left: 22, drop: 130, size: 28, wide: true },
  { left: 36, drop: 45, size: 30, wide: false },
  { left: 64, drop: 100, size: 34, wide: false },
  { left: 79, drop: 55, size: 28, wide: true },
  { left: 93, drop: 140, size: 32, wide: false },
]

function HangingLanterns({ colors }: { colors: string[] }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 z-20" style={{ top: HEADER_PX }}>
      {LANTERN_SLOTS.map((slot, i) => {
        const color = colors[i % colors.length]
        return (
          <div
            key={i}
            className={`decor-lantern absolute flex flex-col items-center ${slot.wide ? 'hidden sm:flex' : ''}`}
            style={{ left: `${slot.left}%`, animationDuration: `${4 + (i % 3)}s`, animationDelay: `${-i * 0.7}s` }}
          >
            <span className="w-px" style={{ height: slot.drop, background: 'linear-gradient(#a16207, #fbbf24)' }} />
            <span className="relative" style={{ width: slot.size, height: slot.size, color }}>
              <span
                className="decor-lantern-halo absolute -inset-4 rounded-full"
                style={{ background: `radial-gradient(circle, color-mix(in srgb, ${color} 55%, transparent), transparent 70%)` }}
              />
              <LanternIcon width="100%" height="100%" className="relative" style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── A wheat field along the bottom edge ─────────────────────────────────────

interface Blade {
  x: number
  height: number
  bend: number
  width: number
  color: string
  head: boolean
}

function growField(): Blade[] {
  return Array.from({ length: 140 }, () => {
    const head = Math.random() < 0.35
    return {
      x: between(0, 1200),
      height: head ? between(42, 64) : between(18, 46),
      bend: between(-9, 9),
      width: between(1.4, 2.6),
      color: head ? pick(['#ca8a04', '#a16207', '#d97706']) : pick(['#65a30d', '#4d7c0f', '#84cc16', '#a3a33a']),
      head,
    }
  })
}

function WheatField() {
  const [blades] = useState(growField)
  const groups = [0, 1, 2].map((g) => blades.filter((_, i) => i % 3 === g))
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[21] h-[72px] w-full"
      viewBox="0 0 1200 72"
      preserveAspectRatio="xMidYMax slice"
    >
      <defs>
        <linearGradient id="field-ground" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#a16207" stopOpacity="0" />
          <stop offset="1" stopColor="#78350f" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect x="0" y="50" width="1200" height="22" fill="url(#field-ground)" />
      {groups.map((group, g) => (
        <g key={g} className="decor-field-sway" style={{ animationDelay: `${-g * 1.3}s` }}>
          {group.map((b, i) => {
            const tipX = b.x + b.bend * 1.6
            const tipY = 72 - b.height
            return (
              <g key={i}>
                <path
                  d={`M${b.x} 72Q${b.x + b.bend} ${72 - b.height / 2} ${tipX} ${tipY}`}
                  fill="none"
                  stroke={b.color}
                  strokeWidth={b.width}
                  strokeLinecap="round"
                />
                {b.head && (
                  <ellipse cx={tipX} cy={tipY - 4} rx="2.4" ry="6" fill={b.color} transform={`rotate(${b.bend * 2} ${tipX} ${tipY})`} />
                )}
              </g>
            )
          })}
        </g>
      ))}
    </svg>
  )
}

// ── Shafts of light from above ──────────────────────────────────────────────

function LightRays({ color }: { color: string }) {
  return <div aria-hidden="true" className="decor-rays pointer-events-none fixed inset-0 z-[16]" style={{ '--c1': color } as CSSProperties} />
}

// ── Out-of-focus lights ─────────────────────────────────────────────────────

function Bokeh({ colors, count }: { colors: string[]; count: number }) {
  const [orbs] = useState(() =>
    Array.from({ length: count }, () => ({
      left: between(0, 95),
      top: between(5, 90),
      size: between(50, 150),
      color: pick(colors),
      opacity: between(0.3, 0.6),
      durationS: between(10, 18),
      delayS: -between(0, 18),
    })),
  )
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[16] overflow-hidden">
      {orbs.map((o, i) => (
        <span
          key={i}
          className="decor-bokeh absolute rounded-full"
          style={{
            left: `${o.left}%`,
            top: `${o.top}%`,
            width: o.size,
            height: o.size,
            opacity: o.opacity,
            background: `radial-gradient(circle, color-mix(in srgb, ${o.color} 60%, transparent), color-mix(in srgb, ${o.color} 15%, transparent) 55%, transparent 70%)`,
            animationDuration: `${o.durationS}s`,
            animationDelay: `${o.delayS}s`,
          }}
        />
      ))}
    </div>
  )
}
