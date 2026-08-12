import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '../state/store'
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

  const category = (params.get('category') as Category | null) ?? 'data'
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
      {/* Category tabs — horizontally scrollable on phones */}
      <div className="-mx-4 mb-4 overflow-x-auto px-4 pb-1">
        <div className="flex gap-2">
          {CATEGORY_ORDER.map((key) => {
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
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                )}
              >
                <meta.icon className="size-4.5" />
                {meta.short}
              </button>
            )
          })}
        </div>
      </div>

      {/* Network filter (FR-3.2) */}
      {networksInCategory.length > 1 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-500">Network</span>
          <button
            type="button"
            onClick={() => setParam('network', null)}
            aria-pressed={!network}
            className={cn(
              'rounded-full border px-3 py-1 text-sm font-semibold',
              !network
                ? 'border-slate-800 bg-slate-800 text-white'
                : 'border-slate-200 bg-white text-slate-600',
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
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-200 bg-white text-slate-600',
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
  return (
    <Card as="li" className="transition-shadow hover:shadow-md">
      <Link to={`/buy/${product.id}`} className="flex h-full flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-slate-900">{product.name}</p>
            <p className="mt-0.5 text-sm text-slate-500">{product.validity}</p>
          </div>
          <NetworkChip network={product.network} />
        </div>

        <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 pt-3.5">
          <div>
            <p className="tabular text-xl font-bold tracking-tight text-brand-800">
              {cedis(price)}
            </p>
            {agentMargin && (
              <p className="tabular mt-0.5 text-xs text-slate-500">
                you pay {cedis(agentMargin.cost)} ·{' '}
                <span
                  className={
                    agentMargin.margin > 0 ? 'font-semibold text-brand-700' : 'text-amber-700'
                  }
                >
                  {agentMargin.margin > 0
                    ? `you keep ${cedis(agentMargin.margin).replace('GHS ', '')}`
                    : 'at cost'}
                </span>
                {agentMargin.isDefault && <span className="text-slate-400"> · default</span>}
              </p>
            )}
          </div>
          <Badge tone="brand" className="gap-0.5">
            Buy <ChevronRightIcon className="size-3.5" />
          </Badge>
        </div>
      </Link>
    </Card>
  )
}

/** Shown wherever a sell link is in force, so the buyer knows whose shop it is. */
export function SellerBanner() {
  const { sellerCode, sellerName, setSellerCode } = useStore()
  if (!sellerCode || !sellerName) return null

  return (
    <Callout tone="success" className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          You are buying from <strong className="font-bold">{sellerName}</strong> — the prices here
          are theirs.
        </span>
        <button
          type="button"
          onClick={() => setSellerCode(null)}
          className="font-semibold underline"
        >
          Use standard prices instead
        </button>
      </div>
    </Callout>
  )
}
