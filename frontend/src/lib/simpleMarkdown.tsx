import type { ReactNode } from 'react'

/**
 * A deliberately small Markdown subset for admin-authored short notices
 * (the site notice modal, and its own preview in Settings), not a general
 * document renderer: bold (double asterisk), italic (single asterisk or
 * underscore), "- "/"* " bullet lists, "1. " numbered lists, and
 * blank-line-separated paragraphs. No links, no
 * headings, no raw HTML, no nested lists — every one of those either isn't
 * needed for a one-paragraph banner or would need real sanitizing to be
 * safe to parse, and this exists to render bold text and a list well, not
 * to become a second Markdown implementation to maintain.
 *
 * The source is always admin-authored (only `PATCH /admin/settings` can set
 * it), never customer input, so there is no untrusted-content/XSS surface
 * here the way there would be if this ever took visitor-supplied text.
 */
export function renderSimpleMarkdown(text: string): ReactNode {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let blockKey = 0

  const listMarker = /^(?:[-*]|\d+\.)\s+/
  const isOrderedLine = (line: string) => /^\d+\.\s+/.test(line.trim())

  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i++
      continue
    }

    if (listMarker.test(lines[i].trim())) {
      const ordered = isOrderedLine(lines[i])
      const items: string[] = []
      while (i < lines.length && lines[i].trim() !== '' && listMarker.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(listMarker, ''))
        i++
      }
      const key = `list-${blockKey++}`
      blocks.push(
        ordered ? (
          <ol key={key} className="list-decimal space-y-0.5 pl-5">
            {items.map((item, idx) => (
              <li key={idx}>{renderInline(item, `${key}-${idx}`)}</li>
            ))}
          </ol>
        ) : (
          <ul key={key} className="list-disc space-y-0.5 pl-5">
            {items.map((item, idx) => (
              <li key={idx}>{renderInline(item, `${key}-${idx}`)}</li>
            ))}
          </ul>
        ),
      )
      continue
    }

    const paraLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !listMarker.test(lines[i].trim())) {
      paraLines.push(lines[i])
      i++
    }
    const key = `p-${blockKey++}`
    blocks.push(<p key={key}>{renderInline(paraLines.join(' '), key)}</p>)
  }

  return <>{blocks}</>
}

/** `**bold**`, `*italic*`, `_italic_`, left to right, non-overlapping, no nesting. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/
  const parts: ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const match = pattern.exec(remaining)
    if (!match) {
      parts.push(remaining)
      break
    }
    if (match.index > 0) parts.push(remaining.slice(0, match.index))
    const bold = match[1]
    const italic = match[2] ?? match[3]
    if (bold !== undefined) {
      parts.push(<strong key={`${keyPrefix}-${key++}`}>{bold}</strong>)
    } else if (italic !== undefined) {
      parts.push(<em key={`${keyPrefix}-${key++}`}>{italic}</em>)
    }
    remaining = remaining.slice(match.index + match[0].length)
  }
  return parts
}
