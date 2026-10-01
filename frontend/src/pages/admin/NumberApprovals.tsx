import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type PendingApproval, type ProviderApprovalStatus } from '../../lib/api'
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
 * Numbers at least one provider has not approved yet, and the sales they are
 * costing. One row per phone, not per provider: a number is only truly clear
 * once every provider that could actually serve its network says so, an MTN
 * number DataHub approved means nothing to GMPL, which has never heard of
 * it, and routing can move a network from one to the other at any time.
 *
 * DataHub will not deliver an MTN bundle to a number that is not on their
 * beneficiary list, and their `/beneficiaries` submission endpoint answers 502 on
 * every valid request, so approving a DataHub number is a manual job in their
 * dashboard. GMPL runs an equivalent "Up2U" first-time-number gate for MTN of
 * their own, but their own submission is a real, working API call, not a
 * copy-paste step. Both show as their own column per row, since the
 * follow-up action differs.
 *
 * A sale to an unapproved number is now **refused before anything is charged**, so
 * most rows hold no money: the customer was turned away, and the row exists so
 * somebody can get the number approved and win that sale back. `Sales refused`
 * counts how many times that has happened, which is what makes a number worth
 * doing first.
 *
 * Some rows still hold money, orders placed before the refusal existed, and
 * orders whose dispatch came back needing approval after payment. Those are the
 * urgent ones, and they sort to the top.
 *
 * The list re-checks with both providers when it loads, so what you see is what
 * is still outstanding. Approval is the provider's to grant, so their answer is
 * the only thing that may release an order, there is deliberately no button here
 * to mark one approved by hand. "Try sending automatically" covers every
 * applicable provider for every number shown, skipping whichever one has
 * already said yes, never resubmitting to a provider that already approved it.
 */
export default function NumberApprovals() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<PendingApproval[] | null>(null)
  const [busy, setBusy] = useState<'recheck' | 'submit' | 'submit-gmpl' | null>(null)
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
   * Two plain reads, nothing here calls out to either provider. That used
   * to happen on every visit (a full recheck, DataHub rate-limited to 20 at
   * a time with a pause between batches), which made a busy list slow to
   * load for no reason anyone asked for. A background sweep now keeps this
   * current on its own clock (every 10 minutes, see `ApprovalsService`),
   * and "Re-check" below still does it on demand; this just shows when that
   * last genuinely happened, whichever one did it.
   */
  useEffect(() => {
    void load()
    api
      .lastApprovalsCheck()
      .then((value) => value && setLastChecked(value))
      .catch(() => {})
  }, [load])

  // Still worth copying to DataHub's own dashboard: its own half of this
  // number has not approved yet. A row left pending only on GMPL's side
  // (DataHub already said yes) has nothing left to hand DataHub again.
  const copyableRows = (rows ?? []).filter((row) => row.datahub.status === 'pending')
  // Genuinely never sent to GMPL yet, not "sent, awaiting answer". This
  // sweep already runs on every page load, this count (and the button
  // next to it) is for whatever showed up since the last one.
  const gmplNeverSentCount = (rows ?? []).filter((row) => row.gmpl.status === 'pending').length
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
        (current ?? []).map((row) =>
          phones.includes(row.phone) ? { ...row, datahub: { ...row.datahub, copiedAt: now } } : row,
        ),
      )
    } catch {
      // The clipboard copy itself already succeeded, worth completing that
      // rather than failing the whole action over a checkpoint that can
      // simply be set again next time.
    }
  }

  const copyAll = async () => {
    const phones = copyableRows.map((row) => row.phone)
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

  /** Copying just one, for a single new number, without re-sending the batch. */
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
          detail: 'Providers allow a limited number of checks, so this waits a minute between them.',
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
            : `Checked ${checked} across both providers, neither has approved any of them yet.`,
      })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not check with either provider.',
      })
    } finally {
      setBusy(null)
    }
  }

  const submit = async () => {
    setBusy('submit')
    try {
      const { datahub, gmpl } = await api.submitApprovals()
      await load()
      if (gmpl.submitted > 0) {
        pushToast({
          tone: 'success',
          title: `${gmpl.submitted} number${gmpl.submitted === 1 ? '' : 's'} sent to GMPL for approval`,
          detail: 'Press Re-check in a while to see which came through.',
        })
      } else if (gmpl.error) {
        pushToast({ tone: 'error', title: 'GMPL would not accept them', detail: gmpl.error })
      }
      if (datahub.submitted > 0) {
        pushToast({
          tone: 'success',
          title: `${datahub.submitted} number${datahub.submitted === 1 ? '' : 's'} sent to DataHub for approval`,
          detail: 'Press Re-check in a while to see which came through.',
        })
      } else if (datahub.error) {
        // Said plainly rather than as a success. Claiming numbers were sent
        // when they were not is the one outcome this screen must never
        // produce. Expected to fail while DataHub's own upstream is down.
        pushToast({ tone: 'error', title: 'DataHub would not accept them', detail: datahub.error })
      }
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not reach either provider.',
      })
    } finally {
      setBusy(null)
    }
  }

  /**
   * GMPL only, scoped and explicit: for a number that showed up since the
   * last time anyone happened to load this screen, the automatic sweep
   * already covers it the moment someone does, this is for forcing that
   * now instead of waiting.
   */
  const submitGmplOnly = async () => {
    setBusy('submit-gmpl')
    try {
      const { submitted, error: submitError } = await api.submitGmplApprovals()
      await load()
      if (submitted > 0) {
        pushToast({
          tone: 'success',
          title: `${submitted} number${submitted === 1 ? '' : 's'} sent to GMPL for approval`,
          detail: 'Press Re-check in a while to see which came through.',
        })
      } else if (submitError) {
        pushToast({ tone: 'error', title: 'GMPL would not accept them', detail: submitError })
      } else {
        pushToast({ tone: 'info', title: 'Nothing was waiting to be sent' })
      }
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not reach GMPL.',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHead
        title="Approvals"
        subtitle="MTN numbers your suppliers must approve. Until they are, a sale to them is refused rather than charged."
      />

      <Card className="mt-3">
        <CardHead
          title="Waiting on approval"
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
              detail="Every number anybody has tried to buy for is approved for delivery, with every supplier that could sell to it."
            />
          ) : (
            <>
              <Callout
                tone="warning"
                title={`${rows.length} number${rows.length === 1 ? '' : 's'} to approve${
                  heldValue > 0 ? `, ${cedis(heldValue)} of customer money held` : ''
                }`}
                icon={<AlertIcon className="size-4" />}
              >
                <p>
                  Each of these turned a customer away without charging them, so approving a number
                  wins those sales back. Work down by{' '}
                  <strong className="font-semibold">Sales refused</strong>. A number only drops off
                  this list once every supplier that could deliver to it has said yes, not just the
                  one that happened to refuse first.
                </p>
                {heldOrders > 0 && (
                  <p className="mt-1.5">
                    {heldOrders} order{heldOrders === 1 ? ' was' : 's were'} paid for before this
                    check existed and {heldOrders === 1 ? 'is' : 'are'} still waiting. Re-check
                    releases {heldOrders === 1 ? 'it' : 'them'} the moment a provider confirms the
                    number; anything still unapproved when the hold expires is refunded
                    automatically.
                  </p>
                )}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {copyableRows.length > 0 && (
                    <Button size="sm" onClick={() => void copyAll()}>
                      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                      {copied
                        ? 'Copied'
                        : `Copy all ${copyableRows.length} DataHub number${copyableRows.length === 1 ? '' : 's'}`}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy === 'submit'}
                    onClick={() => void submit()}
                  >
                    Try sending automatically
                  </Button>
                  {gmplNeverSentCount > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busy === 'submit-gmpl'}
                      onClick={() => void submitGmplOnly()}
                    >
                      Resend {gmplNeverSentCount} to GMPL
                    </Button>
                  )}
                </div>
              </Callout>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                DataHub's own automatic submission is failing on their side, so for any number still
                pending there, add it in your DataHub dashboard (<strong className="font-semibold">Copy</strong>),
                then press <strong className="font-semibold">Re-check</strong>. GMPL's own submission
                is a real API call, "Try sending automatically" covers it.
              </p>

              <ApprovalsTable rows={rows} copyingPhone={copyingPhone} onCopyOne={copyOne} />
            </>
          )}
        </div>
      </Card>
    </div>
  )
}

