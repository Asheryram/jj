import { useState } from 'react'
import { useStore } from '../../state/store'
import { cedis, parseCedis } from '../../lib/format'
import type { Category, Product } from '../../data/types'
import { CATEGORY_META, CATEGORY_ORDER } from '../../components/categories'
import {
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

type Tier = 'supplierCost' | 'adminPrice' | 'standardPrice' | 'maxRetailPrice'

const TIER_LABELS: Record<Tier, { label: string; help: string }> = {
  supplierCost: {
    label: 'Supplier cost',
    help: 'What DataHub GH (or the voucher supplier) charges you. Nobody else ever sees this.',
  },
  adminPrice: {
    label: 'Your price to agents',
    help: 'What your agents pay. The gap above supplier cost is your margin on every agent sale.',
  },
  standardPrice: {
    label: 'Standard customer price',
    help: 'What a walk-up customer pays with no agent link. You keep the whole spread on these.',
  },
  maxRetailPrice: {
    label: 'Retail cap',
    help: 'The most anyone in the chain may charge, so a long chain cannot price you out of the market.',
  },
}

/** FR-3.3, FR-3.6, FR-6.4 — James controls all four price tiers. */
export default function CostPrices() {
  const { products, updateProductTier } = useStore()
  const [category, setCategory] = useState<Category>('data')
  const [editing, setEditing] = useState<Product | null>(null)

  const visible = products.filter((p) => p.category === category)
  const agentMargin = products.reduce((sum, p) => sum + (p.adminPrice - p.supplierCost), 0)
  const directMargin = products.reduce((sum, p) => sum + (p.standardPrice - p.supplierCost), 0)
  const broken = products.filter((p) => p.adminPrice < p.supplierCost || p.maxRetailPrice < p.adminPrice)

  return (
    <div>
      <PageHead
        title="Prices"
        subtitle="Four tiers per product: what you pay, what agents pay, what walk-up customers pay, and the ceiling."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Products in catalogue"
          value={String(products.length)}
          icon={<TagIcon className="size-5" />}
        />
        <StatTile
          label="Average margin on agent sales"
          value={cedis(Math.round(agentMargin / products.length))}
          hint="Your price to agents, less supplier cost"
          tone="brand"
          icon={<TrendUpIcon className="size-5" />}
        />
        <StatTile
          label="Average margin on direct sales"
          value={cedis(Math.round(directMargin / products.length))}
          hint="Standard price, less supplier cost"
          tone="success"
        />
      </div>

      <div className="mt-3 space-y-3">
        {broken.length > 0 && (
          <Callout
            tone="danger"
            title={`${broken.length} product${broken.length === 1 ? '' : 's'} priced wrong`}
            icon={<AlertIcon className="size-4" />}
          >
            A tier is out of order — either your agent price is below what you pay, or the cap is
            below your agent price. Fix these before they sell.
          </Callout>
        )}
        <Callout
          tone="warning"
          title="Changing a price does not rewrite history"
          icon={<AlertIcon className="size-4" />}
        >
          Every order stores the split it was actually sold at. Past reports, agent earnings and your
          own margin stay exactly as they were — only future orders use the new price.
        </Callout>
      </div>

      <div className="mt-4 -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <Segmented<Category>
          options={CATEGORY_ORDER.map((key) => ({ value: key, label: CATEGORY_META[key].short }))}
          value={category}
          onChange={setCategory}
        />
      </div>

      <Card className="mt-3">
        <CardHead title={CATEGORY_META[category].label} subtitle={`${visible.length} products`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th align="right">You pay</Th>
              <Th align="right">Agents pay</Th>
              <Th align="right">Your margin</Th>
              <Th align="right">Walk-up price</Th>
              <Th align="right">Cap</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {visible.map((product) => {
              const margin = product.adminPrice - product.supplierCost
              const invalid =
                product.adminPrice < product.supplierCost ||
                product.maxRetailPrice < product.adminPrice
              return (
                <tr key={product.id} className={cn('hover:bg-slate-50', invalid && 'bg-red-50/50')}>
                  <Td>
                    <p className="font-medium text-slate-900">{product.name}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <NetworkChip network={product.network} />
                      <span className="text-xs text-slate-500">{product.validity}</span>
                    </div>
                  </Td>
                  <Td align="right" className="tabular text-slate-600">
                    {cedis(product.supplierCost)}
                  </Td>
                  <Td align="right" className="tabular font-bold text-slate-900">
                    {cedis(product.adminPrice)}
                  </Td>
                  <Td align="right">
                    <span
                      className={cn(
                        'tabular font-semibold',
                        margin > 0 ? 'text-brand-700' : 'text-red-600',
                      )}
                    >
                      {margin > 0 ? cedis(margin, { sign: true }) : cedis(margin)}
                    </span>
                  </Td>
                  <Td align="right" className="tabular text-slate-600">
                    {cedis(product.standardPrice)}
                  </Td>
                  <Td align="right" className="tabular text-xs text-slate-400">
                    {cedis(product.maxRetailPrice)}
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

      <EditPricesModal
        product={editing}
        onClose={() => setEditing(null)}
        onSave={(tier, value) => {
          if (editing) updateProductTier(editing.id, tier, value)
        }}
      />
    </div>
  )
}

function EditPricesModal({
  product,
  onClose,
  onSave,
}: {
  product: Product | null
  onClose: () => void
  onSave: (tier: Tier, value: number) => void
}) {
  const [values, setValues] = useState<Record<Tier, string>>({
    supplierCost: '',
    adminPrice: '',
    standardPrice: '',
    maxRetailPrice: '',
  })
  const [error, setError] = useState('')

  const key = product?.id ?? 'none'
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setValues({
      supplierCost: product ? (product.supplierCost / 100).toFixed(2) : '',
      adminPrice: product ? (product.adminPrice / 100).toFixed(2) : '',
      standardPrice: product ? (product.standardPrice / 100).toFixed(2) : '',
      maxRetailPrice: product ? (product.maxRetailPrice / 100).toFixed(2) : '',
    })
    setError('')
  }

  if (!product) return null

  const parsed = {
    supplierCost: parseCedis(values.supplierCost),
    adminPrice: parseCedis(values.adminPrice),
    standardPrice: parseCedis(values.standardPrice),
    maxRetailPrice: parseCedis(values.maxRetailPrice),
  }

  const save = () => {
    const tiers: Tier[] = ['supplierCost', 'adminPrice', 'standardPrice', 'maxRetailPrice']
    for (const tier of tiers) {
      if (parsed[tier] === null) {
        setError(`${TIER_LABELS[tier].label} needs to be a number like 5.50.`)
        return
      }
    }
    const supplier = parsed.supplierCost as number
    const agent = parsed.adminPrice as number
    const standard = parsed.standardPrice as number
    const cap = parsed.maxRetailPrice as number

    // The tiers have to stay in order or the whole chain breaks.
    if (agent < supplier) {
      setError('Your price to agents cannot be below what the supplier charges you.')
      return
    }
    if (standard < supplier) {
      setError('The walk-up price cannot be below what the supplier charges you.')
      return
    }
    if (cap < agent) {
      setError('The retail cap cannot be below the price your agents pay.')
      return
    }

    for (const tier of tiers) onSave(tier, parsed[tier] as number)
    onClose()
  }

  const agentMargin =
    parsed.adminPrice !== null && parsed.supplierCost !== null
      ? parsed.adminPrice - parsed.supplierCost
      : null
  const directMargin =
    parsed.standardPrice !== null && parsed.supplierCost !== null
      ? parsed.standardPrice - parsed.supplierCost
      : null

  return (
    <Modal open onClose={onClose} title={`Prices — ${product.name}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <NetworkChip network={product.network} />
          <span className="text-sm text-slate-500">{product.validity}</span>
        </div>

        {(['supplierCost', 'adminPrice', 'standardPrice', 'maxRetailPrice'] as Tier[]).map(
          (tier) => (
            <Field
              key={tier}
              label={TIER_LABELS[tier].label}
              htmlFor={`tier-${tier}`}
              hint={TIER_LABELS[tier].help}
            >
              <div className="relative">
                <span className="absolute inset-y-0 left-3.5 flex items-center text-sm font-semibold text-slate-400">
                  GHS
                </span>
                <TextInput
                  id={`tier-${tier}`}
                  inputMode="decimal"
                  className="pl-13 font-bold"
                  value={values[tier]}
                  onChange={(event) => {
                    setValues((current) => ({ ...current, [tier]: event.target.value }))
                    setError('')
                  }}
                />
              </div>
            </Field>
          ),
        )}

        {agentMargin !== null && directMargin !== null && (
          <div className="grid grid-cols-2 gap-3">
            <div
              className={cn(
                'rounded-xl px-3.5 py-3',
                agentMargin >= 0 ? 'bg-brand-50' : 'bg-red-50',
              )}
            >
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Margin per agent sale
              </p>
              <p
                className={cn(
                  'tabular mt-0.5 text-lg font-bold',
                  agentMargin >= 0 ? 'text-brand-800' : 'text-red-700',
                )}
              >
                {cedis(agentMargin, { sign: agentMargin >= 0 })}
              </p>
            </div>
            <div
              className={cn(
                'rounded-xl px-3.5 py-3',
                directMargin >= 0 ? 'bg-emerald-50' : 'bg-red-50',
              )}
            >
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Margin per direct sale
              </p>
              <p
                className={cn(
                  'tabular mt-0.5 text-lg font-bold',
                  directMargin >= 0 ? 'text-emerald-700' : 'text-red-700',
                )}
              >
                {cedis(directMargin, { sign: directMargin >= 0 })}
              </p>
            </div>
          </div>
        )}

        {error && (
          <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
            {error}
          </Callout>
        )}

        <div className="flex gap-2">
          <Button block onClick={save}>
            Save all four
          </Button>
          <Button block variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
