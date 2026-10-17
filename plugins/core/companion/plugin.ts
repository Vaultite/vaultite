// Companion: one always-on agent session that watches the user write and answers in the app (its cursor, bubbles,
// margin comments, suggestions, edits typed in). Comments and suggestions are kept in a sidecar per note; the rest is live.
import fs from "node:fs"
import path from "node:path"
import { type RawData, WebSocket } from "ws"
import { agentName, newTerminalId, startAgent } from "../../../core/agents.ts"
import { localDate, type OpCtx, OpError, Plugin } from "../../../core/plugins.ts"
import { readText, type Vault, writeAtomic } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

export type Mode = "off" | "quiet" | "notice" | "pair"
/** Lines changed together: from `line` (1-based, in the file's text, frontmatter too), `removed` replaced by `added`. */
export type Hunk = { line: number; added: string[]; removed: string[] }
/** What the user did, as an agent sees it. ask: they addressed it (@claude in a note, Ask companion); edit and open only in
 *  notice and pair; reply, accept, reject, dismiss: their answer to one of its items. */
export type Moment = { seq: number; t: number; kind: "ask" | "edit" | "open" | "reply" | "accept" | "reject" | "dismiss"
  path?: string; line?: number; text?: string; selection?: string; hunks?: Hunk[]; item?: string; to?: string }
/** Where something points: a file and a line (1-based), or text found in it (the occurrence nearest `line`). */
export type Target = { path?: string; line?: number; find?: string }
/** reading: it was handed what the user did; thinking: something to answer; seen: it let that pass, until its next change. */
export type Agent = Target & { name: string; tint: string; state: "watching" | "reading" | "thinking" | "writing" | "away"; t: number; seen?: boolean }
/** What an agent leaves in the app: words by its cursor (say, gone after a while), a margin comment, a suggested change,
 *  a highlight (gone after a while). `anchor`: a comment's line as it read, to find it again without `find`. */
export type Note = Target & { id: string; kind: "say" | "comment" | "suggestion" | "highlight"; agent: string; t: number
  text?: string; replace?: string; anchor?: string; replies?: { by: "user" | "agent"; text: string }[] }
/** What an agent did when (logged, for timings): called next, was handed moments (seqs), or acted (say, edit...). */
export type Act = { t: number; as: string; op: string; seqs?: number[] }
/** A note's lines from..to (1-based, of `of`), sent with the moments in it. */
export type Excerpt = { path: string; from: number; to: number; of: number; lines: string[] }

const TINTS = ["orange", "blue", "purple", "green", "red", "yellow"]
export const EMOJI: Record<string, string> = { red: "🔴", orange: "🟠", yellow: "🟡", green: "🟢", blue: "🔵", purple: "🟣" }
const KEEP = 300, SAY_MS = 12_000, HIGHLIGHT_MS = 10_000, EDIT_WAIT = 4_000

const str = (v: unknown) => (typeof v === "string" ? v : "")
/** A setting, else its manifest's default. */
const setting = (key: string) => str(plugin.settings()[key]).trim() || str(plugin.manifest.settings?.[key]?.default)
export const mode = (): Mode => {
  const m = plugin.settings().mode
  return m === "off" || m === "notice" || m === "pair" ? m : "quiet"
}
const agentSetting = () => setting("agent") || "claude"
/** The configured agent's name: the setting, else its own (claude: Claude). */
export const ownName = () => str(plugin.settings().name).trim() || nameOf(agentSetting())
const nameOf = (agent: string) => {
  const base = agent.split("_")[0]
  return base === "claude" ? "Claude" : agentName(base) ?? base.charAt(0).toUpperCase() + base.slice(1)
}

// ---------- state ----------

const moments: Moment[] = []
let seq = 0
const delivered = new Map<string, number>() // agent -> last seq it was given
const handed = new Set<string>() // agents given moments they haven't acted on yet
const waiters = new Map<string, (m: Moment[]) => void>() // agent -> its waiting `next`
const agents = new Map<string, Agent>()
const notes = new Map<string, Note>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let nid = 0
const log = plugin.dayLog<Moment>("moments")
const acts = plugin.dayLog<Act>("actions")
const did = (as: string, op: string, seqs?: number[]) => { const t = Date.now(); acts.append(t, [{ t, as, op, ...(seqs ? { seqs } : {}) }]) }

/** The app's windows: which files each has open, where its user is, when they last did anything. */
type Win = { open: string[]; focus: Target | null; at: number; was?: string }
const windows = new Map<WebSocket, Win>()
const asked = new Map<string, { done: (ok: boolean, error?: string) => void }>()

const send = (ws: WebSocket, m: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }
const broadcast = (m: object) => { const text = JSON.stringify(m); for (const ws of windows.keys()) if (ws.readyState === ws.OPEN) ws.send(text) }
const snapshot = () => ({ t: "state", mode: mode(), name: ownName(), agents: [...agents.values()], notes: [...notes.values()] })

/** Where the user is: the window they used last. */
export const focus = () => [...windows.values()].sort((a, b) => b.at - a.at)[0]?.focus ?? null

