import { useCallback, useEffect, useRef, useState } from 'react'
import { apiAsset, api, ApiError, type MyBranding } from '../../lib/api'
import { useStore } from '../../state/store'
import { deriveBrand } from '../../lib/branding'
import { dateTime } from '../../lib/format'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  Field,
  PageHead,
  Spinner,
  TextInput,
  Toggle,
  cn,
} from '../../components/ui'
import { AlertIcon, CheckIcon, ClockIcon, StoreIcon } from '../../components/icons'

/**
 * An agent making their shop look like theirs.
 *
 * Nothing here applies immediately. What they submit is reviewed first, and the
 * screen says so in as many words — an agent who changes their logo and sees no
 * change would reasonably assume it was broken and do it again.
 *
 * The review exists because an agent shop takes payment details, so a shop
 * convincingly badged as a bank or a network is a fraud risk the platform carries
 * rather than the agent. That reason is given plainly here too: told why, most
 * people do not try.
 */
export default function ShopBranding() {
  const { session, pushToast } = useStore()
  const [state, setState] = useState<MyBranding | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [shopName, setShopName] = useState('')
  const [color, setColor] = useState('#0B3B8F')
  const [darkEnabled, setDarkEnabled] = useState(false)
  const [colorDark, setColorDark] = useState('#0B3B8F')
  const [logo, setLogo] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const result = await api.myBranding()
      setState(result)
      // Seed the form from whatever is furthest along: a pending proposal is
      // what they last intended, so editing continues from there.
      const source = result.pending ?? result.live
      setShopName(source?.shopName ?? '')
      setColor(source?.brandColor ?? '#0B3B8F')
      setDarkEnabled(Boolean(source?.brandColorDark))
      setColorDark(source?.brandColorDark ?? source?.brandColor ?? '#0B3B8F')
      setError('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not load your shop details.')
    }
  }, [])

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

  const derived = deriveBrand(color)
  const derivedDark = darkEnabled ? deriveBrand(colorDark) : null

  const submit = async () => {
    if (!derived) {
      pushToast({ tone: 'error', title: 'That is not a colour we recognise.' })
      return
    }
    if (darkEnabled && !derivedDark) {
      pushToast({ tone: 'error', title: 'That dark-mode colour is not one we recognise.' })
      return
    }

    const form = new FormData()
    if (shopName.trim()) form.set('shopName', shopName.trim())
    form.set('brandColor', derived.requested)
    if (derivedDark) form.set('brandColorDark', derivedDark.requested)
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
        detail: 'Your shop keeps its current look until it is approved.',
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

  // Resolved against the API origin — see apiAsset. A bare path works on one
  // host and silently returns the app's HTML on two.
  const liveLogoUrl = state?.live?.hasLogo
    ? apiAsset(`/api/branding/logo/${encodeURIComponent(session?.referralCode ?? '')}`)
    : null

  return (
    <div>
      <PageHead
        title="Your shop's look"
        subtitle="Give your shop link your own name, logo and colour. Changes are checked before they go live."
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
              look until they are approved. Sending again replaces what is waiting.
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

          <Card className="mt-3">
            <CardHead
              title="Shop name and mark"
              subtitle="Shown on your shop link instead of the platform's."
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
                      {logoPreview ? 'New — not live yet' : 'Live now'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card className="mt-3">
            <CardHead
              title="Shop colour"
              subtitle="Used for buttons, the header and highlights across your shop."
            />
            <div className="space-y-4 p-4 sm:p-5">
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

              <div className="flex items-center gap-2.5 border-t border-slate-100 dark:border-slate-800 pt-4">
                <Toggle
                  id="dark-color-toggle"
                  checked={darkEnabled}
                  onChange={setDarkEnabled}
                  label="Use a different colour in dark mode"
                />
                {/* A <label> would not activate a button-based Toggle, so this is
                    a second, plain click target rather than one wired to `for`. */}
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
                  Off means your light colour is reused for dark mode too — chosen automatically so
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

              {derived && (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries((darkEnabled && derivedDark ? derivedDark : derived).ramp).map(
                      ([step, hex]) => (
                        <div key={step} className="text-center">
                          <div
                            className="size-10 rounded-lg border border-slate-200 dark:border-slate-700"
                            style={{ backgroundColor: hex }}
                          />
                          <span className="mt-0.5 block text-[10px] text-slate-500 dark:text-slate-400">
                            {step}
                          </span>
                        </div>
                      ),
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
                      How it will look
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Customers can read your shop in either theme — a mock of the same bundle card
                      shown both ways, so you can check your colour works in both.
                    </p>

                    {/* Two fixed swatches, not `dark:` classes — this shows both
                        themes at once regardless of which one you are viewing
                        the page in yourself. */}
                    <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                        <p className="mb-2.5 text-[11px] font-semibold text-slate-400 uppercase">
                          Light
                        </p>
                        <p className="font-semibold text-slate-900">1GB Data</p>
                        <p className="text-sm text-slate-500">30 days</p>
                        <div className="mt-3 flex items-end justify-between border-t border-slate-100 pt-3">
                          <p className="text-xl font-bold tracking-tight" style={{ color: derived.ramp[800] }}>
                            GHS 4.94
                          </p>
                          <Badge tone="accent">Buy</Badge>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-700 bg-slate-900 p-3.5">
                        <p className="mb-2.5 text-[11px] font-semibold text-slate-500 uppercase">
                          Dark{!darkEnabled && ' (auto)'}
                        </p>
                        <p className="font-semibold text-slate-50">1GB Data</p>
                        <p className="text-sm text-slate-400">30 days</p>
                        <div className="mt-3 flex items-end justify-between border-t border-slate-800 pt-3">
                          <p
                            className="text-xl font-bold tracking-tight"
                            style={{ color: (darkEnabled && derivedDark ? derivedDark : derived).ramp[300] }}
                          >
                            GHS 4.94
                          </p>
                          <Badge tone="accent">Buy</Badge>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Said out loud rather than done silently. An agent whose colour
                      is changed without explanation assumes the picker is broken. */}
                  {derived.adjusted && (
                    <Callout tone="info" icon={<AlertIcon className="size-4" />}>
                      Your light-mode colour is a little too light for white button text to be
                      readable, so buttons use a deeper shade of it. Everything else keeps the
                      colour you chose.
                    </Callout>
                  )}
                  {darkEnabled && derivedDark?.adjusted && (
                    <Callout tone="info" icon={<AlertIcon className="size-4" />}>
                      Your dark-mode colour needed the same adjustment, for the same reason.
                    </Callout>
                  )}
                </>
              )}
            </div>
          </Card>

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
                mobile network or another company will be refused — your shop takes payment
                details, and customers have to be able to tell who they are paying.
              </Callout>

              <Button block loading={busy} onClick={() => void submit()}>
                Send for approval
              </Button>
            </div>
          </Card>

          {state?.live && (
            <Card className="mt-3">
              <CardHead title="Live now" />
              <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
                <span className="text-sm text-slate-700 dark:text-slate-200">
                  {state.live.shopName ?? 'Platform name'}
                </span>
                {state.live.brandColor && (
                  <span className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                    <span
                      className={cn('size-4 rounded-full border border-slate-200 dark:border-slate-700')}
                      style={{ backgroundColor: state.live.brandColor }}
                    />
                    {state.live.brandColor}
                  </span>
                )}
                <Badge tone="success">
                  <CheckIcon className="size-3.5" /> approved
                </Badge>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
