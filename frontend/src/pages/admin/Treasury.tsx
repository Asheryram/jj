import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { api, ApiError, type BalanceBooksPlan, type TopupSource, type TreasuryOverview, type TreasuryPurpose } from '../../lib/api'
import { cedis, dateTime, parseCedis } from '../../lib/format'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  EmptyState,
  Field,
  Modal,
  PageHead,
  Segmented,
  Select,
  Spinner,
  StatTile,
  TableWrap,
  Td,
  TextInput,
  Th,
} from '../../components/ui'
import { AlertIcon } from '../../components/icons'

const PROVIDERS = [
  { value: 'datahub-gh', label: 'DataHub GH' },
  { value: 'gmpl', label: 'GMPL' },
] as const

const STATUS_TONE = {
  success: 'success',
  pending: 'info',
  sending: 'info',
  failed: 'danger',
  reversed: 'danger',
  otp: 'warning',
  unknown: 'warning',
} as const

const STATUS_LABEL = {
  success: 'sent',
  pending: 'on its way',
  sending: 'sending',
  failed: 'not sent',
  reversed: 'reversed',
  otp: 'needs OTP',
  unknown: 'no answer',
} as const

const SOURCE_LABEL: Record<TopupSource, string> = {
  unclassified: 'needs a decision',
  settlement_momo: 'from settlement MoMo',
  own_money: 'own new money',
  not_topup: 'not a top-up',
}

/**
 * The Paystack balance, run on purpose: refill a supplier float or take money
 * out by real Paystack transfer, booked automatically once Paystack confirms;
 * and the top-ups made on Paystack's dashboard, found automatically, with a
 * person saying where each came from. Approved numbers are superadmin-only.
 */
