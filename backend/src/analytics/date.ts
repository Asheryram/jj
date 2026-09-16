/**
 * Dates as plain YYYYMMDD integers, sorting and filtering as numbers with no
 * timezone library needed. Ghana sits at UTC+0 year-round (no DST), so a
 * plain UTC day boundary already IS the Ghana calendar day, `getUTC*`
 * everywhere below is not an approximation, it is exact for this business.
 */

export function toDateInt(date: Date): number {
  return date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate()
}

export function dateIntToDate(dateInt: number): Date {
  const year = Math.floor(dateInt / 10_000)
  const month = Math.floor((dateInt % 10_000) / 100)
  const day = dateInt % 100
  return new Date(Date.UTC(year, month - 1, day))
}

/** The [start, end) boundary for one calendar day, for a `createdAt` range query. */
export function dayBounds(dateInt: number): { start: Date; end: Date } {
  const start = dateIntToDate(dateInt)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start, end }
}

export function addDays(dateInt: number, days: number): number {
  const date = dateIntToDate(dateInt)
  date.setUTCDate(date.getUTCDate() + days)
  return toDateInt(date)
}
