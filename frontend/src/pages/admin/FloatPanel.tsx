import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type SupplierFloat } from '../../lib/api'
import { useStore } from '../../state/store'
import { cedis, dateTime, parseCedis } from '../../lib/format'
import { Button, Callout, Card, CardHead, Field, Modal, Segmented, Spinner, TextInput, cn } from '../../components/ui'
import { AlertIcon, CheckIcon, RefreshIcon } from '../../components/icons'

type FloatLevel = 'ok' | 'watch' | 'risk'

/** Mirrors the backend's `levelFor` in float-monitor.service.ts, so a number colours the same way here as it does in an alert email. */
function levelFor(balance: number, watchAt: number, riskAt: number): FloatLevel {
  if (riskAt > 0 && balance <= riskAt) return 'risk'
  if (watchAt > 0 && balance <= watchAt) return 'watch'
  return 'ok'
}

function levelColor(level: FloatLevel): string {
  return level === 'risk'
    ? 'text-red-700 dark:text-red-400'
    : level === 'watch'
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-slate-900 dark:text-slate-50'
}

const PROVIDERS: { value: 'datahub-gh' | 'gmpl'; label: string }[] = [
  { value: 'datahub-gh', label: 'DataHub GH' },
  { value: 'gmpl', label: 'GMPL' },
]

/**
 * What is left in a supplier's float.
 *
 * The float is prepaid and it is the one balance that stops the product working:
 * empty, every order fails *after* the customer has paid, and each one comes
 * back through the refund queue by hand. DataHub and GMPL each have their own,
 * entirely separate real balance, so this panel shows exactly one at a time,
 * switched with the tabs below, never a blended figure.
 *
 * The awkward part is that DataHub does not publish a balance endpoint, so
 * its figure exists only in the reply to a purchase; it was being parsed and
 * thrown away, which is why the float was invisible until an order failed for
 * want of it. GMPL does publish one, so its "Check live" button asks directly
 * instead of waiting on the next sale. Either way the age of the reading is
 * shown as prominently as the reading itself: a number from last Tuesday
 * tells you almost nothing, and pretending otherwise would be worse than
 * showing nothing at all.
 */
