import { Link } from 'react-router-dom'
import { Delta, Kpi, Legend, PALETTE, StackedColumns } from '../../../components/insightCharts'
import { Badge } from '../../../components/ui'
import type { Insights } from '../../../lib/api'
import { bucketLabel, cedis, count, hoursText, MiniStat, Panel, pct } from './shared'

function since(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

export default function AgentsTab({ data }: { data: Insights }) {
  const { agents, meta } = data
  const labels = agents.series.map((s) => bucketLabel(s.bucket, meta.granularity))
  const top = agents.leaderboard[0]
  const topShare = top ? top.profit / Math.max(1, agents.leaderboard.reduce((sum, a) => sum + a.profit, 0)) : 0

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Agents who sold" value={count(agents.kpis.activeAgents.value)} compared={agents.kpis.activeAgents} emphasis />
        <Kpi label="Profit from agent sales" value={pct(agents.kpis.profitShare.value)} compared={agents.kpis.profitShare} points hint="of all profit" />
        <Kpi label="Agents earned" value={cedis(agents.kpis.agentEarnings.value)} compared={agents.kpis.agentEarnings} />
        <Kpi label="New agents joined" value={count(agents.kpis.newAgents.value)} />
      </div>

      <Panel
        question="Who are the best agents?"
        answer={
          top
            ? `${top.name} brought ${cedis(top.profit)} profit${topShare > 0.4 ? `, ${pct(topShare * 100)} of all agent profit. That's a lot riding on one agent.` : '.'}`
            : 'No agent sold anything in this period.'
        }
      >
        {agents.leaderboard.length > 0 ? (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                  <th className="px-1 pb-2 font-medium">Agent</th>
                  <th className="px-1 pb-2 text-right font-medium">Orders</th>
                  <th className="px-1 pb-2 text-right font-medium">Sales</th>
                  <th className="px-1 pb-2 text-right font-medium">Your profit</th>
                  <th className="px-1 pb-2 text-right font-medium">They earned</th>
                  <th className="px-1 pb-2 text-right font-medium">Last sale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {agents.leaderboard.map((a, i) => (
                  <tr key={a.agentId}>
                    <td className="px-1 py-2">
                      <span className="mr-2 text-xs text-slate-400 tabular-nums">{i + 1}</span>
                      <span className="font-medium text-slate-800 dark:text-slate-100">{a.name}</span>
                      {a.status !== 'active' && <Badge tone="warning" className="ml-2">{a.status}</Badge>}
                    </td>
                    <td className="px-1 py-2 text-right tabular-nums">{count(a.orders)}</td>
                    <td className="px-1 py-2 text-right tabular-nums">{cedis(a.revenue)}</td>
                    <td className="px-1 py-2 text-right">
                      <span className="font-semibold tabular-nums">{cedis(a.profit)}</span>
                      <span className="ml-1.5"><Delta value={a.profit} previous={a.previousProfit} /></span>
                    </td>
                    <td className="px-1 py-2 text-right tabular-nums">{cedis(a.earnings)}</td>
                    <td className="px-1 py-2 text-right text-xs text-slate-500">{since(a.lastSaleAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No agent sales in this period.</p>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-5">
        <Panel className="lg:col-span-3" question="Are agents selling more over time?" answer={`Delivered orders per ${meta.granularity}, agents against your own shop.`}>
          <Legend
            items={[
              { label: 'Agent stores', colour: PALETTE.violet },
              { label: 'Your own shop', colour: PALETTE.brand },
            ]}
          />
          <div className="mt-3">
            <StackedColumns
              labels={labels}
              format={(v) => count(v)}
              stacks={[
                { label: 'Agent stores', colour: PALETTE.violet, values: agents.series.map((s) => s.agentOrders) },
                { label: 'Your own shop', colour: PALETTE.brand, values: agents.series.map((s) => s.directOrders) },
              ]}
            />
          </div>
        </Panel>
        <Panel
          className="lg:col-span-2"
          question="Who has gone quiet?"
          answer={agents.quiet.length > 0 ? `${agents.quiet.length} agent${agents.quiet.length === 1 ? '' : 's'} sold before but not in this period.` : 'Every agent who sold before is still selling.'}
        >
          {agents.quiet.length > 0 ? (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {agents.quiet.map((a) => (
                <li key={a.agentId} className="flex items-center justify-between py-2">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{a.name}</span>
                  <span className="text-xs text-slate-500">{count(a.previousOrders)} orders the period before</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing to chase.</p>
          )}
          {agents.quiet.length > 0 && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">A message or an announcement can bring them back.</p>}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          question="Are agents paid on time?"
          answer={
            agents.payouts.waitingNow.count > 0
              ? `${count(agents.payouts.waitingNow.count)} payout${agents.payouts.waitingNow.count === 1 ? '' : 's'} waiting, ${cedis(agents.payouts.waitingNow.amount)}.`
              : 'No payout is waiting.'
          }
          action={
            agents.payouts.waitingNow.count > 0 ? (
              <Link to="/admin/withdrawals" className="shrink-0 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">Open payouts</Link>
            ) : undefined
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Asked for" value={cedis(agents.payouts.requested.amount)} />
            <MiniStat label="Paid out" value={cedis(agents.payouts.paid.amount)} />
            <MiniStat label="Sending fees charged" value={cedis(agents.payouts.paid.fees)} />
            <MiniStat label="Typical wait to be paid" value={hoursText(agents.payouts.medianHoursToPay)} />
          </div>
        </Panel>
        <Panel
          question="Is the agent pipeline healthy?"
          answer={
            agents.applications.pendingNow > 0
              ? `${count(agents.applications.pendingNow)} application${agents.applications.pendingNow === 1 ? '' : 's'} waiting for a decision.`
              : 'No application is waiting.'
          }
          action={
            agents.applications.pendingNow > 0 ? (
              <Link to="/admin/users" className="shrink-0 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">Open users</Link>
            ) : undefined
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Applied" value={count(agents.applications.applied)} />
            <MiniStat label="Approved" value={count(agents.applications.approved)} tone="good" />
            <MiniStat label="Rejected" value={count(agents.applications.rejected)} />
            <MiniStat label="Typical time to decide" value={hoursText(agents.applications.medianHoursToDecide)} />
          </div>
        </Panel>
      </div>
    </div>
  )
}
