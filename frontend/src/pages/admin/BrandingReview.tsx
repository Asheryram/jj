import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { useStore } from '../../state/store'
import { deriveBrand } from '../../lib/branding'
import { BRAND_TEMPLATES, templateFor } from '../../lib/brandTemplates'
import { TileStylePicker, type TileOptions } from '../../components/TileStylePicker'
import { Badge, Button, Card, CardHead, Field, PageHead, Spinner, TextInput, Toggle, cn } from '../../components/ui'
import { CheckIcon } from '../../components/icons'

/**
 * The platform's own branding: name, logo, colour and how its own catalogue
 * tiles look. No queue, it is James's platform and there is nobody above him
 * to approve it (see `BrandingService.setPlatform`).
 *
 * Deliberately its own page, not shared with the agents' branding queue
 * (`BrandingRequests.tsx`): "what does my own platform look like" and "what
 * is this specific agent asking to look like" are different jobs, done at
 * different times, for different reasons, and were only ever on one page
 * because they both happened to touch the word "branding".
 */
export default function BrandingReview() {
  return (
    <div>
      <PageHead
        title="Branding"
        subtitle="Your own shop's name, logo, colour and catalogue-tile look."
      />
      <PlatformBranding />
    </div>
  )
}

/** James's own branding. */
function PlatformBranding() {
  const { pushToast } = useStore()
  const [shopName, setShopName] = useState('')
  const [color, setColor] = useState('')
  const [darkEnabled, setDarkEnabled] = useState(false)
  const [colorDark, setColorDark] = useState('')
  const [customColorOpen, setCustomColorOpen] = useState(false)
  const [logo, setLogo] = useState<File | null>(null)
  const [tileOptions, setTileOptions] = useState<TileOptions>({
    tileStyle: 'classic',
    tileButtonStyle: 'accent',
    tileNetworkIndicator: 'chip',
  })
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .branding(null)
      .then((b) => {
        setShopName(b.shopName)
        setColor(b.brandColor)
        // `brandColorDark` always resolves to something, it falls back to the
        // light colour when nothing was chosen. Equal to it means "unset", not
        // a genuine, deliberately identical pair, the one case that reads
        // wrong here changes nothing visually either way.
        setDarkEnabled(Boolean(b.brandColorDark && b.brandColorDark !== b.brandColor))
        setColorDark(b.brandColorDark)
        setCustomColorOpen(!templateFor(b.brandColor))
        setTileOptions({
          tileStyle: b.tileStyle,
          tileButtonStyle: b.tileButtonStyle,
          tileNetworkIndicator: b.tileNetworkIndicator,
        })
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const derived = deriveBrand(color || '#0B3B8F')
  const derivedDark = darkEnabled ? deriveBrand(colorDark || '#0B3B8F') : null
  const activeTemplate = templateFor(color)

  const save = async () => {
    const form = new FormData()
    if (shopName.trim()) form.set('shopName', shopName.trim())
    if (derived) form.set('brandColor', derived.requested)
    if (derivedDark) form.set('brandColorDark', derivedDark.requested)
    if (logo) form.set('logo', logo)
    form.set('tileStyle', tileOptions.tileStyle)
    form.set('tileButtonStyle', tileOptions.tileButtonStyle)
    form.set('tileNetworkIndicator', tileOptions.tileNetworkIndicator)

    setBusy(true)
    try {
      await api.setPlatformBranding(form)
      setLogo(null)
      if (fileInput.current) fileInput.current.value = ''
      pushToast({
        tone: 'success',
        title: 'Branding updated',
        // It applies at once, but the theme is read when the app loads, so a
        // reload is what makes it visible. Saying so avoids "it did nothing".
        detail: 'Reload the page to see the new colour everywhere.',
      })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not save that.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mt-3">
      <CardHead
        title="Your platform"
        subtitle="Applies everywhere except an agent's own shop, where their approved branding wins."
      />
      <div className="space-y-4 p-4 sm:p-5">
        {!loaded ? (
          <div className="py-6 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        ) : (
          <>
            <Field label="Platform name" htmlFor="platform-name">
              <TextInput
                id="platform-name"
                value={shopName}
                maxLength={40}
                onChange={(event) => setShopName(event.target.value)}
              />
            </Field>

            <Field
              label="Logo"
              htmlFor="platform-logo"
              hint="PNG, JPEG or WebP under 100KB. SVG is refused, it can carry scripts."
            >
              <input
                ref={fileInput}
                id="platform-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-700"
                onChange={(event) => setLogo(event.target.files?.[0] ?? null)}
              />
            </Field>

            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              <p className="mb-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">Colour</p>
              <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-8">
                {BRAND_TEMPLATES.map((template) => {
                  const isActive = !customColorOpen && activeTemplate?.id === template.id
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => {
                        setColor(template.hex)
                        setCustomColorOpen(false)
                      }}
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
                        {isActive && <CheckIcon className="size-4 text-white" />}
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
                onClick={() => setCustomColorOpen((v) => !v)}
                className="mt-3 text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline"
              >
                {customColorOpen ? 'Hide custom colour' : 'Or pick your own colour'}
              </button>

              {customColorOpen && (
                <div className="mt-3 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Light mode colour" htmlFor="platform-color">
                      <div className="flex items-center gap-2">
                        <input
                          id="platform-color"
                          type="color"
                          value={derived?.requested ?? '#0B3B8F'}
                          onChange={(event) => setColor(event.target.value)}
                          className="h-11 w-16 cursor-pointer rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1"
                        />
                        <TextInput
                          value={color}
                          className="font-mono"
                          invalid={!derived}
                          onChange={(event) => setColor(event.target.value)}
                        />
                      </div>
                    </Field>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <Toggle
                      id="platform-dark-color-toggle"
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
                      Off means the light colour is reused for dark mode too, chosen automatically so
                      text stays readable. Turn this on for full control over both.
                    </p>
                  )}

                  {darkEnabled && (
                    <Field label="Dark mode colour" htmlFor="platform-color-dark">
                      <div className="flex items-center gap-2">
                        <input
                          id="platform-color-dark"
                          type="color"
                          value={derivedDark?.requested ?? '#0B3B8F'}
                          onChange={(event) => setColorDark(event.target.value)}
                          className="h-11 w-16 cursor-pointer rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1"
                        />
                        <TextInput
                          value={colorDark}
                          className="font-mono"
                          invalid={!derivedDark}
                          onChange={(event) => setColorDark(event.target.value)}
                        />
                      </div>
                    </Field>
                  )}
                </div>
              )}

              {derived && (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {Object.entries((darkEnabled && derivedDark ? derivedDark : derived).ramp).map(
                      ([step, hex]) => (
                        <div
                          key={step}
                          className="size-8 rounded-lg border border-slate-200 dark:border-slate-700"
                          style={{ backgroundColor: hex }}
                          title={`${step} · ${hex}`}
                        />
                      ),
                    )}
                    {derived.adjusted && (
                      <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                        buttons darkened so white text stays readable
                      </span>
                    )}
                  </div>

                  <div className="mt-3">
                    <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
                      How it will look
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Visitors can read the platform in either theme, a mock of the same bundle card
                      shown both ways, so you can check this colour works in both before saving.
                    </p>

                    {/* Two fixed swatches, not `dark:` classes, shows both themes
                        at once regardless of which one you are viewing this page in. */}
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
                </>
              )}
            </div>

            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              <p className="mb-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Catalogue tiles
              </p>
              <TileStylePicker value={tileOptions} onChange={setTileOptions} disabled={busy} />
            </div>

            <Button loading={busy} onClick={() => void save()}>
              Save platform branding
            </Button>
          </>
        )}
      </div>
    </Card>
  )
}
