import { useEffect, useState } from 'react'
import { api, ApiError, type DispatchAttempt } from '../lib/api'
import type { Order } from '../data/types'
import { useStore } from '../state/store'
import { cedis, dateTime } from '../lib/format'
import { Button, Callout, Field, Modal, Spinner, TextInput, cn } from './ui'
import { AlertIcon, CheckIcon, ClockIcon } from './icons'

/**
 * Turn a supplier's reply into something James can act on.
 *
 * He is not a developer, and `HTTP 400 {"success":false,"error":"Insufficient
 * balance"}` is not an instruction. Every failure here has exactly one sensible
 * next move, top up, get the number approved, fix the catalogue, call the
 * partner, and that move is the thing worth putting on screen.
 *
 * Matched on the provider's words rather than a code, because they send no
 * codes. An unrecognised reason falls through to their text verbatim: better a
 * sentence he has to puzzle over than a confident wrong diagnosis.
 */
function explain(attempt: DispatchAttempt): {
  tone: 'success' | 'danger' | 'warning' | 'info'
  title: string
  detail: string
  action: string | null
} {
  const reason = attempt.reason ?? ''

  if (attempt.simulated) {
    return {
      tone: 'info',
      title: 'Test mode, nothing was sent',
      detail: 'The delivery partner was not contacted. This order was simulated end to end.',
      action: null,
    }
  }

  if (attempt.outcome === 'delivered') {
    return {
      tone: 'success',
      title: 'Delivered',
      detail: 'The delivery partner confirmed the bundle reached the recipient.',
      action: null,
    }
  }

  if (attempt.outcome === 'pending') {
    return {
      tone: 'info',
      title: 'Sent, waiting for confirmation',
      detail:
        'The delivery partner accepted the order and is working on it. They confirm separately, usually within a couple of minutes.',
      action: null,
    }
  }

  if (attempt.outcome === 'unknown') {
    /**
     * "Checked automatically every minute" is only true when there is a
     * `providerReference` to check *with*, the reconciler's sweep can only
     * ask DataHub's `/order-status` for a reference they themselves handed
     * back. A purchase call that timed out before any reply arrived at all
     * never got one, so that order is invisible to the sweep forever, not
     * merely waiting on it. Telling an admin it's being handled automatically
     * when it never will be is worse than saying nothing, it's exactly the
     * kind of reassurance that delays the one manual check that will
     * actually resolve it.
     */
    return {
      tone: 'warning',
      title: 'We do not know whether this was delivered',
      detail:
        'The connection broke before the partner answered, so the bundle may or may not have been sent.',
      action: attempt.providerReference
        ? 'Do not re-send it manually, that risks paying twice. It is being checked automatically every minute.'
        : 'This never got a reference back from the delivery partner, so it cannot be checked automatically. Check their own dashboard for this recipient below before doing anything, if nothing was actually sent, it can be retried safely; if you find out some other way what really happened, mark it delivered or failed instead.',
    }
  }

  if (/insufficient balance/i.test(reason)) {
    return {
      tone: 'danger',
      title: 'Your DataHub account is out of credit',
      detail:
        'Nothing is wrong with this order or this number. Bundles are paid for from a prepaid balance you hold with DataHub, and there is not enough in it to buy this one.',
      action:
        'Top up at app.datahubgh.com. Every order will keep failing this way until you do. The customer was not charged.',
    }
  }

  if (/not verified|beneficiary/i.test(reason)) {
    return {
      tone: 'danger',
      title: 'This number is not approved for delivery yet',
      detail:
        'DataHub only sends MTN bundles to numbers on their approved list, and this one is not on it.',
      action: 'Ask DataHub to add the number, then try again.',
    }
  }

  if (/no automated fulfilment|not found|no bundle/i.test(reason)) {
    return {
      tone: 'danger',
      title: 'The partner does not sell this bundle',
      detail:
        'They have no matching bundle for this size and network, so it cannot be delivered automatically.',
      action: 'Sync the provider catalogue, and take the bundle off sale if it has been withdrawn.',
    }
  }

  if (/out of stock/i.test(reason)) {
    return {
      tone: 'warning',
      title: 'Out of stock with the partner',
      detail: 'They are temporarily unable to supply this bundle.',
      action: 'Try again later, or take it off sale in the meantime.',
    }
  }

  if (/forced failure|test switch/i.test(reason)) {
    return {
      tone: 'info',
      title: 'Deliberately failed by the test switch',
      detail: 'The "simulate failure" setting is on, so this order was rejected on purpose.',
      action: 'Turn the switch off in Settings when you are done testing.',
    }
  }

  return {
    tone: 'danger',
    title: 'The delivery partner refused this order',
    detail: reason || 'They gave no reason.',
    action: null,
  }
}

