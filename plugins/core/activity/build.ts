// A day's recap, made from File history's versions (what each file said before and after each stretch of work) and
// Activity's events (who did it, moves and deletes). What it needs comes in `Sources`, so tests give made-up ones.
import { localTime, opcodes } from "../../../core/plugins.ts"
import { archiveTwin, parseText, type Item } from "../../../core/vault.ts"
import type { ActivityEvent } from "./model.ts"
import { type RecapEntry, type RecapKind, taskLine, type TaskLine, taskState, type TaskState, transition, verbOf } from "./recap.ts"

const MINUTE = 60_000
/** A quiet this long between two versions of a file starts another stretch of work on it (another entry). */
export const GAP = 30 * MINUTE
const BATCH = 2 * MINUTE, BATCH_MIN = 4, BATCH_EDITS = 6 // this many alike, each within BATCH of the last, are one entry
const BATCHED: Partial<Record<RecapKind, string>> = { captured: "notes", created: "files", logged: "entries", edited: "files" }
const QUOTE_LINES = 3, QUOTE_CHARS = 160, ITEMS = 12, BIG = 300_000

export type Sources = {
  /** Local midnight to the next (ms). */
  from: number; to: number
  /** Activity's events around the day. */
  events: ActivityEvent[]
  /** Files File history saw written since `from`. */
  changed: string[]
  versions: (rel: string) => Promise<{ gone: boolean; versions: { t: number }[] }>
  text: (rel: string, t: number) => Promise<string | null>
  exists: (rel: string) => boolean
  /** A type's kind: a record of your life (its plugin's category is life or health), a log. */
  kindOf: (type: string | null) => { life: boolean; log: boolean }
  /** Folders whose new files are captures (a transcriber's, a bookmarks plugin's). */
  captureFolders: string[]
  /** The Tasks plugin's own statuses, by symbol. */
  statuses?: Record<string, TaskState>
}

/** A file's properties and body; one whose properties can't be read is all body. */
const split = (text: string): [Item, string] => { try { return parseText(text) } catch { return [{}, text] } }
const followed = (rel: string) => /\.(md|canvas)$/i.test(rel) && !rel.split("/").some((s) => s.startsWith("."))
const CHANGES = new Set(["edit", "create", "delete", "move", "save", "change", "request"])

type Who = { agent: string; session?: string } | null

/** Who made a stretch of changes to a file: an agent when only agents' events touched it then, else you (an edit
 *  from another device arrives as a change on disk). "skip": the app's own writes. */
function whoOf(s: Sources, rel: string, t0: number, t1: number): Who | "skip" {
  const evs = s.events.filter((e) => CHANGES.has(e.action) && (e.paths ?? []).includes(rel) &&
    (e.last ?? e.t) >= t0 - 10 * MINUTE && e.t <= t1 + 2 * MINUTE)
  if (!evs.length) return null
  if (evs.every((e) => e.actor.kind === "script" && e.actor.name === "Vaultite")) return "skip"
  const agents = evs.filter((e) => e.actor.kind === "agent")
  // (the watcher may hear an agent's write after its hook said so: that change on disk is the agent's)
  const mine = evs.filter((e) => e.actor.kind !== "agent" && !(e.actor.kind === "disk" && agents.some((a) => Math.abs(a.t - e.t) < 15_000)))
  if (mine.length) return null
  const a = agents[agents.length - 1].actor
  return { agent: a.name, ...(a.session || a.terminal ? { session: a.session ?? a.terminal } : {}) }
}

const link = (rel: string) => {
  const p = rel.replace(/\.md$/i, ""), name = p.split("/").pop()!
  return p.includes("/") ? `[[${p}|${name}]]` : `[[${p}]]`
}
const plainName = (rel: string) => rel.split("/").pop()!.replace(/\.md$/i, "")
const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|heic)$/i

/** A line of a note as a quote's line: links and images kept, other embeds as links, tags not tags here, block
 *  markup left out. Empty: nothing worth quoting. */