/** Take in a moment from the app: kept (and logged), and given to the agents waiting. */
export function addMoment(m: Omit<Moment, "seq" | "t"> & { t?: number }) {
  const md = mode()
  if (md === "off") return null
  if ((m.kind === "edit" || m.kind === "open") && md === "quiet") return null
  const full = { ...m, seq: ++seq, t: m.t ?? Date.now() } as Moment
  log.append(full.t, [full])
  // (more of the same lines before any agent saw the last: one moment)
  const last = moments[moments.length - 1]
  const merged = m.kind === "edit" && last?.kind === "edit" && last.path === m.path && ![...delivered.values()].some((d) => d >= last.seq) ? mergeHunks(last.hunks ?? [], m.hunks ?? []) : null
  if (merged) { Object.assign(last, { hunks: merged, t: full.t }); return last }
  moments.push(full)
  if (moments.length > KEEP) moments.splice(0, moments.length - KEEP)
  for (const [name, wake] of waiters) { waiters.delete(name); wake([full]) }
  if (m.kind === "ask" || m.kind === "reply") for (const a of agents.values()) setAgent(a.name, { state: "thinking", ...(m.path ? { path: m.path, line: m.line, find: undefined } : {}) })
  return full
}

/** Two edits in a row as one, when the second changes only lines the first wrote (or right after them); else null. */
export function mergeHunks(a: Hunk[], b: Hunk[]): Hunk[] | null {
  if (a.length !== 1 || b.length !== 1) return null
  const [x] = a, [y] = b, k = y.line - x.line
  if (k < 0 || k + y.removed.length > x.added.length) return null
  return [{ line: x.line, removed: x.removed, added: [...x.added.slice(0, k), ...y.added, ...x.added.slice(k + y.removed.length)].slice(0, 40) }]
}

/** The agent named `name`, made the first time it acts (its tint the next free one, Claude orange, Codex blue). */
function agentOf(name: string): Agent {
  let a = agents.get(name)
  if (!a) {
    const used = new Set([...agents.values()].map((x) => x.tint))
    const want = /claude/i.test(name) ? "orange" : /codex/i.test(name) ? "blue" : null
    const tint = want && !used.has(want) ? want : TINTS.find((t) => !used.has(t)) ?? TINTS[agents.size % TINTS.length]
    a = { name, tint, state: "watching", t: Date.now() }
    agents.set(name, a)
  }
  return a
}
function setAgent(name: string, change: Partial<Agent>) {
  if (change.state === "watching" || change.state === "writing" || change.state === "away") handed.delete(name)
  const a = Object.assign(agentOf(name), { seen: undefined }, change, { t: Date.now() })
  broadcast({ t: "agent", agent: a })
  return a
}

/** A new item's id: short to type, and random so one kept by another machine's server isn't taken. */
function newId() {
  let id: string
  do id = `n${Math.random().toString(36).slice(2, 6)}`; while (notes.has(id))
  return id
}

function putNote(n: Omit<Note, "id" | "t">, ttl?: number) {
  const note: Note = { ...n, id: newId(), t: Date.now() }
  notes.set(note.id, note)
  broadcast({ t: "note", note })
  if (ttl) timers.set(note.id, setTimeout(() => dropNote(note.id), ttl))
  if (KEPT.has(note.kind)) save(note.path!)
  return note
}
export function dropNote(id: string) {
  clearTimeout(timers.get(id)); timers.delete(id)
  const n = notes.get(id)
  if (!n || !notes.delete(id)) return
  broadcast({ t: "drop", id })
  if (KEPT.has(n.kind) && n.path) save(n.path)
}

// ---------- comments and suggestions kept: a sidecar per note, so they outlive the server and reach other devices

const KEPT = new Set(["comment", "suggestion"])
const DIR = ".vaultite/plugins/companion/comments"
const sidecar = (p: string) => `${DIR}/${p}.json`
/** Each sidecar's text as last written or read: our own writes come back from the watcher. */
const written = new Map<string, string>()
const kept = (p: string) => [...notes.values()].filter((n) => n.path === p && KEPT.has(n.kind))
const lineCount = (text: string) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
const under = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`)

/** Write a note's sidecar as its kept items are now; none: the file goes. */
export function save(p: string) {
  const rel = sidecar(p), list = kept(p)
  const text = list.length ? `${JSON.stringify({ comments: list.map(({ path: _, ...n }) => n) }, null, 2)}\n` : ""
  if (text === (written.get(rel) ?? "")) return
  const abs = plugin.vault.abs(rel)
  try {
    if (text) writeAtomic(abs, text)
    else {
      fs.rmSync(abs, { force: true })
      // (its folders too, once empty)
      for (let d = path.dirname(abs), top = plugin.vault.abs(DIR); d.startsWith(top) && fs.readdirSync(d).length === 0; d = path.dirname(d)) fs.rmdirSync(d)
    }
  } catch (e) { console.error(`companion: couldn't save ${rel}: ${(e as Error).message}`) }
  if (text) written.set(rel, text); else written.delete(rel)
}

/** A note's kept items as its sidecar has them now (the server started, or another machine wrote it). */
function load(p: string) {
  const rel = sidecar(p), abs = plugin.vault.abs(rel)
  let text = ""
  try { text = readText(abs) } catch (e) {
    // (in iCloud only for now, or unreadable: as it was until it reads)
    if ((e as NodeJS.ErrnoException).code !== "ENOENT" || fs.existsSync(path.join(path.dirname(abs), `.${path.basename(abs)}.icloud`))) return
  }
  if (text === (written.get(rel) ?? "")) return
  let list: unknown
  try { list = text ? JSON.parse(text).comments : [] } catch { return }
  if (!Array.isArray(list)) return
  if (text) written.set(rel, text); else written.delete(rel)
  const now = new Map(list.filter((n): n is Note => n && typeof n.id === "string" && KEPT.has(n.kind)).map((n) => [n.id, { ...n, path: p }]))
  for (const n of kept(p)) if (!now.has(n.id)) { notes.delete(n.id); broadcast({ t: "drop", id: n.id }) }
  for (const n of now.values()) {
    if (JSON.stringify(notes.get(n.id)) === JSON.stringify(n)) continue
    notes.set(n.id, n)
    broadcast({ t: "note", note: n })
  }
}

