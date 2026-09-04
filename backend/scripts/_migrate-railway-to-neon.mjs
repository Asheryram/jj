/**
 * One-time data migration: copies every row from the live Railway Postgres
 * database into the freshly-schema-built Neon database, in foreign-key-safe
 * order. Read-only against the source; the target must already have the
 * exact same schema (built via `prisma migrate deploy` against it first).
 *
 * Order matters here - each model only appears after every model it has a
 * @relation to, so inserts never hit a dangling foreign key.
 */
import { PrismaClient } from '@prisma/client'

const RAILWAY_URL = process.env.RAILWAY_URL
const NEON_URL = process.env.NEON_URL

const source = new PrismaClient({ datasources: { db: { url: RAILWAY_URL } } })
const target = new PrismaClient({ datasources: { db: { url: NEON_URL } } })

const MODELS_IN_ORDER = [
  'user',
  'supplierProduct',
  'setting',
  'claimableCredit',
  'beneficiaryRequest',
  'product',
  'branding',
  'brandingRequest',
  'customDomain',
  'setupToken',
  'agentPrice',
  'order',
  'supplierDispatch',
  'payment',
  'refundRequest',
  'transaction',
  'earning',
  'withdrawal',
  'ledgerEntry',
]

const CHUNK_SIZE = 500

function chunk(rows, size) {
  const out = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

const results = []

for (const model of MODELS_IN_ORDER) {
  const rows = await source[model].findMany()
  let inserted = 0
  for (const batch of chunk(rows, CHUNK_SIZE)) {
    const result = await target[model].createMany({ data: batch, skipDuplicates: true })
    inserted += result.count
  }
  const targetCount = await target[model].count()
  results.push({ model, sourceRows: rows.length, inserted, targetCount })
  console.log(
    `${model}: read ${rows.length}, inserted ${inserted}, target now has ${targetCount}${rows.length !== targetCount ? '  <-- MISMATCH' : ''}`,
  )
}

const mismatches = results.filter((r) => r.sourceRows !== r.targetCount)
console.log('\n=== SUMMARY ===')
console.log(JSON.stringify(results, null, 2))
console.log(mismatches.length === 0 ? 'All tables match exactly.' : `${mismatches.length} table(s) MISMATCHED - see above.`)

await source.$disconnect()
await target.$disconnect()
process.exit(mismatches.length === 0 ? 0 : 1)
