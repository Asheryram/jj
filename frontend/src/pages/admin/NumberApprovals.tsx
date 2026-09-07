import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type PendingApproval } from '../../lib/api'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
import { prettyPhone } from '../../lib/networks'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  EmptyState,
  PageHead,
  Spinner,
  TableWrap,
  Td,
  Th,
} from '../../components/ui'
import { AlertIcon, CheckIcon, CopyIcon, RefreshIcon } from '../../components/icons'

/**
 * Numbers DataHub has not approved, and the sales they are costing.
 *
 * DataHub will not deliver an MTN bundle to a number that is not on their
 * beneficiary list, and their `/beneficiaries` submission endpoint answers 502 on
 * every valid request — so approving a number is a manual job in their dashboard.
 * This is the queue for that job.
 *
 * A sale to an unapproved number is now **refused before anything is charged**, so
 * most rows hold no money: the customer was turned away, and the row exists so
 * somebody can get the number approved and win that sale back. `Sales refused`
 * counts how many times that has happened, which is what makes a number worth
 * doing first.
 *
 * Some rows still hold money — orders placed before the refusal existed, and
 * orders whose dispatch came back needing approval after payment. Those are the
 * urgent ones, and they sort to the top.
 *
 * The list re-checks with DataHub when it loads, so what you see is what is still
 * outstanding. Approval is theirs to grant, so their answer is the only thing that
 * may release an order — there is deliberately no button here to mark one approved
 * by hand.
 */
