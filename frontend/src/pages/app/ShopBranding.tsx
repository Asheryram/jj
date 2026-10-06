import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  apiAsset,
  api,
  ApiError,
  type BillingInterval,
  type DomainMode,
  type DomainPrice,
  type MyBranding,
  type MyDomainStatus,
} from '../../lib/api'
import { useStore } from '../../state/store'
import { deriveBrand } from '../../lib/branding'
import { BRAND_TEMPLATES, templateFor } from '../../lib/brandTemplates'
import { cedis, dateTime } from '../../lib/format'
import { TileStylePicker, type TileOptions } from '../../components/TileStylePicker'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  CopyField,
  Field,
  Modal,
  PageHead,
  Segmented,
  Spinner,
  TextInput,
  Toggle,
  cn,
} from '../../components/ui'
import { AlertIcon, CheckIcon, ClockIcon, GlobeIcon, StoreIcon, XIcon } from '../../components/icons'

/**
 * An agent making their shop look like theirs.
 *
 * Name and logo are held for review before they go live (a shop convincingly
 * badged as a bank or a network is a fraud risk the platform carries, since
 * an agent shop takes payment details), so this screen says so plainly.
 * Colour carries none of that risk, and is handled entirely separately, see
 * `ShopColorCard` below and `BrandingService.setColor`'s own reasoning.
 */
