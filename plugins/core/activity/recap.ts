// A day's recap (`type: recap`, Recaps/<date>.md): what you did that day, one line per thing, as plain Markdown that
// reads anywhere. Written by plugin.ts (build.ts makes the entries), read back by the app; no imports, so both sides can.

/** What an entry is about: a file made, changed, moved or deleted; something captured (a clip, a bookmark, a
 *  recording); a log or another record of your life; a task's state; an agent's session of changes. */
export type RecapKind = "created" | "edited" | "moved" | "deleted" | "captured" | "logged" | "done" | "cancelled" | "started"
  | "reopened" | "agent" | "other"

export type RecapEntry = {
  /** HH:MM, local. */
  time: string
  kind: RecapKind
  /** The line after the time, as Markdown: `Edited [[Notes/Idea]] · 3 changes`. */
  text: string
  /** Quoted under it: the text changed, a task's sub-lines, a capture's first lines. */
  quote: string[]
  /** Listed under it: the files of a session or a batch. */
  items: string[]
}

/** The filter groups a recap's entries fall in (the chips), in order. */
export const RECAP_GROUPS = [
  { id: "notes", label: "Notes", kinds: ["created", "edited", "moved", "deleted"] },
  { id: "tasks", label: "Tasks", kinds: ["done", "cancelled", "started", "reopened"] },
  { id: "captures", label: "Captures", kinds: ["captured"] },
  { id: "logs", label: "Logs", kinds: ["logged"] },
  { id: "agents", label: "Agents", kinds: ["agent"] },
] as const satisfies readonly { id: string; label: string; kinds: readonly RecapKind[] }[]
export type RecapGroup = typeof RECAP_GROUPS[number]["id"]
export const groupOf = (k: RecapKind): RecapGroup | null => RECAP_GROUPS.find((g) => (g.kinds as readonly string[]).includes(k))?.id ?? null

/** Each kind's first word in the line ("Completed" a task); an agent's line is its name, then "changed". */
const VERBS: [RecapKind, string][] = [["created", "Created"], ["edited", "Edited"], ["moved", "Moved"], ["deleted", "Deleted"],
  ["captured", "Captured"], ["logged", "Logged"], ["done", "Completed"], ["cancelled", "Cancelled"], ["started", "Started"],
  ["reopened", "Reopened"]]
export const verbOf = (k: RecapKind) => VERBS.find(([x]) => x === k)?.[1] ?? ""
const kindOfLine = (text: string): RecapKind => {
  const w = text.split(" ")[0]
  return VERBS.find(([, v]) => v === w)?.[0] ?? (/^.+ changed \d+ files?\b/.test(text) ? "agent" : "other")
}

const ENTRY = /^- (\d{1,2}:\d\d) (.+)$/
const QUOTE = /^ {2,}> ?(.*)$/
const ITEM = /^ {2,}- (.*)$/

/** A recap's body: your own lines (kept as they are) and the entries, in the file's order. Lenient: an entry is a
 *  `- HH:MM ...` line, its quote and items the indented lines under it. */
export function parseRecap(body: string): { entries: RecapEntry[]; before: string; after: string } {
  const lines = body.split("\n")
  const entries: RecapEntry[] = []
  let first = -1, last = -1
  for (let i = 0; i < lines.length; i++) {
    const m = ENTRY.exec(lines[i])
    if (!m) continue
    if (first < 0) first = i
    const e: RecapEntry = { time: m[1].padStart(5, "0"), kind: kindOfLine(m[2]), text: m[2], quote: [], items: [] }
    while (i + 1 < lines.length) {
      const q = QUOTE.exec(lines[i + 1]), it = q ? null : ITEM.exec(lines[i + 1])
      if (q) e.quote.push(q[1])
      else if (it) e.items.push(it[1])
      else break
      i++
    }
    entries.push(e)
    last = i
  }
  if (first < 0) return { entries, before: body.replace(/\s+$/, ""), after: "" }
  return { entries, before: lines.slice(0, first).join("\n").replace(/\s+$/, ""), after: lines.slice(last + 1).join("\n").trim() }
}

export function entryLines(e: RecapEntry) {
  return [`- ${e.time} ${e.text}`, ...e.quote.map((q) => `  > ${q}`.trimEnd()), ...e.items.map((x) => `  - ${x}`)]
}

/** A recap's body with these entries in place of the ones it had; your own lines before and after stay. */
export function renderRecap(entries: RecapEntry[], keep: { before: string; after: string } = { before: "", after: "" }) {
  const list = entries.flatMap(entryLines).join("\n")
  return [keep.before, list, keep.after].filter(Boolean).join("\n\n") + "\n"
}

// ---------- task lines (Markdown checkboxes, and the Tasks plugin's fields)

export type TaskState = "todo" | "doing" | "done" | "cancelled"
/** A checkbox's symbol, as the Tasks plugin's default statuses read it; others are to do. */
const SYMBOLS: Record<string, TaskState> = { " ": "todo", x: "done", X: "done", "-": "cancelled", "/": "doing" }

export type TaskLine = { indent: number; symbol: string; text: string; key: string; title: string }
const TASK = /^(\s*)(?:[-*+]|\d+[.)]) \[(.)\] (.*)$/
// The Tasks plugin's fields (dates, recurrence, priority, ids) and Dataview's [key:: value], and a block id.
const FIELDS = /\s*(?:[✅❌➕📅🗓⏳⌛🛫🔁🏁🆔⛔][️]?\s*[^✅❌➕📅🗓⏳⌛🛫🔁🏁🆔⛔🔺⏫🔼🔽⏬]*|[🔺⏫🔼🔽⏬][️]?|\[[\w-]+::[^\]]*\]|\([\w-]+::[^)]*\))/gu
const BLOCK_ID = /\s+\^[\w-]+$/

/** A line that's a task: its checkbox's symbol, and its text without fields (what it is, whatever its dates). */
export function taskLine(line: string): TaskLine | null {
  const m = TASK.exec(line)
  if (!m) return null
  const title = m[3].replace(BLOCK_ID, "").replace(FIELDS, "").replace(/\s+/g, " ").trim()
  if (!title) return null
  return { indent: m[1].replace(/\t/g, "    ").length, symbol: m[2], text: m[3], key: title.toLowerCase(), title }
}

export function taskState(symbol: string, custom?: Record<string, TaskState>): TaskState {
  return custom?.[symbol] ?? SYMBOLS[symbol] ?? "todo"
}

/** What a task going from one state to another (null: not there) is, or null when it's nothing to tell. */
export function transition(from: TaskState | null, to: TaskState | null): RecapKind | null {
  if (to === from || to === null) return null
  if (to === "done") return "done"
  if (to === "cancelled") return "cancelled"
  if (to === "doing") return from === null ? null : "started"
  return from === "done" || from === "cancelled" ? "reopened" : null
}
