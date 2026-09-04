import { useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../state/store'
import { isAdmin } from '../lib/roles'
import { adminGuide, agentGuide, type GuideGroup, type GuideTask } from '../data/helpGuide'
import { Badge, Callout, Card, EmptyState, PageHead, TextInput } from '../components/ui'
import { AlertIcon, HelpIcon, SearchIcon } from '../components/icons'

/**
 * "What can I do here" — one page, two guides.
 *
 * Staff only (admin, superadmin, agent) — see the `RequireAuth roles={[...]}`
 * gate in App.tsx. Customers never see this: a guest's whole relationship to
 * the platform is a four-step checkout, not a dashboard with a nav full of
 * pages to learn — there is nothing here for that role to act on. Which of
 * the two guides shows is decided purely from the signed-in session's role,
 * not a picker: an agent looking this up wants their own answer, not a menu
 * to choose the right one from first.
 */
export default function Info() {
  const { session } = useStore()
  const [query, setQuery] = useState('')

  // Guaranteed by the route guard — RequireAuth redirects anyone else away
  // before this ever renders. Still checked so the type is a real Session,
  // not (Session | null), for everything below.
  if (!session) return null

  const audience: 'admin' | 'agent' = isAdmin(session.role) ? 'admin' : 'agent'
  const groups = audience === 'admin' ? adminGuide : agentGuide
  const label = audience === 'admin' ? 'Running the platform' : 'Selling as an agent'

  const needle = query.trim().toLowerCase()
  const filtered = useMemo(() => filterGuide(groups, needle), [groups, needle])
  const taskCount = groups.reduce((sum, g) => sum + g.tasks.length, 0)
  const matchCount = filtered.reduce((sum, g) => sum + g.tasks.length, 0)

  return (
    <div className="mx-auto max-w-2xl">
      <PageHead
        title="What can I do here?"
        subtitle={`${taskCount} things you can do, explained step by step.`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="accent">
          <HelpIcon className="size-3.5" /> {label}
        </Badge>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Shown for your account — signed in as {session.name}.
        </span>
      </div>

      <div className="relative mb-6">
        <SearchIcon className="absolute inset-y-0 left-3.5 my-auto size-4 text-slate-500 dark:text-slate-400" />
        <TextInput
          placeholder="Search — try “withdraw”, “refund”, or “domain”"
          className="pl-10 text-base"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search the guide"
        />
      </div>

      {needle && (
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          {matchCount === 0
            ? `Nothing matches “${query.trim()}.”`
            : `${matchCount} of ${taskCount} match “${query.trim()}.”`}
        </p>
      )}

      {matchCount === 0 && needle ? (
        <EmptyState
          icon={<SearchIcon className="size-6" />}
          title="No matches"
          detail="Try a different word — search looks at each task's title and its steps."
        />
      ) : (
        <div className="space-y-7">
          {filtered.map((group) => (
            <section key={group.label}>
              <h2 className="mb-2.5 text-xs font-bold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
                {group.label}
              </h2>
              <Card className="divide-y divide-slate-100 dark:divide-slate-800">
                {group.tasks.map((task) => (
                  <TaskItem key={task.id} task={task} forceOpen={Boolean(needle)} />
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function TaskItem({ task, forceOpen }: { task: GuideTask; forceOpen: boolean }) {
  return (
    <details className="group open:bg-slate-50/60 dark:open:bg-slate-800/40" open={forceOpen || undefined}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <span className="font-semibold text-slate-900 dark:text-slate-50">I want to {lowerFirst(task.title)}</span>
        <span className="shrink-0 text-slate-400 transition-transform group-open:rotate-180 dark:text-slate-500">
          <ChevronDown />
        </span>
      </summary>
      <div className="space-y-4 px-4 pb-5 sm:px-5">
        {task.why && <p className="text-sm text-slate-500 dark:text-slate-400">{renderInline(task.why)}</p>}
        <ol className="space-y-3">
          {task.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white dark:bg-brand-500">
                {i + 1}
              </span>
              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{renderInline(step)}</p>
            </li>
          ))}
        </ol>
        {task.notes?.map((note, i) => (
          <Callout key={i} tone={note.tone} title={note.title} icon={<AlertIcon className="size-4" />}>
            {renderInline(note.body)}
          </Callout>
        ))}
      </div>
    </details>
  )
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/** Strips the `**bold**` / `` `code` `` markers so search matches the words a person would actually type. */
function plainText(text: string): string {
  return text.replace(/\*\*/g, '').replace(/`/g, '')
}

/** Renders the tiny `**bold**` / `` `code` `` subset used in helpGuide.ts. */
function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    } else {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[0.85em] text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
        >
          {token.slice(1, -1)}
        </code>,
      )
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

/** Only a group with at least one matching task survives — an empty group heading answers nothing. */
function filterGuide(groups: GuideGroup[], needle: string): GuideGroup[] {
  if (!needle) return groups
  return groups
    .map((group) => ({
      ...group,
      tasks: group.tasks.filter((task) => {
        const haystack = [task.title, task.why, ...task.steps, ...(task.notes?.map((n) => `${n.title} ${n.body}`) ?? [])]
          .filter(Boolean)
          .map((s) => plainText(String(s)).toLowerCase())
          .join(' ')
        return haystack.includes(needle)
      }),
    }))
    .filter((group) => group.tasks.length > 0)
}
