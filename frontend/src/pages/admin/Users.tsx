import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AgentApplications from './AgentApplications'
import { useStore } from '../../state/store'
import { api, ApiError } from '../../lib/api'
import { cedis, dateTime, initials } from '../../lib/format'
import type { Earning, PlatformUser, Role } from '../../data/types'
import { STATUS_LABEL, STATUS_TONE } from '../../lib/userStatus'
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Modal,
  PageHead,
  Segmented,
  Spinner,
  StatTile,
  TableWrap,
  Td,
  TextInput,
  Th,
} from '../../components/ui'
import { BanIcon, CashIcon, CheckIcon, SearchIcon, ShieldIcon, UsersIcon } from '../../components/icons'
import { isAdmin } from '../../lib/roles'


type Filter = 'all' | Role | 'suspended'

/** FR-6.3 (all users) + FR-6.5 (suspend or deactivate any account). */
export default function Users() {
  const { users, toggleUserStatus, session } = useStore()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState<PlatformUser | null>(null)
  const [viewing, setViewing] = useState<PlatformUser | null>(null)
  const [agentSummary, setAgentSummary] = useState<{
    totalEarned: number
    totalVolume: number
    agentCount: number
  } | null>(null)

  useEffect(() => {
    let live = true
    api
      .agentSummary()
      .then((result) => live && setAgentSummary(result))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return users.filter((user) => {
      if (filter === 'suspended' && user.status !== 'suspended') return false
      if (filter !== 'all' && filter !== 'suspended' && user.role !== filter) return false
      if (!needle) return true
      return (
        user.name.toLowerCase().includes(needle) ||
        user.phone.includes(needle) ||
        user.email.toLowerCase().includes(needle)
      )
    })
  }, [filter, query, users])

  const agents = users.filter((u) => u.role === 'agent')
  const suspended = users.filter((u) => u.status === 'suspended')
  const walletFloat = users.reduce((sum, u) => sum + u.balance, 0)

  return (
    <div>
      <PageHead title="Users" subtitle="Every customer, agent and admin on the platform." />

      {/* Only renders when somebody is waiting. Whoever is looking at people is
          the person who should notice that three of them cannot trade yet. */}
      <AgentApplications />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Total users" value={String(users.length)} icon={<UsersIcon className="size-5" />} />
        <StatTile label="Agents" value={String(agents.length)} tone="brand" />
        <StatTile
          label="Suspended"
          value={String(suspended.length)}
          tone={suspended.length > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Wallet float held"
          value={cedis(walletFloat)}
          hint="Customer money you are holding"
        />
        <StatTile
          label="Paid to agents, all-time"
          value={agentSummary ? cedis(agentSummary.totalEarned) : '—'}
          hint={agentSummary ? `across ${agentSummary.agentCount} agent${agentSummary.agentCount === 1 ? '' : 's'}` : undefined}
          tone="success"
          icon={<CashIcon className="size-5" />}
        />
      </div>

      {/* NFR-3.3 framing — the float is a liability, not revenue. */}
      <div className="mt-3">
        <Callout tone="info" icon={<ShieldIcon className="size-4" />}>
          Wallet float is money that belongs to your users, not income. It only becomes revenue when
          an order completes.
        </Callout>
      </div>

      <div className="mt-3 mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Filter>
          options={[
            { value: 'all', label: 'All' },
            { value: 'agent', label: 'Agents' },
            { value: 'customer', label: 'Customers' },
            { value: 'suspended', label: 'Suspended' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div className="relative sm:w-64">
          <SearchIcon className="absolute inset-y-0 left-3 my-auto size-4 text-slate-500 dark:text-slate-400" />
          <TextInput
            placeholder="Name, phone or email"
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search users"
          />
        </div>
      </div>

      <Card>
        {visible.length === 0 ? (
          <EmptyState
            icon={<SearchIcon className="size-6" />}
            title="No users matched"
            detail="Try a different filter or clear the search."
          />
        ) : (
          <TableWrap caption="All platform users">
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Referred by</Th>
                <Th align="right">Orders</Th>
                <Th align="right">Volume</Th>
                <Th align="right">Total earned</Th>
                <Th align="right">Wallet</Th>
                <Th>Status</Th>
                <Th align="right" />
              </tr>
            </thead>
            <tbody>
              {visible.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-white">
                        {initials(user.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900 dark:text-slate-50">{user.name}</p>
                        <p className="tabular truncate text-xs text-slate-500 dark:text-slate-400">{user.phone}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <Badge
                      tone={user.role === 'admin' ? 'brand' : user.role === 'agent' ? 'info' : 'neutral'}
                    >
                      {user.role}
                    </Badge>
                  </Td>
                  <Td className="text-slate-600 dark:text-slate-300">{user.referredBy ?? '—'}</Td>
                  <Td align="right" className="tabular">
                    {user.orders}
                  </Td>
                  <Td align="right" className="tabular text-slate-600 dark:text-slate-300">
                    {user.role === 'agent' ? cedis(user.salesVolume) : '—'}
                  </Td>
                  <Td align="right" className="tabular">
                    {user.role === 'agent' ? (
                      <button
                        type="button"
                        onClick={() => setViewing(user)}
                        className="font-semibold text-brand-700 dark:text-brand-300 underline underline-offset-2 hover:text-brand-800"
                      >
                        {cedis(user.totalEarned)}
                      </button>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td align="right" className="tabular font-semibold text-slate-900 dark:text-slate-50">
                    {cedis(user.balance)}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[user.status]}>{STATUS_LABEL[user.status]}</Badge>
                  </Td>
                  <Td align="right">
                    {/* Neither an admin nor the platform owner is suspendable here;
                        the server refuses both, so offering the button would only
                        produce an error. Platform team is where that lives, with the
                        guards this screen does not have — no suspending yourself, and
                        never the last active superadmin. Saying so beats an empty
                        cell that reads as a missing feature. */}
                    {isAdmin(user.role) ? (
                      session?.role === 'superadmin' && (
                        <Link
                          to="/admin/team"
                          className="text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline"
                        >
                          Manage in Platform team
                        </Link>
                      )
                    ) : user.status === 'pending' || user.status === 'rejected' ? (
                      /* An undecided application is not a suspended account, so it gets
                         no Suspend button — deciding it belongs in the applications
                         queue above, which records who decided and emails the agent.
                         Neither of which this button does, and the server refuses it.

                         Text rather than a link: the queue is already on this page, and
                         it renders nothing when empty, so a link would sometimes point
                         at an element that is not there. */
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {user.status === 'pending' ? 'Decide above' : 'Turned down'}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant={user.status === 'active' ? 'outline' : 'secondary'}
                        onClick={() => setConfirming(user)}
                      >
                        {user.status === 'active' ? 'Suspend' : 'Reactivate'}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <p className="border-t border-slate-100 dark:border-slate-800 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
          Suspending an account blocks new orders and withdrawals. Nothing is deleted — order history
          and the wallet ledger stay intact.
        </p>
      </Card>

      <Modal
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title={confirming?.status === 'active' ? 'Suspend this account?' : 'Reactivate this account?'}
      >
        {confirming && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-800 p-3.5">
              <span className="flex size-10 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">
                {initials(confirming.name)}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 dark:text-slate-50">{confirming.name}</p>
                <p className="tabular text-sm text-slate-500 dark:text-slate-400">{confirming.phone}</p>
              </div>
            </div>

            {confirming.status === 'active' ? (
              <Callout tone="warning" title="What happens next">
                {confirming.name} will not be able to place orders, top up, or request withdrawals.
                Their wallet balance of {cedis(confirming.balance)} stays untouched and their
                order history remains visible to you.
              </Callout>
            ) : (
              <Callout tone="success" title="What happens next">
                {confirming.name} regains full access straight away, with their existing wallet
                balance of {cedis(confirming.balance)}.
              </Callout>
            )}

            <div className="flex gap-2">
              <Button
                block
                variant={confirming.status === 'active' ? 'danger' : 'primary'}
                onClick={() => {
                  toggleUserStatus(confirming.id)
                  setConfirming(null)
                }}
              >
                {confirming.status === 'active' ? (
                  <>
                    <BanIcon className="size-4" /> Suspend account
                  </>
                ) : (
                  <>
                    <CheckIcon className="size-4" /> Reactivate account
                  </>
                )}
              </Button>
              <Button block variant="outline" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <AgentEarningsModal agent={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}

/**
 * One agent's own earnings ledger, for the "Total earned" drill-down.
 *
 * Reuses the exact same data an agent sees on their own Earnings page —
 * `AgentsService.earnings`, called here from an admin-gated route instead of
 * the agent's own — so there is nothing here that disagrees with what the
 * agent themselves would see.
 */
function AgentEarningsModal({ agent, onClose }: { agent: PlatformUser | null; onClose: () => void }) {
  const [data, setData] = useState<{ balance: number; earnings: Earning[] } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!agent) {
      setData(null)
      setError('')
      return
    }
    let live = true
    api
      .agentEarnings(agent.id)
      .then((result) => live && setData(result))
      .catch(
        (caught) =>
          live && setError(caught instanceof ApiError ? caught.message : 'We could not load this.'),
      )
    return () => {
      live = false
    }
  }, [agent])

  if (!agent) return null

  return (
    <Modal open onClose={onClose} title={`${agent.name}'s earnings`}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2.5 rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 text-center">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Sales volume</p>
            <p className="tabular mt-0.5 font-bold text-slate-900 dark:text-slate-50">
              {cedis(agent.salesVolume)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Earned, all-time</p>
            <p className="tabular mt-0.5 font-bold text-emerald-700 dark:text-emerald-400">
              {cedis(agent.totalEarned)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Wallet now</p>
            <p className="tabular mt-0.5 font-bold text-slate-900 dark:text-slate-50">
              {cedis(agent.balance)}
            </p>
          </div>
        </div>

        {error && (
          <Callout tone="danger" icon={<ShieldIcon className="size-4" />}>
            {error}
          </Callout>
        )}

        {data === null && !error && (
          <div className="py-8 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        )}

        {data?.earnings.length === 0 && (
          <EmptyState icon={<CashIcon className="size-6" />} title="No earnings yet" detail="Nothing has been credited to this agent." />
        )}

        {data && data.earnings.length > 0 && (
          <TableWrap caption={`${agent.name}'s earnings`}>
            <thead>
              <tr>
                <Th>Description</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Balance after</Th>
              </tr>
            </thead>
            <tbody>
              {data.earnings.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <Td>
                    <p className="font-medium text-slate-900 dark:text-slate-50">{entry.description}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{dateTime(entry.createdAt)}</p>
                  </Td>
                  <Td
                    align="right"
                    className={`tabular font-semibold ${entry.amount > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'}`}
                  >
                    {cedis(entry.amount, { sign: true })}
                  </Td>
                  <Td align="right" className="tabular text-slate-600 dark:text-slate-300">
                    {cedis(entry.balanceAfter)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>
    </Modal>
  )
}
