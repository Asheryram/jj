import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { Category, Network, Product } from '../../data/types'
import { CATEGORY_META } from '../../components/categories'
import { cedis } from '../../lib/format'
import { checkPhone, prettyPhone } from '../../lib/networks'
import { SUPPLIERS, type SupplierCode } from '../../lib/suppliers'
import { Badge, Button, Callout, Card, CardHead, EmptyState, Field, NetworkChip, PageHead, ProviderChip, Segmented, Spinner, TextInput, cn } from '../../components/ui'
import { AlertIcon } from '../../components/icons'

/**
 * An admin buys any bundle from any supplier, in the app, whichever supplier
 * customers are currently sold. Including bundles customers cannot see: off
 * sale, or from a supplier its network is not routed to (GMPL MTN while MTN
 * is routed to DataHub, or a newly added supplier nobody is routed to yet).
 *
 * A normal sale in every other way: paid by Mobile Money through Paystack,
 * counted in sales and profit, settled and refunded like any order. The
 * server re-checks that the buyer is an admin (`PlaceOrderDto.anySupplier`).
 */

const NETWORKS: Network[] = ['MTN', 'Telecel', 'AirtelTigo']
/** What can be bought here: everything a supplier fulfils automatically. */
const CATEGORIES: Category[] = ['data', 'mashup', 'checker']

function newKey(): string {
  return `any-${crypto.randomUUID()}`
}

/** Why customers cannot buy it, in their terms. Null when they can. */
function hiddenBecause(p: Product): string | null {
  if (p.onSaleToCustomers) return null
  if (!p.active) return 'Hidden: off sale'
  return 'Hidden: not routed'
}

