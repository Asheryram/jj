/**
 * Remove everything the platform was selling that no supplier actually provides.
 *
 * The catalogue began as seed data: 36 SKUs invented to make the app look
 * populated, of which DataHub GH really sells none — their prices were wrong on
 * every row, five bundles did not exist at all, and airtime, voice, SMS, AFA and
 * result checkers were attributed to a provider whose API sells data only.
 *
 * `GET /bundles` is the source of truth now, so this clears out what predates
 * it. Two rules keep it safe to run:
 *
 *  · A product an order touched is deactivated, never deleted. The sale happened
 *    and the receipt has to keep resolving.
 *  · A supplier SKU is only removed once nothing points at it — no product, no
 *    dispatch record.
 *
 * Run with: npx tsx scripts/purge-unsupplied.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const supplied = await prisma.supplierProduct.findMany({
    where: { provider: 'datahub-gh', available: true },
    select: { code: true },
  })
  const suppliedCodes = new Set(supplied.map((s) => s.code))
  console.log(`${suppliedCodes.size} SKUs are currently listed by DataHub GH.`)

  const products = await prisma.product.findMany({
    select: { id: true, name: true, category: true, supplierCode: true, active: true },
  })

  const doomed = products.filter(
    (p) => !p.supplierCode || !suppliedCodes.has(p.supplierCode),
  )
  if (doomed.length === 0) {
    console.log('Nothing to purge — every product is backed by a listed SKU.')
    return
  }

  const withOrders = await prisma.order.groupBy({
    by: ['productId'],
    where: { productId: { in: doomed.map((p) => p.id) } },
    _count: { _all: true },
  })
  const sold = new Set(withOrders.map((o) => o.productId))

  const toDeactivate = doomed.filter((p) => sold.has(p.id))
  const toDelete = doomed.filter((p) => !sold.has(p.id))

  await prisma.$transaction(async (tx) => {
    if (toDeactivate.length > 0) {
      await tx.product.updateMany({
        where: { id: { in: toDeactivate.map((p) => p.id) } },
        data: { active: false },
      })
    }
    if (toDelete.length > 0) {
      // agent_prices cascade on delete; orders are the only thing that would
      // block us, and those products are in the other list.
      await tx.product.deleteMany({ where: { id: { in: toDelete.map((p) => p.id) } } })
    }
  })

  console.log(`Deleted ${toDelete.length} product(s) that never sold:`)
  for (const p of toDelete) console.log(`   − ${p.category.padEnd(8)} ${p.name}`)
  if (toDeactivate.length > 0) {
    console.log(`Kept but deactivated ${toDeactivate.length} product(s) with order history:`)
    for (const p of toDeactivate) console.log(`   · ${p.category.padEnd(8)} ${p.name}`)
  }

  // Now the supplier rows nothing references.
  const orphans = await prisma.supplierProduct.findMany({
    where: {
      OR: [{ provider: { not: 'datahub-gh' } }, { available: false }],
      products: { none: {} },
      dispatches: { none: {} },
    },
    select: { code: true, provider: true, name: true },
  })
  if (orphans.length > 0) {
    await prisma.supplierProduct.deleteMany({
      where: { code: { in: orphans.map((s) => s.code) } },
    })
  }
  console.log(`Deleted ${orphans.length} unreferenced supplier SKU(s).`)

  const remaining = await prisma.supplierProduct.groupBy({
    by: ['provider', 'available'],
    _count: { _all: true },
  })
  console.log('\nSupplier catalogue now:')
  for (const r of remaining) {
    console.log(`   ${r.provider.padEnd(22)} available=${r.available}  ${r._count._all}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
