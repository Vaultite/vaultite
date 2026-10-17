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
/** What the user did, as an agent sees it. ask: they addressed it; point: they dropped its cursor on a line ("look at
 *  this"); edit and open only in notice and pair; reply, accept, reject, dismiss: their answer to one of its items. */
export type Moment = { seq: number; t: number; kind: "ask" | "point" | "edit" | "open" | "reply" | "accept" | "reject" | "dismiss"
  path?: string; line?: number; text?: string; selection?: string; hunks?: Hunk[]; item?: string; to?: string
  /** A point's word or selection, where its cursor stays. */
  find?: string
  /** The agent it's for (an ask to @name, an answer to its item); none (edit, open): the companion and agents that watch. */
  for?: string
  /** How long (ms) the user had stopped typing when the app sent it: the pause they waited. */
  waited?: number
  /** An ask whose line they went on writing after it went: the seq of the one it continues. */
  more?: number
  /** On a drawing (`find`: the element asked in): the user's pointer, what changed after a pause, the scene as text. */
  x?: number; y?: number; changes?: string[]; scene?: string }
/** Where something points: a file and a line (1-based), or text found in it (the occurrence nearest `line`); on a
 *  drawing, an element (`find`: its id or text) or a point of it (x, y). */
export type Target = { path?: string; line?: number; find?: string; x?: number; y?: number }
/** reading: it was handed what the user did; thinking: something to answer; seen: it let that pass, until its next change;
 *  starting: its session boots (asks to it wait for its first `next`). model, effort: what its session runs. */
export type Agent = Target & { name: string; tint: string; state: "watching" | "reading" | "thinking" | "writing" | "starting" | "away"; t: number; seen?: boolean
  model?: string; effort?: string }
/** What an agent leaves in the app: words by its cursor (say, gone after a while), a margin comment, a suggested change,
 *  a highlight (gone after a while). `anchor`: a comment's line as it read, to find it again without `find`. */
export type Note = Target & { id: string; kind: "say" | "comment" | "suggestion" | "highlight"; agent: string; t: number
  text?: string; replace?: string; anchor?: string; replies?: { by: "user" | "agent"; text: string }[]
  /** A say the user pinned: the comment it became. */
  pinned?: string
  /** A comment the user dismissed, when: kept in its note's history. */
  dismissed?: number }
/** What an agent did when (logged, for timings): called next, was handed moments (seqs), or acted (say, edit...). */
export type Act = { t: number; as: string; op: string; seqs?: number[] }
/** A note's lines from..to (1-based, of `of`), sent with the moments in it; a drawing's scene as text. */
export type Excerpt = { path: string; from: number; to: number; of: number; lines: string[]; scene?: string }

const TINTS = ["orange", "blue", "purple", "green", "red", "yellow"]
export const EMOJI: Record<string, string> = { red: "🔴", orange: "🟠", yellow: "🟡", green: "🟢", blue: "🔵", purple: "🟣" }
const KEEP = 300, SAY_MS = 12_000, HIGHLIGHT_MS = 10_000, EDIT_WAIT = 10_000

const str = (v: unknown) => (typeof v === "string" ? v : "")
/** A setting, else its manifest's default. */
const setting = (key: string) => str(plugin.settings()[key]).trim() || str(plugin.manifest.settings?.[key]?.default)
export const mode = (): Mode => {
  const m = plugin.settings().mode
  return m === "off" || m === "notice" || m === "pair" ? m : "quiet"
}
const agentSetting = () => setting("agent") || "claude"
/** What a session of `agent` runs: the model and effort given, else the settings; their defaults (Sonnet, medium) only
 *  for Claude Code, whose models they name. */
export function howOf(agent: string, model = "", effort = "") {
  const claude = agent.split("_")[0] === "claude", own = (k: string) => (claude ? setting(k) : str(plugin.settings()[k]).trim())
  return { model: model || own("model"), effort: effort || own("effort") }
}
/** The configured agent's name: the setting, else its own (claude: Claude). */
export const ownName = () => str(plugin.settings().name).trim() || nameOf(agentSetting())
const nameOf = (agent: string) => {
  const base = agent.split("_")[0]
  return base === "claude" ? "Claude" : agentName(base) ?? base.charAt(0).toUpperCase() + base.slice(1)
}

// ---------- state ----------

// (agents are keyed by their name in lower case: @ada and --as Ada are the same one)
const moments: Moment[] = []
let seq = 0
const delivered = new Map<string, number>() // agent -> last seq it was given
const handed = new Set<string>() // agents given moments they haven't acted on yet
const asking = new Set<string>() // agents handed an ask or a reply, busy on it until their next `next`
const waiters = new Map<string, (m: Moment[]) => void>() // agent -> its waiting `next`
const agents = new Map<string, Agent>()
const seen = new Map<string, number>() // agent -> when it last ran `next`
const watching = new Set<string>() // agents besides the companion that asked for edit and open moments
const loaded = Date.now(), LIVE_MS = 10 * 60_000
const notes = new Map<string, Note>()
/** Each agent's last says, gone from the screen or not: the cursor's popover shows them. */
let said: Note[] = []
export const recentSays = () => said
const SAID = 10
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let nid = 0
const log = plugin.dayLog<Moment>("moments")
const acts = plugin.dayLog<Act>("actions")
const did = (as: string, op: string, seqs?: number[]) => {
  const t = Date.now()
  acts.append(t, [{ t, as, op, ...(seqs ? { seqs } : {}) }])
  if (op !== "next" && op !== "handed") handed.delete(key(as))
}
/** An agent's state once it acted: still thinking while busy on an ask (until its next `next`), else watching. */
const acting = (name: string): Agent["state"] => (asking.has(key(name)) ? "thinking" : "watching")

/** The app's windows: which files each has open, where its user is, when they last did anything. */
type Win = { open: string[]; focus: Target | null; at: number; was?: string }
const windows = new Map<WebSocket, Win>()
const asked = new Map<string, { done: (ok: boolean, error?: string, reply?: Record<string, unknown>) => void }>()

const send = (ws: WebSocket, m: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }
const broadcast = (m: object) => { const text = JSON.stringify(m); for (const ws of windows.keys()) if (ws.readyState === ws.OPEN) ws.send(text) }
// (fresh: what a new agent started from the app runs)
const snapshot = () => ({ t: "state", mode: mode(), name: ownName(), agents: [...agents.values()], notes: [...notes.values()], said, fresh: howOf(agentSetting()) })

