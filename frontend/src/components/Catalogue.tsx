import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '../state/store'
import { useShopPath } from '../lib/shopPath'
import { cedis } from '../lib/format'
import { NETWORKS } from '../lib/networks'
import type { Category, Network, Product } from '../data/types'
import { CATEGORY_META, CATEGORY_ORDER } from './categories'
import { Badge, Button, Callout, Card, EmptyState, NetworkChip, cn } from './ui'
import { CertificateIcon, ChevronRightIcon, SearchIcon } from './icons'

interface AgentMargin {
  cost: number
  margin: number
  isDefault: boolean
}

/**
 * The buyable catalogue: category tabs, network filter and the product grid.
 *
 * Shared by the home page, /shop and every agent's sell link, so a bundle is
 * priced and presented identically wherever it is seen. FR-3.1, FR-3.2, FR-3.5.
 */
export default function Catalogue() {
  const { products, session, retailPrice, myBand, hasOwnPrice, sellerCode } = useStore()
  const [params, setParams] = useSearchParams()

  /**
   * Only categories that actually have something on sale get a tab.
   *
   * The six were hard-coded when the catalogue was seed data and every category
   * was guaranteed to be full. It is supplier-driven now — DataHub GH sells data
   * bundles, so airtime, voice, SMS, AFA and result checkers have nothing behind
   * them, and a tab leading to an empty grid reads as a broken shop rather than
   * as a service James does not currently offer. Wire up a supplier for one and
   * its tab comes back on its own.
   */
  const categories = CATEGORY_ORDER.filter((key) =>
    products.some((product) => product.active && product.category === key),
  )

  const requested = params.get('category') as Category | null
  const category =
    requested && categories.includes(requested) ? requested : (categories[0] ?? 'data')
  const network = params.get('network') as Network | null

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const isChecker = category === 'checker'
  const visible = products.filter(
    (product) =>
      product.active &&
      product.category === category &&
      (!network || isChecker || product.network === network),
  )

  const networksInCategory = NETWORKS.filter((n) =>
    products.some((p) => p.category === category && p.network === n),
  )

  // An agent browsing their own shop sees what each sale earns them. Anyone
  // shopping through somebody's sell link never does.
  const showMargins = session?.role === 'agent' && !sellerCode
  const marginFor = (product: Product): AgentMargin | null => {
    if (!showMargins) return null
    const band = myBand(product)
    return {
      cost: band.floor,
      margin: retailPrice(product, session.referralCode) - band.floor,
      isDefault: !hasOwnPrice(product.id),
    }
  }

  return (
    <>
      {/* Category tabs — horizontally scrollable on phones. Hidden entirely when
          only one category is on sale: a lone tab is a label, not a choice. */}
      {categories.length > 1 && (
      <div className="-mx-4 mb-4 overflow-x-auto px-4 pb-1">
        <div className="flex gap-2">
          {categories.map((key) => {
            const meta = CATEGORY_META[key]
            const active = key === category
            return (
              <button
                key={key}
                type="button"
                onClick={() => setParam('category', key)}
                aria-pressed={active}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-colors',
                  active
                    ? 'border-brand-600 bg-brand-700 text-white'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-slate-300',
                )}
              >
                <meta.icon className="size-4.5" />
                {meta.short}
              </button>
            )
          })}
        </div>
      </div>
      )}

      {/* Network filter (FR-3.2) */}
      {networksInCategory.length > 1 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Network</span>
          <button
            type="button"
            onClick={() => setParam('network', null)}
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
              onClick={() => setParam('network', n)}
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

      {/* NFR-7.1 — the disclaimer sits with the product, not only in the footer */}
      {isChecker && (
        <div className="mb-5">
          <Callout
            tone="warning"
            title="Independent reseller"
            icon={<CertificateIcon className="size-4" />}
          >
            JamesDataConsult sells genuine checker vouchers but is not affiliated with, endorsed by,
            or acting on behalf of WAEC. Vouchers are single-use and non-refundable once revealed.
          </Callout>
        </div>
      )}

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<SearchIcon className="size-6" />}
            title="Nothing here yet"
            detail="No products in this category for the selected network. Try 'All' or another network."
            action={
              <Button variant="outline" onClick={() => setParam('network', null)}>
                Show all networks
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              price={retailPrice(product)}
              agentMargin={marginFor(product)}
            />
          ))}
        </ul>
      )}
    </>
  )
}

function ProductCard({
  product,
  price,
  agentMargin,
}: {
  product: Product
  price: number
  agentMargin: AgentMargin | null
}) {
  const shopPath = useShopPath()

  return (
    <Card as="li" className="transition-shadow hover:shadow-md">
      <Link to={shopPath(`/buy/${product.id}`)} className="flex h-full flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-50">{product.name}</p>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{product.validity}</p>
          </div>
          <NetworkChip network={product.network} />
        </div>

        <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-3.5">
          <div>
            <p className="tabular text-xl font-bold tracking-tight text-brand-800 dark:text-brand-300">
              {cedis(price)}
            </p>
            {agentMargin && (
              <p className="tabular mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                you pay {cedis(agentMargin.cost)} ·{' '}
                <span
                  className={
                    agentMargin.margin > 0 ? 'font-semibold text-brand-700 dark:text-brand-300' : 'text-amber-700 dark:text-amber-400'
                  }
                >
                  {agentMargin.margin > 0
                    ? `you keep ${cedis(agentMargin.margin).replace('GHS ', '')}`
                    : 'at cost'}
                </span>
                {agentMargin.isDefault && <span className="text-slate-500 dark:text-slate-400"> · default</span>}
              </p>
            )}
          </div>
          {/* Golden Yellow marks the action on the card — the one thing the
              buyer is here to press. */}
          <Badge tone="accent" className="gap-0.5">
            Buy <ChevronRightIcon className="size-3.5" />
          </Badge>
        </div>
      </Link>
    </Card>
  )
}

