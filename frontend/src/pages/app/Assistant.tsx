import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useStore } from '../../state/store'
import { isAdmin } from '../../lib/roles'
import type { ChatTurn } from '../../data/types'
import { Button, Card, PageHead, Spinner, TextInput } from '../../components/ui'
import { AlertIcon, ChevronRightIcon, HelpIcon } from '../../components/icons'

/**
 * A few starting questions rather than a blank box. The people using this
 * are not developers, and an empty text field with no hint of what it can
 * even do is intimidating rather than inviting — these are the real
 * questions each role actually asks, not a feature tour. The backend picks
 * the matching tool set and voice from the caller's own role — see
 * `AssistantService.systemPrompt` — so these just have to match that split.
 */
const AGENT_SUGGESTIONS = [
  'How much have I earned?',
  'How do I get paid?',
  'What are my current prices?',
  'How does my downline work?',
  'Is my shop domain live yet?',
]

const ADMIN_SUGGESTIONS = [
  'Is the float okay right now?',
  'Any refunds waiting on me?',
  'Any numbers stuck waiting on DataHub?',
  'Anything need my attention?',
]

/**
 * Shown as a normal assistant reply, in place, when a question fails outright
 * (a dropped connection, a slow free-tier model timing out, a 500). Kept in
 * `turns` rather than a page-level banner — a banner can be silently
 * overwritten by whatever the *next* message does, so a question asked right
 * before one that fails used to just look ignored, with no trace of what
 * happened. Matched at render time (see the `turn.content ===` check below)
 * to style it distinctly from a real answer.
 */
const CONNECTION_ERROR_REPLY = "Sorry, I couldn't reach the assistant just now. Please try asking again."

/**
 * How many of the most recent turns go to the backend as conversation
 * context — not the whole session. The full history still stays on screen
 * and in `sessionStorage`; only what's sent to the model on each new
 * question is capped, since every turn sent is billed as input tokens on
 * the free-tier model behind this, on every single question asked from
 * here on. Confirmed live: this backend's provider has a real daily token
 * ceiling, not just a per-minute one — see `AssistantService`.
 */
const HISTORY_TURNS_SENT = 12

/**
 * Kept in `sessionStorage`, keyed by user id — so leaving the page (this is
 * a nav item, not a modal; navigating away unmounts it) and coming back
 * still has the conversation, but a different person signing in on the same
 * browser tab never sees someone else's. Cleared automatically when the tab
 * closes; that's the right lifetime for a help chat, not something worth
 * carrying across a whole new browser session.
 */
function storageKey(userId: string | undefined): string | null {
  return userId ? `jdc.assistantChat.${userId}` : null
}

function loadTurns(userId: string | undefined): ChatTurn[] {
  const key = storageKey(userId)
  if (!key) return []
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as ChatTurn[]) : []
  } catch {
    return []
  }
}

/**
 * Renders one line's worth of markup: `**bold**` for emphasis and
 * `[label](/path)` for a screen the assistant is pointing someone to — see
 * `AssistantService.systemPrompt` on the backend for the instruction that
 * produces this shape. A link renders as an actual in-app button rather than
 * plain text, so "go to Refunds" is something to tap, not just read.
 */