function StatusBadge({ status }: { status: ProviderApprovalStatus }) {
  if (status.status === 'not_applicable') return <Badge tone="neutral">N/A</Badge>
  if (status.status === 'approved') return <Badge tone="success">Approved</Badge>
  // Sent and received, nothing left for anyone here to do but wait on
  // their decision, genuinely different from "Pending", which means it has
  // not even been sent yet.
  if (status.status === 'awaiting_provider') return <Badge tone="info">Awaiting answer</Badge>
  return <Badge tone="danger">Pending</Badge>
}

function ApprovalsTable({
  rows,
  copyingPhone,
  onCopyOne,
}: {
  rows: PendingApproval[]
  copyingPhone: string | null
  onCopyOne: (phone: string) => void
}) {
  return (
    <TableWrap caption="Numbers waiting on approval">
      <thead>
        <tr>
          <Th>Number</Th>
          <Th>Waiting for</Th>
          <Th align="right">Sales refused</Th>
          <Th align="right">Orders held</Th>
          <Th align="right">Value held</Th>
          <Th align="right">Since</Th>
          <Th align="right">DataHub</Th>
          <Th align="right">GMPL</Th>
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
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{row.network}</p>
                </div>
                {/* Copying just this one number, and checkpointing only
                    it, for a single fresh arrival, without re-sending
                    (and re-dating) the whole batch. Only when DataHub's
                    own half still needs it, see `copyableRows`. */}
                {row.datahub.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => void onCopyOne(row.phone)}
                    aria-label={`Copy ${row.phone}`}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                  >
                    {copyingPhone === row.phone ? (
                      <CheckIcon className="size-3.5" />
                    ) : (
                      <CopyIcon className="size-3.5" />
                    )}
                  </button>
                )}
              </div>
            </Td>
            <Td>
              <p className="text-slate-800 dark:text-slate-100">{row.lastProduct ?? '-'}</p>
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
              {row.valueHeld > 0 ? cedis(row.valueHeld) : '-'}
            </Td>
            <Td align="right" className="text-xs text-slate-500 dark:text-slate-400">
              {dateTime(row.waitingSince)}
            </Td>
            <Td align="right">
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={row.datahub} />
                {/* "Pending" above already means not copied yet, this is
                    only extra context for the other state: sent, just not
                    answered yet. */}
                {row.datahub.status === 'awaiting_provider' && row.datahub.copiedAt && (
                  <span title={dateTime(row.datahub.copiedAt)}>
                    <Badge tone="neutral">Copied {timeAgo(row.datahub.copiedAt)}</Badge>
                  </span>
                )}
              </div>
            </Td>
            <Td align="right">
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={row.gmpl} />
                {row.gmpl.status === 'awaiting_provider' && row.gmpl.recordedAt && (
                  <span title={dateTime(row.gmpl.recordedAt)}>
                    <Badge tone="neutral">Sent {timeAgo(row.gmpl.recordedAt)}</Badge>
                  </span>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  )
}

/**
 * "3m ago", "2h ago", deliberately relative rather than a clock time. The
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