/** The line an item is on in `text` now: where its find (or anchor line) is nearest its line, null when that's gone. */
export function anchorLine(text: string, n: Pick<Note, "find" | "anchor" | "line">): number | null {
  if (n.find) {
    const i = nearest(text, n.find, n.line)
    return i < 0 ? null : text.slice(0, i).split("\n").length
  }
  const lines = text.split("\n")
  if (!n.anchor) return Math.max(1, Math.min(n.line ?? 1, lineCount(text)))
  let best: number | null = null
  lines.forEach((l, i) => { if (l.trim() === n.anchor && (best === null || Math.abs(i + 1 - (n.line ?? 1)) < Math.abs(best - (n.line ?? 1)))) best = i + 1 })
  return best
}

/** A note's kept items found again in its text: a comment whose text is gone stays by its last line, a suggestion goes. */
function follow(p: string) {
  const list = kept(p)
  let text: string
  try { text = readText(plugin.vault.abs(p)) } catch { return }
  let changed = false
  for (const n of list) {
    const line = anchorLine(text, n) ?? (n.kind === "comment" ? Math.max(1, Math.min(n.line ?? 1, lineCount(text))) : null)
    if (line === null) { notes.delete(n.id); broadcast({ t: "drop", id: n.id }) } else if (line !== n.line) { n.line = line; broadcast({ t: "note", note: n }) } else continue
    changed = true
  }
  if (changed) save(p)
}
// (after a pause: a suggestion just taken is answered before its text is gone from the file)
const following = new Map<string, ReturnType<typeof setTimeout>>()
const followSoon = (p: string) => {
  clearTimeout(following.get(p))
  following.set(p, setTimeout(() => { following.delete(p); follow(p) }, 2000))
}

/** Every sidecar read (as when the server starts), and its note's items found again; fresh: memory's forgotten first. */
export function loadAll(fresh = false) {
  if (fresh) { for (const n of notes.values()) if (KEPT.has(n.kind)) notes.delete(n.id); written.clear() }
  const top = plugin.vault.abs(DIR)
  let files: string[] = []
  try { files = (fs.readdirSync(top, { recursive: true }) as string[]).filter((f) => f.endsWith(".json")) } catch { /* none yet */ }
  for (const f of files) {
    const p = f.split(path.sep).join("/").slice(0, -5)
    load(p)
    // (a trashed note's, once it's gone for good from the trash)
    if (p.startsWith(".trash/") && !fs.existsSync(plugin.vault.abs(p))) { for (const n of kept(p)) notes.delete(n.id); save(p) } else follow(p)
  }
}

let loadedFor: Vault | null = null
plugin.onChange((paths) => {
  if (!loadedFor) return
  if (paths === null) return loadAll()
  for (const p of paths) {
    if (p.startsWith(`${DIR}/`) && p.endsWith(".json")) load(p.slice(DIR.length + 1, -5))
    else if (kept(p).length) {
      if (p.startsWith(".trash/") && !fs.existsSync(plugin.vault.abs(p))) { for (const n of kept(p)) dropNote(n.id) } else followSoon(p)
    }
  }
})

// Kept items follow their note: moved, renamed, into the trash and back (even while it's off).
plugin.onMove((from, to, trashed) => {
  const dest = to ?? trashed ?? null
  const there = (p: string) => (dest === null ? null : dest + p.slice(from.length))
  for (const [a, b] of [[sidecar(from), dest && sidecar(dest)], [`${DIR}/${from}`, dest && `${DIR}/${dest}`]]) {
    const abs = plugin.vault.abs(a!)
    if (!fs.existsSync(abs) || (a === `${DIR}/${from}` && !fs.statSync(abs).isDirectory())) continue
    try {
      if (b) { fs.mkdirSync(path.dirname(plugin.vault.abs(b)), { recursive: true }); fs.renameSync(abs, plugin.vault.abs(b)) } else fs.rmSync(abs, { recursive: true, force: true })
    } catch (e) { console.error(`companion: couldn't move ${a}: ${(e as Error).message}`) }
  }
  for (const [k, text] of [...written]) {
    const p = k.slice(DIR.length + 1, -5)
    if (!under(p, from)) continue
    written.delete(k)
    const q = there(p)
    if (q) written.set(sidecar(q), text)
  }
  for (const n of [...notes.values()]) {
    if (!n.path || !under(n.path, from) || !KEPT.has(n.kind)) continue
    const q = there(n.path)
    if (q) { n.path = q; broadcast({ t: "note", note: n }) } else { notes.delete(n.id); broadcast({ t: "drop", id: n.id }) }
  }
})

/** The user's answer to an item from the app: a moment for its agent; a suggestion or a dismissed comment goes away. */
export function answer(id: string, verdict: "accept" | "reject" | "dismiss" | "reply", text?: string) {
  const n = notes.get(id)
  if (!n) return
  if (verdict === "reply" && text) {
    n.replies = [...(n.replies ?? []), { by: "user", text }]
    broadcast({ t: "note", note: n })
    if (KEPT.has(n.kind) && n.path) save(n.path)
  } else dropNote(id)
  addMoment({ kind: verdict, item: id, path: n.path, line: n.line, text: verdict === "reply" ? text : n.text, ...(n.kind === "suggestion" ? { selection: n.find, to: n.replace } : {}) })
}

plugin.onUnload(() => {
  for (const t of [...timers.values(), ...following.values()]) clearTimeout(t)
  for (const ws of windows.keys()) ws.close()
  for (const wake of waiters.values()) wake([])
  if (watchdog) clearInterval(watchdog)
})

// ---------- the app's windows: /api/companion/live

