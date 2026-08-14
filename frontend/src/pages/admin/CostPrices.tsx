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

/**
 * The three tiers James actually sets.
 *
 * `supplierCost` is deliberately not one of them: it is what the provider
 * charges, it arrives from the provider catalogue, and it is the baseline every
 * margin on this page is measured against. Typing it here would let our idea of
 * the cost drift from the invoice — so it is shown, not edited.
 */
const EDITABLE_TIERS = ['adminPrice', 'standardPrice', 'maxRetailPrice'] as const

type EditableTier = (typeof EDITABLE_TIERS)[number]

const TIER_LABELS: Record<Tier, { label: string; help: string }> = {
  supplierCost: {
    label: 'What you pay the provider',
    help: 'From DataHub GH (or the voucher supplier). Nobody else ever sees this.',
  },
  adminPrice: {
    label: 'Your price to agents',
    help: 'What your agents pay. The gap above supplier cost is your margin on every agent sale.',
  },
  standardPrice: {
    label: 'Your own walk-up price',
    help: 'What a customer pays buying direct from you, with no agent link. You keep the whole spread. It can sit below what agents pay if you would rather make your margin on agent volume — the only floor is your own cost.',
  },
  maxRetailPrice: {
    label: 'Retail cap',
    help: 'The most anyone in the chain may charge, so a long chain cannot price you out of the market. Has to clear what agents pay, or none of them could sell.',
  },
}

/**
 * FR-3.3, FR-3.6, FR-6.4 — James sets the three prices he charges.
 *
 * The fourth number, what he pays the provider, is shown here but edited on the
 * provider catalogue under Settings. See EDITABLE_TIERS above.
 */
export default function CostPrices() {
  const { products, updateProductTier } = useStore()
  const [category, setCategory] = useState<Category>('data')
  const [editing, setEditing] = useState<Product | null>(null)

  const visible = products.filter((p) => p.category === category)
  const agentMargin = products.reduce((sum, p) => sum + (p.adminPrice - p.supplierCost), 0)
  const directMargin = products.reduce((sum, p) => sum + (p.standardPrice - p.supplierCost), 0)
  // Both selling prices must clear cost, and the cap must clear the agent price.
  // Walk-up vs agent price is deliberately not checked — see EDITABLE_TIERS.
  const broken = products.filter(
    (p) =>
      p.adminPrice < p.supplierCost ||
      p.standardPrice < p.supplierCost ||
      p.maxRetailPrice < p.adminPrice,
  )

  return (
    <div>
      <PageHead
        title="Prices"
        subtitle="What agents pay, what walk-up customers pay, and the ceiling. What you pay comes from the provider catalogue."
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
            Either a selling price is below what you pay, or the cap is below what your agents pay.
            Fix these before they sell.
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
        <TableWrap caption="Product price tiers">
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
                  <Td align="right" className="tabular text-xs text-slate-500">
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
  const [values, setValues] = useState<Record<EditableTier, string>>({
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
      adminPrice: product ? (product.adminPrice / 100).toFixed(2) : '',
      standardPrice: product ? (product.standardPrice / 100).toFixed(2) : '',
      maxRetailPrice: product ? (product.maxRetailPrice / 100).toFixed(2) : '',
    })
    setError('')
  }

  if (!product) return null

  const parsed = {
    adminPrice: parseCedis(values.adminPrice),
    standardPrice: parseCedis(values.standardPrice),
    maxRetailPrice: parseCedis(values.maxRetailPrice),
  }

  const save = () => {
    for (const tier of EDITABLE_TIERS) {
      if (parsed[tier] === null) {
        setError(`${TIER_LABELS[tier].label} needs to be a number like 5.50.`)
        return
      }
    }

    // The provider's cost, as recorded — the floor both selling prices sit above.
    const supplier = product.supplierCost
    const agent = parsed.adminPrice as number
    const standard = parsed.standardPrice as number
    const cap = parsed.maxRetailPrice as number

    if (agent < supplier) {
      setError(`Your price to agents cannot be below the ${cedis(supplier)} you pay for it.`)
      return
    }
    // Only floored at cost. The walk-up price may sit below what agents pay —
    // that is a channel decision, not an error. See EDITABLE_TIERS above.
    if (standard < supplier) {
      setError(`You pay ${cedis(supplier)} for this, so you cannot sell it for less.`)
      return
    }
    if (cap < agent) {
      setError(
        `The retail cap cannot be below the ${cedis(agent)} your agents pay — none of them could sell.`,
      )
      return
    }

    for (const tier of EDITABLE_TIERS) onSave(tier, parsed[tier] as number)
    onClose()
  }

  // Both measured against the recorded provider cost, which is the only honest
  // baseline — a margin over a number James typed would just be a margin over
  // his own optimism.
  const agentMargin = parsed.adminPrice !== null ? parsed.adminPrice - product.supplierCost : null
  const directMargin =
    parsed.standardPrice !== null ? parsed.standardPrice - product.supplierCost : null

  return (
    <Modal open onClose={onClose} title={`Prices — ${product.name}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <NetworkChip network={product.network} />
          <span className="text-sm text-slate-500">{product.validity}</span>
        </div>

        {/* Read-only, because it is the provider's number and not ours. Shown
            first because it is the floor the three editable tiers sit above. */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-slate-700">
              {TIER_LABELS.supplierCost.label}
            </p>
            <p className="tabular text-lg font-bold text-slate-900">
              {cedis(product.supplierCost)}
            </p>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Comes from the provider catalogue, so it always matches what you are actually
            invoiced. Change it under{' '}
            <strong className="font-semibold text-slate-700">Settings → Provider catalogue</strong>{' '}
            and it flows down here.
          </p>
        </div>

        {EDITABLE_TIERS.map(
          (tier) => (
            <Field
              key={tier}
              label={TIER_LABELS[tier].label}
              htmlFor={`tier-${tier}`}
              hint={TIER_LABELS[tier].help}
            >
              <div className="relative">
                <span className="absolute inset-y-0 left-3.5 flex items-center text-sm font-semibold text-slate-500">
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

        {/* The point of letting the walk-up price float is that James chooses
            which channel he earns more from. Say which one he has chosen, so the
            consequence is on screen rather than worked out afterwards. */}
        {agentMargin !== null && directMargin !== null && (
          <p className="text-sm text-slate-500">
            {directMargin > agentMargin
              ? 'You earn more selling this yourself than through an agent.'
              : directMargin < agentMargin
                ? 'You earn more when an agent sells this than when you sell it yourself — your margin comes from agent volume.'
                : 'You earn the same whether you sell this yourself or an agent does.'}
          </p>
        )}

        {error && (
          <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
            {error}
          </Callout>
        )}

        <div className="flex gap-2">
          <Button block onClick={save}>
            Save prices
          </Button>
          <Button block variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