const key = (name: string) => name.trim().toLowerCase()
const isMain = (name: string) => key(name) === key(ownName())
/** An agent still around: waiting for moments, or it waited a moment ago. */
const live = (name: string) => waiters.has(key(name)) || Date.now() - (seen.get(key(name)) ?? 0) < LIVE_MS
/** Who an ask to @name is for: that agent when it's around, else the companion (@claude, @companion, a name gone). */
export function addressee(name?: string) {
  const a = name ? agents.get(key(name)) : undefined
  return a && a.state !== "away" && live(a.name) ? a.name : ownName()
}
/** Whether `name` gets moment `m`: its own, and edit and open for the companion and agents that watch. */
const meantFor = (m: Moment, name: string) => (m.for ? key(m.for) === key(name) : isMain(name) || watching.has(key(name)))

/** Where the user is: the window they used last that has a note (`next`, and the ops' default place, both say this). */
export const focus = () => [...windows.values()].sort((a, b) => b.at - a.at).find((w) => w.focus)?.focus ?? null

/** Take in a moment from the app: kept (and logged), and given to the agents waiting. */
export function addMoment(m: Omit<Moment, "seq" | "t"> & { t?: number }) {
  const md = mode()
  if (md === "off") return null
  if ((m.kind === "edit" || m.kind === "open") && md === "quiet") return null
  // (spaces alone changed, as a trailing one: nothing to see, and an agent woken for it isn't free for what is)
  const words = (ls: string[]) => ls.map((l) => l.trim()).filter(Boolean).join("\n")
  if (m.kind === "edit" && m.hunks?.length && m.hunks.every((h) => words(h.added) === words(h.removed))) return null
  const full = { ...m, seq: ++seq, t: m.t ?? Date.now() } as Moment
  if (m.kind === "edit" || m.kind === "open") delete full.for
  else full.for = addressee(m.for)
  // (an ask already asked, as it reads, a while ago: a line asked again by Enter on it, after a restart too)
  if (m.kind === "ask" && log.read(localDate(full.t)).some((x) => x.kind === "ask" && x.for === full.for && x.path === full.path && x.text === full.text && full.t - x.t < 2 * 3600_000)) return null
  log.append(full.t, [full])
  // (more of the same lines before any agent saw the last: one moment)
  const last = moments[moments.length - 1]
  const merged = m.kind === "edit" && last?.kind === "edit" && last.path === m.path && ![...delivered.values()].some((d) => d >= last.seq) ? mergeHunks(last.hunks ?? [], m.hunks ?? []) : null
  if (merged) { Object.assign(last, { hunks: merged, t: full.t }); return last }
  const was = m.kind === "ask" ? continues(full) : undefined
  if (was) {
    // (not handed yet: the same ask, as it reads now)
    if ((delivered.get(key(was.for!)) ?? 0) < was.seq) { Object.assign(was, { text: full.text, line: full.line }); return was }
    full.more = was.seq
  }
  moments.push(full)
  if (moments.length > KEEP) moments.splice(0, moments.length - KEEP)
  // (an open wakes no one: it rides along with the next moment, and the cursors free to follow go there now)
  if (m.kind === "open") {
    for (const a of agents.values()) if (meantFor(full, a.name) && a.state === "watching" && live(a.name) && !handed.has(key(a.name)))
      setAgent(a.name, { path: full.path, line: full.line, x: full.x, y: full.y, find: undefined, state: "watching" })
  } else for (const [k, wake] of waiters) if (meantFor(full, k)) { waiters.delete(k); wake([full]) }
  // (one starting shows that until its first `next` takes it)
  if (full.for && (m.kind === "ask" || m.kind === "point" || m.kind === "reply") && agents.get(key(full.for))?.state !== "starting") setAgent(full.for, { state: "thinking", ...(m.path ? { path: m.path, line: m.line, find: m.find, x: undefined, y: undefined } : {}) })
  return full
}

/** The ask `m` goes on from: the last to the same agent on that line of that note, a few minutes ago, which `m`'s
 *  text begins like (dictation lands a sentence at a time, and a pause between sends the half written). */
export function continues(m: Moment): Moment | undefined {
  const was = moments.findLast((x) => x.kind === "ask" && x.path === m.path && x.for === m.for && x.seq !== m.seq)
  if (!was || !was.text || !m.text || was.line !== m.line || m.t - was.t > 5 * 60_000) return undefined
  let n = 0
  while (n < was.text.length && was.text[n] === m.text[n]) n++
  return n >= Math.min(40, was.text.length * 0.6) ? was : undefined
}

/** Two edits in a row as one, when the second changes only lines the first wrote (or right after them); else null. */
export function mergeHunks(a: Hunk[], b: Hunk[]): Hunk[] | null {
  if (a.length !== 1 || b.length !== 1) return null
  const [x] = a, [y] = b, k = y.line - x.line
  if (k < 0 || k + y.removed.length > x.added.length) return null
  return [{ line: x.line, removed: x.removed, added: [...x.added.slice(0, k), ...y.added, ...x.added.slice(k + y.removed.length)].slice(0, 40) }]
}

/** Each agent's tint as it last had it, kept here: the same colour after a restart, whoever comes back first. */
const tintsFile = () => `${plugin.localDir()}/tints.json`
let tints: Record<string, string> | null = null
/** The agent named `name`, made the first time it acts (its tint its own from before, else the next free one: Claude
 *  orange, Codex blue, which the others take last). */