plugin.socket("companion/live", (ws) => {
  windows.set(ws, { open: [], focus: null, at: 0 })
  send(ws, snapshot())
  ws.on("message", (data: RawData) => {
    let m: Record<string, unknown>
    try { m = JSON.parse(String(data)) } catch { return }
    const w = windows.get(ws)
    if (!w) return
    if (m.t === "where") {
      w.open = Array.isArray(m.open) ? m.open.filter((p): p is string => typeof p === "string") : w.open
      const f = m.focus as Target | null
      w.focus = f && typeof f.path === "string" ? { path: f.path, line: Number(f.line) || 1 } : null
      if (m.active) w.at = Date.now()
      // (another note, not the same one focused again)
      if (w.focus && m.active && w.focus.path !== w.was) { w.was = w.focus.path; addMoment({ kind: "open", ...w.focus }) }
    } else if (m.t === "moment" && typeof m.kind === "string" && ["ask", "edit"].includes(m.kind)) {
      w.at = Date.now()
      addMoment({ kind: m.kind as "ask" | "edit", path: str(m.path) || undefined, line: Number(m.line) || undefined, text: str(m.text) || undefined,
        selection: str(m.selection) || undefined, hunks: Array.isArray(m.hunks) ? (m.hunks as Hunk[]).slice(0, 40) : undefined })
    } else if (m.t === "answer" && typeof m.id === "string" && ["accept", "reject", "dismiss", "reply"].includes(String(m.verdict))) {
      answer(m.id, m.verdict as "accept", str(m.text) || undefined)
    } else if (m.t === "done" && typeof m.rid === "string") {
      asked.get(m.rid)?.done(m.ok === true, str(m.error) || undefined)
    }
  })
  ws.on("close", () => windows.delete(ws))
})

// ---------- edits: typed in by the window that has the file open, else written on disk

type Edit = { path: string; find?: string; text: string; line?: number; append?: boolean }

/** The window to type an edit in: the most recent one with the file open. */
const editorFor = (path: string) => [...windows.entries()].filter(([, w]) => w.open.includes(path)).sort((a, b) => b[1].at - a[1].at)[0]?.[0] ?? null

async function applyEdit(ctx: OpCtx, agent: Agent, e: Edit, animate = true): Promise<"typed" | "written"> {
  const ws = editorFor(e.path)
  if (ws) {
    const rid = `e${++nid}`
    const ok = await new Promise<boolean | string>((resolve) => {
      const timer = setTimeout(() => { asked.delete(rid); resolve(false) }, EDIT_WAIT + e.text.length * 20)
      asked.set(rid, { done: (ok, error) => { clearTimeout(timer); asked.delete(rid); resolve(ok || error || false) } })
      send(ws, { t: "edit", rid, agent: agent.name, animate, ...e })
    })
    if (ok === true) return "typed"
    if (typeof ok === "string") throw new OpError(ok, 409)
  }
  const f = await ctx.api("GET", `file?path=${encodeURIComponent(e.path)}`)
  const cur = String(f.text ?? "")
  await ctx.api("PUT", "file", { path: f.path, text: editText(cur, e), base: cur })
  return "written"
}

/** `cur` with edit `e` made: `find` replaced by `text`, or `text` as new lines after `line` (0: first) or at the end. */
export function editText(cur: string, e: Omit<Edit, "path">) {
  if (e.find) {
    const at = nearest(cur, e.find, e.line)
    if (at < 0) throw new OpError(`"${cut(e.find, 60)}" isn't in the file: read it again (it may have changed) and copy the text exactly`)
    return cur.slice(0, at) + e.text + cur.slice(at + e.find.length)
  }
  const lines = cur.split("\n")
  const n = e.append || e.line === undefined ? (cur.endsWith("\n") ? lines.length - 1 : lines.length) : Math.max(0, Math.min(lines.length, e.line))
  lines.splice(n, 0, ...e.text.replace(/\n$/, "").split("\n"))
  return lines.join("\n")
}

/** Where `find` is in `text`: the occurrence nearest line `line` (1-based), -1 when it isn't. */
export function nearest(text: string, find: string, line?: number) {
  let best = -1, bestD = Infinity
  for (let i = text.indexOf(find); i >= 0; i = text.indexOf(find, i + 1)) {
    const d = line ? Math.abs(text.slice(0, i).split("\n").length - line) : 0
    if (d < bestD) { best = i; bestD = d }
    if (!line) break
  }
  return best
}
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
/** Line `n` (from 1) of a file, trimmed: "" when it can't be read. */
const lineText = (p: string, n: number) => { try { return readText(plugin.vault.abs(p)).split("\n")[n - 1]?.trim() ?? "" } catch { return "" } }

// ---------- the always-on session

/** What its session runs unasked: its own commands and reading the vault. */
const ALLOW = ["vau companion", "vau docs", "vau read", "vau search", "vau render", "vau links", "vau context", "vau tasks", "vau dataview"]
const sessionFile = () => `${plugin.localDir()}/session.json`
const sessionId = (): string | null => { try { return JSON.parse(fs.readFileSync(sessionFile(), "utf8")).id ?? null } catch { return null } }
const running = async (id: string | null) => !!id && !!(await plugin.ask<boolean>("terminal:runs", false, id))

async function start(ctx: OpCtx) {
  const was = sessionId()
  if (await running(was)) return { id: was!, running: true }
  const id = newTerminalId(agentSetting())
  await startAgent(ctx, id, setting("prompt"), ALLOW)
  fs.writeFileSync(sessionFile(), JSON.stringify({ id, t: Date.now() }))
  lastAsk = Date.now()
  return { id, running: false }
}

