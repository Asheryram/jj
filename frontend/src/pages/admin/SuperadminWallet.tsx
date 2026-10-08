import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type SuperadminWallet as Wallet } from '../../lib/api'
import type { Network } from '../../data/types'
import { cedis, dateTime, parseCedis } from '../../lib/format'
import { NETWORKS } from '../../lib/networks'
import { useStore } from '../../state/store'
import { Badge, Button, Callout, Card, CardHead, Field, PageHead, Select, Spinner, StatTile, TextInput } from '../../components/ui'
import { AlertIcon, WalletIcon } from '../../components/icons'

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved, being sent', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  rejected: { label: 'Rejected, returned', tone: 'danger' },
  failed: { label: 'Not sent, returned', tone: 'danger' },
}

/**
 * The superadmin's own wallet. They earn nothing from orders (those are the
 * business's); this holds their share of every shop-address payment agents
 * make, and pays it out the same way an agent's earnings are paid: a request
 * another admin approves and sends.
 */
export default function SuperadminWallet() {
  const { session, pushToast, payoutTransferFee } = useStore()
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [amount, setAmount] = useState('')
  const [network, setNetwork] = useState<Network>('MTN')
  const [phone, setPhone] = useState(session?.phone ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setWallet(await api.superadminWallet())
    } catch {
      setWallet({ balance: 0, totalEarned: 0, shares: [], withdrawals: [] })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const withdraw = async () => {
    const pesewas = parseCedis(amount)
    if (!pesewas || pesewas <= 0) {
      setError('Enter an amount, like 50.')
      return
    }
    if (!/^0\d{9}$/.test(phone.replace(/\s/g, ''))) {
      setError('Enter the Mobile Money number to pay, like 0241234567.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.requestWithdrawal(pesewas, network, phone.replace(/\s/g, ''))
      setAmount('')
      pushToast({ tone: 'success', title: 'Withdrawal requested', detail: 'Another admin approves and sends it.' })
      await load()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not send that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHead title="My wallet" subtitle="Your share of every shop-address payment agents make. Orders belong to the business, not this wallet." />

      {wallet === null ? (
        <div className="py-10 text-center">
          <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
        </div>
      ) : (
        <>
          <div data-tour="wallet-balance" className="grid gap-3 sm:grid-cols-2">
            <StatTile label="Available to withdraw" value={cedis(wallet.balance)} icon={<WalletIcon className="size-5" />} tone="success" />
            <StatTile label="Earned from shop addresses, all time" value={cedis(wallet.totalEarned)} />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div data-tour="wallet-withdraw">
            <Card>
              <CardHead title="Withdraw" subtitle="Requested like an agent's payout. Another admin approves and sends it, never you." />
              <div className="space-y-4 p-4 sm:p-5">
                <Field label="Amount (GHS)" htmlFor="sw-amount" error={error}>
                  <TextInput id="sw-amount" inputMode="decimal" value={amount} placeholder="50.00" onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                </Field>
                <Field label="Mobile Money network" htmlFor="sw-network">
                  <Select id="sw-network" value={network} onChange={(e) => setNetwork(e.target.value as Network)}>
                    {NETWORKS.map((n) => (
                      <option key={n} value={n}>
                        {n === 'MTN' ? 'MTN Mobile Money' : n === 'Telecel' ? 'Telecel Cash' : 'AirtelTigo Money'}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Paid to" htmlFor="sw-phone">
                  <TextInput id="sw-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </Field>
                {payoutTransferFee > 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">A {cedis(payoutTransferFee)} sending fee is held on top, the same as for agents.</p>
                )}
                <Button block loading={busy} disabled={wallet.balance <= 0} onClick={() => void withdraw()}>
                  Request withdrawal
                </Button>
              </div>
            </Card>
            </div>

            <Card>
              <CardHead title="Your withdrawals" />
              <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800 sm:px-5">
                {wallet.withdrawals.length === 0 ? (
                  <p className="py-6 text-sm text-slate-500 dark:text-slate-400">None yet.</p>
                ) : (
                  wallet.withdrawals.map((w) => {
                    const s = STATUS[w.status] ?? { label: w.status, tone: 'neutral' as const }
                    return (
                      <div key={w.id} className="flex items-center justify-between gap-3 py-3">
                        <div>
                          <p className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">{cedis(w.amount)}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {w.agentPhone} · {dateTime(w.requestedAt)}
                          </p>
                        </div>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </div>
                    )
                  })
                )}
              </div>
            </Card>
          </div>

          <div data-tour="wallet-shares" className="mt-3">
          <Card>
            <CardHead title="Shares credited" subtitle="One line per shop-address payment an agent made." />
            <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800 sm:px-5">
              {wallet.shares.length === 0 ? (
                <div className="py-6">
                  <Callout tone="info" icon={<AlertIcon className="size-4" />}>
                    Nothing yet. Set your share on the Shop addresses page; it is credited here each time an agent pays.
                  </Callout>
                </div>
              ) : (
                wallet.shares.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-slate-800 dark:text-slate-100">{s.description}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{dateTime(s.createdAt)}</p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">+{cedis(s.amount)}</span>
                  </div>
                ))
              )}
            </div>
          </Card>
          </div>
        </>
      )}
    </div>
  )
}
