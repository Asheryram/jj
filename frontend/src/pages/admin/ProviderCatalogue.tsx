import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, type SupplierSku } from '../../lib/api'
import { useStore } from '../../state/store'
import { cedis } from '../../lib/format'
import type { Category } from '../../data/types'
import { CATEGORY_META, CATEGORY_ORDER } from '../../components/categories'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  EmptyState,
  Field,
  Modal,
  NetworkChip,
  Segmented,
  Spinner,
  TableWrap,
  Td,
  TextInput,
  Th,
  cn,
} from '../../components/ui'
import { AlertIcon, RefreshIcon } from '../../components/icons'

/**
 * What our suppliers sell, as they report it.
 *
 * Read-only, all of it, and that is the design rather than an omission. This
 * screen used to let James type a cost and flip an in-stock switch, and both
 * were ways for the platform to assert something the supplier had not:
 *
 *  · A typed cost drifts from the invoice. Every margin on every screen is
 *    measured from `supplier_cost`, so a number nobody was charged quietly
 *    misstates the whole business.
 *  · A hand-set stock flag can say a SKU is available after the supplier has
 *    withdrawn it — which sells a customer something that cannot be delivered.
 *
 * It began as seed data: 36 invented SKUs with invented costs, of which DataHub
 * really sells none. Sync is the only way anything here changes now.
 *
 * A newly imported SKU arrives priced at cost and NOT on sale. A default markup
 * would put a number we made up in front of customers as James's price, so he
 * sets one — here for everything waiting, or per product on the Prices page.
 */