async function stop() {
  const id = sessionId()
  try { fs.rmSync(sessionFile()) } catch { /* none */ }
  if (await running(id)) await plugin.runOp("terminal.end", { id })
  for (const a of agents.values()) setAgent(a.name, { state: "away" })
  return { id }
}

// A session whose turn ended stops watching: nudged back when nobody has waited on moments for a while.
let lastAsk = 0
const NUDGE = 5 * 60_000
const watchdog: ReturnType<typeof setInterval> | null = setInterval(async () => {
  if (plugin.isOff() || mode() === "off" || waiters.size || Date.now() - lastAsk < NUDGE) return
  const id = sessionId()
  if (!(await running(id))) return
  lastAsk = Date.now()
  await plugin.runOp("terminal.send", { id, text: "Keep watching: run `vau companion next --timeout 240` again, and never end your turn." }).catch(() => {})
}, 60_000)
watchdog.unref?.()

// ---------- ops

const AS = { type: "string", description: "your name in the app, when several agents keep the user company (default: the companion's, Claude)" } as const
const PATH = { type: "string", format: "path", description: "the file (Notes/Idea.md); default: the one the user is in" } as const
const LINE = { type: "integer", minimum: 0, description: "a line of it (from 1, counting its frontmatter)" } as const
const FIND = { type: "string", description: "text in that line or near it, exactly as in the file (the occurrence nearest line)" } as const

/** A target from params: the user's file when none is given. */
function target(p: Record<string, unknown>): Target {
  const path = str(p.path) || focus()?.path
  if (!path) throw new OpError("the user has no file open: give path")
  return { path, ...(p.line !== undefined ? { line: Number(p.line) } : {}), ...(str(p.find) ? { find: str(p.find) } : {}) }
}
const who = (p: Record<string, unknown>) => str(p.as).trim() || ownName()

plugin.op({
  id: "companion.next",
  cli: "companion next",
  summary: "Wait for what the user does next in the app (asks you, writes, opens a note, answers you), as the companion.",
  help: `Answers the moments since you last asked, or waits for one (up to timeout seconds; none by then: an empty list).
ask: they addressed you (a line "@claude ..." in a note, or Ask companion on a selection): always answer. edit: lines
they changed after a pause (notice and pair modes). open: they went to a note. reply, accept, reject, dismiss: their
answer to your comment or suggestion. Lines count from 1 with the frontmatter. Asks, replies and edits come with the note's
text around them, numbered: no need to read it again. While you wait your cursor rests; given moments, it shows you
reading (thinking, for an ask) there until you act, or run this again: the user sees a seen tick. Run it again after
acting, forever.

  vau companion next --timeout 240`,
  kind: "read",
  lock: false,
  params: {
    timeout: { type: "integer", minimum: 0, maximum: 240, default: 100, description: "seconds to wait for a moment" },
    after: { type: "integer", minimum: 0, description: "only moments after this one (default: after the last you were given)" },
    as: AS,
  },
  run: async (p, ctx) => {
    const name = who(p)
    lastAsk = Date.now()
    did(name, "next")
    const a = agentOf(name)
    // (back without acting on what it was handed: it let it pass, which the user sees as a tick)
    if (handed.has(name)) setAgent(name, { state: "watching", seen: true })
    else if (a.state === "away" || a.state === "writing") setAgent(name, { state: "watching" })
    const after = p.after ?? delivered.get(name) ?? Math.max(0, seq - 20)
    let got = moments.filter((m) => m.seq > after && Date.now() - m.t < 30 * 60_000)
    if (!got.length && p.timeout > 0) {
      waiters.get(name)?.([])
      got = await new Promise<Moment[]>((resolve) => {
        const timer = setTimeout(() => { if (waiters.get(name) === wake) waiters.delete(name); resolve([]) }, p.timeout * 1000)
        const wake = (m: Moment[]) => { clearTimeout(timer); resolve(m) }
        waiters.set(name, wake)
      })
      lastAsk = Date.now()
    }
    if (got.length) {
      delivered.set(name, got[got.length - 1].seq)
      did(name, "handed", got.map((m) => m.seq))
      const at = [...got].reverse().find((m) => m.path)
      setAgent(name, { state: got.some((m) => m.kind === "ask" || m.kind === "reply") ? "thinking" : "reading",
        ...(at ? { path: at.path, line: at.line, find: undefined } : {}) })
      handed.add(name)
    }
    return { mode: mode(), focus: focus(), moments: got, cursor: delivered.get(name) ?? after, notes: await excerpts(ctx, got) }
  },
  text: (r) => momentsText(r.moments, r.mode, r.focus, r.notes),
})

/** The text around what the user asked or wrote, per note: all of a short note for an ask or a reply. */
async function excerpts(ctx: OpCtx, ms: Moment[]) {
  const by = new Map<string, Moment[]>()
  for (const m of ms) if (m.path && (m.kind === "ask" || m.kind === "reply" || m.kind === "edit")) by.set(m.path, [...(by.get(m.path) ?? []), m])
  const out: Excerpt[] = []
  for (const [path, list] of by) {
    try {
      const f = await ctx.api("GET", `file?path=${encodeURIComponent(path)}`) as { text?: unknown }
      const e = excerpt(path, String(f.text ?? ""), list)
      if (e) out.push(e)
    } catch { /* gone, or not text */ }
  }
  return out
}
const WHOLE = 120, MOST = 160
export function excerpt(path: string, text: string, ms: Moment[]): Excerpt | null {
  const lines = text.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const asked = ms.some((m) => m.kind !== "edit")
  const at = ms.flatMap((m) => [m.line ?? 0, ...(m.hunks ?? []).flatMap((h) => [h.line, h.line + h.added.length - 1])]).filter((n) => n > 0)
  if (!lines.length || (!at.length && !asked)) return null
  let from = 1, to = lines.length
  if (!asked || lines.length > WHOLE) {
    const pad = asked ? 40 : 6
    from = Math.max(1, Math.min(...at, lines.length) - pad)
    to = Math.min(lines.length, Math.max(...at, 1) + pad, from + MOST - 1)
  }
  return { path, from, to, of: lines.length, lines: lines.slice(from - 1, to).map((l) => cut(l, 400)) }
}

