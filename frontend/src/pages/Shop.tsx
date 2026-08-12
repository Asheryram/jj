import { useStore } from '../state/store'
import Catalogue, { SellerBanner } from '../components/Catalogue'
import { PageHead } from '../components/ui'

/**
 * The catalogue on its own, with no marketing around it. Used for `/shop` and
 * as the body of an agent's sell link. The home page shows the same catalogue
 * with a hero above it — buying is never more than one page away.
 */
export default function Shop() {
  const { session, sellerCode, sellerName } = useStore()
  const browsingOwnShop = session?.role === 'agent' && !sellerCode

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <PageHead
        title={sellerName && sellerCode ? `Buy from ${sellerName}` : 'Buy a bundle'}
        subtitle={
          browsingOwnShop
            ? 'These are your own resale prices. Your margin is shown on each card.'
            : 'Pick a category, then a bundle. No account needed — pay with Mobile Money.'
        }
      />
      <SellerBanner />
      <Catalogue />
    </div>
  )
}
