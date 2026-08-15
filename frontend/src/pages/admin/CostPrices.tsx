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
import { api, ApiError } from '../../lib/api'
import { formatMarkup, priceFromMarkup } from '../../lib/pricing'

type Tier = 'supplierCost' | 'adminPrice' | 'standardPrice'

/**
 * The two prices James actually sets.
 *
 * `supplierCost` is deliberately not one of them: it is what the provider
 * charges, it arrives from the provider catalogue, and it is the baseline every
 * margin on this page is measured against. Typing it here would let our idea of
 * the cost drift from the invoice — so it is shown, not edited.
 *
 * There is no retail cap any more either. Agents price their own stock above
 * their cost, however they like.
 */
const EDITABLE_TIERS = ['adminPrice', 'standardPrice'] as const

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
}

/**
 * FR-3.3, FR-3.6, FR-6.4 — James sets the two prices he charges.
 *
 * The third number, what he pays the provider, is shown here but edited on the
 * provider catalogue under Settings. Agents set their own retail price and are
 * not capped. See EDITABLE_TIERS above.
 */
export default function CostPrices() {
  const { products, updateProductTier, refresh, pushToast } = useStore()
  const [category, setCategory] = useState<Category>('data')
  const [editing, setEditing] = useState<Product | null>(null)
  const [marking, setMarking] = useState(false)

  const visible = products.filter((p) => p.category === category)
  const agentMargin = products.reduce((sum, p) => sum + (p.adminPrice - p.supplierCost), 0)
  const directMargin = products.reduce((sum, p) => sum + (p.standardPrice - p.supplierCost), 0)
  // Both selling prices must clear cost. Walk-up vs agent price is deliberately
  // not checked, and there is no ceiling to check — see EDITABLE_TIERS.
  const broken = products.filter(
    (p) => p.adminPrice < p.supplierCost || p.standardPrice < p.supplierCost,
  )

  return (
    <div>
      <PageHead
        title="Prices"
        subtitle="What agents pay and what walk-up customers pay. What you pay comes from the provider catalogue; agents set their own retail price."
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
            A selling price is below what you pay the provider, so every one of those sales loses
            money. Fix these before they sell.
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
        <CardHead
          title={CATEGORY_META[category].label}
          subtitle={`${visible.length} products`}
          action={
            visible.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setMarking(true)}>
                <TrendUpIcon className="size-4" /> Set markup
              </Button>
            )
          }
        />
        <TableWrap caption="Product price tiers">
          <thead>
            <tr>
              <Th>Product</Th>
              <Th align="right">You pay</Th>
              <Th align="right">Agents pay</Th>
              <Th align="right">Your margin</Th>
              <Th align="right">Walk-up price</Th>
              <Th align="right">Markup</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {visible.map((product) => {
              const margin = product.adminPrice - product.supplierCost
              const invalid =
                product.adminPrice < product.supplierCost ||
                product.standardPrice < product.supplierCost
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
                  <Td align="right">
                    {/* Agent / walk-up. This is what survives a provider price
                        change, so it is worth seeing next to the prices. */}
                    <span className="tabular text-xs text-slate-500">
                      {product.agentMarkupBp === undefined
                        ? '—'
                        : `${formatMarkup(product.agentMarkupBp)} / ${formatMarkup(product.walkupMarkupBp ?? 0)}`}
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

      <MarkupModal
        open={marking}
        category={category}
        count={visible.length}
        onClose={() => setMarking(false)}
        onApplied={async (updated, agent, walkup) => {
          await refresh()
          pushToast({
            tone: 'success',
            title: `${updated} product${updated === 1 ? '' : 's'} repriced`,
            detail: `Agents pay cost + ${agent}%, walk-up cost + ${walkup}%.`,
          })
        }}
      />

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
  })
  const [error, setError] = useState('')

  const key = product?.id ?? 'none'
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setValues({
      adminPrice: product ? (product.adminPrice / 100).toFixed(2) : '',
      standardPrice: product ? (product.standardPrice / 100).toFixed(2) : '',
    })
    setError('')
  }

  if (!product) return null

  const parsed = {
    adminPrice: parseCedis(values.adminPrice),
    standardPrice: parseCedis(values.standardPrice),
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

/**
 * One markup across a whole category, set as two separate percentages.
 *
 * Separate because they answer different questions — what an agent buys at, and
 * what a stranger pays at the counter — and James is free to set the walk-up one
 * lower if he would rather earn from agent volume than from his own sales.
 *
 * Setting a markup here is also what protects the margin. Prices are re-derived
 * from it whenever DataHub changes a cost, so a supplier price rise moves the
 * shelf price — rather than the price being nudged up to meet the new cost and
 * the margin quietly going to nothing.
 */
function MarkupModal({
  open,
  category,
  count,
  onClose,
  onApplied,
}: {
  open: boolean
  category: Category
  count: number
  onClose: () => void
  onApplied: (updated: number, agent: string, walkup: string) => Promise<void>
}) {
  const { products } = useStore()
  const [agent, setAgent] = useState('15')
  const [walkup, setWalkup] = useState('25')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const agentPercent = Number(agent)
  const walkupPercent = Number(walkup)
  const valid =
    agent.trim() !== '' &&
    walkup.trim() !== '' &&
    Number.isFinite(agentPercent) &&
    Number.isFinite(walkupPercent) &&
    agentPercent >= 0 &&
    walkupPercent >= 0

  // Previewed against the cheapest bundle in view, so the effect is concrete
  // before anything is committed.
  const sample = products
    .filter((p) => p.category === category)
    .sort((a, b) => a.supplierCost - b.supplierCost)[0]

  const submit = async () => {
    if (!valid) {
      setError('Enter percentages like 15 and 25.')
      return
    }

    setBusy(true)
    try {
      const { updated } = await api.applyMarkup({
        agentPercent,
        walkupPercent,
        scope: 'all',
        category,
      })
      await onApplied(updated, agent, walkup)
      onClose()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not apply that markup.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Set markup — ${CATEGORY_META[category].label}`}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Reprices all {count} product{count === 1 ? '' : 's'} in this category from what the
          provider charges you.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Agents pay cost +" htmlFor="bulk-agent">
            <div className="relative">
              <TextInput
                id="bulk-agent"
                inputMode="decimal"
                className="pr-9 font-bold"
                value={agent}
                onChange={(event) => {
                  setAgent(event.target.value)
                  setError('')
                }}
              />
              <span className="absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-slate-500">
                %
              </span>
            </div>
          </Field>

          <Field label="Walk-up pays cost +" htmlFor="bulk-walkup">
            <div className="relative">
              <TextInput
                id="bulk-walkup"
                inputMode="decimal"
                className="pr-9 font-bold"
                invalid={Boolean(error)}
                value={walkup}
                onChange={(event) => {
                  setWalkup(event.target.value)
                  setError('')
                }}
              />
              <span className="absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-slate-500">
                %
              </span>
            </div>
          </Field>
        </div>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        {sample && valid && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm">
            <p className="font-medium text-slate-900">{sample.name}</p>
            <p className="mt-1 text-slate-600">
              You pay {cedis(sample.supplierCost)} → agents{' '}
              <strong className="font-semibold text-slate-900">
                {cedis(priceFromMarkup(sample.supplierCost, Math.round(agentPercent * 100)))}
              </strong>
              , walk-up{' '}
              <strong className="font-semibold text-slate-900">
                {cedis(priceFromMarkup(sample.supplierCost, Math.round(walkupPercent * 100)))}
              </strong>
            </p>
          </div>
        )}

        <Callout tone="info" icon={<AlertIcon className="size-4" />}>
          The markup is remembered. When DataHub changes what a bundle costs, these prices move with
          it and your margin holds.
        </Callout>

        <div className="flex gap-2">
          <Button block loading={busy} onClick={() => void submit()}>
            Apply to {count}
          </Button>
          <Button block variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
