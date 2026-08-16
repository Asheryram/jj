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
 * Paid orders held because DataHub has not approved the recipient's number.
 *
 * DataHub will not deliver an MTN bundle to a number that is not on their
 * beneficiary list, and their `/beneficiaries` submission endpoint answers 502
 * on every valid request — so approving a number is a manual job in their
 * dashboard. This is the queue for that job.
 *
 * Each row holds real customer money. The order was taken rather than refused,
 * because refusing turned away every first-time MTN buyer, so the obligation is
 * live until the bundle is delivered or the hold expires and it is refunded.
 * That is why rows are ordered by value held rather than by age.
 *
 * Re-check is the release: it asks DataHub which numbers are approved now and
 * immediately re-dispatches the orders waiting on them. Approval is theirs to
 * grant, so their answer is the only thing that may release an order — there is
 * deliberately no button here to mark one approved by hand.
 */
export default function NumberApprovals() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<PendingApproval[] | null>(null)
  const [busy, setBusy] = useState<'recheck' | 'submit' | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      setRows(await api.pendingApprovals())
      setError('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not load this list.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const heldValue = (rows ?? []).reduce((sum, row) => sum + row.valueHeld, 0)
  const heldOrders = (rows ?? []).reduce((sum, row) => sum + row.ordersHeld, 0)

  const copyAll = async () => {
    const list = (rows ?? []).map((row) => row.phone).join('\n')
    try {
      await navigator.clipboard.writeText(list)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      pushToast({
        tone: 'error',
        title: 'Your browser would not let us copy that.',
      })
    }
  }

  const recheck = async () => {
    setBusy('recheck')
    try {
      const { checked, approved, released } = await api.recheckApprovals()
      await load()
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
        subtitle="MTN numbers DataHub must approve before a bundle can reach them. Each one is holding up a paid order."
      />

      <Card className="mt-3">
        <CardHead
          title="Waiting on DataHub"
          action={
            <Button
              size="sm"
              variant="outline"
              loading={busy === 'recheck'}
              onClick={() => void recheck()}
            >
              <RefreshIcon className="size-4" /> Re-check
            </Button>
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
              <Spinner className="mx-auto size-6 text-brand-600" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<CheckIcon className="size-6" />}
              title="Nothing is waiting"
              detail="No orders are held. Every number bought for so far is approved for delivery."
            />
          ) : (
            <>
              <Callout
                tone="warning"
                title={`${rows.length} number${rows.length === 1 ? '' : 's'} to approve — ${cedis(heldValue)} of customer money held`}
                icon={<AlertIcon className="size-4" />}
              >
                <p>
                  {heldOrders} paid order{heldOrders === 1 ? ' is' : 's are'} waiting on these
                  numbers. DataHub only delivers MTN bundles to numbers on their approved list, and
                  their automatic submission is failing on their side — so add these in your DataHub
                  dashboard, then press <strong className="font-semibold">Re-check</strong>. That
                  releases every held order for a number the moment DataHub confirms it.
                </p>
                <p className="mt-1.5">
                  Anything still unapproved when the hold expires is refunded automatically, so no
                  customer is left waiting indefinitely.
                </p>
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
                    <Th align="right">Orders held</Th>
                    <Th align="right">Value held</Th>
                    <Th align="right">Since</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.phone} className="hover:bg-slate-50">
                      <Td>
                        <p className="tabular font-semibold text-slate-900">
                          {prettyPhone(row.phone)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">{row.networkKey}</p>
                      </Td>
                      <Td>
                        <p className="text-slate-800">{row.lastProduct ?? '—'}</p>
                      </Td>
                      <Td align="right">
                        <Badge tone={row.ordersHeld > 0 ? 'warning' : 'neutral'}>
                          {row.ordersHeld}
                        </Badge>
                      </Td>
                      <Td align="right" className="tabular font-semibold text-slate-900">
                        {row.valueHeld > 0 ? cedis(row.valueHeld) : '—'}
                      </Td>
                      <Td align="right" className="text-xs text-slate-500">
                        {dateTime(row.waitingSince)}
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
