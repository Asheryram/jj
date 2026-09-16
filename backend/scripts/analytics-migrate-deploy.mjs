#!/usr/bin/env node
/**
 * Runs `prisma migrate deploy` against the analytics warehouse, unless
 * `ANALYTICS_DATABASE_URL` isn't set yet, in which case it skips instead of
 * failing.
 *
 * The main database's own migration in `release` fails closed on purpose,
 * see that script's own comment: an API serving requests against a
 * half-migrated money database is worse than one that is down and says so.
 * The warehouse is the opposite case. It is documented everywhere in
 * `prisma-analytics/schema.prisma` as disposable and never a source of
 * truth, so a platform that hasn't set up the second database yet should
 * still deploy and serve real orders, just without `/analytics` working
 * until that's configured. Once the variable IS set, a failure to migrate
 * against it still fails the release, that's a real misconfiguration worth
 * knowing about immediately, not something to silently limp past.
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
process.exit(result.status ?? 1)