export function quoteLine(line: string): string {
  let l = line.replace(/^\s*(>\s?)+/, "").replace(/^\s*>?\s*\[![\w-]+\][+-]?.*$/, "").trim()
  if (!l || /^(```|~~~|---+$|\|?\s*:?-{3,})/.test(l) || /^[\w ]+::/.test(l) || /^%%/.test(l)) return ""
  l = l.replace(/^#{1,6}\s+(.*)$/, "**$1**").replace(/^(?:[-*+]|\d+[.)])\s+/, "")
  l = l.replace(/!\[\[([^\]|#]+)([^\]]*)\]\]/g, (m, target: string, rest: string) => (IMAGE.test(target) ? m : `[[${target}${rest}]]`))
  l = l.replace(/(^|\s)#(?=[\p{L}\p{N}_/-])/gu, "$1\\#").replace(/\s+\^[\w-]+$/, "")
  return l.length > QUOTE_CHARS ? `${l.slice(0, QUOTE_CHARS - 1).trimEnd()}…` : l
}

function quoteOf(lines: string[], skipHeadings = false) {
  const out: string[] = []
  for (const line of lines) {
    if (skipHeadings && /^\s*#{1,6}\s/.test(line)) continue
    const q = quoteLine(line)
    if (q) out.push(q)
    if (out.length >= QUOTE_LINES) break
  }
  return out
}

/** Where a note came from, when it's a capture: a sync plugin's id key (`raindrop_id`: Raindrop), a capture folder;
 *  a new one also by the web address it was saved from (the clipper's, or its site). A record (a log, a person) isn't. */
function captureOf(s: Sources, rel: string, fm: Item, evs: ActivityEvent[] | null): string | null {
  if (fm.type !== undefined && fm.type !== null && fm.type !== "note") return null
  const idKey = Object.keys(fm).find((k) => /^[a-z]+_id$/i.test(k) && k !== "ext_id" && fm[k] !== null && fm[k] !== "")
  if (idKey) { const n = idKey.slice(0, -3); return n[0].toUpperCase() + n.slice(1) }
  const folder = s.captureFolders.find((f) => f && (rel === f || rel.startsWith(`${f.replace(/\/+$/, "")}/`)))
  if (folder) return folder.replace(/\/+$/, "").split("/").pop()!
  const url = ["source", "link", "url"].map((k) => fm[k]).find((v) => typeof v === "string" && /^https?:\/\//.test(v)) as string | undefined
  if (!url || !evs) return null
  if (evs.some((e) => /^(clip|ops\/clipper\.)/.test(e.route ?? "") || /^Clipped /.test(e.text))) return "Web clipper"
  try { return new URL(url).hostname.replace(/^www\./, "") } catch { return "the web" }
}

type Task = TaskLine & { state: TaskState; sub: string[]; under: number[] }
/** One stretch of work on one file, read. */
type Stretch = { rel: string; t0: number; t1: number; who: Who; created: boolean; fm: Item; added: string[]; removed: string[]
  hunks: number; tasksIn: Task[]; tasksOut: Task[]; moves: { task: Task; kind: RecapKind }[]; audio: boolean
  /** Tasks that came from another file, by key: that file. */
  from: Map<string, string> }

/** The lines under a task that belong to it (more indented, not tasks themselves): a reason, a note. */
function subLines(lines: string[], i: number, indent: number) {
  const at: number[] = []
  for (let j = i + 1; j < lines.length && at.length < 4; j++) {
    const l = lines[j]
    if (!l.trim()) break
    const ind = (/^\s*/.exec(l)![0]).replace(/\t/g, "    ").length
    if (ind <= indent || taskLine(l)) break
    at.push(j)
  }
  return at
}

/** Which lines are inside a fence (code, a query, a block): not text to quote. */
function fenced(lines: string[]) {
  const inside = new Set<number>()
  let open: string | null = null
  lines.forEach((l, i) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(l)
    if (open !== null) { inside.add(i); if (m && m[1][0] === open[0] && m[1].length >= open.length) open = null }
    else if (m) { open = m[1]; inside.add(i) }
  })
  return inside
}

async function stretchesOf(s: Sources, rel: string): Promise<Stretch[]> {
  const { versions } = await s.versions(rel)
  const inDay = versions.filter((v) => v.t >= s.from && v.t < s.to)
  if (!inDay.length) return []
  let prev = versions.filter((v) => v.t < s.from).pop() ?? null
  const runs: { t: number }[][] = []
  for (const v of inDay) {
    const run = runs[runs.length - 1]
    if (run && v.t - run[run.length - 1].t < GAP) run.push(v); else runs.push([v])
  }
  const out: Stretch[] = []
  for (const run of runs) {
    const t0 = run[0].t, t1 = run[run.length - 1].t
    const before = prev ? await s.text(rel, prev.t) : null
    const after = await s.text(rel, t1)
    prev = run[run.length - 1]
    if (after === null) continue
    const [fm, body] = split(after)
    let who = whoOf(s, rel, t0, t1)
    if (who === "skip") continue
    // A file that says an agent made it (an inbox report's `agent:`) is that agent's, wherever it was written.
    if (!who && before === null && typeof fm.agent === "string" && fm.agent) who = { agent: typeof fm.from === "string" && fm.from ? fm.from : fm.agent }
    const [, was] = before === null ? [{}, ""] : split(before)
    if (before !== null && was === body) continue // only its properties changed (a date the app keeps)
    const a = before === null ? [] : was.split("\n"), b = body.split("\n")
    const st: Stretch = { rel, t0, t1, who, created: before === null, fm, added: [], removed: [], hunks: 0, tasksIn: [], tasksOut: [], moves: [], audio: false, from: new Map() }
    const readTask = (lines: string[], i: number): Task | null => {
      const t = taskLine(lines[i])
      if (!t) return null
      const under = subLines(lines, i, t.indent)
      return { ...t, state: taskState(t.symbol, s.statuses), under, sub: under.slice(0, 2).map((j) => lines[j].trim().replace(/^[-*+]\s+/, "")) }
    }
    const code = fenced(b)
    const addedAt: number[] = []
    // (a big file's lines aren't compared: told as edited, nothing quoted)
    const ops = was.length + body.length > BIG ? [["replace", 0, 0, 0, 0] as const] : opcodes(a, b)
    for (const [tag, i1, i2, j1, j2] of ops) {
      if (tag === "equal") continue
      st.hunks++
      for (let i = i1; i < i2; i++) { const t = readTask(a, i); if (t) st.tasksOut.push(t); else st.removed.push(a[i]) }
      for (let j = j1; j < j2; j++) { const t = readTask(b, j); if (t) st.tasksIn.push(t); else if (!code.has(j)) addedAt.push(j) }
    }
    st.audio = st.added.some((l) => /!\[\[[^\]]+\.(m4a|webm|mp3|wav|ogg|aac)\]\]/i.test(l))
    // A task in both is the same task, its state changed (or only its fields: nothing to tell).
    for (const t of [...st.tasksIn]) {
      const i = st.tasksOut.findIndex((o) => o.key === t.key)
      if (i < 0) continue
      const kind = transition(st.tasksOut[i].state, t.state)
      if (kind) st.moves.push({ task: t, kind })
      st.tasksOut.splice(i, 1)
      st.tasksIn.splice(st.tasksIn.indexOf(t), 1)
    }
    // What's added is text, but for a task's own lines under it (its reason) once its state is told.
    const told = new Set(st.moves.flatMap((m) => m.task.under))
    for (const t of st.tasksIn) if (t.state === "done" || t.state === "cancelled") for (const j of t.under) told.add(j)
    st.added = addedAt.filter((j) => !told.has(j)).map((j) => b[j])
    // A recurring task done puts a new one to do next to it.
    st.tasksIn = st.tasksIn.filter((t) => !(t.state === "todo" && st.moves.some((m) => m.kind === "done" && m.task.key === t.key)))
    out.push(st)
  }
  return out
}

/** The day's entries, oldest first. */
export async function buildRecap(s: Sources): Promise<RecapEntry[]> {
  const inDay = (t: number) => t >= s.from && t < s.to
  const paths = new Set(s.changed.filter(followed))
  for (const e of s.events) if (CHANGES.has(e.action) && inDay(e.t)) for (const p of e.paths ?? []) if (followed(p)) paths.add(p)
  const stretches: Stretch[] = []
  for (const rel of [...paths].sort()) {
    // (not recaps themselves, nor a plugin's pages the app puts in)
    for (const st of await stretchesOf(s, rel)) if (st.fm.type !== "recap" && !(st.fm.type === "dashboard" && st.fm.plugin)) stretches.push(st)
  }
  type Extra = { source?: string; rel?: string; agent?: { name: string; session?: string; rel: string } }
  const made: ({ t: number; e: RecapEntry } & Extra)[] = []
  const add = (t: number, kind: RecapKind, text: string, quote: string[] = [], extra: Extra = {}) =>
    made.push({ t, e: { time: localTime(t), kind, text, quote, items: [] }, ...extra })
  // Files made this day: one also deleted this day was a scratch (nothing to tell), one renamed was made under its name.
  const madeToday = new Set(stretches.filter((st) => st.created).map((st) => st.rel))
  const scratch = new Set<string>()

  // Tasks that left one file and arrived in another (Open.md to Closed.md) are moved, not deleted and added.
  const out = stretches.flatMap((st) => st.tasksOut.map((task) => ({ st, task })))
  for (const st of stretches) {
    for (const task of [...st.tasksIn]) {
      const i = out.findIndex((o) => o.task.key === task.key && o.st.rel !== st.rel && Math.abs(o.st.t1 - st.t1) < GAP)
      if (i >= 0) {
        const kind = transition(out[i].task.state, task.state)
        if (kind) st.moves.push({ task: { ...task, sub: task.sub.length ? task.sub : out[i].task.sub }, kind })
        st.from.set(task.key, out[i].st.rel)
        out[i].st.tasksOut.splice(out[i].st.tasksOut.indexOf(out[i].task), 1)
        out.splice(i, 1)
        st.tasksIn.splice(st.tasksIn.indexOf(task), 1)
      } else if ((task.state === "done" || task.state === "cancelled") && !st.created) { // (a new file's are its text)
        st.moves.push({ task, kind: task.state })
        st.tasksIn.splice(st.tasksIn.indexOf(task), 1)
      }
    }
  }

  for (const st of stretches) {
    const k = s.kindOf(typeof st.fm.type === "string" ? st.fm.type : null)
    const by = st.who && k.life ? ` · by ${st.who.agent}` : ""
    const agent = st.who && !k.life ? { name: st.who.agent, session: st.who.session, rel: st.rel } : undefined
    for (const m of st.moves) {
      if (agent) continue
      const where = st.from.has(m.task.key) ? `${link(st.from.get(m.task.key)!)} → ${link(st.rel)}` : link(st.rel)
      add(st.t1, m.kind, `${verbOf(m.kind)} "${m.task.title.replace(/"/g, "'")}" · ${where}${by}`, quoteOf(m.task.sub))
    }
    // What's left is the text: the lines added (new tasks to do are text too), or what was removed.
    const added = [...st.added, ...st.tasksIn.map((t) => `- [${t.symbol}] ${t.title}`)]
    const left = added.some((l) => l.trim()) || st.removed.some((l) => l.trim()) || st.tasksOut.length > 0
    if (agent) { if (left || st.created || st.moves.length) add(st.t0, "agent", "", [], { agent }); continue }
    if (st.created) {
      const evs = s.events.filter((e) => (e.paths ?? []).includes(st.rel) && Math.abs(e.t - st.t0) < 10 * MINUTE)
      const source = captureOf(s, st.rel, st.fm, evs) ?? (st.audio ? "Recording" : null)
      const quote = quoteOf(added, true)
      if (source) add(st.t0, "captured", `Captured ${link(st.rel)} · ${source}${by}`, quote, { source, rel: st.rel })
      else if (k.log) add(st.t0, "logged", `Logged ${link(st.rel)}${by}`, quote, { rel: st.rel })
      else add(st.t0, "created", `Created ${link(st.rel)}${typeof st.fm.type === "string" && st.fm.type !== "note" ? ` · ${st.fm.type}` : ""}${by}`, quote, { rel: st.rel })
      continue
    }
    if (!left) continue
    let quote = quoteOf(added)
    if (!quote.length) { const r = quoteOf(st.removed); quote = r.length ? [`Removed: ${r[0]}`] : [] }
    const source = captureOf(s, st.rel, st.fm, null) ?? undefined
    const n = st.hunks
    if (st.audio) add(st.t0, "captured", `Captured ${link(st.rel)} · Recording${by}`, quote, { source: "Recording" })
    else add(st.t0, "edited", `Edited ${link(st.rel)} · ${n} change${n === 1 ? "" : "s"}${by}`, quote, { source })
  }

  // Moves and deletes, from the events (File history keeps a moved file's versions under its new name).
  for (const e of s.events) {
    if (!inDay(e.t) || (e.action !== "move" && e.action !== "delete" && e.action !== "change")) continue
    const agentName = e.actor.kind === "agent" ? e.actor.name : null
    if (e.actor.kind === "script" && e.actor.name === "Vaultite") continue
    if (e.action === "move") {
      const [a, b] = e.paths ?? []
      if (!a || !b || !followed(b)) continue
      if (agentName) add(e.t, "agent", "", [], { agent: { name: agentName, session: e.actor.session ?? e.actor.terminal, rel: b } })
      else if (!madeToday.has(b)) add(e.t, "moved", `Moved ${link(b)} · from ${a.replace(/\.md$/i, "")}`)
      continue
    }
    for (const p of e.paths ?? []) {
      if (!followed(p) || s.exists(p)) continue
      if (e.action === "change" && !(await s.versions(p)).gone) continue // moved away on disk, or never followed
      if (made.some((m) => m.e.kind === "deleted" && m.e.text === `Deleted ${plainName(p)}`)) continue
      if (s.exists(archiveTwin(p))) continue // archived (an inbox item done), not deleted
      if (madeToday.has(p)) { scratch.add(p); continue }
      if (agentName) add(e.t, "agent", "", [], { agent: { name: agentName, session: e.actor.session ?? e.actor.terminal, rel: p } })
      else add(e.t, "deleted", `Deleted ${plainName(p)}`)
    }
  }

  for (let i = made.length - 1; i >= 0; i--) {
    const r = made[i].rel ?? made[i].agent?.rel
    if (r && scratch.has(r)) made.splice(i, 1)
  }
  made.sort((a, b) => a.t - b.t)
  // An agent's changes are one entry per session: its files, listed.
  const sessions = new Map<string, { t: number; e: RecapEntry; files: string[] }>()
  const rest: typeof made = []
  for (const m of made) {
    if (!m.agent) { rest.push(m); continue }
    const key = `${m.agent.name}\0${m.agent.session ?? ""}`
    let g = sessions.get(key)
    if (!g) { g = { t: m.t, e: { time: localTime(m.t), kind: "agent", text: "", quote: [], items: [] }, files: [] }; sessions.set(key, g); rest.push({ t: m.t, e: g.e, agent: m.agent }) }
    if (!g.files.includes(m.agent.rel)) g.files.push(m.agent.rel)
  }
  for (const m of rest) {
    if (!m.agent) continue
    const g = sessions.get(`${m.agent.name}\0${m.agent.session ?? ""}`)!
    m.e.text = `${m.agent.name} changed ${g.files.length} file${g.files.length === 1 ? "" : "s"}${m.agent.session ? ` · ${m.agent.session}` : ""}`
    m.e.items = listed(g.files)
  }
  return batched(rest).map((m) => m.e)
}

