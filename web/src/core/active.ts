// The file being edited in the focused pane, for commands that write into it (Insert template); null when the focused
// tab isn't an editable Markdown file.
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

let active: ActiveFile | null = null
export const setActiveFile = (f: ActiveFile | null) => { active = f }
/** Clear it only if it's still this one (a newer pane may have taken over). */
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
  // (no blank line before it at the start of a line, nor after it at a line's end; the file still ends with a line break)
  const before = at === 0 || now[at - 1] === "\n" ? 1 : 0
  const after = now[at + marked.length] === "\n" ? 1 : 0
  if (before || after) f.setText(now.slice(0, at) + marked.slice(before, marked.length - after) + now.slice(at + marked.length))
  return true
}
