/**
 * Date-gated seasonal flourishes for the public storefront only, never a
 * theme swap: none of this touches the site's own brand colors, see
 * `SeasonalEffects` in layout.tsx. Only one shows at a time (the first
 * whose window contains today), so windows below are kept from overlapping.
 *
 * Each scene is three things layered: an `atmosphere` (the light: frost
 * creeping in from the edges, a night sky, golden-hour sun), particles with
 * their own motion (snow blown on the wind, confetti tumbling, petals
 * swaying), and for the loudest occasions, firework `bursts`. The solemn
 * ones (a memorial day, Good Friday) get light and at most a few slow
 * embers, never confetti, which would read as tone-deaf rather than festive.
 */
export type ParticleMotion = 'fall' | 'blow' | 'flutter' | 'drift' | 'twinkle' | 'rise' | 'streak'
export type ParticleShape =
  | 'dot'
  | 'confetti'
  | 'gust'
  | 'sparkle'
  | 'star'
  | 'crescent'
  | 'wheat'
  | 'leaf'
  | 'lantern'
  | 'petal'
  | 'snowflake'

export interface ParticleLayer {
  motion: ParticleMotion
  shape: ParticleShape
  /** Randomized per instance from this pool. */
  colors: string[]
  count: number
  /** Pixel size range. Each particle gets a random depth, small and slow far away, large and fast up close. */
  size: [number, number]
  /** A soft light around the shape in its own color, for anything meant to glow (a lantern, a star). */
  glow?: boolean
}

export type Atmosphere =
  | { kind: 'frost' }
  | { kind: 'night' }
  | { kind: 'golden' }
  | { kind: 'spring' }
  | { kind: 'celebration' }
  | { kind: 'tricolor'; colors: [string, string, string] }
  | { kind: 'candle'; color: string }

/**
 * The set pieces that make a scene read as a place rather than particles on
 * a page: frost growing in the window corners, a snowbank along the bottom,
 * flag bunting strung across the top, Eid lanterns hanging from strings, a
 * field of wheat. Each is a fixed, `pointer-events-none` overlay.
 */
export type Decor =
  | { kind: 'frost-corners' }
  | { kind: 'snowbank' }
  | { kind: 'mist'; color: string }
  | { kind: 'bunting'; colors: string[] }
  | { kind: 'hanging-lanterns'; colors: string[] }
  | { kind: 'field' }
  | { kind: 'light-rays'; color: string }
  | { kind: 'bokeh'; colors: string[]; count: number }

/** Trim along the header's bottom edge: string lights, or a woven kente ribbon for the civic days. */
export type Trim = { kind: 'lights'; colors: string[] } | { kind: 'kente' }

/** What bursts out on a celebration (a completed purchase) or a tap, see `momentSpec`. */
export type MomentSpec = Pick<ParticleLayer, 'shape' | 'colors' | 'size' | 'glow'>

export interface AmbienceScene {
  atmosphere?: Atmosphere
  trim?: Trim
  /** Overrides the default burst shape, see `momentSpec`. */
  moment?: MomentSpec
  /**
   * A colour grade over the page content (below the header), the single
   * biggest thing that sets a mood: a cold blue makes white feel like ice, a
   * warm amber makes it feel like late afternoon, draining saturation makes
   * a memorial day feel quiet. Kept light so prices and buttons stay
   * perfectly readable.
   */
  tint?: { color: string; blend: 'multiply' | 'saturation' | 'soft-light'; opacity: number }
  decor?: Decor[]
  /** Empty for a light-only occasion. */
  layers: ParticleLayer[]
  /** Fireworks: this many burst points, each going off on its own staggered clock. */
  bursts?: { colors: string[]; count: number }
}

export interface HolidayTheme {
  key: string
  label: string
  window: { startMonth: number; startDay: number; endMonth: number; endDay: number }
  /**
   * 'popup': a small corner card, see `HolidayPopup`, the only kind that
   * reads `emoji`/`message`/`accent`. 'ambient': a full-page scene instead,
   * see `ambience`. Every occasion below is 'ambient'; 'popup' stays
   * available for a future one that doesn't earn a full scene of its own.
   */
  kind: 'popup' | 'ambient'
  emoji?: string
  message?: string
  /** Tailwind classes for the popup card itself. */
  accent?: string
  ambience?: AmbienceScene
}

const GHANA_FLAG: [string, string, string] = ['#CE1126', '#FCD116', '#006B3F']
const PAN_AFRICAN: [string, string, string] = ['#CE1126', '#FCD116', '#078930']

