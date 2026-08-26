import { useState } from 'react'
import { useStore } from '../../state/store'
import { cedis, dateTime, parseCedis } from '../../lib/format'
import { NETWORKS } from '../../lib/networks'
import type { Network, TxType } from '../../data/types'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  Field,
  Modal,
  PageHead,
  Segmented,
  StatTile,
  TableWrap,
  Td,
  TextInput,
  Th,
  cn,
} from '../../components/ui'
import {
  AlertIcon,
  CashIcon,
  CheckIcon,
  RefreshIcon,
  ShieldIcon,
  WalletIcon,
} from '../../components/icons'

const QUICK_AMOUNTS = [1000, 2000, 5000, 10000, 20000]

const TX_META: Record<TxType, { label: string; tone: 'success' | 'neutral' | 'info' }> = {
  topup: { label: 'Top-up', tone: 'success' },
  purchase: { label: 'Purchase', tone: 'neutral' },
  refund: { label: 'Refund', tone: 'info' },
}

/**
 * FR-2.1, FR-2.2, FR-2.4 — the customer wallet.
 *
 * Agents do not have one of these; their money lives in an earnings account
 * they withdraw from (see Earnings.tsx). This page is what makes NFR-4.2's
 * four-step repeat purchase possible: top up once, then no Mobile Money prompt.
 */