export default function ShopBranding() {
  const { session, pushToast } = useStore()
  const [state, setState] = useState<MyBranding | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [shopName, setShopName] = useState('')
  const [logo, setLogo] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  /**
   * What the form last matched the server, so an edit can be told apart
   * from a form that just finished loading. Reset every time `load()` runs,
   * including right after a successful submit, so "sent" doesn't keep
   * reading as "still has unsaved changes."
   */
  const [baseline, setBaseline] = useState<{ shopName: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await api.myBranding()
      setState(result)
      // Seed the form from whatever is furthest along: a pending proposal is
      // what they last intended, so editing continues from there.
      const source = result.pending ?? result.live
      const seeded = { shopName: source?.shopName ?? '' }
      setShopName(seeded.shopName)
      setBaseline(seeded)
      setError('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not load your shop details.')
    }
  }, [])

  // A picked-but-unsent logo counts as dirty too, there is no "baseline" file to compare against.
  const isDirty = baseline !== null && (shopName !== baseline.shopName || logo !== null)

  /**
   * Warn before an accidental refresh/close throws away an edit nothing has
   * saved yet. This only catches leaving the tab, not clicking to another
   * page inside the app, the app's router (`BrowserRouter` + `Routes`, not
   * a data router) has no in-app navigation-blocking hook to catch that half
   * without a bigger routing change; this is the contained fix for the
   * costlier half of the same problem.
   */
  useEffect(() => {
    if (!isDirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  useEffect(() => {
    void load()
  }, [load])

  // Object URLs are revoked on change so a long session does not leak one per
  // file the agent tries.
  useEffect(() => {
    if (!logo) {
      setLogoPreview(null)
      return
    }
    const url = URL.createObjectURL(logo)
    setLogoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [logo])

  const submit = async () => {
    const form = new FormData()
    if (shopName.trim()) form.set('shopName', shopName.trim())
    if (logo) form.set('logo', logo)

    setBusy(true)
    try {
      await api.submitBranding(form)
      setLogo(null)
      if (fileInput.current) fileInput.current.value = ''
      await load()
      pushToast({
        tone: 'success',
        title: 'Sent for approval',
        detail: 'Your shop keeps its current name and logo until it is approved.',
      })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not send that.',
      })
    } finally {
      setBusy(false)
    }
  }

  // Resolved against the API origin, see apiAsset. A bare path works on one
  // host and silently returns the app's HTML on two.
  const liveLogoUrl = state?.live?.hasLogo
    ? apiAsset(`/api/branding/logo/${encodeURIComponent(session?.referralCode ?? '')}`)
    : null

  return (
    <div>
      <PageHead
        title="Your shop's look"
        subtitle="Give your shop link your own name, logo and colour."
      />

      {error && (
        <Callout tone="danger" className="mt-3" icon={<AlertIcon className="size-4" />}>
          {error}
        </Callout>
      )}

      {state === null && !error ? (
        <Card className="mt-3">
          <div className="py-10 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        </Card>
      ) : (
        <>
          {state?.pending && (
            <Callout
              tone="info"
              className="mt-3"
              title="Waiting to be checked"
              icon={<ClockIcon className="size-4" />}
            >
              You sent changes on {dateTime(state.pending.createdAt)}. Your shop keeps its current
              name and logo until they are approved. Sending again replaces what is waiting.
            </Callout>
          )}

          {state?.lastDecision?.status === 'rejected' && !state.pending && (
            <Callout
              tone="warning"
              className="mt-3"
              title="Your last change was not approved"
              icon={<AlertIcon className="size-4" />}
            >
              {state.lastDecision.note ?? 'No reason was given.'} Fix it and send it again.
            </Callout>
          )}

          <div data-tour="agent-look-name">
          <Card className="mt-3">
            <CardHead
              title="Shop name and mark"
              subtitle="Shown on your shop link instead of the platform's. Checked before it goes live."
            />
            <div className="space-y-4 p-4 sm:p-5">
              <Field
                label="Shop name"
                htmlFor="shop-name"
                hint="What customers see at the top of your shop. Up to 40 characters."
              >
                <TextInput
                  id="shop-name"
                  value={shopName}
                  maxLength={40}
                  placeholder="Kwame Data Plus"
                  onChange={(event) => setShopName(event.target.value)}
                />
              </Field>

              <Field
                label="Logo"
                htmlFor="shop-logo"
                hint="PNG, JPEG or WebP, under 100KB. SVG is not accepted because it can carry scripts."
              >
                <input
                  ref={fileInput}
                  id="shop-logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-700"
                  onChange={(event) => setLogo(event.target.files?.[0] ?? null)}
                />
              </Field>

              <div className="flex flex-wrap items-center gap-4">
                {(logoPreview ?? liveLogoUrl) && (
                  <div className="flex items-center gap-2.5">
                    <img
                      src={logoPreview ?? liveLogoUrl ?? ''}
                      alt="Your shop logo"
                      className="size-12 rounded-xl border border-slate-200 dark:border-slate-700 object-contain"
                    />
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {logoPreview ? 'New, not live yet' : 'Live now'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </Card>
          </div>

          <div data-tour="agent-look-send">
          <Card className="mt-3">
            <div className="space-y-3 p-4 sm:p-5">
              <Callout tone="info" icon={<StoreIcon className="size-4" />}>
                <p>
                  <strong className="font-semibold">Two things a shop name cannot change.</strong>{' '}
                  When a customer pays, the payment page and their bank statement show the
                  platform's registered business name, because every shop is behind one merchant
                  account. Receipts and text messages come from the platform too.
                </p>
              </Callout>

              <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
                Changes are checked before they go live. A name or logo that looks like a bank, a
                mobile network or another company will be refused, your shop takes payment
                details, and customers have to be able to tell who they are paying.
              </Callout>

              {isDirty && (
                <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                  Unsaved changes, leaving this page or closing the tab loses them.
                </p>
              )}

              <Button block loading={busy} disabled={!isDirty} onClick={() => void submit()}>
                Send for approval
              </Button>
            </div>
          </Card>
          </div>

          {state?.live && (
            <Card className="mt-3">
              <CardHead title="Live now" />
              <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
                <span className="text-sm text-slate-700 dark:text-slate-200">
                  {state.live.shopName ?? 'Platform name'}
                </span>
                <Badge tone="success">
                  <CheckIcon className="size-3.5" /> approved
                </Badge>
              </div>
            </Card>
          )}

          <div data-tour="agent-look-colour">
            <ShopColorCard live={state?.live ?? null} onApplied={load} />
          </div>

          <div data-tour="agent-look-tiles">
            <ShopTileStyleCard live={state?.live ?? null} onApplied={load} />
          </div>

          <div data-tour="agent-look-domain">
            <CustomDomainCard />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * A shop's colour, applied the instant it's chosen, no review, no waiting.
 *
 * Two ways in: a small gallery of curated, pre-checked colours (the fast
 * path, one tap and it's live), or "pick your own" for the same hex-plus-
 * optional-dark-variant control this used to be all the time. Both call the
 * same instant endpoint, colour is never queued for approval, see
 * `BrandingService.setColor`.
 */
function ShopColorCard({
  live,
  onApplied,
}: {
  live: MyBranding['live']
  onApplied: () => Promise<void> | void
}) {
  const { pushToast } = useStore()
  const [liveColor, setLiveColor] = useState(live?.brandColor ?? null)
  const [liveColorDark, setLiveColorDark] = useState(live?.brandColorDark ?? null)
  useEffect(() => {
    setLiveColor(live?.brandColor ?? null)
    setLiveColorDark(live?.brandColorDark ?? null)
  }, [live?.brandColor, live?.brandColorDark])

  const [customOpen, setCustomOpen] = useState(
    () => Boolean(live?.brandColor) && !templateFor(live?.brandColor ?? null),
  )
  const [color, setColor] = useState(liveColor ?? '#0B3B8F')
  const [darkEnabled, setDarkEnabled] = useState(Boolean(liveColorDark))
  const [colorDark, setColorDark] = useState(liveColorDark ?? liveColor ?? '#0B3B8F')
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [applyingCustom, setApplyingCustom] = useState(false)

  const derived = deriveBrand(color)
  const derivedDark = darkEnabled ? deriveBrand(colorDark) : null
  const activeTemplate = templateFor(liveColor)

  const applyTemplate = async (hex: string, id: string) => {
    setApplyingId(id)
    try {
      const result = await api.setBrandColor(hex, null)
      setLiveColor(result.brandColor)
      setLiveColorDark(result.brandColorDark)
      setCustomOpen(false)
      pushToast({ tone: 'success', title: 'Colour updated' })
      await onApplied()
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not apply that.',
      })
    } finally {
      setApplyingId(null)
    }
  }

  const applyCustom = async () => {
    if (!derived) {
      pushToast({ tone: 'error', title: 'That is not a colour we recognise.' })
      return
    }
    if (darkEnabled && !derivedDark) {
      pushToast({ tone: 'error', title: 'That dark-mode colour is not one we recognise.' })
      return
    }
    setApplyingCustom(true)
    try {
      const result = await api.setBrandColor(derived.requested, derivedDark?.requested ?? null)
      setLiveColor(result.brandColor)
      setLiveColorDark(result.brandColorDark)
      pushToast({ tone: 'success', title: 'Colour updated' })
      await onApplied()
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not apply that.',
      })
    } finally {
      setApplyingCustom(false)
    }
  }

  const previewed = customOpen ? derived : deriveBrand(liveColor ?? '#0B3B8F')
  const previewedDark = customOpen
    ? derivedDark
    : liveColorDark
      ? deriveBrand(liveColorDark)
      : null

  return (
    <Card className="mt-3">
      <CardHead
        title="Shop colour"
        subtitle="Used for buttons, the header and highlights. Applies right away, no review."
      />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-8">
          {BRAND_TEMPLATES.map((template) => {
            const isActive = !customOpen && activeTemplate?.id === template.id
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => void applyTemplate(template.hex, template.id)}
                disabled={applyingId !== null}
                aria-label={template.label}
                aria-pressed={isActive}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition',
                  isActive
                    ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/30'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600',
                )}
              >
                <span
                  className="relative flex size-9 items-center justify-center rounded-full border border-black/5"
                  style={{ backgroundColor: template.hex }}
                >
                  {applyingId === template.id ? (
                    <Spinner className="size-4 text-white" />
                  ) : (
                    isActive && <CheckIcon className="size-4 text-white" />
                  )}
                </span>
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  {template.label}
                </span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          className="text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline"
        >
          {customOpen ? 'Hide custom colour' : 'Or pick your own colour'}
        </button>

        {customOpen && (
          <div className="space-y-4 border-t border-slate-100 dark:border-slate-800 pt-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Light mode colour" htmlFor="shop-color">
                <input
                  id="shop-color"
                  type="color"
                  value={derived?.requested ?? '#0B3B8F'}
                  onChange={(event) => setColor(event.target.value)}
                  className="h-11 w-20 cursor-pointer rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1"
                />
              </Field>
              <Field label="Or type it" htmlFor="shop-color-hex">
                <TextInput
                  id="shop-color-hex"
                  value={color}
                  placeholder="#0B3B8F"
                  className="w-32 font-mono"
                  invalid={!derived}
                  onChange={(event) => setColor(event.target.value)}
                />
              </Field>
            </div>

            <div className="flex items-center gap-2.5">
              <Toggle
                id="dark-color-toggle"
                checked={darkEnabled}
                onChange={setDarkEnabled}
                label="Use a different colour in dark mode"
              />
              <button
                type="button"
                onClick={() => setDarkEnabled(!darkEnabled)}
                className="text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Use a different colour in dark mode
              </button>
            </div>
            {!darkEnabled && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Off means your light colour is reused for dark mode too, chosen automatically so
                text stays readable. Turn this on for full control over both.
              </p>
            )}

            {darkEnabled && (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Dark mode colour" htmlFor="shop-color-dark">
                  <input
                    id="shop-color-dark"
                    type="color"
                    value={derivedDark?.requested ?? '#0B3B8F'}
                    onChange={(event) => setColorDark(event.target.value)}
                    className="h-11 w-20 cursor-pointer rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1"
                  />
                </Field>
                <Field label="Or type it" htmlFor="shop-color-dark-hex">
                  <TextInput
                    id="shop-color-dark-hex"
                    value={colorDark}
                    placeholder="#0B3B8F"
                    className="w-32 font-mono"
                    invalid={!derivedDark}
                    onChange={(event) => setColorDark(event.target.value)}
                  />
                </Field>
              </div>
            )}

            {derived?.adjusted && (
              <Callout tone="info" icon={<AlertIcon className="size-4" />}>
                Your light-mode colour is a little too light for white button text to be
                readable, so buttons use a deeper shade of it. Everything else keeps the colour
                you chose.
              </Callout>
            )}
            {darkEnabled && derivedDark?.adjusted && (
              <Callout tone="info" icon={<AlertIcon className="size-4" />}>
                Your dark-mode colour needed the same adjustment, for the same reason.
              </Callout>
            )}

            <Button loading={applyingCustom} onClick={() => void applyCustom()}>
              Apply colour
            </Button>
          </div>
        )}

        {previewed && (
          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
              How it looks
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {customOpen
                ? 'A preview of what you have picked above, in both themes.'
                : "Your shop's current colour, in both themes."}
            </p>

            {/* Two fixed swatches, not `dark:` classes, this shows both
                themes at once regardless of which one you are viewing
                the page in yourself. */}
            <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                <p className="mb-2.5 text-[11px] font-semibold text-slate-400 uppercase">Light</p>
                <p className="font-semibold text-slate-900">1GB Data</p>
                <p className="text-sm text-slate-500">30 days</p>
                <div className="mt-3 flex items-end justify-between border-t border-slate-100 pt-3">
                  <p className="text-xl font-bold tracking-tight" style={{ color: previewed.ramp[800] }}>
                    GHS 4.94
                  </p>
                  <Badge tone="accent">Buy</Badge>
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-3.5">
                <p className="mb-2.5 text-[11px] font-semibold text-slate-500 uppercase">
                  Dark{!previewedDark && ' (auto)'}
                </p>
                <p className="font-semibold text-slate-50">1GB Data</p>
                <p className="text-sm text-slate-400">30 days</p>
                <div className="mt-3 flex items-end justify-between border-t border-slate-800 pt-3">
                  <p
                    className="text-xl font-bold tracking-tight"
                    style={{ color: (previewedDark ?? previewed).ramp[300] }}
                  >
                    GHS 4.94
                  </p>
                  <Badge tone="accent">Buy</Badge>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * How each bundle looks in the catalogue grid. Picking a different layout
 * only updates the preview below, it does not go live until "Apply" is
 * pressed, same shape as the custom-colour flow in `ShopColorCard`: look
 * first, commit deliberately. Still no admin review either way, a layout
 * choice carries no impersonation risk.
 */
function ShopTileStyleCard({
  live,
  onApplied,
}: {
  live: MyBranding['live']
  onApplied: () => Promise<void> | void
}) {
  const { pushToast } = useStore()
  const current: TileOptions = {
    tileStyle: live?.tileStyle ?? 'classic',
    tileButtonStyle: live?.tileButtonStyle ?? 'accent',
    tileNetworkIndicator: live?.tileNetworkIndicator ?? 'chip',
  }
  const [selected, setSelected] = useState<TileOptions>(current)
  useEffect(() => setSelected(current), [current.tileStyle, current.tileButtonStyle, current.tileNetworkIndicator])
  const [applying, setApplying] = useState(false)

  const isDirty =
    selected.tileStyle !== current.tileStyle ||
    selected.tileButtonStyle !== current.tileButtonStyle ||
    selected.tileNetworkIndicator !== current.tileNetworkIndicator

  const apply = async () => {
    setApplying(true)
    try {
      await api.setTileOptions(selected)
      pushToast({ tone: 'success', title: 'Tile style updated' })
      await onApplied()
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not apply that.',
      })
    } finally {
      setApplying(false)
    }
  }

  return (
    <Card className="mt-3">
      <CardHead
        title="Product tiles"
        subtitle="How each bundle looks in your shop. Preview it, then apply, no review either way."
      />
      <div className="space-y-4 p-4 sm:p-5">
        <TileStylePicker value={selected} onChange={setSelected} disabled={applying} />
        <Button loading={applying} disabled={!isDirty} onClick={() => void apply()}>
          {isDirty ? 'Apply this style' : 'This is already live'}
        </Button>
      </div>
    </Card>
  )
}

/**
 * An agent's own domain, pointed at their shop instead of a `/s/<code>` link.
 *
 * Separate from the branding form above and submitted on its own: a domain
 * change is a different kind of review (verifying ownership, not taste), and
 * the two have no reason to succeed or fail together.
 */
function CustomDomainCard() {
  const { pushToast, domainSubdomainRoot } = useStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState<MyDomainStatus | null | undefined>(undefined)
  const [prices, setPrices] = useState<DomainPrice[] | null>(null)
  const [mode, setMode] = useState<DomainMode>(domainSubdomainRoot ? 'subdomain' : 'custom')
  const [interval, setBillingInterval] = useState<BillingInterval>('monthly')
  const [label, setLabel] = useState('')
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [payBusy, setPayBusy] = useState<'balance' | 'paystack' | null>(null)

  const load = useCallback(async () => {
    try {
      const [result, priceRows] = await Promise.all([api.myDomain(), api.domainPricing()])
      setStatus(result)
      setPrices(priceRows)
      if (result) {
        setMode(result.mode)
        setBillingInterval(result.billingInterval)
        if (result.mode === 'custom') setDomain(result.domain)
        else setLabel(result.domain.split('.')[0])
      }
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Back from Paystack, `PLATFORM_ROOT_DOMAIN` composed this exact
  // `callbackUrl` in `DomainRenewalsService.startPaystackPayment`. A fresh
  // server-side verify, same "never trust the redirect" reasoning as
  // `PaymentReturn.tsx`'s own order-checkout confirm.
  const confirming = useRef(false)
  useEffect(() => {
    const reference = searchParams.get('domainPayment')
    if (!reference || confirming.current) return
    confirming.current = true
    api
      .confirmDomainPaystackPayment(reference)
      .then((result) => {
        pushToast(
          result.ok
            ? { tone: 'success', title: 'Paid', detail: 'Your domain is caught up.' }
            : { tone: 'error', title: 'Payment not confirmed', detail: 'Nothing was charged, try again.' },
        )
        void load()
      })
      .catch(() => pushToast({ tone: 'error', title: 'Could not confirm that payment.' }))
      .finally(() => {
        searchParams.delete('domainPayment')
        setSearchParams(searchParams, { replace: true })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const priceFor = (m: DomainMode, i: BillingInterval) =>
    prices?.find((p) => p.mode === m && p.interval === i)?.priceAmount ?? 0
  const currentPrice = priceFor(mode, interval)
  const preview = label.trim() && domainSubdomainRoot ? `${label.trim().toLowerCase()}.${domainSubdomainRoot}` : ''

  const submit = async () => {
    if (mode === 'subdomain') {
      if (!label.trim()) {
        setError('Pick a label, like "kwame".')
        return
      }
    } else if (!domain.trim()) {
      setError('Enter a domain, like yourshop.com.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await api.requestDomain({
        mode,
        billingInterval: interval,
        ...(mode === 'subdomain' ? { label: label.trim() } : { domain: domain.trim() }),
      })
      setStatus(result)
      pushToast({
        tone: 'success',
        title: 'Sent for approval',
        detail: 'It will not carry your shop until it is approved and pointed at us correctly.',
      })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not send that.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setRemoving(true)
    try {
      await api.removeDomain()
      setStatus(null)
      setDomain('')
      setLabel('')
      setConfirmingRemove(false)
      pushToast({
        tone: 'success',
        title: 'Domain removed',
        detail: 'Your shop is back on your /s/ link only.',
      })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: 'Could not remove it',
        detail: caught instanceof ApiError ? caught.message : 'Try again in a moment.',
      })
    } finally {
      setRemoving(false)
    }
  }

  const payByBalance = async () => {
    setPayBusy('balance')
    try {
      const result = await api.payDomainByBalance()
      if (result.ok) {
        pushToast({ tone: 'success', title: 'Paid', detail: 'Your domain is caught up.' })
        await load()
      } else {
        pushToast({
          tone: 'error',
          title: 'Not enough balance',
          detail: 'Try Mobile Money or card instead.',
        })
      }
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: 'Could not pay from balance',
        detail: caught instanceof ApiError ? caught.message : 'Try again in a moment.',
      })
    } finally {
      setPayBusy(null)
    }
  }

  const payByPaystack = async () => {
    setPayBusy('paystack')
    try {
      const result = await api.startDomainPaystackPayment()
      window.location.href = result.authorizationUrl
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: 'Could not start that payment',
        detail: caught instanceof ApiError ? caught.message : 'Try again in a moment.',
      })
      setPayBusy(null)
    }
  }

  const waiting = status && status.reviewedAt === null
  const live = status && status.allowed && status.active
  const approvedNotLive = status && status.allowed && !status.active
  const refused = status && !status.allowed && status.reviewedAt !== null
  const needsDns = Boolean((waiting || approvedNotLive) && status?.mode === 'custom')
  /** Behind on a payment, still serving on borrowed time, or already switched off for it. */
  const behindOnPayment = Boolean(status?.graceEndsAt)

  return (
    <Card className="mt-3">
      <CardHead
        title="Your own web address"
        subtitle="A subdomain we host for you, or a domain you already own, either way it's billed and reviewed the same."
      />
      <div className="space-y-4 p-4 sm:p-5">
        {status === undefined ? (
          <div className="py-6 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        ) : (
          <>
            {waiting && (
              <Callout tone="info" title="Waiting to be checked" icon={<ClockIcon className="size-4" />}>
                You asked for this on {dateTime(status.requestedAt)}. We check that you actually
                control it before it goes anywhere near your shop.
              </Callout>
            )}
            {approvedNotLive && (
              <Callout tone="info" title="Approved, not live yet" icon={<ClockIcon className="size-4" />}>
                {status.mode === 'subdomain'
                  ? 'Approved, this goes live any moment now.'
                  : "Approved. We check every 6 hours for whether it's pointed at us yet and switch it on the moment it is, no need to come back and check yourself."}
              </Callout>
            )}
            {live && !behindOnPayment && (
              <Callout tone="success" title="Live" icon={<CheckIcon className="size-4" />}>
                {status.domain} carries your shop now, the same as your /s/ link. Renews{' '}
                {status.nextRenewalAt ? dateTime(status.nextRenewalAt) : 'soon'} for{' '}
                {cedis(status.priceAmount)} ({status.billingInterval}).
              </Callout>
            )}
            {refused && (
              <Callout tone="warning" title="Not approved" icon={<AlertIcon className="size-4" />}>
                {status.reason ?? 'No reason was given.'} Fix it and send it again.
              </Callout>
            )}

            {behindOnPayment && (
              <Callout tone="warning" title={status?.active ? 'Payment needed' : 'Switched off'} icon={<AlertIcon className="size-4" />}>
                <p className="mb-3">
                  {status?.active
                    ? `${status.domain} is still live, but its renewal (${cedis(status.priceAmount)}) ` +
                      `couldn't be covered by your balance. Pay before ${status.graceEndsAt ? dateTime(status.graceEndsAt) : 'soon'} to keep it running.`
                    : `${status?.domain} was switched off, its renewal went unpaid. Pay any time to bring it straight back.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" loading={payBusy === 'balance'} disabled={Boolean(payBusy)} onClick={() => void payByBalance()}>
                    Pay from balance
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={payBusy === 'paystack'}
                    disabled={Boolean(payBusy)}
                    onClick={() => void payByPaystack()}
                  >
                    Pay by Mobile Money/card
                  </Button>
                </div>
              </Callout>
            )}

            {needsDns && (
              <div className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-700 p-3.5">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Point your domain at us
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  At your domain's registrar, add this record. It can take a while to take effect
                  after you save it.
                </p>
                <CopyField label="CNAME record" value="cname.vercel-dns.com" mono />
              </div>
            )}

            {!status && (
              <>
                {domainSubdomainRoot && (
                  <Segmented
                    options={[
                      { value: 'subdomain', label: 'Free subdomain' },
                      { value: 'custom', label: 'My own domain' },
                    ]}
                    value={mode}
                    onChange={setMode}
                  />
                )}

                {mode === 'subdomain' && domainSubdomainRoot ? (
                  <Field
                    label="Pick a label"
                    htmlFor="shop-label"
                    hint={preview ? `Live at ${preview}` : `Letters, digits and hyphens, e.g. "kwame".`}
                    error={error}
                  >
                    <TextInput
                      id="shop-label"
                      value={label}
                      placeholder="kwame"
                      invalid={Boolean(error)}
                      onChange={(event) => {
                        setLabel(event.target.value.replace(/[^a-zA-Z0-9-]/g, ''))
                        setError('')
                      }}
                    />
                  </Field>
                ) : (
                  <Field
                    label="Domain"
                    htmlFor="shop-domain"
                    hint="Just the domain, like yourshop.com, no https:// or www."
                    error={error}
                  >
                    <TextInput
                      id="shop-domain"
                      value={domain}
                      placeholder="yourshop.com"
                      invalid={Boolean(error)}
                      onChange={(event) => {
                        setDomain(event.target.value)
                        setError('')
                      }}
                    />
                  </Field>
                )}

                <Field label="Billing" htmlFor="shop-domain-interval">
                  <Segmented
                    options={[
                      { value: 'monthly', label: `Monthly · ${cedis(priceFor(mode, 'monthly'))}` },
                      { value: 'yearly', label: `Yearly · ${cedis(priceFor(mode, 'yearly'))}` },
                    ]}
                    value={interval}
                    onChange={setBillingInterval}
                  />
                </Field>

                <Callout tone="info" icon={<GlobeIcon className="size-4" />}>
                  {currentPrice > 0
                    ? `${cedis(currentPrice)} ${interval}, charged from your balance once this is approved and live, and again every ${interval === 'monthly' ? 'month' : 'year'} after that.`
                    : 'Free for now, nothing is charged.'}
                </Callout>
              </>
            )}

            {status && (
              <Callout tone="info" icon={<GlobeIcon className="size-4" />}>
                Asking for a different domain replaces this one, only one can be live for your
                shop at a time.
              </Callout>
            )}

            <div className="flex gap-2">
              <Button block loading={busy} onClick={() => void submit()}>
                {status ? 'Send again' : 'Send for approval'}
              </Button>
              {status && (
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setConfirmingRemove(true)}
                  aria-label="Remove domain"
                >
                  <XIcon className="size-4" />
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      <Modal open={confirmingRemove} onClose={() => setConfirmingRemove(false)} title="Remove this domain?">
        <div className="space-y-4">
          <Callout tone="warning" title="What happens next">
            {status?.domain} stops carrying your shop right away, live or not, and its billing
            stops too. You go back to sharing your /s/ link, and can send a domain again any time.
          </Callout>
          <div className="flex gap-2">
            <Button block variant="danger" loading={removing} onClick={() => void remove()}>
              <XIcon className="size-4" /> Remove domain
            </Button>
            <Button block variant="outline" onClick={() => setConfirmingRemove(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  )
}