export default function FloatPanel() {
  const [provider, setProvider] = useState<'datahub-gh' | 'gmpl'>('datahub-gh')
  const [float, setFloat] = useState<SupplierFloat | null>(null)
  const [error, setError] = useState('')
  const [logging, setLogging] = useState<'in' | 'out' | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [checkingLive, setCheckingLive] = useState(false)
  /**
   * Just a count here, never the entries themselves or a button to act on
   * them, that lives on its own page (`FloatCorrections`), off the main nav
   * and reachable only by a deliberate click, precisely so a top-up that was
   * actually Paystack money doesn't have a one-click action sitting in the
   * middle of a screen someone visits for other reasons.
   */
  const [needsReviewCount, setNeedsReviewCount] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    api
      .floatCapitalNeedingReview(provider)
      .then((rows) => live && setNeedsReviewCount(rows.length))
      .catch(() => live && setNeedsReviewCount(null))
    return () => {
      live = false
    }
  }, [provider])

  /**
   * What's actually free to move out of Paystack right now, fetched
   * alongside the float itself so `CapitalModal` can warn before a
   * reimbursement is logged for more than that, which would draw on money
   * still owed to agents or customers, not the business's own money to
   * move at all. Refreshed together with `float` below, not just once, a
   * stale reading here would wave through exactly the reimbursement this
   * exists to catch. Not provider-scoped itself, Paystack's balance is one
   * pot regardless of which float a reimbursement out of it lands in.
   */
  const [freeToSpend, setFreeToSpend] = useState<number | null>(null)
  const refreshFreeToSpend = () =>
    api
      .reservePosition()
      .then((position) => setFreeToSpend(position.freeToSpend))
      .catch(() => undefined)

  useEffect(() => {
    void refreshFreeToSpend()
  }, [])

  const refresh = () =>
    Promise.all([
      api
        .supplierFloat(provider)
        .then((result) => setFloat(result))
        .catch(
          (caught) =>
            setError(
              caught instanceof ApiError ? caught.message : 'We could not read the provider float.',
            ),
        ),
      refreshFreeToSpend(),
    ])

  /**
   * "Should hold" is never a stored figure, it is recomputed from every
   * capital move and every order ever charged, fresh on every request. So
   * there is nothing to "recalculate" on the backend; the only reason this
   * screen can look stale is that it fetched once on load and nothing since
   * has told it to ask again. This is that ask, on demand, without a reload.
   */
  const manualRefresh = async () => {
    setRefreshing(true)
    setError('')
    await refresh()
    setRefreshing(false)
  }

  /**
   * Unlike `manualRefresh` above (which only re-reads what we already have
   * stored), this asks the provider itself. Only GMPL answers, see
   * `api.refreshSupplierFloatLive`; the button that calls this is only shown
   * for GMPL.
   */
  const checkLiveBalance = async () => {
    setCheckingLive(true)
    setError('')
    try {
      const result = await api.refreshSupplierFloatLive(provider)
      setFloat(result)
      await refreshFreeToSpend()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not check the live balance.')
    } finally {
      setCheckingLive(false)
    }
  }

  useEffect(() => {
    let live = true
    setFloat(null)
    setError('')
    api
      .supplierFloat(provider)
      .then((result) => live && setFloat(result))
      .catch(
        (caught) =>
          live &&
          setError(
            caught instanceof ApiError ? caught.message : 'We could not read the provider float.',
          ),
      )
    return () => {
      live = false
    }
  }, [provider])

  const providerLabel = provider === 'gmpl' ? 'GMPL' : 'DataHub GH'
  const providerSwitcher = (
    <Segmented<'datahub-gh' | 'gmpl'> options={PROVIDERS} value={provider} onChange={setProvider} />
  )

  /**
   * `CapitalModal` is always rendered below, as a sibling to whichever
   * branch of this shows, not nested only inside the "loaded" one. Changing
   * the provider from inside the modal (see its own doc comment) resets
   * `float` to null while it refetches, and this component would otherwise
   * fall into the loading branch below and unmount the modal along with
   * whatever the admin had already typed into it.
   */
  let body: ReactNode

  if (error) {
    body = (
      <Card>
        <CardHead title="Provider float" />
        <div className="space-y-3 px-4 pb-4">
          {providerSwitcher}
          <Callout tone="warning" title="Could not read the float" icon={<AlertIcon className="size-4" />}>
            {error}
          </Callout>
        </div>
      </Card>
    )
  } else if (!float) {
    body = (
      <Card>
        <CardHead title="Provider float" />
        <div className="space-y-3 px-4 pb-4">
          {providerSwitcher}
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        </div>
      </Card>
    )
  } else {
    const { observation, watchAt, riskAt, capital, reconciliation } = float
    body = (
    <Card>
      <CardHead
        title="Provider float"
        subtitle={`What ${providerLabel} has left to buy bundles with`}
        action={
          <div className="flex gap-2">
            {provider === 'gmpl' && (
              <Button size="sm" variant="ghost" loading={checkingLive} onClick={() => void checkLiveBalance()}>
                <RefreshIcon className="size-4" /> Check live
              </Button>
            )}
            <Button size="sm" variant="ghost" loading={refreshing} onClick={() => void manualRefresh()}>
              <RefreshIcon className="size-4" /> Refresh
            </Button>
          </div>
        }
      />
      <div className="space-y-3 px-4 pb-4">
        {providerSwitcher}
        {observation === null ? (
          /* Honest empty state. Not "GHS 0.00", which would read as an emergency. */
          <Callout tone="info" title="Not known yet">
            {provider === 'gmpl'
              ? 'Nothing read yet. Check the live balance above, or place an order and it will show up automatically.'
              : `${providerLabel} does not publish a balance, so this only appears once an order has been sent, their reply is the only place the number exists.`}
          </Callout>
        ) : (
          <>
            {/* Side by side on purpose: two independent answers to "how much is
                left," each coloured on its own merits, so if they ever
                disagree, which one is actually the problem is visible at a
                glance instead of hidden behind whichever the alert picked. */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
                  Should hold
                </p>
                {reconciliation ? (
                  <p className={cn('tabular text-2xl font-bold sm:text-3xl', levelColor(levelFor(reconciliation.expected, watchAt, riskAt)))}>
                    {cedis(reconciliation.expected)}
                  </p>
                ) : (
                  <p className="text-sm text-slate-400 dark:text-slate-500">Not tracked yet</p>
                )}
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Every top-up and withdrawal you've logged, minus every order {providerLabel} has ever
                  charged you for
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
                  Live reading
                </p>
                <p className={cn('tabular text-2xl font-bold sm:text-3xl', levelColor(levelFor(observation.balance, watchAt, riskAt)))}>
                  {cedis(observation.balance)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  read {dateTime(observation.observedAt)}
                  {observation.orderRef ? ` · from ${observation.orderRef}` : provider === 'gmpl' ? ' · checked live' : ''}
                </p>
              </div>
            </div>

            {observation.level === 'risk' && (
              <Callout tone="danger" title="Top up now" icon={<AlertIcon className="size-4" />}>
                Below the {cedis(riskAt)} you asked to be warned at. When this runs out, customers
                are charged and get nothing, and every one of those has to be refunded by hand.
              </Callout>
            )}

            {observation.level === 'watch' && (
              <Callout tone="warning" title="Getting low" icon={<AlertIcon className="size-4" />}>
                Below the {cedis(watchAt)} you asked to be warned at. Still time to top up before
                anything fails.
              </Callout>
            )}

            {observation.level === 'ok' && watchAt > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckIcon className="size-3.5" />
                Above your {cedis(watchAt)} warning level.
              </p>
            )}
          </>
        )}

        {watchAt === 0 && riskAt === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No warning levels set, so nothing will email you when this runs low.{' '}
            <Link to="/admin/settings" className="font-semibold text-brand-700 dark:text-brand-300 hover:underline">
              Set them in Settings
            </Link>
            .
          </p>
        )}

        {reconciliation?.flagged && (
          <Callout tone="danger" title="Float is short" icon={<AlertIcon className="size-4" />}>
            Going by what you've logged and what orders have spent, the float should hold{' '}
            {cedis(reconciliation.expected)}, it actually holds {cedis(reconciliation.observed)},{' '}
            {cedis(reconciliation.shortfall)} short. This usually means a top-up or withdrawal
            happened without being logged below.
          </Callout>
        )}

        <div className="mt-1 rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-3">
          {capital.since === null ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Log your first top-up to start tracking your own capital separately from profit.
            </p>
          ) : (
            <>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Your own capital{' '}
                <span className="font-semibold text-slate-900 dark:text-slate-50">{cedis(capital.ownCapital)}</span>
                , taken out <span className="font-semibold text-slate-900 dark:text-slate-50">{cedis(capital.totalOut)}</span>,
                since {dateTime(capital.since)}.
              </p>
              {capital.overReimbursed > 0 && (
                <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                  {cedis(capital.overReimbursed)} has been paid in to {providerLabel} beyond what it was
                  actually owed for bundles bought so far. That extra is now float capital, not
                  profit free to withdraw at Paystack.
                </p>
              )}
              {reconciliation?.pending && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Logged, "Should hold" above will confirm against the live float
                  {provider === 'gmpl' ? ' once you check live again or the next order updates it.' : ' once the next order updates it.'}
                </p>
              )}
            </>
          )}
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setLogging('in')}>
              Log a top-up
            </Button>
            <Button size="sm" variant="outline" onClick={() => setLogging('out')}>
              Log money taken out
            </Button>
          </div>
        </div>

        {needsReviewCount !== null && needsReviewCount > 0 && (
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            {needsReviewCount} top-up{needsReviewCount === 1 ? '' : 's'} might actually be Paystack money.{' '}
            <Link
              to="/admin/finance/float-corrections"
              className="font-semibold text-brand-700 dark:text-brand-300 hover:underline"
            >
              Review and correct
            </Link>
          </p>
        )}
      </div>
    </Card>
    )
  }

  return (
    <>
      {body}
      <CapitalModal
        provider={provider}
        onProviderChange={setProvider}
        providerLabel={providerLabel}
        direction={logging}
        owedToProvider={float?.capital.owedToProvider ?? 0}
        freeToSpend={freeToSpend}
        onClose={() => setLogging(null)}
        onLogged={() => {
          setLogging(null)
          void refresh()
        }}
      />
    </>
  )
}