function agentOf(name: string): Agent {
  let a = agents.get(key(name))
  if (!a) {
    if (!tints) try { tints = JSON.parse(fs.readFileSync(tintsFile(), "utf8")) } catch { tints = {} }
    const used = new Set([...agents.values()].map((x) => x.tint))
    const want = tints![key(name)] ?? (isMain(name) || /claude/i.test(name) ? "orange" : /codex/i.test(name) ? "blue" : null)
    const tint = want && !used.has(want) ? want : TINTS.find((t) => !used.has(t) && t !== "orange" && t !== "blue") ?? TINTS.find((t) => !used.has(t)) ?? TINTS[agents.size % TINTS.length]
    if (tints![key(name)] !== tint) { tints![key(name)] = tint; try { fs.writeFileSync(tintsFile(), JSON.stringify(tints)) } catch { /* as it was */ } }
    const s = session(name)
    a = { name, tint, state: "watching", t: Date.now(), ...(s?.model ? { model: s.model } : {}), ...(s?.effort ? { effort: s.effort } : {}) }
    agents.set(key(name), a)
  }
  return a
}
function setAgent(name: string, change: Partial<Agent>) {
  if (change.state === "watching" || change.state === "writing" || change.state === "away") handed.delete(key(name))
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
/** Comments the user dismissed, per note, newest last: its history (kept in the sidecar too). */
const past = new Map<string, Note[]>()
const PAST = 30
const DIR = ".vaultite/plugins/companion/comments"
const sidecar = (p: string) => `${DIR}/${p}.json`
/** Each sidecar's text as last written or read: our own writes come back from the watcher. */
const written = new Map<string, string>()
const kept = (p: string) => [...notes.values()].filter((n) => n.path === p && KEPT.has(n.kind))
const lineCount = (text: string) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
const under = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`)

/** A drawing's typed actions made on its text (`draw:<ext>`, from the plugin that draws it), or null: not a drawing. */
type Draw = (text: string, actions: unknown[]) => { text: string; touched: string[] }
function drawer(p: string): Draw | null {
  const exts = p.slice(p.lastIndexOf("/") + 1).toLowerCase().split(".").slice(1)
  for (let i = 0; i < exts.length; i++) { const fn = plugin.service(`draw:${exts.slice(i).join(".")}`); if (typeof fn === "function") return fn as Draw }
  return null
}
export const drawing = (p: string) => !!drawer(p)
/** A point given (x and y, numbers), as a target's or a moment's fields. */
const point = (o: Record<string, unknown>) => (typeof o.x === "number" && typeof o.y === "number" && Number.isFinite(o.x + o.y) ? { x: Math.round(o.x), y: Math.round(o.y) } : {})

/** Write a note's sidecar as its kept items are now; none: the file goes. */
export function save(p: string) {
  const rel = sidecar(p), list = kept(p), old = past.get(p) ?? [], bare = ({ path: _, ...n }: Note) => n
  const text = list.length || old.length ? `${JSON.stringify({ comments: list.map(bare), ...(old.length ? { past: old.map(bare) } : {}) }, null, 2)}\n` : ""
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
  let list: unknown, was: unknown
  try { ({ comments: list, past: was } = text ? JSON.parse(text) : { comments: [] }) } catch { return }
  if (!Array.isArray(list)) return
  if (text) written.set(rel, text); else written.delete(rel)
  const gone = Array.isArray(was) ? was.filter((n): n is Note => n && typeof n.id === "string" && n.kind === "comment").map((n) => ({ ...n, path: p })) : []
  if (gone.length) past.set(p, gone); else past.delete(p)
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
  if (fresh) { for (const n of notes.values()) if (KEPT.has(n.kind)) notes.delete(n.id); written.clear(); past.clear() }
  const top = plugin.vault.abs(DIR)
  let files: string[] = []
  try { files = (fs.readdirSync(top, { recursive: true }) as string[]).filter((f) => f.endsWith(".json")) } catch { /* none yet */ }
  for (const f of files) {
    const p = f.split(path.sep).join("/").slice(0, -5)
    load(p)
    // (a trashed note's, once it's gone for good from the trash)
    if (p.startsWith(".trash/") && !fs.existsSync(plugin.vault.abs(p))) { for (const n of kept(p)) notes.delete(n.id); past.delete(p); save(p) } else follow(p)
  }
}

let loadedFor: Vault | null = null
plugin.onChange((paths) => {
  if (!loadedFor) return
  if (paths === null) return loadAll()
  for (const p of paths) {
    if (p.startsWith(`${DIR}/`) && p.endsWith(".json")) load(p.slice(DIR.length + 1, -5))
    else if (kept(p).length || past.has(p)) {
      if (p.startsWith(".trash/") && !fs.existsSync(plugin.vault.abs(p))) { past.delete(p); for (const n of kept(p)) dropNote(n.id); save(p) } else followSoon(p)
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
  for (const [p, list] of [...past]) {
    if (!under(p, from)) continue
    past.delete(p)
    const q = there(p)
    if (q) past.set(q, list.map((n) => ({ ...n, path: q })))
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
  } else {
    if (verdict === "dismiss" && n.kind === "comment" && n.path) past.set(n.path, [...(past.get(n.path) ?? []).filter((x) => x.id !== id), { ...n, dismissed: Date.now() }].slice(-PAST))
    dropNote(id)
  }
  addMoment({ kind: verdict, for: n.agent, item: id, path: n.path, line: n.line, text: verdict === "reply" ? text : n.text, ...(n.kind === "suggestion" ? { selection: n.find, to: n.replace } : {}) })
}

/** A dismissed comment back in the margin, as it was. */
export function reopen(id: string) {
  for (const [p, list] of past) {
    const n = list.find((x) => x.id === id)
    if (!n) continue
    const rest = list.filter((x) => x !== n)
    if (rest.length) past.set(p, rest); else past.delete(p)
    const { dismissed: _, ...back } = n
    notes.set(id, back)
    broadcast({ t: "note", note: back })
    save(p)
    return back
  }
  return null
}

/** A say the user pinned: a comment with its words, where it was said (else where its agent is, else the user). */
export function pin(id: string) {
  const s = said.find((n) => n.id === id) ?? notes.get(id)
  if (!s || s.kind !== "say" || s.pinned) return null
  const a = agents.get(key(s.agent))
  const t: Target = s.path ? s : a?.path ? a : focus() ?? {}
  if (!t.path) return null
  if (notes.has(id)) dropNote(id)
  let line = t.line ?? 1
  if (t.find) try { line = anchorLine(readText(plugin.vault.abs(t.path)), t) ?? line } catch { /* as it was said */ }
  const anchor = t.find ? "" : lineText(t.path, line)
  const c = putNote({ kind: "comment", agent: s.agent, text: s.text, path: t.path, line, ...(t.find ? { find: t.find } : {}), ...(anchor ? { anchor } : {}) })
  s.pinned = c.id
  broadcast({ t: "said", said })
  return c
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
      // (an editor left for the terminal or a menu: still their note while it's open)
      w.focus = f && typeof f.path === "string" ? { path: f.path, ...(drawing(f.path) ? point(f as Record<string, unknown>) : { line: Number(f.line) || 1 }) } : w.focus && w.open.includes(w.focus.path!) ? w.focus : null
      if (m.active) w.at = Date.now()
      // (another note, not the same one focused again)
      if (w.focus && m.active && w.focus.path !== w.was) { w.was = w.focus.path; addMoment({ kind: "open", ...w.focus }) }
    } else if (m.t === "moment" && typeof m.kind === "string" && ["ask", "point", "edit"].includes(m.kind)) {
      w.at = Date.now()
      addMoment({ kind: m.kind as Moment["kind"], for: str(m.agent) || undefined, path: str(m.path) || undefined, line: Number(m.line) || undefined, text: str(m.text) || undefined,
        selection: str(m.selection) || undefined, find: m.kind === "point" || str(m.scene) ? str(m.find).slice(0, 200) || undefined : undefined,
        hunks: Array.isArray(m.hunks) ? (m.hunks as Hunk[]).slice(0, 40) : undefined,
        ...(Number(m.waited) >= 0 ? { waited: Math.min(600_000, Math.round(Number(m.waited))) } : {}), ...point(m),
        ...(Array.isArray(m.changes) ? { changes: m.changes.map(String).slice(0, 40) } : {}), ...(str(m.scene) ? { scene: str(m.scene).slice(0, 20_000) } : {}) })
    } else if (m.t === "pin" && typeof m.id === "string") {
      pin(m.id)
    } else if (m.t === "reopen" && typeof m.id === "string") {
      reopen(m.id)
    } else if (m.t === "answer" && typeof m.id === "string" && ["accept", "reject", "dismiss", "reply"].includes(String(m.verdict))) {
      answer(m.id, m.verdict as "accept", str(m.text) || undefined)
    } else if (m.t === "done" && typeof m.rid === "string") {
      asked.get(m.rid)?.done(m.ok === true, str(m.error) || undefined, m)
    }
  })
  ws.on("close", () => windows.delete(ws))
})

// ---------- edits: typed in by the window that has the file open, else written on disk

type Edit = { path: string; find?: string; after?: string; text: string; line?: number; append?: boolean }

/** The window to type an edit in: the most recent one with the file open. */
const editorFor = (path: string) => [...windows.entries()].filter(([, w]) => w.open.includes(path)).sort((a, b) => b[1].at - a[1].at)[0]?.[0] ?? null

const turns = new Map<string, Promise<unknown>>()
/** One edit of a note at a time, typed or written: the next waits for it (two at once interleave their letters). */
function inTurn<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const run = (turns.get(path) ?? Promise.resolve()).then(fn)
  const tail = run.catch(() => {})
  turns.set(path, tail)
  void tail.then(() => { if (turns.get(path) === tail) turns.delete(path) })
  return run
}

/** Ask a window to make a change (`m`): true once it's made (`reply`: its answer), its error, false when it can't (it
 *  doesn't show the file now). No answer by `wait` ms: it may still be at it, so writing the file too would mix the two. */
async function askWindow(ws: WebSocket, m: object, wait: number, reply: Record<string, unknown> = {}) {
  const rid = `e${++nid}`
  const ok = await new Promise<boolean | string | null>((resolve) => {
    const timer = setTimeout(() => { asked.delete(rid); resolve(null) }, wait)
    asked.set(rid, { done: (ok, error, r) => { clearTimeout(timer); asked.delete(rid); Object.assign(reply, r); resolve(ok || error || false) } })
    send(ws, { ...m, rid })
  })
  if (typeof ok === "string") throw new OpError(ok, 409)
  if (ok === null) throw new OpError("the window showing it didn't say it was done: read it again before another change", 504)
  return ok
}

const applyEdit = (ctx: OpCtx, agent: Agent, e: Edit, animate = true) => inTurn(e.path, async (): Promise<"typed" | "written"> => {
  const ws = editorFor(e.path)
  if (ws && await askWindow(ws, { t: "edit", agent: agent.name, animate, ...e }, EDIT_WAIT + e.text.length * 20)) return "typed"
  const f = await ctx.api("GET", `file?path=${encodeURIComponent(e.path)}`)
  const cur = String(f.text ?? "")
  await ctx.api("PUT", "file", { path: f.path, text: editText(cur, e), base: cur })
  return "written"
})

/** `cur` with edit `e` made: `find` replaced by `text`, or `text` as new lines after the line with `after`, after `line`
 *  (0: first) or at the end. */
export function editText(cur: string, e: Omit<Edit, "path">) {
  const missing = (s: string) => new OpError(`"${cut(s, 60)}" isn't in the file: read it again (it may have changed) and copy the text exactly`)
  if (e.find) {
    const at = nearest(cur, e.find, e.line)
    if (at < 0) throw missing(e.find)
    return cur.slice(0, at) + e.text + cur.slice(at + e.find.length)
  }
  let line = e.line
  if (e.after) {
    const at = nearest(cur, e.after, e.line)
    if (at < 0) throw missing(e.after)
    line = cur.slice(0, at + e.after.length).split("\n").length
  }
  const lines = cur.split("\n")
  const n = e.append || line === undefined ? (cur.endsWith("\n") ? lines.length - 1 : lines.length) : Math.max(0, Math.min(lines.length, line))
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
// The companion's session is session.json; another agent started by name (start --as Ada) is session-ada.json.
const sessionFile = (name?: string | null) => `${plugin.localDir()}/${name && !isMain(name) ? `session-${key(name)}` : "session"}.json`
const session = (name?: string | null): { id?: string; model?: string; effort?: string } | null => { try { return JSON.parse(fs.readFileSync(sessionFile(name), "utf8")) } catch { return null } }
const sessionId = (name?: string | null): string | null => session(name)?.id ?? null
/** Every session started here: the companion's (its name) and the others'. */
function sessions(): { name: string; id: string }[] {
  let files: string[] = []
  try { files = fs.readdirSync(plugin.localDir()).filter((f) => /^session(-[\w-]+)?\.json$/.test(f)) } catch { /* none yet */ }
  return files.flatMap((f) => {
    try {
      const s = JSON.parse(fs.readFileSync(`${plugin.localDir()}/${f}`, "utf8"))
      return typeof s.id === "string" ? [{ name: f === "session.json" ? ownName() : str(s.name), id: s.id }] : []
    } catch { return [] }
  })
}
const running = async (id: string | null) => !!id && !!(await plugin.ask<boolean>("terminal:runs", false, id))
const nextCmd = (name: string) => `vau companion next --timeout 240${isMain(name) ? "" : ` --as ${name}`}`

async function start(ctx: OpCtx, as?: string, agent?: string, model?: string, effort?: string, at: Target = {}) {
  const name = as?.trim() || ownName()
  if (!/^[\w-]{1,30}$/.test(name)) throw new OpError("a name is one word (letters, digits, - or _): it's what @ calls it by")
  const was = sessionId(name)
  if (await running(was)) return { id: was!, running: true, name }
  const runs = agent || agentSetting(), id = newTerminalId(runs)
  const prompt = isMain(name) ? setting("prompt")
    : `${setting("prompt")} Your name here is ${name}: add \`--as ${name}\` to every vau companion command (\`${nextCmd(name)}\`); asks to @${key(name)} are yours.`
  // (a quicker model answers sooner: each moment is one of its turns)
  const how = howOf(runs, model, effort)
  starting(name, { ...at, model: how.model || undefined, effort: how.effort || undefined })
  try {
    await startAgent(ctx, id, prompt, { allow: ALLOW, model: how.model || null, effort: how.effort || null })
  } catch (e) { setAgent(name, { state: isMain(name) ? "watching" : "away" }); throw e }
  fs.writeFileSync(sessionFile(name), JSON.stringify({ id, name, t: Date.now(), ...(how.model ? { model: how.model } : {}), ...(how.effort ? { effort: how.effort } : {}) }))
  return { id, running: false, name, ...how }
}

/** Agent `name`'s session boots: asks to it from now on wait for its first `next`, its cursor showing it starting. */
export function starting(name: string, a: Partial<Agent> = {}) {
  const k = key(name)
  seen.set(k, Date.now()); delivered.set(k, seq); handed.delete(k); asking.delete(k)
  return setAgent(name, { ...a, state: "starting" })
}

/** End a session (the companion's by default), or every one. */
async function stop(as?: string, all = false) {
  const gone = all ? sessions() : [{ name: as?.trim() || ownName(), id: sessionId(as) ?? "" }]
  for (const s of gone) {
    try { fs.rmSync(sessionFile(s.name)) } catch { /* none */ }
    if (await running(s.id)) await plugin.runOp("terminal.end", { id: s.id })
  }
  for (const a of agents.values()) if (all || gone.some((s) => key(s.name) === key(a.name))) setAgent(a.name, { state: "away" })
  return { id: gone[0]?.id || null }
}

// A session whose turn ended stops watching: nudged back when it hasn't waited on moments for a while. Another agent
// quiet that long is away (asks to it go to the companion).
const NUDGE = 5 * 60_000
const watchdog: ReturnType<typeof setInterval> | null = setInterval(async () => {
  if (plugin.isOff() || mode() === "off") return
  // (the companion stays, but not starting forever)
  for (const a of agents.values()) if (a.state !== "away" && !live(a.name) && (!isMain(a.name) || a.state === "starting")) setAgent(a.name, { state: isMain(a.name) ? "watching" : "away" })
  for (const s of sessions()) {
    const k = key(s.name)
    if (waiters.has(k) || Date.now() - (seen.get(k) ?? loaded) < NUDGE || !(await running(s.id))) continue
    seen.set(k, Date.now())
    await plugin.runOp("terminal.send", { id: s.id, text: `Keep watching: run \`${nextCmd(s.name)}\` again, and never end your turn.` }).catch(() => {})
  }
}, 60_000)
watchdog.unref?.()

// ---------- ops

const AS = { type: "string", description: "your name in the app, when several agents keep the user company (default: the companion's, Claude)" } as const
const PATH = { type: "string", format: "path", description: "the file (Notes/Idea.md); default: the one the user is in" } as const
const LINE = { type: "integer", minimum: 0, description: "a line of it (from 1, counting its frontmatter)" } as const
const FIND = { type: "string", description: "text in that line or near it, exactly as in the file (the occurrence nearest line); on a drawing, an element's id or text" } as const
const X = { type: "number", description: "on a drawing: a point of it, with y (its units, as its elements')" } as const
const Y = { type: "number", description: "on a drawing: a point of it, with x" } as const

/** A target from params: the user's file when none is given. */
function target(p: Record<string, unknown>): Target {
  const path = str(p.path) || focus()?.path
  if (!path) throw new OpError("the user has no file open: give path")
  return { path, ...(p.line !== undefined ? { line: Number(p.line) } : {}), ...(str(p.find) ? { find: str(p.find) } : {}), ...point(p) }
}
/** What a drawing doesn't have (a margin, lines to write in): the op that does it there instead. */
function notOnDrawing(t: Target, what: string) {
  if (t.path && drawing(t.path)) throw new OpError(`${t.path} is a drawing: ${what}`)
}
/** The agent acting: --as (as it was first called), else the companion. */
const who = (p: Record<string, unknown>) => { const n = str(p.as).trim(); return n ? agents.get(key(n))?.name ?? n : ownName() }

plugin.op({
  id: "companion.next",
  cli: "companion next",
  summary: "Wait for what the user does next in the app (asks you, writes, opens a note, answers you), as the companion.",
  help: `Answers the moments since you last asked, or waits for one (up to timeout seconds; none by then: an empty list).
ask: they addressed you (@claude anywhere in a line of a note, sent at Enter or a pause; or Ask companion on a
selection): its text is what follows a leading @name, else the whole line. Always answer. edit: lines
they changed after a pause (notice and pair modes). point: they dropped your cursor on a line (and a selection):
look there and answer, as for an ask. open: the note they went to, with the next moment. reply, accept, reject, dismiss: their
answer to your comment or suggestion. Lines count from 1 with the frontmatter. Asks, replies and edits come with the note's
text around them, numbered: no need to read it again. While you wait your cursor rests; given moments, it shows you
reading (thinking, for an ask) there until you act, or run this again: the user sees a seen tick. Run it again after
acting, forever. With several agents (--as), each gets the asks to its @name and answers to its items; edit and open go
to the companion, or to an agent with --watch.

  vau companion next --timeout 240`,
  kind: "read",
  lock: false,
  params: {
    timeout: { type: "integer", minimum: 0, maximum: 240, default: 100, description: "seconds to wait for a moment" },
    after: { type: "integer", minimum: 0, description: "only moments after this one (default: after the last you were given)" },
    as: AS,
    watch: { type: "boolean", description: "also get edit and open moments (notice, pair), which only the companion gets otherwise" },
  },
  run: async (p, ctx) => {
    const name = who(p), k = key(name)
    seen.set(k, Date.now())
    if (p.watch) watching.add(k)
    else watching.delete(k)
    did(name, "next")
    const joined = !agents.has(k), a = agentOf(name)
    // (back without acting on what it was handed: it let it pass, which the user sees as a tick)
    asking.delete(k)
    if (handed.has(k)) setAgent(name, { state: "watching", seen: true })
    else if (joined || a.state === "away" || a.state === "writing" || a.state === "thinking" || a.state === "starting") setAgent(name, { state: "watching" })
    const after = p.after ?? delivered.get(k) ?? Math.max(0, seq - 20)
    const pending = () => moments.filter((m) => m.seq > after && Date.now() - m.t < 30 * 60_000 && meantFor(m, name))
    let got = pending()
    // (opens alone wait for the next moment, which they come with)
    if (got.every((m) => m.kind === "open") && p.timeout > 0) {
      waiters.get(k)?.([])
      const woken = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => { if (waiters.get(k) === wake) waiters.delete(k); resolve(false) }, p.timeout * 1000)
        const wake = (m: Moment[]) => { clearTimeout(timer); resolve(m.length > 0) }
        waiters.set(k, wake)
      })
      got = woken ? pending() : []
      seen.set(k, Date.now())
    }
    if (got.length) {
      delivered.set(k, got[got.length - 1].seq)
      // (of the notes they went to, the last one)
      got = got.filter((m, i) => m.kind !== "open" || !got.slice(i + 1).some((x) => x.kind === "open"))
      did(name, "handed", got.map((m) => m.seq))
      const at = [...got].reverse().find((m) => m.path), asked = got.some((m) => m.kind === "ask" || m.kind === "point" || m.kind === "reply")
      if (asked) asking.add(k)
      setAgent(name, { state: asked ? "thinking" : "reading",
        ...(at ? { path: at.path, line: at.line, find: at.find, x: undefined, y: undefined } : {}) })
      handed.add(k)
    }
    return { mode: mode(), focus: focus(), moments: got, cursor: delivered.get(k) ?? after, notes: await excerpts(ctx, got) }
  },
  text: (r) => momentsText(r.moments, r.mode, r.focus, r.notes),
})