function listed(files: string[]) {
  const shown = files.slice(0, ITEMS).map((f) => (followed(f) ? link(f) : f))
  return files.length > ITEMS ? [...shown, `and ${files.length - ITEMS} more`] : shown
}

/** Many alike close together are one entry listing them: captures from one source (a bookmarks sync), or more files
 *  made, logged or edited than someone types in a minute or two (an import, a find and replace, a sync). */
function batched<T extends { t: number; e: RecapEntry; source?: string }>(list: T[]): T[] {
  const runs = new Map<string, T[][]>()
  for (const m of list) {
    if (!BATCHED[m.e.kind]) continue
    const by = / · by (.+)$/.exec(m.e.text)?.[1] ?? ""
    const key = `${m.e.kind}\0${m.source ?? ""}\0${by}`
    const rs = runs.get(key) ?? []
    const run = rs[rs.length - 1]
    if (run && m.t - run[run.length - 1].t < BATCH) run.push(m); else rs.push([m])
    runs.set(key, rs)
  }
  const into = new Map<T, T | null>()
  for (const run of [...runs.values()].flat()) {
    const m = run[0]
    if (run.length < (m.source ? BATCH_MIN : BATCH_EDITS)) continue
    const links = run.map((x) => /\[\[[^\]]+\]\]/.exec(x.e.text)?.[0]).filter((x): x is string => !!x)
    const by = / · by (.+)$/.exec(m.e.text)?.[1]
    const text = `${verbOf(m.e.kind)} ${run.length} ${BATCHED[m.e.kind]}${m.source ? ` · ${m.source}` : ""}${by ? ` · by ${by}` : ""}`
    into.set(m, { ...m, e: { ...m.e, text, quote: [], items: links.length > ITEMS ? [...links.slice(0, ITEMS), `and ${links.length - ITEMS} more`] : links } })
    for (const x of run.slice(1)) into.set(x, null)
  }
  return list.flatMap((m) => { const x = into.get(m); return x === undefined ? [m] : x ? [x] : [] })
}
