import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import type { Network, OrderStatus } from '../data/types'
import { NETWORK_STYLES } from '../lib/networks'
import { CheckIcon, ClockIcon, CopyIcon, XIcon, AlertIcon } from './icons'

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ─── Button ─────────────────────────────────────────────────────────────────

type ButtonVariant =
  | 'primary'
  | 'cta'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'onBrand'
  | 'onBrandOutline'
  | 'whatsapp'
type ButtonSize = 'sm' | 'md' | 'lg'

/**
 * Variants own their colours outright. Overriding a colour through `className`
 * does not reliably win — two utilities of the same kind are resolved by CSS
 * source order, not by the order they appear in the attribute — so anything
 * that needs different colours gets a variant here instead.
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 shadow-sm',
  /**
   * Golden Yellow, for the single highest-emphasis action on a screen.
   * The text is deep blue, never white — #FFC107 behind white text fails AA
   * badly (1.9:1), behind brand-900 it passes at 6.4:1.
   */
  // Self-contained colour blocks: the fill and its required text colour
  // (see the comment above) don't depend on the page around them, so neither
  // gets a dark: override.
  cta: 'bg-accent-500 text-brand-900 hover:bg-accent-400 active:bg-accent-600 shadow-sm',
  secondary: 'bg-brand-50 dark:bg-brand-900/40 text-brand-800 dark:text-brand-300 hover:bg-brand-100 border border-brand-100 dark:border-brand-800',
  outline: 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800',
  ghost: 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  // For use on top of a brand-coloured surface, which is the same blue in
  // both themes — so this stays plain white-on-blue rather than following
  // the page theme.
  onBrand: 'bg-white text-brand-800 hover:bg-brand-50 shadow-sm',
  onBrandOutline: 'border border-white/30 bg-white/10 text-white hover:bg-white/20',
  whatsapp: 'bg-[#25D366] text-white hover:bg-[#1eb959] shadow-sm',
}