export default function Wallet() {
  const { customerBalance: balance, transactions, topUpWallet } = useStore()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | TxType>('all')

  const visible = filter === 'all' ? transactions : transactions.filter((t) => t.type === filter)
  const toppedUp = transactions.filter((t) => t.type === 'topup').reduce((s, t) => s + t.amount, 0)
  const spent = transactions
    .filter((t) => t.type === 'purchase')
    .reduce((s, t) => s + Math.abs(t.amount), 0)
  const refunded = transactions.filter((t) => t.type === 'refund').reduce((s, t) => s + t.amount, 0)

  return (
    <div>
      <PageHead
        title="Wallet"
        subtitle="Top up once, then buy without a Mobile Money prompt each time."
        action={
          <Button size="lg" onClick={() => setOpen(true)}>
            <WalletIcon className="size-4" /> Top up
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card tone="brand" className="p-4 sm:col-span-2 lg:col-span-1">
          <p className="text-sm text-brand-100">Available balance</p>
          <p className="tabular mt-2 text-3xl font-bold tracking-tight">{cedis(balance)}</p>
          <p className="mt-1 text-xs text-brand-100">Ready to spend</p>
        </Card>
        <StatTile label="Total topped up" value={cedis(toppedUp)} icon={<WalletIcon className="size-5" />} />
        <StatTile label="Total spent" value={cedis(spent)} icon={<CashIcon className="size-5" />} />
        <StatTile
          label="Refunded to you"
          value={cedis(refunded)}
          hint="Failed orders, returned automatically"
          icon={<RefreshIcon className="size-5" />}
        />
      </div>

      {/* NFR-2.3 — say plainly who handles the money. */}
      <div className="mt-3">
        <Callout tone="info" icon={<ShieldIcon className="size-4" />}>
          Top-ups are processed by <strong className="font-semibold">Paystack</strong>. MTN MoMo,
          Telecel Cash, AirtelTigo Money and bank cards are supported. We never see or store your
          card details.
        </Callout>
      </div>

      {/* FR-2.4 — every movement of money, with a reference. */}
      <Card className="mt-3">
        <CardHead
          title="Transaction history"
          subtitle="Every top-up, purchase, refund and withdrawal."
          action={
            <Segmented
              options={[
                { value: 'all', label: 'All' },
                { value: 'topup', label: 'Top-ups' },
                { value: 'purchase', label: 'Purchases' },
                { value: 'refund', label: 'Refunds' },
              ]}
              value={filter}
              onChange={(next) => setFilter(next as 'all' | TxType)}
              className="hidden sm:inline-flex"
            />
          }
        />
        <TableWrap caption="Your wallet transaction history">
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
            {visible.map((tx) => (
              <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                <Td>
                  <p className="font-medium text-slate-900 dark:text-slate-50">{tx.description}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{dateTime(tx.createdAt)}</p>
                </Td>
                <Td>
                  <Badge tone={TX_META[tx.type].tone}>{TX_META[tx.type].label}</Badge>
                </Td>
                <Td className="tabular text-xs text-slate-500 dark:text-slate-400">{tx.reference}</Td>
                <Td align="right">
                  <span
                    className={cn(
                      'tabular font-semibold',
                      tx.amount > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100',
                    )}
                  >
                    {cedis(tx.amount, { sign: true })}
                  </span>
                </Td>
                <Td align="right" className="tabular text-slate-600 dark:text-slate-300">
                  {cedis(tx.balanceAfter)}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        {/* NFR-2.6 — tell the user the ledger is immutable; it is a trust signal. */}
        <p className="border-t border-slate-100 dark:border-slate-800 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
          This ledger is append-only. Entries cannot be edited or deleted, by you or by us — a
          correction is always a new entry.
        </p>
      </Card>

      <TopUpModal open={open} onClose={() => setOpen(false)} onConfirm={topUpWallet} />
    </div>
  )
}

// ─── Top-up (FR-2.2, NFR-6.2) ───────────────────────────────────────────────

function TopUpModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (amount: number, network: Network) => void
}) {
  const [amount, setAmount] = useState<number | null>(2000)
  const [custom, setCustom] = useState('')
  const [network, setNetwork] = useState<Network>('MTN')
  const [stage, setStage] = useState<'form' | 'redirecting'>('form')
  const [error, setError] = useState('')

  const chosen = custom.trim() ? parseCedis(custom) : amount

  const reset = () => {
    setStage('form')
    setError('')
    setCustom('')
    setAmount(2000)
  }

  const submit = () => {
    if (chosen === null) {
      setError('Enter an amount like 25 or 25.50.')
      return
    }
    if (chosen < 100) {
      setError('The smallest top-up is GHS 1.00.')
      return
    }
    setError('')
    setStage('redirecting')
    // Stands in for the Paystack popup plus the webhook that actually credits
    // the wallet server-side. The browser is never the source of truth.
    window.setTimeout(() => {
      onConfirm(chosen, network)
      reset()
      onClose()
    }, 1600)
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (stage === 'form') {
          reset()
          onClose()
        }
      }}
      title="Top up your wallet"
    >
      {stage === 'redirecting' ? (
        <div className="py-8 text-center">
          <div className="mx-auto flex size-12 animate-pulse items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300">
            <ShieldIcon className="size-6" />
          </div>
          <p className="mt-4 font-semibold text-slate-900 dark:text-slate-50">Opening Paystack…</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-slate-500 dark:text-slate-400">
            You will get a prompt on{' '}
            {network === 'MTN' ? 'MTN MoMo' : network === 'Telecel' ? 'Telecel Cash' : 'AirtelTigo Money'}
            . Your wallet is credited once Paystack confirms the payment.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Choose an amount</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {QUICK_AMOUNTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setAmount(value)
                    setCustom('')
                  }}
                  className={cn(
                    'tabular rounded-xl border py-2.5 text-sm font-bold transition-colors',
                    !custom && amount === value
                      ? 'border-brand-600 bg-brand-700 text-white'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-slate-300',
                  )}
                >
                  {value / 100}
                </button>
              ))}
            </div>
          </div>

          <Field label="Or enter another amount" htmlFor="topup-custom" error={error}>
            <div className="relative">
              <span className="absolute inset-y-0 left-3.5 flex items-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                GHS
              </span>
              <TextInput
                id="topup-custom"
                inputMode="decimal"
                placeholder="0.00"
                className="pl-13 text-lg"
                invalid={Boolean(error)}
                value={custom}
                onChange={(event) => {
                  setCustom(event.target.value)
                  setError('')
                }}
              />
            </div>
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Pay with</p>
            <div className="space-y-2">
              {NETWORKS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setNetwork(option)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                    network === option
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/40'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 items-center justify-center rounded-full border-2',
                      network === option ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-600',
                    )}
                  >
                    {network === option && <CheckIcon className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {option === 'MTN'
                      ? 'MTN Mobile Money'
                      : option === 'Telecel'
                        ? 'Telecel Cash'
                        : 'AirtelTigo Money'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-baseline justify-between rounded-xl bg-slate-50 dark:bg-slate-800 px-3.5 py-3">
            <span className="text-sm text-slate-600 dark:text-slate-300">You will be charged</span>
            <span className="tabular text-lg font-bold text-slate-900 dark:text-slate-50">
              {chosen === null ? '—' : cedis(chosen)}
            </span>
          </div>

          <Button block size="lg" onClick={submit} disabled={chosen === null}>
            Continue to Paystack
          </Button>

          <p className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
            Your balance updates only after Paystack confirms the payment — not when the prompt
            closes.
          </p>
        </div>
      )}
    </Modal>
  )
}