export const HOLIDAYS: HolidayTheme[] = [
  // Excitement: a night lit by fireworks, party lights out of focus, confetti.
  {
    key: 'new-year',
    label: 'Happy New Year',
    window: { startMonth: 1, startDay: 1, endMonth: 1, endDay: 2 },
    kind: 'ambient',
    ambience: {
      trim: { kind: 'lights', colors: ['#f59e0b', '#ec4899', '#3b82f6', '#10b981', '#a855f7'] },
      atmosphere: { kind: 'celebration' },
      decor: [{ kind: 'bokeh', colors: ['#f59e0b', '#ec4899', '#8b5cf6', '#38bdf8'], count: 10 }],
      layers: [
        { motion: 'flutter', shape: 'confetti', colors: ['#f59e0b', '#ec4899', '#3b82f6', '#10b981', '#a855f7'], count: 34, size: [8, 15] },
        { motion: 'twinkle', shape: 'sparkle', colors: ['#fbbf24', '#fde68a'], count: 10, size: [10, 22], glow: true },
      ],
      bursts: { colors: ['#f59e0b', '#ec4899', '#3b82f6', '#10b981', '#a855f7'], count: 6 },
    },
  },
  // Dignified civic pride: the flag's light, a few stars, nothing loud.
  {
    key: 'constitution-day',
    label: 'Constitution Day',
    window: { startMonth: 1, startDay: 6, endMonth: 1, endDay: 8 },
    kind: 'ambient',
    ambience: {
      trim: { kind: 'kente' },
      atmosphere: { kind: 'tricolor', colors: GHANA_FLAG },
      layers: [{ motion: 'twinkle', shape: 'star', colors: ['#FCD116'], count: 6, size: [12, 20], glow: true }],
    },
  },
  // National pride: streets strung with flag bunting, confetti, fireworks.
  {
    key: 'independence-day',
    label: 'Happy Independence Day',
    window: { startMonth: 3, startDay: 5, endMonth: 3, endDay: 7 },
    kind: 'ambient',
    ambience: {
      trim: { kind: 'kente' },
      atmosphere: { kind: 'tricolor', colors: GHANA_FLAG },
      decor: [{ kind: 'bunting', colors: GHANA_FLAG }],
      layers: [
        { motion: 'flutter', shape: 'confetti', colors: GHANA_FLAG, count: 32, size: [8, 16] },
        { motion: 'twinkle', shape: 'star', colors: ['#111827', '#FCD116'], count: 6, size: [14, 26], glow: true },
      ],
      bursts: { colors: GHANA_FLAG, count: 4 },
    },
  },
  // Serene, spiritual night: a deep sky full of stars, lanterns hanging and glowing.
  {
    key: 'eid-al-fitr',
    label: 'Eid Mubarak',
    window: { startMonth: 3, startDay: 19, endMonth: 3, endDay: 21 },
    kind: 'ambient',
    ambience: {
      trim: { kind: 'lights', colors: ['#fbbf24', '#fde68a', '#f59e0b'] },
      moment: { shape: 'lantern', colors: ['#f59e0b', '#fb923c', '#14b8a6', '#fbbf24'], size: [16, 26], glow: true },
      atmosphere: { kind: 'night' },
      tint: { color: '#e0e7ff', blend: 'multiply', opacity: 0.45 },
      decor: [{ kind: 'hanging-lanterns', colors: ['#f59e0b', '#fb923c', '#14b8a6', '#fbbf24'] }],
      layers: [
        { motion: 'twinkle', shape: 'dot', colors: ['#fef3c7', '#ffffff', '#c7d2fe'], count: 40, size: [1.5, 3], glow: true },
        { motion: 'twinkle', shape: 'sparkle', colors: ['#fde68a', '#fef3c7'], count: 10, size: [10, 18], glow: true },
        { motion: 'twinkle', shape: 'crescent', colors: ['#fbbf24'], count: 1, size: [44, 56], glow: true },
      ],
    },
  },
  // Solemn: colour drained, one shaft of light from above, stillness.
  {
    key: 'good-friday',
    label: 'Good Friday',
    window: { startMonth: 4, startDay: 2, endMonth: 4, endDay: 4 },
    kind: 'ambient',
    ambience: {
      atmosphere: { kind: 'candle', color: '#7c3aed' },
      tint: { color: '#808080', blend: 'saturation', opacity: 0.4 },
      decor: [{ kind: 'light-rays', color: '#ede9fe' }],
      layers: [],
    },
  },
  // Joy and renewal: soft morning light, pastel bokeh, petals on a breeze.
  {
    key: 'easter-monday',
    label: 'Happy Easter',
    window: { startMonth: 4, startDay: 5, endMonth: 4, endDay: 6 },
    kind: 'ambient',
    ambience: {
      trim: { kind: 'lights', colors: ['#f9a8d4', '#c4b5fd', '#86efac', '#fde68a'] },
      atmosphere: { kind: 'spring' },
      decor: [
        { kind: 'light-rays', color: '#fef9c3' },
        { kind: 'bokeh', colors: ['#f9a8d4', '#c4b5fd', '#86efac', '#fde68a'], count: 8 },
      ],
      layers: [
        { motion: 'drift', shape: 'petal', colors: ['#f9a8d4', '#fbcfe8', '#c4b5fd', '#fde68a'], count: 24, size: [9, 18] },
        { motion: 'twinkle', shape: 'sparkle', colors: ['#fde68a'], count: 6, size: [8, 14], glow: true },
      ],
    },
  },
  // Warmth of honest work: a warm afternoon light over everything.
  {
    key: 'labour-day',
    label: 'Labour Day',
    window: { startMonth: 4, startDay: 30, endMonth: 5, endDay: 1 },
    kind: 'ambient',
    ambience: {
      atmosphere: { kind: 'golden' },
      tint: { color: '#fef3c7', blend: 'multiply', opacity: 0.4 },
      layers: [],
    },
  },
  // Unity: pan-African colours strung across the top, stars.
  {
    key: 'africa-union-day',
    label: 'Africa Union Day',
    window: { startMonth: 5, startDay: 24, endMonth: 5, endDay: 25 },
    kind: 'ambient',
    ambience: {
      trim: { kind: 'kente' },
      atmosphere: { kind: 'tricolor', colors: PAN_AFRICAN },
      decor: [{ kind: 'bunting', colors: PAN_AFRICAN }],
      layers: [{ motion: 'twinkle', shape: 'star', colors: PAN_AFRICAN, count: 9, size: [10, 20], glow: true }],
    },
  },
  {
    key: 'eid-al-adha',
    label: 'Eid Mubarak',
    window: { startMonth: 5, startDay: 26, endMonth: 5, endDay: 28 },
    kind: 'ambient',
    ambience: {
      trim: { kind: 'lights', colors: ['#fbbf24', '#fde68a', '#ea580c'] },
      moment: { shape: 'lantern', colors: ['#ea580c', '#f59e0b', '#b45309', '#fbbf24'], size: [16, 26], glow: true },
      atmosphere: { kind: 'night' },
      tint: { color: '#fef3c7', blend: 'multiply', opacity: 0.35 },
      decor: [{ kind: 'hanging-lanterns', colors: ['#ea580c', '#f59e0b', '#b45309', '#fbbf24'] }],
      layers: [
        { motion: 'twinkle', shape: 'dot', colors: ['#fef3c7', '#ffffff', '#fde68a'], count: 40, size: [1.5, 3], glow: true },
        { motion: 'twinkle', shape: 'sparkle', colors: ['#fbbf24', '#fde68a'], count: 10, size: [10, 18], glow: true },
        { motion: 'twinkle', shape: 'crescent', colors: ['#f59e0b'], count: 1, size: [44, 56], glow: true },
      ],
    },
  },
  {
    key: 'republic-day',
    label: 'Happy Republic Day',
    window: { startMonth: 6, startDay: 30, endMonth: 7, endDay: 1 },
    kind: 'ambient',
    ambience: {
      trim: { kind: 'kente' },
      atmosphere: { kind: 'tricolor', colors: GHANA_FLAG },
      decor: [{ kind: 'bunting', colors: GHANA_FLAG }],
      layers: [
        { motion: 'flutter', shape: 'confetti', colors: GHANA_FLAG, count: 20, size: [8, 14] },
        { motion: 'twinkle', shape: 'star', colors: ['#FCD116'], count: 4, size: [12, 20], glow: true },
      ],
    },
  },
  // Reverence and pride: warm gold light, stars.
  {
    key: 'founders-day',
    label: "Founders' Day",
    window: { startMonth: 8, startDay: 3, endMonth: 8, endDay: 5 },
    kind: 'ambient',
    ambience: {
      trim: { kind: 'kente' },
      atmosphere: { kind: 'candle', color: '#f59e0b' },
      tint: { color: '#fef3c7', blend: 'multiply', opacity: 0.3 },
      layers: [{ motion: 'twinkle', shape: 'star', colors: ['#FCD116'], count: 7, size: [10, 18], glow: true }],
    },
  },
  // Remembrance: colour quietened, a candle's light, a few embers rising.
  {
    key: 'nkrumah-memorial-day',
    label: 'Kwame Nkrumah Memorial Day',
    window: { startMonth: 9, startDay: 20, endMonth: 9, endDay: 22 },
    kind: 'ambient',
    ambience: {
      atmosphere: { kind: 'candle', color: '#f59e0b' },
      tint: { color: '#808080', blend: 'saturation', opacity: 0.3 },
      layers: [{ motion: 'rise', shape: 'dot', colors: ['#fbbf24', '#fde68a'], count: 10, size: [2, 4], glow: true }],
    },
  },
  // Warm, earthy abundance: golden sun, a wheat field along the bottom, chaff on the breeze.
  {
    key: 'farmers-day',
    label: "Happy Farmers' Day",
    window: { startMonth: 12, startDay: 1, endMonth: 12, endDay: 7 },
    kind: 'ambient',
    ambience: {
      atmosphere: { kind: 'golden' },
      tint: { color: '#fef3c7', blend: 'multiply', opacity: 0.5 },
      decor: [{ kind: 'field' }],
      layers: [
        { motion: 'drift', shape: 'wheat', colors: ['#ca8a04', '#a16207', '#d97706'], count: 10, size: [16, 28] },
        { motion: 'drift', shape: 'leaf', colors: ['#65a30d', '#4d7c0f', '#84cc16'], count: 8, size: [12, 22] },
        { motion: 'blow', shape: 'dot', colors: ['#fde68a', '#fbbf24'], count: 18, size: [1.5, 3], glow: true },
      ],
    },
  },
  // Cold: an icy blue grade, frost grown into the window corners, fog
  // drifting low, snow carried on the wind and settled in a bank at the bottom.
  {
    key: 'christmas',
    label: 'Merry Christmas',
    window: { startMonth: 12, startDay: 15, endMonth: 12, endDay: 28 },
    kind: 'ambient',
    ambience: {
      trim: { kind: 'lights', colors: ['#ef4444', '#22c55e', '#fbbf24', '#3b82f6'] },
      atmosphere: { kind: 'frost' },
      tint: { color: '#dbeafe', blend: 'multiply', opacity: 0.55 },
      decor: [{ kind: 'frost-corners' }, { kind: 'mist', color: '#e0f2fe' }, { kind: 'snowbank' }],
      layers: [
        { motion: 'blow', shape: 'snowflake', colors: ['#bae6fd', '#e0f2fe', '#7dd3fc', '#ffffff'], count: 30, size: [8, 26] },
        { motion: 'blow', shape: 'dot', colors: ['#e0f2fe', '#ffffff'], count: 28, size: [2, 5], glow: true },
        { motion: 'streak', shape: 'gust', colors: ['#e0f2fe'], count: 6, size: [140, 280] },
      ],
    },
  },
]

/**
 * The shape a scene bursts into on a celebration or a tap: its own explicit
 * `moment`, else its first layer with a real shape (a background star dot or
 * a wind streak would be a weak burst). Null for the light-only and
 * solemn occasions, nothing should pop on a memorial day.
 */
export function momentSpec(scene: AmbienceScene | undefined): MomentSpec | null {
  if (!scene) return null
  if (scene.moment) return scene.moment
  return scene.layers.find((l) => l.shape !== 'dot' && l.shape !== 'gust') ?? null
}

function inWindow(month: number, day: number, w: HolidayTheme['window']): boolean {
  const date = month * 100 + day
  return date >= w.startMonth * 100 + w.startDay && date <= w.endMonth * 100 + w.endDay
}

/**
 * `previewKey` lets anyone check a season's look before (or after) its own
 * window without changing the system clock, a real link worth keeping
 * around (`?preview=christmas`), not just a throwaway dev hack.
 */
export function activeHoliday(now: Date, previewKey?: string | null): HolidayTheme | null {
  if (previewKey) return HOLIDAYS.find((h) => h.key === previewKey) ?? null
  const month = now.getMonth() + 1
  const day = now.getDate()
  return HOLIDAYS.find((h) => inWindow(month, day, h.window)) ?? null
}