/** The text around what the user asked or wrote, per note: all of a short note for an ask or a reply. */
export async function excerpts(ctx: OpCtx, ms: Moment[]) {
  const by = new Map<string, Moment[]>()
  const out: Excerpt[] = []
  // (a drawing: its scene as the window that sent the moment saw it, the last one)
  for (const m of [...ms].reverse()) if (m.path && m.scene && !out.some((e) => e.path === m.path)) out.push({ path: m.path, from: 0, to: 0, of: 0, lines: [], scene: m.scene })
  for (const m of ms) if (m.path && !m.scene && (m.kind === "ask" || m.kind === "point" || m.kind === "reply" || m.kind === "edit")) by.set(m.path, [...(by.get(m.path) ?? []), m])
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
  const head = `Mode: ${md}.${f?.path ? ` The user is in ${f.path}${f.x !== undefined ? ` at ${f.x},${f.y}` : ` at line ${f.line ?? 1}`}.` : ""}`
  if (!ms.length) return `${head}\nNothing yet: run vau companion next again.`
  const out = [head]
  for (const m of ms) {
    const at = m.path ? ` ${m.path}${m.line ? `:${m.line}` : ""}` : ""
    if (m.kind === "ask") out.push(`- ask${at}${m.scene && m.find ? ` (in ${m.find})` : ""}${m.more ? " (they went on writing it: the whole line now)" : ""}: ${JSON.stringify(m.text ?? "")}${m.selection ? `\n  on the selection: ${JSON.stringify(cut(m.selection, 2000))}` : ""}`)
    else if (m.kind === "point") out.push(`- point${at}: they pointed you here (look at this, as an ask)${m.selection ? `\n  on the selection: ${JSON.stringify(cut(m.selection, 2000))}` : ""}`)
    else if (m.kind === "edit") {
      out.push(`- edit${at}`)
      for (const c of m.changes ?? []) out.push(`  ${c}`)
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
    if (e.scene) { out.push(`${e.path}, the drawing (ids for companion draw, say --find):`, e.scene); continue }
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
  vau companion look --find "the second paragraph"
  vau companion look --path Drawings/Plan.excalidraw --find login`,
  kind: "read",
  params: { path: PATH, line: LINE, find: FIND, x: X, y: Y, as: AS },
  run: async (p) => {
    const t = target(p)
    did(who(p), "look")
    setAgent(who(p), { ...t, state: acting(who(p)), find: t.find, x: t.x, y: t.y })
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
  vau companion say "That date is a Sunday." --find "May 3"
  vau companion say "This step needs a way back." --path Drawings/Plan.excalidraw --find login`,
  kind: "read",
  params: { text: { type: "string", required: true, description: "what to say (Markdown)" }, path: PATH, line: LINE, find: FIND, x: X, y: Y, as: AS },
  args: ["text"],
  run: async (p) => {
    const name = who(p)
    did(name, "say")
    const t = p.path || p.line !== undefined || p.find || p.x !== undefined ? target(p) : {}
    setAgent(name, { ...t, ...("path" in t ? { find: t.find, x: t.x, y: t.y } : {}), state: acting(name) })
    const n = putNote({ kind: "say", agent: name, text: str(p.text), ...t }, SAY_MS)
    const mine = said.filter((x) => key(x.agent) === key(name))
    said = [...said.filter((x) => !mine.slice(0, -(SAID - 1)).includes(x)), { ...n }]
    broadcast({ t: "said", said })
    return n
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
      setAgent(name, { path: n.path, line: n.line, find: n.find, state: acting(name) })
      return n
    }
    const t = target(p)
    notOnDrawing(t, "say it by an element (companion say --find <id>), or draw a text (companion draw)")
    setAgent(name, { ...t, state: acting(name) })
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
    notOnDrawing(t, "change it with companion draw")
    did(name, "suggest")
    setAgent(name, { ...t, state: acting(name) })
    return putNote({ kind: "suggestion", agent: name, ...t, replace: str(p.replace), ...(str(p.why) ? { text: str(p.why) } : {}) })
  },
  text: (r) => `Suggested (${r.id}).`,
})

