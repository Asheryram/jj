import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type SupplierFloat } from '../../lib/api'
import { useStore } from '../../state/store'
import { cedis, dateTime, parseCedis } from '../../lib/format'
import { Button, Callout, Card, CardHead, Field, Modal, Spinner, TextInput, cn } from '../../components/ui'
import { AlertIcon, CheckIcon } from '../../components/icons'

/**
 * What is left in the DataHub float.
 *
 * The float is prepaid and it is the one balance that stops the product working:
 * empty, every order fails *after* the customer has paid, and each one comes
 * back through the refund queue by hand.
 *
 * The awkward part is that DataHub publishes no balance endpoint, so this figure
 * exists only in the reply to a purchase. It was being parsed and thrown away,
 * which is why the float was invisible until an order failed for want of it. So
 * the age of the reading is shown as prominently as the reading: a number from
 * last Tuesday tells you almost nothing, and pretending otherwise would be worse
 * than showing nothing at all.
 */
export default function FloatPanel() {
  const [float, setFloat] = useState<SupplierFloat | null>(null)
  const [error, setError] = useState('')
  const [logging, setLogging] = useState<'in' | 'out' | null>(null)

  const refresh = () =>
    api
      .supplierFloat()
      .then((result) => setFloat(result))
      .catch(
        (caught) =>
          setError(
            caught instanceof ApiError ? caught.message : 'We could not read the provider float.',
          ),
      )

  useEffect(() => {
    let live = true
    api
      .supplierFloat()
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
  }, [])

  if (error) {
    return (
      <Card>
        <CardHead title="Provider float" />
        <div className="px-4 pb-4">
          <Callout tone="warning" title="Could not read the float" icon={<AlertIcon className="size-4" />}>
            {error}
          </Callout>
        </div>
      </Card>
    )
  }

  if (!float) {
    return (
      <Card>
        <CardHead title="Provider float" />
        <div className="flex justify-center px-4 py-8">
          <Spinner />
        </div>
      </Card>
    )
  }

  const { observation, watchAt, riskAt, capital, reconciliation } = float

  return (
    <Card>
      <CardHead
        title="Provider float"
        subtitle="What DataHub GH has left to buy bundles with"
      />
      <div className="space-y-3 px-4 pb-4">
        {observation === null ? (
          /* Honest empty state. Not "GHS 0.00", which would read as an emergency. */
          <Callout tone="info" title="Not known yet">
            DataHub does not publish a balance, so this only appears once an order has been sent —
            their reply is the only place the number exists.
          </Callout>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <p
                className={cn(
                  'tabular text-3xl font-bold',
                  observation.level === 'risk'
                    ? 'text-red-700 dark:text-red-400'
                    : observation.level === 'watch'
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-slate-900 dark:text-slate-50',
                )}
              >
                {cedis(observation.balance)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                read {dateTime(observation.observedAt)}
                {observation.orderRef ? ` · from ${observation.orderRef}` : ''}
              </p>
            </div>

            {observation.level === 'risk' && (
              <Callout
                tone="danger"
                title="Top up now"
                icon={<AlertIcon className="size-4" />}
              >
                Below the {cedis(riskAt)} you asked to be warned at. When this runs out, customers
                are charged and get nothing, and every one of those has to be refunded by hand.
                {observation.reference < observation.balance && (
                  <>
                    {' '}
                    DataHub itself still reports {cedis(observation.balance)} — this is based on
                    your tracked capital instead, which is lower and hasn't been confirmed by a
                    fresh order yet.
                  </>
                )}
              </Callout>
            )}

            {observation.level === 'watch' && (
              <Callout
                tone="warning"
                title="Getting low"
                icon={<AlertIcon className="size-4" />}
              >
                Below the {cedis(watchAt)} you asked to be warned at. Still time to top up before
                anything fails.
                {observation.reference < observation.balance && (
                  <>
                    {' '}
                    DataHub itself still reports {cedis(observation.balance)} — this is based on
                    your tracked capital instead, which is lower and hasn't been confirmed by a
                    fresh order yet.
                  </>
                )}
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
            {cedis(reconciliation.expected)} — it actually holds {cedis(reconciliation.observed)},{' '}
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
                You've put in <span className="font-semibold text-slate-900 dark:text-slate-50">{cedis(capital.totalIn)}</span>
                , taken out <span className="font-semibold text-slate-900 dark:text-slate-50">{cedis(capital.totalOut)}</span> —{' '}
                <span className="font-semibold text-slate-900 dark:text-slate-50">{cedis(capital.net)}</span> net, since{' '}
                {dateTime(capital.since)}.
              </p>
              {reconciliation?.pending && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Logged — this will check against the float once the next order updates it.
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
      </div>

      <CapitalModal
        direction={logging}
        onClose={() => setLogging(null)}
        onLogged={() => {
          setLogging(null)
          void refresh()
        }}
      />
    </Card>
  )
}

/** James saying he moved his own money into or out of the float — either direction. */
function CapitalModal({
  direction,
  onClose,
  onLogged,
}: {
  direction: 'in' | 'out' | null
  onClose: () => void
  onLogged: () => void
}) {
  const { pushToast } = useStore()
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [lastDirection, setLastDirection] = useState(direction)
  if (direction !== lastDirection) {
    setLastDirection(direction)
    setValue('')
    setNote('')
    setError('')
  }

  if (!direction) return null

  const submit = async () => {
    const amount = parseCedis(value)
    if (amount === null || amount <= 0) {
      setError('Enter an amount like 500 or 500.00.')
      return
    }
    setBusy(true)
    try {
      await api.logFloatCapital(direction, amount, note.trim() || undefined)
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
      title={direction === 'in' ? 'Log a top-up' : 'Log money taken out'}
    >
      <div className="space-y-4">
        <Callout tone="info" icon={<AlertIcon className="size-4" />}>
          This tracks your own capital — it never counts as revenue or cost, and does not change
          the profit figures anywhere else.
        </Callout>

        <Field label="Amount (GHS)" htmlFor="capital-amount" error={error}>
          <TextInput
            id="capital-amount"
            placeholder="500.00"
            value={value}
            invalid={Boolean(error)}
            onChange={(event) => {
              setValue(event.target.value)
              setError('')
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
          <Button block loading={busy} onClick={() => void submit()}>
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