export default function Treasury() {
  const { session, pushToast } = useStore()
  const isSuperadmin = session?.role === 'superadmin'
  const [data, setData] = useState<TreasuryOverview | null>(null)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [classifying, setClassifying] = useState<string | null>(null)
  const [notSent, setNotSent] = useState<TreasuryOverview['transfers'][number] | null>(null)

  const load = () => {
    api
      .treasury()
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : 'Could not load the Paystack balance.'))
  }
  useEffect(load, [])

  const sync = async () => {
    setSyncing(true)
    try {
      const { found } = await api.treasurySyncTopups()
      pushToast({ tone: 'info', title: found ? `${found} new top-up${found === 1 ? '' : 's'} found` : 'No new top-ups' })
      load()
    } catch (caught) {
      pushToast({ tone: 'error', title: caught instanceof ApiError ? caught.message : 'Could not check Paystack.' })
    } finally {
      setSyncing(false)
    }
  }

  const checkTransfer = async (id: string) => {
    try {
      const result = await api.treasuryCheck(id)
      pushToast({
        tone: result.outcome === 'unreachable' ? 'error' : 'info',
        title:
          result.outcome === 'not_found'
            ? 'Paystack has no such transfer, so it did not go out.'
            : (result.message ?? `Paystack says ${result.status}.`),
      })
      load()
    } catch (caught) {
      pushToast({ tone: 'error', title: caught instanceof ApiError ? caught.message : 'Could not check that.' })
    }
  }

  const classify = async (id: string, source: Exclude<TopupSource, 'unclassified'>) => {
    setClassifying(id)
    try {
      await api.treasuryClassifyTopup(id, source)
      load()
    } catch (caught) {
      pushToast({ tone: 'error', title: caught instanceof ApiError ? caught.message : 'Could not save that.' })
    } finally {
      setClassifying(null)
    }
  }

  if (!data) {
    return (
      <div>
        <PageHead title="Paystack balance" />
        {error ? (
          <Callout tone="danger" className="mt-3">{error}</Callout>
        ) : (
          <div className="py-10 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        )}
      </div>
    )
  }

  const unclassified = data.topups.filter((t) => t.source === 'unclassified')
  const gap =
    data.liveBalance !== null && data.expectedLiveBalance !== null ? data.expectedLiveBalance - data.liveBalance : null

  return (
    <div>
      <PageHead
        title="Paystack balance"
        subtitle="Refill provider floats and take money out by Paystack transfer, booked automatically. Top-ups are found on their own."
        action={
          <a
            href="https://dashboard.paystack.com/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Top up on Paystack
          </a>
        }
      />

      {!data.enabled && (
        <Callout tone="warning" icon={<AlertIcon className="size-4" />} className="mt-3" title="Transfers are off">
          Turn on <strong>Paystack business account</strong> in Settings to send money from here. Before that, in the
          Paystack dashboard: turn on <strong>Manual Payouts</strong> so customer money stays in the balance, and
          untick <strong>Confirm transfers before sending</strong> under Settings → Preferences.
        </Callout>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="In Paystack now"
          value={data.liveBalance === null ? '—' : cedis(data.liveBalance)}
          hint={
            gap !== null && gap > 100
              ? `${cedis(gap)} short of records`
              : gap !== null && gap < -100
                ? `${cedis(-gap)} more than records`
                : 'Live from Paystack'
          }
          tone={gap !== null && gap > 100 ? 'warning' : 'brand'}
        />
        <StatTile
          label="Free to take out"
          value={cedis(Math.max(data.ownerDrawingMax, 0))}
          hint="After everything owed and Paystack's fee"
          tone="success"
        />
        <StatTile label="Owed to others" value={cedis(data.liabilities)} hint="Agents, customers, pending orders" />
        <StatTile
          label="On its way"
          value={cedis(data.inFlight)}
          hint="Transfers not confirmed yet"
          tone={data.inFlight > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <ReconcileCard data={data} gap={gap} />

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <WithdrawCard data={data} onDone={load} />

        <Card>
          <CardHead
            title="Top-ups"
            subtitle="Money put into Paystack from its dashboard, found automatically every 15 minutes."
            action={
              <Button size="sm" variant="outline" loading={syncing} onClick={() => void sync()}>
                Check now
              </Button>
            }
          />
          <div className="px-4 pb-4 sm:px-5">
            {unclassified.length > 0 && (
              <Callout tone="info" className="mb-3">
                Say where each new top-up came from. <strong>From settlement MoMo</strong> is customer money Paystack
                had paid out to the MoMo number, coming back. <strong>Own new money</strong> is fresh capital.
              </Callout>
            )}
            {data.topups.length === 0 ? (
              <EmptyState title="No top-ups yet" detail="Top up from the Paystack dashboard and it will appear here." />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.topups.map((t) => (
                  <li key={t.id} className="py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold tabular text-slate-900 dark:text-slate-50">{cedis(t.amount)}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{dateTime(t.occurredAt)}</p>
                      </div>
                      <Badge tone={t.source === 'unclassified' ? 'warning' : t.source === 'own_money' ? 'brand' : 'neutral'}>
                        {SOURCE_LABEL[t.source]}
                      </Badge>
                    </div>
                    {(t.source === 'unclassified' || isSuperadmin) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(['settlement_momo', 'own_money', 'not_topup'] as const)
                          .filter((s) => s !== t.source)
                          .map((s) => (
                            <Button
                              key={s}
                              size="sm"
                              variant="outline"
                              loading={classifying === t.id}
                              onClick={() => void classify(t.id, s)}
                            >
                              {SOURCE_LABEL[s]}
                            </Button>
                          ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-3">
        <CardHead title="Transfers out" subtitle="Every float refill and withdrawal sent from the Paystack balance." />
        {data.transfers.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyState title="Nothing sent yet" />
          </div>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>For</Th>
                <Th>To</Th>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.transfers.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <p className="text-sm">{dateTime(t.createdAt)}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t.reference}</p>
                  </Td>
                  <Td>
                    {t.purpose === 'provider_refill'
                      ? `Refill ${t.provider === 'gmpl' ? 'GMPL' : 'DataHub GH'}`
                      : 'Taken out'}
                    {t.note && <p className="text-xs text-slate-500 dark:text-slate-400">{t.note}</p>}
                  </Td>
                  <Td>
                    {t.destination.label}
                    <p className="text-xs tabular text-slate-500 dark:text-slate-400">{t.destination.phone}</p>
                  </Td>
                  <Td align="right" className="tabular font-semibold">
                    {cedis(t.amount)}
                    <p className="text-xs font-normal text-slate-500 dark:text-slate-400">+{cedis(t.fee)} fee</p>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                    {t.statusNote && (
                      <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">{t.statusNote}</p>
                    )}
                    {(t.status === 'pending' || t.status === 'otp' || t.status === 'unknown') && (
                      <button
                        type="button"
                        onClick={() => void checkTransfer(t.id)}
                        className="mt-1 block text-xs font-semibold text-brand-700 dark:text-brand-300 underline underline-offset-2"
                      >
                        Check with Paystack
                      </button>
                    )}
                    {isSuperadmin && (t.status === 'otp' || t.status === 'unknown') && (
                      <button
                        type="button"
                        onClick={() => setNotSent(t)}
                        className="mt-1 block text-xs font-semibold text-brand-700 dark:text-brand-300 underline underline-offset-2"
                      >
                        Checked, it did not go
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {isSuperadmin && <DestinationsCard data={data} onDone={load} />}

      {isSuperadmin && <BalanceBooksCard onDone={load} />}

      <MarkNotSentModal transfer={notSent} onClose={() => setNotSent(null)} onDone={load} />
    </div>
  )
}

/** One line of the reconciliation: a label, an optional caption, and a signed amount. */
function Line({ label, hint, amount, strong }: { label: string; hint?: string; amount: string; strong?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 py-1.5 ${strong ? 'border-t border-slate-200 dark:border-slate-700 pt-2 font-semibold text-slate-900 dark:text-slate-50' : 'text-slate-700 dark:text-slate-200'}`}>
      <div>
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs font-normal text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>
      <p className="tabular text-sm whitespace-nowrap">{amount}</p>
    </div>
  )
}

/**
 * Does Paystack hold everything the business should? With Manual Payouts,
 * all collected money not yet spent belongs in the balance. Whatever was
 * settled out to the MoMo before and not spent since is the gap, and this
 * shows it flow by flow so a missing log can be told apart from money that
 * just needs moving back.
 */
function ReconcileCard({ data, gap }: { data: TreasuryOverview; gap: number | null }) {
  if (data.heldByRecords === null || data.expectedLiveBalance === null) return null
  const f = data.flows
  const h = data.heldFor
  const minus = (n: number) => (n > 0 ? `− ${cedis(n)}` : cedis(0))

  return (
    <Card className="mt-3">
      <CardHead
        title="Does Paystack hold everything?"
        subtitle="Everything collected and not yet spent belongs in the Paystack balance."
      />
      <div className="grid gap-5 px-4 pb-4 sm:px-5 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            By the records
          </p>
          <Line label="Paid in by customers" hint="Through Paystack, after its fees" amount={cedis(f.collected)} />
          <Line label="Moved to provider floats" hint="Logged as reimbursements on Finance" amount={minus(f.reimbursed)} />
          <Line label="Manual refunds and payouts repaid" amount={minus(f.advancesRepaid)} />
          <Line label="Sent by Paystack" hint="Agent payouts and refunds, with fees" amount={minus(f.transferred)} />
          {f.ownerMoney !== 0 && (
            <Line
              label="Owner's own money"
              hint="Top-ups in, less withdrawals and treasury fees"
              amount={f.ownerMoney > 0 ? `+ ${cedis(f.ownerMoney)}` : minus(-f.ownerMoney)}
            />
          )}
          <Line label="Should be held" amount={cedis(data.heldByRecords)} strong />
          <Line
            label="Still on its way"
            hint={
              data.lastSettlementAt
                ? `Paid since Paystack last settled, ${dateTime(data.lastSettlementAt)}`
                : 'Paid, not settled yet'
            }
            amount={minus(data.inTransit ?? 0)}
          />
          <Line label="Should be in the balance now" amount={cedis(data.expectedLiveBalance)} strong />
          <Line label="In the balance now" hint="Live from Paystack" amount={data.liveBalance === null ? '—' : cedis(data.liveBalance)} />
          {gap !== null && (
            <Line
              label={gap > 100 ? 'Short' : gap < -100 ? 'More than records' : 'Difference'}
              amount={cedis(Math.abs(gap))}
              strong
            />
          )}
        </div>

        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              What the held money is for
            </p>
            <Line label="Owed to agents, customers, pending orders" amount={cedis(h.owedToOthers)} />
            <Line label="Owed to provider floats" hint="Bundles already bought, float not refilled yet" amount={cedis(h.owedToFloats)} />
            <Line label="Free" amount={cedis(h.free)} />
          </div>

          {gap !== null && gap > 100 ? (
            <Callout tone="warning" icon={<AlertIcon className="size-4" />} title={`${cedis(gap)} is not in Paystack`}>
              <ol className="ml-4 list-decimal space-y-1">
                <li>
                  First log anything paid from the settlement MoMo that is not on Finance yet: float refills (as a{' '}
                  <strong>reimbursement</strong>) and manual refunds or payouts. Each one lowers this.
                  {h.unrepaidAdvances > 0 && (
                    <>
                      {' '}
                      {cedis(h.unrepaidAdvances)} of manual refunds/payouts is still marked as owed back to whoever
                      covered it. If it came from the settlement MoMo, mark it repaid.
                    </>
                  )}
                </li>
                <li>
                  Then move what is left from the settlement MoMo with <strong>Top up on Paystack</strong>, and mark
                  the top-up <strong>from settlement MoMo</strong>.
                </li>
                <li>If the MoMo holds less than that, the difference was spent without being logged.</li>
              </ol>
            </Callout>
          ) : gap !== null && gap < -100 ? (
            <Callout tone="info">
              Paystack holds {cedis(-gap)} more than the records. Usually a top-up not found yet (click Check now) or one
              marked as from the settlement MoMo that was really new money.
            </Callout>
          ) : (
            <Callout tone="success">Paystack holds everything the records say it should.</Callout>
          )}
        </div>
      </div>
    </Card>
  )
}

function WithdrawCard({ data, onDone }: { data: TreasuryOverview; onDone: () => void }) {
  const { pushToast } = useStore()
  const [purpose, setPurpose] = useState<TreasuryPurpose>('provider_refill')
  const [provider, setProvider] = useState<'datahub-gh' | 'gmpl'>('datahub-gh')
  const [amount, setAmount] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const destinations = data.destinations.filter((d) => d.active)
  const max = purpose === 'owner_drawing' ? data.ownerDrawingMax : data.refillMax[provider]

  const submit = async () => {
    const pesewas = parseCedis(amount)
    if (!pesewas) return setError('Enter an amount like 50.00.')
    if (pesewas < data.minTransfer) return setError(`Paystack's smallest transfer is ${cedis(data.minTransfer)}.`)
    if (pesewas > max) return setError(`At most ${cedis(Math.max(max, 0))} right now.`)
    if (!destinationId) return setError('Choose where to send it.')
    setBusy(true)
    setError('')
    try {
      const result = await api.treasuryWithdraw({
        purpose,
        provider: purpose === 'provider_refill' ? provider : undefined,
        amount: pesewas,
        destinationId,
        note: note.trim() || undefined,
      })
      if (result.status === 'failed') {
        setError(result.statusNote ?? 'Paystack did not send it.')
      } else {
        pushToast({
          tone: 'success',
          title: result.status === 'success' ? `${cedis(pesewas)} sent` : `${cedis(pesewas)} on its way`,
        })
        setAmount('')
        setNote('')
      }
      onDone()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not send that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHead title="Send money out" subtitle={`Paystack charges ${cedis(data.fee)} per transfer.`} />
      <form
        className="space-y-3 px-4 pb-4 sm:px-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Segmented
          options={[
            { value: 'provider_refill', label: 'Refill a provider float' },
            { value: 'owner_drawing', label: 'Take money out' },
          ]}
          value={purpose}
          onChange={(v) => {
            setPurpose(v)
            setError('')
          }}
        />

        {purpose === 'provider_refill' && (
          <Field label="Which float" htmlFor="treasury-provider" hint={`Owed to it: ${cedis(data.owedToProvider[provider])}`}>
            <Select
              id="treasury-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'datahub-gh' | 'gmpl')}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Amount (GHS)" htmlFor="treasury-amount" hint={`Up to ${cedis(Math.max(max, 0))} right now`} error={error}>
          <TextInput
            id="treasury-amount"
            inputMode="decimal"
            placeholder="100.00"
            value={amount}
            invalid={Boolean(error)}
            onChange={(e) => {
              setAmount(e.target.value)
              setError('')
            }}
          />
        </Field>

        <Field label="Send to" htmlFor="treasury-destination">
          <Select id="treasury-destination" value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
            <option value="">Choose an approved number</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} · {d.phone} ({d.network})
              </option>
            ))}
          </Select>
        </Field>
        {destinations.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No approved numbers yet. A superadmin adds them at the bottom of this page.
          </p>
        )}

        <Field label="Note (optional)" htmlFor="treasury-note">
          <TextInput
            id="treasury-note"
            placeholder={purpose === 'owner_drawing' ? 'October profit' : 'Weekly float top-up'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        <Button type="submit" block loading={busy} disabled={!data.enabled}>
          Send with Paystack
        </Button>
      </form>
    </Card>
  )
}

function DestinationsCard({ data, onDone }: { data: TreasuryOverview; onDone: () => void }) {
  const { pushToast } = useStore()
  const [label, setLabel] = useState('')
  const [phone, setPhone] = useState('')
  const [network, setNetwork] = useState<'MTN' | 'Telecel' | 'AirtelTigo'>('MTN')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const add = async () => {
    setBusy(true)
    setError('')
    try {
      await api.treasuryAddDestination({ label: label.trim(), phone: phone.trim(), network })
      setLabel('')
      setPhone('')
      pushToast({ tone: 'success', title: 'Number approved' })
      onDone()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add that number.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (id: string, active: boolean) => {
    try {
      await api.treasurySetDestinationActive(id, active)
      onDone()
    } catch (caught) {
      pushToast({ tone: 'error', title: caught instanceof ApiError ? caught.message : 'Could not change that.' })
    }
  }

  return (
    <Card className="mt-3">
      <CardHead
        title="Approved numbers"
        subtitle="Superadmin only. Money can only be sent from Paystack to these numbers."
      />
      <div className="grid gap-4 px-4 pb-4 sm:px-5 lg:grid-cols-2">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.destinations.length === 0 && (
            <li className="py-2 text-sm text-slate-500 dark:text-slate-400">None yet.</li>
          )}
          {data.destinations.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-2.5">
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{d.label}</p>
                <p className="text-xs tabular text-slate-500 dark:text-slate-400">
                  {d.phone} · {d.network}
                </p>
              </div>
              {d.active ? (
                <Button size="sm" variant="outline" onClick={() => void toggle(d.id, false)}>
                  Remove
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => void toggle(d.id, true)}>
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ul>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <Field label="Name" htmlFor="dest-label">
            <TextInput id="dest-label" placeholder="James MTN" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Mobile Money number" htmlFor="dest-phone" error={error}>
            <TextInput
              id="dest-phone"
              inputMode="numeric"
              placeholder="0241234567"
              value={phone}
              invalid={Boolean(error)}
              onChange={(e) => {
                setPhone(e.target.value)
                setError('')
              }}
            />
          </Field>
          <Field label="Network" htmlFor="dest-network">
            <Select
              id="dest-network"
              value={network}
              onChange={(e) => setNetwork(e.target.value as 'MTN' | 'Telecel' | 'AirtelTigo')}
            >
              <option value="MTN">MTN</option>
              <option value="Telecel">Telecel</option>
              <option value="AirtelTigo">AirtelTigo</option>
            </Select>
          </Field>
          <Button type="submit" block variant="outline" loading={busy}>
            Approve number
          </Button>
        </form>
      </div>
    </Card>
  )
}

/**
 * Draw a line under unlogged history: enter the real balances, preview what
 * would be recorded, then confirm. Never touches what agents or customers are
 * owed, see `TreasuryService.balanceBooks`.
 */
function BalanceBooksCard({ onDone }: { onDone: () => void }) {
  const { pushToast } = useStore()
  const [paystack, setPaystack] = useState('')
  const [datahub, setDatahub] = useState('')
  const [gmpl, setGmpl] = useState('')
  const [capitalRepaid, setCapitalRepaid] = useState(false)
  const [readJustNow, setReadJustNow] = useState(false)
  const [note, setNote] = useState('')
  const [plan, setPlan] = useState<BalanceBooksPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const amounts = () => {
    const values = [parseCedis(paystack), parseCedis(datahub), parseCedis(gmpl)]
    return values.every((v) => v !== null) ? (values as number[]) : null
  }

  const run = async (preview: boolean) => {
    const values = amounts()
    if (!values) return setError('Enter all three real balances, like 802.00 (0.00 if empty).')
    if (!preview && note.trim().length < 10) return setError('Say what was agreed and with whom. It is kept on the record.')
    if (!preview && !readJustNow) return setError('Confirm these balances were read just now.')
    setBusy(true)
    setError('')
    try {
      const result = await api.treasuryBalanceBooks({
        paystackAndMomo: values[0],
        datahub: values[1],
        gmpl: values[2],
        capitalRepaid,
        note: note.trim(),
        preview,
        readJustNow,
      })
      if (preview) setPlan(result)
      else {
        setPlan(null)
        setPaystack('')
        setDatahub('')
        setGmpl('')
        setNote('')
        pushToast({ tone: 'success', title: 'Books balanced to the real balances' })
        onDone()
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not work that out.')
    } finally {
      setBusy(false)
    }
  }

  const signed = (n: number) => (n === 0 ? cedis(0) : n > 0 ? `+ ${cedis(n)}` : `− ${cedis(-n)}`)
  const edited = () => setPlan(null)

  return (
    <Card className="mt-3">
      <CardHead
        title="Balance the books"
        subtitle="Superadmin only. When movements were not logged, set the records to the real balances once, openly. What agents and customers are owed is never touched."
      />
      <div className="grid gap-4 px-4 pb-4 sm:px-5 lg:grid-cols-2">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void run(!plan)
          }}
        >
          <Field label="Paystack + settlement MoMo, real total now (GHS)" htmlFor="bb-paystack">
            <TextInput id="bb-paystack" inputMode="decimal" placeholder="802.00" value={paystack} onChange={(e) => { setPaystack(e.target.value); edited() }} />
          </Field>
          <Field label="DataHub float, real balance now (GHS)" htmlFor="bb-datahub">
            <TextInput id="bb-datahub" inputMode="decimal" placeholder="220.00" value={datahub} onChange={(e) => { setDatahub(e.target.value); edited() }} />
          </Field>
          <Field label="GMPL float, real balance now (GHS)" htmlFor="bb-gmpl">
            <TextInput id="bb-gmpl" inputMode="decimal" placeholder="398.00" value={gmpl} onChange={(e) => { setGmpl(e.target.value); edited() }} />
          </Field>
          <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0"
              checked={capitalRepaid}
              onChange={(e) => { setCapitalRepaid(e.target.checked); edited() }}
            />
            <span>
              James's own capital that paid for bundles has already been paid back to him. Only tick this if it has
              not been settled in an earlier balancing: after that, what shows here is ordinary bundle cost.
            </span>
          </label>
          <label className="flex items-start gap-2.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-200">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0"
              checked={readJustNow}
              onChange={(e) => setReadJustNow(e.target.checked)}
            />
            <span>
              I read these balances <strong>just now</strong>. The records move with every order, so older figures would
              put the books out again.
            </span>
          </label>
          <Field label="What was agreed, and with whom" htmlFor="bb-note" error={error}>
            <TextInput
              id="bb-note"
              placeholder="Agreed with James on 31 Oct: unlogged movements before go-live"
              value={note}
              invalid={Boolean(error)}
              onChange={(e) => { setNote(e.target.value); setError('') }}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="button" block variant="outline" loading={busy && !plan} onClick={() => void run(true)}>
              Preview
            </Button>
            <Button type="button" block loading={busy && Boolean(plan)} disabled={!plan} onClick={() => void run(false)}>
              Confirm and record
            </Button>
          </div>
        </form>

        <div>
          {!plan ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Enter the real balances James reads at one moment, then Preview. Nothing is saved until you confirm.
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Paystack + settlement MoMo
                </p>
                <Line label="By the records" hint={`After ${cedis(plan.paystack.inTransit)} still on its way`} amount={cedis(plan.paystack.expected)} />
                <Line label="Real" amount={cedis(plan.paystack.actual)} />
                {plan.paystack.capitalRepaid > 0 && (
                  <Line label="James's capital repaid to him" amount={signed(-plan.paystack.capitalRepaid)} />
                )}
                <Line
                  label={plan.paystack.adjustment <= 0 ? 'Taken out, never logged' : 'Put in, never logged'}
                  hint="Recorded as an owner withdrawal, not as profit or cost"
                  amount={signed(plan.paystack.adjustment)}
                  strong
                />
              </div>
              {plan.floats.map((f) => (
                <div key={f.provider}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {f.label} float
                  </p>
                  <Line label="By the records" amount={cedis(f.expected)} />
                  <Line label="Real" amount={cedis(f.actual)} />
                  <Line label="Adjustment" amount={signed(f.adjustment)} strong />
                </div>
              ))}
              <Callout tone="info">
                Agent earnings, customer money, refunds and pending orders stay exactly as they are. These entries stay
                on the ledger permanently, with your note.
              </Callout>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function MarkNotSentModal({
  transfer,
  onClose,
  onDone,
}: {
  transfer: TreasuryOverview['transfers'][number] | null
  onClose: () => void
  onDone: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!transfer) return null

  const submit = async () => {
    if (note.trim().length < 5) return setError('Say what you checked on Paystack.')
    setBusy(true)
    try {
      await api.treasuryMarkNotSent(transfer.id, note.trim())
      onDone()
      onClose()
      setNote('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Did not go · ${transfer.reference}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
          Only if the Paystack dashboard shows this {cedis(transfer.amount)} transfer did not go out. It frees the money
          for other use. If Paystack later says it did go, it is booked anyway.
        </Callout>
        <Field label="What did you check?" htmlFor="not-sent-note" error={error}>
          <TextInput
            id="not-sent-note"
            placeholder="Not in Paystack transfers list, OTP never approved"
            value={note}
            invalid={Boolean(error)}
            onChange={(e) => {
              setNote(e.target.value)
              setError('')
            }}
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" block variant="outline" loading={busy}>
            Mark not sent
          </Button>
          <Button type="button" block disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
