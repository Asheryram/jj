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

  const submit = async () => {
    if (!derived) {
      pushToast({ tone: 'error', title: 'That is not a colour we recognise.' })
      return
    }

    const form = new FormData()
    if (shopName.trim()) form.set('shopName', shopName.trim())
    form.set('brandColor', derived.requested)
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
            <Spinner className="mx-auto size-6 text-brand-600" />
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
                  className="block w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-700"
                  onChange={(event) => setLogo(event.target.files?.[0] ?? null)}
                />
              </Field>

              <div className="flex flex-wrap items-center gap-4">
                {(logoPreview ?? liveLogoUrl) && (
                  <div className="flex items-center gap-2.5">
                    <img
                      src={logoPreview ?? liveLogoUrl ?? ''}
                      alt="Your shop logo"
                      className="size-12 rounded-xl border border-slate-200 object-contain"
                    />
                    <span className="text-xs text-slate-500">
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
                <Field label="Pick a colour" htmlFor="shop-color">
                  <input
                    id="shop-color"
                    type="color"
                    value={derived?.requested ?? '#0B3B8F'}
                    onChange={(event) => setColor(event.target.value)}
                    className="h-11 w-20 cursor-pointer rounded-xl border border-slate-200 bg-white p-1"
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

              {derived && (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(derived.ramp).map(([step, hex]) => (
                      <div key={step} className="text-center">
                        <div
                          className="size-10 rounded-lg border border-slate-200"
                          style={{ backgroundColor: hex }}
                        />
                        <span className="mt-0.5 block text-[10px] text-slate-500">{step}</span>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      How it will look
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-3">
                      <span
                        className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
                        style={{ backgroundColor: derived.ramp[700] }}
                      >
                        Buy data
                      </span>
                      <span
                        className="rounded-xl px-3 py-1.5 text-sm font-semibold"
                        style={{ backgroundColor: derived.ramp[50], color: derived.ramp[800] }}
                      >
                        GHS 4.94
                      </span>
                    </div>
                  </div>

                  {/* Said out loud rather than done silently. An agent whose colour
                      is changed without explanation assumes the picker is broken. */}
                  {derived.adjusted && (
                    <Callout tone="info" icon={<AlertIcon className="size-4" />}>
                      Your colour is a little too light for white button text to be readable, so
                      buttons use a deeper shade of it. Everything else keeps the colour you chose.
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
                <span className="text-sm text-slate-700">
                  {state.live.shopName ?? 'Platform name'}
                </span>
                {state.live.brandColor && (
                  <span className="flex items-center gap-1.5 text-sm text-slate-700">
                    <span
                      className={cn('size-4 rounded-full border border-slate-200')}
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
