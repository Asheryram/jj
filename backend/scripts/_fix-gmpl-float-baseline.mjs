/**
 * One-off: resets GMPL's `supplierFloatCapitalBaseline` back to 0 in
 * production.
 *
 * `FloatMonitorService.logCapital` used to fall back to a live balance check
 * when seeding a provider's baseline, so the first top-up logged after GMPL
 * went live seeded it from whatever GMPL's wallet actually held at that
 * moment (a live, real-money balance), not 0. That inflated "Should hold" by
 * that same amount for every capital summary since, even though no capital
 * had actually been tracked in yet. Fixed at the root in
 * `FloatMonitorService` (the baseline now always starts at 0); this just
 * corrects the one row production had already seeded wrong before that fix
 * landed. Preserves `capturedAt` as-is, only `balance` was ever wrong.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prod = new PrismaClient({ datasources: { db: { url: process.env.LIVE_DATABASE_URL } } })

const before = await prod.setting.findUnique({ where: { key: 'supplierFloatCapitalBaseline:gmpl' } })
console.log('baseline before:', JSON.stringify(before.value))

await prod.setting.update({
  where: { key: 'supplierFloatCapitalBaseline:gmpl' },
  data: { value: { balance: 0, capturedAt: before.value.capturedAt } },
})

const after = await prod.setting.findUnique({ where: { key: 'supplierFloatCapitalBaseline:gmpl' } })
console.log('baseline after:', JSON.stringify(after.value))

await prod.$disconnect()
process.exit(0)
