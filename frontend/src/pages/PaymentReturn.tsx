import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useStore } from '../state/store'
import { Button, Card, Spinner } from '../components/ui'
import { AlertIcon, CheckIcon, ClockIcon, SearchIcon } from '../components/icons'

/**
 * Where Paystack sends the customer back to.
 *
 * The URL carries a reference and nothing else, and that is all it is trusted
 * for. A page returning from a payment provider is the one party in the exchange
 * with a motive to claim success, so this asks our server, which asks Paystack —
 * `?status=success` in a query string would be a forgeable claim about money.
 *
 * Three outcomes, and the middle one matters most:
 *
 *  · **paid** — straight to the receipt, where the delivery is watched as usual.
 *  · **pending** — Mobile Money in Ghana finishes on the customer's handset, so
 *    coming back before approving the prompt is normal. Polled for a short
 *    while, then handed off with a reference rather than declared failed.
 *  · **failed** — Paystack says it will not be paid. Said plainly, with the
 *    assurance that nothing was taken.
 */
export default function PaymentReturn() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { refresh } = useStore()

  const reference = params.get('reference') ?? params.get('trxref') ?? ''
  const [state, setState] = useState<'checking' | 'pending' | 'failed' | 'missing'>(
    reference ? 'checking' : 'missing',
  )
  const attempts = useRef(0)

  const finish = useCallback(async () => {
    // A wallet top-up has no order to show, so land on the wallet where the new
    // balance is. An order goes to its receipt.
    const stored = window.sessionStorage.getItem('jdc.pendingOrder')
    window.sessionStorage.removeItem('jdc.pendingOrder')
    await refresh().catch(() => undefined)

    if (stored) {
      try {
        const { orderId, productId } = JSON.parse(stored) as {
          orderId: string
          productId: string
        }
        // Straight to the ordinary receipt, which knows how to watch a delivery.
        navigate(`/buy/${productId}?order=${orderId}`, { replace: true })
        return
      } catch {
        // Unreadable, so fall through to the wallet rather than crashing on the
        // one screen a paying customer must never see break.
      }
    }
    navigate('/app/wallet', { replace: true })
  }, [navigate, refresh, reference])

  useEffect(() => {
    if (!reference) return
    let live = true
    let timer: number | undefined

    const check = async () => {
      attempts.current++
      try {
        const { status } = await api.confirmPayment(reference)
        if (!live) return

        if (status === 'paid') {
          void finish()
          return
        }
        if (status === 'failed') {
          setState('failed')
          return
        }

        // Still pending. Mobile Money approval happens on the handset, so this
        // is the ordinary case rather than an error — give it about a minute
        // before handing over to the reference.
        setState('pending')
        if (attempts.current < 20) timer = window.setTimeout(check, 3000)
      } catch {
        if (!live) return
        setState('pending')
        if (attempts.current < 20) timer = window.setTimeout(check, 3000)
      }
    }

    void check()
    return () => {
      live = false
      if (timer) window.clearTimeout(timer)
    }
  }, [reference, finish])

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <Card className="p-8 text-center" role="status" aria-live="polite">
        {state === 'checking' && (
          <>
            <Spinner className="mx-auto size-9 text-brand-600" />
            <p className="mt-4 font-semibold text-slate-900">Checking your payment</p>
            <p className="mt-1.5 text-sm text-slate-500">This takes a few seconds.</p>
          </>
        )}

        {state === 'pending' && (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <ClockIcon className="size-7" />
            </span>
            <p className="mt-4 font-semibold text-slate-900">Waiting for your payment</p>
            <p className="mt-1.5 text-sm text-slate-600">
              If you are paying with Mobile Money, approve the prompt on your phone. This page
              updates on its own.
            </p>
            <p className="mt-3 text-sm text-slate-500">
              Nothing has been taken yet. Your bundle is sent as soon as the payment lands.
            </p>
            <p className="tabular mt-4 text-xs text-slate-500">Reference {reference}</p>
          </>
        )}

        {state === 'failed' && (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-100 text-red-700">
              <AlertIcon className="size-7" />
            </span>
            <p className="mt-4 font-semibold text-slate-900">That payment did not go through</p>
            <p className="mt-1.5 text-sm text-slate-600">
              Nothing was taken from you. You can try again whenever you are ready.
            </p>
            <Link to="/shop" className="mt-4 inline-block">
              <Button>Back to shop</Button>
            </Link>
          </>
        )}

        {state === 'missing' && (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <SearchIcon className="size-7" />
            </span>
            <p className="mt-4 font-semibold text-slate-900">We could not find that payment</p>
            <p className="mt-1.5 text-sm text-slate-600">
              The link did not carry a reference. If you have paid, use Track order with the
              reference from your SMS.
            </p>
            <Link to="/track" className="mt-4 inline-block">
              <Button variant="outline">Track an order</Button>
            </Link>
          </>
        )}

        {state !== 'failed' && state !== 'missing' && (
          <p className="mt-5 text-xs text-slate-400">
            <CheckIcon className="mr-1 inline size-3.5" />
            Payments are handled by Paystack. We never see your PIN or card details.
          </p>
        )}
      </Card>
    </div>
  )
}
