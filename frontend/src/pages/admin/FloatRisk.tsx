import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { api } from '../../lib/api'
import { cedis, dateTime } from '../../lib/format'
import {
  Button,
  Callout,
  Card,
  CardHead,
  EmptyState,
  NetworkChip,
  PageHead,
  Spinner,
  TableWrap,
  Td,
  Th,
} from '../../components/ui'
import { CheckIcon } from '../../components/icons'

/**
 * Two related questions, one page: which products on sale right now cost more
 * than the float can currently cover, and what's sitting inactive that might
 * be worth a second look.
 *
 * A suggestion, not a queue — nothing here ever flips a product's `active`
 * flag on its own. Turning one off or back on is still the same deliberate
 * click it always was (see Cost prices); this page just puts the right
 * products in front of that click at the right moment.
 *
 * The inactive list makes no claim about *why* each product is off — nothing
 * today records that, so a product turned off for an unrelated reason
 * (discontinued, mismapped, never priced) sits here too. It's context to
 * weigh against the float, not a promise that any given row is safe to
 * reactivate.
 */
export default function FloatRisk() {
  const { setProductOnSale } = useStore()
  const [data, setData] = useState<Awaited<ReturnType<typeof api.floatRisk>> | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = () => {
    api
      .floatRisk()
      .then(setData)
      .catch(() => setData({ floatReference: null, observedAt: null, atRisk: [], inactive: [] }))
  }

  useEffect(load, [])

  const toggle = async (id: string, active: boolean) => {
    setBusyId(id)
    try {
      await setProductOnSale(id, active)
      load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <PageHead
        title="Float risk"
        subtitle="Products priced above what DataHub's float can currently cover, and what's sitting inactive alongside it."
      />

      <Card className="mt-3">
        <CardHead title="What the float can cover right now" />
        <div className="px-4 pb-4 sm:px-5">
          {data === null ? (
            <div className="py-4 text-center">
              <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
            </div>
          ) : data.floatReference === null ? (
            <Callout tone="info" title="Nothing logged yet">
              This is judged against your tracked capital — once you've logged at least one top-up on
              the Float panel, this page can compare it against your catalogue.
            </Callout>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Judged against <strong className="tabular font-semibold">{cedis(data.floatReference)}</strong>
              {' '}— what your logged top-ups and costs say the float should hold right now
              {data.trackedSince && <>, tracked since {dateTime(data.trackedSince)}</>}. Deliberately not
              the live reading from DataHub, which only refreshes on an order and can sit stale for
              days — this instead moves the moment you log a top-up or a sale books its real cost.
            </p>
          )}
        </div>
      </Card>

      <Card className="mt-3">
        <CardHead
          title="Priced above the float"
          subtitle="On sale right now, but costs more than the float can currently cover — an order is likely to fail"
        />
        {data === null ? (
          <div className="py-8 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        ) : data.atRisk.length === 0 ? (
          <EmptyState
            icon={<CheckIcon className="size-6" />}
            title="Nothing at risk right now"
            detail="Every product on sale costs less than what the float can currently cover."
          />
        ) : (
          <TableWrap caption="Products priced above the current float">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th align="right">Cost</Th>
                <Th align="center">Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.atRisk.map((product) => (
                <tr key={product.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <NetworkChip network={product.network} />
                      <span className="font-medium text-slate-900 dark:text-slate-50">{product.name}</span>
                    </div>
                  </Td>
                  <Td align="right" className="tabular font-semibold text-red-700 dark:text-red-400">
                    {cedis(product.supplierCost)}
                  </Td>
                  <Td align="center">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busyId === product.id}
                      title="Take it off sale"
                      onClick={() => void toggle(product.id, false)}
                    >
                      Turn off
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <p className="p-4 pt-0 text-xs text-slate-500 dark:text-slate-400 sm:px-5">
          Turning one off here is exactly the same switch as on Cost prices — it stops showing to
          customers immediately, and nothing stops you turning it back on the moment the float
          recovers.
        </p>
      </Card>

      <Card className="mt-3">
        <CardHead title="Currently inactive" subtitle="Every product not on sale right now, whatever the reason" />
        {data === null ? (
          <div className="py-8 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        ) : data.inactive.length === 0 ? (
          <EmptyState
            icon={<CheckIcon className="size-6" />}
            title="Nothing inactive"
            detail="Every product in the catalogue is currently on sale."
          />
        ) : (
          <TableWrap caption="Inactive products, cost shown next to the current float">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th align="right">Cost</Th>
                <Th align="center">Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.inactive.map((product) => {
                const flatOrLoss =
                  product.adminPrice <= product.supplierCost || product.standardPrice <= product.supplierCost
                return (
                  <tr key={product.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <NetworkChip network={product.network} />
                        <span className="font-medium text-slate-900 dark:text-slate-50">{product.name}</span>
                      </div>
                    </Td>
                    <Td
                      align="right"
                      className={`tabular font-semibold ${
                        data.floatReference !== null && product.supplierCost > data.floatReference
                          ? 'text-red-700 dark:text-red-400'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {cedis(product.supplierCost)}
                    </Td>
                    <Td align="center">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={flatOrLoss}
                        loading={busyId === product.id}
                        title={
                          flatOrLoss
                            ? 'Priced at or below cost — set a price above cost on Cost prices first.'
                            : 'Put it back on sale'
                        }
                        onClick={() => void toggle(product.id, true)}
                      >
                        Turn on
                      </Button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
        )}
        <p className="p-4 pt-0 text-xs text-slate-500 dark:text-slate-400 sm:px-5">
          This list doesn't try to guess why a product is off — some never had a real price set, some
          were discontinued on purpose. It's here so you can weigh each one against the float yourself,
          not a claim that any particular row is safe to turn back on.
        </p>
      </Card>
    </div>
  )
}
