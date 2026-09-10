import { Fragment, useEffect, useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { cedis, dateTime, parseCedis, shortDate } from '../../lib/format'
import type { Category, Network, Product } from '../../data/types'
import { NETWORKS, NETWORK_STYLES } from '../../lib/networks'
import { CATEGORY_META, CATEGORY_ORDER } from '../../components/categories'
import ProviderCatalogue from './ProviderCatalogue'
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
import { AlertIcon, ChevronDownIcon, TagIcon, TrendUpIcon } from '../../components/icons'
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

type AccuracyRow = Awaited<ReturnType<typeof api.catalogueAccuracy>>[number]

/**
 * `catalogueAccuracy()` and the product catalogue come from two different
 * queries with no shared id between them — the accuracy row is keyed off the
 * *supplier's* product code, which never reaches the frontend's own `Product`
 * type. Both do carry `name` + `network` already, though, and that pair is
 * unique in practice (no two bundles on the same network share a name), so
 * it works as a join key without adding a new field just for this.
 */
function accuracyKey(name: string, network: string | null): string {
  return `${name}|${network ?? ''}`
}

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
  const { products, updateProductTier, setProductOnSale, refresh, pushToast } = useStore()

  const [category, setCategory] = useState<Category>('data')
  const [editing, setEditing] = useState<Product | null>(null)
  const [marking, setMarking] = useState(false)

  /**
   * Fetched once here rather than only living on its own dedicated page —
   * the point of this data is to inform a price *before* it's set, not just
   * to be read about afterwards. See `accuracyKey` for why the join is by
   * name + network rather than an id.
   */
  const [accuracy, setAccuracy] = useState<AccuracyRow[]>([])
  useEffect(() => {
    let live = true
    api
      .catalogueAccuracy()
      .then((rows) => live && setAccuracy(rows))
      .catch(() => live && setAccuracy([]))
    return () => {
      live = false
    }
  }, [])
  const accuracyByKey = useMemo(
    () => new Map(accuracy.map((row) => [accuracyKey(row.name, row.network), row])),
    [accuracy],
  )

  /**
   * Prices waiting to be told to agents — consolidated on the server, one
   * row per product no matter how many edits produced it. Refetched after
   * anything that could change it: an edit, a bulk markup, or sending the
   * digest itself.
   */
  const [pendingChanges, setPendingChanges] = useState<Awaited<ReturnType<typeof api.pendingPriceChanges>>>([])
  const [notifyOpen, setNotifyOpen] = useState(false)
  const refreshPending = () => {
    api
      .pendingPriceChanges()
      .then(setPendingChanges)
      .catch(() => {})
  }
  useEffect(() => {
    refreshPending()
  }, [])

  /**
   * Has James actually looked at this price since the real cost last changed?
   * Not "is the catalogue right" — this is "did I review this price against
   * the real number, and is that number still the one that's current."
   * Compared by value against `drift.charged`, not by date: a fresh delivery
   * repeating the same real cost he already priced against is not something
   * new to review. `none` means there is nothing to review yet — no real
   * delivery has been recorded for this bundle at all.
   */
  const reviewStatusOf = (p: Product): 'none' | 'outdated' | 'current' => {
    const drift = accuracyByKey.get(accuracyKey(p.name, p.network))
    return drift == null ? 'none' : p.pricedAgainstRealCost === drift.charged ? 'current' : 'outdated'
  }

  const [reviewFilter, setReviewFilter] = useState<'all' | 'outdated' | 'current' | 'none'>('all')

  const categoryProducts = products.filter((p) => p.category === category)
  // Counted against the whole category, not the filter already applied — so
  // picking "Up to date" doesn't make the "Outdated" count vanish along with
  // the rows, which would make it look like there was nothing left to find.
  const outdatedInCategory = categoryProducts.filter((p) => reviewStatusOf(p) === 'outdated').length
  const currentInCategory = categoryProducts.filter((p) => reviewStatusOf(p) === 'current').length
  // Nobody has ever actually bought this — there is no real delivery on
  // record to price against at all, so it is neither outdated nor up to
  // date, it is simply unproven. Worth its own bucket rather than folding it
  // into "Outdated": a bundle that's never sold isn't wrong, it's untested.
  const notBoughtInCategory = categoryProducts.filter((p) => reviewStatusOf(p) === 'none').length

  const visible = categoryProducts.filter(
    (p) => reviewFilter === 'all' || reviewStatusOf(p) === reviewFilter,
  )

  /**
   * Grouped by network, because that is how the person pricing them thinks.
   *
   * A flat list interleaves MTN, Telecel and AirtelTigo bundles of similar size,
   * so comparing "what do I charge for 10GB across the networks" meant reading
   * the whole table. Cheapest first inside each group, which is the order a
   * customer sees them in.
   *
   * Airtime and anything else without a carrier falls into a final group rather
   * than being dropped — a product missing from this screen is a product nobody
   * can price.
   */
  const groups = useMemo(() => {
    const byNetwork = new Map<string, Product[]>()
    for (const product of visible) {
      const key = product.network ?? 'Other'
      const bucket = byNetwork.get(key)
      if (bucket) bucket.push(product)
      else byNetwork.set(key, [product])
    }

    const order = [...NETWORKS.filter((n) => byNetwork.has(n)), ...(byNetwork.has('Other') ? ['Other'] : [])]

    return order.map((key) => {
      const items = (byNetwork.get(key) ?? []).sort((a, b) => a.supplierCost - b.supplierCost)
      /**
       * Named in the header rather than repeated on every row. Usually one, and
       * worth seeing the moment it is not.
       *
       * `undefined` and `null` mean different things and must not be collapsed:
       * null is a product with no supplier linked, which is worth flagging;
       * undefined is an API that did not send the field at all, which says nothing
       * about the product. Treating the second as the first labelled every bundle
       * "no supplier" against an older server — a claim the client had no basis
       * for. When nothing is known, nothing is shown.
       */
      const known = items.filter((p) => p.provider !== undefined)
      const providers = known.length
        ? [...new Set(known.map((p) => p.provider ?? 'unassigned'))].sort()
        : []
      return {
        key,
        label: key === 'Other' ? 'No network' : NETWORK_STYLES[key as Network].label,
        dot: key === 'Other' ? 'bg-slate-300 dark:bg-slate-600' : NETWORK_STYLES[key as Network].dot,
        items,
        providers,
      }
    })
  }, [visible])
  /**
   * The catalogue's supplier cost is only ever as fresh as the last sync — the
   * real per-unit cost is whatever the provider actually charged on the most
   * recent delivery, from `catalogueAccuracy()`. Falling back to the catalogue
   * figure when there's no delivery to compare against yet, rather than
   * excluding the product, so a freshly-synced bundle still counts.
   */
  const realCostOf = (p: Product) => accuracyByKey.get(accuracyKey(p.name, p.network))?.charged ?? p.supplierCost

  // Both of these are James's own margin, never the agent's — one per channel
  // he sells through. Catalogue-based, matching the per-row "Your margin"
  // column below; see `realAgentMargin`/`realDirectMargin` for the same two
  // numbers against what delivery actually cost most recently.
  const agentMargin = products.reduce((sum, p) => sum + (p.adminPrice - p.supplierCost), 0)
  const directMargin = products.reduce((sum, p) => sum + (p.standardPrice - p.supplierCost), 0)
  const realAgentMargin = products.reduce((sum, p) => sum + (p.adminPrice - realCostOf(p)), 0)
  const realDirectMargin = products.reduce((sum, p) => sum + (p.standardPrice - realCostOf(p)), 0)

  /**
   * An average needs something to average.
   *
   * The catalogue is empty until it has been synced from the provider, and until
   * then dividing by `products.length` is 0/0 — which reached the stat tiles as
   * the literal text `GHS NaN`. `null` rather than 0 because the average margin
   * on no products is not zero, it is nothing, and a tile reading GHS 0.00 would
   * be telling James he makes no margin.
   */
  const averageOf = (totalMargin: number): number | null =>
    products.length > 0 ? Math.round(totalMargin / products.length) : null

  // Collapsed groups, by key. Open by default: hiding rows on arrival would make
  // a freshly synced catalogue look empty, which is the confusion this screen has
  // already caused once.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const agentAverage = averageOf(agentMargin)
  const directAverage = averageOf(directMargin)
  const realAgentAverage = averageOf(realAgentMargin)
  const realDirectAverage = averageOf(realDirectMargin)
  // Only worth a second line when it would actually say something different —
  // most products have no delivery to compare against yet, and repeating the
  // same number under a "real" label would read as a glitch, not a fact.
  const agentAverageDiffers = agentAverage !== null && realAgentAverage !== null && realAgentAverage !== agentAverage
  const directAverageDiffers = directAverage !== null && realDirectAverage !== null && realDirectAverage !== directAverage

  /**
   * Freshly imported bundles are real, priced at cost, and not on sale.
   *
   * That is deliberate on the server's side — a made-up default markup would
   * appear as James's own price — but until now nothing on this screen said so.
   * A sync reported "46 new", the table listed all 46, and the shop stayed empty
   * with no explanation anywhere. The rule is only honest if the person who has
   * to act on it can see it.
   */
  const notOnSale = products.filter((p) => !p.active)
  /**
   * The real floor, not the catalogue one — same rule as the table row and
   * `EditPricesModal`. A price sitting below catalogue but at or above the
   * last real charge is deliberately allowed, so flagging it here against
   * catalogue alone would call a correctly "Up to date" price broken.
   */
  const floorOf = (p: Product) => accuracyByKey.get(accuracyKey(p.name, p.network))?.charged ?? p.supplierCost
  // Both selling prices must clear cost. Walk-up vs agent price is deliberately
  // not checked, and there is no ceiling to check — see EDITABLE_TIERS.
  const broken = products.filter((p) => p.adminPrice < floorOf(p) || p.standardPrice < floorOf(p))

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
          label="Your margin — selling to agents"
          value={realAgentAverage === null ? '—' : cedis(realAgentAverage)}
          hint={
            products.length > 0
              ? agentAverageDiffers
                ? `Your price to agents, less what it actually cost to deliver last time — catalogue estimate: ${cedis(agentAverage as number)}`
                : 'Your price to agents, less what it actually costs to deliver — never the agent\'s own cut'
              : 'Sync the provider catalogue to see this'
          }
          tone="brand"
          icon={<TrendUpIcon className="size-5" />}
        />
        <StatTile
          label="Your margin — selling direct"
          value={realDirectAverage === null ? '—' : cedis(realDirectAverage)}
          hint={
            products.length > 0
              ? directAverageDiffers
                ? `Your walk-up price, less what it actually cost to deliver last time — catalogue estimate: ${cedis(directAverage as number)}`
                : 'Your walk-up price, less what it actually costs to deliver — what you keep selling direct'
              : 'Sync the provider catalogue to see this'
          }
          tone="success"
        />
      </div>

      <div className="mt-3 space-y-3">
        {pendingChanges.length > 0 && (
          <Callout
            tone="info"
            title={`${pendingChanges.length} price${pendingChanges.length === 1 ? '' : 's'} changed since agents were last told`}
            icon={<AlertIcon className="size-4" />}
          >
            <p>
              Consolidated across every edit since the last digest — an agent sees only the net
              change, not each edit along the way, and a price that's back where it started never
              shows up at all.
            </p>
            <Button size="sm" className="mt-2" onClick={() => setNotifyOpen(true)}>
              Review &amp; notify agents
            </Button>
          </Callout>
        )}

        {notOnSale.length > 0 && (
          <Callout
            tone="warning"
            title={`${notOnSale.length} product${notOnSale.length === 1 ? '' : 's'} not on sale yet`}
            icon={<AlertIcon className="size-4" />}
          >
            A bundle arrives from the provider priced at cost, and stays out of the shop until you
            say what it sells for — otherwise it would sell at no margin. Set a markup below and
            they go on sale straight away.
          </Callout>
        )}

        {broken.length > 0 && (
          <Callout
            tone="danger"
            title={`${broken.length} product${broken.length === 1 ? '' : 's'} priced wrong`}
            icon={<AlertIcon className="size-4" />}
          >
            A selling price is below what you pay the provider once Paystack's cut on the sale is
            taken out, so every one of those sales loses money — even where the price alone looks
            fine. Fix these before they sell.
          </Callout>
        )}
        <Callout
          tone="warning"
          title="Changing a price does not rewrite history"
          icon={<AlertIcon className="size-4" />}
        >
          Every order stores the split it was actually sold at. Past reports, agent earnings and
          your own margin stay exactly as they were — only future orders use the new price.
        </Callout>
      </div>

      {/* -mx-3/px-3 cancels AppShell's own px-3 on mobile — not px-4, which
          overshoots the viewport by the 4px difference. */}
      <div className="mt-4 -mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        <Segmented<Category>
          options={CATEGORY_ORDER.map((key) => ({
            value: key,
            label: CATEGORY_META[key].short,
          }))}
          value={category}
          onChange={(next) => {
            setCategory(next)
            // A filter that made sense in the old category can silently hide
            // everything in the new one with no visible control left to
            // explain why — see the gate below.
            setReviewFilter('all')
          }}
        />
      </div>

      {/* Only worth showing once there's something in this category at all. */}
      {categoryProducts.length > 0 && (
        <div className="mt-3 -mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
          <Segmented<'all' | 'outdated' | 'current' | 'none'>
            options={[
              { value: 'all', label: 'All' },
              { value: 'outdated', label: `Outdated (${outdatedInCategory})` },
              { value: 'current', label: `Up to date (${currentInCategory})` },
              { value: 'none', label: `Not bought yet (${notBoughtInCategory})` },
            ]}
            value={reviewFilter}
            onChange={setReviewFilter}
          />
        </div>
      )}

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
              <Th align="right">Your margin (agent / direct)</Th>
              <Th align="right">Walk-up price</Th>
              <Th align="right">Markup</Th>
              <Th align="center">On sale</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  {reviewFilter === 'all'
                    ? 'No products in this category yet.'
                    : `Nothing ${
                        reviewFilter === 'outdated'
                          ? 'outdated'
                          : reviewFilter === 'current'
                            ? 'up to date'
                            : 'unbought'
                      } here — try "All".`}
                </td>
              </tr>
            )}
            {groups.map((group) => (
              <Fragment key={group.key}>
                <tr className="bg-slate-50/80 dark:bg-slate-800/80">
                  <td colSpan={8} className="p-0">
                    <button
                      type="button"
                      onClick={() => toggle(group.key)}
                      aria-expanded={!collapsed.has(group.key)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <ChevronDownIcon
                        className={cn(
                          'size-4 shrink-0 text-slate-400 dark:text-slate-500 transition-transform',
                          collapsed.has(group.key) && '-rotate-90',
                        )}
                      />
                      <span className={cn('size-2 shrink-0 rounded-full', group.dot)} />
                      <span className="text-xs font-bold tracking-wide text-slate-600 dark:text-slate-300 uppercase">
                        {group.label}
                      </span>
                      <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                        {group.items.length} bundle{group.items.length === 1 ? '' : 's'} ·{' '}
                        {group.items.filter((p) => p.active).length} on sale
                      </span>
                      {/* Who supplies them. One name normally; more once the
                          catalogue spans providers, which it will as soon as
                          airtime arrives from somewhere other than DataHub. */}
                      <span className="ml-auto flex flex-wrap gap-1">
                        {group.providers.map((provider) => (
                          <span
                            key={provider}
                            className={cn(
                              'rounded-lg px-2 py-0.5 text-[11px] font-semibold',
                              provider === 'unassigned'
                                ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
                            )}
                          >
                            {provider === 'unassigned' ? 'no supplier' : provider}
                          </span>
                        ))}
                      </span>
                    </button>
                  </td>
                </tr>
                {!collapsed.has(group.key) &&
                  group.items.map((product) => {
              const drift = accuracyByKey.get(accuracyKey(product.name, product.network))
              /**
               * Whether the last real delivery is still telling us something
               * the catalogue doesn't already know. `drift.diff` compares
               * against what the catalogue believed back when that order was
               * placed, not against today's `product.supplierCost` — so a
               * catalogue that has since been corrected to match the real
               * charge would still show a leftover "different!" flag from
               * before the fix. Comparing the live cost directly is what
               * actually answers "is this still current."
               */
              const realCostIsCurrent = drift != null && drift.charged !== product.supplierCost
              const reviewStatus = reviewStatusOf(product)

              // Two margins, not one — what James keeps selling to an agent,
              // and what he keeps selling direct, at today's catalogue cost.
              // Neither of these is ever the agent's own cut of a resale.
              const rowAgentMargin = product.adminPrice - product.supplierCost
              const rowDirectMargin = product.standardPrice - product.supplierCost
              /**
               * The real floor, not the catalogue one — mirrors
               * `EditPricesModal` and the server's own check in
               * `AdminService.setTier`. A price sitting below catalogue but
               * at or above the last real charge is not wrong, it's exactly
               * what this whole feature exists to allow, so flagging it here
               * against catalogue alone used to mark a perfectly fine,
               * "Up to date" price as invalid the moment it actually used
               * the real-cost floor.
               */
              const floor = drift?.charged ?? product.supplierCost
              const invalid = product.adminPrice < floor || product.standardPrice < floor
              // Publishing needs a margin on both channels, not merely a legal
              // price — matches the server's own guard.
              const invalidToPublish = product.adminPrice <= floor || product.standardPrice <= floor
              // What James actually keeps at today's real cost — the number
              // to price against, since it's what genuinely lands in his
              // pocket, not what the catalogue assumes. Same two figures
              // `EditPricesModal` offers to protect when suggesting a new
              // price.
              const rowRealAgentMargin = realCostIsCurrent ? product.adminPrice - (drift as AccuracyRow).charged : null
              const rowRealDirectMargin = realCostIsCurrent ? product.standardPrice - (drift as AccuracyRow).charged : null
              const primaryAgentMargin = rowRealAgentMargin ?? rowAgentMargin
              const primaryDirectMargin = rowRealDirectMargin ?? rowDirectMargin
              return (
                <tr key={product.id} className={cn('hover:bg-slate-50 dark:hover:bg-slate-800', invalid && 'bg-red-50/50')}>
                  <Td>
                    <p className="font-medium text-slate-900 dark:text-slate-50">{product.name}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <NetworkChip network={product.network} />
                      <span className="text-xs text-slate-500 dark:text-slate-400">{product.validity}</span>
                    </div>
                  </Td>
                  <Td align="right" className="tabular text-slate-600 dark:text-slate-300">
                    {/* Whether James has actually reviewed this price against
                        the real cost currently on record — not whether the
                        catalogue is fresh, whether he's reviewed it. Silent
                        when there's no real cost to review against at all. */}
                    {reviewStatus !== 'none' && (
                      <Badge tone={reviewStatus === 'outdated' ? 'warning' : 'success'} className="mb-1">
                        {reviewStatus === 'outdated' ? 'Outdated' : 'Up to date'}
                      </Badge>
                    )}
                    {/* "Up to date as of when" — confirmed once, six months
                        ago, and confirmed this morning are not equally worth
                        trusting even though both count as current. */}
                    {reviewStatus === 'current' && product.pricedAgainstRealCostAt && (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                        reviewed {shortDate(product.pricedAgainstRealCostAt)}
                      </p>
                    )}
                    <br />
                    {cedis(product.supplierCost)}
                    {/* How stale the number above actually is — the catalogue
                        only ever knows what it was last told, and "synced
                        today" and "synced three months ago" are not the same
                        level of trust in it. */}
                    {product.supplierCostSyncedAt && (
                      <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                        synced {shortDate(product.supplierCostSyncedAt)}
                      </p>
                    )}
                    {/* The number above is only as fresh as the last provider
                        catalogue sync. This is what it actually cost on the
                        last real delivery, and when — worth seeing right where
                        the price gets set, not only on its own report page.
                        Gated on `realCostIsCurrent`, not `drift.diff`, so a
                        catalogue already corrected to match the real charge
                        doesn't keep showing a difference that isn't there
                        anymore. */}
                    {realCostIsCurrent && (
                      <p
                        className={cn(
                          'mt-0.5 text-[11px] font-medium',
                          (drift as AccuracyRow).charged < product.supplierCost
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400',
                        )}
                      >
                        Last real: {cedis((drift as AccuracyRow).charged)} ({shortDate((drift as AccuracyRow).lastSoldAt)})
                      </p>
                    )}
                  </Td>
                  <Td align="right" className="tabular font-bold text-slate-900 dark:text-slate-50">
                    {cedis(product.adminPrice)}
                  </Td>
                  <Td align="right">
                    {/* Leads with what actually lands in James's pocket, not
                        what the catalogue assumes — that's the number to price
                        against. Catalogue drops to a smaller line underneath
                        only when the real charge says something different, so
                        he can see exactly how much a price needs to move to
                        protect the margin he thinks he has. */}
                    <div className="flex flex-col items-end gap-0.5">
                      <div>
                        <span className="mr-1 text-[10px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 uppercase">
                          Agent
                        </span>
                        <span
                          className={cn(
                            'tabular font-semibold',
                            primaryAgentMargin > 0 ? 'text-brand-700 dark:text-brand-300' : 'text-red-600 dark:text-red-400',
                          )}
                        >
                          {primaryAgentMargin > 0 ? cedis(primaryAgentMargin, { sign: true }) : cedis(primaryAgentMargin)}
                        </span>
                      </div>
                      <div>
                        <span className="mr-1 text-[10px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 uppercase">
                          Direct
                        </span>
                        <span
                          className={cn(
                            'tabular font-semibold',
                            primaryDirectMargin > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                          )}
                        >
                          {primaryDirectMargin > 0 ? cedis(primaryDirectMargin, { sign: true }) : cedis(primaryDirectMargin)}
                        </span>
                      </div>
                      {realCostIsCurrent && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">
                          Catalogue: {cedis(rowAgentMargin, { sign: true })} / {cedis(rowDirectMargin, { sign: true })}
                        </p>
                      )}
                    </div>
                  </Td>
                  <Td align="right" className="tabular text-slate-600 dark:text-slate-300">
                    {cedis(product.standardPrice)}
                  </Td>
                  <Td align="right">
                    {/* Agent / walk-up. This is what survives a provider price
                        change, so it is worth seeing next to the prices. */}
                    <span className="tabular text-xs text-slate-500 dark:text-slate-400">
                      {product.agentMarkupBp === undefined
                        ? '—'
                        : `${formatMarkup(product.agentMarkupBp)} / ${formatMarkup(product.walkupMarkupBp ?? 0)}`}
                    </span>
                  </Td>
                  <Td align="center">
                    {/* The one place a bundle can be withdrawn from the shop without
                        touching its price. Publishing is refused server-side while a
                        price still sits at cost, so the control is disabled rather
                        than left to fail — with the reason on hover. */}
                    <Button
                      size="sm"
                      variant={product.active ? 'outline' : 'secondary'}
                      disabled={!product.active && invalidToPublish}
                      title={
                        !product.active && invalidToPublish
                          ? 'Set a price above what you pay before putting this on sale.'
                          : product.active
                            ? 'Take it off sale'
                            : 'Put it on sale'
                      }
                      onClick={() => void setProductOnSale(product.id, !product.active)}
                    >
                      {product.active ? 'On sale' : 'Off sale'}
                    </Button>
                  </Td>
                  <Td align="right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(product)}>
                      Edit
                    </Button>
                  </Td>
                </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <div id="supplier-catalogue" className="mt-3 scroll-mt-20">
        <ProviderCatalogue />
      </div>

      <MarkupModal
        open={marking}
        category={category}
        count={visible.length}
        onClose={() => setMarking(false)}
        onApplied={async (updated, agent, walkup) => {
          await refresh()
          refreshPending()
          pushToast({
            tone: 'success',
            title: `${updated} product${updated === 1 ? '' : 's'} repriced`,
            detail: `Agents pay cost + ${agent}%, walk-up cost + ${walkup}%.`,
          })
        }}
      />

      <EditPricesModal
        product={editing}
        drift={editing ? accuracyByKey.get(accuracyKey(editing.name, editing.network)) : undefined}
        onClose={() => setEditing(null)}
        onSave={(tier, value) => {
          if (editing) void updateProductTier(editing.id, tier, value).then(refreshPending)
        }}
      />

      <NotifyAgentsModal
        open={notifyOpen}
        changes={pendingChanges}
        onClose={() => setNotifyOpen(false)}
        onSent={(result) => {
          setNotifyOpen(false)
          refreshPending()
          pushToast({
            tone: result.agentsFailed > 0 ? 'info' : 'success',
            title: `Notified ${result.agentsEmailed} agent${result.agentsEmailed === 1 ? '' : 's'} about ${result.productsNotified} price${result.productsNotified === 1 ? '' : 's'}`,
            detail:
              result.agentsFailed > 0
                ? `${result.agentsFailed} email${result.agentsFailed === 1 ? '' : 's'} failed to send — check the server log.`
                : undefined,
          })
        }}
      />
    </div>
  )
}

function EditPricesModal({
  product,
  drift,
  onClose,
  onSave,
}: {
  product: Product | null
  drift: AccuracyRow | undefined
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

  /**
   * The real floor, not the catalogue one — mirrors `AdminService.setTier` on
   * the backend, which is the authoritative check. The catalogue's cost is
   * only ever as fresh as the last sync; the last real delivery is the honest
   * number to price against, whichever direction it moved. A price between
   * the two isn't underpriced when the real cost has genuinely come down, and
   * pricing down to a catalogue that hasn't caught up to a real cost rise
   * would quietly sell at a loss the catalogue can't see yet.
   */
  const floor = drift?.charged ?? product.supplierCost

  const save = () => {
    for (const tier of EDITABLE_TIERS) {
      if (parsed[tier] === null) {
        setError(`${TIER_LABELS[tier].label} needs to be a number like 5.50.`)
        return
      }
    }

    const agent = parsed.adminPrice as number
    const standard = parsed.standardPrice as number
    if (agent < floor) {
      setError(`Your price to agents cannot be below the ${cedis(floor)} you pay for it.`)
      return
    }
    // Only floored at cost. The walk-up price may sit below what agents pay —
    // that is a channel decision, not an error. See EDITABLE_TIERS above.
    if (standard < floor) {
      setError(`You pay ${cedis(floor)} for this, so you cannot sell it for less.`)
      return
    }

    for (const tier of EDITABLE_TIERS) onSave(tier, parsed[tier] as number)
    onClose()
  }

  // Measured against the real floor above, not the catalogue figure — a
  // margin over a number the catalogue hasn't caught up to yet would just be
  // a margin over the app's own optimism, not James's.
  const agentMargin = parsed.adminPrice !== null ? parsed.adminPrice - floor : null
  const directMargin = parsed.standardPrice !== null ? parsed.standardPrice - floor : null

  /**
   * The gap between today's catalogue cost and what the last real delivery
   * actually charged — compared against the *live* cost, not `drift.diff`,
   * which is frozen to whatever the catalogue believed back when that order
   * was placed. A catalogue already corrected since would still show a
   * leftover gap from `drift.diff` that has since closed; this hasn't.
   * Positive means the real charge came in lower than today's catalogue cost
   * (a saving); negative means it came in higher.
   */
  const realCostGap = drift ? product.supplierCost - drift.charged : 0
  const realCostIsCurrent = drift != null && realCostGap !== 0

  // Same status as the row this modal was opened from — see its own comment
  // on the table cell for why this is a value comparison, not a date one.
  const reviewStatus: 'none' | 'outdated' | 'current' =
    drift == null ? 'none' : product.pricedAgainstRealCost === drift.charged ? 'current' : 'outdated'

  return (
    <Modal open onClose={onClose} title={`Prices — ${product.name}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <NetworkChip network={product.network} />
          <span className="text-sm text-slate-500 dark:text-slate-400">{product.validity}</span>
        </div>

        {/* Read-only, because it is the provider's number and not ours. Shown
            first because it is the floor the three editable tiers sit above. */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{TIER_LABELS.supplierCost.label}</p>
            <div className="text-right">
              {reviewStatus !== 'none' && (
                <Badge tone={reviewStatus === 'outdated' ? 'warning' : 'success'} className="mb-1">
                  {reviewStatus === 'outdated' ? 'Outdated' : 'Up to date'}
                </Badge>
              )}
              <p className="tabular text-lg font-bold text-slate-900 dark:text-slate-50">
                {cedis(product.supplierCost)}
              </p>
              {/* The number that actually matters, right next to the one that
                  doesn't any more — repeated from the Callout below so it's
                  visible without reading the whole paragraph. Same colour
                  rule as the table row: green when the real charge is lower,
                  red when it's higher. */}
              {realCostIsCurrent && drift && (
                <p
                  className={cn(
                    'text-xs font-medium',
                    realCostGap > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                  )}
                >
                  Last real: {cedis(drift.charged)} ({shortDate(drift.lastSoldAt)})
                </p>
              )}
            </div>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {/* "Always matches what you are actually invoiced" is only true
                absent a known real-cost gap — asserting it while the gap
                above is on screen would be telling you the opposite of what
                you're looking at. */}
            {realCostIsCurrent ? (
              <>
                Comes from the supplier catalogue further down this page
                {product.supplierCostSyncedAt && <> · last synced {dateTime(product.supplierCostSyncedAt)}</>} — but
                the last real delivery, above, actually paid a different amount. See below.
              </>
            ) : (
              <>
                Comes from the supplier catalogue further down this page, so it always matches what you
                are actually invoiced — sync it there and it flows up here
                {product.supplierCostSyncedAt && <> · last synced {dateTime(product.supplierCostSyncedAt)}</>}.
              </>
            )}
            {reviewStatus === 'outdated' &&
              ' Saving a price below will mark this reviewed against the real cost currently on record.'}
          </p>
        </div>

        {/* The raw real-vs-catalogue fact already lives on the "Last real"
            line in the box above — repeating "on {date} this actually cost
            {X}, not {Y}" here would just be the same fact twice. This is for
            the part that isn't shown anywhere else: what that gap actually
            does to your margin, and what to do about it. See
            `AdminService.catalogueAccuracy` for where the real figure comes
            from. */}
        {realCostIsCurrent && drift && (
          <Callout
            tone={realCostGap > 0 ? 'success' : 'warning'}
            title="Your real margin here isn't what the catalogue suggests"
            icon={<TrendUpIcon className="size-4" />}
          >
            <p>
              Priced against the real cost, your margin is {cedis(product.adminPrice - drift.charged)} on
              an agent sale and {cedis(product.standardPrice - drift.charged)} on a walk-up sale — not
              the {cedis(product.adminPrice - product.supplierCost)} /{' '}
              {cedis(product.standardPrice - product.supplierCost)} the catalogue would suggest.
            </p>
            <p className="mt-1.5">
              {reviewStatus === 'outdated'
                ? /**
                   * Only makes sense while the price still reflects the OLD
                   * belief (catalogue cost) rather than this real charge —
                   * "pass on the saving"/"protect the margin" is relative to
                   * a price that hasn't reacted to the real number yet.
                   *
                   * Once `reviewStatus` is `current`, the price was already
                   * set knowing this exact real cost — it may deliberately
                   * sit nowhere near a catalogue-derived margin (thinner,
                   * because James chose to pass most of a saving on to
                   * agents, say), and subtracting the gap from it a second
                   * time double-counts an adjustment already made. That's
                   * exactly what suggested a price *below* the floor stated
                   * one sentence later.
                   */
                  realCostGap > 0
                  ? `If you'd rather pass the saving on and keep the same margin, agents could pay ${cedis(product.adminPrice - realCostGap)} and walk-up ${cedis(product.standardPrice - realCostGap)} — the fields below will let you go as low as ${cedis(drift.charged)}, since that's genuinely what this costs now.`
                  : `To protect the same margin at today's real cost, agents would need to pay ${cedis(product.adminPrice - realCostGap)} and walk-up ${cedis(product.standardPrice - realCostGap)} — the fields below won't accept anything under ${cedis(drift.charged)} any more, so a sale never quietly runs at a loss.`
                : `You've already priced this against the real cost — the fields below won't accept anything under ${cedis(drift.charged)}.`}
            </p>
          </Callout>
        )}

        {EDITABLE_TIERS.map((tier) => (
          <Field
            key={tier}
            label={TIER_LABELS[tier].label}
            htmlFor={`tier-${tier}`}
            hint={TIER_LABELS[tier].help}
          >
            <div className="relative">
              <span className="absolute inset-y-0 left-3.5 flex items-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                GHS
              </span>
              <TextInput
                id={`tier-${tier}`}
                inputMode="decimal"
                className="pl-13 font-bold"
                value={values[tier]}
                onChange={(event) => {
                  setValues((current) => ({
                    ...current,
                    [tier]: event.target.value,
                  }))
                  setError('')
                }}
              />
            </div>
          </Field>
        ))}

        {agentMargin !== null && directMargin !== null && (
          <div className="grid grid-cols-2 gap-3">
            <div
              className={cn(
                'rounded-xl px-3.5 py-3',
                agentMargin >= 0 ? 'bg-brand-50 dark:bg-brand-900/40' : 'bg-red-50 dark:bg-red-950/40',
              )}
            >
              <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
                Margin per agent sale
              </p>
              <p
                className={cn(
                  'tabular mt-0.5 text-lg font-bold',
                  agentMargin >= 0 ? 'text-brand-800 dark:text-brand-300' : 'text-red-700 dark:text-red-400',
                )}
              >
                {cedis(agentMargin, { sign: agentMargin >= 0 })}
              </p>
            </div>
            <div
              className={cn(
                'rounded-xl px-3.5 py-3',
                directMargin >= 0 ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'bg-red-50 dark:bg-red-950/40',
              )}
            >
              <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
                Margin per direct sale
              </p>
              <p
                className={cn(
                  'tabular mt-0.5 text-lg font-bold',
                  directMargin >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400',
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
          <p className="text-sm text-slate-500 dark:text-slate-400">
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
        <p className="text-sm text-slate-600 dark:text-slate-300">
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
              <span className="absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-slate-500 dark:text-slate-400">
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
              <span className="absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                %
              </span>
            </div>
          </Field>
        </div>

        {error && <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}

        {sample && valid && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5 text-sm">
            <p className="font-medium text-slate-900 dark:text-slate-50">{sample.name}</p>
            <p className="mt-1 text-slate-600 dark:text-slate-300">
              You pay {cedis(sample.supplierCost)} → agents{' '}
              <strong className="font-semibold text-slate-900 dark:text-slate-50">
                {cedis(priceFromMarkup(sample.supplierCost, Math.round(agentPercent * 100)))}
              </strong>
              , walk-up{' '}
              <strong className="font-semibold text-slate-900 dark:text-slate-50">
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

/**
 * The consolidated list, reviewed once before it goes anywhere.
 *
 * Nothing here is per-edit — each row is already the net change since agents
 * were last told (see `PendingPriceChange`), so what's shown is exactly what
 * would be emailed, not a history of how it got there.
 */
function NotifyAgentsModal({
  open,
  changes,
  onClose,
  onSent,
}: {
  open: boolean
  changes: Awaited<ReturnType<typeof api.pendingPriceChanges>>
  onClose: () => void
  onSent: (result: Awaited<ReturnType<typeof api.notifyPriceChanges>>) => void
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  // An upper bound, not an exact count — an agent stocking three of these
  // products is counted three times here, but only ever emailed once (the
  // server consolidates per agent when it actually sends).
  const maxAgents = changes.reduce((sum, c) => sum + c.affectedAgents, 0)
  const nobodyToTell = changes.every((c) => c.affectedAgents === 0)

  const send = async () => {
    setSending(true)
    setError('')
    try {
      const result = await api.notifyPriceChanges()
      onSent(result)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not send that.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Notify agents of price changes">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {changes.length} product{changes.length === 1 ? '' : 's'} changed since the last digest.
          Each agent below gets one email listing only the products they actually stock.
        </p>

        {nobodyToTell && (
          <Callout tone="info" icon={<AlertIcon className="size-4" />}>
            None of these products currently have an agent stocking them, so sending now would reach
            nobody. The list still clears once you send — that's fine, there's nothing left to tell
            anyone about.
          </Callout>
        )}

        <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <tbody>
              {changes.map((change) => (
                <tr
                  key={change.productId}
                  className="border-b border-slate-100 dark:border-slate-800 last:border-0"
                >
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-900 dark:text-slate-50">
                      {change.network ? `${change.network} ` : ''}
                      {change.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {change.affectedAgents} agent{change.affectedAgents === 1 ? '' : 's'} affected
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="tabular text-slate-500 dark:text-slate-400">
                      {cedis(change.baselinePrice)}
                    </span>{' '}
                    <span
                      className={cn(
                        'tabular font-semibold',
                        change.currentPrice > change.baselinePrice
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-emerald-600 dark:text-emerald-400',
                      )}
                    >
                      → {cedis(change.currentPrice)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && (
          <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
            {error}
          </Callout>
        )}

        <div className="flex gap-2">
          <Button block loading={sending} onClick={() => void send()}>
            Send to up to {maxAgents} agent{maxAgents === 1 ? '' : 's'}
          </Button>
          <Button block variant="outline" disabled={sending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