plugin.op({
  id: "companion.edit",
  cli: "companion edit",
  summary: "Write in a note: typed in before the user's eyes when it's open (they can undo it), else saved to the file.",
  help: `Only in pair mode or when they asked you to. find and text: find replaced by text. after and text: new lines after
the line with that text. Else new lines after line (0: at the top), or at the end. Prefer find or after: a line number
goes stale as they type. Edits of a note go one at a time; each returns once it's in.

  vau companion edit --path Notes/Idea.md --find "- [ ] Call Alice" --text "- [x] Call Alice"
  vau companion edit --after "## Budget" --text "- Ask Ben about the budget"`,
  kind: "write",
  lock: false,
  params: { text: { type: "string", required: true, description: "what to write" }, find: { type: "string", description: "the text it replaces, exactly as in the file" },
    after: { type: "string", description: "new lines go after the line with this text (exactly as in the file)" },
    path: PATH, line: LINE, append: { type: "boolean", description: "at the end of the file" }, as: AS },
  args: ["text"],
  run: async (p, ctx) => {
    const name = who(p), t = target(p), after = str(p.after) || undefined
    notOnDrawing(t, "change it with companion draw")
    did(name, "edit")
    const a = setAgent(name, { ...t, ...(after ? { find: after } : {}), state: "writing" })
    try {
      const how = await applyEdit(ctx, a, { path: t.path!, find: t.find, after, line: t.line, text: str(p.text), append: !!p.append })
      return { path: t.path, how }
    } finally { setAgent(name, { state: acting(name) }) }
  },
  text: (r) => `${r.how === "typed" ? "Typed into" : "Wrote"} ${r.path}.`,
})

