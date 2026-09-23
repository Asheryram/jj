import { useEffect, useState } from 'react'
import { api, ApiError, type CapitalNeedingReview } from '../../lib/api'
import { useStore } from '../../state/store'
import { cedis, dateTime } from '../../lib/format'
import { Button, Callout, Card, CardHead, EmptyState, PageHead, Spinner, TextInput } from '../../components/ui'
import { AlertIcon, SearchIcon } from '../../components/icons'

/**
 * Corrects a top-up James logged as plain personal capital when it was
 * actually Paystack money paying DataHub back.
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
  const matches =
    trimmed.length === 0
      ? []
      : (rows ?? []).filter((row) => {
          if (row.description.toLowerCase().includes(trimmed)) return true
          if (dateTime(row.occurredAt).toLowerCase().includes(trimmed)) return true
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

  return (
    <div>
      <PageHead
        title="Float corrections"
        subtitle="Fix a top-up that was logged as personal capital but was actually Paystack money paying DataHub back."
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
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3"
                >
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-50">{cedis(row.amount)}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {row.description} · {dateTime(row.occurredAt)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busyId === row.id}
                    onClick={() => void reclassify(row)}
                  >
                    Mark as Paystack reimbursement
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
