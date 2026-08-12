import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '../state/store'
import { initials } from '../lib/format'
import Catalogue from '../components/Catalogue'
import { Button, Card, EmptyState } from '../components/ui'
import { SearchIcon, ShieldIcon } from '../components/icons'

/**
 * An agent's sell link — `/s/KWAME77`.
 *
 * This is the channel that makes the reseller chain work without the agent
 * handling money. A customer opens the link, buys at this agent's price, and
 * every upline is credited their own margin automatically (FR-5.7, FR-5.8).
 * Distinct from the referral link at `/register?ref=CODE`, which recruits
 * agents rather than selling to customers.
 */
export default function Storefront() {
  const { code } = useParams()
  const { pricingAgents, setSellerCode, sellerCode } = useStore()

  const agent = pricingAgents.find(
    (a) => a.referralCode.toUpperCase() === (code ?? '').toUpperCase(),
  )

  useEffect(() => {
    if (agent && agent.referralCode !== sellerCode) setSellerCode(agent.referralCode)
  }, [agent, sellerCode, setSellerCode])

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

  return (
    <>
      {/* Agent's storefront header — the customer should know who they're buying from. */}
      <div className="border-b border-slate-200 bg-brand-700">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-6">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-lg font-bold text-white">
            {initials(agent.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-brand-100">Authorised JamesDataConsult agent</p>
            <p className="text-xl font-bold text-white">{agent.name}</p>
            <p className="mt-0.5 font-mono text-xs text-brand-100/80">{agent.referralCode}</p>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-brand-100">
            <ShieldIcon className="size-4" />
            Payments handled by Paystack
          </p>
        </div>
      </div>
      {/* Straight into the catalogue at this agent's prices. No account needed. */}
      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <Catalogue />
      </div>
    </>
  )
}
