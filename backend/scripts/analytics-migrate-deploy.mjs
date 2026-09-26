#!/usr/bin/env node
/**
 * Runs `prisma migrate deploy` against the analytics warehouse, unless
 * `ANALYTICS_DATABASE_URL` isn't set yet, in which case it skips instead of
 * failing.
 *
 * The main database's own migration in `release` still fails closed on
 * purpose, see that script's own comment: an API serving requests against a
 * half-migrated money database is worse than one that is down and says so.
 * The warehouse is the opposite case, and this now actually behaves that
 * way: it is documented everywhere in `prisma-analytics/schema.prisma` as
 * disposable and never a source of truth, so a failure here is loud (still
 * printed in full, never swallowed) but never fatal to the release. This
 * used to fail closed too, until a stuck migration on the live warehouse
 * (`silver_ledger_facts.hour` added `NOT NULL` with no default onto a
 * non-empty table) took the entire API down on every restart for two days,
 * over a table nothing but `/analytics` reads. Real orders, payouts and
 * everything else this platform actually runs on must never wait on this
 * database's migrations succeeding.
 */
import { spawnSync } from 'node:child_process'

if (!process.env.ANALYTICS_DATABASE_URL) {
  console.log('ANALYTICS_DATABASE_URL is not set, skipping the analytics warehouse migration. /analytics will be unavailable until it is.')
  process.exit(0)
}

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma-analytics/schema.prisma'], {
  stdio: 'inherit',
  shell: true,
})
if (result.status !== 0) {
  console.error(
    `Analytics warehouse migration failed (exit ${result.status}). Continuing the release anyway, ` +
      '/analytics will be unavailable until this is fixed, nothing else on the platform depends on it.',
  )
}
process.exit(0)
