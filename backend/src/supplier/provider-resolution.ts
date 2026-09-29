import type { PrismaService } from '../prisma/prisma.service'
import type { SupplierProviderCode } from '../settings/settings.service'

/**
 * Which provider actually owns a given `SupplierProduct.code`.
 *
 * Resolved live rather than trusted from anywhere else: a `Product`/`Order`
 * only ever stores the SKU code (`supplierCode`/`supplierCodeAtSale`), never
 * `provider` redundantly alongside it, so this join is the one source of
 * truth for "which supplier was this." `null`, or a code that no longer
 * resolves to a row, defaults to DataHub, correct for every order placed
 * before GMPL existed.
 *
 * Kept in its own file, not in `supplier.service.ts` or
 * `float-monitor.service.ts`: both of those import from each other's file
 * for DI (`SupplierService` injects `FloatMonitorService`), and a plain
 * function import the other direction would make that a circular module
 * dependency. This has no dependents of its own, so both can import it
 * freely.
 */
export async function resolveSupplierProvider(
  prisma: Pick<PrismaService, 'supplierProduct'>,
  supplierCode: string | null,
): Promise<SupplierProviderCode> {
  if (!supplierCode) return 'datahub-gh'
  const row = await prisma.supplierProduct.findUnique({ where: { code: supplierCode }, select: { provider: true } })
  return (row?.provider as SupplierProviderCode | undefined) ?? 'datahub-gh'
}

/**
 * All-time pesewas one provider has actually charged for bundles, resolved
 * by joining every `supplier_cost` `LedgerEntry` back to the order it
 * settled and from there to the `SupplierProduct` it sold against — never a
 * denormalized column on the ledger row itself, same reasoning as
 * `resolveSupplierProvider`. Shared by `FloatMonitorService.capitalSummary`/
 * `expectedBalance`, `SolvencyService`, and `EtlService`'s warehouse
 * snapshot, so none of the three can ever disagree about what "this
 * provider's bundle cost" means.
 */
export async function bundleCostByProvider(
  prisma: Pick<PrismaService, 'ledgerEntry' | 'supplierProduct'>,
  provider: SupplierProviderCode,
): Promise<number> {
  const rows = await prisma.ledgerEntry.findMany({
    where: { kind: 'supplier_cost' },
    select: { amount: true, order: { select: { supplierCodeAtSale: true } } },
  })
  const codes = [...new Set(rows.map((r) => r.order?.supplierCodeAtSale).filter((c): c is string => Boolean(c)))]
  const suppliers = await prisma.supplierProduct.findMany({
    where: { code: { in: codes } },
    select: { code: true, provider: true },
  })
  const providerByCode = new Map(suppliers.map((s) => [s.code, s.provider]))
  const matches = (code: string | null | undefined) =>
    provider === 'datahub-gh'
      ? !code || (providerByCode.get(code) ?? 'datahub-gh') === 'datahub-gh'
      : providerByCode.get(code ?? '') === 'gmpl'
  return -rows.filter((r) => matches(r.order?.supplierCodeAtSale)).reduce((sum, r) => sum + r.amount, 0)
}

/**
 * A `LedgerEntry.provider` filter matching everything that belongs to one
 * provider's float, including capital rows logged before GMPL existed (and
 * therefore carrying `provider: null`) — by definition DataHub's, the only
 * supplier that existed then. Only ever used against `capital_in`/
 * `capital_in_reimbursement`/`capital_out`, the one kind of entry that
 * actually carries this column (see `LedgerEntry.provider`'s own comment).
 */
export function capitalProviderFilter(provider: SupplierProviderCode) {
  return provider === 'datahub-gh' ? { OR: [{ provider: 'datahub-gh' }, { provider: null }] } : { provider: 'gmpl' }
}

/**
 * All-time pesewas reimbursed to one provider's float, less whatever of that
 * has since been reversed entirely (a duplicate submission or a plain
 * logging mistake, see `FloatMonitorService.reverseCapitalEntry`, an entry
 * that was never a real movement at all, not one that happened but needs
 * relabelling).
 */
export async function reimbursedByProvider(
  prisma: Pick<PrismaService, 'ledgerEntry'>,
  provider: SupplierProviderCode,
): Promise<number> {
  const rows = await prisma.ledgerEntry.findMany({
    where: { kind: { in: ['capital_in_reimbursement', 'capital_out'] }, ...capitalProviderFilter(provider) },
    select: { id: true, kind: true, amount: true, idempotencyKey: true },
  })
  const reversedIds = new Set(
    rows
      .filter((r) => r.kind === 'capital_out' && r.idempotencyKey.startsWith('correction:'))
      .map((r) => r.idempotencyKey.split(':')[1]),
  )
  return rows
    .filter((r) => r.kind === 'capital_in_reimbursement' && !reversedIds.has(r.id))
    .reduce((sum, r) => sum + r.amount, 0)
}
