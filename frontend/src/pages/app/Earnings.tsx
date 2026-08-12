import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
import type { EarningType } from '../../data/types'
import { agentEarningsByDay } from '../../data/mock'
import { BarChart } from '../../components/charts'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  PageHead,
  Segmented,
  StatTile,
  TableWrap,
  Td,
  Th,
  cn,
} from '../../components/ui'
import {
  AlertIcon,
  CashIcon,
  StoreIcon,
  TrendUpIcon,
  UsersIcon,
} from '../../components/icons'

const TYPE_META: Record<
  EarningType,
  { label: string; tone: 'success' | 'info' | 'danger' | 'warning' }
> = {
  sale: { label: 'Your sale', tone: 'success' },
  downline: { label: 'Downline', tone: 'info' },
  reversal: { label: 'Reversed', tone: 'danger' },
  withdrawal: { label: 'Withdrawal', tone: 'warning' },
}

/**
 * An agent's earnings account. Money arrives here automatically as each sale
 * in their chain completes — they never pre-fund anything, so there is no
 * top-up on this page by design.
 */
export default function Earnings() {
  const { agentBalance, earnings } = useStore()
  const [filter, setFilter] = useState<'all' | EarningType>('all')

  const visible = filter === 'all' ? earnings : earnings.filter((e) => e.type === filter)

  const own = earnings.filter((e) => e.type === 'sale').reduce((s, e) => s + e.amount, 0)
  const downline = earnings.filter((e) => e.type === 'downline').reduce((s, e) => s + e.amount, 0)
  const reversed = earnings
    .filter((e) => e.type === 'reversal')
    .reduce((s, e) => s + Math.abs(e.amount), 0)
  const withdrawn = earnings
    .filter((e) => e.type === 'withdrawal')
    .reduce((s, e) => s + Math.abs(e.amount), 0)

  return (
    <div>
      <PageHead
        title="Earnings"
        subtitle="Your margin lands here the moment each order completes."
        action={
          <Link to="/app/withdrawals">
            <Button size="lg">
              <CashIcon className="size-4" /> Withdraw
            </Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-brand-700 p-4 text-white sm:col-span-2 lg:col-span-1">
          <p className="text-sm text-brand-100">Available to withdraw</p>
          <p className="tabular mt-2 text-3xl font-bold tracking-tight">{cedis(agentBalance)}</p>
          <p className="mt-1 text-xs text-brand-100/80">Paid out to your MoMo on request</p>
        </Card>
        <StatTile
          label="From your own sales"
          value={cedis(own)}
          icon={<StoreIcon className="size-5" />}
        />
        <StatTile
          label="From your downline"
          value={cedis(downline)}
          hint="Agents you registered, and theirs"
          tone="brand"
          icon={<UsersIcon className="size-5" />}
        />
        <StatTile
          label="Withdrawn to date"
          value={cedis(withdrawn)}
          hint={reversed > 0 ? `${cedis(reversed)} reversed on failures` : undefined}
          icon={<TrendUpIcon className="size-5" />}
        />
      </div>

      {/* The model, stated once where it matters most. */}
      <div className="mt-3">
        <Callout tone="info" icon={<AlertIcon className="size-4" />} title="How this works">
          You do not buy stock or hold a float. When someone buys through your sell link, the
          platform takes the payment and credits you the difference between your price and what you
          pay — instantly. Everyone above you is paid their own margin the same way.
        </Callout>
      </div>

      <Card className="mt-3">
        <CardHead title="Earnings, last 7 days" subtitle="Your own sales plus your downline" />
        <div className="p-4 sm:p-5">
          <BarChart data={agentEarningsByDay} />
        </div>
      </Card>

      <Card className="mt-3">
        <CardHead
          title="Earnings ledger"
          subtitle="Every credit, reversal and withdrawal."
          action={
            <Segmented
              options={[
                { value: 'all', label: 'All' },
                { value: 'sale', label: 'My sales' },
                { value: 'downline', label: 'Downline' },
                { value: 'withdrawal', label: 'Withdrawals' },
              ]}
              value={filter}
              onChange={(next) => setFilter(next as 'all' | EarningType)}
              className="hidden sm:inline-flex"
            />
          }
        />
        <TableWrap>
          <thead>
            <tr>
              <Th>Description</Th>
              <Th>Type</Th>
              <Th>Reference</Th>
              <Th align="right">Amount</Th>
              <Th align="right">Balance after</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => (
              <tr key={entry.id} className="hover:bg-slate-50">
                <Td>
                  <p className="font-medium text-slate-900">{entry.description}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {dateTime(entry.createdAt)}
                    {entry.depth > 0 && ` · ${entry.depth} level${entry.depth > 1 ? 's' : ''} below you`}
                  </p>
                </Td>
                <Td>
                  <Badge tone={TYPE_META[entry.type].tone}>{TYPE_META[entry.type].label}</Badge>
                </Td>
                <Td className="tabular text-xs text-slate-500">{entry.reference}</Td>
                <Td align="right">
                  <span
                    className={cn(
                      'tabular font-semibold',
                      entry.amount > 0 ? 'text-emerald-700' : 'text-slate-800',
                    )}
                  >
                    {cedis(entry.amount, { sign: true })}
                  </span>
                </Td>
                <Td align="right" className="tabular text-slate-600">
                  {cedis(entry.balanceAfter)}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        {/* NFR-2.6 */}
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          This ledger is append-only. Entries cannot be edited or deleted, by you or by us — a
          correction is always a new entry.
        </p>
      </Card>
    </div>
  )
}
