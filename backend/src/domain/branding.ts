/**
 * Turning one chosen colour into a usable brand ramp.
 *
 * Mirrored byte-for-byte in `frontend/src/lib/branding.ts`, the same arrangement
 * `pricing.ts` uses: the server validates and stores what it derives, and the
 * client needs the identical function to preview a colour before it is saved.
 * They must not drift.
 *
 * ── Why a ramp at all ────────────────────────────────────────────────────────
 *
 * The UI does not use one brand colour, it uses ten steps of one — 50 for tinted
 * backgrounds, 200 for borders, 700 for filled buttons and the header, 900 for
 * pressed states. Tailwind v4 compiles each of those to `var(--color-brand-N)`,
 * so overriding the variables re-themes the whole application at runtime. But
 * that only works if all ten steps exist and relate to each other sensibly.
 *
 * ── Why contrast is enforced rather than trusted ─────────────────────────────
 *
 * Step 700 carries white text on every primary button in the product. A cheerful
 * yellow at that step gives roughly 1.9:1 against white, which is illegible —
 * this is not hypothetical, it is why the platform's own Golden Yellow is
 * documented as a surface colour that must never sit behind white text.
 *
 * An agent picking their favourite colour has no way to know that, so it is not
 * left to them: the chosen hue is kept and step 700 is darkened until it clears
 * 4.5:1 against white. They get their colour, and their customers can read the
 * buttons. When darkening changes the colour noticeably, `adjusted` says so, so
 * the UI can be honest about it rather than silently overriding them.
 */

export interface BrandRamp {
  /** Every step, keyed as Tailwind names them. */
  50: string
  100: string
  200: string
  300: string
  400: string
  500: string
  600: string
  700: string
  800: string
  900: string
}

export interface DerivedBrand {
  ramp: BrandRamp
  /** The colour as asked for, normalised to #rrggbb. */
  requested: string
  /** True when 700 had to be darkened so white text on it stays readable. */
  adjusted: boolean
  /** Contrast of the final step 700 against white. Always >= 4.5. */
  contrastOnWhite: number
}

/** #abc or #aabbcc, with or without the hash. Null when it is neither. */
export function parseHex(input: string): { r: number; g: number; b: number } | null {
  const hex = input.trim().replace(/^#/, '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

export function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('')}`
}

/**
 * WCAG relative luminance. The basis of every contrast figure here.
 *
 * Not the naive average of the channels: the eye weights green far above blue,
 * and each channel is gamma-corrected first. Getting this wrong would let an
 * unreadable colour through while reporting that it passed.
 */
function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (value: number) => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Contrast ratio between a colour and white, 1 (invisible) to 21 (black). */
export function contrastWithWhite(rgb: { r: number; g: number; b: number }): number {
  return 1.05 / (luminance(rgb) + 0.05)
}

function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2

  if (max === min) return { h: 0, s: 0, l }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6

  return { h, s, l }
}

function hslToRgb({ h, s, l }: { h: number; s: number; l: number }) {
  if (s === 0) {
    const v = l * 255
    return { r: v, g: v, b: v }
  }

  const hue = (p: number, q: number, t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: hue(p, q, h + 1 / 3) * 255,
    g: hue(p, q, h) * 255,
    b: hue(p, q, h - 1 / 3) * 255,
  }
}

/**
 * Lightness for each step.
 *
 * Tuned against the platform's own Deep Blue ramp so a custom brand sits at the
 * same visual weight as the default: pale tints at the top for backgrounds, a
 * solid mid, and dark ends for text and pressed states.
 */
const LIGHTNESS: Array<[keyof BrandRamp, number]> = [
  [50, 0.96],
  [100, 0.9],
  [200, 0.79],
  [300, 0.68],
  [400, 0.57],
  [500, 0.46],
  [600, 0.36],
  [700, 0.3],
  [800, 0.24],
  [900, 0.18],
]

/** The minimum contrast white text needs against a filled button. WCAG AA. */
const MIN_CONTRAST = 4.5

/**
 * Build a full brand ramp from one colour.
 *
 * The hue and saturation are the customer's; the lightness curve is ours, and is
 * adjusted downwards where step 700 would be too pale to carry white text.
 * Because every darker step is derived from the same curve, moving 700 moves 800
 * and 900 with it, so pressed states stay darker than the resting one.
 */
export function deriveBrand(input: string): DerivedBrand | null {
  const rgb = parseHex(input)
  if (!rgb) return null

  const { h, s } = rgbToHsl(rgb)
  // A near-grey brand is legitimate, but a completely unsaturated ramp reads as
  // broken rather than deliberate, so it keeps a trace of colour.
  const saturation = Math.max(0.08, Math.min(0.95, s))

  // How far the whole curve has to be pushed down for 700 to be readable.
  let shift = 0
  for (let attempt = 0; attempt < 40; attempt++) {
    const seven = hslToRgb({ h, s: saturation, l: Math.max(0.08, 0.3 - shift) })
    if (contrastWithWhite(seven) >= MIN_CONTRAST) break
    shift += 0.01
  }

  const ramp = {} as BrandRamp
  for (const [step, lightness] of LIGHTNESS) {
    // Only the darker half moves. Shifting the pale tints too would turn a light
    // background muddy for no benefit — nothing puts white text on step 50.
    const adjusted = step >= 500 ? Math.max(0.08, lightness - shift) : lightness
    ramp[step] = toHex(hslToRgb({ h, s: saturation, l: adjusted }))
  }

  // `ramp[700]` was just written from a valid hex, so this cannot be null — but
  // asserting that with `!` would be a claim the compiler cannot check, and a
  // wrong one here would report a contrast figure of NaN as a pass.
  const seven = parseHex(ramp[700]) ?? rgb

  return {
    ramp,
    requested: toHex(rgb),
    adjusted: shift > 0.005,
    contrastOnWhite: Math.round(contrastWithWhite(seven) * 100) / 100,
  }
}
