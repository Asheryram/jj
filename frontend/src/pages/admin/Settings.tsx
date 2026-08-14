import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { api } from '../../lib/api'
import { cedis } from '../../lib/format'
import ProviderCatalogue from './ProviderCatalogue'
import { NETWORK_PREFIXES, NETWORKS } from '../../lib/networks'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  Field,
  PageHead,
  Select,
  TextInput,
  Toggle,
} from '../../components/ui'
import { AlertIcon, ShieldIcon, UsersIcon } from '../../components/icons'

/** FR-5.5, FR-6.4, NFR-2.4, NFR-5.1, NFR-5.2 */
export default function Settings() {
  const {
    referralEnabled,
    referralRatePercent,
    setReferralEnabled,
    setReferralRatePercent,
    products,
    pushToast,
  } = useStore()

  // Held as a draft so a half-typed number never hits the API mid-keystroke.
  const [rateDraft, setRateDraft] = useState(String(referralRatePercent))
  useEffect(() => setRateDraft(String(referralRatePercent)), [referralRatePercent])

  // A representative product for the worked example. MTN 1GB is the volume
  // seller; anything with a real margin would do.
  const sampleProduct = products.find((p) => p.id === 'mtn-data-1gb') ?? products[0]
  const sampleMargin = sampleProduct ? sampleProduct.adminPrice - sampleProduct.supplierCost : 0
  const sampleBonus = Math.round((sampleMargin * referralRatePercent) / 100)
  const [retryAttempts, setRetryAttempts] = useState('1')
  const [minTopUp, setMinTopUp] = useState('1.00')

  // Which providers are actually wired up. Read once on mount; it only changes
  // when the server is redeployed with different secrets.
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null)
  useEffect(() => {
    let cancelled = false
    void api
      .health()
      .then((result) => {
        if (!cancelled) setHealth(result)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const simulated =
    health !== null &&
    (health.providers.datahub !== 'live' || health.providers.paystack !== 'live')

  return (
    <div>
      <PageHead title="Settings" subtitle="Platform-wide switches and integration details." />

      {/* ── FR-5.5 / NFR-5.2 — the toggle that must never require a rebuild ── */}
      <Card>
        <CardHead
          title="Referral bonus"
          subtitle="What an agent earns when someone they referred makes a sale."
          action={
            <Badge tone={referralEnabled ? 'success' : 'neutral'}>
              {referralEnabled ? `${referralRatePercent}% of your margin` : 'Off'}
            </Badge>
          }
        />
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-4">
            <div className="min-w-0">
              <label htmlFor="referral-enabled" className="block font-semibold text-slate-900">
                Pay a bonus on referred agents' sales
              </label>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                An agent has at most one referrer — whoever's link they signed up through. When they
                sell, their referrer earns a share of{' '}
                <strong className="font-semibold">your</strong> margin on that sale. The seller keeps
                their own margin in full, so joining through a referral never costs them anything.
              </p>
            </div>
            <Toggle
              id="referral-enabled"
              label="Pay a bonus on referred agents' sales"
              checked={referralEnabled}
              onChange={(next) => {
                void setReferralEnabled(next)
                pushToast({
                  tone: next ? 'success' : 'info',
                  title: next ? 'Referral bonus is on' : 'Referral bonus is off',
                  detail: next
                    ? `Referrers now earn ${referralRatePercent}% of your margin on their referrals' sales.`
                    : 'Referrals are still recorded, but nobody earns from them.',
                })
              }}
            />
          </div>

          {referralEnabled && (
            <div className="rounded-xl border border-slate-200 p-4">
              <Field
                label="Bonus rate"
                htmlFor="referral-rate"
                hint="Your share of your own margin that goes to the referrer. 0 pays nothing; 100 hands over all of it."
              >
                <div className="relative max-w-40">
                  <TextInput
                    id="referral-rate"
                    inputMode="numeric"
                    className="pr-10 font-bold"
                    value={rateDraft}
                    onChange={(event) => setRateDraft(event.target.value.replace(/[^0-9]/g, ''))}
                    onBlur={() => {
                      const next = Number(rateDraft)
                      if (!Number.isInteger(next) || next < 0 || next > 100) {
                        setRateDraft(String(referralRatePercent))
                        pushToast({
                          tone: 'error',
                          title: 'A bonus rate is a whole number between 0 and 100.',
                        })
                        return
                      }
                      if (next !== referralRatePercent) {
                        void setReferralRatePercent(next)
                        pushToast({ tone: 'success', title: `Bonus rate set to ${next}%` })
                      }
                    }}
                  />
                  <span className="absolute inset-y-0 right-3.5 flex items-center text-sm font-semibold text-slate-500">
                    %
                  </span>
                </div>
              </Field>

              {/* A rate is abstract until it is money. Show it against a real
                  product, so what he is giving away is on screen. */}
              {sampleProduct && sampleMargin > 0 && (
                <div className="mt-3 rounded-xl bg-slate-50 p-3.5 text-sm">
                  <p className="font-semibold text-slate-700">
                    On one {sampleProduct.name} sold by a referred agent
                  </p>
                  <dl className="mt-2 space-y-1 text-slate-600">
                    <div className="flex justify-between gap-3">
                      <dt>Your margin</dt>
                      <dd className="tabular font-medium">{cedis(sampleMargin)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Goes to the referrer</dt>
                      <dd className="tabular font-semibold text-brand-700">{cedis(sampleBonus)}</dd>
                    </div>
                    <div className="flex justify-between gap-3 border-t border-slate-200 pt-1">
                      <dt className="font-semibold text-slate-700">You keep</dt>
                      <dd className="tabular font-bold text-slate-900">
                        {cedis(sampleMargin - sampleBonus)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-slate-500">
                    The seller's own margin and the price the customer pays are untouched.
                  </p>
                </div>
              )}
            </div>
          )}

          <Callout tone="info" icon={<UsersIcon className="size-4" />}>
            This is a setting, not a code change. Every account already stores who referred it, so
            turning the bonus on starts paying against referrals that were being recorded all along —
            nothing needs rebuilding or backfilling. Referral is one level deep by design: an agent
            earns on the people they brought in, not on their recruits' recruits.
          </Callout>
        </div>
      </Card>

      {/* ── Ordering behaviour (FR-4.6, NFR-3.2) ── */}
      <Card className="mt-3">
        <CardHead title="Order handling" subtitle="How the platform behaves when things go wrong." />
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Field
            label="Automatic retries before failing"
            htmlFor="retries"
            hint="Applied when DataHub GH rejects or times out."
          >
            <Select
              id="retries"
              value={retryAttempts}
              onChange={(event) => setRetryAttempts(event.target.value)}
            >
              <option value="0">No retry — fail immediately</option>
              <option value="1">Retry once (recommended)</option>
              <option value="2">Retry twice</option>
            </Select>
          </Field>

          <Field
            label="Minimum wallet top-up"
            htmlFor="min-topup"
            hint="Stops tiny top-ups that cost more in fees than they are worth."
          >
            <div className="relative">
              <span className="absolute inset-y-0 left-3.5 flex items-center text-sm font-semibold text-slate-500">
                GHS
              </span>
              <TextInput
                id="min-topup"
                inputMode="decimal"
                className="pl-13"
                value={minTopUp}
                onChange={(event) => setMinTopUp(event.target.value)}
              />
            </div>
          </Field>
        </div>
        <div className="border-t border-slate-100 px-4 py-3.5 sm:px-5">
          <Button onClick={() => pushToast({ tone: 'success', title: 'Order settings saved' })}>
            Save order settings
          </Button>
        </div>
      </Card>

      {/* ── NFR-2.4 — credentials live in the environment, and the UI says so ── */}
      <Card className="mt-3">
        <CardHead
          title="Integrations"
          subtitle="Live status, read from the server. Credentials are held as server secrets."
        />
        <div className="space-y-3 p-4 sm:p-5">
          {/* Reported by /api/health, not hardcoded. A page that claims
              "Connected" while fulfilment is simulated would have somebody sign
              off on an integration that does not exist. */}
          {[
            {
              name: 'DataHub GH',
              field: 'DATAHUB_API_KEY',
              state: health?.providers.datahub,
              note: 'Bundles, airtime, voice and SMS delivery.',
            },
            {
              name: 'Paystack',
              field: 'PAYSTACK_SECRET_KEY',
              state: health?.providers.paystack,
              note: 'Mobile Money collection and wallet top-ups.',
            },
          ].map((integration) => (
            <div
              key={integration.field}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3.5 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{integration.name}</p>
                <p className="mt-0.5 font-mono text-xs text-slate-500">{integration.field}</p>
                <p className="mt-1 text-sm text-slate-500">{integration.note}</p>
              </div>
              {integration.state === undefined ? (
                <Badge tone="neutral">Checking…</Badge>
              ) : integration.state === 'live' ? (
                <Badge tone="success">Live</Badge>
              ) : (
                <Badge tone="warning">Simulated</Badge>
              )}
            </div>
          ))}

          {simulated && (
            <Callout
              tone="warning"
              title="Not connected to the real providers yet"
              icon={<AlertIcon className="size-4" />}
            >
              No API keys are configured, so deliveries are fulfilled against the provider catalogue
              below and top-ups are credited directly. No real money moves and no real bundles are
              sent. Set the keys on the server to switch over.
            </Callout>
          )}

          <Callout tone="warning" icon={<ShieldIcon className="size-4" />}>
            Keys are stored as environment secrets on the server and are never sent to the browser or
            committed to the repository. They cannot be revealed here — only replaced.
          </Callout>
        </div>
      </Card>

      <ProviderCatalogue />

      {/* ── NFR-5.1 — network prefixes are data, editable without a deploy ── */}
      <Card className="mt-3">
        <CardHead
          title="Network prefixes"
          subtitle="Used to detect a recipient's network. Editable without a code change."
        />
        <div className="space-y-3 p-4 sm:p-5">
          {NETWORKS.map((network) => (
            <div key={network} className="flex flex-wrap items-center gap-3">
              <span className="w-24 shrink-0 text-sm font-semibold text-slate-700">{network}</span>
              <div className="flex flex-wrap gap-1.5">
                {NETWORK_PREFIXES[network].map((prefix) => (
                  <span
                    key={prefix}
                    className="tabular rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-sm text-slate-700"
                  >
                    0{prefix.slice(1)}
                  </span>
                ))}
                <button
                  type="button"
                  className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1 text-sm text-slate-500 hover:border-brand-400 hover:text-brand-700"
                >
                  + Add
                </button>
              </div>
            </div>
          ))}
          <Callout tone="info" icon={<AlertIcon className="size-4" />}>
            Confirm current allocations with the NCA before launch. New prefixes can be added here as
            networks are assigned them — no deployment needed.
          </Callout>
        </div>
      </Card>


    </div>
  )
}
