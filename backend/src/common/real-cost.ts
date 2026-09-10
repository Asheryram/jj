import type { Prisma } from '@prisma/client'
import type { PrismaService } from '../prisma/prisma.service'

/**
 * The most recent price a supplier has actually charged for `supplierCode`,
 * across any completed order — not just one dispatch's own reply. Null once
 * nothing has ever come back with a real charge attached.
 *
 * The one place this floor is computed, used both to cap how low an admin can
 * price a product (`AdminService.setTier`, `setProductActive`) and, when a
 * specific dispatch didn't report its own charge, to book that order's ledger
 * cost against the best number on file for the bundle rather than a frozen
 * catalogue guess (`FulfilmentService.recordDelivered`) — a real charge from
 * a sibling sale of the exact same bundle is worth more than an estimate
 * snapshotted whenever this dispatch happened to be created.
 */
export async function lastRealCost(
  client: PrismaService | Prisma.TransactionClient,
  supplierCode: string | null | undefined,
): Promise<number | null> {
  if (!supplierCode) return null
  const dispatch = await client.supplierDispatch.findFirst({
    where: { supplierCode, providerCharged: { not: null }, order: { status: 'completed' } },
    orderBy: { createdAt: 'desc' },
    select: { providerCharged: true },
  })
  return dispatch?.providerCharged ?? null
}
