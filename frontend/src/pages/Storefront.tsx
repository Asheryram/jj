import { useEffect } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import { useStore } from '../state/store'
import { Button, Card, EmptyState } from '../components/ui'
import { SearchIcon } from '../components/icons'

/**
 * The agent-scoped branch of the public shop — everything under `/s/KWAME77`.
 *
 * This is the channel that makes the reseller network work without the agent
 * handling money. A customer opens the link, buys at this agent's price, and the
 * agent's margin is credited automatically (FR-5.7, FR-5.8). Distinct from the
 * referral link at `/register?ref=CODE`, which recruits agents rather than
 * selling to customers.
 *
 * It renders no chrome of its own. The pages beneath it are the same Home, Shop
 * and Checkers the platform serves, priced through this agent — the only
 * difference a buyer sees is the price and the URL. An earlier version put a
 * branded agent header above the catalogue and a "shopping with…" banner on every
 * page; both were removed as noise. The URL already says whose shop it is, and
 * the disclosure that matters legally lives in the footer.
 *
 * Its one job is to put the code into the store before the children render, so
 * they price against the right agent on first paint rather than flashing platform
 * prices and correcting themselves.
 */
export default function Storefront() {
  const { code } = useParams()
  const { pricingAgents, setSellerCode, sellerCode, ready } = useStore()

  const wanted = (code ?? '').toUpperCase()
  const agent = pricingAgents.find((a) => a.referralCode.toUpperCase() === wanted)

  useEffect(() => {
    if (agent && agent.referralCode !== sellerCode) setSellerCode(agent.referralCode)
  }, [agent, sellerCode, setSellerCode])

  // The agent list arrives with the catalogue. Until it does, an unknown code is
  // indistinguishable from a valid one, so wait rather than accuse the link.
  if (!ready) return null

  if (!agent) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Card>
          <EmptyState
            icon={<SearchIcon className="size-6" />}
            title="We do not recognise that link"
            detail={`No agent has the code "${code}". The link may have a typo, or the agent's account may have been closed. You can still buy at our standard prices.`}
            action={
              <Link to="/shop">
                <Button>Go to the shop</Button>
              </Link>
            }
          />
        </Card>
      </div>
    )
  }

  return <Outlet />
}