// Minimum 44px tall at md and above — thumb-sized, per NFR-4.1.
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm rounded-lg gap-1.5',
  md: 'h-11 px-4 text-[15px] rounded-xl gap-2',
  lg: 'h-13 px-6 text-base rounded-xl gap-2',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  loading?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-semibold whitespace-nowrap transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('animate-spin', className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" fill="none" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

// ─── Surfaces ───────────────────────────────────────────────────────────────

const CARD_TONES = {
  default: 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900',
  /** Filled Deep Blue, for a figure that should read as the headline on a page. */
  brand: 'border-brand-800 bg-brand-700 text-white',
} as const

export function Card({
  className,
  children,
  as: As = 'div',
  tone = 'default',
  role,
  'aria-live': ariaLive,
  'aria-label': ariaLabel,
}: {
  className?: string
  children: ReactNode
  as?: 'div' | 'section' | 'li'
  /**
   * Use this rather than passing `bg-*` through `className`. Two utilities of the
   * same kind are resolved by CSS source order, not by attribute order, so an
   * override there can silently lose to the base class — which is how a filled
   * card ends up as white text on a white background.
   */
  tone?: keyof typeof CARD_TONES
  /** Allows a card to double as a status region when its content updates itself. */
  role?: string
  'aria-live'?: 'off' | 'polite' | 'assertive'
  'aria-label'?: string
}) {
  return (
    <As
      role={role}
      aria-live={ariaLive}
      aria-label={ariaLabel}
      className={cn(
        // `min-w-0`: a grid or flex item defaults to `min-width: auto`, so a
        // card holding a wide table (TableWrap's own `min-w-[36rem]`) refused
        // to shrink below that width even in a single mobile-width column,
        // dragging the whole grid track — and the page — wider than the
        // viewport. Harmless outside a grid/flex context.
        'min-w-0 rounded-2xl border shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
        CARD_TONES[tone],
        className,
      )}
    >
      {children}
    </As>
  )
}

export function CardHead({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 px-4 py-3.5 sm:px-5">
      <div className="min-w-0">
        <h2 className="truncate font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHead({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ─── Badges ─────────────────────────────────────────────────────────────────

type BadgeTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'brand'
  | 'accent'
  | 'onBrand'

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200',
  success: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300',
  warning: 'bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-300',
  danger: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300',
  info: 'bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-300',
  brand: 'bg-brand-100 dark:bg-brand-900/40 text-brand-800 dark:text-brand-300',
  // Golden Yellow, self-contained like the `cta` button above — the fill and
  // its required deep-blue text stay the same in both themes.
  accent: 'bg-accent-500 text-brand-900',
  /** For sitting on top of a filled Deep Blue surface. */
  onBrand: 'bg-white/15 text-white',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** FR-4.4 — status carries an icon as well as colour, so it is not colour-only. */
export function StatusBadge({ status }: { status: OrderStatus }) {
  if (status === 'completed') {
    return (
      <Badge tone="success">
        <CheckIcon className="size-3.5" /> Completed
      </Badge>
    )
  }
  if (status === 'failed') {
    return (
      <Badge tone="danger">
        <XIcon className="size-3.5" /> Failed
      </Badge>
    )
  }
  if (status === 'processing') {
    return (
      <Badge tone="info">
        <Spinner className="size-3.5" /> Processing
      </Badge>
    )
  }
  if (status === 'awaiting_approval') {
    // Deliberately not "Failed" and not "Processing". The money is held and the
    // bundle is still coming, but nothing is in flight at the provider — and an
    // admin scanning this column needs to see that difference at a glance.
    return (
      <Badge tone="warning">
        <ClockIcon className="size-3.5" /> Setting up number
      </Badge>
    )
  }
  return (
    <Badge tone="warning">
      <ClockIcon className="size-3.5" /> Pending
    </Badge>
  )
}

export function NetworkChip({ network, className }: { network: Network | null; className?: string }) {
  if (!network) {
    return (
      <Badge tone="neutral" className={className}>
        All networks
      </Badge>
    )
  }
  const style = NETWORK_STYLES[network]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        style.chip,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', style.dot)} />
      {style.label}
    </span>
  )
}

// ─── Form controls ──────────────────────────────────────────────────────────

/**
 * Carries a Field's hint/error ids down to whatever control sits inside it,
 * however deeply it is wrapped.
 */
const FieldContext = createContext<{ describedBy?: string; invalid: boolean }>({
  invalid: false,
})

/**
 * A labelled form control.
 *
 * The hint and error are wired to the input with `aria-describedby`, and the
 * error also sets `aria-invalid`, so a screen reader announces *why* a field is
 * wrong when focus lands on it — not just that something failed somewhere on the
 * page. The error carries `role="alert"` so it is also read out the moment it
 * appears. Rendering red text alone would leave both groups of users guessing.
 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined
  const describedBy = error ? errorId : hint ? hintId : undefined

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </label>
      {/* Passed by context rather than cloned onto the child: the control is
          often wrapped (a currency prefix, an inline network chip), and cloning
          would decorate the wrapper instead of the input. */}
      <FieldContext.Provider value={{ describedBy, invalid: Boolean(error) }}>
        {children}
      </FieldContext.Provider>
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

const CONTROL_BASE =
  'w-full rounded-xl border bg-white dark:bg-slate-900 px-3.5 text-[15px] text-slate-900 dark:text-slate-50 placeholder:text-slate-500/90 transition-colors focus:outline-none'

export function TextInput({
  invalid,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const field = useContext(FieldContext)
  const isInvalid = invalid ?? field.invalid
  return (
    <input
      aria-invalid={isInvalid || undefined}
      aria-describedby={rest['aria-describedby'] ?? field.describedBy}
      className={cn(
        CONTROL_BASE,
        'h-11',
        isInvalid
          ? 'border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100'
          : 'border-slate-300 dark:border-slate-600 focus:border-brand-500 focus:ring-2 focus:ring-brand-100',
        className,
      )}
      {...rest}
    />
  )
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const field = useContext(FieldContext)
  return (
    <select
      aria-invalid={field.invalid || undefined}
      aria-describedby={rest['aria-describedby'] ?? field.describedBy}
      className={cn(
        CONTROL_BASE,
        'h-11 appearance-none border-slate-300 dark:border-slate-600 pr-9 focus:border-brand-500 focus:ring-2 focus:ring-brand-100',
        'bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2364748b\' stroke-width=\'2\' stroke-linecap=\'round\'%3E%3Cpath d=\'M6 9.5 12 15.5 18 9.5\'/%3E%3C/svg%3E")] bg-[length:18px] bg-[right_0.75rem_center] bg-no-repeat',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  id: string
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600',
      )}
    >
      <span
        className={cn(
          'inline-block size-5 rounded-full bg-white dark:bg-slate-200 shadow transition-transform',
          checked ? 'translate-x-5.5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'inline-flex rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-1',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
            value === option.value
              ? 'bg-white dark:bg-slate-600 text-brand-800 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-50',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// ─── Modal ──────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useRef(`dialog-${Math.random().toString(36).slice(2, 8)}`).current

  useEffect(() => {
    if (!open) return

    // Remember where focus was so it can be handed back on close (WCAG 2.4.3).
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null)

    // Move focus inside, preferring the first control over the container.
    const first = focusables()[0]
    if (first) first.focus()
    else dialogRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      // Keep Tab inside the dialog — otherwise focus escapes to the page behind,
      // which a screen-reader user cannot see has been covered.
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === firstItem || !dialogRef.current?.contains(active))) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
      />
      {/* Bottom sheet on phones, centred dialog on wider screens. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-t-2xl bg-white dark:bg-slate-900 shadow-xl outline-none sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-3.5">
          <h2 id={titleId} className="font-semibold text-slate-900 dark:text-slate-50">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <XIcon className="size-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-3.5">{footer}</div>}
      </div>
    </div>
  )
}

// ─── Data display ───────────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  icon?: ReactNode
  tone?: 'neutral' | 'brand' | 'success' | 'warning'
}) {
  const tones = {
    neutral: 'text-slate-900 dark:text-slate-50',
    brand: 'text-brand-800 dark:text-brand-300',
    success: 'text-emerald-700 dark:text-emerald-400',
    warning: 'text-amber-700 dark:text-amber-400',
  }
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        {icon && <span className="text-slate-300 dark:text-slate-600">{icon}</span>}
      </div>
      <p className={cn('tabular mt-2 text-2xl font-bold tracking-tight', tones[tone])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </Card>
  )
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode
  title: string
  detail?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && (
        <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          {icon}
        </div>
      )}
      <p className="font-semibold text-slate-800 dark:text-slate-100">{title}</p>
      {detail && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/**
 * Wide tables scroll inside their own container — the page never scrolls
 * sideways. The scroll container is focusable and labelled so a keyboard user
 * can actually reach the overflowing content, and `caption` gives screen-reader
 * users the table's purpose before they start reading cells.
 */
export function TableWrap({
  children,
  caption,
}: {
  children: ReactNode
  caption?: string
}) {
  return (
    <div
      className="-mx-px overflow-x-auto"
      tabIndex={0}
      role="region"
      aria-label={caption ? `${caption} (scrollable)` : 'Table (scrollable)'}
    >
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  )
}

export function Th({
  children,
  className,
  align = 'left',
}: {
  children?: ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  className,
  align = 'left',
}: {
  children?: ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <td
      className={cn(
        'border-b border-slate-100 dark:border-slate-800 px-4 py-3 text-slate-700 dark:text-slate-200',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  )
}

// ─── Stepper (NFR-4.2 — the step budget made visible) ───────────────────────

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Purchase progress">
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'active' : 'todo'
        return (
          <li
            key={step}
            aria-current={state === 'active' ? 'step' : undefined}
            className="flex min-w-0 flex-1 flex-col gap-1.5"
          >
            <span
              className={cn(
                'h-1.5 rounded-full transition-colors',
                state === 'done' && 'bg-brand-500',
                state === 'active' && 'bg-brand-700',
                state === 'todo' && 'bg-slate-200 dark:bg-slate-700',
              )}
            />
            <span
              className={cn(
                'truncate text-[11px] font-semibold tracking-wide uppercase',
                state === 'todo' ? 'text-slate-500 dark:text-slate-400' : 'text-brand-800 dark:text-brand-300',
              )}
            >
              {step}
              {/* The bar alone is colour-only; say the state out loud for AT. */}
              <span className="sr-only">
                {state === 'done' ? ' (completed)' : state === 'active' ? ' (current step)' : ' (not started)'}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// ─── Callout ────────────────────────────────────────────────────────────────

export function Callout({
  tone = 'info',
  title,
  children,
  icon,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success'
  title?: string
  children: ReactNode
  icon?: ReactNode
  className?: string
}) {
  const tones = {
    info: 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-300',
    warning: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-300',
    danger: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-900 dark:text-red-300',
    success: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-300',
  }
  return (
    <div className={cn('rounded-xl border px-3.5 py-3 text-sm', tones[tone], className)}>
      <div className="flex gap-2.5">
        {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
        <div className="min-w-0">
          {title && <p className="font-semibold">{title}</p>}
          <div className={cn(title && 'mt-0.5', 'leading-relaxed')}>{children}</div>
        </div>
      </div>
    </div>
  )
}

// ─── Copy-to-clipboard field (referral links, vouchers) ─────────────────────

export function CopyField({
  value,
  label,
  mono,
}: {
  value: string
  label?: string
  mono?: boolean
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard can be blocked; the value stays selectable on screen either way.
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="flex items-stretch gap-2">
      <div className="min-w-0 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5">
        {label && <p className="text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">{label}</p>}
        <p className={cn('truncate text-slate-800 dark:text-slate-100', mono && 'font-mono tracking-wide')}>{value}</p>
      </div>
      <Button variant="outline" onClick={copy} className="shrink-0" aria-label={`Copy ${label ?? value}`}>
        {copied ? <CheckIcon className="size-4 text-brand-600 dark:text-brand-300" /> : <CopyIcon className="size-4" />}
        <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
      </Button>
    </div>
  )
}
