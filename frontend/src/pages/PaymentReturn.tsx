import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useStore } from '../state/store'
import { useShopPath } from '../lib/shopPath'
import { Button, Card, CopyField, Spinner } from '../components/ui'
import { CheckIcon, ClockIcon, SearchIcon } from '../components/icons'

/**
 * Where Paystack sends the customer back to.
 *
 * The URL carries a reference and nothing else, and that is all it is trusted
 * for. A page returning from a payment provider is the one party in the exchange
 * with a motive to claim success, so this asks our server, which asks Paystack,
 * `?status=success` in a query string would be a forgeable claim about money.
 *
 * Three outcomes, and none of them dead-end here:
 *
 *  · **paid**, straight to the receipt, where the delivery is watched as usual.
 *  · **failed**, Paystack says it will not be paid (a declined PIN, insufficient
 *    funds, the single most common outcome in Mobile Money checkout). Resumed
 *    straight back into the same checkout via `finish()`, exactly like a
 *    successful payment resumes to its receipt, rather than shown a static
 *    dead-end here, re-typing the phone number from scratch is not a real
 *    recovery path for the most ordinary failure this page sees.
 *  · **pending**, Mobile Money in Ghana finishes on the customer's handset, so
 *    coming back before approving the prompt is normal. Polled for a short
 *    while, then handed off to Track order with the reference rather than left
 *    on static text forever.
 */
export default function PaymentReturn() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { refresh } = useStore()
  const shopPath = useShopPath()

  const reference = params.get('reference') ?? params.get('trxref') ?? ''
  const [state, setState] = useState<'checking' | 'pending' | 'missing'>(reference ? 'checking' : 'missing')
  const attempts = useRef(0)

  const finish = useCallback(async () => {
    // An order goes to its receipt. Anything else has no receipt to show, this
    // used to be a wallet top-up, and landed on a wallet page that no longer
    // exists, on the one screen a paying customer must never see break.
    //
    // `/track` is the honest fallback: it looks an order up by the reference we
    // still hold, which is exactly what somebody in that position needs.
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
        navigate(`${shopPath(`/buy/${productId}`)}?order=${orderId}`, { replace: true })
        return
      } catch {
        // Unreadable, so fall through to tracking rather than crashing here.
      }
    }
    navigate(
      reference ? `${shopPath('/track')}?ref=${encodeURIComponent(reference)}` : shopPath('/track'),
      { replace: true },
    )
  }, [navigate, refresh, reference, shopPath])

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
          // Resume the checkout it actually failed on, same as a successful
          // payment resumes to its receipt, a declined PIN or insufficient
          // funds is the single most common outcome here, and re-typing the
          // phone number from scratch is not a real recovery path for it.
          void finish()
          return
        }

        // Still pending. Mobile Money approval happens on the handset, so this
        // is the ordinary case rather than an error, give it about a minute
        // before handing over to the reference.
        setState('pending')
        if (attempts.current < 20) {
          timer = window.setTimeout(check, 3000)
        } else {
          // The poll has run its course. Ghanaian MoMo confirmations routinely
          // take longer than a minute, so this is not a failure, but sitting
          // on static text forever with no way out is. Track order is the
          // honest handoff: it looks the order up by the reference this page
          // still holds, same as `finish()`'s own fallback.
          navigate(`${shopPath('/track')}?ref=${encodeURIComponent(reference)}`, { replace: true })
        }
      } catch {
        if (!live) return
        setState('pending')
        if (attempts.current < 20) {
          timer = window.setTimeout(check, 3000)
        } else {
          navigate(`${shopPath('/track')}?ref=${encodeURIComponent(reference)}`, { replace: true })
        }
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
            <Spinner className="mx-auto size-9 text-brand-600 dark:text-brand-300" />
            <p className="mt-4 font-semibold text-slate-900 dark:text-slate-50">Checking your payment</p>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">This takes a few seconds.</p>
          </>
        )}

        {state === 'pending' && (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">
              <ClockIcon className="size-7" />
            </span>
            <p className="mt-4 font-semibold text-slate-900 dark:text-slate-50">Waiting for your payment</p>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
              If you are paying with Mobile Money, approve the prompt on your phone. This page
              updates on its own.
            </p>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Nothing has been taken yet. Your bundle is sent as soon as the payment lands.
            </p>
            <div className="mt-4 text-left">
              <CopyField label="Reference" value={reference} mono />
            </div>
          </>
        )}

        {state === 'missing' && (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              <SearchIcon className="size-7" />
            </span>
            <p className="mt-4 font-semibold text-slate-900 dark:text-slate-50">We could not find that payment</p>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
              The link did not carry a reference. If you have paid, use Track order with the
              reference from your SMS.
            </p>
            <Link to={shopPath('/track')} className="mt-4 inline-block">
              <Button variant="outline">Track an order</Button>
            </Link>
          </>
        )}

        {state !== 'missing' && (
          <p className="mt-5 text-xs text-slate-400 dark:text-slate-500">
            <CheckIcon className="mr-1 inline size-3.5" />
            Payments are handled by Paystack. We never see your PIN or card details.
          </p>
        )}
      </Card>
    </div>
  )
}
