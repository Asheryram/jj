import type { Prisma } from '@prisma/client'
import type { PrismaService } from '../prisma/prisma.service'

/**
 * Upserts `PendingPriceChange` for one `adminPrice` edit — the one place both
 * `AdminService.setTier` and `applyMarkup` funnel through, so a bundle priced
 * by hand and one repriced in bulk are logged the same way.
 *
 * No-ops the moment the price is not actually moving, and collapses (deletes)
 * the row the moment it round-trips back to what agents were last told —
 * see the model's own doc comment in schema.prisma for why that has to be
 * value-based rather than "just log every edit".
 */
export async function recordPriceChange(
  client: PrismaService | Prisma.TransactionClient,
  productId: string,
  oldPrice: number,
  newPrice: number,
): Promise<void> {
  if (oldPrice === newPrice) return

  const existing = await client.pendingPriceChange.findUnique({ where: { productId } })

  if (!existing) {
    await client.pendingPriceChange.create({
      data: { productId, baselinePrice: oldPrice, currentPrice: newPrice },
    })
    return
  }

  if (newPrice === existing.baselinePrice) {
    await client.pendingPriceChange.delete({ where: { productId } })
    return
  }

  await client.pendingPriceChange.update({
    where: { productId },
    data: { currentPrice: newPrice },
  })
}
