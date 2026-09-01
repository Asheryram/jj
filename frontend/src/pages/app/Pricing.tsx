import { useState } from 'react'
import { useStore } from '../../state/store'
import { cedis, parseCedis } from '../../lib/format'
import { validateResalePrice, type PriceBand } from '../../lib/pricing'
import { NETWORKS } from '../../lib/networks'
import type { Category, Network, Product } from '../../data/types'
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
  PageHead,
  Segmented,
  StatTile,
  TableWrap,
  Td,
  TextInput,
  Th,
  cn,
} from '../../components/ui'
import { AlertIcon, TagIcon, TrendUpIcon } from '../../components/icons'

/**
 * FR-3.4, FR-6.2 — an agent sets their own resale price.
 *
 * The floor is what they pay James — the same price for every agent, whoever
 * referred them. Below it they would be selling at a loss, so it is enforced
 * server-side as well as here.
 *
 * There is no ceiling. An agent charges whatever they judge the market will bear,
 * and an agent who overprices loses the sale to one who does not — competition is
 * a better cap than a number James would have to maintain per product.
 */
export default function Pricing() {
  const { products, myBand, myResalePrice, hasOwnPrice, setAgentPrice } = useStore()
  const [category, setCategory] = useState<Category>('data')
  const [network, setNetwork] = useState<Network | null>(null)
  const [editing, setEditing] = useState<Product | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  const isChecker = category === 'checker'
  const inCategory = products.filter((p) => p.category === category && p.active)
  const networksInCategory = NETWORKS.filter((n) => inCategory.some((p) => p.network === n))
  const visible = inCategory.filter((p) => !network || isChecker || p.network === network)
  const priced = products.filter((p) => hasOwnPrice(p.id))

  const marginOf = (product: Product) => myResalePrice(product) - myBand(product).floor
  const averageMargin =
    priced.length > 0
      ? Math.round(priced.reduce((sum, p) => sum + marginOf(p), 0) / priced.length)
      : 0

  return (
    <div>
      <PageHead
        title="My prices"
        subtitle="You buy at your own cost and charge what you like. The difference is yours."
        action={
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <TrendUpIcon className="size-4" /> Apply markup to all
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Products you have priced"
          value={`${priced.length} of ${products.length}`}
          hint="The rest use your default markup"
          icon={<TagIcon className="size-5" />}
        />
        <StatTile
          label="Average margin"
          value={cedis(averageMargin)}
          tone="brand"
          icon={<TrendUpIcon className="size-5" />}
        />
        <StatTile
          label="Best margin"
          value={cedis(priced.length > 0 ? Math.max(...priced.map(marginOf)) : 0)}
        />
      </div>

      <div className="mt-4 space-y-3">
        <Callout tone="info" icon={<AlertIcon className="size-4" />}>
          Your cost is what your upline charges you — it already includes their margin and James&apos;s.
          You can never price below it, so everyone above you is paid automatically on every sale
          you make.
        </Callout>
      </div>

      {/* -mx-3/px-3 cancels AppShell's own px-3 on mobile — not px-4, which
          overshoots the viewport by the 4px difference. */}
      <div className="mt-4 -mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        <Segmented<Category>
          options={CATEGORY_ORDER.map((key) => ({ value: key, label: CATEGORY_META[key].short }))}
          value={category}
          onChange={setCategory}
        />
      </div>

      {/* Jump straight to one network instead of scrolling past the other two
          to find it — the same filter the public shop uses for the same reason. */}
      {networksInCategory.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Network</span>
          <button
            type="button"
            onClick={() => setNetwork(null)}
            aria-pressed={!network}
            className={cn(
              'rounded-full border px-3 py-1 text-sm font-semibold',
              !network
                ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-600 dark:bg-slate-600'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300',
            )}
          >
            All
          </button>
          {networksInCategory.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNetwork(n)}
              aria-pressed={network === n}
              className={cn(
                'rounded-full border px-3 py-1 text-sm font-semibold',
                network === n
                  ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-600 dark:bg-slate-600'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300',
              )}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      <Card className="mt-3">
        <CardHead title={CATEGORY_META[category].label} subtitle={`${visible.length} products`} />
        <TableWrap caption="Your resale prices by product">
          <thead>
            <tr>
              <Th>Product</Th>
              <Th align="right">You pay</Th>
              <Th align="right">Your price</Th>
              <Th align="right">Your margin</Th>
              <Th align="right">Cap</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {visible.map((product) => {
              const band = myBand(product)
              const mine = myResalePrice(product)
              const margin = mine - band.floor
              const own = hasOwnPrice(product.id)
              return (
                <tr key={product.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <Td>
                    <p className="font-medium text-slate-900 dark:text-slate-50">{product.name}</p>
                    <div className="mt-1">
                      <NetworkChip network={product.network} />
                    </div>
                  </Td>
                  <Td align="right" className="tabular text-slate-600 dark:text-slate-300">
                    {cedis(band.floor)}
                  </Td>
                  <Td align="right">
                    <span className="tabular font-bold text-slate-900 dark:text-slate-50">{cedis(mine)}</span>
                    {!own && (
                      <Badge tone="neutral" className="ml-1.5">
                        default
                      </Badge>
                    )}
                  </Td>
                  <Td align="right">
                    <span
                      className={cn(
                        'tabular font-semibold',
                        margin > 0 ? 'text-brand-700 dark:text-brand-300' : 'text-amber-700 dark:text-amber-400',
                      )}
                    >
                      {margin > 0 ? cedis(margin, { sign: true }) : 'at cost'}
                    </span>
                  </Td>
                  <Td align="right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(product)}>
                      Edit
                    </Button>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </TableWrap>
      </Card>

      <EditPriceModal
        product={editing}
        band={editing ? myBand(editing) : null}
        currentPrice={editing ? myResalePrice(editing) : undefined}
        onClose={() => setEditing(null)}
        onSave={(price) => {
          if (editing) setAgentPrice(editing.id, price)
          setEditing(null)
        }}
      />

      <BulkMarkupModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onApply={(percent) => {
          for (const product of products) {
            const band = myBand(product)
            const wanted = Math.round(band.floor * (1 + percent / 100))
            setAgentPrice(product.id, Math.max(wanted, band.floor))
          }
          setBulkOpen(false)
        }}
      />
    </div>
  )
}

function EditPriceModal({
  product,
  band,
  currentPrice,
  onClose,
  onSave,
}: {
  product: Product | null
  band: PriceBand | null
  currentPrice?: number
  onClose: () => void
  onSave: (price: number) => void
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  // Reset the field whenever a different product is opened.
  const key = product?.id ?? 'none'
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setValue(currentPrice !== undefined ? (currentPrice / 100).toFixed(2) : '')
    setError('')
  }

  if (!product || !band) return null

  const parsed = parseCedis(value)
  const margin = parsed === null ? null : parsed - band.floor

  const save = () => {
    const problem = validateResalePrice(parsed, band)
    if (problem) {
      setError(problem)
      return
    }
    onSave(parsed as number)
  }

  return (
    <Modal open onClose={onClose} title={`Price for ${product.name}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <NetworkChip network={product.network} />
          <span className="text-sm text-slate-500 dark:text-slate-400">{product.validity}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800 px-3.5 py-3">
            <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">You pay</p>
            <p className="tabular mt-0.5 font-bold text-slate-900 dark:text-slate-50">{cedis(band.floor)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800 px-3.5 py-3">
            <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
              You keep
            </p>
            <p className="tabular mt-0.5 font-bold text-brand-800 dark:text-brand-300">
              {margin === null ? '—' : cedis(margin, { sign: margin > 0 })}
            </p>
          </div>
        </div>

        <Field
          label="Your resale price"
          htmlFor="price-input"
          error={error}
          hint={`Anything from ${cedis(band.floor)} upwards — there is no maximum.`}
        >
          <div className="relative">
            <span className="absolute inset-y-0 left-3.5 flex items-center text-sm font-semibold text-slate-500 dark:text-slate-400">
              GHS
            </span>
            <TextInput
              id="price-input"
              inputMode="decimal"
              className="pl-13 text-lg font-bold"
              invalid={Boolean(error)}
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setError('')
              }}
            />
          </div>
        </Field>

        {margin !== null && margin >= 0 && (
          <div className="flex items-baseline justify-between rounded-xl bg-brand-50 dark:bg-brand-900/40 px-3.5 py-3">
            <span className="text-sm text-brand-900 dark:text-brand-200">Your profit per order</span>
            <span className="tabular text-lg font-bold text-brand-800 dark:text-brand-300">
              {cedis(margin, { sign: true })}
            </span>
          </div>
        )}

        <div className="flex gap-2">
          <Button block onClick={save}>
            Save price
          </Button>
          <Button block variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function BulkMarkupModal({
  open,
  onClose,
  onApply,
}: {
  open: boolean
  onClose: () => void
  onApply: (percent: number) => void
}) {
  const [percent, setPercent] = useState(15)

  return (
    <Modal open={open} onClose={onClose} title="Apply a markup to every product">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Sets each of your prices to your own cost plus this percentage. Anything that would go
          over James&apos;s retail cap is set to the cap instead. You can still edit individual
          products afterwards.
        </p>

        <div className="flex flex-wrap gap-2">
          {[5, 10, 15, 20, 25, 30].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPercent(option)}
              className={cn(
                'tabular rounded-xl border px-4 py-2.5 text-sm font-bold',
                percent === option
                  ? 'border-brand-600 bg-brand-700 text-white'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-slate-300',
              )}
            >
              +{option}%
            </button>
          ))}
        </div>

        <Callout tone="warning">
          Example: a bundle you pay {cedis(2600)} for would sell at{' '}
          <strong className="font-bold">{cedis(Math.round(2600 * (1 + percent / 100)))}</strong>,
          giving you {cedis(Math.round(2600 * (percent / 100)))} profit.
        </Callout>

        <div className="flex gap-2">
          <Button block onClick={() => onApply(percent)}>
            Apply +{percent}% to all
          </Button>
          <Button block variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
