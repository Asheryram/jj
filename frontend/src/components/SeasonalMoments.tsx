import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { MomentSpec, ParticleShape, Trim } from '../lib/holidays'
import { SHAPE_ICONS } from './seasonalIcons'

/**
 * Short, one-off bursts of the current season's own shape, the interactive
 * half of the seasonal ambience (layout.tsx):
 *
 *  · a celebration when a purchase completes, see `SeasonalCelebration`
 *  · a small puff wherever a visitor taps empty space, see `SeasonalMomentHost`
 *
 * Both only ever exist while a holiday scene is actually showing (the host
 * is mounted by `SeasonalAmbience`), so on an ordinary day, or a solemn one
 * with no `momentSpec`, `celebrate()` simply goes nowhere. Every particle is
 * `pointer-events-none` and fades out within a couple of seconds, so it can
 * pass over text for a moment but never sits on it.
 */

const CELEBRATE_EVENT = 'seasonal:celebrate'

type BurstKind = 'celebration' | 'tap'

/** Ask the current scene, if any, to burst from this point on screen. */
export function celebrate(x: number, y: number) {
  window.dispatchEvent(new CustomEvent(CELEBRATE_EVENT, { detail: { x, y } }))
}

/**
 * Drop this in wherever a moment deserves celebrating (the delivered
 * screen): on mount it bursts from its own position, once.
 */