function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = []
  // The link alternative comes first and optionally swallows a surrounding
  // `**...**` — the model is told not to bold a link (it already stands out
  // as a button), but this stays correct even when it does anyway.
  const pattern = /(\*{0,2}\[[^\]]+\]\(\/[^)\s]*\)\*{0,2}|\*\*[^*]+\*\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    const linkMatch = /^\*{0,2}\[([^\]]+)\]\((\/[^)\s]*)\)\*{0,2}$/.exec(token)
    if (linkMatch) {
      const [, label, path] = linkMatch
      nodes.push(
        <Link
          key={key++}
          to={path}
          className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white align-middle hover:bg-brand-700"
        >
          {label}
          <ChevronRightIcon className="size-3.5" />
        </Link>,
      )
    } else {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

/** A markdown table's separator row, e.g. `|---|:--:|---|` or `--- | ---`. */
const TABLE_SEPARATOR_ROW = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/

function splitTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/**
 * Renders a whole reply: plain paragraphs through `renderInline`, plus real
 * `<table>` markup for any markdown table the model produced (asked for
 * explicitly, e.g. "as a table", or reached for on its own for naturally
 * tabular data like a per-bundle price/cost/profit breakdown) — wrapped in
 * its own horizontally-scrolling container so a wide table never forces the
 * whole page to scroll sideways on a narrow phone.
 */
function renderReply(text: string): ReactNode {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let blockKey = 0

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(
      <p key={`p${blockKey++}`} className="whitespace-pre-line">
        {renderInline(paragraph.join('\n'))}
      </p>,
    )
    paragraph = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const next = lines[i + 1]
    if (line.includes('|') && next !== undefined && TABLE_SEPARATOR_ROW.test(next)) {
      flushParagraph()
      const header = splitTableRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      blocks.push(
        <div
          key={`t${blockKey++}`}
          className="my-1 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700"
        >
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                {header.map((cell, ci) => (
                  <th
                    key={ci}
                    className="whitespace-nowrap px-2.5 py-1.5 font-semibold text-slate-700 dark:text-slate-200"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="whitespace-nowrap px-2.5 py-1.5">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    paragraph.push(line)
    i++
  }
  flushParagraph()
  return blocks
}

/**
 * " Assistant " — a plain-language chat grounded in the signed-in user's
 * own real data, shared by every role. Read-only by design: it can look
 * things up, never act — see `AssistantService` on the backend for exactly
 * why and where that line is.
 */
export default function Assistant() {
  const { session } = useStore()
  const userId = session?.id
  const suggestions = isAdmin(session?.role) ? ADMIN_SUGGESTIONS : AGENT_SUGGESTIONS
  const [turns, setTurns] = useState<ChatTurn[]>(() => loadTurns(userId))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [fillHeight, setFillHeight] = useState<number | null>(null)

  /**
   * Measured, not guessed. A fixed `dvh`-based calc here has to know the exact
   * height of everything above this page — the sticky header, and James's
   * optional site-wide notice banner (`SiteNotice` in layout.tsx), which only
   * exists when he's set one and otherwise contributes nothing. A static
   * number is right until the day a notice is live, then it's short by
   * however tall that banner is — confirmed live: with one set, the page
   * still had exactly that much of itself below the fold. Measuring this
   * element's own actual top avoids needing to track that at all; only the
   * bottom clearance below it is a real constant, because it exists purely to
   * clear the fixed mobile nav (`pb-28` on `main` in layout.tsx) and never
   * changes with what's above.
   */
  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const recompute = () => {
      if (window.matchMedia('(min-width: 1024px)').matches) {
        setFillHeight(null) // desktop has a sidebar, not a fixed bottom nav — no scroll-fighting to fix
        return
      }
      const top = el.getBoundingClientRect().top
      setFillHeight(Math.max(320, window.innerHeight - top - 112))
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, busy])

  useEffect(() => {
    const key = storageKey(userId)
    if (!key) return
    try {
      sessionStorage.setItem(key, JSON.stringify(turns))
    } catch {
      // Storage can be blocked (private browsing, quota) — the chat still
      // works for this visit, it just won't survive leaving the page.
    }
  }, [turns, userId])

  const send = async (message: string) => {
    const text = message.trim()
    if (!text || busy) return

    const history = turns
    setTurns([...history, { role: 'user', content: text }])
    setDraft('')
    setBusy(true)

    try {
      // Capped, not the whole session — every turn sent here is billed as
      // input tokens on the free-tier model behind this on every single
      // question, and a chat left open for a long session otherwise resends
      // its entire history, growing without bound. The last few exchanges
      // are enough for the assistant to follow a real back-and-forth.
      const { reply } = await api.askAssistant(text, history.slice(-HISTORY_TURNS_SENT))
      setTurns((current) => [...current, { role: 'assistant', content: reply }])
    } catch {
      // Kept as a normal reply, not a page banner — see CONNECTION_ERROR_REPLY.
      setTurns((current) => [...current, { role: 'assistant', content: CONNECTION_ERROR_REPLY }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={wrapperRef}
      className="flex flex-col lg:block"
      style={fillHeight != null ? { height: fillHeight } : undefined}
    >
      <PageHead title=" Assistant " subtitle="Ask in your own words " />

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden lg:h-[70vh] lg:flex-none">
        <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
          {turns.length === 0 && (
            <div className="py-8 text-center">
              <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300">
                <HelpIcon className="size-5" />
              </span>
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                Try one of these, or type your own question below.
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {suggestions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => void send(question)}
                    className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, index) => {
            const failed = turn.role === 'assistant' && turn.content === CONNECTION_ERROR_REPLY
            return (
              <div key={index} className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    turn.role === 'user'
                      ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-brand-700 px-4 py-2.5 text-sm text-white sm:max-w-[80%]'
                      : failed
                        ? 'flex max-w-[85%] items-start gap-2 rounded-2xl rounded-bl-sm bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200 sm:max-w-[80%]'
                        : 'max-w-[85%] space-y-1.5 rounded-2xl rounded-bl-sm bg-slate-100 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100 sm:max-w-[80%]'
                  }
                >
                  {failed && <AlertIcon className="mt-0.5 size-4 shrink-0" />}
                  {turn.role === 'assistant' ? renderReply(turn.content) : turn.content}
                </div>
              </div>
            )
          })}

          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-slate-100 dark:bg-slate-800 px-4 py-2.5">
                <Spinner className="size-4 text-slate-500 dark:text-slate-400" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <form
          className="flex items-center gap-2 border-t border-slate-100 dark:border-slate-800 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void send(draft)
          }}
        >
          <TextInput
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask a question…"
            disabled={busy}
            aria-label="Your question"
            className="flex-1"
          />
          <Button type="submit" disabled={busy || !draft.trim()} loading={busy}>
            Send
          </Button>
        </form>
      </Card>
    </div>
  )
}