/**
 * One order's full dispatch history, plus every action available to close it
 * out, retry, ask the provider right now, or resolve by hand.
 *
 * Shared between `AdminOrders` (opened by inspecting any order in the table)
 * and `NeedsAttention` (opened straight from the stuck-orders queue), so an
 * admin gets the exact same attempt-by-attempt detail and the exact same
 * actions regardless of which page led them here, rather than the queue
 * offering a thinner "resolve by hand only" version of the same decision.
 */
export function DispatchModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const { pushToast, refresh } = useStore()
  const [attempts, setAttempts] = useState<DispatchAttempt[] | null>(null)
  const [error, setError] = useState('')
  const [resolving, setResolving] = useState<'delivered' | 'rejected' | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [retryNote, setRetryNote] = useState('')
  const [retryNoteError, setRetryNoteError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checkingNow, setCheckingNow] = useState(false)

  /**
   * Keyed on `order?.id`, not `order` itself, a parent re-render can (and
   * does, via `watchOrder`'s polling refreshing the whole orders list) hand
   * this the *same* order as a fresh object every few seconds. Depending on
   * the object reference reset the note field being typed into below on
   * every one of those, not just on an actual navigation to a different order.
   */
  useEffect(() => {
    if (!order) {
      setAttempts(null)
      setError('')
      setResolving(null)
      setNote('')
      setNoteError('')
      setRetrying(false)
      setRetryNote('')
      setRetryNoteError('')
      return
    }
    let live = true
    api
      .orderDispatches(order.id)
      .then((rows) => live && setAttempts(rows))
      .catch(
        (caught) =>
          live && setError(caught instanceof ApiError ? caught.message : 'We could not load this.'),
      )
    return () => {
      live = false
    }
  }, [order?.id])

  if (!order) return null

  const stuck = order.status === 'pending' || order.status === 'processing'
  /**
   * Retry is only ever offered for the one case nothing automatic can ever
   * resolve: the *most recent* attempt timed out before any reply arrived,
   * so it has no `providerReference`, see `FulfilmentService.retryDispatch`.
   * `attempts` is oldest-first, so the last element is the latest one.
   */
  const latestAttempt = attempts && attempts.length > 0 ? attempts[attempts.length - 1] : null
  const canRetry = stuck && latestAttempt?.outcome === 'unknown' && !latestAttempt.providerReference

  const submitRetry = async () => {
    if (retryNote.trim().length < 5) {
      setRetryNoteError('Say what you checked before retrying. It is kept on the record.')
      return
    }
    setBusy(true)
    try {
      await api.retryDispatch(order.id, retryNote.trim())
      pushToast({ tone: 'success', title: `${order.reference}: sending it again` })
      await refresh()
      onClose()
    } catch (caught) {
      setRetryNoteError(caught instanceof ApiError ? caught.message : 'We could not retry that.')
    } finally {
      setBusy(false)
    }
  }

  const submitCheckNow = async () => {
    setCheckingNow(true)
    try {
      const result = await api.checkOrderNow(order.id)
      if (result.settled) {
        pushToast({ tone: 'success', title: `${order.reference}: resolved` })
        await refresh()
        onClose()
      } else {
        pushToast({
          tone: 'info',
          title: `${order.reference}: still processing`,
          detail: "The delivery partner has not answered yet, nothing new to report.",
        })
      }
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not check that.',
      })
    } finally {
      setCheckingNow(false)
    }
  }

  const submitResolve = async () => {
    if (!resolving) return
    if (note.trim().length < 5) {
      setNoteError('Say why you are resolving this by hand. It is kept on the record.')
      return
    }
    setBusy(true)
    try {
      await api.resolveOrder(order.id, resolving, note.trim())
      pushToast({
        tone: 'success',
        title: `${order.reference} marked ${resolving === 'delivered' ? 'delivered' : 'failed'}`,
      })
      await refresh()
      onClose()
    } catch (caught) {
      setNoteError(caught instanceof ApiError ? caught.message : 'We could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Order ${order.reference}`}>
      <div className="space-y-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-50">{order.productName}</p>
              <p className="tabular mt-0.5 text-sm text-slate-500 dark:text-slate-400">{order.recipient}</p>
            </div>
            <p className="tabular text-lg font-bold text-slate-900 dark:text-slate-50">{cedis(order.salePrice)}</p>
          </div>
        </div>

        {error && (
          <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
            {error}
          </Callout>
        )}

        {attempts === null && !error && (
          <div className="py-8 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        )}

        {attempts?.length === 0 && (
          <Callout
            tone="info"
            title="No delivery was attempted"
            icon={<AlertIcon className="size-4" />}
          >
            The order was stopped before it reached the delivery partner, so nothing was sent and
            nothing was charged.
          </Callout>
        )}

        {attempts?.map((attempt) => {
          const said = explain(attempt)
          return (
            <div
              key={attempt.id}
              className={cn(
                'overflow-hidden rounded-xl border',
                said.tone === 'success' && 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50',
                said.tone === 'danger' && 'border-red-200 dark:border-red-800 bg-red-50/50',
                said.tone === 'warning' && 'border-amber-200 dark:border-amber-800 bg-amber-50/50',
                said.tone === 'info' && 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50',
              )}
            >
              <div className="p-3.5">
                <div className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
                      said.tone === 'success' && 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400',
                      said.tone === 'danger' && 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
                      said.tone === 'warning' && 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400',
                      said.tone === 'info' && 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
                    )}
                  >
                    {said.tone === 'success' ? (
                      <CheckIcon className="size-4" />
                    ) : said.tone === 'info' ? (
                      <ClockIcon className="size-4" />
                    ) : (
                      <AlertIcon className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 dark:text-slate-50">{said.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{said.detail}</p>
                  </div>
                </div>

                {said.action && (
                  <div className="mt-2.5 rounded-lg border border-white/80 bg-white/80 p-2.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                    {said.action}
                  </div>
                )}
              </div>

              <div className="border-t border-white/60 bg-white/50 px-3.5 py-2 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{dateTime(attempt.createdAt)}</span>
                  {attempts.length > 1 && <span>Try {attempt.attempt}</span>}
                  <span>
                    Bundle cost{' '}
                    <span className="tabular font-semibold text-slate-700 dark:text-slate-200">
                      {cedis(attempt.costPrice)}
                    </span>
                  </span>
                  {attempt.providerCharged != null && (
                    <span>
                      They charged{' '}
                      <span className="tabular font-semibold text-slate-900 dark:text-slate-50">
                        {cedis(attempt.providerCharged)}
                      </span>
                    </span>
                  )}
                </div>

                {/* Kept, because our plain-English reading above is a summary and
                    summaries are wrong sometimes. Folded away so it is never the
                    first thing anyone has to read. */}
                {(attempt.providerResponse || attempt.providerReference) && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                      Technical details
                    </summary>
                    <div className="mt-1.5 space-y-1">
                      {attempt.providerReference && (
                        <p className="font-mono break-all">
                          Ref {attempt.providerReference}
                          {attempt.providerReference.startsWith('manual_') && (
                            <span className="ml-1.5 font-sans font-semibold text-amber-700 dark:text-amber-400">
                              (their manual queue, a person clears this, not their system)
                            </span>
                          )}
                        </p>
                      )}
                      {attempt.providerStatus && <p>Status {attempt.providerStatus}</p>}
                      <p className="font-mono">SKU {attempt.supplierCode}</p>
                      {attempt.providerResponse && (
                        <pre className="max-h-40 overflow-auto rounded-lg bg-slate-900 p-2 text-[11px] leading-relaxed break-all whitespace-pre-wrap text-slate-100">
                          {attempt.providerResponse}
                        </pre>
                      )}
                    </div>
                  </details>
                )}
              </div>
            </div>
          )
        })}

        {/* Only for the one case retrying is actually safe: no reference at
            all was ever obtained, so this can never be double-sent by both
            a retry and a delayed real reply landing later, there is no
            delayed reply coming, because DataHub never gave us anything to
            match one against. */}
        {canRetry && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3.5">
            {!retrying ? (
              <>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Checked the delivery partner's own dashboard for this recipient?
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Only retry once you've confirmed nothing was actually sent, otherwise this risks
                  paying twice. If they show nothing for this number, it's safe to send it again.
                </p>
                <div className="mt-2.5">
                  <Button size="sm" variant="outline" onClick={() => setRetrying(true)}>
                    Retry dispatch
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Send this order to the delivery partner again
                </p>
                <Field
                  label="What did you check?"
                  htmlFor="retry-note"
                  className="mt-2"
                  error={retryNoteError}
                >
                  <TextInput
                    id="retry-note"
                    placeholder="Checked DataHub's dashboard for this number, nothing on record"
                    value={retryNote}
                    invalid={Boolean(retryNoteError)}
                    onChange={(event) => {
                      setRetryNote(event.target.value)
                      setRetryNoteError('')
                    }}
                  />
                </Field>
                <div className="mt-2.5 flex gap-2">
                  <Button size="sm" loading={busy} onClick={() => void submitRetry()}>
                    Send it again
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setRetrying(false)
                      setRetryNote('')
                      setRetryNoteError('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* The automatic sweep still covers this order eventually, but only
            once every ten minutes, this asks the delivery partner directly,
            right now, instead of waiting on its clock. */}
        {stuck && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Don't want to wait for the automatic check?
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Asks the delivery partner for this order's status right now.
            </p>
            <div className="mt-2.5">
              <Button size="sm" variant="outline" loading={checkingNow} onClick={() => void submitCheckNow()}>
                Check now
              </Button>
            </div>
          </div>
        )}

        {/* For the case nothing automatic ever resolves: the provider's own
            status never reaches a word the reconciler recognises as final
            (see mapProviderStatus), even though the real outcome is already
            known to whoever is looking at this. */}
        {stuck && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5">
            {resolving === null ? (
              <>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Know what actually happened?
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Only the delivery partner, the webhook, or the automatic check above normally
                  settles an order. Use this only when you are certain, it is kept on the record.
                </p>
                <div className="mt-2.5 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setResolving('delivered')}>
                    Mark as delivered
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setResolving('rejected')}>
                    Mark as failed
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {resolving === 'delivered'
                    ? 'Mark this as delivered'
                    : 'Mark this as failed, a refund will be queued'}
                </p>
                <Field
                  label="How do you know?"
                  htmlFor="resolve-note"
                  className="mt-2"
                  error={noteError}
                >
                  <TextInput
                    id="resolve-note"
                    placeholder="Customer confirmed by WhatsApp they received it"
                    value={note}
                    invalid={Boolean(noteError)}
                    onChange={(event) => {
                      setNote(event.target.value)
                      setNoteError('')
                    }}
                  />
                </Field>
                <div className="mt-2.5 flex gap-2">
                  <Button size="sm" loading={busy} onClick={() => void submitResolve()}>
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setResolving(null)
                      setNote('')
                      setNoteError('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