export function SeasonalCelebration() {
  const anchor = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    // One frame later, so the card it sits in has finished laying out.
    const frame = requestAnimationFrame(() => {
      const rect = anchor.current?.getBoundingClientRect()
      if (rect) celebrate(rect.left + rect.width / 2, rect.top + rect.height / 2)
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  return <span ref={anchor} aria-hidden="true" className="pointer-events-none absolute inset-0" />
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** Lanterns and stars float up and away; everything else is thrown up and falls back under gravity. */
const FLOATS: ParticleShape[] = ['lantern', 'sparkle', 'star', 'crescent']
/** Things that tumble as they fly; a lantern or crescent should stay upright. */
const SPINS: ParticleShape[] = ['confetti', 'petal', 'leaf', 'wheat', 'snowflake', 'sparkle', 'star']

interface MomentParticle {
  id: number
  x: number
  y: number
  dx: number
  dy: number
  fall: number
  spin: number
  size: number
  color: string
  durationS: number
  delayS: number
}

interface Burst {
  id: number
  particles: MomentParticle[]
}

let nextId = 0

function makeBurst(spec: MomentSpec, x: number, y: number, kind: BurstKind): Burst {
  const big = kind === 'celebration'
  const floats = FLOATS.includes(spec.shape)
  const spins = SPINS.includes(spec.shape)
  const count = big ? 42 : 9
  const particles = Array.from({ length: count }, () => {
    // A celebration fans upward out of its point, a tap goes every direction.
    const angle = ((big ? between(-165, -15) : between(0, 360)) * Math.PI) / 180
    const distance = big ? between(90, 280) : between(25, 85)
    return {
      id: nextId++,
      x,
      y,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      fall: floats ? (big ? -90 : -25) : big ? 190 : 45,
      spin: spins ? between(-540, 540) : between(-12, 12),
      size: big ? between(spec.size[0], spec.size[1] * 1.1) : between(spec.size[0] * 0.8, spec.size[1] * 0.7),
      color: spec.colors[Math.floor(Math.random() * spec.colors.length)],
      durationS: big ? between(1.6, 2.6) : between(0.9, 1.4),
      delayS: big ? between(0, 0.15) : 0,
    }
  })
  return { id: nextId++, particles }
}

const TAP_IGNORE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [data-no-sparkle]'

/**
 * Listens for `celebrate()` and for taps on non-interactive space, and plays
 * each as a burst of `spec`'s shape. Throttled and capped so a frantic
 * tapper can't pile up hundreds of particles on a modest phone.
 */
export function SeasonalMomentHost({ spec }: { spec: MomentSpec }) {
  const [bursts, setBursts] = useState<Burst[]>([])

  useEffect(() => {
    let lastTap = 0
    let live = 0

    const spawn = (x: number, y: number, kind: BurstKind) => {
      if (live >= 5) return
      const burst = makeBurst(spec, x, y, kind)
      const lifetime = Math.max(...burst.particles.map((p) => p.durationS + p.delayS)) * 1000 + 200
      live++
      setBursts((current) => [...current, burst])
      window.setTimeout(() => {
        live--
        setBursts((current) => current.filter((b) => b.id !== burst.id))
      }, lifetime)
    }

    const onCelebrate = (event: Event) => {
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail
      spawn(x, y, 'celebration')
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const target = event.target as Element | null
      if (!target || target.closest(TAP_IGNORE)) return
      const now = performance.now()
      if (now - lastTap < 250) return
      lastTap = now
      spawn(event.clientX, event.clientY, 'tap')
    }

    window.addEventListener(CELEBRATE_EVENT, onCelebrate)
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    return () => {
      window.removeEventListener(CELEBRATE_EVENT, onCelebrate)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [spec])

  if (bursts.length === 0) return null

  return createPortal(
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {bursts.flatMap((burst) =>
        burst.particles.map((p) => <MomentParticleView key={p.id} particle={p} spec={spec} />),
      )}
    </div>,
    document.body,
  )
}

function MomentParticleView({ particle: p, spec }: { particle: MomentParticle; spec: MomentSpec }) {
  const motion = {
    left: p.x,
    top: p.y,
    '--dx': `${p.dx}px`,
    '--dy': `${p.dy}px`,
    '--fall': `${p.fall}px`,
    '--spin': `${p.spin}deg`,
    animationDuration: `${p.durationS}s`,
    animationDelay: `${p.delayS}s`,
  } as CSSProperties

  if (spec.shape === 'dot') {
    return (
      <span
        className="moment-particle rounded-full"
        style={{ ...motion, width: p.size, height: p.size, background: p.color, boxShadow: `0 0 ${p.size * 2}px ${p.color}` }}
      />
    )
  }
  if (spec.shape === 'confetti') {
    return (
      <span
        className="moment-particle rounded-[1.5px]"
        style={{ ...motion, width: p.size * 0.45, height: p.size, background: `linear-gradient(135deg, ${p.color} 55%, ${p.color}b3)` }}
      />
    )
  }
  const Glyph = SHAPE_ICONS[spec.shape]
  return (
    <span
      className="moment-particle"
      style={{
        ...motion,
        width: p.size,
        height: p.size,
        color: p.color,
        filter: spec.glow ? `drop-shadow(0 0 ${Math.max(3, p.size / 3)}px ${p.color})` : undefined,
      }}
    >
      {Glyph && <Glyph width="100%" height="100%" />}
    </span>
  )
}

// ── Trim along the header's bottom edge ─────────────────────────────────────

/** Matches `HEADER_PX` in SeasonalDecor: the public shell's `h-16` sticky header. */
const HEADER_EDGE_PX = 64

interface Bulb {
  x: number
  y: number
}

const LIGHT_SEGMENTS = 12
const SEGMENT_WIDTH = 100
const BULBS_PER_SEGMENT = 3

/** A wire draped in shallow swags between hooks along a 1200-wide viewBox, bulbs hanging at even steps along each swag. */
const LIGHT_BULBS: Bulb[] = Array.from({ length: LIGHT_SEGMENTS * BULBS_PER_SEGMENT }, (_, n) => {
  const segment = Math.floor(n / BULBS_PER_SEGMENT)
  const t = ((n % BULBS_PER_SEGMENT) + 1) / (BULBS_PER_SEGMENT + 1)
  const x0 = segment * SEGMENT_WIDTH
  const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * (x0 + SEGMENT_WIDTH / 2) + t ** 2 * (x0 + SEGMENT_WIDTH)
  const y = (1 - t) ** 2 * 3 + 2 * (1 - t) * t * 15 + t ** 2 * 3
  return { x, y }
})

const LIGHT_WIRE = Array.from(
  { length: LIGHT_SEGMENTS },
  (_, s) => `M${s * SEGMENT_WIDTH} 3Q${s * SEGMENT_WIDTH + SEGMENT_WIDTH / 2} 15 ${(s + 1) * SEGMENT_WIDTH} 3`,
).join('')

export function HeaderTrim({ trim }: { trim: Trim }) {
  if (trim.kind === 'kente') {
    return (
      <div
        aria-hidden="true"
        className="decor-kente pointer-events-none fixed inset-x-0 z-[22]"
        style={{ top: HEADER_EDGE_PX }}
      />
    )
  }
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 z-[22] h-7 w-full"
      style={{ top: HEADER_EDGE_PX }}
      viewBox="0 0 1200 28"
      preserveAspectRatio="xMidYMin slice"
    >
      <path d={LIGHT_WIRE} fill="none" stroke="#44403c" strokeWidth="1.1" />
      {LIGHT_BULBS.map((b, i) => (
        <g
          key={i}
          className="decor-bulb"
          style={{
            color: trim.colors[i % trim.colors.length],
            // A chase: neighbouring bulbs light one after another.
            animationDelay: `${(i % 3) * 0.6}s`,
          }}
        >
          <rect x={b.x - 1.6} y={b.y} width="3.2" height="2.6" rx="0.6" fill="#57534e" />
          <ellipse cx={b.x} cy={b.y + 7.2} rx="3.1" ry="4.8" fill="currentColor" />
          <ellipse cx={b.x - 1} cy={b.y + 5.6} rx="0.9" ry="1.6" fill="#ffffff" opacity="0.55" />
        </g>
      ))}
    </svg>
  )
}
