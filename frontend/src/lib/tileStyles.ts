import type { TileButtonStyle, TileNetworkIndicator, TileStyle } from './api'

/**
 * The three independent axes a catalogue tile can be customised on, applied
 * instantly (see `ShopBranding.tsx`, no review, none of the three carries
 * impersonation risk). Rendering for each lives in `Catalogue.tsx`'s
 * `ProductCard` and `components/TileStylePicker.tsx`'s preview, this file is
 * just the picker's metadata (label/description), kept separate from the
 * rendering so the two can't drift into describing different things.
 */
export const TILE_STYLES: { id: TileStyle; label: string; description: string }[] = [
  { id: 'classic', label: 'Classic', description: 'A clean card with a divider above the price.' },
  { id: 'bold', label: 'Bold', description: 'A coloured header band above the bundle.' },
  { id: 'minimal', label: 'Minimal', description: 'No shadow, no badge, just the numbers.' },
  { id: 'compact', label: 'Compact', description: 'Tighter spacing, more bundles per screen.' },
]

export const TILE_BUTTON_STYLES: { id: TileButtonStyle; label: string; description: string }[] = [
  { id: 'accent', label: 'Accent', description: 'The platform’s own Golden Yellow badge.' },
  { id: 'solid', label: 'Solid', description: 'Filled with your shop colour, white text.' },
  { id: 'outline', label: 'Outline', description: 'Bordered in your shop colour.' },
  { id: 'text', label: 'Text only', description: 'Just the word "Buy" and an arrow.' },
]

// The network's name is always shown in all three, see `TileNetworkBadge`'s
// own doc comment, dot/pulse only change how it's marked, never whether it's there.
export const TILE_NETWORK_INDICATORS: { id: TileNetworkIndicator; label: string; description: string }[] = [
  { id: 'chip', label: 'Chip', description: 'A coloured pill around the network’s name.' },
  { id: 'dot', label: 'Dot', description: 'A small coloured dot beside the name.' },
  { id: 'pulse', label: 'Pulse', description: 'The same dot, with a live pulsing ring.' },
]
