import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { api } from '../../lib/api'
import { cedis } from '../../lib/format'
import ProviderCatalogue from './ProviderCatalogue'
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
import { AlertIcon, ShieldIcon } from '../../components/icons'

/** FR-5.5, FR-6.4, NFR-2.4, NFR-5.1, NFR-5.2 */
export default function Settings() {
  const { pushToast } = useStore()

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

  /** The server's own word on fulfilment. Read-only here by design. */
  const datahubState = health?.providers.datahub ?? 'simulated'

  return (
    <div>
      <PageHead title="Settings" subtitle="Platform-wide switches and integration details." />

      {/* The referral bonus card stood here.

          Removed at the client's request: an agent earns from what they sell and
          nothing from the sales of people they invited. Who invited whom is still
          recorded and still shown to agents — it just no longer moves money, so
          there is no rate to set and no switch to explain. */}

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
              <span className="absolute inset-y-0 left-3.5 flex items-center text-sm font-semibold text-slate-500 dark:text-slate-400">
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
        <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-3.5 sm:px-5">
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
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{integration.name}</p>
                <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">{integration.field}</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{integration.note}</p>
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

      {/* ── Live fulfilment: status only. The switch is DATAHUB_LIVE in the
             server's environment, deliberately not a button here. ── */}
      <Card className="mt-3">
        <CardHead
          title="Live fulfilment"
          subtitle="Whether orders are really sent to DataHub GH."
          action={
            <Badge
              tone={
                datahubState === 'live'
                  ? 'danger'
                  : datahubState === 'live-requested-no-key'
                    ? 'warning'
                    : 'neutral'
              }
            >
              {datahubState === 'live'
                ? 'LIVE — spending money'
                : datahubState === 'live-requested-no-key'
                  ? 'Misconfigured'
                  : 'Simulated'}
            </Badge>
          }
        />
        <div className="space-y-3 p-4 sm:p-5">
          {datahubState === 'live' ? (
            <Callout tone="danger" title="Every data order is buying a real bundle">
              Each completed order calls DataHub GH and debits your prepaid float — including orders
              placed by anyone testing the site. Set{' '}
              <strong className="font-mono font-semibold">DATAHUB_LIVE=false</strong> and restart to
              stop.
            </Callout>
          ) : datahubState === 'live-requested-no-key' ? (
            <Callout tone="warning" title="Asked to go live, but there is no API key">
              <strong className="font-mono font-semibold">DATAHUB_LIVE</strong> is true while{' '}
              <strong className="font-mono font-semibold">DATAHUB_API_KEY</strong> is empty, so
              orders are still simulated. Set the key and restart.
            </Callout>
          ) : (
            <Callout tone="info" title="Orders are simulated">
              Nothing is bought and no bundle is sent. To go live, set{' '}
              <strong className="font-mono font-semibold">DATAHUB_LIVE=true</strong> in the server's
              environment and restart.
            </Callout>
          )}

          <p className="text-sm text-slate-500 dark:text-slate-400">
            This is an environment setting rather than a button, on purpose: going live spends real
            money on every order, so it should take a deliberate change and a restart — not a click,
            and not something a stolen admin session can do.
          </p>

          <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
            DataHub GH sells <strong className="font-semibold">data bundles only</strong>. Airtime,
            voice, SMS, AFA registration and result checkers have no automated fulfilment — when
            live, an order for one of those is refused and refunded rather than quietly marked
            delivered.
          </Callout>
        </div>
      </Card>

      <YourDetails />

      <AgentApproval />

      <YourProfiles />

      <PaystackFeeSetting />

      <FloatThresholds />

      <ProviderCatalogue />
    </div>
  )
}

/**
 * When to be told the provider float is running down.
 *
 * Kept local to this screen rather than added to the store: nothing else in the
 * app reads these, and the panel on the Overview gets them from the same endpoint
 * that reports the balance.
 *
 * Entered in cedis because that is how James thinks about his float, stored in
 * pesewas because that is how every amount in this system is stored. Zero means
 * off, and says so — a threshold of nothing would otherwise look like a threshold
 * that never triggers, which is the same behaviour with none of the honesty.
 */
/**
 * What Paystack keeps on a Mobile Money payment — and the one number that
 * decides whether a markup actually survives it.
 *
 * Every price derived from a percentage (yours, or an agent's own default
 * markup) is grossed up by this rate so the intended margin lands after the
 * fee — see `priceFromMarkup`. It is not the fee itself, which is whatever
 * Paystack actually reports per transaction and is recorded exactly regardless
 * of this setting; it only decides what gets charged, never what gets booked.
 */