/** Moments as an agent reads them. */
export function momentsText(ms: Moment[], md: Mode, f: Target | null, notes: Excerpt[] = []) {
  const head = `Mode: ${md}.${f?.path ? ` The user is in ${f.path} at line ${f.line ?? 1}.` : ""}`
  if (!ms.length) return `${head}\nNothing yet: run vau companion next again.`
  const out = [head]
  for (const m of ms) {
    const at = m.path ? ` ${m.path}${m.line ? `:${m.line}` : ""}` : ""
    if (m.kind === "ask") out.push(`- ask${at}: ${JSON.stringify(m.text ?? "")}${m.selection ? `\n  on the selection: ${JSON.stringify(cut(m.selection, 2000))}` : ""}`)
    else if (m.kind === "edit") {
      out.push(`- edit${at}`)
      for (const h of m.hunks ?? []) {
        out.push(`  at line ${h.line}:`)
        for (const l of h.removed) out.push(`  - ${l}`)
        for (const l of h.added) out.push(`  + ${l}`)
      }
    } else if (m.kind === "open") out.push(`- open${at}`)
    else if (m.kind === "reply") out.push(`- reply to ${m.item}${at}: ${JSON.stringify(m.text ?? "")}`)
    else out.push(`- ${m.kind} ${m.item}${at}${m.kind === "accept" && m.to !== undefined ? ` (now ${JSON.stringify(cut(m.to, 200))})` : ""}`)
  }
  for (const e of notes) {
    out.push(`${e.path}, lines ${e.from}-${e.to} of ${e.of}:`)
    e.lines.forEach((l, i) => out.push(`${String(e.from + i).padStart(4)}  ${l}`))
  }
  return out.join("\n")
}

plugin.op({
  id: "companion.look",
  cli: "companion look",
  summary: "Move your cursor to a place in a note, without a word: where your attention is.",
  help: `  vau companion look --path Notes/Idea.md --line 12
  vau companion look --find "the second paragraph"`,
  kind: "read",
  params: { path: PATH, line: LINE, find: FIND, as: AS },
  run: async (p) => {
    const t = target(p)
    did(who(p), "look")
    setAgent(who(p), { ...t, state: "watching", find: t.find })
    return t
  },
  text: (r) => `Looking at ${r.path}${r.line ? `:${r.line}` : ""}.`,
})

plugin.op({
  id: "companion.say",
  cli: "companion say",
  summary: "Say something in a bubble by your cursor (gone after a while): a short answer, a heads-up.",
  help: `Short, one or two sentences. With a place, your cursor goes there first. What should stay goes in a comment.

  vau companion say "Done: three tasks added below."
  vau companion say "That date is a Sunday." --find "May 3"`,
  kind: "read",
  params: { text: { type: "string", required: true, description: "what to say (Markdown)" }, path: PATH, line: LINE, find: FIND, as: AS },
  args: ["text"],
  run: async (p) => {
    const name = who(p)
    did(name, "say")
    const t = p.path || p.line !== undefined || p.find ? target(p) : {}
    setAgent(name, { ...t, state: "watching" })
    return putNote({ kind: "say", agent: name, text: str(p.text), ...t }, SAY_MS)
  },
  text: () => "Said.",
})

plugin.op({
  id: "companion.comment",
  cli: "companion comment",
  summary: "Leave a comment in the margin by a line, until the user dismisses it; they can reply (a reply moment).",
  help: `For what's worth keeping a moment: an answer to their ask, a thought on what they wrote. Replying to their reply to
it: with id (the comment's), your words join its thread.

  vau companion comment "Alice moved this to Thursday." --path Notes/Plans.md --find "Meet Alice"
  vau companion comment "Yes, both work." --id n12`,
  kind: "read",
  params: { text: { type: "string", required: true, description: "the comment (Markdown, short)" }, id: { type: "string", description: "a comment to reply in" },
    path: PATH, line: LINE, find: FIND, as: AS },
  args: ["text"],
  run: async (p) => {
    const name = who(p)
    did(name, "comment")
    if (p.id) {
      const n = notes.get(p.id)
      if (!n || n.kind !== "comment") throw new OpError(`there's no comment ${p.id} (dismissed?)`, 404)
      n.replies = [...(n.replies ?? []), { by: "agent", text: str(p.text) }]
      broadcast({ t: "note", note: n })
      save(n.path!)
      setAgent(name, { path: n.path, line: n.line, find: n.find, state: "watching" })
      return n
    }
    const t = target(p)
    setAgent(name, { ...t, state: "watching" })
    const anchor = !t.find && t.line ? lineText(t.path!, t.line) : ""
    return putNote({ kind: "comment", agent: name, text: str(p.text), ...t, ...(anchor ? { anchor } : {}) })
  },
  text: (r) => `Commented (${r.id}).`,
})

