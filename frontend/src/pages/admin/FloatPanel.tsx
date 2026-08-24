import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type SupplierFloat } from '../../lib/api'
import { cedis, dateTime } from '../../lib/format'
import { Callout, Card, CardHead, Spinner, cn } from '../../components/ui'
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

  const { observation, watchAt, riskAt } = float

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
                    ? 'text-red-700'
                    : observation.level === 'watch'
                      ? 'text-amber-700'
                      : 'text-slate-900',
                )}
              >
                {cedis(observation.balance)}
              </p>
              <p className="text-xs text-slate-500">
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
              </Callout>
            )}

            {observation.level === 'ok' && watchAt > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                <CheckIcon className="size-3.5" />
                Above your {cedis(watchAt)} warning level.
              </p>
            )}
          </>
        )}

        {watchAt === 0 && riskAt === 0 && (
          <p className="text-xs text-slate-500">
            No warning levels set, so nothing will email you when this runs low.{' '}
            <Link to="/admin/settings" className="font-semibold text-brand-700 hover:underline">
              Set them in Settings
            </Link>
            .
          </p>
        )}
      </div>
    </Card>
  )
}
