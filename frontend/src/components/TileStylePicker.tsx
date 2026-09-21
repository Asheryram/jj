import type { TileButtonStyle, TileNetworkIndicator, TileStyle } from '../lib/api'
import { TILE_BUTTON_STYLES, TILE_NETWORK_INDICATORS, TILE_STYLES } from '../lib/tileStyles'
import { NETWORK_STYLES } from '../lib/networks'
import { Badge, NetworkChip, cn } from './ui'
import { CheckIcon, ChevronRightIcon } from './icons'

/** The current combination of all three tile axes, threaded as one value everywhere below. */
export interface TileOptions {
  tileStyle: TileStyle
  tileButtonStyle: TileButtonStyle
  tileNetworkIndicator: TileNetworkIndicator
}

/**
 * The "Buy" element, in whichever of the four button styles is selected.
 * Shared between the full preview here and `Catalogue.tsx`'s `ProductCard`,
 * the two must never drift, a preview that doesn't match the real catalogue
 * defeats the point of previewing.
 */
export function TileBuyButton({ buttonStyle, small }: { buttonStyle: TileButtonStyle; small?: boolean }) {
  if (buttonStyle === 'solid') {
    return (
      <span
        className={cn(
          'tabular flex shrink-0 items-center gap-1 rounded-lg font-semibold text-white',
          small ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        )}
        style={{ backgroundColor: 'var(--color-brand-700)' }}
      >
        Buy <ChevronRightIcon className={small ? 'size-3' : 'size-3.5'} />
      </span>
    )
  }
  if (buttonStyle === 'outline') {
    return (
      <span
        className={cn(
          'flex shrink-0 items-center gap-1 rounded-lg border font-semibold',
          small ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        )}
        style={{ borderColor: 'var(--color-brand-700)', color: 'var(--color-brand-700)' }}
      >
        Buy <ChevronRightIcon className={small ? 'size-3' : 'size-3.5'} />
      </span>
    )
  }
  if (buttonStyle === 'text') {
    return (
      <span
        className={cn('flex shrink-0 items-center gap-0.5 font-semibold', small ? 'text-xs' : 'text-sm')}
        style={{ color: 'var(--color-brand-700)' }}
      >
        Buy <ChevronRightIcon className={small ? 'size-3' : 'size-3.5'} />
      </span>
    )
  }
  // accent, the platform's fixed Golden Yellow, unaffected by shop colour on purpose.
  return (
    <Badge tone="accent" className={cn('shrink-0 gap-0.5', small && 'text-[11px]')}>
      Buy <ChevronRightIcon className={small ? 'size-3' : 'size-3.5'} />
    </Badge>
  )
}

/**
 * A bundle's network, in whichever of the three indicator styles is
 * selected. The network's name is always shown, in every style, a buyer
 * choosing a bundle needs to know which network it's for regardless of how
 * the shop likes its cards to look. `dot`/`pulse` only change how that name
 * is marked, a small coloured dot (animated or not) instead of a filled
 * pill, they fall back to the full chip for "all networks" products
 * (checkers), there is no per-network colour to dot for those.
 */
export function TileNetworkBadge({
  network,
  indicator,
}: {
  network: 'MTN' | 'Telecel' | 'AirtelTigo' | null
  indicator: TileNetworkIndicator
}) {
  if ((indicator === 'dot' || indicator === 'pulse') && network) {
    const dotColor = NETWORK_STYLES[network].dot
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap text-slate-600 dark:text-slate-300">
        <span className="relative inline-flex size-2.5 shrink-0">
          {indicator === 'pulse' && (
            <span
              className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', dotColor)}
            />
          )}
          <span className={cn('relative inline-flex size-2.5 rounded-full', dotColor)} />
        </span>
        {network}
      </span>
    )
  }
  return <NetworkChip network={network} />
}

/**
 * A small, abstract stand-in for a layout, used only to tell the four
 * options apart at a glance in the layout grid. The realistic, readable
 * preview is `TileStyleFullPreview` below, shown once, for the full current
 * combination of all three axes.
 */
function TileStyleThumbnail({ style }: { style: TileStyle }) {
  if (style === 'bold') {
    return (
      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="h-4 w-full bg-brand-100 dark:bg-brand-900/40" />
        <div className="space-y-1.5 p-2">
          <div className="h-2 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="flex items-center justify-between pt-1">
            <div className="h-2 w-8 rounded bg-slate-300 dark:bg-slate-600" />
            <div className="h-3 w-8 rounded" style={{ backgroundColor: 'var(--color-brand-700)' }} />
          </div>
        </div>
      </div>
    )
  }
  if (style === 'minimal') {
    return (
      <div className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
        <div className="h-2 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="mt-3 flex items-center justify-between">
          <div className="h-2 w-8 rounded bg-slate-300 dark:bg-slate-600" />
          <div className="h-2 w-6 rounded" style={{ backgroundColor: 'var(--color-brand-700)' }} />
        </div>
      </div>
    )
  }
  if (style === 'compact') {
    return (
      <div className="rounded-lg border border-slate-200 p-1.5 dark:border-slate-700">
        <div className="h-1.5 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-1 dark:border-slate-800">
          <div className="h-1.5 w-6 rounded bg-slate-300 dark:bg-slate-600" />
          <div className="h-2 w-5 rounded-full bg-accent-500" />
        </div>
      </div>
    )
  }
  // classic
  return (
    <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
      <div className="h-2 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5 dark:border-slate-800">
        <div className="h-2 w-7 rounded bg-slate-300 dark:bg-slate-600" />
        <div className="h-2.5 w-6 rounded-full bg-accent-500" />
      </div>
    </div>
  )
}