plugin.op({
  id: "companion.suggest",
  cli: "companion suggest",
  summary: "Suggest a change in a note: shown struck through and in your colour; the user takes it (Tab) or not (Esc).",
  help: `find is the text to change, exactly as in the file; replace what it becomes (empty: removed). An accept or reject
moment tells you what they chose.

  vau companion suggest --path Notes/Idea.md --find "recieve" --replace "receive"
  vau companion suggest --find "We could maybe try" --replace "We'll try" --why "Firmer"`,
  kind: "read",
  params: { find: { ...FIND, description: "the text to change, exactly as in the file" }, replace: { type: "string", required: true, description: "what it becomes" },
    why: { type: "string", description: "a few words on why, by it" }, path: PATH, line: LINE, as: AS },
  run: async (p) => {
    if (!str(p.find)) throw new OpError("give find: the text to change")
    const name = who(p), t = target(p)
    did(name, "suggest")
    setAgent(name, { ...t, state: "watching" })
    return putNote({ kind: "suggestion", agent: name, ...t, replace: str(p.replace), ...(str(p.why) ? { text: str(p.why) } : {}) })
  },
  text: (r) => `Suggested (${r.id}).`,
})

plugin.op({
  id: "companion.edit",
  cli: "companion edit",
  summary: "Write in a note: typed in before the user's eyes when it's open (they can undo it), else saved to the file.",
  help: `Only in pair mode or when they asked you to. find and text: find replaced by text. Without find: text as new lines
after line (0: at the top), or at the end.

  vau companion edit --path Notes/Idea.md --find "- [ ] Call Alice" --text "- [x] Call Alice"
  vau companion edit --line 14 --text "- Ask Ben about the budget"`,
  kind: "write",
  lock: false,
  params: { text: { type: "string", required: true, description: "what to write" }, find: { type: "string", description: "the text it replaces, exactly as in the file" },
    path: PATH, line: LINE, append: { type: "boolean", description: "at the end of the file" }, as: AS },
  args: ["text"],
  run: async (p, ctx) => {
    const name = who(p), t = target(p)
    did(name, "edit")
    const a = setAgent(name, { ...t, state: "writing" })
    try {
      const how = await applyEdit(ctx, a, { path: t.path!, find: t.find, line: t.line, text: str(p.text), append: !!p.append })
      return { path: t.path, how }
    } finally { setAgent(name, { state: "watching" }) }
  },
  text: (r) => `${r.how === "typed" ? "Typed into" : "Wrote"} ${r.path}.`,
})

plugin.op({
  id: "companion.highlight",
  cli: "companion highlight",
  summary: "Highlight text in a note in your colour: for a while, or kept in the file (==🟠text==) with keep.",
  help: `  vau companion highlight --find "the budget is due Friday"
  vau companion highlight --path Notes/Idea.md --find "key insight" --keep`,
  kind: "read",
  params: { find: { ...FIND, description: "the text to highlight, exactly as in the file" }, keep: { type: "boolean", description: "keep it in the file, as a highlight of your colour" },
    path: PATH, line: LINE, as: AS },
  run: async (p, ctx) => {
    if (!str(p.find)) throw new OpError("give find: the text to highlight")
    const name = who(p), t = target(p), a = setAgent(name, { ...t, state: "watching" })
    did(name, "highlight")
    if (!p.keep) return putNote({ kind: "highlight", agent: name, ...t }, HIGHLIGHT_MS)
    await applyEdit(ctx, a, { path: t.path!, find: t.find, line: t.line, text: `==${EMOJI[a.tint] ?? ""}${t.find}==` }, false)
    return { path: t.path, kept: true }
  },
  text: (r) => (r.kept ? `Highlighted in ${r.path}.` : `Highlighted (${r.id}).`),
})

plugin.op({
  id: "companion.clear",
  cli: "companion clear",
  summary: "Take back your comments and suggestions (one by id, or all of yours).",
  kind: "read",
  params: { id: { type: "string", description: "the item (n12); default: all of yours" }, as: AS },
  run: async (p) => {
    const name = who(p), gone = [...notes.values()].filter((n) => (p.id ? n.id === p.id : n.agent === name))
    for (const n of gone) dropNote(n.id)
    return { cleared: gone.length }
  },
  text: (r) => `Cleared ${r.cleared}.`,
})

plugin.op({
  id: "companion.status",
  cli: "companion status",
  summary: "What the companion is: its mode, its session, the agents in the app and what they left there.",
  kind: "read",
  params: {},
  run: async () => {
    const id = sessionId()
    return { mode: mode(), name: ownName(), session: (await running(id)) ? id : null, windows: windows.size, focus: focus(),
      agents: [...agents.values()], notes: [...notes.values()], moments: moments.slice(-10) }
  },
  text: (r) => [`Mode: ${r.mode}. Session: ${r.session ?? "not running"}. Windows: ${r.windows}.`,
    ...r.agents.map((a: Agent) => `- ${a.name} (${a.tint}): ${a.state}${a.path ? ` at ${a.path}${a.line ? `:${a.line}` : ""}` : ""}`),
    ...r.notes.map((n: Note) => `- ${n.id} ${n.kind} by ${n.agent}${n.path ? ` in ${n.path}` : ""}: ${cut(n.text ?? n.replace ?? n.find ?? "", 80)}`)].join("\n"),
})

plugin.op({
  id: "companion.start",
  cli: "companion start",
  owner: "a coding agent",
  summary: "Start the companion's always-on session (its agent, in a terminal on this machine), unless it runs.",
  kind: "write",
  lock: false,
  params: {},
  run: async (_p, ctx) => {
    if (mode() === "off") await plugin.patchSettings({ mode: "quiet" })
    return await start(ctx)
  },
  text: (r) => `${r.running ? "Already running" : "Started"} in ${r.id} (vau terminal screen ${r.id}).`,
})

plugin.op({
  id: "companion.stop",
  cli: "companion stop",
  owner: "the terminal",
  summary: "End the companion's session; its cursor goes away until it starts again.",
  kind: "write",
  lock: false,
  params: {},
  run: async () => await stop(),
  text: (r) => (r.id ? `Ended ${r.id}.` : "It wasn't running."),
})