export default function BuyAnySupplier() {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [category, setCategory] = useState<Category>('data')
  const [supplier, setSupplier] = useState<'all' | SupplierCode>('all')
  const [network, setNetwork] = useState<Network>('MTN')
  const [hiddenOnly, setHiddenOnly] = useState(false)
  const [picked, setPicked] = useState<Product | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  // On a phone the form is below a long list; bring it into view when picked.
  useEffect(() => {
    if (picked) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [picked])

  useEffect(() => {
    let live = true
    api
      .catalogue()
      .then((snapshot) => live && setProducts(snapshot.products.filter((p) => CATEGORIES.includes(p.category))))
      .catch((error: unknown) => live && setLoadError(error instanceof Error ? error.message : 'We could not load the bundles.'))
    return () => {
      live = false
    }
  }, [])

  // Only the networks this category is sold on, and none for checkers.
  const networks = NETWORKS.filter((n) => (products ?? []).some((p) => p.category === category && p.network === n))
  const pickCategory = (next: Category) => {
    setCategory(next)
    setPicked(null)
    const first = NETWORKS.find((n) => (products ?? []).some((p) => p.category === next && p.network === n))
    if (first) setNetwork(first)
  }

  const list = useMemo(
    () =>
      (products ?? [])
        .filter((p) => p.category === category)
        // Checkers have no network; Mashup is MTN only.
        .filter((p) => p.network === null || p.network === network)
        .filter((p) => supplier === 'all' || (p.provider ?? 'datahub-gh') === supplier)
        .filter((p) => !hiddenOnly || !p.onSaleToCustomers)
        .sort((a, b) => a.standardPrice - b.standardPrice),
    [products, category, network, supplier, hiddenOnly],
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PageHead
        title="Buy from any supplier"
        subtitle="Buy any bundle, Mashup pack or result checker from any supplier, whether or not customers can see it. A normal sale, paid by Mobile Money."
      />

      <Card className="mt-4">
        <CardHead title="Pick a bundle" />
        <div className="space-y-3 px-4 pb-4">
          <Segmented<Category>
            className="w-full"
            options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_META[c].short }))}
            value={category}
            onChange={pickCategory}
          />
          {networks.length > 1 && (
            <Segmented<Network> className="w-full" options={networks.map((n) => ({ value: n, label: n }))} value={network} onChange={setNetwork} />
          )}
          <Segmented<'all' | SupplierCode>
            className="w-full"
            options={[{ value: 'all', label: 'All suppliers' }, ...SUPPLIERS.map((s) => ({ value: s.code, label: s.label }))]}
            value={supplier}
            onChange={setSupplier}
          />
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={hiddenOnly} onChange={(e) => setHiddenOnly(e.target.checked)} />
            Only bundles customers can't see
          </label>

          {loadError ? (
            <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
              {loadError}
            </Callout>
          ) : products === null ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : list.length === 0 ? (
            <EmptyState title="No bundles here" detail="Try another network or supplier." />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {list.map((p) => {
                const hidden = hiddenBecause(p)
                const atCost = p.standardPrice <= p.supplierCost
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(p)}
                      className={cn(
                        'flex w-full flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60',
                        picked?.id === p.id && 'bg-brand-50 ring-1 ring-brand-300 dark:bg-brand-950/40',
                      )}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-50">{p.name}</span>
                        {p.validity && <span className="w-full text-xs text-slate-500 dark:text-slate-400">{p.validity}</span>}
                        <ProviderChip provider={(p.provider ?? 'datahub-gh') as SupplierCode} />
                        {hidden ? <Badge tone="warning">{hidden}</Badge> : <Badge tone="success">Customers see this</Badge>}
                        {atCost && <Badge tone="danger">Priced at cost</Badge>}
                      </span>
                      <span className="tabular font-semibold text-slate-900 dark:text-slate-50">{cedis(p.standardPrice)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Card>

      <div ref={formRef} className="scroll-mt-20">
        {picked && <BuyForm key={picked.id} product={picked} />}
      </div>
    </div>
  )
}

function BuyForm({ product }: { product: Product }) {
  const [recipient, setRecipient] = useState('')
  const [buyerName, setBuyerName] = useState('')
  const [touched, setTouched] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [failure, setFailure] = useState('')
  const [placedRef, setPlacedRef] = useState<string | null>(null)
  // One per attempt at this form, so a double-tap or a retry after a dropped
  // connection returns the same order instead of a second one.
  const [key] = useState(newKey)
  const check = checkPhone(recipient)
  const atCost = product.standardPrice <= product.supplierCost

  const buy = async () => {
    setTouched(true)
    if (!check.ok || placing) return
    setPlacing(true)
    setFailure('')
    try {
      const order = await api.placeOrder({
        productId: product.id,
        recipient: check.phone,
        buyerName: buyerName.trim() || undefined,
        payWith: 'momo',
        anySupplier: true,
        idempotencyKey: key,
      })
      if (order.paymentUrl) {
        window.sessionStorage.setItem('jdc.pendingOrder', JSON.stringify({ orderId: order.id, productId: product.id }))
        window.location.replace(order.paymentUrl)
        return
      }
      // Paystack is simulated on this server: the order went straight through.
      setPlacedRef(order.reference)
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : 'We could not place that order. Try again.')
    } finally {
      setPlacing(false)
    }
  }

  return (
    <Card className="mt-4">
      <CardHead title={`Buy ${product.name}`} subtitle={`${cedis(product.standardPrice)}, paid by Mobile Money`} />
      <div className="space-y-3 px-4 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {product.network && <NetworkChip network={product.network} />}
          <ProviderChip provider={(product.provider ?? 'datahub-gh') as SupplierCode} />
        </div>
        {atCost && (
          <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
            This bundle is priced at what the supplier charges, so Paystack's fee makes it a small loss. Set a price on Cost prices first if
            you want a margin on it.
          </Callout>
        )}
        <Field
          label={product.category === 'checker' ? 'Number to receive the PIN by SMS' : 'Number to receive the bundle'}
          htmlFor="any-recipient" error={touched && !check.ok ? check.reason : undefined}>
          <TextInput
            id="any-recipient"
            inputMode="tel"
            autoComplete="off"
            placeholder="024 123 4567"
            value={recipient}
            invalid={touched && !check.ok}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </Field>
        <Field label="Customer name (optional)" htmlFor="any-name" hint="Shown on the order. Leave empty to use your name.">
          <TextInput id="any-name" value={buyerName} maxLength={80} onChange={(e) => setBuyerName(e.target.value)} />
        </Field>
        {failure && (
          <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
            {failure}
          </Callout>
        )}
        {placedRef ? (
          <Callout tone="success">
            Order {placedRef} placed. Follow it on All orders{product.category === 'checker' ? '; Track order with this number shows its serial and PIN' : ''}.
          </Callout>
        ) : (
          <Button block loading={placing} onClick={() => void buy()}>
            Pay {cedis(product.standardPrice)}
            {check.ok ? ` for ${prettyPhone(check.phone)}` : ''}
          </Button>
        )}
      </div>
    </Card>
  )
}
