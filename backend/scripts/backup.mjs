/**
 * Take a compressed backup of the database.
 *
 * This exists because the free tier of every managed Postgres either keeps no
 * restorable history or keeps a few hours of it, and this database is not the
 * kind you can shrug about losing. It holds the ledger, every agent's balance
 * and every payment reference — the only record of who is owed what. Losing it
 * does not mean re-entering data, it means not knowing.
 *
 * Runs pg_dump inside a throwaway Postgres container, so no client tools need to
 * be installed and the version always matches the server. Output is streamed to
 * a gzipped file; nothing is buffered in memory and nothing is written to a
 * volume, which keeps it working the same on Windows as anywhere else.
 *
 *   npm run db:backup
 *   npm run db:backup -- --out /path/to/dir
 *
 * To restore into an empty database:
 *
 *   gunzip -c backups/<file>.sql.gz | docker run --rm -i postgres:17-alpine \
 *     psql "$DATABASE_URL"
 */
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { createGzip } from 'node:zlib'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

const PG_IMAGE = 'postgres:17-alpine'

/** Read DATABASE_URL from the environment, falling back to .env. */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = resolve(process.cwd(), '.env')
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const match = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line)
      if (match) return match[1].trim().replace(/^["']|["']$/g, '')
    }
  }
  return null
}

/** Never print the password, here or in an error. */
function redact(url) {
  return url.replace(/:\/\/[^@]*@/, '://***@')
}

const url = databaseUrl()
if (!url) {
  console.error('No DATABASE_URL. Set it in the environment or in backend/.env.')
  process.exit(1)
}

const outDir = (() => {
  const flag = process.argv.indexOf('--out')
  return flag > -1 && process.argv[flag + 1] ? process.argv[flag + 1] : 'backups'
})()
mkdirSync(outDir, { recursive: true })

// Sortable, filename-safe, and no colons — Windows rejects those in a filename.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
const outFile = join(outDir, `jdc-${stamp}.sql.gz`)

/**
 * A local database is reached through the host, not through the container's own
 * loopback — inside the container `localhost` is the container.
 */
const hostAdjusted = url
  .replace('@localhost:', '@host.docker.internal:')
  .replace('@127.0.0.1:', '@host.docker.internal:')

/**
 * Strip the parameters Prisma understands and libpq does not.
 *
 * `?schema=public` is Prisma's own; pg_dump refuses the whole connection string
 * over it. The pooling ones are equally meaningless to pg_dump. Anything left —
 * `sslmode` in particular, which every hosted provider needs — is passed
 * through untouched.
 */
const PRISMA_ONLY = ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'socket_timeout']

const { reachable, namedSchema } = (() => {
  let parsed
  try {
    parsed = new URL(hostAdjusted)
  } catch {
    // Not parseable as a URL: hand it over as-is and let pg_dump complain.
    return { reachable: hostAdjusted, namedSchema: null }
  }
  const schema = parsed.searchParams.get('schema')
  for (const key of PRISMA_ONLY) parsed.searchParams.delete(key)
  return {
    reachable: parsed.toString(),
    // A non-default schema has to be named explicitly, or the dump is empty.
    namedSchema: schema && schema !== 'public' ? schema : null,
  }
})()

console.log(`backing up ${redact(reachable)}`)
console.log(`        -> ${outFile}`)

const dump = spawn(
  'docker',
  [
    'run',
    '--rm',
    '-i',
    '--add-host=host.docker.internal:host-gateway',
    PG_IMAGE,
    'pg_dump',
    // --no-owner/--no-privileges so the dump restores into a database owned by
    // a differently-named role, which is the normal case when moving hosts.
    '--no-owner',
    '--no-privileges',
    ...(namedSchema ? ['--schema', namedSchema] : []),
    reachable,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)

let stderr = ''
dump.stderr.on('data', (chunk) => {
  stderr += chunk.toString()
})

try {
  await pipeline(dump.stdout, createGzip({ level: 9 }), createWriteStream(outFile))
} catch (error) {
  console.error(`\nBackup failed while writing: ${error.message}`)
  process.exit(1)
}

const code = await new Promise((done) => dump.on('close', done))

if (code !== 0) {
  console.error(`\npg_dump exited ${code}`)
  // Redacted, because pg_dump echoes the connection string on failure.
  if (stderr.trim()) console.error(redact(stderr.trim()))
  process.exit(1)
}

const { size } = statSync(outFile)
if (size < 1024) {
  console.error(`\nThe file is only ${size} bytes. That is not a real backup — treat it as failed.`)
  process.exit(1)
}

console.log(`\nDone. ${(size / 1024).toFixed(1)} KB compressed.`)
console.log('Keep a copy somewhere that is not the same provider as the database.')
