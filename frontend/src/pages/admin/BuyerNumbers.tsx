import { useEffect, useMemo, useState } from 'react'
import { api, ApiError, type BuyerNumber } from '../../lib/api'
import { cedis, dateTime } from '../../lib/format'
import { prettyPhone } from '../../lib/networks'
import { downloadCsv } from '../../lib/csv'
import { useRemembered } from '../../lib/remember'
import {
  Button,
  Callout,
  Card,
  EmptyState,
  NetworkChip,
  PageHead,
  Segmented,
  Spinner,
  StatTile,
  TableWrap,
  Td,
  TextInput,
  Th,
} from '../../components/ui'
import { DownloadIcon, SearchIcon, UsersIcon } from '../../components/icons'

type By = 'recipient' | 'buyer'
type Kind = 'data' | 'airtime' | 'all'

const PAGE = 100

/**
 * Every phone number that has bought on the platform, from delivered orders:
 * the numbers bundles went to, or the receipt numbers of whoever bought them.
 * Searchable here, and downloadable as a spreadsheet.
 */
export default function BuyerNumbers() {
  const [by, setBy] = useRemembered<By>('numbers-by', 'recipient', ['recipient', 'buyer'])
  const [kind, setKind] = useRemembered<Kind>('numbers-kind', 'data', ['data', 'airtime', 'all'])
  const [rows, setRows] = useState<BuyerNumber[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)

  useEffect(() => {
    let live = true
    setRows(null)
    setShown(PAGE)
    api
      .buyerNumbers(by, kind)
      .then((result) => {
        if (!live) return
        setRows(result)
        setError('')
      })
      .catch((caught) => live && setError(caught instanceof ApiError ? caught.message : 'Could not load the numbers.'))
    return () => {
      live = false
    }
  }, [by, kind])

  const filtered = useMemo(() => {
    const digits = query.replace(/\D/g, '')
    if (!rows || !digits) return rows ?? []
    return rows.filter((row) => row.number.includes(digits))
  }, [rows, query])

  const totalSpent = (rows ?? []).reduce((sum, row) => sum + row.spent, 0)
  const repeat = (rows ?? []).filter((row) => row.orders > 1).length
  const what = kind === 'all' ? 'anything' : kind

  const exportCsv = () =>
    downloadCsv(
      `${by === 'buyer' ? 'buyer' : 'recipient'}-numbers-${kind}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Number', 'Network', 'Networks', 'Orders delivered', 'Total spent (GHS)', 'First order', 'Last order'],
      filtered.map((row) => [
        row.number,
        row.network ?? '',
        row.networks.join(' '),
        row.orders,
        (row.spent / 100).toFixed(2),
        row.firstOrderAt,
        row.lastOrderAt,
      ]),
    )

  return (
    <div>
      <PageHead
        title="Customer numbers"
        subtitle="Every number that has bought on the platform, from delivered orders."
        action={
          rows && rows.length > 0 ? (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <DownloadIcon className="size-4" /> Download CSV
            </Button>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Segmented<By>
          options={[
            { value: 'recipient', label: 'Received the bundle' },
            { value: 'buyer', label: 'Bought it (receipt number)' },
          ]}
          value={by}
          onChange={setBy}
        />
        <Segmented<Kind>
          options={[
            { value: 'data', label: 'Data' },
            { value: 'airtime', label: 'Airtime' },
            { value: 'all', label: 'Everything' },
          ]}
          value={kind}
          onChange={setKind}
        />
      </div>

      {error && (
        <Callout tone="danger" className="mb-3">
          {error}
        </Callout>
      )}

      {rows === null && !error ? (
        <div className="py-12 text-center">
          <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
        </div>
      ) : rows ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatTile label="Numbers" value={rows.length.toLocaleString()} hint={`That have bought ${what}`} tone="brand" />
            <StatTile label="Came back again" value={repeat.toLocaleString()} hint="Bought more than once" />
            <StatTile label="Spent in total" value={cedis(totalSpent)} hint="On delivered orders" />
          </div>

          <Card>
            <div className="border-b border-slate-100 p-3 sm:p-4 dark:border-slate-800">
              <div className="relative sm:max-w-xs">
                <SearchIcon className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-slate-400" />
                <TextInput
                  type="search"
                  inputMode="numeric"
                  placeholder="Search a number"
                  aria-label="Search a number"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setShown(PAGE)
                  }}
                  className="pl-9"
                />
              </div>
            </div>
            {filtered.length === 0 ? (
              <EmptyState
                icon={<UsersIcon className="size-6" />}
                title={query ? 'No number matches that' : `Nobody has bought ${what} yet`}
                detail={query ? 'Try fewer digits.' : 'Numbers show up here once an order is delivered.'}
              />
            ) : (
              <>
                <TableWrap caption="Customer numbers">
                  <thead>
                    <tr>
                      <Th>Number</Th>
                      <Th>Network</Th>
                      <Th align="right">Orders</Th>
                      <Th align="right">Spent</Th>
                      <Th>Last order</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, shown).map((row) => (
                      <tr key={row.number} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                        <Td className="tabular font-medium text-slate-900 dark:text-slate-50">{prettyPhone(row.number)}</Td>
                        <Td>{row.network ? <NetworkChip network={row.network} /> : '-'}</Td>
                        <Td align="right" className="tabular">{row.orders}</Td>
                        <Td align="right" className="tabular font-semibold">{cedis(row.spent)}</Td>
                        <Td className="text-slate-600 dark:text-slate-300">{dateTime(row.lastOrderAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
                {filtered.length > shown && (
                  <div className="border-t border-slate-100 p-3 text-center dark:border-slate-800">
                    <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                      Show more ({(filtered.length - shown).toLocaleString()} left)
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            These are customers' personal numbers. Under Ghana's Data Protection Act, only message them about
            marketing if they agreed to it.
          </p>
        </>
      ) : null}
    </div>
  )
}