export default function NumberApprovals() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<PendingApproval[] | null>(null)
  const [busy, setBusy] = useState<'recheck' | 'submit' | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [lastChecked, setLastChecked] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await api.pendingApprovals())
      setError('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not load this list.')
    }
  }, [])

  /**
   * Check with DataHub first, then show what is left.
   *
   * The point of this screen is the numbers that are *still* not approved, so
   * opening it asks the provider before rendering rather than showing a list that
   * may already be stale. Quiet on purpose — no toast, because nobody asked a
   * question — and the server refuses to run it more than once a minute, so
   * refreshing repeatedly cannot hammer their rate limit.
   */
  useEffect(() => {
    let live = true
    void (async () => {
      const result = await api.recheckApprovals().catch(() => null)
      if (!live) return
      if (result?.lastCheckedAt) setLastChecked(result.lastCheckedAt)
      await load()
    })()
    return () => {
      live = false
    }
  }, [load])

  const heldValue = (rows ?? []).reduce((sum, row) => sum + row.valueHeld, 0)
  const heldOrders = (rows ?? []).reduce((sum, row) => sum + row.ordersHeld, 0)

  /**
   * The checkpoint itself: mark every one of these as copied just now, both
   * on the server (so it survives a reload) and locally (so the badge
   * updates immediately without waiting on a re-fetch).
   */
  const [copyingPhone, setCopyingPhone] = useState<string | null>(null)
  const checkpoint = async (phones: string[]) => {
    try {
      await api.markApprovalsCopied(phones)
      const now = new Date().toISOString()
      setRows((current) =>
        (current ?? []).map((row) => (phones.includes(row.phone) ? { ...row, copiedAt: now } : row)),
      )
    } catch {
      // The clipboard copy itself already succeeded — worth completing that
      // rather than failing the whole action over a checkpoint that can
      // simply be set again next time.
    }
  }

  const copyAll = async () => {
    const phones = (rows ?? []).map((row) => row.phone)
    try {
      await navigator.clipboard.writeText(phones.join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
      await checkpoint(phones)
    } catch {
      pushToast({
        tone: 'error',
        title: 'Your browser would not let us copy that.',
      })
    }
  }

  /** Copying just one — for a single new number, without re-sending the batch. */
  const copyOne = async (phone: string) => {
    setCopyingPhone(phone)
    try {
      await navigator.clipboard.writeText(phone)
      await checkpoint([phone])
    } catch {
      pushToast({ tone: 'error', title: 'Your browser would not let us copy that.' })
    } finally {
      setCopyingPhone(null)
    }
  }

  const recheck = async () => {
    setBusy('recheck')
    try {
      const { checked, approved, released, skipped, lastCheckedAt } = await api.recheckApprovals()
      if (lastCheckedAt) setLastChecked(lastCheckedAt)
      await load()

      // Saying "checked 0" would read as a failure. It is a cooldown, and the
      // honest thing is to say when the last real check happened.
      if (skipped) {
        pushToast({
          tone: 'info',
          title: 'Already checked a moment ago',
          detail: 'DataHub allows a limited number of checks, so this waits a minute between them.',
        })
        return
      }

      pushToast({
        tone: approved.length > 0 ? 'success' : 'info',
        title:
          approved.length > 0
            ? `${approved.length} number${approved.length === 1 ? '' : 's'} approved`
            : 'No new approvals yet',
        detail:
          approved.length > 0
            ? `${released} held order${released === 1 ? '' : 's'} sent for delivery now.`
            : `Checked ${checked}. DataHub has not approved any of them yet.`,
      })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not check with DataHub.',
      })
    } finally {
      setBusy(null)
    }
  }

  const submit = async () => {
    setBusy('submit')
    try {
      const { submitted, error: refusal } = await api.submitApprovals()
      if (refusal) {
        // Said plainly rather than as a success. Claiming numbers were sent when
        // they were not is the one outcome this screen must never produce.
        pushToast({
          tone: 'error',
          title: 'DataHub would not accept them',
          detail: refusal,
        })
        return
      }
      pushToast({
        tone: 'success',
        title: `${submitted} number${submitted === 1 ? '' : 's'} sent for approval`,
        detail: 'DataHub reviews them. Press Re-check in a while to see which came through.',
      })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not reach DataHub.',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHead
        title="Approvals"
        subtitle="MTN numbers DataHub must approve. Until they are, a sale to them is refused rather than charged."
      />

      <Card className="mt-3">
        <CardHead
          title="Waiting on DataHub"
          action={
            <div className="flex flex-wrap items-center gap-2">
              {/* When the figures below were last true. The list is only as current
                  as the last check, and saying so beats implying it is live. */}
              {lastChecked && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Checked {dateTime(lastChecked)}
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                loading={busy === 'recheck'}
                onClick={() => void recheck()}
              >
                <RefreshIcon className="size-4" /> Re-check
              </Button>
            </div>
          }
        />

        <div className="space-y-3 p-4 sm:p-5">
          {error && (
            <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
              {error}
            </Callout>
          )}

          {rows === null ? (
            <div className="py-8 text-center">
              <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<CheckIcon className="size-6" />}
              title="Nothing is waiting"
              detail="Every number anybody has tried to buy for is approved for delivery."
            />
          ) : (
            <>
              <Callout
                tone="warning"
                title={`${rows.length} number${rows.length === 1 ? '' : 's'} to approve${
                  heldValue > 0 ? ` — ${cedis(heldValue)} of customer money held` : ''
                }`}
                icon={<AlertIcon className="size-4" />}
              >
                <p>
                  DataHub only delivers MTN bundles to numbers on their approved list, and their
                  automatic submission is failing on their side — so add these in your DataHub
                  dashboard, then press <strong className="font-semibold">Re-check</strong>.
                </p>
                <p className="mt-1.5">
                  Each of these turned a customer away without charging them, so approving a number
                  wins those sales back. Work down by{' '}
                  <strong className="font-semibold">Sales refused</strong>.
                </p>
                {heldOrders > 0 && (
                  <p className="mt-1.5">
                    {heldOrders} order{heldOrders === 1 ? ' was' : 's were'} paid for before this
                    check existed and {heldOrders === 1 ? 'is' : 'are'} still waiting. Re-check
                    releases {heldOrders === 1 ? 'it' : 'them'} the moment DataHub confirms the
                    number; anything still unapproved when the hold expires is refunded
                    automatically.
                  </p>
                )}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void copyAll()}>
                    {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                    {copied ? 'Copied' : `Copy all ${rows.length}`}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy === 'submit'}
                    onClick={() => void submit()}
                  >
                    Try sending automatically
                  </Button>
                </div>
              </Callout>

              <TableWrap caption="Numbers awaiting DataHub approval">
                <thead>
                  <tr>
                    <Th>Number</Th>
                    <Th>Waiting for</Th>
                    <Th align="right">Sales refused</Th>
                    <Th align="right">Orders held</Th>
                    <Th align="right">Value held</Th>
                    <Th align="right">Since</Th>
                    <Th align="right">Copied</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.phone} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <div>
                            <p className="tabular font-semibold text-slate-900 dark:text-slate-50">
                              {prettyPhone(row.phone)}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{row.networkKey}</p>
                          </div>
                          {/* Copying just this one number, and checkpointing only
                              it — for a single fresh arrival, without re-sending
                              (and re-dating) the whole batch. */}
                          <button
                            type="button"
                            onClick={() => void copyOne(row.phone)}
                            aria-label={`Copy ${row.phone}`}
                            className="flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                          >
                            {copyingPhone === row.phone ? (
                              <CheckIcon className="size-3.5" />
                            ) : (
                              <CopyIcon className="size-3.5" />
                            )}
                          </button>
                        </div>
                      </Td>
                      <Td>
                        <p className="text-slate-800 dark:text-slate-100">{row.lastProduct ?? '—'}</p>
                      </Td>
                      <Td align="right">
                        {/* What this number has actually cost. Since the sale is
                            now refused before anything is charged, this is the
                            figure worth acting on, not the held ones below. */}
                        <Badge tone={row.attempts > 1 ? 'warning' : 'neutral'}>
                          {row.attempts}
                        </Badge>
                      </Td>
                      <Td align="right">
                        <Badge tone={row.ordersHeld > 0 ? 'warning' : 'neutral'}>
                          {row.ordersHeld}
                        </Badge>
                      </Td>
                      <Td align="right" className="tabular font-semibold text-slate-900 dark:text-slate-50">
                        {row.valueHeld > 0 ? cedis(row.valueHeld) : '—'}
                      </Td>
                      <Td align="right" className="text-xs text-slate-500 dark:text-slate-400">
                        {dateTime(row.waitingSince)}
                      </Td>
                      <Td align="right">
                        {/* The checkpoint itself. Not-yet-copied is the row worth
                            noticing — a fresh arrival since the last batch — so
                            it's the one that stands out, not the routine case. */}
                        {row.copiedAt ? (
                          <span
                            className="text-xs text-slate-500 dark:text-slate-400"
                            title={dateTime(row.copiedAt)}
                          >
                            {timeAgo(row.copiedAt)}
                          </span>
                        ) : (
                          <Badge tone="danger">Not yet</Badge>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}

/**
 * "3m ago", "2h ago" — deliberately relative rather than a clock time. The
 * whole point of the checkpoint is answering "was this one already in the
 * last batch I sent" at a glance, and a bare timestamp needs doing that
 * arithmetic by hand every time; the full time is still one hover away, via
 * the `title` on the span that renders this.
 */
function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000))
  if (seconds < 60) return 'moments ago'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
