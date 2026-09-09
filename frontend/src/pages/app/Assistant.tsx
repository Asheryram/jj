import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { useStore } from '../../state/store'
import { isAdmin } from '../../lib/roles'
import type { ChatTurn } from '../../data/types'
import { Button, Callout, Card, PageHead, Spinner, TextInput } from '../../components/ui'
import { AlertIcon, HelpIcon } from '../../components/icons'

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
 * "Ask for help" — a plain-language chat grounded in the signed-in user's
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
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

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
    setError('')

    try {
      const { reply } = await api.askAssistant(text, history)
      setTurns((current) => [...current, { role: 'assistant', content: reply }])
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reach the assistant.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHead title="Ask for help" subtitle="Ask in your own words " />

      <Card className="flex h-[70vh] flex-col overflow-hidden">
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

          {turns.map((turn, index) => (
            <div key={index} className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <p
                className={
                  turn.role === 'user'
                    ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-brand-700 px-4 py-2.5 text-sm text-white'
                    : 'max-w-[80%] whitespace-pre-line rounded-2xl rounded-bl-sm bg-slate-100 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100'
                }
              >
                {turn.content}
              </p>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-slate-100 dark:bg-slate-800 px-4 py-2.5">
                <Spinner className="size-4 text-slate-500 dark:text-slate-400" />
              </div>
            </div>
          )}

          {error && (
            <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
              {error}
            </Callout>
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
