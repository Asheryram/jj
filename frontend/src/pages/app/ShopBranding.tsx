import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  apiAsset,
  api,
  ApiError,
  type BillingInterval,
  type DomainPaymentMethod,
  type DomainStage,
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
 * The agent's shop address, `kwame.<root>`, which opens their shop.
 *
 * The agent picks a name, monthly or yearly, and how to pay: taken from their
 * earnings automatically, or paid by them by Mobile Money or card. Once the
 * superadmin approves and hosting serves it, an earnings payer goes live on
 * their own; a Mobile Money payer gets "Pay to go live".
 */
function CustomDomainCard() {
  const { pushToast, domainSubdomainRoot, paystackFeeBp } = useStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState<MyDomainStatus | null | undefined>(undefined)
  const [prices, setPrices] = useState<DomainPrice[] | null>(null)
  const [interval, setBillingInterval] = useState<BillingInterval>('monthly')
  const [method, setMethod] = useState<DomainPaymentMethod>('balance')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [payBusy, setPayBusy] = useState<'balance' | 'paystack' | null>(null)
  const [methodBusy, setMethodBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [result, priceRows] = await Promise.all([api.myDomain(), api.domainPricing()])
      setStatus(result)
      setPrices(priceRows)
      if (result) {
        setBillingInterval(result.billingInterval)
        setMethod(result.paymentMethod)
        setLabel(result.domain.split('.')[0])
      }
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Back from Paystack. The server checks the payment with Paystack itself;
  // it is also confirmed in the background if this page is never reached.
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
            ? { tone: 'success', title: 'Paid', detail: 'Your shop address is paid up and live.' }
            : { tone: 'info', title: 'Waiting for the payment', detail: 'If you approved it, it will show here within a few minutes.' },
        )
        void load()
      })
      .catch(() => pushToast({ tone: 'error', title: 'Could not check that payment just now.' }))
      .finally(() => {
        searchParams.delete('domainPayment')
        setSearchParams(searchParams, { replace: true })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const priceFor = (i: BillingInterval) => prices?.find((p) => p.mode === 'subdomain' && p.interval === i)?.priceAmount ?? 0
  const feeOn = (amount: number) => Math.ceil((amount * paystackFeeBp) / 10_000)
  const preview = label.trim() && domainSubdomainRoot ? `${label.trim().toLowerCase()}.${domainSubdomainRoot}` : ''
  const every = (i: BillingInterval) => (i === 'monthly' ? 'month' : 'year')

  const submit = async () => {
    if (!label.trim()) {
      setError('Pick a name, like "kwame".')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await api.requestDomain({ mode: 'subdomain', label: label.trim(), billingInterval: interval, paymentMethod: method })
      setStatus(result)
      setEditing(false)
      pushToast({ tone: 'success', title: 'Sent for approval', detail: 'You will be told as soon as it is approved.' })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not send that.')
    } finally {
      setBusy(false)
    }
  }

  const changeMethod = async (next: DomainPaymentMethod) => {
    setMethod(next)
    if (!status) return
    setMethodBusy(true)
    try {
      setStatus(await api.setDomainPaymentMethod(next))
      pushToast({ tone: 'success', title: next === 'balance' ? 'Paying from your earnings' : 'Paying by Mobile Money or card' })
    } catch (caught) {
      setMethod(status.paymentMethod)
      pushToast({ tone: 'error', title: 'Could not change that', detail: caught instanceof ApiError ? caught.message : undefined })
    } finally {
      setMethodBusy(false)
    }
  }

  const remove = async () => {
    setRemoving(true)
    try {
      await api.removeDomain()
      setStatus(null)
      setLabel('')
      setConfirmingRemove(false)
      pushToast({ tone: 'success', title: 'Shop address removed', detail: 'Your shop is back on your /s/ link only.' })
    } catch (caught) {
      pushToast({ tone: 'error', title: 'Could not remove it', detail: caught instanceof ApiError ? caught.message : 'Try again in a moment.' })
    } finally {
      setRemoving(false)
    }
  }

  const payByBalance = async () => {
    setPayBusy('balance')
    try {
      await api.payDomainByBalance()
      pushToast({ tone: 'success', title: 'Paid from your earnings', detail: 'Your shop address is live.' })
      await load()
    } catch (caught) {
      pushToast({ tone: 'error', title: 'Could not pay from earnings', detail: caught instanceof ApiError ? caught.message : 'Try again in a moment.' })
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
      pushToast({ tone: 'error', title: 'Could not start that payment', detail: caught instanceof ApiError ? caught.message : 'Try again in a moment.' })
      setPayBusy(null)
    }
  }

  if (!domainSubdomainRoot) {
    return (
      <Card className="mt-3">
        <CardHead title="Your shop address" subtitle="A web address of your own that opens your shop." />
        <div className="p-4 sm:p-5">
          <Callout tone="info" icon={<GlobeIcon className="size-4" />}>
            Shop addresses aren't available yet. Share your /s/ link in the meantime.
          </Callout>
        </div>
      </Card>
    )
  }

  const stage = status?.stage
  const due = status ? status.priceAmount : priceFor(interval)
  const payButtons = (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button
        size="sm"
        variant={status?.paymentMethod === 'balance' ? 'primary' : 'outline'}
        loading={payBusy === 'balance'}
        disabled={Boolean(payBusy)}
        onClick={() => void payByBalance()}
      >
        Pay {cedis(due)} from earnings
      </Button>
      <Button
        size="sm"
        variant={status?.paymentMethod === 'paystack' ? 'primary' : 'outline'}
        loading={payBusy === 'paystack'}
        disabled={Boolean(payBusy)}
        onClick={() => void payByPaystack()}
      >
        Pay {cedis(due + feeOn(due))} by Mobile Money or card
      </Button>
    </div>
  )
  const showForm = !status || stage === 'refused' || editing

  return (
    <Card className="mt-3">
      <CardHead title="Your shop address" subtitle={`A web address like kwame.${domainSubdomainRoot} that opens straight to your shop.`} />
      <div className="space-y-4 p-4 sm:p-5">
        {status === undefined ? (
          <div className="py-6 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        ) : (
          <>
            {status && (
              <div data-tour="agent-domain-status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3.5 py-3 dark:border-slate-700">
                <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-50">{status.domain}</span>
                <Badge tone={stage === 'live' ? 'success' : stage === 'grace' || stage === 'payment_needed' ? 'warning' : stage === 'suspended' || stage === 'refused' || stage === 'lapsed' ? 'danger' : 'neutral'}>
                  {STAGE_LABEL[stage ?? 'waiting']}
                </Badge>
              </div>
            )}

            {stage === 'waiting' && (
              <Callout tone="info" title="Waiting for approval" icon={<ClockIcon className="size-4" />}>
                You asked for this on {dateTime(status!.requestedAt)}. Nothing is charged until it is approved and working.
              </Callout>
            )}
            {stage === 'setting_up' && (
              <Callout tone="info" title="Approved, being set up" icon={<ClockIcon className="size-4" />}>
                {status!.paymentMethod === 'balance'
                  ? `It goes live by itself in a few minutes, and ${cedis(status!.priceAmount)} is taken from your earnings then.`
                  : 'You will be asked to pay as soon as it is ready, usually within a few minutes.'}
              </Callout>
            )}
            {stage === 'payment_needed' && (
              <Callout tone="warning" title="Ready, pay to go live" icon={<AlertIcon className="size-4" />}>
                {status!.domain} is ready. Pay {cedis(status!.priceAmount)} for the first {every(status!.billingInterval)} to switch it on.
                {payButtons}
              </Callout>
            )}
            {stage === 'live' && (
              <Callout tone="success" title="Live" icon={<CheckIcon className="size-4" />}>
                {status!.domain} opens your shop.{' '}
                {status!.priceAmount <= 0 ? (
                  'It is free for now.'
                ) : (
                  <>
                    Next payment: {cedis(status!.priceAmount)} on{' '}
                    {status!.nextRenewalAt ? dateTime(status!.nextRenewalAt) : 'its renewal date'},{' '}
                    {status!.paymentMethod === 'balance' ? 'taken from your earnings automatically.' : 'you will be asked to pay by Mobile Money or card.'}
                  </>
                )}
              </Callout>
            )}
            {stage === 'grace' && (
              <Callout tone="warning" title="Renewal due" icon={<AlertIcon className="size-4" />}>
                Still live, but pay before {status!.graceEndsAt ? dateTime(status!.graceEndsAt) : 'the deadline'} or it switches off.
                {payButtons}
              </Callout>
            )}
            {stage === 'lapsed' && (
              <Callout tone="warning" title="Switched off" icon={<AlertIcon className="size-4" />}>
                Its renewal went unpaid. Pay any time to bring it straight back.
                {payButtons}
              </Callout>
            )}
            {stage === 'suspended' && (
              <Callout tone="warning" title="Switched off by the admin" icon={<AlertIcon className="size-4" />}>
                Contact the admin to have it restored. Paying cannot switch it back on.
              </Callout>
            )}
            {stage === 'refused' && (
              <Callout tone="warning" title="Not approved" icon={<AlertIcon className="size-4" />}>
                {status!.reason ?? 'No reason was given.'} You can pick a different name below.
              </Callout>
            )}

            {status && !showForm && stage !== 'suspended' && (
              <div data-tour="agent-domain-method">
              <Field label="How you pay" htmlFor="domain-pay-method">
                <Segmented
                  options={[
                    { value: 'balance', label: 'From my earnings' },
                    { value: 'paystack', label: 'Mobile Money or card' },
                  ]}
                  value={method}
                  onChange={(next) => void changeMethod(next)}
                  className={methodBusy ? 'pointer-events-none opacity-60' : undefined}
                />
              </Field>
              </div>
            )}

            {showForm && (
              <div data-tour="agent-domain-form" className="space-y-4">
                <Field label="Pick a name" htmlFor="shop-label" hint={preview ? `Your shop at ${preview}` : 'Letters, digits and hyphens, e.g. "kwame".'} error={error}>
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
                <Field label="Billing" htmlFor="shop-domain-interval">
                  <Segmented
                    options={[
                      { value: 'monthly', label: `Monthly · ${cedis(priceFor('monthly'))}` },
                      { value: 'yearly', label: `Yearly · ${cedis(priceFor('yearly'))}` },
                    ]}
                    value={interval}
                    onChange={setBillingInterval}
                  />
                </Field>
                <Field label="How you pay" htmlFor="shop-domain-method">
                  <Segmented
                    options={[
                      { value: 'balance', label: 'From my earnings' },
                      { value: 'paystack', label: 'Mobile Money or card' },
                    ]}
                    value={method}
                    onChange={setMethod}
                  />
                </Field>
                <Callout tone="info" icon={<GlobeIcon className="size-4" />}>
                  {priceFor(interval) <= 0
                    ? 'Free for now, nothing is charged.'
                    : method === 'balance'
                      ? `${cedis(priceFor(interval))} a ${every(interval)}, taken from your earnings automatically once it is live, and each ${every(interval)} after. If your earnings are short, you can pay by Mobile Money instead.`
                      : `${cedis(priceFor(interval))} a ${every(interval)}, plus ${cedis(feeOn(priceFor(interval)))} Paystack fee, paid by you by Mobile Money or card when it is ready and each ${every(interval)} after.`}
                </Callout>
                <div className="flex gap-2">
                  <Button block loading={busy} onClick={() => void submit()}>
                    Send for approval
                  </Button>
                  {editing && (
                    <Button variant="outline" className="shrink-0" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            )}

            {status && !showForm && (
              <div className="flex flex-wrap gap-2">
                {stage !== 'suspended' && (
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    Change name or billing
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setConfirmingRemove(true)}>
                  <XIcon className="size-4" /> Remove
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <Modal open={confirmingRemove} onClose={() => setConfirmingRemove(false)} title="Remove your shop address?">
        <div className="space-y-4">
          <Callout tone="warning" title="What happens next">
            {status?.domain} stops opening your shop right away, and its billing stops too. Nothing already paid is refunded. You can ask
            for an address again any time.
          </Callout>
          <div className="flex gap-2">
            <Button block variant="danger" loading={removing} onClick={() => void remove()}>
              <XIcon className="size-4" /> Remove
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

const STAGE_LABEL: Record<DomainStage, string> = {
  waiting: 'Waiting for approval',
  refused: 'Not approved',
  setting_up: 'Setting up',
  payment_needed: 'Pay to go live',
  live: 'Live',
  grace: 'Renewal due',
  lapsed: 'Switched off',
  suspended: 'Suspended',
}

