import { useId, type ReactNode, type SVGProps } from 'react'
import type { ParticleShape } from '../lib/holidays'

/**
 * Small, flat, single-color shapes for `SeasonalAmbience` (layout.tsx), used
 * in place of emoji: a glyph renders differently per OS/font and most
 * platforms draw them as small, busy, multi-color pictures that read as
 * clutter at the tiny sizes a drifting particle needs. These are plain
 * `currentColor` shapes instead, so a particle's own randomized color (see
 * `AmbienceParticle`) tints the whole shape cleanly, same as every other
 * icon in `icons.tsx`.
 */
type IconProps = SVGProps<SVGSVGElement>

/**
 * A proper six-armed ice crystal, the real shape a snowflake actually grows
 * in (and the look "Frozen" built its whole snowflake motif on), not a
 * plain dot. One arm is drawn once and mirrored around the center six times
 * at 60° apart, so the symmetry is exact rather than hand-guessed.
 *
 * `useId()` gives the `<defs>` arm a name unique to *this* rendered
 * snowflake: with dozens on screen at once, a literal string id would
 * collide (every `<use>` in the document resolves to the first matching id,
 * not its own nearest one).
 */
export const SnowflakeIcon = (p: IconProps) => {
  const armId = useId()
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" aria-hidden="true" {...p}>
      <defs>
        <g id={armId}>
          <path d="M12 12V2" />
          <path d="M12 7.3 8.1 4.8M12 7.3l3.9-2.5" />
          <path d="M12 4 10.1 2.5M12 4l1.9-1.5" />
          <path d="M12 2 11 .6h2Z" fill="currentColor" stroke="none" />
        </g>
      </defs>
      <use href={`#${armId}`} />
      <use href={`#${armId}`} transform="rotate(60 12 12)" />
      <use href={`#${armId}`} transform="rotate(120 12 12)" />
      <use href={`#${armId}`} transform="rotate(180 12 12)" />
      <use href={`#${armId}`} transform="rotate(240 12 12)" />
      <use href={`#${armId}`} transform="rotate(300 12 12)" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** A four-point sparkle with a smaller companion star, for a twinkle. */
export const SparkleIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M11 1c0 4-1.1 7-3.2 9.1S3 13 1 13c2.2 0 4.6.8 6.6 2.8S11 20 11 23c0-3.2 1-5.8 3-7.7S18.6 13 21 13c-2.2 0-4.5-.8-6.4-2.6S11 5.2 11 1Z" />
    <path d="M19 1.5c0 1.8-.5 3-1.4 3.9S15.7 6.5 14.5 6.5c1.2 0 2.3.4 3.1 1.2s1.4 2.1 1.4 3.8c0-1.6.5-2.9 1.3-3.7s2-1.3 3.2-1.3c-1.2 0-2.3-.4-3.1-1.2S19 3.2 19 1.5Z" opacity="0.75" />
  </svg>
)

/** A five-point star, the Black Star at the center of Ghana's flag (civic days). */
export const StarIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12 1.5l3.09 7.02 7.66.7-5.8 5.06 1.73 7.5L12 17.86l-6.68 3.92 1.73-7.5-5.8-5.06 7.66-.7Z" />
  </svg>
)

/** A plain crescent moon (Eid). */
export const CrescentIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M20.35 15.35A9 9 0 0 1 8.65 3.65 9 9 0 1 0 20.35 15.35Z" />
  </svg>
)

/** A wheat stalk, paired kernels tapering to a point, as a filled silhouette (Farmers' Day). */
export const WheatIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M11.3 23V11.8h1.4V23z" />
    {[0, 1, 2, 3, 4].map((row) => {
      const y = 11.5 - row * 2.15
      const scale = 1 - row * 0.1
      return (
        <g key={row}>
          <ellipse cx={11.1 - row * 0.15} cy={y} rx={2.1 * scale} ry={1.05 * scale} transform={`rotate(-28 ${11.1 - row * 0.15} ${y})`} />
          <ellipse cx={12.9 + row * 0.15} cy={y} rx={2.1 * scale} ry={1.05 * scale} transform={`rotate(28 ${12.9 + row * 0.15} ${y})`} />
        </g>
      )
    })}
    <path d="M12 2.2c.9.9 1.1 2 .5 3.1-.9-.2-1.6-.9-1.8-2Z" />
  </svg>
)

/** A single leaf with its center vein cut through it (Farmers' Day). */
export const LeafIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path fill="currentColor" d="M4 20C4 10 10 3.5 21 3c-.4 11-7 17-17 17Z" />
    <path d="M4.5 19.5 16 8" fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeWidth={1.1} strokeLinecap="round" />
  </svg>
)

/** An Eid fanous, a faceted lantern body under a domed top (rising motion). */
export const LanternIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
    <path d="M12 1v2.3" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
    <path d="M9 3.3h6l1.6 2.4H7.4Z" fill="currentColor" />
    <path d="M7.8 6.4h8.4l1 3.4c.5 1.7.5 3.5 0 5.2l-1 3.4H7.8l-1-3.4a9 9 0 0 1 0-5.2Z" fill="currentColor" />
    <path d="M9.6 8.4c-.6 2.4-.6 4.8 0 7.2M14.4 8.4c.6 2.4.6 4.8 0 7.2" stroke="#fff7d6" strokeOpacity="0.55" strokeWidth={0.9} strokeLinecap="round" />
    <path d="M10.3 18.4h3.4l-.9 2.4h-1.6Z" fill="currentColor" />
  </svg>
)

/** A single teardrop petal, pointed at the base (Easter). */
export const PetalIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12 23c-4-3.4-6.5-8-6.5-12A6.5 6.5 0 0 1 12 1a6.5 6.5 0 0 1 6.5 10c0 4-2.5 8.6-6.5 12Z" />
  </svg>
)

/** Shapes drawn as icons; `dot`, `confetti` and `gust` are plain CSS spans instead, a circle or a rectangle needs no SVG. */
export const SHAPE_ICONS: Partial<Record<ParticleShape, (p: IconProps) => ReactNode>> = {
  sparkle: SparkleIcon,
  star: StarIcon,
  crescent: CrescentIcon,
  wheat: WheatIcon,
  leaf: LeafIcon,
  lantern: LanternIcon,
  petal: PetalIcon,
  snowflake: SnowflakeIcon,
}
