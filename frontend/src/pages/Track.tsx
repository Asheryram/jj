import { useCallback, useEffect, useRef, useState } from 'react'
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
import { AlertIcon, CertificateIcon, CheckIcon, ClockIcon, ReceiptIcon, SearchIcon } from '../components/icons'

/**
 * FR-4.9, a guest has no order history, so the reference plus their phone
 * number is the only handle they have on a purchase. Without this page, a
 * checker voucher whose SMS did not arrive is simply lost, which would breach
 * NFR-3.3 in spirit even though the money changed hands correctly.
 */
export default function Track() {
  const { findOrder, session } = useStore()
  const shopPath = useShopPath()
  const registerPath = useRegisterPath()
  /**
   * The reference may arrive in the URL.
   *
   * PaymentReturn sends somebody here when it has a payment reference but no
   * order to show a receipt for. Prefilling saves them retyping the one thing
   * they are least likely to have written down, they still supply their phone
   * number, which is what makes the lookup theirs to make.
   */
  const [params] = useSearchParams()
  const [reference, setReference] = useState(params.get('ref') ?? '')
  // A signed-in user's own number, prefilled, the reference is still the
  // real lookup key, this only saves retyping the one part that's already
  // known.
  // The receipt's own "Track order" link carries the phone too, so it opens on the order.
  const [phone, setPhone] = useState(params.get('phone') ?? session?.phone ?? '')
  const [result, setResult] = useState<Order | null>(null)
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)

  const search = useCallback(
    async (quiet = false) => {
      if (!quiet) setBusy(true)
      try {
        const found = await findOrder(reference, phone)
        // A quiet refresh that fails to reach the server keeps what is on screen.
        if (!quiet || found) setResult(found ?? null)
      } finally {
        // Set last, so the "we could not find it" state cannot flash while the
        // lookup is still in flight.
        setSearched(true)
        if (!quiet) setBusy(false)
      }
    },
    [findOrder, reference, phone],
  )

  // Arrived with both from a link: look it up straight away, once.
  const autoSearched = useRef(false)
  useEffect(() => {
    if (autoSearched.current || !params.get('ref') || !params.get('phone')) return
    autoSearched.current = true
    void search()
  }, [params, search])

  // Still on its way: check again once a minute while the page is open (the lookup
  // allows 40 in 15 minutes, so this leaves room for the person's own searches).
  const inFlight = result?.status === 'pending' || result?.status === 'processing' || result?.status === 'awaiting_approval'
  useEffect(() => {
    if (!inFlight) return
    const timer = window.setInterval(() => void search(true), 60_000)
    return () => window.clearInterval(timer)
  }, [inFlight, search])

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
          <Field label="Order reference" htmlFor="track-ref" hint="Looks like JDC-884120384.">
            <TextInput
              id="track-ref"
              placeholder="JDC-000000000"
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
            still does not show up, contact the agent you bought from, or{' '}
            <Link to={shopPath('/contact')} className="font-semibold underline">
              contact us
            </Link>{' '}
            with your reference.
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
            <OrderProgress order={result} />

            {/* Two different truths, and saying the wrong one is the problem, see
                the identical logic on Buy.tsx's own receipt. A refund is authorised
                by a person, so until that happens the money is *owed*, not
                returned; telling a guest it is already back when it is not is the
                fastest way to lose their trust twice. */}
            {result.status === 'failed' && result.paymentCollected === false && (
              <Callout tone="danger" title="That payment did not go through" icon={<AlertIcon className="size-4" />}>
                Nothing was taken from you. You can try again whenever you are ready.
              </Callout>
            )}

            {result.status === 'failed' && result.paymentCollected !== false && !result.refunded && (
              <Callout tone="info" title="A refund is being arranged" icon={<ClockIcon className="size-4" />}>
                {cedis(result.salePrice)} is owed back to you and has been logged for approval.
                Refunds are checked by a person rather than sent automatically, so this usually takes
                a few hours. It goes back to the Mobile Money number you paid from; you do not need to ask.
              </Callout>
            )}

            {result.status === 'failed' && result.refunded && result.paidWith === 'wallet' && (
              <Callout tone="success" title="Refunded to your wallet" icon={<CheckIcon className="size-4" />}>
                {cedis(result.salePrice)} has gone back into your wallet. Nothing was lost.
              </Callout>
            )}

            {result.status === 'failed' && result.refunded && result.paidWith !== 'wallet' && (
              <Callout tone="success" title="Your money has been sent back" icon={<CheckIcon className="size-4" />}>
                {cedis(result.salePrice)} has been sent back to the Mobile Money number you paid
                from. It usually lands within a few minutes.
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

/**
 * Where the order is, as steps: paid, with the network, delivered. A failed one
 * shows where it stopped and where the money is instead.
 */
function OrderProgress({ order }: { order: Order }) {
  const unpaid = order.status === 'awaiting_payment' || (order.status === 'failed' && order.paymentCollected === false)
  if (unpaid) return null
  const failed = order.status === 'failed'
  const done = order.status === 'completed'
  const steps = failed
    ? [
        { label: 'Paid', state: 'done' },
        { label: 'Could not be delivered', state: 'failed' },
        { label: order.refunded ? 'Money returned' : 'Refund being arranged', state: order.refunded ? 'done' : 'current' },
      ]
    : [
        { label: 'Paid', state: 'done' },
        { label: 'With the network', state: done ? 'done' : 'current' },
        { label: 'Delivered', state: done ? 'done' : 'todo' },
      ]
  return (
    <div>
      <ol className="flex items-start">
        {steps.map((step, index) => (
          <li key={step.label} className="flex flex-1 flex-col items-center text-center">
            <div className="flex w-full items-center">
              <span className={index === 0 ? 'flex-1' : `h-0.5 flex-1 ${steps[index - 1].state === 'done' ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
              <span
                className={
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ' +
                  (step.state === 'done'
                    ? 'bg-emerald-500 text-white'
                    : step.state === 'failed'
                      ? 'bg-red-500 text-white'
                      : step.state === 'current'
                        ? 'bg-brand-600 text-white'
                        : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300')
                }
              >
                {step.state === 'done' ? <CheckIcon className="size-4" /> : step.state === 'current' ? <ClockIcon className="size-4" /> : index + 1}
              </span>
              <span className={index === steps.length - 1 ? 'flex-1' : `h-0.5 flex-1 ${step.state === 'done' ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
            </div>
            <span className="mt-1.5 px-1 text-xs font-medium text-slate-700 dark:text-slate-200">{step.label}</span>
          </li>
        ))}
      </ol>
      {!done && !failed && (
        <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
          Most bundles arrive within a few minutes. This page checks again every minute.
        </p>
      )}
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
