import { useStore } from '../../state/store'
import { referralLinkFor, sellLinkFor } from '../../lib/origin'
import { cedis, longDate } from '../../lib/format'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  CopyField,
  EmptyState,
  PageHead,
  StatTile,
  TableWrap,
  Td,
  Th,
} from '../../components/ui'
import { StoreIcon, UsersIcon, WhatsAppIcon } from '../../components/icons'


/** FR-1.7, FR-5.1, FR-5.2, FR-5.4, FR-5.6, FR-5.7 */
export default function Referrals() {
  const { session, referralEnabled, referralRatePercent, subAgents } = useStore()
  if (!session) return null

  // Two different links doing two different jobs.
  const sellLink = sellLinkFor(session.referralCode)
  const referralLink = referralLinkFor(session.referralCode)

  const direct = subAgents.filter((a) => a.uplineCode === session.referralCode)
  const indirect = subAgents.filter((a) => a.uplineCode !== session.referralCode)
  const active = subAgents.filter((a) => a.status === 'active')
  const totalVolume = subAgents.reduce((sum, a) => sum + a.volume, 0)
  const earnedFromDownline = subAgents.reduce((sum, a) => sum + a.earnedForUpline, 0)

  const shareSell = encodeURIComponent(
    `Buy data, airtime and result checkers from me — instant delivery: ${sellLink}`,
  )
  const shareRefer = encodeURIComponent(
    `Start selling data bundles at your own prices with JamesDataConsult. Sign up with my link: ${referralLink}`,
  )

  return (
    <div>
      <PageHead
        title="Sell &amp; refer"
        subtitle="One link sells to customers. The other recruits agents under you."
      />

      {/* ── The sell link. This is how an agent actually makes money. ── */}
      <Card className="overflow-hidden">
        <div className="bg-brand-700 px-5 py-5 text-white">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-100">
            <StoreIcon className="size-4" /> YOUR SELL LINK
          </p>
          <p className="mt-1.5 text-lg font-bold">Send this to customers</p>
          <p className="mt-1 text-sm text-brand-50/90">
            They buy at your prices and pay directly. Your margin lands in your earnings the moment
            the order completes — you never touch the money or hold any stock.
          </p>
        </div>
        <div className="space-y-3 p-4 sm:p-5">
          <CopyField label="Sell link" value={sellLink} />
          <a href={`https://wa.me/?text=${shareSell}`} target="_blank" rel="noreferrer" className="block">
            <Button block size="lg" variant="whatsapp">
              <WhatsAppIcon className="size-5" /> Share my shop on WhatsApp
            </Button>
          </a>
        </div>
      </Card>

      {/* ── The referral link. Recruiting, not selling. ── */}
      <Card className="mt-3">
        <CardHead
          title="Your referral link"
          subtitle="For people who want to sell, not buy. They become agents under you."
        />
        <div className="space-y-3 p-4 sm:p-5">
          <CopyField label="Referral code" value={session.referralCode} mono />
          <CopyField label="Referral link" value={referralLink} />
          <a href={`https://wa.me/?text=${shareRefer}`} target="_blank" rel="noreferrer" className="block">
            <Button block variant="outline">
              <WhatsAppIcon className="size-5" /> Invite an agent on WhatsApp
            </Button>
          </a>
        </div>
      </Card>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Agents under you"
          value={String(active.length)}
          hint={`${direct.length} direct · ${indirect.length} deeper`}
          tone="brand"
          icon={<UsersIcon className="size-5" />}
        />
        <StatTile label="Their total volume" value={cedis(totalVolume)} />
        <StatTile
          label="You earned from them"
          value={cedis(earnedFromDownline)}
          hint="Your margin on their sales"
          tone="success"
        />
      </div>

      {/* FR-5.4 / FR-5.5 / FR-5.6 */}
      <div className="mt-3">
        {referralEnabled ? (
          <Callout tone="success" title={`You earn a ${referralRatePercent}% bonus on their sales`}>
            Every time an agent you brought in makes a sale, you are paid a bonus — and it comes out
            of James's margin, not theirs. Your own selling price and theirs are untouched, so
            inviting people costs you and them nothing.
          </Callout>
        ) : (
          <Callout tone="info" title="Referral bonuses are switched off">
            You can still invite agents and they will show up here, but no bonus is paid on their
            sales at the moment. James can switch this on without anything changing for you.
          </Callout>
        )}
      </div>

      {/* FR-5.2 */}
      <Card className="mt-3">
        <CardHead
          title="Agents in your chain"
          subtitle={`${subAgents.length} in total`}
          action={<Badge tone="brand">{active.length} active</Badge>}
        />
        {subAgents.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="size-6" />}
            title="No agents yet"
            detail="Share your referral link on WhatsApp and the people who join will appear here."
          />
        ) : (
          <TableWrap caption="Agents in your referral chain">
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Joined via</Th>
                <Th align="right">Orders</Th>
                <Th align="right">Volume</Th>
                <Th align="right">You earned</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {subAgents.map((agent) => {
                const isDirect = agent.uplineCode === session.referralCode
                return (
                  <tr key={agent.id} className="hover:bg-slate-50">
                    <Td>
                      <div className="flex items-center gap-2">
                        {!isDirect && <span className="text-slate-300">↳</span>}
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{agent.name}</p>
                          <p className="tabular mt-0.5 text-xs text-slate-500">{agent.phone}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {isDirect ? (
                        <Badge tone="brand">You</Badge>
                      ) : (
                        <span className="text-sm text-slate-600">
                          {subAgents.find((a) => a.referralCode === agent.uplineCode)?.name ?? '—'}
                        </span>
                      )}
                    </Td>
                    <Td align="right" className="tabular">
                      {agent.orders}
                    </Td>
                    <Td align="right" className="tabular text-slate-600">
                      {cedis(agent.volume)}
                    </Td>
                    <Td align="right" className="tabular font-semibold text-brand-700">
                      {cedis(agent.earnedForUpline)}
                    </Td>
                    <Td>
                      <Badge tone={agent.status === 'active' ? 'success' : 'danger'}>
                        {agent.status === 'active' ? 'Active' : 'Suspended'}
                      </Badge>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
        )}
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          Joined dates run from {longDate(subAgents[subAgents.length - 1].joinedAt)} to{' '}
          {longDate(subAgents[0].joinedAt)}.
        </p>
      </Card>

      {/* FR-5.3 — say clearly that there is no commission to wait for. */}
      <div className="mt-3">
        <Callout tone="info" title="How you earn">
          There is no commission to calculate or wait for. You pay your upline&apos;s price and charge
          your own — the gap is yours. When an agent below you sells, they pay your price, so your
          margin is already inside their cost. Everybody in the chain is paid at the same instant the
          order completes.
        </Callout>
      </div>
    </div>
  )
}