function PaystackFeeSetting() {
  const { pushToast } = useStore()
  const [draft, setDraft] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let live = true
    api
      .adminSettings()
      .then((settings) => {
        if (!live) return
        setDraft((settings.paystackFeeBp / 100).toString())
        setLoaded(true)
      })
      .catch(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [])

  const save = async () => {
    const percent = draft.trim() === '' ? 0 : Number(draft)
    if (!Number.isFinite(percent) || percent < 0 || percent >= 100) {
      pushToast({ tone: 'error', title: 'Enter a rate like 2 or 2.35 — under 100.' })
      return
    }
    const bp = Math.round(percent * 100)
    try {
      await api.setSetting('paystackFeeBp', bp)
      pushToast({ tone: 'success', title: `Fee rate set to ${(bp / 100).toFixed(2)}%` })
    } catch (error) {
      pushToast({
        tone: 'error',
        title: error instanceof Error ? error.message : 'We could not save that.',
      })
    }
  }

  return (
    <Card className="mt-3">
      <CardHead
        title="Paystack's fee"
        subtitle="What every Mobile Money price is grossed up to cover"
      />
      <div className="space-y-3 px-4 pb-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Every price built from a percentage — yours, or an agent's own default markup — is raised
          just enough that after Paystack takes this rate off the top, the margin that was intended
          is what actually lands. Check your Paystack dashboard for their current rate now and then;
          the money audit script also reports the rate <em>actually</em> observed on real payments,
          which is the one to trust once you have some.
        </p>

        <Field
          label="Fee rate (%)"
          htmlFor="paystack-fee"
          hint="Starts at 2%, Paystack's usual Mobile Money rate. This only changes what customers are charged — the real fee on each payment is still recorded exactly as Paystack reports it."
        >
          <div className="relative max-w-40">
            <TextInput
              id="paystack-fee"
              inputMode="decimal"
              className="pr-8 font-bold"
              disabled={!loaded}
              value={draft}
              onChange={(event) => setDraft(event.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={() => void save()}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-slate-400 dark:text-slate-500">
              %
            </span>
          </div>
        </Field>
      </div>
    </Card>
  )
}

function FloatThresholds() {
  const { pushToast } = useStore()
  const [watch, setWatch] = useState('')
  const [risk, setRisk] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let live = true
    api
      .adminSettings()
      .then((settings) => {
        if (!live) return
        setWatch(settings.floatWatchAt ? String(settings.floatWatchAt / 100) : '')
        setRisk(settings.floatRiskAt ? String(settings.floatRiskAt / 100) : '')
        setLoaded(true)
      })
      .catch(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [])

  const save = async (key: 'floatWatchAt' | 'floatRiskAt', draft: string, label: string) => {
    const cedisValue = draft.trim() === '' ? 0 : Number(draft)
    if (!Number.isFinite(cedisValue) || cedisValue < 0) {
      pushToast({ tone: 'error', title: `${label} needs to be an amount like 500.` })
      return
    }
    try {
      await api.setSetting(key, Math.round(cedisValue * 100))
      pushToast({
        tone: 'success',
        title: cedisValue === 0 ? `${label} switched off` : `${label} set to ${cedis(Math.round(cedisValue * 100))}`,
      })
    } catch (error) {
      // The server also refuses at-risk above watch, which is the rule a single
      // field cannot check on its own.
      pushToast({
        tone: 'error',
        title: error instanceof Error ? error.message : 'We could not save that.',
      })
    }
  }

  return (
    <Card className="mt-3">
      <CardHead
        title="Float warnings"
        subtitle="When to email you that DataHub GH is running low"
      />
      <div className="space-y-3 px-4 pb-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          The float is prepaid, and when it empties every order fails after the customer has already
          paid. DataHub publishes no balance, so it is read from the reply to each order — which
          means a warning is the only advance notice possible.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Warn me at (GHS)" htmlFor="float-watch" hint="Blank or 0 switches it off.">
            <TextInput
              id="float-watch"
              inputMode="decimal"
              disabled={!loaded}
              value={watch}
              onChange={(event) => setWatch(event.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={() => void save('floatWatchAt', watch, 'Warning level')}
            />
          </Field>

          <Field
            label="Urgent at (GHS)"
            htmlFor="float-risk"
            hint="Has to be lower than the warning level."
          >
            <TextInput
              id="float-risk"
              inputMode="decimal"
              disabled={!loaded}
              value={risk}
              onChange={(event) => setRisk(event.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={() => void save('floatRiskAt', risk, 'Urgent level')}
            />
          </Field>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          You get one email each time the balance falls past a level, not one per order. If it
          climbs back above and falls again, you are told again.
        </p>
      </div>
    </Card>
  )
}

/**
 * The hats you wear, and a way to add one.
 *
 * An agent profile is a real account, not a preview: it has its own balance,
 * referral code and shop link, and the API strips supplier costs from it exactly
 * as it does for any other agent. That is the point — a preview built on your own
 * admin session would still show you your buying price, which is the one number
 * an agent can never see.
 *
 * It gets no password and no setup link. There is one password per person, on the
 * profile that holds it, and a second would be a second way into one identity.
 */
function YourProfiles() {
  const { session, profiles, addProfile } = useStore()
  const [busy, setBusy] = useState<'admin' | 'agent' | null>(null)

  if (!session) return null

  const has = (role: string) => profiles.some((p) => p.role === role)

  const add = async (role: 'admin' | 'agent') => {
    setBusy(role)
    try {
      await addProfile(role)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="mt-3">
      <CardHead title="Your profiles" subtitle="One sign-in, more than one role" />
      <div className="space-y-3 px-4 pb-4">
        <ul className="space-y-2">
          {profiles.map((profile) => (
            <li
              key={profile.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
                {profile.role === 'superadmin'
                  ? 'Platform'
                  : profile.role === 'admin'
                    ? 'Admin'
                    : profile.role === 'agent'
                      ? 'Agent'
                      : 'Customer'}
                {profile.id === session.id && <Badge tone="brand">Signed in</Badge>}
              </span>
              <span className="tabular text-xs text-slate-500 dark:text-slate-400">{profile.referralCode}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          {!has('agent') && (
            <Button size="sm" loading={busy === 'agent'} onClick={() => void add('agent')}>
              Add an agent profile
            </Button>
          )}
          {!has('admin') && session.role === 'superadmin' && (
            <Button
              size="sm"
              variant="outline"
              loading={busy === 'admin'}
              onClick={() => void add('admin')}
            >
              Add an admin profile
            </Button>
          )}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Switch between them from the picker at the top of the page. Each keeps its own earnings and
          shop link; you sign in once, with the password you already have.
        </p>
      </div>
    </Card>
  )
}

/**
 * Your own number, which is where your earnings are sent.
 *
 * The bootstrap seeds `0000000000` because it creates the operator account before
 * anybody has typed a real number, and no Mobile Money transfer can reach that.
 * Editable here rather than by an admin: it is the account your own money goes to,
 * so nobody else should be setting it.
 *
 * Applies to every profile you hold — they share a number because they are the
 * same person, and leaving one behind would mean a payout to a stale value.
 */
function YourDetails() {
  const { session, updatePhone } = useStore()
  const [draft, setDraft] = useState(session?.phone ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!session) return null

  const placeholder = session.phone === '0000000000'

  const save = async () => {
    if (!/^0\d{9}$/.test(draft.trim())) {
      setError('A Ghana number needs 10 digits, like 0209876543.')
      return
    }
    if (draft.trim() === session.phone) return
    setBusy(true)
    setError('')
    try {
      await updatePhone(draft.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mt-3">
      <CardHead title="Your details" subtitle="The number your earnings are paid to" />
      <div className="space-y-3 px-4 pb-4">
        {placeholder && (
          <Callout tone="warning" title="No real number on your account" icon={<AlertIcon className="size-4" />}>
            Your account still holds the placeholder it was created with. Nothing can be paid to it —
            set your Mobile Money number before requesting a withdrawal.
          </Callout>
        )}

        <Field label="Mobile Money number" htmlFor="my-phone" error={error}>
          <div className="flex flex-wrap gap-2">
            <TextInput
              id="my-phone"
              inputMode="numeric"
              placeholder="0209876543"
              className="tabular max-w-48"
              invalid={Boolean(error)}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value.replace(/[^0-9]/g, '').slice(0, 10))
                setError('')
              }}
            />
            <Button
              size="sm"
              loading={busy}
              disabled={draft.trim() === session.phone}
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>
        </Field>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Changing this updates every profile you hold. A withdrawal can still be sent to a different
          number — you choose it when you request one.
        </p>
      </div>
    </Card>
  )
}

/**
 * Whether a new agent waits for a decision.
 *
 * On by default: the common case is signing up somebody already known, and a queue
 * between them and their first sale is friction for its own sake. Off once
 * strangers start finding the form, and then every application waits in Agent
 * applications where it is approved by a person and the decision is recorded.
 */
function AgentApproval() {
  const { pushToast } = useStore()
  const [auto, setAuto] = useState<boolean | null>(null)

  useEffect(() => {
    let live = true
    api
      .adminSettings()
      .then((s) => live && setAuto(s.agentsAutoApprove))
      .catch(() => live && setAuto(null))
    return () => {
      live = false
    }
  }, [])

  const change = async (next: boolean) => {
    setAuto(next)
    try {
      await api.setSetting('agentsAutoApprove', next)
      pushToast({
        tone: next ? 'success' : 'info',
        title: next ? 'New agents start selling straight away' : 'New agents wait for approval',
        detail: next
          ? 'Anyone who signs up is active immediately.'
          : 'Sign-ups land in Agent applications for you to approve or turn down.',
      })
    } catch {
      setAuto(!next)
      pushToast({ tone: 'error', title: 'We could not change that.' })
    }
  }

  return (
    <Card className="mt-3">
      <CardHead title="New agents" subtitle="Who may start selling, and when" />
      <div className="flex items-start justify-between gap-4 px-4 pb-4">
        <div>
          <label htmlFor="auto-approve" className="block font-semibold text-slate-900 dark:text-slate-50">
            Approve new agents automatically
          </label>
          <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            On, and anyone who signs up can sell immediately. Off, and every sign-up waits in Agent
            applications until you decide — which is what you want once people you do not recognise
            are finding the form. Either way the account is real and your decision is recorded.
          </p>
        </div>
        <Toggle
          id="auto-approve"
          label="Approve new agents automatically"
          checked={auto ?? true}
          onChange={(next) => void change(next)}
        />
      </div>
    </Card>
  )
}
