import { useEffect, useState } from 'react'
import { api, ApiError, type CapitalNeedingReview } from '../../lib/api'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
import { Button, Callout, Card, CardHead, EmptyState, PageHead, Spinner, TextInput } from '../../components/ui'
import { AlertIcon, SearchIcon } from '../../components/icons'

/**
 * Corrects a top-up James logged as plain personal capital when it was
 * actually Paystack money paying DataHub back, or reverses one that was
 * never a real movement at all.
 *
 * Anchored on the original top-up, not on whatever it may have become: an
 * original always keeps its own real date, a reimbursement produced by
 * reclassifying one does not (it's stamped at correction time), so two
 * reimbursements from different days can end up reading identically. The
 * original never has that problem, so it's what's searched and shown, with
 * the reimbursement (if any) nested under it, exactly the thing that
 * actually needs reversing to clear the amount.
 *
 * Deliberately not a list with a button next to every row, sitting on the
 * Float panel where it's easy to click by accident. Nothing here shows
 * until an admin deliberately types a search, and only a superadmin can
 * reach it at all: correcting a logged capital movement changes what "Your
 * profit" and "Free to withdraw now" show elsewhere, one step more
 * sensitive than logging a fresh one.
 */
export default function FloatCorrections() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<CapitalNeedingReview[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api
      .floatCapitalNeedingReview()
      .then((result) => live && setRows(result))
      .catch(
        (caught) =>
          live &&
          setError(caught instanceof ApiError ? caught.message : 'We could not load these entries.'),
      )
    return () => {
      live = false
    }
  }, [])

  const trimmed = query.trim().toLowerCase()
  /** Matches on the row itself, or on its reimbursement child, if any. */
  const matches =
    trimmed.length === 0
      ? []
      : (rows ?? []).filter((row) => {
          if (row.description.toLowerCase().includes(trimmed)) return true
          if (dateTime(row.occurredAt).toLowerCase().includes(trimmed)) return true
          if (row.reimbursedAs) {
            if (row.reimbursedAs.description.toLowerCase().includes(trimmed)) return true
            if (dateTime(row.reimbursedAs.occurredAt).toLowerCase().includes(trimmed)) return true
          }
          const ghs = (row.amount / 100).toFixed(2)
          return ghs.includes(trimmed) || ghs.replace('.', '').includes(trimmed)
        })

  const reclassify = async (row: CapitalNeedingReview) => {
    setBusyId(row.id)
    try {
      await api.reclassifyFloatCapital(row.id)
      pushToast({ tone: 'success', title: `${cedis(row.amount)} reclassified as a reimbursement` })
      setRows((current) => (current ?? []).filter((r) => r.id !== row.id))
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not correct that entry.',
      })
    } finally {
      setBusyId(null)
    }
  }

  /**
   * For an entry that was never a real movement at all, a duplicate
   * submission, a logging mistake, not one that happened but was labelled
   * wrong. Cancels it entirely, no reissue, unlike `reclassify` above.
   *
   * `targetId` lets the parent's own button reverse its downline in one
   * click: if `row` has been reclassified, reversing the parent's own id
   * would do nothing (it already contributes nothing to any total), so
   * "reverse capital" passes the child's id instead when one exists. The
   * child's own button always passes its own id.
   */
  const reverse = async (row: CapitalNeedingReview, targetId: string, amount: number) => {
    setBusyId(targetId)
    try {
      await api.reverseFloatCapital(targetId)
      pushToast({ tone: 'success', title: `${cedis(amount)} reversed, never a real movement` })
      setRows((current) => (current ?? []).filter((r) => r.id !== row.id))
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not reverse that entry.',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <PageHead
        title="Float corrections"
        subtitle="Fix a top-up that was logged as personal capital but was actually Paystack money paying DataHub back, or reverse one that was never a real movement at all."
      />

      <Card className="mt-3">
        <CardHead title="Search for the entry to correct" />
        <div className="space-y-3 p-4 sm:p-5">
          {error && (
            <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
              {error}
            </Callout>
          )}

          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <TextInput
              className="pl-9"
              placeholder="Search by amount, date, or note"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {rows === null ? (
            <div className="py-8 text-center">
              <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
            </div>
          ) : trimmed.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Type an amount, a date, or part of a note to find the entry, nothing lists here on
              its own.
            </p>
          ) : matches.length === 0 ? (
            <EmptyState title="No match" detail="Nothing logged as personal capital matches that search." />
          ) : (
            <div className="space-y-2">
              {matches.map((row) => (
                <div key={row.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-50">{cedis(row.amount)}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {row.description} · {dateTime(row.occurredAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {row.kind === 'capital_in' && !row.reimbursedAs && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={busyId === row.id}
                          onClick={() => void reclassify(row)}
                        >
                          Mark as Paystack reimbursement
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        loading={busyId === (row.reimbursedAs?.id ?? row.id)}
                        onClick={() =>
                          void reverse(
                            row,
                            row.reimbursedAs?.id ?? row.id,
                            row.reimbursedAs?.amount ?? row.amount,
                          )
                        }
                      >
                        {row.reimbursedAs ? 'Reverse capital (and its reimbursement)' : "Wasn't real, reverse it"}
                      </Button>
                    </div>
                  </div>

                  {row.reimbursedAs && (
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2.5 pl-4 dark:border-slate-800">
                      <div>
                        <p className="text-xs text-slate-400 dark:text-slate-500">└─ became a reimbursement</p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {cedis(row.reimbursedAs.amount)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {row.reimbursedAs.description} · {dateTime(row.reimbursedAs.occurredAt)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busyId === row.reimbursedAs.id}
                        onClick={() => void reverse(row, row.reimbursedAs!.id, row.reimbursedAs!.amount)}
                      >
                        Reverse just the reimbursement
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