plugin.op({
  id: "companion.replay",
  cli: "companion replay",
  summary: "Replay moments recorded on a day (or from a file of JSON lines) to the companion, to see how it answers.",
  help: `The test harness: moments are logged on this machine each day; replaying a day's sends them again, spaced as they
came (faster with speed), so you can watch what the session makes of them.

  vau companion replay --day 2026-10-16 --speed 4
  vau companion replay --file /tmp/moments.jsonl`,
  kind: "read",
  lock: false,
  params: { day: { type: "string", description: "a day (YYYY-MM-DD) of the log" }, file: { type: "string", description: "a file of moments, one JSON per line" },
    speed: { type: "number", minimum: 0.1, default: 1, description: "how much faster than they came" }, limit: { type: "integer", minimum: 1, default: 50, description: "at most this many" } },
  run: async (p) => {
    let ms: Moment[] = []
    if (p.file) ms = fs.readFileSync(String(p.file), "utf8").split("\n").flatMap((l) => { try { return l ? [JSON.parse(l)] : [] } catch { return [] } })
    else if (p.day) ms = log.read(String(p.day))
    else throw new OpError("give day or file")
    ms = ms.filter((m) => m && typeof m.kind === "string").slice(-p.limit)
    const t0 = ms[0]?.t ?? 0
    void (async () => {
      for (const m of ms) {
        const wait = Math.min(30_000, Math.max(0, (m.t - t0) / p.speed) - 0)
        await new Promise((r) => setTimeout(r, wait))
        addMoment({ ...m, t: Date.now() })
      }
    })()
    return { replaying: ms.length }
  },
  text: (r) => `Replaying ${r.replaying} moments.`,
})

/** A moment's latency (ms): until next handed it (handoff), then to the agent's first action (think), and from the moment
 *  to its next `next` (total); undefined when it didn't happen. */
export type Timing = { t: number; seq: number; kind: string; at: string; op?: string; handoff?: number; think?: number; total?: number }

/** Each moment's timing, from the moments and actions logged on a day (seqs restart with the server: matched in time). */
export function timings(ms: Moment[], log: Act[]): Timing[] {
  return ms.map((m, i) => {
    const until = ms.slice(i + 1).find((x) => x.seq === m.seq)?.t ?? Infinity
    const r: Timing = { t: m.t, seq: m.seq, kind: m.kind, at: m.path ? `${m.path}${m.line ? `:${m.line}` : ""}` : "" }
    const hi = log.findIndex((a) => a.op === "handed" && a.t >= m.t && a.t < until && !!a.seqs?.includes(m.seq)), h = log[hi]
    if (!h) return r
    const after = log.slice(hi + 1).filter((a) => a.as === h.as)
    const done = after.find((a) => a.op === "next"), first = after.find((a) => a.op !== "next" && a.op !== "handed" && (!done || a.t <= done.t))
    return { ...r, handoff: h.t - m.t, ...(first ? { op: first.op, think: first.t - h.t } : {}), ...(done ? { total: done.t - m.t } : {}) }
  })
}

export function timingsText(day: string, rows: Timing[]) {
  const s = (ms?: number) => (ms === undefined ? "-" : (ms / 1000).toFixed(1)).padStart(7)
  const time = (t: number) => new Date(t).toTimeString().slice(0, 8)
  const pct = (xs: number[], q: number) => xs.sort((a, b) => a - b)[Math.max(0, Math.ceil(q * xs.length) - 1)]
  const sum = (label: string, rs: Timing[]) => `${label} (${rs.length}): ${(["handoff", "think", "total"] as const).map((k) => {
    const xs = rs.flatMap((r) => r[k] ?? [])
    return `${k} ${xs.length ? `${s(pct(xs, 0.5)).trim()}/${s(pct(xs, 0.9)).trim()}` : "-"}`
  }).join(", ")} (median/p90, s)`
  if (!rows.length) return `No moments on ${day}.`
  return [`${day}, in seconds: handoff (until next handed it), think (to the first action), total (to the next \`next\`).`,
    `${"time".padEnd(8)} ${"handoff".padStart(7)}${"think".padStart(7)}  ${"total".padStart(7)}  moment`,
    ...rows.map((r) => `${time(r.t)} ${s(r.handoff)}${s(r.think)}  ${s(r.total)}  ${r.kind}${r.op ? ` -> ${r.op}` : ""} ${cut(r.at, 50)}`),
    sum("asks and replies", rows.filter((r) => r.kind === "ask" || r.kind === "reply")), sum("all", rows)].join("\n")
}

plugin.op({
  id: "companion.timings",
  cli: "companion timings",
  summary: "How fast the companion answered on a day: per moment, its wait to be handed, the think to its first action, total.",
  help: `  vau companion timings
  vau companion timings --day 2026-10-16`,
  kind: "read",
  params: { day: { type: "string", description: "a day (YYYY-MM-DD); default: today" } },
  run: async (p) => {
    const day = str(p.day) || localDate(Date.now())
    return { day, rows: timings(log.read(day), acts.read(day)) }
  },
  text: (r) => timingsText(r.day, r.rows),
})

// ---------- a change of settings (mode, name) reaches the windows

let lastSaid = ""
plugin.onSync((vault) => {
  if (loadedFor !== vault) { loadedFor = vault; loadAll(true) }
  const now = `${mode()}\n${ownName()}`
  if (now === lastSaid) return
  // (turned off: its session ends too)
  if (lastSaid && mode() === "off") void stop().catch(() => {})
  lastSaid = now
  broadcast(snapshot())
})
