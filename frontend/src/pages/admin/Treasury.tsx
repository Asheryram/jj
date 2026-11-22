import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { withUndo } from '../../lib/undo'
import { api, ApiError, type BalanceBooksPlan, type TopupSource, type TreasuryOverview, type TreasuryPurpose } from '../../lib/api'
import { cedis, dateTime, parseCedis } from '../../lib/format'
import {
  ChoiceList,
  ChoiceModal,
  Badge,
  Button,
  Callout,
  Card,
  CopyIconButton,
  CardHead,
  EmptyState,
  Field,
  Modal,
  PageHead,
  Spinner,
  StatTile,
  TableWrap,
  Td,
  TextInput,
  Th,
} from '../../components/ui'
import { AlertIcon } from '../../components/icons'
import { SUPPLIERS, supplierName, type SupplierCode } from '../../lib/suppliers'

const PROVIDERS = SUPPLIERS.map((s) => ({ value: s.code, label: s.fullLabel }))

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
  /** A transfer not confirmed yet: "Not confirmed" asks what to do first. */
  const [sortingOut, setSortingOut] = useState<TreasuryOverview['transfers'][number] | null>(null)
  const [landing, setLanding] = useState<string | null>(null)

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

  /** A refill reached the float: only now is it counted there, see `TreasuryService.confirmRefillLanded`. */
  const markLanded = async (id: string) => {
    setLanding(id)
    try {
      await api.treasuryConfirmRefillLanded(id)
      pushToast({ tone: 'success', title: 'Marked as in the float' })
      load()
    } catch (caught) {
      pushToast({ tone: 'error', title: caught instanceof ApiError ? caught.message : 'Could not save that.' })
    } finally {
      setLanding(null)
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

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Cash in Paystack"
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
        <StatTile label="In the floats" value={cedis(data.floatsHeld)} hint="DataHub and GMPL, last readings" />
        <StatTile label="Owed to others" value={cedis(data.liabilities)} hint="Agents, customers, pending orders" />
        <StatTile
          label="Yours to take"
          value={cedis(Math.max(data.ownerDrawingMax, 0))}
          hint={data.ownerDrawingMax > 0 ? "After everything owed and Paystack's fee" : 'Nothing spare after what is owed'}
          tone="success"
        />
        <StatTile
          label="On its way"
          value={cedis(data.inFlight)}
          hint="Transfers not confirmed yet"
          tone={data.inFlight > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <ReconcileCard data={data} gap={gap} />

      {(data.refillsAwaitingArrival ?? []).length > 0 && (
        <Card className="mt-3">
          <CardHead
            title="Refills not yet in the float"
            subtitle="Paystack paid these to your MoMo number. Once you have topped up DataHub or GMPL from it, mark it here so the float's figures count it."
          />
          <ul className="divide-y divide-slate-100 px-4 pb-4 sm:px-5 dark:divide-slate-800">
            {(data.refillsAwaitingArrival ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="font-semibold tabular text-slate-900 dark:text-slate-50">
                    {cedis(r.amount)} for {supplierName(r.provider, true)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {r.reference} · to {r.destination.label} ({r.destination.phone})
                    {r.paidAt ? ` · sent ${dateTime(r.paidAt)}` : ''}
                  </p>
                </div>
                <Button size="sm" variant="outline" loading={landing === r.id} onClick={() => void markLanded(r.id)}>
                  It is in the float
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

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
                    {t.transferCode && <PaystackCode code={t.transferCode} />}
                  </Td>
                  <Td>
                    {t.purpose === 'provider_refill'
                      ? `Refill ${supplierName(t.provider, true)}`
                      : t.purpose === 'advance_repayment'
                        ? 'Repaid hand-paid refunds'
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
                    {t.purpose === 'provider_refill' && t.status === 'success' && (
                      <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
                        {t.landedAt ? `In the float since ${dateTime(t.landedAt)}` : 'Not confirmed in the float yet'}
                      </p>
                    )}
                    {(t.status === 'pending' || t.status === 'otp' || t.status === 'unknown') && (
                      <Button className="mt-1.5" size="sm" variant="outline" onClick={() => setSortingOut(t)}>
                        Not confirmed
                      </Button>
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

      <Glossary />

      {sortingOut && (
        <ChoiceModal<'check' | 'notSent'>
          open
          title={`Not confirmed · ${cedis(sortingOut.amount)}`}
          question={`To ${sortingOut.destination.label}. What do you want to do?`}
          choices={[
            { value: 'check', title: 'Ask Paystack', detail: 'See whether this transfer went through.' },
            ...(isSuperadmin && (sortingOut.status === 'otp' || sortingOut.status === 'unknown')
              ? [{ value: 'notSent' as const, title: 'I checked: it did not go', detail: 'Paystack shows no transfer. The money is free again.', danger: true }]
              : []),
          ]}
          onClose={() => setSortingOut(null)}
          onPick={(choice) => {
            const row = sortingOut
            setSortingOut(null)
            if (choice === 'check') void checkTransfer(row.id)
            else setNotSent(row)
          }}
        />
      )}

      <MarkNotSentModal
        transfer={notSent}
        onClose={() => setNotSent(null)}
        onBack={() => {
          setSortingOut(notSent)
          setNotSent(null)
        }}
        onDone={load}
      />
    </div>
  )
}

/** Plain meanings for the money words used across the admin pages. */
function Glossary() {
  const terms: [string, string][] = [
    ['Cash in Paystack', 'Money sitting in the Paystack balance right now, live from Paystack.'],
    ['In the floats', 'Money already paid to DataHub and GMPL, used to buy bundles. It cannot be sent back out.'],
    ['Owed to others', "Agents' earnings, customer refunds and wallets, and the price of orders still being delivered. Never yours to take."],
    ['Yours to take', 'What could be taken out today without touching what is owed. Can be zero even when profit is not.'],
    ['Profit now', 'Profit from finished sales, less what has already been taken out. Profit is not cash: some of it may still be sitting in orders being delivered.'],
    ['Refill', 'Sending money to a provider float so orders can keep going. It does not change profit.'],
    ['Still on its way', 'Customers paid, but Paystack has not moved it into the balance yet. It arrives with the next settlement.'],
    ['Needs OTP', 'Paystack created the transfer but waits for a one-time code. Nothing has left the balance until it is entered.'],
  ]
  return (
    <Card className="mt-3">
      <details className="p-4 sm:p-5">
        <summary className="cursor-pointer font-semibold text-slate-900 dark:text-slate-50">What these words mean</summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {terms.map(([term, meaning]) => (
            <div key={term}>
              <dt className="text-sm font-semibold text-slate-900 dark:text-slate-50">{term}</dt>
              <dd className="text-sm text-slate-600 dark:text-slate-300">{meaning}</dd>
            </div>
          ))}
        </dl>
      </details>
    </Card>
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
        tooltip="Compares what our records say should be in Paystack with what Paystack actually holds. A gap means money moved that the app was not told about."
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

/** Paystack's own transfer code, copyable, to find it in their dashboard. */
function PaystackCode({ code }: { code: string }) {
  return (
    <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
      Paystack <span className="font-mono">{code}</span>
      <CopyIconButton value={code} />
    </span>
  )
}

function WithdrawCard({ data, onDone }: { data: TreasuryOverview; onDone: () => void }) {
  const { pushToast } = useStore()
  /** Null until picked: what this money is for, then which supplier, are their own steps. */
  const [purpose, setPurpose] = useState<TreasuryPurpose | null>(null)
  const [provider, setProvider] = useState<SupplierCode | null>(null)
  const [amount, setAmount] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const destinations = data.destinations.filter((d) => d.active)
  const repaying = purpose === 'advance_repayment'
  const owedBack = data.advancesToRepay
  const max = repaying ? owedBack.total : purpose === 'owner_drawing' ? data.ownerDrawingMax : provider ? data.refillMax[provider] : 0
  const choosing: 'purpose' | 'provider' | null = !purpose ? 'purpose' : purpose === 'provider_refill' && !provider ? 'provider' : null
  const startOver = () => {
    setPurpose(null)
    setProvider(null)
    setError('')
  }

  const submit = async () => {
    if (!purpose) return
    // A repayment is always exactly what is owed back, never typed in.
    const pesewas = repaying ? owedBack.total : parseCedis(amount)
    if (repaying && owedBack.count === 0) return setError('Nothing is owed back for refunds paid by hand.')
    if (!pesewas) return setError('Enter an amount like 50.00.')
    if (repaying && pesewas < data.minTransfer) {
      return setError(
        `${cedis(pesewas)} is owed back so far, below Paystack's smallest transfer of ${cedis(data.minTransfer)}. It can be repaid once a few more add up.`,
      )
    }
    if (pesewas < data.minTransfer) return setError(`Paystack's smallest transfer is ${cedis(data.minTransfer)}.`)
    if (pesewas > max) {
      return setError(
        max < data.minTransfer
          ? `Nothing can be sent yet: Paystack's smallest transfer is ${cedis(data.minTransfer)} and only ${cedis(Math.max(max, 0))} is available after what is owed to agents and customers.`
          : `At most ${cedis(Math.max(max, 0))} right now. The rest is owed to agents and customers.`,
      )
    }
    if (!destinationId) return setError('Choose where to send it.')
    setBusy(true)
    setError('')
    try {
      const target = destinations.find((d) => d.id === destinationId)
      if (!(await withUndo(`Sending ${cedis(pesewas)} to ${target?.label ?? 'the chosen number'}`))) return
      const result = await api.treasuryWithdraw({
        purpose,
        provider: purpose === 'provider_refill' ? (provider ?? undefined) : undefined,
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
      <CardHead
        title="Send money out"
        subtitle={`Paystack charges ${cedis(data.fee)} per transfer.`}
        tooltip="Refill a provider float to keep orders going, or take money out for yourself. Only approved numbers can receive, and money owed to agents and customers is always kept back."
      />
      <form
        className="space-y-3 px-4 pb-4 sm:px-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {choosing === 'purpose' ? (
          <>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">What is this money for?</p>
            <ChoiceList<TreasuryPurpose>
              choices={[
                {
                  value: 'provider_refill',
                  title: "Top up a supplier's balance",
                  detail: 'Sends Paystack money to your MoMo, so you can fund DataHub, GMPL or NetPulse with it.',
                },
                {
                  value: 'owner_drawing',
                  title: 'Take profit out for myself',
                  detail: `Up to ${cedis(Math.max(data.ownerDrawingMax, 0))} now. Money owed to agents and customers stays.`,
                },
                {
                  value: 'advance_repayment',
                  title: 'Pay myself back for refunds I sent by hand',
                  detail:
                    owedBack.count > 0
                      ? `${cedis(owedBack.total)} owed back for ${owedBack.count} refund${owedBack.count === 1 ? '' : 's'}.`
                      : 'Nothing owed back right now.',
                },
              ]}
              onPick={(v) => {
                setPurpose(v)
                setError('')
              }}
            />
          </>
        ) : choosing === 'provider' ? (
          <>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Which supplier's balance?</p>
            <ChoiceList<SupplierCode>
              choices={PROVIDERS.map((p) => ({
                value: p.value,
                title: p.label,
                detail: `Owed to it: ${cedis(data.owedToProvider[p.value])}. Up to ${cedis(Math.max(data.refillMax[p.value], 0))} can be sent now.`,
              }))}
              onPick={setProvider}
            />
            <Button type="button" block variant="outline" onClick={startOver}>
              Back
            </Button>
          </>
        ) : (
          <p className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
            <span className="font-semibold text-slate-900 dark:text-slate-50">
              {purpose === 'provider_refill'
                ? `Top up ${PROVIDERS.find((p) => p.value === provider)?.label ?? ''}`
                : purpose === 'owner_drawing'
                  ? 'Take profit out'
                  : 'Pay back hand-sent refunds'}
            </span>
            <button type="button" onClick={startOver} className="text-xs font-semibold text-brand-700 dark:text-brand-300">
              Change
            </button>
          </p>
        )}

        {!choosing && (
          <>
        {repaying ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <p className="text-slate-600 dark:text-slate-300">
              Owed back for {owedBack.count} refund{owedBack.count === 1 ? '' : 's'} you sent from your own Mobile Money
            </p>
            <p className="tabular mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">{cedis(owedBack.total)}</p>
            {error && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{error}</p>}
          </div>
        ) : (
        <Field label="Amount (GHS)" htmlFor="treasury-amount" hint={
            max < data.minTransfer
              ? `Only ${cedis(Math.max(max, 0))} available, below Paystack's ${cedis(data.minTransfer)} minimum`
              : `Up to ${cedis(Math.max(max, 0))} right now`
          } error={error}>
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
        )}

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Send to which approved number?</p>
          <ChoiceList<string>
            selected={destinationId || null}
            choices={destinations.map((d) => ({ value: d.id, title: d.label, detail: `${d.phone} · ${d.network}` }))}
            onPick={setDestinationId}
          />
        </div>
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
          </>
        )}
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
          <div>
          <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Which Mobile Money network is this number on?</p>
          <ChoiceList<'MTN' | 'Telecel' | 'AirtelTigo'>
            selected={network}
            choices={[
              { value: 'MTN', title: 'MTN', detail: 'MTN Mobile Money' },
              { value: 'Telecel', title: 'Telecel', detail: 'Telecel Cash' },
              { value: 'AirtelTigo', title: 'AirtelTigo', detail: 'AirtelTigo Money' },
            ]}
            onPick={setNetwork}
          />
        </div>
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
  // Optional: empty means it was not read, and its records are left as they are.
  const [netpulse, setNetpulse] = useState('')
  const [capitalRepaid, setCapitalRepaid] = useState(false)
  const [readJustNow, setReadJustNow] = useState(false)
  const [note, setNote] = useState('')
  const [plan, setPlan] = useState<BalanceBooksPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const amounts = () => {
    const values = [parseCedis(paystack), parseCedis(datahub), parseCedis(gmpl)]
    if (netpulse.trim() && parseCedis(netpulse) === null) return null
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
        netpulse: netpulse.trim() ? (parseCedis(netpulse) ?? undefined) : undefined,
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
        tooltip="Use only when money moved without being logged. Sets the records to the real balances once, and keeps the adjustment on the record."
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
          <Field label="NetPulse float, real balance now (GHS)" htmlFor="bb-netpulse" hint="Leave empty if you didn't read it; its records stay as they are.">
            <TextInput id="bb-netpulse" inputMode="decimal" placeholder="100.00" value={netpulse} onChange={(e) => { setNetpulse(e.target.value); edited() }} />
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
  onBack,
  onDone,
}: {
  transfer: TreasuryOverview['transfers'][number] | null
  onClose: () => void
  onBack?: () => void
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
    <Modal open onClose={onClose} onBack={onBack} title={`Did not go · ${transfer.reference}`}>
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
