import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '../state/store'
import { useShopPath } from '../lib/shopPath'
import { useBranding } from '../state/branding'
import { cedis } from '../lib/format'
import { NETWORKS } from '../lib/networks'
import type { Category, Network, Product } from '../data/types'
import type { TileButtonStyle, TileNetworkIndicator, TileStyle } from '../lib/api'
import { CATEGORY_META, CATEGORY_ORDER } from './categories'
import { Button, Callout, Card, EmptyState, cn } from './ui'
import { TileBuyButton, TileNetworkBadge } from './TileStylePicker'
import { CertificateIcon, SearchIcon } from './icons'

/**
 * Whether a bundle belongs in the shop: exactly what a customer would see.
 * An admin's catalogue carries every product (for Prices), with
 * `onSaleToCustomers` saying which of them customers actually get.
 */
export function onSale(product: Product): boolean {
  return product.onSaleToCustomers ?? product.active
}

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
  const { tileStyle, tileButtonStyle, tileNetworkIndicator } = useBranding()
  const [params, setParams] = useSearchParams()

  /**
   * Only categories that actually have something on sale get a tab.
   *
   * The six were hard-coded when the catalogue was seed data and every category
   * was guaranteed to be full. It is supplier-driven now, DataHub GH sells data
   * bundles, so airtime, voice, SMS, AFA and result checkers have nothing behind
   * them, and a tab leading to an empty grid reads as a broken shop rather than
   * as a service James does not currently offer. Wire up a supplier for one and
   * its tab comes back on its own.
   */
  const categories = CATEGORY_ORDER.filter((key) =>
    products.some((product) => onSale(product) && product.category === key),
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

  /**
   * Switching category without clearing `network` left a filter active that
   * has nothing to do with the tab just opened, a customer on "Data,
   * AirtelTigo" tapping "Airtime" got an empty grid with no visible filter
   * to explain why, since AirtelTigo airtime may not exist while the network
   * pill itself was gone from view for a category with only one network.
   */
  const setCategory = (key: Category) => {
    const next = new URLSearchParams(params)
    next.set('category', key)
    next.delete('network')
    setParams(next, { replace: true })
  }

  const isChecker = category === 'checker'
  const visible = products.filter(
    (product) =>
      onSale(product) &&
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
      {/* Category tabs, horizontally scrollable on phones. Hidden entirely when
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
                onClick={() => setCategory(key)}
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
        <div className="-mx-4 mb-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:mb-5 sm:flex-wrap sm:px-0">
          <span className="shrink-0 text-sm font-medium text-slate-500 dark:text-slate-400">Network</span>
          <button
            type="button"
            onClick={() => setParam('network', null)}
            aria-pressed={!network}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold',
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
                'shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold',
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

      {/* NFR-7.1, the disclaimer sits with the product, not only in the footer */}
      {isChecker && (
        <div className="mb-5">
          <Callout
            tone="warning"
            title="Independent reseller"
            icon={<CertificateIcon className="size-4" />}
          >
            JKBK DATA HUB sells genuine checker vouchers but is not affiliated with, endorsed by,
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
        <ul className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              price={retailPrice(product)}
              agentMargin={marginFor(product)}
              tileStyle={tileStyle}
              tileButtonStyle={tileButtonStyle}
              tileNetworkIndicator={tileNetworkIndicator}
            />
          ))}
        </ul>
      )}
    </>
  )
}

/** The "you pay / you keep" line an agent sees on their own catalogue. Identical across every tile style. */
function AgentMarginLine({ agentMargin }: { agentMargin: AgentMargin }) {
  return (
    <p className="tabular mt-0.5 text-xs text-slate-500 dark:text-slate-400">
      you pay {cedis(agentMargin.cost)} ·{' '}
      <span
        className={
          agentMargin.margin > 0 ? 'font-semibold text-brand-700 dark:text-brand-300' : 'text-amber-700 dark:text-amber-400'
        }
      >
        {agentMargin.margin > 0 ? `you keep ${cedis(agentMargin.margin).replace('GHS ', '')}` : 'at cost'}
      </span>
      {agentMargin.isDefault && <span className="text-slate-500 dark:text-slate-400"> · default</span>}
    </p>
  )
}

/**
 * One bundle, in whichever of the four curated layouts the shop has chosen
 * (see `lib/tileStyles.ts`), applied instantly by the agent, no admin
 * review. Pricing and the buy link are identical across all four; the "Buy"
 * treatment and the network indicator are each their own independent axis
 * (`TileBuyButton`/`TileNetworkBadge`, shared with the branding picker's own
 * preview so the two can never disagree), only the card's own arrangement is
 * tied to `tileStyle` itself.
 */
