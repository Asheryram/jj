import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * Every "email only on the edges" alert in this codebase (`SolvencyService`'s
 * balance/split/refund-overlap checks, `FloatMonitorService`'s watch/risk and
 * discrepancy checks) stores its last-known state in a `Setting` row and
 * follows the same shape: read the stored value, decide whether the world has
 * moved since, and if so write the new value and act (send an email, log a
 * recovery).
 *
 * Read and write used to be two separate round trips — `findUnique` then
 * `upsert` — which is a real race, not a hypothetical one. Two callers can
 * read the same "before" value and both decide to act on it: two orders
 * dispatching close together both call `FloatMonitorService.record` (the
 * float check runs on *every* paid order, not on a slow interval), two
 * 30-minute ticks overlapping because a mail send ran long, or — in a
 * horizontally-scaled deployment — two instances of this process watching
 * the same database, each with its own timer. Whichever caller's write lands
 * last simply overwrites the other's with whatever it read, which can freeze
 * the stored state one step behind reality (an alert never clears, or a
 * worse level gets silently downgraded back by a race loser's stale read) or
 * send the same alert twice.
 *
 * This makes the transition itself atomic: the caller states what it
 * believes the current value is and what it wants to change it to, and only
 * the racer whose belief was still true at the moment of the write actually
 * performs it — everyone else's `Setting.updateMany` matches zero rows and
 * gets `false` back, meaning "someone already handled this, do not also
 * act." Same "conditional update, check the count" idiom already used
 * elsewhere in this codebase for claiming a refund or an order
 * (`FulfilmentService.reorder`), just applied to a flag instead of a row.
 */
export async function claimTransition(
  prisma: Pick<PrismaClient, 'setting'>,
  key: string,
  from: Prisma.InputJsonValue,
  to: Prisma.InputJsonValue,
): Promise<boolean> {
  // Guarantee the row exists before racing to transition it, without ever
  // resetting one that already does. `create` either wins (this is the very
  // first check ever run for this key) or hits the unique constraint on
  // `key` — Postgres allows exactly one concurrent insert to succeed for a
  // given primary key, so this can never itself become the race it exists
  // to prevent.
  try {
    await prisma.setting.create({ data: { key, value: from } })
  } catch {
    // Already exists. Expected in steady state — every check after the first.
  }

  const claim = await prisma.setting.updateMany({
    where: { key, value: { equals: from } },
    data: { value: to },
  })
  return claim.count === 1
}
