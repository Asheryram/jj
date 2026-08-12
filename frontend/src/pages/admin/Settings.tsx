import { useState } from 'react'
import { useStore } from '../../state/store'
import { NETWORK_PREFIXES, NETWORKS } from '../../lib/networks'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  Field,
  Modal,
  PageHead,
  Select,
  TextInput,
  Toggle,
} from '../../components/ui'
import { AlertIcon, ShieldIcon, UsersIcon } from '../../components/icons'

/** FR-5.5, FR-6.4, NFR-2.4, NFR-5.1, NFR-5.2 */
export default function Settings() {
  const { multiLevelReferral, setMultiLevelReferral, pushToast } = useStore()
  const [confirmMultiLevel, setConfirmMultiLevel] = useState(false)
  const [retryAttempts, setRetryAttempts] = useState('1')
  const [minTopUp, setMinTopUp] = useState('1.00')

  return (
    <div>
      <PageHead title="Settings" subtitle="Platform-wide switches and integration details." />

      {/* ── FR-5.5 / NFR-5.2 — the toggle that must never require a rebuild ── */}
      <Card>
        <CardHead
          title="Referral system"
          subtitle="Controls how deep the agent network can go."
          action={
            <Badge tone={multiLevelReferral ? 'success' : 'neutral'}>
              {multiLevelReferral ? 'Multi-level' : 'Single-level'}
            </Badge>
          }
        />
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-4">
            <div className="min-w-0">
              <label htmlFor="multi-level" className="block font-semibold text-slate-900">
                Allow multi-level referral
              </label>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                Off: agents can register sub-agents, but those sub-agents cannot recruit anyone. On:
                the chain can keep going and every agent sees their full downline.
              </p>
            </div>
            <Toggle
              id="multi-level"
              label="Allow multi-level referral"
              checked={multiLevelReferral}
              onChange={(next) => {
                if (next) {
                  setConfirmMultiLevel(true)
                } else {
                  setMultiLevelReferral(false)
                  pushToast({ tone: 'info', title: 'Referral depth set to single-level' })
                }
              }}
            />
          </div>

          <Callout tone="info" icon={<UsersIcon className="size-4" />}>
            This is a setting, not a code change. Every account already stores who referred it, so
            switching this on immediately reveals the chains that were being recorded all along —
            nothing needs rebuilding or backfilling.
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
              <span className="absolute inset-y-0 left-3.5 flex items-center text-sm font-semibold text-slate-400">
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
        <CardHead title="Integrations" subtitle="Credentials are held as server secrets." />
        <div className="space-y-3 p-4 sm:p-5">
          {[
            { name: 'DataHub GH', field: 'DATAHUB_API_KEY', value: 'dh_live_••••••••••••4f21' },
            { name: 'Paystack', field: 'PAYSTACK_SECRET_KEY', value: 'sk_live_••••••••••••9c07' },
            { name: 'SMS gateway', field: 'SMS_API_KEY', value: 'sms_••••••••••••b83e' },
          ].map((integration) => (
            <div
              key={integration.field}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3.5 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{integration.name}</p>
                <p className="mt-0.5 font-mono text-xs text-slate-500">{integration.field}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="tabular font-mono text-sm text-slate-400">
                  {integration.value}
                </span>
                <Badge tone="success">Connected</Badge>
              </div>
            </div>
          ))}

          <Callout tone="warning" icon={<ShieldIcon className="size-4" />}>
            Keys are stored as environment secrets on the server and are never sent to the browser or
            committed to the repository. They cannot be revealed here — only replaced.
          </Callout>
        </div>
      </Card>

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

      <Modal
        open={confirmMultiLevel}
        onClose={() => setConfirmMultiLevel(false)}
        title="Turn on multi-level referral?"
      >
        <div className="space-y-4">
          <Callout tone="warning" title="This changes how your network grows">
            Sub-agents will be able to recruit their own sub-agents, and every agent will see the
            full chain beneath them. Existing referral links keep working exactly as they do now.
          </Callout>
          <p className="text-sm text-slate-600">
            Nothing about earnings changes: every agent still profits from the gap between their own
            resale price and the cost price. You can switch this back off at any time.
          </p>
          <div className="flex gap-2">
            <Button
              block
              onClick={() => {
                setMultiLevelReferral(true)
                setConfirmMultiLevel(false)
                pushToast({
                  tone: 'success',
                  title: 'Multi-level referral is on',
                  detail: 'Agents can now see their full downline.',
                })
              }}
            >
              Turn it on
            </Button>
            <Button block variant="outline" onClick={() => setConfirmMultiLevel(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