export default function ProviderCatalogue() {
  const { refresh, pushToast, products } = useStore()
  const [skus, setSkus] = useState<SupplierSku[] | null>(null)
  const [category, setCategory] = useState<Category>('data')
  const [publishing, setPublishing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setSkus(await api.supplierCatalogue())
      setError('')
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'We could not load the supplier catalogue.',
      )
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const all = skus ?? []
  const categories = useMemo(
    () => CATEGORY_ORDER.filter((key) => all.some((sku) => sku.category === key)),
    [all],
  )
  const shown = categories.includes(category) ? category : (categories[0] ?? 'data')
  const visible = all.filter((sku) => sku.category === shown)

  const outOfStock = all.filter((sku) => !sku.available)
  const unfulfillable = all.filter((sku) => !sku.autoFulfillable)
  // Imported from a supplier and still waiting for a price: they sit at cost and
  // inactive until James says what they sell for.
  const unpriced = products.filter((p) => !p.active && p.supplierCost === p.adminPrice)

  const sync = async () => {
    setSyncing(true)
    try {
      const result = await api.syncSuppliers()
      await load()
      await refresh()

      const failed = result.sources.filter((source) => source.error)
      if (failed.length > 0) {
        pushToast({
          tone: 'error',
          title: `${failed.map((f) => f.label).join(', ')} could not be reached`,
          detail: `${failed[0].error} Nothing from them was changed.`,
        })
      }

      const parts = [
        result.created > 0 && `${result.created} new`,
        result.repriced > 0 && `${result.repriced} repriced`,
        result.withdrawn > 0 && `${result.withdrawn} withdrawn`,
      ].filter(Boolean)

      const ok = result.sources.filter((source) => !source.error)
      if (ok.length > 0) {
        pushToast({
          tone: 'success',
          title: `Read ${ok.map((source) => source.label).join(', ')}`,
          detail:
            parts.length > 0
              ? `${parts.join(', ')}.${result.unpriced > 0 ? ` ${result.unpriced} need a price before they go on sale.` : ''}`
              : 'Their catalogue matches yours already.',
        })
      }
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not reach the suppliers.',
      })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Card className="mt-3">
      <CardHead
        title="Supplier catalogue"
        subtitle="What each supplier sells, what they charge you, and what they have in stock. All of it theirs to report."
        action={
          <Button size="sm" variant="outline" loading={syncing} onClick={() => void sync()}>
            <RefreshIcon className="size-4" /> Sync
          </Button>
        }
      />

      <div className="space-y-3 p-4 sm:p-5">
        {error && (
          <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
            {error}
          </Callout>
        )}

        {skus === null ? (
          <div className="py-8 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            detail="Press Sync to read what your suppliers currently sell. Until then there is no catalogue — nothing is invented on your behalf."
            action={
              <Button loading={syncing} onClick={() => void sync()}>
                <RefreshIcon className="size-4" /> Sync now
              </Button>
            }
          />
        ) : (
          <>
            {unpriced.length > 0 && (
              <Callout
                tone="info"
                title={`${unpriced.length} product${unpriced.length === 1 ? '' : 's'} are not on sale yet`}
                icon={<AlertIcon className="size-4" />}
              >
                <p>
                  They arrived with the supplier's real cost and no price, because what they sell
                  for is your decision, not ours. Two ways to put them on sale, and neither is a
                  prerequisite for the other: one markup across all of them, or type the actual
                  prices product by product.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-3">
                  <Button size="sm" onClick={() => setPublishing(true)}>
                    Set a markup and publish
                  </Button>
                  <Link
                    to="/admin/prices"
                    className="text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline"
                  >
                    Or price them individually
                  </Link>
                </div>
              </Callout>
            )}

            {unfulfillable.length > 0 && (
              <Callout
                tone="warning"
                title={`${unfulfillable.length} cannot be delivered automatically`}
                icon={<AlertIcon className="size-4" />}
              >
                Anything marked <strong className="font-semibold">manual only</strong> has no
                automated fulfilment path, so it is refused at checkout rather than sold and left
                undeliverable.
              </Callout>
            )}

            {outOfStock.length > 0 && (
              <Callout
                tone="warning"
                title={`${outOfStock.length} out of stock at the supplier`}
                icon={<AlertIcon className="size-4" />}
              >
                {outOfStock
                  .slice(0, 6)
                  .map((sku) => sku.name)
                  .join(', ')}
                {outOfStock.length > 6 && ` and ${outOfStock.length - 6} more`} — withdrawn from
                sale until the supplier lists them again.
              </Callout>
            )}

            {categories.length > 1 && (
              // -mx-3/px-3 cancels AppShell's own px-3 on mobile — not px-4,
              // which overshoots the viewport by the 4px difference.
              <div className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
                <Segmented<Category>
                  options={categories.map((key) => ({
                    value: key,
                    label: CATEGORY_META[key].short,
                  }))}
                  value={shown}
                  onChange={setCategory}
                />
              </div>
            )}

            <TableWrap caption="Supplier SKUs, their cost and their stock">
              <thead>
                <tr>
                  <Th>SKU</Th>
                  <Th>Product</Th>
                  <Th align="right">You pay</Th>
                  <Th align="right">Stock</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((sku) => (
                  <tr
                    key={sku.code}
                    className={cn('hover:bg-slate-50 dark:hover:bg-slate-800', !sku.available && 'bg-amber-50/60')}
                  >
                    <Td>
                      <p className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">{sku.code}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sku.provider}</p>
                    </Td>
                    <Td>
                      <p className="font-medium text-slate-900 dark:text-slate-50">{sku.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <NetworkChip network={sku.network} />
                        {sku.mappedTo.length === 0 && <Badge tone="warning">not mapped</Badge>}
                        {sku.autoFulfillable ? (
                          <Badge tone="neutral">
                            {sku.networkKey} · {sku.capacityGb}GB
                          </Badge>
                        ) : (
                          <Badge tone="warning">manual only</Badge>
                        )}
                      </div>
                    </Td>
                    <Td align="right" className="tabular font-bold text-slate-900 dark:text-slate-50">
                      {cedis(sku.costPrice)}
                    </Td>
                    <Td align="right">
                      {/* The supplier's answer, not a switch. Nothing on this
                          screen can make a withdrawn SKU look available. */}
                      <Badge tone={sku.available ? 'success' : 'warning'}>
                        {sku.available ? 'In stock' : 'Out of stock'}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </>
        )}
      </div>

      <PublishModal
        open={publishing}
        count={unpriced.length}
        onClose={() => setPublishing(false)}
        onPublished={async () => {
          await load()
          await refresh()
        }}
      />
    </Card>
  )
}

/**
 * One markup across everything still waiting for a price.
 *
 * Two numbers rather than one, because they answer different questions — what an
 * agent buys at, and what a stranger pays at the counter — and James may set the
 * walk-up one lower if he would rather earn from agent volume than his own
 * counter.
 */
function PublishModal({
  open,
  count,
  onClose,
  onPublished,
}: {
  open: boolean
  count: number
  onClose: () => void
  onPublished: () => Promise<void>
}) {
  const { pushToast } = useStore()
  const [agent, setAgent] = useState('15')
  const [walkup, setWalkup] = useState('25')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const submit = async () => {
    const agentPercent = Number(agent)
    const walkupPercent = Number(walkup)
    if (
      !Number.isFinite(agentPercent) ||
      !Number.isFinite(walkupPercent) ||
      agentPercent < 0 ||
      walkupPercent < 0
    ) {
      setError('Enter percentages like 15 and 25.')
      return
    }

    setBusy(true)
    try {
      const { updated } = await api.applyMarkup({
        agentPercent,
        walkupPercent,
        scope: 'unpriced',
      })
      await onPublished()
      pushToast({
        tone: 'success',
        title: `${updated} product${updated === 1 ? '' : 's'} now on sale`,
        detail: `Agents pay cost + ${agent}%, walk-up customers cost + ${walkup}%.`,
      })
      onClose()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not publish those.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Put ${count} product${count === 1 ? '' : 's'} on sale`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Agents pay cost +" htmlFor="agent-markup">
            <div className="relative">
              <TextInput
                id="agent-markup"
                inputMode="decimal"
                className="pr-9 font-bold"
                value={agent}
                onChange={(event) => {
                  setAgent(event.target.value)
                  setError('')
                }}
              />
              <span className="absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                %
              </span>
            </div>
          </Field>

          <Field label="Walk-up pays cost +" htmlFor="walkup-markup">
            <div className="relative">
              <TextInput
                id="walkup-markup"
                inputMode="decimal"
                className="pr-9 font-bold"
                invalid={Boolean(error)}
                value={walkup}
                onChange={(event) => {
                  setWalkup(event.target.value)
                  setError('')
                }}
              />
              <span className="absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                %
              </span>
            </div>
          </Field>
        </div>

        {error && <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}

        <Callout tone="info" icon={<AlertIcon className="size-4" />}>
          The markup is remembered, so when a supplier changes what something costs these prices move
          with it and your margin holds. Only products with no price yet are touched.
        </Callout>

        <div className="flex gap-2">
          <Button block loading={busy} onClick={() => void submit()}>
            Put on sale
          </Button>
          <Button block variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