plugin.op({
  id: "companion.highlight",
  cli: "companion highlight",
  summary: "Highlight text in a note in your colour: for a while, or kept in the file (==🟠text==) with keep; on a drawing, an element.",
  help: `  vau companion highlight --find "the budget is due Friday"
  vau companion highlight --path Notes/Idea.md --find "key insight" --keep`,
  kind: "read",
  params: { find: { ...FIND, description: "the text to highlight, exactly as in the file" }, keep: { type: "boolean", description: "keep it in the file, as a highlight of your colour" },
    path: PATH, line: LINE, as: AS },
  run: async (p, ctx) => {
    if (!str(p.find)) throw new OpError("give find: the text to highlight")
    const name = who(p), t = target(p)
    did(name, "highlight")
    if (p.keep) notOnDrawing(t, "keep is for notes; its highlight is your selection there for a while")
    const a = setAgent(name, { ...t, state: acting(name) })
    if (!p.keep) return putNote({ kind: "highlight", agent: name, ...t }, HIGHLIGHT_MS)
    await applyEdit(ctx, a, { path: t.path!, find: t.find, line: t.line, text: `==${EMOJI[a.tint] ?? ""}${t.find}==` }, false)
    return { path: t.path, kept: true }
  },
  text: (r) => (r.kept ? `Highlighted in ${r.path}.` : `Highlighted (${r.id}).`),
})

