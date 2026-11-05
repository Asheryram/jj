/** One cell, quoted only when it has to be. */
function cell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Save rows as a CSV file the accountant can open in Excel or Sheets. The
 * first row is the headings; a byte-order mark keeps Excel reading the cedi
 * amounts and names correctly.
 */
export function downloadCsv(filename: string, headings: string[], rows: unknown[][]): void {
  const csv = '﻿' + [headings, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
