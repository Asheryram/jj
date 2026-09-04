import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { cedis, dateTime } from '../../lib/format'
import { Card, CardHead, EmptyState, NetworkChip, PageHead, Spinner, TableWrap, Td, Th } from '../../components/ui'
import { CheckIcon } from '../../components/icons'

/**
 * Whether each product's catalogue cost still matches what the supplier
 * actually charged, going only by its most recent sale — see
 * `AdminService.catalogueAccuracy`.
 *
 * A dedicated page, not a card on Overview: this is a report to review, not
 * a queue to clear, but it is exactly the kind of thing that keeps growing —
 * one row per product ever sold — so it gets the same treatment as Refunds
 * and Needs attention rather than living inline on the dashboard. Overview
 * only ever shows the worst current losses, with a link here for the rest.
 *
 * Last sale only, not an all-time total: a product that was mispriced once
 * last year and has been fine ever since would otherwise sit in the red
 * forever. This answers "is the catalogue right *now*", which is the
 * question that actually decides whether a price needs updating today.
 */
export default function CatalogueAccuracy() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.catalogueAccuracy>> | null>(null)

  useEffect(() => {
    let live = true
    api
      .catalogueAccuracy()
      .then((result) => live && setRows(result))
      .catch(() => live && setRows([]))
    return () => {
      live = false
    }
  }, [])

  const sorted = [...(rows ?? [])].sort((a, b) => a.diff - b.diff)

  return (
    <div>
      <PageHead
        title="Catalogue accuracy"
        subtitle="Each product's most recent sale — what the catalogue said it would cost against what the supplier actually charged."
      />

      <Card className="mt-3">
        <CardHead
          title="Products sold at least once"
          subtitle="Biggest loss first — those are the catalogue prices most worth fixing today"
        />
        {rows === null ? (
          <div className="py-8 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<CheckIcon className="size-6" />}
            title="Nothing sold yet"
            detail="Once a bundle has been delivered at least once, its most recent sale will show up here."
          />
        ) : (
          <TableWrap caption="Catalogue accuracy by product, last sale only">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Last order</Th>
                <Th align="right">Catalogue said</Th>
                <Th align="right">Actually charged</Th>
                <Th align="right">Diff</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((product) => (
                <tr key={product.supplierCode}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <NetworkChip network={product.network} />
                      <span className="font-medium text-slate-900 dark:text-slate-50">{product.name}</span>
                    </div>
                  </Td>
                  <Td>
                    <p className="tabular text-xs text-slate-500 dark:text-slate-400">{product.lastOrderRef}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{dateTime(product.lastSoldAt)}</p>
                  </Td>
                  <Td align="right" className="tabular text-slate-600 dark:text-slate-300">
                    {cedis(product.believed)}
                  </Td>
                  <Td align="right" className="tabular text-slate-600 dark:text-slate-300">
                    {cedis(product.charged)}
                  </Td>
                  <Td
                    align="right"
                    className={`tabular font-semibold ${
                      product.diff >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {cedis(product.diff, { sign: true })}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <p className="p-4 pt-0 text-xs text-slate-500 dark:text-slate-400 sm:px-5">
          A product sitting in the red here has a catalogue price that no longer matches what the
          supplier charges — worth updating on the Cost prices page. This is already inside your
          margin, not a separate cost — it only shows where a slice of it came from.
        </p>
      </Card>
    </div>
  )
}