plugin.op({
  id: "companion.history",
  cli: "companion history",
  summary: "A note's margin threads: the comments in it now, and those the user dismissed (newest last).",
  kind: "read",
  params: { path: PATH },
  run: async (p) => {
    const path = target(p).path!
    return { path, open: kept(path).filter((n) => n.kind === "comment"), past: past.get(path) ?? [] }
  },
  text: (r) => [`${r.path}: ${r.open.length} open, ${r.past.length} dismissed.`,
    ...[...r.open, ...r.past].map((n: Note) => `- ${n.id}${n.dismissed ? " (dismissed)" : ""} by ${n.agent} at line ${n.line ?? "?"}: ${cut(n.text ?? "", 80)}${n.replies?.length ? ` (${n.replies.length} replies)` : ""}`)].join("\n"),
})

plugin.op({
  id: "companion.draw",
  cli: "companion draw",
  summary: "Change a drawing: add, move, change or delete its elements, drawn before the user's eyes when it's open (they can undo it), else saved to the file.",
  help: `actions: a JSON list, all checked before any is made (\`vau docs excalidraw\` has every field). Ids are in the
drawing's text (next, vau render). Only in pair mode or when they asked you to.

  vau companion draw --path Drawings/Plan.excalidraw --actions '[{"op":"add","type":"rectangle","id":"login","x":0,"y":0,"label":"Log in","fill":"blue"},
    {"op":"add","type":"arrow","from":"login","to":"home","label":"ok"}, {"op":"move","id":"home","dx":40,"dy":0},
    {"op":"change","id":"home","label":"Start"}, {"op":"delete","id":"old"}]'`,
  kind: "write",
  lock: false,
  params: { actions: { type: "array", required: true, items: { type: "object" }, description: "what to do, in order: {\"op\": \"add\" | \"move\" | \"change\" | \"delete\", ...}" },
    path: PATH, as: AS },
  run: async (p, ctx) => {
    const name = who(p), t = target(p), apply = drawer(t.path!)
    if (!apply) throw new OpError(`${t.path} isn't a drawing (a .excalidraw file, its plugin on): companion edit writes in notes`)
    did(name, "draw")
    const a = setAgent(name, { path: t.path, line: undefined, find: undefined, x: undefined, y: undefined, state: "writing" })
    try {
      return await inTurn(t.path!, async () => {
        const f = await ctx.api("GET", `file?path=${encodeURIComponent(t.path!)}`), cur = String(f.text ?? "")
        let made: ReturnType<Draw>
        try { made = apply(cur, p.actions) } catch (e) { throw new OpError((e as Error).message) }
        const ws = editorFor(t.path!), reply: { touched?: unknown } = {}
        const drawn = !!ws && await askWindow(ws, { t: "draw", agent: a.name, path: t.path, actions: p.actions }, EDIT_WAIT + p.actions.length * 300, reply)
        if (!drawn) await ctx.api("PUT", "file", { path: f.path, text: made.text, base: cur })
        const touched = drawn && Array.isArray(reply.touched) ? reply.touched.map(String) : made.touched
        if (touched.length) setAgent(name, { find: touched.at(-1) })
        return { path: t.path, how: drawn ? "drawn" : "written", touched }
      })
    } finally { setAgent(name, { state: acting(name) }) }
  },
  text: (r) => `${r.how === "drawn" ? "Drew on" : "Wrote"} ${r.path}${r.touched.length ? ` (${r.touched.join(", ")})` : ""}.`,
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
  summary: "What the companion is: its mode, its sessions, the agents in the app and what they left there.",
  kind: "read",
  params: {},
  run: async () => {
    const id = sessionId()
    const all = await Promise.all(sessions().map(async (s) => ({ ...s, running: await running(s.id) })))
    return { mode: mode(), name: ownName(), session: (await running(id)) ? id : null, windows: windows.size, focus: focus(),
      sessions: all.filter((s) => s.running).map(({ name, id }) => ({ name, id })),
      agents: [...agents.values()].map((a) => ({ ...a, live: a.state !== "away" && live(a.name), watch: isMain(a.name) || watching.has(key(a.name)) })),
      notes: [...notes.values()], moments: moments.slice(-10) }
  },
  text: (r) => [`Mode: ${r.mode}. Session: ${r.session ?? "not running"}. Windows: ${r.windows}.`,
    ...r.agents.map((a: Agent & { live: boolean }) => {
      const s = r.sessions.find((x: { name: string }) => key(x.name) === key(a.name))
      return `- ${a.name} (${a.tint})${isMain(a.name) ? ", the companion" : ""}: ${a.live || isMain(a.name) ? a.state : "away"}${a.path ? ` at ${a.path}${a.line ? `:${a.line}` : ""}` : ""}${s ? `, session ${s.id}` : ""}`
    }),
    ...r.notes.map((n: Note) => `- ${n.id} ${n.kind} by ${n.agent}${n.path ? ` in ${n.path}` : ""}: ${cut(n.text ?? n.replace ?? n.find ?? "", 80)}`)].join("\n"),
})

