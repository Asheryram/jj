/**
 * Block until Postgres accepts connections.
 *
 * `docker compose up -d` returns as soon as the container is created, which is
 * well before Postgres has finished initialising its data directory on a first
 * run. Running `prisma migrate` in that window fails with a connection error
 * that looks like a configuration problem but is only a race.
 */
import { execFileSync } from 'node:child_process'

const DEADLINE_MS = 60_000
const started = Date.now()

process.stdout.write('waiting for postgres')

while (Date.now() - started < DEADLINE_MS) {
  try {
    execFileSync('docker', ['exec', 'jdc-postgres', 'pg_isready', '-U', 'jdc', '-d', 'jdc'], {
      stdio: 'ignore',
    })
    process.stdout.write(` ready in ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
    process.exit(0)
  } catch {
    process.stdout.write('.')
    // Busy-wait rather than pull in a sleep dependency; the interval is short.
    const until = Date.now() + 1000
    while (Date.now() < until) {}
  }
}

process.stdout.write('\n')
console.error(
  'postgres did not become ready within 60s.\n' +
    'Check `docker compose ps` and `docker compose logs db`.\n' +
    'If Docker Desktop is not running, start it first.',
)
process.exit(1)
