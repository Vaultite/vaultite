import { closestOf } from "@/core/dom"
import { cell } from "@/core/signal"

export type ActiveFile = {
  path: string
  /** The whole file as it is in the editor now (frontmatter and body). */
  text: () => string
  /** Replace the whole file (the editor keeps the cursor; it saves like typing). */
  setText: (text: string) => void
  /** Type text at the cursor, replacing the selection (at the end of the body when nothing is being edited). */
  insert: (text: string) => void
  /** Save what's typed now, and wait for it. */
  settle: () => Promise<void>
}

export const dockedKeys = cell<string | null>(null)
if (typeof window !== "undefined") {
  for (const ev of ["focusin", "pointerdown"]) addEventListener(ev, (e) => { if (closestOf(e.target, "[data-pane]")) dockedKeys.set(null) }, true)
}

let active: ActiveFile | null = null
export const setActiveFile = (f: ActiveFile | null) => { active = f }
export const dropActiveFile = (f: ActiveFile) => { if (active === f) active = null }
export const activeFile = () => active

/** Text typed at the cursor of the file being edited (at its end when nothing is), on lines of its own. */
export function insertOnOwnLine(text: string, f = active) {
  if (!f) return false
  const marked = `\n${text}\n`
  f.insert(marked)
  const now = f.text()
  const at = now.indexOf(marked)
  if (at < 0) return true
  const before = at === 0 || now[at - 1] === "\n" ? 1 : 0
  const after = now[at + marked.length] === "\n" ? 1 : 0
  if (before || after) f.setText(now.slice(0, at) + marked.slice(before, marked.length - after) + now.slice(at + marked.length))
  return true
}