plugin.op({
  id: "companion.start",
  cli: "companion start",
  owner: "a coding agent",
  summary: "Start the companion's always-on session (its agent, in a terminal on this machine), or another agent's by name.",
  help: `With --as, another agent joins under that name, with its own cursor colour: @name in a note asks it (asks sent while
it starts wait for it). --model and --effort pick its model (each moment is one of its turns), for an agent that takes
them: Claude Code runs Sonnet at medium effort unless the settings say otherwise.

  vau companion start
  vau companion start --as Ada --agent codex
  vau companion start --as Quick --model haiku --effort medium`,
  kind: "write",
  lock: false,
  params: { as: { type: "string", description: "start another agent under this name (one word; default: the companion)" },
    agent: { type: "string", description: "the coding agent it runs (claude, codex, claude_personal...; default: the setting)" },
    model: { type: "string", description: "the model it runs (sonnet, haiku, a full name; default: the setting, else the agent's own)" },
    effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"], description: "its effort (default: the setting, else the agent's own)" },
    path: { type: "string", format: "path", description: "the note it was called from: its cursor waits there while it starts" }, line: LINE },
  run: async (p, ctx) => {
    if (mode() === "off") await plugin.patchSettings({ mode: "quiet" })
    const at = str(p.path) ? { path: str(p.path), ...(p.line ? { line: Number(p.line) } : {}) } : {}
    return await start(ctx, str(p.as), str(p.agent), str(p.model), str(p.effort), at)
  },
  text: (r) => `${r.running ? "Already running" : "Started"}: ${r.name}${r.model || r.effort ? ` (${[r.model, r.effort].filter(Boolean).join(", ")})` : ""} in ${r.id} (vau terminal screen ${r.id}).`,
})

plugin.op({
  id: "companion.stop",
  cli: "companion stop",
  owner: "the terminal",
  summary: "End the companion's session (or another agent's, by name); its cursor goes away until it starts again.",
  kind: "write",
  lock: false,
  params: { as: { type: "string", description: "the agent started with start --as (default: the companion)" }, all: { type: "boolean", description: "every session" } },
  run: async (p) => await stop(str(p.as), !!p.all),
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

/** A moment's latency (ms): the user's pause before the app sent it, until next handed it (handoff), then to the agent's first action (think), and from the moment
 *  to its next `next` (total); undefined when it didn't happen. */
export type Timing = { t: number; seq: number; kind: string; at: string; as?: string; op?: string; pause?: number; handoff?: number; think?: number; total?: number }

/** Each moment's timing per agent handed it, from the moments and actions logged on a day (seqs restart with the
 *  server: matched in time). */
export function timings(ms: Moment[], log: Act[]): Timing[] {
  return ms.flatMap((m, i) => {
    const until = ms.slice(i + 1).find((x) => x.seq === m.seq)?.t ?? Infinity
    const r: Timing = { t: m.t, seq: m.seq, kind: m.kind, at: m.path ? `${m.path}${m.line ? `:${m.line}` : ""}` : "", ...(m.waited !== undefined ? { pause: m.waited } : {}) }
    const hands = log.flatMap((a, hi) => (a.op === "handed" && a.t >= m.t && a.t < until && a.seqs?.includes(m.seq) ? [hi] : []))
      .filter((hi, k, all) => all.findIndex((x) => log[x].as === log[hi].as) === k)
    if (!hands.length) return [r]
    return hands.map((hi) => {
      const h = log[hi], after = log.slice(hi + 1).filter((a) => a.as === h.as)
      const done = after.find((a) => a.op === "next"), first = after.find((a) => a.op !== "next" && a.op !== "handed" && (!done || a.t <= done.t))
      return { ...r, as: h.as, handoff: h.t - m.t, ...(first ? { op: first.op, think: first.t - h.t } : {}), ...(done ? { total: done.t - m.t } : {}) }
    })
  })
}

export function timingsText(day: string, rows: Timing[]) {
  const s = (ms?: number) => (ms === undefined ? "-" : (ms / 1000).toFixed(1)).padStart(7)
  const time = (t: number) => new Date(t).toTimeString().slice(0, 8)
  const pct = (xs: number[], q: number) => xs.sort((a, b) => a - b)[Math.max(0, Math.ceil(q * xs.length) - 1)]
  const sum = (label: string, rs: Timing[]) => `${label} (${rs.length}): ${(["pause", "handoff", "think", "total"] as const).map((k) => {
    const xs = rs.flatMap((r) => r[k] ?? [])
    return `${k} ${xs.length ? `${s(pct(xs, 0.5)).trim()}/${s(pct(xs, 0.9)).trim()}` : "-"}`
  }).join(", ")} (median/p90, s)`
  if (!rows.length) return `No moments on ${day}.`
  return [`${day}, in seconds: pause (the user's, before the app sent it), handoff (until next handed it), think (to the first action), total (to the next \`next\`).`,
    `${"time".padEnd(8)} ${"pause".padStart(7)} ${"handoff".padStart(7)}${"think".padStart(7)}  ${"total".padStart(7)}  moment`,
    ...rows.map((r) => `${time(r.t)} ${s(r.pause)} ${s(r.handoff)}${s(r.think)}  ${s(r.total)}  ${r.as ? `${r.as}: ` : ""}${r.kind}${r.op ? ` -> ${r.op}` : ""} ${cut(r.at, 50)}`),
    sum("asks and replies", rows.filter((r) => r.kind === "ask" || r.kind === "reply")), sum("all", rows),
    // (each agent's own, to compare models)
    ...(new Set(rows.flatMap((r) => r.as ?? [])).size > 1 ? [...new Set(rows.flatMap((r) => r.as ?? []))].map((a) => sum(a, rows.filter((r) => r.as === a))) : [])].join("\n")
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

/** The sessions still running when the server starts (a restart, an update): back in the app at once, so @name
 *  reaches them while they finish what they were doing, before their next `next`. */
async function rejoin() {
  for (const x of sessions()) {
    if (agents.has(key(x.name)) || !(await running(x.id).catch(() => false))) continue
    seen.set(key(x.name), Date.now())
    setAgent(x.name, { state: "watching" })
  }
}

let lastSaid = ""
plugin.onSync((vault) => {
  if (loadedFor !== vault) {
    loadedFor = vault
    loadAll(true)
    // (again a moment later: Terminal may not have started yet)
    void rejoin(); setTimeout(() => void rejoin(), 5000).unref?.()
  }
  const now = JSON.stringify([mode(), ownName(), howOf(agentSetting())])
  if (now === lastSaid) return
  // (turned off: its session ends too)
  if (lastSaid && mode() === "off") void stop(undefined, true).catch(() => {})
  lastSaid = now
  broadcast(snapshot())
})