/**
 * What a customer scans for: the size. "TELECEL(10GB)", "10GB Data" and
 * "MTN 10GB" are the same thing to a buyer, so the size leads, large, and
 * the network sits beside it as the chip it already is. Anything else the
 * name says (iShare, a checker's exam) is kept on the line underneath.
 */
export function bundleTitle(product: Product): { title: string; detail: string } {
  const size = /(\d+(?:\.\d+)?)\s*GB/i.exec(product.name)
  if (product.category !== 'data' || !size) return { title: product.name, detail: product.validity }
  const extra = /ishare/i.test(product.name) ? 'iShare' : ''
  return { title: `${size[1]}GB`, detail: [extra, product.validity].filter(Boolean).join(' · ') || 'Data bundle' }
}

/**
 * One bundle, in whichever of the four curated layouts the shop has chosen
 * (see `lib/tileStyles.ts`). Pricing and the buy link are identical across
 * all four; the "Buy" treatment and the network indicator are their own
 * axes (`TileBuyButton`/`TileNetworkBadge`, shared with the branding
 * picker's preview).
 *
 * Built to sit two to a row on a phone: one per row made a 70-bundle shop
 * an endless scroll of mostly empty cards. So the network chip sits on top,
 * the size underneath it in large type, then price and Buy, every line short
 * enough for half a 390px screen, and the whole tile is the tap target.
 */
function ProductCard({
  product,
  price,
  agentMargin,
  tileStyle,
  tileButtonStyle,
  tileNetworkIndicator,
}: {
  product: Product
  price: number
  agentMargin: AgentMargin | null
  tileStyle: TileStyle
  tileButtonStyle: TileButtonStyle
  tileNetworkIndicator: TileNetworkIndicator
}) {
  const shopPath = useShopPath()
  const href = shopPath(`/buy/${product.id}`)
  const { title, detail } = bundleTitle(product)
  const style = {
    classic: { card: 'transition-shadow hover:shadow-md', head: '', body: 'p-3 sm:p-4', price: 'text-brand-800 dark:text-brand-300' },
    bold: {
      card: 'overflow-hidden transition-shadow hover:shadow-md',
      head: 'bg-brand-50 px-3 py-2 sm:px-4 dark:bg-brand-900/30',
      body: 'p-3 sm:p-4',
      price: 'text-slate-900 dark:text-slate-50',
    },
    minimal: { card: 'border-slate-100 shadow-none dark:border-slate-800', head: '', body: 'p-3 sm:p-5', price: 'text-slate-900 dark:text-slate-50' },
    compact: { card: 'transition-shadow hover:shadow-md', head: '', body: 'p-2.5 sm:p-3', price: 'text-brand-800 dark:text-brand-300' },
  }[tileStyle]
  const big = tileStyle === 'compact' ? 'text-lg sm:text-xl' : 'text-xl sm:text-2xl'

  return (
    <Card as="li" className={style.card}>
      <Link to={href} className="flex h-full flex-col" aria-label={`${product.network ?? ''} ${product.name}, ${cedis(price)}`}>
        {style.head ? (
          <div className={cn('flex items-center justify-between gap-2', style.head)}>
            <TileNetworkBadge network={product.network} indicator={tileNetworkIndicator} />
          </div>
        ) : null}
        <div className={cn('flex flex-1 flex-col', style.body)}>
          {!style.head && (
            <div className="mb-1.5">
              <TileNetworkBadge network={product.network} indicator={tileNetworkIndicator} />
            </div>
          )}
          <p className={cn('font-extrabold leading-tight tracking-tight break-words text-slate-900 dark:text-slate-50', big)}>
            {title}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{detail}</p>
          <div
            className={cn(
              'mt-auto flex flex-wrap items-end justify-between gap-x-2 gap-y-1.5 pt-3',
              tileStyle !== 'minimal' && 'mt-3 border-t border-slate-100 dark:border-slate-800',
            )}
          >
            <div className="min-w-0">
              <p className={cn('tabular text-base font-bold tracking-tight sm:text-lg', style.price)}>{cedis(price)}</p>
              {agentMargin && <AgentMarginLine agentMargin={agentMargin} />}
            </div>
            <TileBuyButton buttonStyle={tileButtonStyle} small />
          </div>
        </div>
      </Link>
    </Card>
  )
}