/**
 * A full-size, realistic mock of one bundle card, reflecting the current
 * combination of all three axes. Built from the same structure
 * `Catalogue.tsx`'s `ProductCard` renders (not reused directly, that
 * component is wrapped in a real `<Link>` to a real product, which a preview
 * must not be), sharing `TileBuyButton`/`TileNetworkBadge` with it so the two
 * can never quietly disagree.
 */
export function TileStyleFullPreview({ tileStyle, tileButtonStyle, tileNetworkIndicator }: TileOptions) {
  const network = 'MTN' as const

  if (tileStyle === 'bold') {
    return (
      <div className="max-w-xs overflow-hidden rounded-xl border border-slate-200 shadow-sm dark:border-slate-700">
        <div className="flex items-center justify-between gap-3 bg-brand-50 px-4 py-3 dark:bg-brand-900/30">
          <p className="truncate font-semibold text-brand-900 dark:text-brand-100">1GB Data</p>
          <TileNetworkBadge network={network} indicator={tileNetworkIndicator} />
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">30 days</p>
          <div className="flex items-end justify-between gap-3">
            <p className="tabular text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50">GHS 4.94</p>
            <TileBuyButton buttonStyle={tileButtonStyle} />
          </div>
        </div>
      </div>
    )
  }
  if (tileStyle === 'minimal') {
    return (
      <div className="max-w-xs rounded-xl border border-slate-100 dark:border-slate-800">
        <div className="flex flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-50">1GB Data</p>
              <p className="mt-0.5 text-sm text-slate-400 dark:text-slate-500">30 days</p>
            </div>
            <TileNetworkBadge network={network} indicator={tileNetworkIndicator} />
          </div>
          <div className="mt-5 flex items-end justify-between gap-3">
            <p className="tabular text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              GHS 4.94
            </p>
            <TileBuyButton buttonStyle={tileButtonStyle} />
          </div>
        </div>
      </div>
    )
  }
  if (tileStyle === 'compact') {
    return (
      <div className="max-w-xs rounded-xl border border-slate-200 shadow-sm dark:border-slate-700">
        <div className="flex flex-col p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">1GB Data</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">30 days</p>
            </div>
            <TileNetworkBadge network={network} indicator={tileNetworkIndicator} />
          </div>
          <div className="mt-2 flex items-end justify-between gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
            <p className="tabular text-base font-bold tracking-tight text-brand-800 dark:text-brand-300">
              GHS 4.94
            </p>
            <TileBuyButton buttonStyle={tileButtonStyle} small />
          </div>
        </div>
      </div>
    )
  }
  // classic
  return (
    <div className="max-w-xs rounded-xl border border-slate-200 shadow-sm dark:border-slate-700">
      <div className="flex flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-900 dark:text-slate-50">1GB Data</p>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">30 days</p>
          </div>
          <TileNetworkBadge network={network} indicator={tileNetworkIndicator} />
        </div>
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 pt-3.5 dark:border-slate-800">
          <p className="tabular text-xl font-bold tracking-tight text-brand-800 dark:text-brand-300">GHS 4.94</p>
          <TileBuyButton buttonStyle={tileButtonStyle} />
        </div>
      </div>
    </div>
  )
}

/** One row of selectable pills for a single axis (layout, button style, or network indicator). */
function OptionRow<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { id: T; label: string; description: string }[]
  value: T
  onChange: (id: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isActive = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            disabled={disabled}
            aria-pressed={isActive}
            title={option.description}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-60',
              isActive
                ? 'border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-900/30 dark:text-brand-200'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * A controlled picker for all three tile axes, plus a full-size preview of
 * the current combination. Deliberately does not call any API or know what
 * "apply" means, `ShopBranding.tsx`'s agent flow applies a change once
 * confirmed; the platform owner's own branding form bundles it into one
 * larger save. Both wrap this the same way, with `value`/`onChange`, and
 * decide for themselves what happens next.
 */
export function TileStylePicker({
  value,
  onChange,
  disabled,
}: {
  value: TileOptions
  onChange: (next: TileOptions) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
          Layout
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TILE_STYLES.map((style) => {
            const isActive = value.tileStyle === style.id
            return (
              <button
                key={style.id}
                type="button"
                onClick={() => onChange({ ...value, tileStyle: style.id })}
                disabled={disabled}
                aria-pressed={isActive}
                className={cn(
                  'rounded-xl border p-3 text-left transition disabled:opacity-60',
                  isActive
                    ? 'border-brand-500 ring-2 ring-brand-100 dark:border-brand-400 dark:ring-brand-900/40'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600',
                )}
              >
                <TileStyleThumbnail style={style.id} />
                <div className="mt-2 flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{style.label}</p>
                  {isActive && <CheckIcon className="size-3.5 text-brand-600 dark:text-brand-300" />}
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{style.description}</p>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
          "Buy" button
        </p>
        <OptionRow
          options={TILE_BUTTON_STYLES}
          value={value.tileButtonStyle}
          disabled={disabled}
          onChange={(tileButtonStyle) => onChange({ ...value, tileButtonStyle })}
        />
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
          Network indicator
        </p>
        <OptionRow
          options={TILE_NETWORK_INDICATORS}
          value={value.tileNetworkIndicator}
          disabled={disabled}
          onChange={(tileNetworkIndicator) => onChange({ ...value, tileNetworkIndicator })}
        />
      </div>

      <div>
        <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
          Preview
        </p>
        <p className="mt-1 mb-2.5 text-xs text-slate-500 dark:text-slate-400">
          What a bundle looks like in your shop with this combination, before it's applied.
        </p>
        <TileStyleFullPreview {...value} />
      </div>
    </div>
  )
}
