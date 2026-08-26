import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '../state/store'
import { useRegisterPath, useShopPath } from '../lib/shopPath'
import { cedis, dateTime } from '../lib/format'
import { prettyPhone } from '../lib/networks'
import type { Order } from '../data/types'
import {
  Button,
  Callout,
  Card,
  CopyField,
  Field,
  NetworkChip,
  StatusBadge,
  TextInput,
} from '../components/ui'
import { CertificateIcon, ReceiptIcon, SearchIcon } from '../components/icons'

/**
 * FR-4.9 — a guest has no order history, so the reference plus their phone
 * number is the only handle they have on a purchase. Without this page, a
 * checker voucher whose SMS did not arrive is simply lost, which would breach
 * NFR-3.3 in spirit even though the money changed hands correctly.
 */
export default function Track() {
  const { findOrder } = useStore()
  const shopPath = useShopPath()
  const registerPath = useRegisterPath()
  /**
   * The reference may arrive in the URL.
   *
   * PaymentReturn sends somebody here when it has a payment reference but no
   * order to show a receipt for. Prefilling saves them retyping the one thing
   * they are least likely to have written down — they still supply their phone
   * number, which is what makes the lookup theirs to make.
   */
  const [params] = useSearchParams()
  const [reference, setReference] = useState(params.get('ref') ?? '')
  const [phone, setPhone] = useState('')
  const [result, setResult] = useState<Order | null>(null)
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)

  const search = async () => {
    setBusy(true)
    try {
      const found = await findOrder(reference, phone)
      setResult(found ?? null)
    } finally {
      // Set last, so the "we could not find it" state cannot flash while the
      // lookup is still in flight.
      setSearched(true)
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10 sm:py-14">
      <div className="text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300">
          <SearchIcon className="size-6" />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Track your order</h1>
        <p className="mx-auto mt-2 max-w-sm text-slate-500 dark:text-slate-400">
          Enter the reference from your receipt and the phone number you used. No account needed.
        </p>
      </div>

      <Card className="mt-6 p-5">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void search()
          }}
        >
          <Field label="Order reference" htmlFor="track-ref" hint="Looks like JDC-884120.">
            <TextInput
              id="track-ref"
              placeholder="JDC-000000"
              value={reference}
              onChange={(event) => setReference(event.target.value.toUpperCase())}
              className="font-mono tracking-wide uppercase"
            />
          </Field>

          <Field label="Your phone number" htmlFor="track-phone">
            <TextInput
              id="track-phone"
              type="tel"
              inputMode="numeric"
              placeholder="024 000 0000"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>

          <Button
            type="submit"
            block
            size="lg"
            loading={busy}
            disabled={busy || !reference.trim() || !phone.trim()}
          >
            Find my order
          </Button>
        </form>
      </Card>

      {searched && !result && (
        <div className="mt-4">
          <Callout tone="warning" title="We could not find that order">
            Check the reference and make sure the phone number is the one you bought with. If it
            still does not show up, contact James on 020 987 6543 with your reference.
          </Callout>
        </div>
      )}

      {result && (
        <Card className="mt-4">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 p-5">
            <div>
              <p className="text-lg font-bold text-slate-900 dark:text-slate-50">{result.productName}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <NetworkChip network={result.network} />
                <StatusBadge status={result.status} />
              </div>
            </div>
            <p className="tabular text-xl font-bold text-brand-800 dark:text-brand-300">{cedis(result.salePrice)}</p>
          </div>

          <div className="space-y-4 p-5">
            {result.status === 'failed' && (
              <Callout tone="success" title="This order was refunded">
                {cedis(result.salePrice)} was returned. If you paid with Mobile Money it is held as
                credit against your number — check your SMS for the claim link.
              </Callout>
            )}

            {result.voucher && (
              <div className="space-y-3">
                <Callout
                  tone="info"
                  title="Your voucher"
                  icon={<CertificateIcon className="size-4" />}
                >
                  Use these on the official WAEC portal.
                </Callout>
                <CopyField label="Serial number" value={result.voucher.serial} mono />
                <CopyField label="PIN" value={result.voucher.pin} mono />
              </div>
            )}

            <dl className="space-y-2.5 text-sm">
              <Row label="Reference" value={result.reference} />
              <Row label="Sent to" value={prettyPhone(result.recipient)} />
              <Row label="Placed" value={dateTime(result.createdAt)} />
              <Row label="Paid with" value={result.paidWith === 'wallet' ? 'Wallet' : 'Mobile Money'} />
            </dl>

            <Link to={shopPath('/shop')}>
              <Button block variant="outline">
                <ReceiptIcon className="size-4" /> Buy another bundle
              </Button>
            </Link>
          </div>
        </Card>
      )}

      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        Buy often?{' '}
        <Link to={registerPath} className="font-semibold text-brand-700 dark:text-brand-300 hover:underline">
          Create an account
        </Link>{' '}
        and every order is saved automatically.
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="tabular font-medium text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  )
}
