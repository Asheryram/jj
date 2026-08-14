import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, type SupplierSku } from '../../lib/api'
import { useStore } from '../../state/store'
import { cedis, parseCedis } from '../../lib/format'
import type { Category } from '../../data/types'
import { CATEGORY_META, CATEGORY_ORDER } from '../../components/categories'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  Field,
  Modal,
  NetworkChip,
  Segmented,
  Spinner,
  TableWrap,
  Td,
  TextInput,
  Th,
  Toggle,
  cn,
} from '../../components/ui'
import { AlertIcon, RefreshIcon } from '../../components/icons'

/**
 * The provider's own catalogue — DataHub GH for airtime and bundles, the voucher
 * wholesaler for result checkers.
 *
 * This exists because "what you pay" is not James's number to invent. It is what
 * he is invoiced, and it is the baseline every margin in the platform is measured
 * from, so it lives on the provider's record and flows down to our products. The
 * Prices page shows it read-only for exactly that reason.
 *
 * Once real API keys are configured this screen becomes a read-only view of the
 * provider's price list, and the editing here goes away.
 */
export default function ProviderCatalogue() {
  const { refresh, pushToast } = useStore()
  const [skus, setSkus] = useState<SupplierSku[] | null>(null)
  const [category, setCategory] = useState<Category>('data')
  const [editing, setEditing] = useState<SupplierSku | null>(null)
  const [busyCode, setBusyCode] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setSkus(await api.supplierCatalogue())
      setError('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not load the provider catalogue.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(
    () => (skus ?? []).filter((s) => s.category === category),
    [skus, category],
  )
  const unavailable = (skus ?? []).filter((s) => !s.available)

  const setAvailability = async (sku: SupplierSku, available: boolean) => {
    setBusyCode(sku.code)
    try {
      await api.setSupplierAvailability(sku.code, available)
      setSkus((current) =>
        (current ?? []).map((s) => (s.code === sku.code ? { ...s, available } : s)),
      )
      pushToast({
        tone: available ? 'success' : 'info',
        title: available ? `${sku.name} back in stock` : `${sku.name} marked out of stock`,
        detail: available
          ? 'Orders for it will be fulfilled again.'
          : 'Orders for it will fail at the provider and be refunded.',
      })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not change that.',
      })
    } finally {
      setBusyCode(null)
    }
  }

  const saveCost = async (sku: SupplierSku, costPrice: number) => {
    const result = await api.setSupplierCost(sku.code, costPrice)
    setSkus((current) =>
      (current ?? []).map((s) => (s.code === sku.code ? { ...s, costPrice } : s)),
    )
    // Product tiers may have been lifted to stay above the new cost, so re-read
    // the catalogue rather than leaving the Prices page showing the old floor.
    await refresh()
    pushToast({
      tone: 'success',
      title: 'Provider cost updated',
      detail:
        result.productsUpdated > 0
          ? `${result.productsUpdated} product${result.productsUpdated === 1 ? '' : 's'} repriced from it.`
          : 'No product prices needed changing.',
    })
  }

  const sync = async () => {
    setBusyCode('__sync__')
    try {
      const { updated } = await api.syncSupplierCosts()
      await refresh()
      pushToast({
        tone: 'success',
        title: 'Synced from the provider',
        detail:
          updated > 0
            ? `${updated} product cost${updated === 1 ? '' : 's'} updated.`
            : 'Everything was already up to date.',
      })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not sync.',
      })
    } finally {
      setBusyCode(null)
    }
  }

  return (
    <Card className="mt-3">
      <CardHead
        title="Provider catalogue"
        subtitle="What DataHub GH and the voucher wholesaler charge you, and what they have in stock."
        action={
          <Button size="sm" variant="outline" loading={busyCode === '__sync__'} onClick={() => void sync()}>
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

        <Callout tone="info" icon={<AlertIcon className="size-4" />}>
          This is the only place <strong className="font-semibold">what you pay</strong> can change.
          Every margin in the platform is measured from it, so it belongs to the provider's record —
          not to the Prices page, where it is shown read-only.
        </Callout>

        {unavailable.length > 0 && (
          <Callout
            tone="warning"
            title={`${unavailable.length} SKU${unavailable.length === 1 ? '' : 's'} out of stock`}
            icon={<AlertIcon className="size-4" />}
          >
            Orders for {unavailable.map((s) => s.name).join(', ')} will fail at the provider and be
            refunded automatically.
          </Callout>
        )}

        {skus === null ? (
          <div className="py-8 text-center">
            <Spinner className="mx-auto size-6 text-brand-600" />
          </div>
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              <Segmented<Category>
                options={CATEGORY_ORDER.map((key) => ({
                  value: key,
                  label: CATEGORY_META[key].short,
                }))}
                value={category}
                onChange={setCategory}
              />
            </div>

            <TableWrap caption="Provider SKUs and their cost">
              <thead>
                <tr>
                  <Th>SKU</Th>
                  <Th>Product</Th>
                  <Th align="right">You pay</Th>
                  <Th align="right">In stock</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {visible.map((sku) => (
                  <tr
                    key={sku.code}
                    className={cn('hover:bg-slate-50', !sku.available && 'bg-amber-50/60')}
                  >
                    <Td>
                      <p className="font-mono text-xs font-semibold text-slate-700">{sku.code}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{sku.provider}</p>
                    </Td>
                    <Td>
                      <p className="font-medium text-slate-900">{sku.name}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <NetworkChip network={sku.network} />
                        {sku.mappedTo.length === 0 && <Badge tone="warning">not mapped</Badge>}
                      </div>
                    </Td>
                    <Td align="right" className="tabular font-bold text-slate-900">
                      {cedis(sku.costPrice)}
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end">
                        <Toggle
                          id={`stock-${sku.code}`}
                          // The switch has no visible text of its own, so the
                          // accessible name has to say which SKU it controls.
                          label={`${sku.name} in stock at ${sku.provider}`}
                          checked={sku.available}
                          onChange={(next) => void setAvailability(sku, next)}
                        />
                      </div>
                    </Td>
                    <Td align="right">
                      <Button size="sm" variant="outline" onClick={() => setEditing(sku)}>
                        Edit cost
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </>
        )}
      </div>

      <EditCostModal sku={editing} onClose={() => setEditing(null)} onSave={saveCost} />
    </Card>
  )
}

function EditCostModal({
  sku,
  onClose,
  onSave,
}: {
  sku: SupplierSku | null
  onClose: () => void
  onSave: (sku: SupplierSku, costPrice: number) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const key = sku?.code ?? 'none'
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setValue(sku ? (sku.costPrice / 100).toFixed(2) : '')
    setError('')
  }

  if (!sku) return null

  const submit = async () => {
    const parsed = parseCedis(value)
    if (parsed === null || parsed <= 0) {
      setError('Enter what the provider charges you, like 5.50.')
      return
    }

    setBusy(true)
    try {
      await onSave(sku, parsed)
      onClose()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Provider cost — ${sku.name}`}>
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm">
          <p className="font-mono text-xs font-semibold text-slate-700">{sku.code}</p>
          <p className="mt-1 text-slate-500">
            {sku.provider} · {sku.validity}
          </p>
        </div>

        <Field
          label="What the provider charges you"
          htmlFor="supplier-cost"
          error={error}
          hint="Your price tiers are lifted automatically if this rises above one of them."
        >
          <div className="relative">
            <span className="absolute inset-y-0 left-3.5 flex items-center text-sm font-semibold text-slate-500">
              GHS
            </span>
            <TextInput
              id="supplier-cost"
              inputMode="decimal"
              className="pl-13 font-bold"
              invalid={Boolean(error)}
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setError('')
              }}
            />
          </div>
        </Field>

        <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
          Past orders keep the cost they were sold at. This only affects margins from here on.
        </Callout>

        <div className="flex gap-2">
          <Button block loading={busy} onClick={() => void submit()}>
            Save cost
          </Button>
          <Button block variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