/**
 * James saying he moved his own money into or out of one provider's float,
 * either direction.
 *
 * The provider tab lives on the page behind this modal, easy to have never
 * touched if it was already open on the wrong one, or to forget mid-flow.
 * Repeating the choice here, as the first thing in the modal rather than
 * assumed from whatever tab happened to be active, is what actually prevents
 * a DataHub top-up being logged for GMPL by accident: changing it here
 * updates the same page-level tab (`onProviderChange`), so the two can never
 * disagree.
 */
function CapitalModal({
  provider,
  onProviderChange,
  providerLabel,
  direction,
  owedToProvider,
  freeToSpend,
  onClose,
  onLogged,
}: {
  provider: 'datahub-gh' | 'gmpl'
  onProviderChange: (provider: 'datahub-gh' | 'gmpl') => void
  providerLabel: string
  direction: 'in' | 'out' | null
  /** Pesewas this provider is currently owed for bundles that no reimbursement has covered yet. */
  owedToProvider: number
  /** Pesewas actually free to move out of Paystack right now, null while still loading. */
  freeToSpend: number | null
  onClose: () => void
  onLogged: () => void
}) {
  const { pushToast } = useStore()
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [source, setSource] = useState<'external' | 'reimbursement'>('external')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /**
   * Deliberately overpaying this provider with his own profit is allowed, unlike
   * reaching into money owed to someone else, but it should never happen
   * as a side effect of not reading the warning. Tied to `value` itself
   * (reset on every edit, see below), not just shown once, so it always
   * reflects the exact amount currently typed, not a stale confirmation of
   * a number he's since changed.
   */
  const [acknowledgedOverpay, setAcknowledgedOverpay] = useState(false)

  const [lastDirection, setLastDirection] = useState(direction)
  if (direction !== lastDirection) {
    setLastDirection(direction)
    setValue('')
    setNote('')
    setSource('external')
    setError('')
    setAcknowledgedOverpay(false)
  }

  if (!direction) return null

  const enteredAmount = parseCedis(value)
  const isReimbursement = direction === 'in' && source === 'reimbursement' && enteredAmount !== null

  /**
   * Reimbursing moves money straight out of Paystack, the same balance
   * agent earnings, customer wallets and pending refunds are sitting in
   * too. Up to what's owed to this provider is always fine (a real,
   * necessary cost), and beyond that, up to whatever's actually free, is
   * still his to choose (it just becomes capital early, see `overpayBy`).
   * Only past *both* combined is it somebody else's money, matching the
   * backend's own hard limit in `FloatMonitorService.logCapital`, not a
   * separate, stricter line drawn here. Checked ahead of `overpayBy` below
   * and shown instead of it when both would fire, drawing on money owed to
   * someone else is the more serious of the two problems.
   */
  const availableToReimburse = owedToProvider + Math.max(freeToSpend ?? 0, 0)
  const touchesOwedMoney =
    isReimbursement && freeToSpend !== null && enteredAmount! > availableToReimburse
      ? enteredAmount! - availableToReimburse
      : 0

  const overpayBy =
    !touchesOwedMoney && isReimbursement && enteredAmount! > owedToProvider
      ? enteredAmount! - owedToProvider
      : 0

  const submit = async () => {
    const amount = parseCedis(value)
    if (amount === null || amount <= 0) {
      setError('Enter an amount like 500 or 500.00.')
      return
    }
    setBusy(true)
    try {
      await api.logFloatCapital(provider, direction, amount, note.trim() || undefined, source)
      pushToast({
        tone: 'info',
        title: direction === 'in' ? `Logged ${cedis(amount)} in` : `Logged ${cedis(amount)} out`,
      })
      onLogged()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${direction === 'in' ? 'Log a top-up' : 'Log money taken out'} — ${providerLabel}`}
    >
      <div className="space-y-4">
        {/* Repeated here, not just implied by whatever tab was open behind
            this modal: the one choice that determines everything else on
            this form, so it comes first, and changing it updates the same
            tab, never a second, disagreeing idea of which float this is. */}
        <div className="rounded-xl border-2 border-brand-200 bg-brand-50 p-3 dark:border-brand-800 dark:bg-brand-950/40">
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-brand-800 uppercase dark:text-brand-200">
            Which float is this for?
          </p>
          <Segmented<'datahub-gh' | 'gmpl'>
            className="w-full"
            options={PROVIDERS}
            value={provider}
            onChange={onProviderChange}
          />
        </div>

        <Callout tone="info" icon={<AlertIcon className="size-4" />}>
          This tracks your own capital, it never counts as revenue or cost, and does not change
          the profit figures anywhere else.
        </Callout>

        {direction === 'in' && (
          <Field label="Where did this come from?" htmlFor="capital-source">
            <Segmented<'external' | 'reimbursement'>
              className="w-full"
              options={[
                { value: 'external', label: 'Outside the business' },
                { value: 'reimbursement', label: `Paystack, paying ${providerLabel} back` },
              ]}
              value={source}
              onChange={setSource}
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {source === 'reimbursement'
                ? `Money already collected from customers for what ${providerLabel} charges, you're moving it from Paystack to where it was always meant to end up, not adding new capital. This is the only kind of top-up that clears "Already spent on bundles" on the Reserve panel.`
                : 'Fresh money, from somewhere other than what this business itself has collected.'}
            </p>
          </Field>
        )}

        {touchesOwedMoney > 0 && (
          <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
            Only {cedis(availableToReimburse)} can be reimbursed right now, what's owed to {providerLabel}
            plus what's actually free to spend. This amount reaches {cedis(touchesOwedMoney)} into
            money still owed to agents, customers, or a pending order, not the business's spare
            money, so this can't be logged as it stands.
          </Callout>
        )}

        {overpayBy > 0 && (
          <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
            <p>
              {providerLabel} is currently owed {cedis(owedToProvider)} for bundles bought so far, this is{' '}
              {cedis(overpayBy)} more than that. That extra is your profit entering the float as
              capital, not {providerLabel} cost, it stops being free to spend at Paystack the moment this
              logs.
            </p>
            <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 rounded border-slate-300 dark:border-slate-600"
                checked={acknowledgedOverpay}
                onChange={(event) => setAcknowledgedOverpay(event.target.checked)}
              />
              I understand {cedis(overpayBy)} of my profit is moving into {providerLabel} as capital, and
              want to log it anyway
            </label>
          </Callout>
        )}

        <Field label="Amount (GHS)" htmlFor="capital-amount" error={error}>
          <TextInput
            id="capital-amount"
            placeholder="500.00"
            value={value}
            invalid={Boolean(error)}
            onChange={(event) => {
              setValue(event.target.value)
              setError('')
              setAcknowledgedOverpay(false)
            }}
          />
        </Field>

        <Field label="Note (optional)" htmlFor="capital-note">
          <TextInput
            id="capital-note"
            placeholder="Top-up via MoMo"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>

        <div className="flex gap-2">
          <Button
            block
            loading={busy}
            disabled={touchesOwedMoney > 0 || (overpayBy > 0 && !acknowledgedOverpay)}
            onClick={() => void submit()}
          >
            {direction === 'in' ? 'Log top-up' : 'Log withdrawal'}
          </Button>
          <Button block variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
