import { useSyncExternalStore } from 'react'

/** How long a money action waits before it is sent, so a mis-tap can be taken back. */
export const UNDO_MS = 8_000

interface Pending {
  id: number
  label: string
  endsAt: number
  settle: (go: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

let pending: Pending[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function finish(id: number, go: boolean) {
  const item = pending.find((p) => p.id === id)
  if (!item) return
  clearTimeout(item.timer)
  pending = pending.filter((p) => p.id !== id)
  emit()
  item.settle(go)
}

/**
 * Wait `UNDO_MS` before a money action goes out, with an Undo button on
 * screen meanwhile. Resolves true to go ahead, false if undone.
 *
 * Nothing is sent until it resolves, so closing the tab in the meantime
 * cancels the action, the safe direction for money.
 */
export function withUndo(label: string): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextId++
    const timer = setTimeout(() => finish(id, true), UNDO_MS)
    pending = [...pending, { id, label, endsAt: Date.now() + UNDO_MS, settle: resolve, timer }]
    emit()
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The bar that shows what is about to go out, with Undo and Send now. */
export function UndoBar() {
  const items = useSyncExternalStore(subscribe, () => pending)
  if (items.length === 0) return null
  return (
    <div className="fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5.5rem)' }}>
      {items.map((item) => (
        <div
          key={item.id}
          role="status"
          className="flex w-full max-w-md items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
        >
          <span className="min-w-0 flex-1">{item.label}…</span>
          <button
            type="button"
            onClick={() => finish(item.id, false)}
            className="shrink-0 rounded-lg bg-white/15 px-3 py-1.5 font-semibold hover:bg-white/25 dark:bg-slate-900/10 dark:hover:bg-slate-900/20"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => finish(item.id, true)}
            className="shrink-0 text-xs font-semibold underline underline-offset-2 opacity-80"
          >
            Send now
          </button>
        </div>
      ))}
    </div>
  )
}
