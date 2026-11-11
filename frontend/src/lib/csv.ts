/**
 * One cell, quoted only when it has to be.
 *
 * A run of digits starting with 0 (a phone number, 0241234567) is written as
 * the formula ="0241234567": opened in Excel or Google Sheets it shows as text
 * with its leading 0, where a bare 0241234567 is read as a number and loses it.
 */
export function csvCell(value: unknown): string {
  const raw = value == null ? '' : String(value)
  const text = /^0\d{5,}$/.test(raw) ? `="${raw}"` : raw
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Save rows as a CSV file the accountant can open in Excel or Sheets. The
 * first row is the headings; a byte-order mark keeps Excel reading the cedi
 * amounts and names correctly.
 */
export function downloadCsv(filename: string, headings: string[], rows: unknown[][]): void {
  const csv = '﻿' + [headings, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
