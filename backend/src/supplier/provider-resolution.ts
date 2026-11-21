import type { PrismaService } from '../prisma/prisma.service'
import { asProvider, type SupplierProviderCode } from './providers'

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
  // A code with no row is history from before GMPL (DataHub); a row naming a
  // supplier we do not know throws rather than being sent to DataHub.
  return asProvider(row?.provider)
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
    select: { amount: true, provider: true, order: { select: { supplierCodeAtSale: true } } },
  })
  const codes = [...new Set(rows.map((r) => r.order?.supplierCodeAtSale).filter((c): c is string => Boolean(c)))]
  const suppliers = await prisma.supplierProduct.findMany({
    where: { code: { in: codes } },
    select: { code: true, provider: true },
  })
  const providerByCode = new Map(suppliers.map((s) => [s.code, s.provider]))
  // A cost row stamped with the provider that charged it wins (a reorder can
  // move the order's own SKU to the other provider afterwards); older rows,
  // booked before the stamp existed, still go by the order's SKU.
  const providerOf = (row: (typeof rows)[number]) => {
    if (row.provider) return row.provider
    const code = row.order?.supplierCodeAtSale
    return code ? (providerByCode.get(code) ?? 'datahub-gh') : 'datahub-gh'
  }
  return -rows.filter((r) => providerOf(r) === provider).reduce((sum, r) => sum + r.amount, 0)
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
  return provider === 'datahub-gh' ? { OR: [{ provider: 'datahub-gh' }, { provider: null }] } : { provider }
}

/**
 * All-time pesewas reimbursed to one provider's float, less whatever of that
 * has since been reversed entirely (a duplicate submission or a plain
 * logging mistake, see `FloatMonitorService.reverseCapitalEntry`, an entry
 * that was never a real movement at all, not one that happened but needs
 * relabelling).
 */
export async function reimbursedByProvider(
  prisma: Pick<PrismaService, 'ledgerEntry' | 'treasuryTransfer'>,
  provider: SupplierProviderCode,
): Promise<number> {
  const [rows, inTransit] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { kind: { in: ['capital_in_reimbursement', 'capital_out'] }, ...capitalProviderFilter(provider) },
      select: { id: true, kind: true, amount: true, idempotencyKey: true },
    }),
    refillsInTransit(prisma, provider),
  ])
  const reversedIds = new Set(
    rows
      .filter((r) => r.kind === 'capital_out' && r.idempotencyKey.startsWith('correction:'))
      .map((r) => r.idempotencyKey.split(':')[1]),
  )
  const landed = rows
    .filter((r) => r.kind === 'capital_in_reimbursement' && !reversedIds.has(r.id))
    .reduce((sum, r) => sum + r.amount, 0)
  // Counted as reimbursed from Paystack's side the moment it left, see
  // `refillsInTransit`, so Free to spend does not change while it travels.
  return landed + inTransit
}

/**
 * Float refills Paystack has paid out to an approved MoMo number that nobody
 * has yet confirmed reached the supplier float (`TreasuryTransfer.landedAt`).
 *
 * The second hop, MoMo into DataHub/GMPL, is done by hand and the app cannot
 * see it. This money has left Paystack and is meant for the float, so
 * Paystack's side (`reimbursedByProvider`, and through it Free to spend)
 * counts it as reimbursed. The float's own side
 * (`FloatMonitorService.capitalSummary`, its expected balance) does not until
 * it is confirmed, because until then the float does not have it.
 */
export async function refillsInTransit(
  prisma: Pick<PrismaService, 'treasuryTransfer'>,
  provider: SupplierProviderCode,
): Promise<number> {
  const result = await prisma.treasuryTransfer.aggregate({
    where: {
      purpose: 'provider_refill',
      status: 'success',
      landedAt: null,
      ...(provider === 'datahub-gh' ? { OR: [{ provider: 'datahub-gh' }, { provider: null }] } : { provider }),
    },
    _sum: { amount: true },
  })
  return result._sum.amount ?? 0
}
