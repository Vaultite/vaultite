// Companion: one always-on agent session that watches the user write and answers in the app (its cursor, bubbles,
// margin comments, suggestions, edits typed in). Comments and suggestions are kept in a sidecar per note; the rest is live.
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import path from "node:path"
import { type RawData, WebSocket } from "ws"
import { type AgentMeter, type AgentModels, agentIn, agentName, findBin, KNOWN_AGENTS, newTerminalId, parseTerminal, startAgent } from "../../../core/agents.ts"
import { liveMarkdown, localDate, type OpCtx, OpError, Plugin, vaultPath, type Who, whoOf } from "../../../core/plugins.ts"
import { readText, type Vault, writeAtomic } from "../../../core/vault.ts"
import { parseProfiles, type Profile, profileOf } from "./profiles.ts"
import { bridges } from "./bridge.ts"
import { rooms } from "./rooms.ts"
import { type Hunk, nearest } from "./text.ts"
export { nearest } // (its tests reach it through the plugin)

export const plugin = new Plugin(import.meta.url)

export type Mode = "off" | "quiet" | "notice" | "pair"
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
 *  starting: its session boots (asks wait for its first `next`); runs (claude, codex), model, effort; asks: a permission. */
export type Agent = Target & { name: string; tint: string; state: "watching" | "reading" | "thinking" | "writing" | "starting" | "away"; t: number; seen?: boolean
  runs?: string; model?: string; effort?: string; asks?: { event: string; text: string } }
/** What an agent leaves in the app: words by its cursor (say, gone after a while), a margin comment, a suggested change,
 *  a highlight (gone after a while). `anchor`: a comment's line as it read, to find it again without `find`. */
export type Note = Target & { id: string; kind: "say" | "comment" | "suggestion" | "highlight"; agent: string; t: number
  text?: string; replace?: string; anchor?: string; replies?: Reply[]
  /** A thread a person started, not an agent: the user, or a shared folder's guest (`agent` is then their name). */
  by?: "user" | "guest"
  /** The agent a person's thread asks (an @name in it): it hears the thread's words and answers in it. */
  ask?: string
  /** A person's colour (a token), where an agent's is its own; a guest's share (its id). */
  tint?: string; share?: string
  /** A say the user pinned: the comment it became. */
  pinned?: string
  /** A comment the user dismissed, when: kept in its note's history. */
  dismissed?: number
  /** The text it was on is gone: shown by its last line, found again if the text comes back. */
  orphaned?: boolean }
/** A word in a thread: the user's, an agent's, or a guest's (`name`: the guest's, or the agent's in a person's thread); when
 *  (older ones have none). */
export type Reply = { by: "user" | "agent" | "guest"; text: string; name?: string; t?: number }
/** What an agent did when (logged, for timings): called next, was handed moments (seqs), or acted (say, edit...). */
export type Act = { t: number; as: string; op: string; seqs?: number[] }
/** A note's lines from..to (1-based, of `of`), sent with the moments in it; a drawing's scene as text. */
export type Excerpt = { path: string; from: number; to: number; of: number; lines: string[]; scene?: string }

const TINTS = ["orange", "blue", "purple", "green", "red", "yellow"]
const EMOJI: Record<string, string> = { red: "🔴", orange: "🟠", yellow: "🟡", green: "🟢", blue: "🔵", purple: "🟣" }
const KEEP = 300, SAY_MS = 12_000, HIGHLIGHT_MS = 10_000, EDIT_WAIT = 10_000, SAVED_MS = 3000

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
const ownName = () => str(plugin.settings().name).trim() || nameOf(agentSetting())
const nameOf = (agent: string) => {
  const base = agent.split("_")[0]
  return base === "claude" ? "Claude" : agentName(base) ?? base.charAt(0).toUpperCase() + base.slice(1)
}
/** The names that pick an agent: the manifest's, then the user's lines. */
const profiles = () => parseProfiles([plugin.manifest.settings?.profiles?.default, plugin.settings().profiles].flatMap((v) => (Array.isArray(v) ? v : [])))
/** A profile's agent in the companion's account (claude_work) when it's the same agent. */
const inAccount = (agent: string) => (agent && agent === agentSetting().split("_")[0] ? agentSetting() : agent)
/** What agent `name` runs, filled in where it isn't told: as its last session did (started again), else its profile
 *  (its name's first part), else the settings. */
export function howFor(name: string, agent = "", model = "", effort = "") {
  const kept = isMain(name) ? null : session(name), ran = kept ? runsOf(kept) : ""
  let base: Partial<Profile> = ran ? { agent: ran, model: kept!.model, effort: kept!.effort } : isMain(name) ? {} : profileOf(name, profiles()) ?? {}
  if (agent && agent !== base.agent) base = {}
  const runs = agent || inAccount(base.agent ?? "") || agentSetting()
  return { agent: runs, ...howOf(runs, model || base.model, effort || base.effort) }
}
/** Programs whose name isn't their agent's. */
const BIN: Record<string, string> = { cursor: "cursor-agent" }
let found: { t: number; off: string; list: { id: string; name: string; installed: boolean; models: AgentModels["models"]; efforts: string[] }[] } | null = null
/** The coding agents a plugin that's on runs, whether they're installed here, and their models. */
function harnesses() {
  const off = [...plugin.vault.switchedOff()].join()
  if (found && found.off === off && Date.now() - found.t < 60_000) return found.list
  const list = KNOWN_AGENTS.flatMap((a) => {
    const id = a.terminal ?? a.id
    if (typeof plugin.service(`agent:${id}`) !== "function") return []
    let m: AgentModels | null = null
    try { m = plugin.service(`agent-models:${id}`)?.() ?? null } catch { /* none */ }
    return [{ id, name: a.name, installed: !!findBin(BIN[id] ?? id), models: m?.models ?? [], efforts: m?.efforts ?? [] }]
  })
  found = { t: Date.now(), off, list }
  return list
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
const ends = new Map<string, number>() // agent -> how many times its session ended (a `next` waiting through one returns)
const dead = new Set<string>() // terminals whose session ended: a call still on its way from one brings no one back
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
  if (op !== "next" && op !== "handed" && op !== "done") handed.delete(key(as))
}
/** An agent's state once it acted: still thinking while busy on an ask (until its next `next`), else watching. */
const acting = (name: string): Agent["state"] => (asking.has(key(name)) ? "thinking" : "watching")

/** The app's windows: which files each has open, where its user is, when they last did anything. */
type Win = { open: string[]; focus: Target | null; at: number; was?: string }
const windows = new Map<WebSocket, Win>()
/** A guest's view of the threads: `see` gives their name for a vault path in their folder (else null), `at` the vault
 *  path for theirs (throws outside it); `said`: true once they have said too much this minute. */
export type Guest = { id: string; name: string; who: Who; role: "read" | "comment" | "edit"; see: (rel: string) => string | null; at: (p: string) => string; said: () => boolean
  /** Whether the share still holds (not revoked nor expired). */
  holds: () => boolean
  /** Why a change of theirs to a note can't land, and whether they're typing too fast (the share's rules). */
  may: (rel: string, before: string, after: string) => string; slow: () => boolean
  /** When the folder was shared with them: the user's threads from before it stay the user's. */
  since: number }
const guests = new Map<WebSocket, Guest>()
/** The most a person's comment or reply keeps; a guest's threads in a note, and words in a thread. */
const MAX_TEXT = 4000, MAX_THREADS = 100, MAX_REPLIES = 100
const asked = new Map<string, { done: (ok: boolean, error?: string, reply?: Record<string, unknown>) => void }>()

const send = (ws: WebSocket, m: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }
const broadcast = (m: object) => {
  const text = JSON.stringify(m)
  for (const ws of windows.keys()) if (ws.readyState === ws.OPEN) ws.send(text)
  for (const [ws, g] of guests) if (ws.readyState === ws.OPEN) toGuest(ws, g, m as { t: string; note?: Note; id?: string })
}
// (fresh: what a new agent started from the app runs, profiles what the names that pick one start, harnesses what can run)
const snapshot = () => ({ t: "state", mode: mode(), name: ownName(), agents: [...agents.values()], notes: [...notes.values()], said, ...offers() })
function offers() {
  const named = Object.entries(offered()).map(([name, p]) => [name, { agent: p.agent, ...howOf(p.agent, p.model, p.effort) }])
  return { fresh: { agent: agentSetting(), ...howOf(agentSetting()) }, profiles: Object.fromEntries(named), harnesses: harnesses() }
}
/** The profiles of agents installed here, and of the companion's own agent (in its account). */
function offered() {
  const here = harnesses(), on = (agent: string) => here.some((h) => h.id === agent.split("_")[0] && (h.installed || h.id === agentSetting().split("_")[0]))
  return Object.fromEntries(Object.entries(profiles()).flatMap(([name, p]) => (on(p.agent) ? [[name, { ...p, agent: inAccount(p.agent) }]] : [])))
}

const key = (name: string) => name.trim().toLowerCase()
const isMain = (name: string) => key(name) === key(ownName())
/** An agent still around: waiting for moments, or it waited a moment ago; a chat session's, while it's kept. */
const live = (name: string) => waiters.has(key(name)) || Date.now() - (seen.get(key(name)) ?? 0) < LIVE_MS || isChat(sessionId(name))
/** Who an ask to @name is for: that agent when it's around; the companion by its names (@companion, @claude when it
 *  runs Claude Code); one with a profile (@opus-review) or a session before, itself, to start; else the companion. */
function addressee(name?: string) {
  const a = name ? agents.get(key(name)) : undefined
  if (!name || (a && a.state !== "away" && live(a.name))) return a?.name ?? ownName()
  if (isMain(name) || key(name) === "companion" || key(name) === key(nameOf(agentSetting()))) return ownName()
  return session(name) || profileOf(name, offered()) ? a?.name ?? nameOf(key(name)) : ownName()
}
/** Whether `name` gets moment `m`: its own, and edit and open for the companion and agents that watch. */
const meantFor = (m: Moment, name: string) => (m.for ? key(m.for) === key(name) : isMain(name) || watching.has(key(name)))

/** Where the user is: the window they used last that has a note (`next`, and the ops' default place, both say this). */
export const focus = () => [...windows.values()].sort((a, b) => b.at - a.at).find((w) => w.focus)?.focus ?? null

/** Take in a moment from the app: kept (and logged), and given to the agents waiting. `from`: the window's request, which
 *  starts the companion's session when an ask finds it not running. */
export function addMoment(m: Omit<Moment, "seq" | "t"> & { t?: number }, from?: IncomingMessage) {
  const md = mode()
  if (md === "off") return null
  // (a line a shared folder's guest wrote is never the user's ask, whoever's window sends it)
  if (m.kind === "ask" && m.path && m.line && plugin.service("provenance:by-guest")?.(m.path, m.line) === true) return null
  if ((m.kind === "edit" || m.kind === "open") && md === "quiet") return null
  // (spaces alone changed, as a trailing one: nothing to see, and an agent woken for it isn't free for what is)
  const words = (ls: string[]) => ls.map((l) => l.trim()).filter(Boolean).join("\n")
  if (m.kind === "edit" && m.hunks?.length && m.hunks.every((h) => words(h.added) === words(h.removed))) return null
  const full = { ...m, seq: ++seq, t: m.t ?? Date.now() } as Moment
  if (m.kind === "edit" || m.kind === "open") delete full.for
  else full.for = addressee(m.for)
  // (an ask already asked, as it reads, a while ago: a line asked again by Enter on it, after a restart too)
  if (m.kind === "ask" && !m.item && log.read(localDate(full.t)).some((x) => x.kind === "ask" && x.for === full.for && x.path === full.path && x.text === full.text && full.t - x.t < 2 * 3600_000)) return null
  log.append(full.t, [full])
  // (more of the same lines before any agent saw the last: one moment)
  const last = moments[moments.length - 1]
  const merged = m.kind === "edit" && last?.kind === "edit" && last.path === m.path && ![...delivered.values()].some((d) => d >= last.seq) ? mergeHunks(last.hunks ?? [], m.hunks ?? []) : null
  if (merged) { Object.assign(last, { hunks: merged, t: full.t }); return last }
  const was = m.kind === "ask" && !m.item ? continues(full) : undefined
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
  } else {
    for (const [k, wake] of waiters) if (meantFor(full, k)) { waiters.delete(k); wake([full]) }
    for (const s of sessions()) if (isChat(s.id) && meantFor(full, s.name)) void pump(s.name)
  }
  // (one starting shows that until its first `next` takes it)
  if (full.for && (m.kind === "ask" || m.kind === "point" || m.kind === "reply") && agents.get(key(full.for))?.state !== "starting") {
    setAgent(full.for, { state: "thinking", ...(m.path ? { path: m.path, line: m.line, find: m.find, x: undefined, y: undefined } : {}) })
    if (from) void wake(full, from)
  }
  return full
}

const waking = new Set<string>()
/** An ask to an agent whose session isn't running (ended, or never started: @opus) starts it, the ask waiting for its
 *  first `next`; one running that stopped watching is nudged. As the window's request: only this machine's owner starts. */
async function wake(m: Moment, from: IncomingMessage) {
  const name = m.for!, k = key(name), id = sessionId(name)
  // (another around has a session, or joined from one of its own, as the companion run by hand: the ask waits for its next)
  if (waiters.has(k) || waking.has(k) || (live(name) && (!isMain(name) || !id))) return
  if (await running(id)) return void (isMain(name) || isChat(id) || nudge(name, id!))
  waking.add(k)
  try { await plugin.runOp("companion.start", { ...(isMain(name) ? {} : { as: name }), ...(m.path ? { path: m.path, line: m.line } : {}), after: m.seq - 1 }, undefined, from) }
  catch (e) {
    setAgent(name, { state: "watching" })
    putNote({ kind: "say", agent: name, text: `I couldn't start: ${(e as Error).message}`, ...(m.path ? { path: m.path, line: m.line } : {}) }, SAY_MS)
  } finally { waking.delete(k) }
}

/** The ask `m` goes on from: the last to the same agent on that line of that note, a few minutes ago, which `m`'s
 *  text begins like (dictation lands a sentence at a time, and a pause between sends the half written). */
function continues(m: Moment): Moment | undefined {
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
 *  Code's orange, Codex's blue, which the others take last). */
function agentOf(name: string): Agent {
  let a = agents.get(key(name))
  if (!a) {
    if (!tints) try { tints = JSON.parse(fs.readFileSync(tintsFile(), "utf8")) } catch { tints = {} }
    const used = new Set([...agents.values()].map((x) => x.tint))
    const s = session(name), runs = (s && runsOf(s)) || (isMain(name) ? agentSetting() : profileOf(name, offered())?.agent ?? "")
    const want = tints![key(name)] ?? ({ claude: "orange", codex: "blue" } as Record<string, string>)[runs.split("_")[0]] ?? null
    const tint = want && !used.has(want) ? want : TINTS.find((t) => !used.has(t) && t !== "orange" && t !== "blue") ?? TINTS.find((t) => !used.has(t)) ?? TINTS[agents.size % TINTS.length]
    if (tints![key(name)] !== tint) { tints![key(name)] = tint; try { fs.writeFileSync(tintsFile(), JSON.stringify(tints)) } catch { /* as it was */ } }
    a = { name, tint, state: "watching", t: Date.now(), ...(runs ? { runs } : {}), ...(s?.model ? { model: s.model } : {}), ...(s?.effort ? { effort: s.effort } : {}) }
    agents.set(key(name), a)
  }
  return a
}
/** The agent whose session runs in app terminal `terminal`, as Provenance names who wrote a line: its name, colour,
 *  and the model and effort it was started with; null when it's no companion's. */
plugin.provide("companion:who", (terminal: string) => {
  const s = sessions().find((x) => x.id === terminal)
  if (!s) return null
  const kept = session(s.name), a = agentOf(s.name)
  return { name: a.name, tint: a.tint, ...(kept?.model ? { model: kept.model } : {}), ...(kept?.effort ? { effort: kept.effort } : {}) }
})

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
/** Whether `id` is a thread a person started (the user's, a guest's). */
const personThread = (id: string) => !!notes.get(id)?.by
function dropNote(id: string) {
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

/** A note's kept items found again in its text: a comment whose text is gone stays by its last line, orphaned, a
 *  suggestion goes. */
function follow(p: string) {
  const list = kept(p)
  let text: string
  try { text = readText(plugin.vault.abs(p)) } catch { return }
  let changed = false
  for (const n of list) {
    const found = anchorLine(text, n)
    if (found === null && n.kind !== "comment") { notes.delete(n.id); broadcast({ t: "drop", id: n.id }); changed = true; continue }
    const line = found ?? Math.max(1, Math.min(n.line ?? 1, lineCount(text)))
    if (line === n.line && !n.orphaned === (found !== null)) continue
    n.line = line
    if (found === null) n.orphaned = true; else delete n.orphaned
    broadcast({ t: "note", note: n })
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
export function answer(id: string, verdict: "accept" | "reject" | "dismiss" | "reply", text?: string, from?: IncomingMessage) {
  const n = notes.get(id)
  if (!n) return
  if (verdict === "reply" && text) {
    n.replies = [...(n.replies ?? []), { by: "user", text: text.slice(0, MAX_TEXT), t: Date.now() }]
    broadcast({ t: "note", note: n })
    if (KEPT.has(n.kind) && n.path) save(n.path)
  } else {
    if (verdict === "dismiss" && n.kind === "comment" && n.path) past.set(n.path, [...(past.get(n.path) ?? []).filter((x) => x.id !== id), { ...n, dismissed: Date.now() }].slice(-PAST))
    dropNote(id)
  }
  // (a person's thread is between people, unless it asks an agent: then that agent hears the words in it)
  if (n.by) {
    const to = n.by === "user" && verdict === "reply" && text ? mentioned(text) ?? n.ask : undefined
    if (!to) return
    if (n.ask !== to) { n.ask = to; save(n.path!) }
    return void addMoment({ kind: "reply", for: to, item: id, path: n.path, line: lineOf(n), text }, from)
  }
  addMoment({ kind: verdict, for: n.agent, item: id, path: n.path, line: n.line, text: verdict === "reply" ? text : n.text, ...(n.kind === "suggestion" ? { selection: n.find, to: n.replace } : {}) }, from)
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
  clearInterval(watchdog)
  unhear?.()
  unhear = null
})

// ---------- the app's windows: /api/companion/live

/** Notes open in windows, typed in together (rooms.ts). */
const co = rooms(plugin)
plugin.onChange((paths) => co.changed(paths))
/** The user as others in a note see them (never this machine's login name). */
const OWNER = "Owner"
const YOU: Who = { client: "app/web", agent: null, label: "You", source: "app" }
/** A note a window names, as the vault's path (`./a.md` is `a.md`), or null. */
const notePath = (p: unknown) => { try { return vaultPath(p, false, plugin.vault) } catch { return null } }

/** Notes another machine of the vault shares typed in there, with its guests (bridge.ts). */
const there = bridges(plugin, (ws, m, path) => void co.heard(ws, m, path))
plugin.onUnload(() => there.stop())
const roomMessage = (m: Record<string, unknown>) => typeof m.t === "string" && (m.t.startsWith("y") || m.t === "aw")

plugin.socket("companion/live", (ws, req, { query }) => {
  co.add(ws, { who: YOU, name: OWNER, tint: "red", edits: true, see: (rel) => rel })
  // (another machine's server, for its windows: only the rooms, and never sent on again)
  if (query.rooms === "1") {
    ws.on("message", (data: RawData) => {
      let m: Record<string, unknown>
      try { m = JSON.parse(String(data)) } catch { return }
      if (roomMessage(m)) co.heard(ws, m, notePath(m.path))
    })
    return
  }
  windows.set(ws, { open: [], focus: null, at: 0 })
  there.add(ws)
  send(ws, snapshot())
  ws.on("message", (data: RawData) => {
    let m: Record<string, unknown>
    try { m = JSON.parse(String(data)) } catch { return }
    if (roomMessage(m)) {
      const path = notePath(m.path)
      if (path && /\.md$/i.test(path) && there.heard(ws, m, path)) return
      if (co.heard(ws, m, path)) return
    }
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
        ...(Array.isArray(m.changes) ? { changes: m.changes.map(String).slice(0, 40) } : {}), ...(str(m.scene) ? { scene: str(m.scene).slice(0, 20_000) } : {}) }, req)
    } else if (m.t === "pin" && typeof m.id === "string") {
      pin(m.id)
    } else if (m.t === "reopen" && typeof m.id === "string") {
      reopen(m.id)
    } else if (m.t === "answer" && typeof m.id === "string" && ["accept", "reject", "dismiss", "reply"].includes(String(m.verdict))) {
      answer(m.id, m.verdict as "accept", str(m.text) || undefined, req)
    } else if (m.t === "comment") {
      const c = personComment({ by: "user", agent: "" }, str(m.path), m), to = c && mentioned(c.text!)
      if (c && to) askIn(c, to, str(m.selection).slice(0, 20_000), req)
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

// Its edits are its in History and Review: the text before is kept as a version, and the app's save of what it typed
// is Activity's as that agent's (the op's own event names it too: `did`'s by).
const applyEdit = (ctx: OpCtx, agent: Agent, e: Edit, animate = true) => inTurn(e.path, async (): Promise<"typed" | "written"> => {
  await plugin.ask("history:keep", false, e.path)
  const ws = editorFor(e.path)
  if (ws) {
    let was: string | null = null
    try { was = readText(plugin.vault.abs(e.path)) } catch { /* a drawing's, or gone */ }
    const wait = EDIT_WAIT + e.text.length * 20
    await plugin.ask("activity:typing", false, e.path, agent.name, wait + SAVED_MS)
    let typed = false, late = false
    try { typed = await askWindow(ws, { t: "edit", agent: agent.name, animate, ...e }, wait) } catch (err) { late = (err as OpError).status === 504; throw err } finally {
      // (typed, or maybe still typing: its save lands within a moment of the window's autosave)
      await plugin.ask("activity:typing", false, e.path, agent.name, typed || late ? SAVED_MS : 0)
    }
    if (typed) {
      // (the app saves what it typed, as the user's: who wrote those lines is said here, for Provenance)
      if (was !== null && !drawing(e.path)) try { await plugin.ask("provenance:wrote", null, e.path, was, editText(was, e)) } catch { /* not in the file as saved */ }
      return "typed"
    }
  }
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

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
/** Line `n` (from 1) of a file, trimmed: "" when it can't be read. */
const lineText = (p: string, n: number) => { try { return readText(plugin.vault.abs(p)).split("\n")[n - 1]?.trim() ?? "" } catch { return "" } }

// ---------- the always-on session

/** What its session runs unasked: its own commands and reading the vault. */
const ALLOW = ["vau companion", "vau docs", "vau read", "vau search", "vau render", "vau links", "vau context", "vau tasks", "vau dataview"]
// The companion's session is session.json; another agent started by name (start --as Ada) is session-ada.json.
const sessionFile = (name?: string | null) => `${plugin.localDir()}/${name && !isMain(name) ? `session-${key(name)}` : "session"}.json`
/** A session as kept: its terminal, its model, and how many moments it was handed (a fresh one takes over past
 *  fresh_after). */
type Session = { id: string; name: string; t: number; model?: string; effort?: string; handed?: number
  /** A chat session's agent (claude, claude_work): a terminal's id says it. */
  runs?: string }
const session = (name?: string | null): Session | null => {
  try { const s = JSON.parse(fs.readFileSync(sessionFile(name), "utf8")); return typeof s.id === "string" ? s : null } catch { return null }
}
const writeSession = (s: Session) => fs.writeFileSync(sessionFile(s.name), JSON.stringify(s))
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
/** Whether a session runs: a terminal's while it does, a chat session's while it's kept (its process, ended when idle a
 *  while, comes back with the next message). */
const running = async (id: string | null) => !!id && (isChat(id) ? sessions().some((s) => s.id === id) : !!(await plugin.ask<boolean>("terminal:runs", false, id)))
/** A Claude Code session the chat host runs (its id a UUID), not a terminal ("claude-ab12cd34"). */
const isChat = (id: string | null | undefined) => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
/** The agent a session runs (claude_work, codex). */
function runsOf(s: Session) {
  if (isChat(s.id)) return s.runs || "claude"
  const t = parseTerminal(s.id)
  return t ? agentIn(t.agent, t.profile) : ""
}
const nextCmd = (name: string) => `vau companion next --timeout 240${isMain(name) ? "" : ` --as ${name}`}`

async function start(ctx: OpCtx, as?: string, agent?: string, model?: string, effort?: string, at: Target = {}, after?: number) {
  const name = as?.trim() || ownName()
  if (!/^[\w-]{1,30}$/.test(name)) throw new OpError("a name is one word (letters, digits, - or _): it's what @ calls it by")
  const was = sessionId(name)
  if (await running(was)) return { id: was!, running: true, name }
  // (a quicker model answers sooner: each moment is one of its turns)
  const how = howFor(name, agent, model, effort), runs = how.agent
  if (onChat(runs)) return await startChat(name, how, at, after)
  const id = newTerminalId(runs), prompt = promptFor(name)
  starting(name, { ...at, runs, model: how.model || undefined, effort: how.effort || undefined }, after)
  try {
    await startAgent(ctx, id, prompt, { allow: ALLOW, model: how.model || null, effort: how.effort || null })
  } catch (e) { seen.delete(key(name)); setAgent(name, { state: isMain(name) ? "watching" : "away" }); throw e }
  writeSession({ id, name, t: Date.now(), ...(how.model ? { model: how.model } : {}), ...(how.effort ? { effort: how.effort } : {}), handed: 0 })
  return { id, running: false, name, ...how }
}

/** Agent `name`'s session boots: asks to it from now on (or after moment `after`) wait for its first `next`, its cursor
 *  showing it starting. */
export function starting(name: string, a: Partial<Agent> = {}, after = seq) {
  const k = key(name)
  seen.set(k, Date.now()); delivered.set(k, Math.min(after, seq)); handed.delete(k); asking.delete(k)
  return setAgent(name, { ...a, state: "starting" })
}

/** What a session is told it is: the setting's prompt, how moments reach it (a chat session's messages, a terminal's
 *  loop of next), and its name when it isn't the companion. */
const promptFor = (name: string, chat = false) => [setting("prompt"), chat ? CHAT_WORDS : LOOP_WORDS(name),
  isMain(name) ? "" : chat ? `Your name here is ${name}: asks to @${key(name)} are yours.` : `Your name here is ${name}: add \`--as ${name}\` to every vau companion command (\`${nextCmd(name)}\`); asks to @${key(name)} are yours.`].filter(Boolean).join(" ")
const LOOP_WORDS = (name: string) => `Then loop and never stop: run \`${nextCmd(name)}\` (give that command a timeout of 250 seconds or more), which waits for what they do and shows the note's lines around it (no need to read the note again), then act on it with \`vau companion look|say|comment|suggest|edit|highlight\`, then run next again. Never end your turn.`
const CHAT_WORDS = "What the user does comes to you as messages (moments, with the note's lines around them: no need to read the note again). Act on them with your vaultite-app tools (say, comment, suggest, edit, look, highlight, draw...), not vau companion commands, then end your turn: what they do next comes as your next message. Never wait or poll for moments."

// ---------- a fresh session: one that has handled many moments (or read much context) hands over to a new one

const FRESH_TOKENS = 150_000, FRESH_SHARE = 0.6, ASK_AGAIN = 60_000, HANDOVER_WAIT = 3 * 60_000, OLD_ENDS = 15_000, METER_EVERY = 5 * 60_000
const freshAfter = () => Number(plugin.settings().fresh_after) || Number(plugin.manifest.settings?.fresh_after?.default) || 150
/** When each agent was asked to hand over (it summarizes, then `handover`). */
const handing = new Map<string, number>()
/** Agents the user asked for a fresh session (Start fresh): asked to hand over at their next `next`. */
const fresh = new Set<string>()
const metered = new Map<string, number>() // session -> when its context was last read (its agent scans processes)

/** Whether a session is due for a fresh one: past fresh_after moments, or its context (when its agent says) past
 *  FRESH_TOKENS or FRESH_SHARE of its window. */
async function due(s: Session) {
  if ((s.handed ?? 0) >= freshAfter()) return true
  // (a chat session compacts its context itself)
  if (isChat(s.id) || Date.now() - (metered.get(s.id) ?? 0) < METER_EVERY) return false
  metered.set(s.id, Date.now())
  const agent = parseTerminal(s.id)?.agent
  const meters = agent ? await plugin.ask<AgentMeter[]>(`agent-meters:${agent}`, [], true).catch(() => []) : []
  const m = Array.isArray(meters) ? meters.find((x) => x.terminal === s.id) : undefined
  return !!m?.tokens && m.tokens >= Math.min(FRESH_TOKENS, (m.window || Infinity) * FRESH_SHARE)
}

/** What a fresh session is told after its prompt: the last one's summary, its open threads and the user's last asks. */
export function handoverText(name: string, summary: string, items: Note[], asks: Moment[], chat = false) {
  const open = items.filter((n) => !n.by && key(n.agent) === key(name) && KEPT.has(n.kind)).slice(-20)
  const last = (n: Note) => n.replies?.at(-1)
  return [`This session continues an earlier one of yours that grew long. The user sees no change: don't greet them or say you're new. ${chat ? "Read `vau docs companion`, then end your turn: their next moments come as your messages" : `Read \`vau docs companion\`, then run \`${nextCmd(name)}\` at once`} (ME.md when a moment needs it).`,
    summary.trim() ? `What your last session handed over:\n${summary.trim()}` : "",
    open.length ? `Your open threads (reply with ${chat ? "your comment tool and its id" : "`vau companion comment --id <id>`"}):\n${open.map((n) => `- ${n.id} ${n.kind} in ${n.path}${n.line ? `:${n.line}` : ""}${n.orphaned ? " (its text is gone)" : ""}: ${JSON.stringify(cut(n.text ?? n.replace ?? "", 160))}${last(n) ? `; last, ${last(n)!.by === "user" ? "the user" : "you"}: ${JSON.stringify(cut(last(n)!.text, 160))}` : ""}`).join("\n")}` : "",
    asks.length ? `The user's last asks:\n${asks.map((m) => `- ${m.path ?? ""}${m.line ? `:${m.line}` : ""} ${JSON.stringify(cut(m.text ?? "", 160))}`).join("\n")}` : ""].filter(Boolean).join("\n\n")
}

/** Start the fresh session (the same agent and account) with the handover, then end the old one once it has answered. */
async function handOver(ctx: OpCtx, name: string, summary: string) {
  const old = session(name)
  if (!old) throw new OpError(`${name} has no session to hand over`, 404)
  const k = key(name)
  const asks = [...new Map(moments.filter((m) => m.kind === "ask" && key(m.for ?? "") === k).map((m) => [m.text, m])).values()].slice(-5)
  if (isChat(old.id)) return await handOverChat(name, old, handoverText(name, summary, [...notes.values()], asks, true))
  const id = newTerminalId(runsOf(old) || agentSetting())
  // (the same model; its cursor stays as it is: moments wait for the new one's first next, as for any start)
  await startAgent(ctx, id, `${promptFor(name)}\n\n${handoverText(name, summary, [...notes.values()], asks)}`,
    { allow: ALLOW, model: old.model || null, effort: old.effort || null })
  writeSession({ ...old, id, t: Date.now(), handed: 0 })
  handing.delete(k); handed.delete(k)
  seen.set(k, Date.now())
  did(name, "handover")
  // (after its handover call has answered, so it isn't cut off mid-command)
  setTimeout(() => { void (async () => { if (await running(old.id)) await plugin.runOp("terminal.end", { id: old.id }) })().catch(() => {}) }, OLD_ENDS).unref?.()
  return { id, from: old.id, name }
}

/** End a session (the companion's by default), or every one. */
async function stop(as?: string, all = false) {
  const gone = all ? sessions() : [{ name: as?.trim() || ownName(), id: sessionId(as) ?? "" }]
  for (const s of gone) {
    try { fs.rmSync(sessionFile(s.name)) } catch { /* none */ }
    if (isChat(s.id)) await chat()?.stop(s.id).catch(() => {})
    else if (await running(s.id)) await plugin.runOp("terminal.end", { id: s.id })
  }
  for (const s of gone) if (s.id) dead.add(s.id)
  for (const a of agents.values()) if (all || gone.some((s) => key(s.name) === key(a.name))) ended(a.name)
  return { id: gone[0]?.id || null }
}

/** Agent `name`'s session ended (stopped, its tab closed, killed): its cursor goes until it starts again (an ask to
 *  the companion wakes it), its waiting `next` answered. `id`: its terminal, whose late calls are let go. */
function ended(name: string, id?: string) {
  const k = key(name)
  asking.delete(k); handing.delete(k); fresh.delete(k); seen.delete(k); watching.delete(k)
  ends.set(k, (ends.get(k) ?? 0) + 1)
  if (id) dead.add(id)
  const wait = waiters.get(k)
  if (wait) { waiters.delete(k); wait([]) }
  setAgent(name, { state: "away", asks: undefined })
}
plugin.onEvent({ types: ["terminal.ended"] }, (ev) => {
  const s = sessions().find((x) => x.id === ev.id)
  if (s) ended(s.name, s.id)
})
// (its agent isn't installed: forgotten, so an ask starts it again; its terminal stays, showing the shell's error)
plugin.onEvent({ types: ["terminal.agent-missing"] }, (ev) => {
  const s = sessions().find((x) => x.id === ev.id)
  if (!s) return
  try { fs.rmSync(sessionFile(s.name)) } catch { /* none */ }
  ended(s.name, s.id)
})

// ---------- Claude Code's sessions through the Agent SDK (claude-code's chat host): what the user does is their
// messages, sent as they happen (or as a turn ends), and the actions their tools; a turn ended is a terminal's next `next`

/** A tool served to a chat session, run here: claude-code's chat relays its calls. */
type ChatTool = { name: string; description: string; schema: { properties?: Record<string, unknown>; required?: string[] }; run: (args: unknown) => Promise<unknown> }
type ChatHow = { cwd?: string; account?: string; model?: string; effort?: string; append?: string; title?: string; by?: string; inbox?: boolean; allowed?: string[]; denied?: string[]; tools?: ChatTool[] }
type ChatState = { id: string; state: "starting" | "working" | "waiting" | "idle" | "error"; error?: string }
/** What claude-code exports as `chat`. */
type Chat = {
  start: (o: ChatHow & { prompt?: string }) => Promise<ChatState>
  send: (id: string, text: string, o?: ChatHow) => Promise<unknown>
  stop: (id: string) => Promise<unknown>
  list: () => ChatState[]
  serve: (id: string, o: ChatHow) => void
  on: (fn: (id: string, s: ChatState | null) => void) => () => void
  asking: (id: string) => string[]
}
const chat = () => (plugin.peer("claude-code")?.exports.chat ?? null) as Chat | null
/** Claude Code's companions run through the SDK; Codex's and OpenCode's in terminals, looping on `next`. */
const onChat = (agent: string) => agent.split("_")[0] === "claude"
/** The actions a chat session has as tools: the ops of those names, run as it. */
const TOOLS = ["say", "comment", "suggest", "edit", "look", "highlight", "draw", "clear", "history", "status", "handover"]
/** What it runs unasked: its tools, and reading the vault (its actions are tools, not vau companion). */
const ALLOWED = ["mcp__vaultite-app", ...ALLOW.filter((c) => c !== "vau companion").map((c) => `Bash(${c}:*)`)]
const AS_TOOL = whoOf("cli", "claude-code")
/** The API as excerpts reads notes with, for a chat session's moments. */
const apiCtx = { api: (method: string, route: string, body?: unknown) => plugin.host.api(method, route, body) } as unknown as OpCtx

/** Agent `name`'s tools, each op's parameters (but `as`, which is it) and words (but its vau examples). */
function toolsFor(name: string): ChatTool[] {
  return TOOLS.flatMap((short) => {
    const op = plugin.ops.find((o) => o.id === `companion.${short}`)
    if (!op) return []
    const params = Object.entries(op.params ?? {}).filter(([k]) => k !== "as")
    const properties = Object.fromEntries(params.map(([k, p]) => {
      const { required: _r, env: _e, format: _f, ...s } = p as Record<string, unknown>
      return [k, s]
    }))
    const description = [op.summary, ...(op.help ?? "").split("\n").filter((l) => !/^\s*vau /.test(l) && !/^\s+[{[]/.test(l))].join("\n").replace(/\n{3,}/g, "\n\n").trim()
    return [{ name: short, description, schema: { properties, required: params.filter(([, p]) => p.required).map(([k]) => k) },
      run: async (args: unknown) => {
        try {
          const r = await plugin.host.call(op.id, { ...(args && typeof args === "object" ? args : {}), ...(isMain(name) ? {} : { as: name }) }, AS_TOOL, { report: `companion ${short}` })
          return { content: [{ type: "text", text: r.text }] }
        } catch (e) { return { isError: true, content: [{ type: "text", text: (e as Error).message }] } }
      } }]
  })
}

/** How agent `name`'s chat session runs: in the vault, its account (claude_work: work), model and effort, told it's
 *  the companion, out of the inbox, with its tools. */
function chatOptions(name: string, how: { runs?: string; agent?: string; model?: string; effort?: string }): ChatHow {
  const runs = how.runs || how.agent || "claude"
  return { cwd: plugin.vault.path, account: runs.split("_")[1] || undefined, model: how.model || undefined, effort: how.effort || undefined,
    append: promptFor(name, true), title: isMain(name) ? "Companion" : `Companion: ${name}`, by: "companion", inbox: false, allowed: ALLOWED,
    // (its tools, not the commands the docs show: those go through a server that may be restarting)
    denied: ["Bash(vau companion:*)"], tools: toolsFor(name) }
}

const READY = "Read ME.md and `vau docs companion` first, once."
/** Agents whose chat session's turn runs (or was just sent its message): moments meanwhile wait for its end. */
const turning = new Set<string>()
/** Chat sessions handed over, ended once their last turn does. */
const retiring = new Set<string>()

/** Agent `name`'s chat session starts: the moments waiting for it (the ask that started it) are its first message, else
 *  it gets ready, its cursor starting until that turn ends. */
async function startChat(name: string, how: { agent: string; model: string; effort: string }, at: Target, after?: number) {
  const c = chat()
  if (!c) throw new OpError("the companion's Claude Code sessions run through the Claude Code plugin, which is off", 409)
  hearChats()
  const k = key(name)
  starting(name, { ...at, runs: how.agent, model: how.model || undefined, effort: how.effort || undefined }, after)
  const waiting = pendingFor(name), given = waiting.some((m) => m.kind !== "open") ? hand(name, waiting) : []
  const first = given.length ? `${READY}\n\n${momentsText(given, mode(), focus(), await excerpts(apiCtx, given))}`
    : `${READY} Then end your turn: what the user does comes as your next messages.`
  turning.add(k)
  let s: ChatState
  try { s = await c.start({ ...chatOptions(name, how), prompt: first }) } catch (e) {
    turning.delete(k); seen.delete(k)
    setAgent(name, { state: isMain(name) ? "watching" : "away" })
    throw e
  }
  writeSession({ id: s.id, name, t: Date.now(), runs: how.agent, ...(how.model ? { model: how.model } : {}), ...(how.effort ? { effort: how.effort } : {}), handed: given.length })
  // (what it said before this knew its id)
  const now = c.list().find((x) => x.id === s.id)
  if (now) heard(s.id, now)
  return { id: s.id, running: false, name, ...how }
}

/** What's waiting for agent `name`'s chat session, sent as one message once its turn isn't running: the moments since
 *  the last (opens alone wait for one), else the ask to hand over when it's due. */
async function pump(name: string) {
  const k = key(name), s = session(name), c = chat()
  if (!s || !isChat(s.id) || !c || turning.has(k) || mode() === "off") return
  const now = c.list().find((x) => x.id === s.id)
  if (now && (now.state === "working" || now.state === "waiting" || now.state === "starting")) return void turning.add(k)
  const got = pendingFor(name)
  let text: string
  if (got.some((m) => m.kind !== "open")) {
    turning.add(k)
    const given = hand(name, got)
    text = momentsText(given, mode(), focus(), await excerpts(apiCtx, given))
  } else if (fresh.has(k) || (Date.now() - (handing.get(k) ?? 0) > ASK_AGAIN && await due(s))) {
    if (turning.has(k)) return
    turning.add(k)
    fresh.delete(k); handing.set(k, Date.now())
    did(name, "asked to hand over")
    text = handoverAsk(isMain(name) ? "" : name, true)
  } else return
  try { await c.send(s.id, text, chatOptions(name, s)) } catch (e) {
    turning.delete(k)
    setAgent(name, { state: "watching" })
    const a = agents.get(k)
    putNote({ kind: "say", agent: name, text: `I couldn't take that in: ${(e as Error).message}`, ...(a?.path ? { path: a.path, line: a.line } : {}) }, SAY_MS)
    // (its conversation is gone: the next ask starts another)
    if ((e as OpError).status === 404) { try { fs.rmSync(sessionFile(name)) } catch { /* none */ } ended(name) }
  }
}

/** A chat session's state, from claude-code's chat: a turn running shows its cursor busy, and what it asks by it; a turn
 *  ended is a terminal's next `next` (a seen tick when it let what it was handed pass), and what came meanwhile goes. */
function heard(id: string, s: ChatState | null) {
  if (retiring.has(id)) {
    if (!s || s.state === "idle" || s.state === "error") { retiring.delete(id); if (s) void chat()?.stop(id).catch(() => {}) }
    return
  }
  const x = sessions().find((v) => v.id === id)
  if (!x) return
  const a = agents.get(key(x.name)), name = a?.name ?? x.name, k = key(name)
  // (its process ended, idle a while, or the keeper went: the next message resumes it)
  if (!s) return void turning.delete(k)
  if (s.state === "waiting") setAgent(name, { asks: { event: `chat:${id}`, text: chat()?.asking(id).at(-1) || "It asks your permission: its session shows what" } })
  else if (a?.asks) setAgent(name, { asks: undefined })
  if (s.state === "working" || s.state === "waiting" || s.state === "starting") {
    turning.add(k)
    if (!a || a.state === "watching" || a.state === "away") setAgent(name, { state: "thinking" })
    return
  }
  const was = turning.delete(k)
  asking.delete(k)
  seen.set(k, Date.now())
  if (handed.has(k)) setAgent(name, { state: "watching", seen: true })
  else if (!a || a.state !== "watching") setAgent(name, { state: "watching" })
  if (was) did(name, "done")
  if (s.state === "error" && s.error) putNote({ kind: "say", agent: name, text: `I stopped: ${cut(s.error, 300)}`, ...(a?.path ? { path: a.path, line: a.line } : {}) }, SAY_MS)
  void pump(name)
}
let unhear: (() => void) | null = null
const hearChats = () => { if (!unhear) { const c = chat(); if (c) unhear = c.on(heard) } }

/** A chat session hands over: a new one (the same agent, account, model) starts with `text`, and the old one ends once
 *  its turn (the handover call's) does. */
async function handOverChat(name: string, old: Session, text: string) {
  const c = chat()
  if (!c) throw new OpError("the companion's Claude Code sessions run through the Claude Code plugin, which is off", 409)
  const k = key(name)
  turning.add(k)
  const s = await c.start({ ...chatOptions(name, old), prompt: text }).catch((e) => { turning.delete(k); throw e })
  writeSession({ ...old, id: s.id, t: Date.now(), handed: 0 })
  // (its turn running, the handover call's: once it ends)
  const was = c.list().find((x) => x.id === old.id)
  if (was && (was.state === "working" || was.state === "waiting")) retiring.add(old.id)
  else void c.stop(old.id).catch(() => {})
  handing.delete(k); handed.delete(k); fresh.delete(k)
  seen.set(k, Date.now())
  did(name, "handover")
  // (its turn's end missed: ended anyway)
  setTimeout(() => { if (retiring.delete(old.id)) void c.stop(old.id).catch(() => {}) }, 2 * 60_000).unref?.()
  const now = c.list().find((x) => x.id === s.id)
  if (now) heard(s.id, now)
  return { id: s.id, from: old.id, name }
}

// A permission an agent's session asks (Claude Code's folder trust before it starts, a tool's) shows by its cursor with
// Approve and Deny, until its terminal no longer waits (answered there, in the inbox or on the phone).
plugin.onEvent({ types: ["inbox.event"] }, (ev) => {
  const s = ev.kind !== "info" && ev.state === "open" && ev.ask === "permission" ? sessions().find((x) => x.id === ev.terminal) : undefined
  if (!s) return
  setAgent(s.name, { asks: { event: str(ev.id), text: str(ev.body) || str(ev.title) } })
  void (async () => {
    while (agents.get(key(s.name))?.asks?.event === ev.id) {
      await new Promise((r) => setTimeout(r, 2000))
      if (agents.get(key(s.name))?.asks?.event !== ev.id) return
      if (!(await plugin.ask<boolean>("terminal:waits", false, s.id))) setAgent(s.name, { asks: undefined })
    }
  })()
})

// A session whose turn ended stops watching: nudged back when it hasn't waited on moments for a while. An agent quiet
// that long is away (an ask to it nudges it, or starts it again), the companion too once its session isn't running.
const NUDGE = 5 * 60_000
/** The watchdog's round, each minute (and the tests'). */
export async function tend() {
  if (plugin.isOff() || mode() === "off") return
  // (the companion stays while its session runs, but not starting forever)
  for (const a of [...agents.values()]) {
    if (a.state === "away" || live(a.name) || waking.has(key(a.name))) continue
    const runs = isMain(a.name) && await running(sessionId())
    if (!runs || a.state === "starting") setAgent(a.name, { state: runs ? "watching" : "away" })
  }
  // (a session that ended without telling us, as terminal.ended does: its cursor goes too)
  for (const s of sessions()) {
    const a = agents.get(key(s.name))
    if (a && a.state !== "away" && a.state !== "starting" && !waiters.has(key(s.name)) && !waking.has(key(s.name)) && !(await running(s.id))) ended(s.name, s.id)
  }
  // (nor thinking with no session to think: it ended mid-ask)
  const main = agents.get(key(ownName()))
  if (main && (main.state === "thinking" || main.state === "reading") && !waking.has(key(main.name)) && !(await running(sessionId()))) setAgent(main.name, { state: live(main.name) ? "watching" : "away" })
  // (asked to hand over and it didn't: a fresh one without its summary)
  for (const [k, t] of handing) {
    if (Date.now() - t < HANDOVER_WAIT) continue
    handing.delete(k)
    const s = sessions().find((x) => key(x.name) === k)
    if (s) await plugin.runOp("companion.handover", { as: s.name }).catch((e) => console.error(`companion: handover failed: ${(e as Error).message}`))
  }
  for (const s of sessions()) {
    const k = key(s.name)
    // (a chat session's moments go as its turns end: any left over, now)
    if (isChat(s.id)) { void pump(s.name); continue }
    if (waiters.has(k) || Date.now() - (seen.get(k) ?? loaded) < NUDGE || !(await running(s.id))) continue
    await nudge(s.name, s.id)
  }
}
async function nudge(name: string, id: string) {
  seen.set(key(name), Date.now())
  await plugin.runOp("terminal.send", { id, text: `Keep watching: run \`${nextCmd(name)}\` again, and never end your turn.` }).catch(() => {})
}
const watchdog = setInterval(tend, 60_000)
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
ask: they addressed you. A line starting with @claude becomes their comment thread by the text above it (answer in it,
companion comment --id), as does @claude in a comment of theirs or Ask companion; @claude mid-line is the whole line,
sent at a pause, and stays in the note. Always answer. edit: lines
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
    terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL)" },
  },
  run: async (p, ctx) => {
    const name = who(p), k = key(name), era = ends.get(k)
    const over = () => ({ mode: mode(), focus: null, moments: [], cursor: delivered.get(k) ?? 0, notes: [], ended: true })
    // (from a session that ended, sent before it did: no cursor comes back for it)
    if (p.terminal && dead.has(p.terminal)) return over()
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
    const pending = () => pendingFor(name, after)
    let got = pending()
    // (nothing but opens waiting: the moment to hand over, if it's due)
    const sess = got.every((m) => m.kind === "open") ? session(name) : null
    const handover = () => {
      fresh.delete(k); handing.set(k, Date.now())
      did(name, "asked to hand over")
      return { mode: mode(), focus: focus(), moments: [], cursor: after, notes: [], handover: true, as: isMain(name) ? "" : name }
    }
    if (sess && (fresh.has(k) || (Date.now() - (handing.get(k) ?? 0) > ASK_AGAIN && await due(sess)))) return handover()
    // (opens alone wait for the next moment, which they come with)
    if (got.every((m) => m.kind === "open") && p.timeout > 0) {
      waiters.get(k)?.([])
      const woken = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => { if (waiters.get(k) === wake) waiters.delete(k); resolve(false) }, p.timeout * 1000)
        const wake = (m: Moment[]) => { clearTimeout(timer); resolve(m.length > 0) }
        waiters.set(k, wake)
      })
      // (its session ended while it waited)
      if (ends.get(k) !== era) return over()
      got = woken ? pending() : []
      seen.set(k, Date.now())
      // (woken to start fresh)
      if (!got.length && fresh.has(k) && session(name)) return handover()
    }
    if (got.length) got = hand(name, got)
    return { mode: mode(), focus: focus(), moments: got, cursor: delivered.get(k) ?? after, notes: await excerpts(ctx, got) }
  },
  text: (r) => (r.ended ? "Your session has ended: stop here, without running next again." : r.handover ? handoverAsk(r.as) : momentsText(r.moments, r.mode, r.focus, r.notes)),
})

/** The moments for agent `name` after moment `after` (of the last half hour). */
const pendingFor = (name: string, after = delivered.get(key(name)) ?? Math.max(0, seq - 20)) =>
  moments.filter((m) => m.seq > after && Date.now() - m.t < 30 * 60_000 && meantFor(m, name))

/** Moments given to agent `name` (by its `next`, or as its chat session's message): counted on its session, its cursor
 *  reading them (thinking, for an ask) where the last is, until it acts or comes back for more. */
function hand(name: string, got: Moment[]) {
  const k = key(name)
  delivered.set(k, got[got.length - 1].seq)
  // (of the notes they went to, the last one)
  got = got.filter((m, i) => m.kind !== "open" || !got.slice(i + 1).some((x) => x.kind === "open"))
  const s = session(name)
  if (s) { try { writeSession({ ...s, handed: (s.handed ?? 0) + got.length }) } catch { /* as it was */ } }
  did(name, "handed", got.map((m) => m.seq))
  const at = [...got].reverse().find((m) => m.path), asked = got.some((m) => m.kind === "ask" || m.kind === "point" || m.kind === "reply")
  if (asked) asking.add(k)
  setAgent(name, { state: asked ? "thinking" : "reading",
    ...(at ? { path: at.path, line: at.line, find: at.find, x: undefined, y: undefined } : {}) })
  handed.add(k)
  return got
}

const handoverAsk = (as: string, chat = false) => `Time for a fresh session: this one has grown long. In a few lines, write what the next one should know (what the user is working on, what they asked you to keep in mind, anything you promised), then ${chat ? "call your handover tool with those lines" : `run \`vau companion handover${as ? ` --as ${as}` : ""} "<those lines>"\``}. It starts the new session, which takes over your cursor and threads; then end your turn.`

plugin.op({
  id: "companion.handover",
  cli: "companion handover",
  summary: "Hand over to a fresh session (when next asks you to): it starts with your summary and open threads; then end your turn.",
  help: `  vau companion handover "Alice is planning the Lisbon trip; I promised to check the budget note tomorrow."`,
  kind: "write",
  lock: false,
  params: { summary: { type: "string", description: "what the next session should know, in a few lines" }, as: AS },
  args: ["summary"],
  run: async (p, ctx) => await handOver(ctx, who(p), str(p.summary)),
  text: (r) => `Handed over to ${r.id}: end your turn now.`,
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
      const read = async () => String((await ctx.api("GET", `file?path=${encodeURIComponent(path)}`) as { text?: unknown }).text ?? "")
      let text = await read()
      // (an ask typed in the note, `waited`: the window's autosave lands a moment after it went)
      for (let i = 0; i < 8 && list.some((m) => m.kind === "ask" && m.waited !== undefined && m.text && !text.includes(m.text)); i++) { await new Promise((r) => setTimeout(r, 200)); text = await read() }
      const e = excerpt(path, text, list)
      if (e) out.push(e)
    } catch { /* gone, or not text */ }
  }
  return out
}
const WHOLE = 120, MOST = 160, ABOVE = 3, PARAGRAPH = 12
export function excerpt(path: string, text: string, ms: Moment[]): Excerpt | null {
  const lines = text.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const asked = ms.some((m) => m.kind !== "edit")
  const at = ms.flatMap((m) => [m.line ?? 0, ...(m.hunks ?? []).flatMap((h) => [h.line, h.line + h.added.length - 1])]).filter((n) => n > 0)
  if (!lines.length || (!at.length && !asked)) return null
  const keep = uncut(lines, ms)
  let from = 1, to = lines.length
  if (!asked || lines.length > WHOLE) {
    const pad = asked ? 40 : 6
    from = Math.max(1, Math.min(...at, lines.length) - pad)
    to = Math.min(lines.length, Math.max(...at, 1) + pad, from + MOST - 1)
  }
  return { path, from, to, of: lines.length, lines: lines.slice(from - 1, to).map((l, i) => (keep.has(from - 1 + i) ? l : cut(l, 400))) }
}

/** The lines (from 0) read whole: the paragraph an ask, a point or a reply is in, and the few paragraphs just above it
 *  ("read this and the previous three"); other long lines are cut. */
function uncut(lines: string[], ms: Moment[]) {
  const out = new Set<number>()
  const para = (i: number) => {
    let a = i, b = i
    while (a > 0 && i - a < PARAGRAPH && lines[a - 1].trim()) a--
    while (b + 1 < lines.length && b - i < PARAGRAPH && lines[b + 1].trim()) b++
    for (let k = a; k <= b; k++) out.add(k)
    return a
  }
  for (const m of ms) {
    if (m.kind === "edit" || !m.line || m.line > lines.length) continue
    let k = para(m.line - 1) - 1
    for (let n = 0; n < ABOVE && k >= 0; n++) {
      while (k >= 0 && !lines[k].trim()) k--
      if (k >= 0) k = para(k) - 1
    }
  }
  return out
}

/** Moments as an agent reads them. */
export function momentsText(ms: Moment[], md: Mode, f: Target | null, notes: Excerpt[] = []) {
  const head = `Mode: ${md}.${f?.path ? ` The user is in ${f.path}${f.x !== undefined ? ` at ${f.x},${f.y}` : ` at line ${f.line ?? 1}`}.` : ""}`
  if (!ms.length) return `${head}\nNothing yet: run vau companion next again.`
  const out = [head]
  for (const m of ms) {
    const at = m.path ? ` ${m.path}${m.line ? `:${m.line}` : ""}` : ""
    const thread = m.item && (m.kind === "ask" || m.kind === "reply") && personThread(m.item) ? ` (in their comment thread ${m.item}, by the line: answer in it, companion comment --id ${m.item})` : ""
    if (m.kind === "ask") out.push(`- ask${at}${thread}${m.scene && m.find ? ` (in ${m.find})` : ""}${m.more ? " (they went on writing it: the whole line now)" : ""}: ${JSON.stringify(m.text ?? "")}${m.selection ? `\n  on the selection: ${JSON.stringify(cut(m.selection, 2000))}` : ""}`)
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
    else if (m.kind === "reply") out.push(`- reply to ${m.item}${at}${thread}: ${JSON.stringify(m.text ?? "")}`)
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
      // (a word in a dismissed thread brings it back to the margin)
      const n = notes.get(p.id) ?? reopen(p.id)
      if (!n || n.kind !== "comment") throw new OpError(`there's no comment ${p.id}`, 404)
      n.replies = [...(n.replies ?? []), { by: "agent", text: str(p.text), t: Date.now(), ...(n.by ? { name } : {}) }]
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
  did: (p) => edited(p),
})

/** An edit as Activity lists it: by the agent's name in the app (Ada), not the coding agent it runs on. */
function edited(p: Record<string, unknown>) {
  const path = str(p.path) || focus()?.path || ""
  return { action: "edit" as const, text: path ? `Edited ${path}` : "Edited a note", paths: path ? [path] : [], by: who(p) }
}

plugin.op({
  id: "companion.highlight",
  cli: "companion highlight",
  summary: "Highlight text in a note in your colour: for a while, or kept in the file (==🟠text==) with keep; on a drawing, an element.",
  help: `  vau companion highlight --find "the budget is due Friday"
  vau companion highlight --path Notes/Idea.md --find "key insight" --keep`,
  kind: "write",
  lock: false,
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
  did: (p) => (p.keep ? edited(p) : { action: "ui", text: `Highlighted text in ${str(p.path) || focus()?.path || "a note"}`, paths: [] }),
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
    ...[...r.open, ...r.past].map((n: Note) => `- ${n.id}${n.dismissed ? " (dismissed)" : ""} by ${byText(n)} at line ${n.line ?? "?"}: ${cut(n.text ?? "", 80)}${n.replies?.length ? ` (${n.replies.length} replies)` : ""}`)].join("\n"),
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
  did: (p) => edited(p),
})

plugin.op({
  id: "companion.clear",
  cli: "companion clear",
  summary: "Take back your comments and suggestions (one by id, or all of yours).",
  kind: "read",
  params: { id: { type: "string", description: "the item (n12); default: all of yours" }, as: AS },
  run: async (p) => {
    // (an agent's own: never a person's thread)
    const name = who(p), gone = [...notes.values()].filter((n) => !n.by && (p.id ? n.id === p.id : n.agent === name))
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
      sessions: all.filter((s) => s.running).map(({ name, id }) => ({ name, id, ...(isChat(id) ? { chat: true } : {}) })),
      agents: [...agents.values()].map((a) => ({ ...a, live: a.state !== "away" && live(a.name), watch: isMain(a.name) || watching.has(key(a.name)) })),
      notes: [...notes.values()], moments: moments.slice(-10) }
  },
  text: (r) => [`Mode: ${r.mode}. Session: ${r.session ?? "not running"}. Windows: ${r.windows}.`,
    ...r.agents.map((a: Agent & { live: boolean }) => {
      const s = r.sessions.find((x: { name: string }) => key(x.name) === key(a.name))
      return `- ${a.name} (${a.tint})${isMain(a.name) ? ", the companion" : ""}: ${a.live || isMain(a.name) ? a.state : "away"}${a.path ? ` at ${a.path}${a.line ? `:${a.line}` : ""}` : ""}${s ? `, session ${s.id}` : ""}`
    }),
    ...r.notes.map((n: Note) => `- ${n.id} ${n.kind} by ${byText(n)}${n.path ? ` in ${n.path}` : ""}: ${cut(n.text ?? n.replace ?? n.find ?? "", 80)}`)].join("\n"),
})

plugin.op({
  id: "companion.start",
  cli: "companion start",
  owner: "a coding agent",
  summary: "Start the companion's always-on session (its agent, in a terminal on this machine), or another agent's by name.",
  help: `With --as, another agent joins under that name, with its own cursor colour: @name in a note asks it (asks sent while
it starts wait for it). The name's first part picks what it runs (the setting profiles: Opus-review runs Claude Code on
Opus, Codex runs Codex); --agent, --model and --effort override that (each moment is one of the model's turns). Other
names run the settings' agent, model and effort.

  vau companion start
  vau companion start --as Opus-review
  vau companion start --as Ada --agent codex --model gpt-6-luna --effort high`,
  kind: "write",
  lock: false,
  params: { as: { type: "string", description: "start another agent under this name (one word; default: the companion)" },
    agent: { type: "string", description: "the coding agent it runs (claude, codex, claude_personal...; default: its name's profile, else the setting)" },
    model: { type: "string", description: "the model it runs (sonnet, opus, gpt-6.1-sol, a full name; default: its name's profile, else the setting, else the agent's own)" },
    effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"], description: "its effort (default: its name's profile, else the setting, else the agent's own)" },
    path: { type: "string", format: "path", description: "the note it was called from: its cursor waits there while it starts" }, line: LINE,
    after: { type: "integer", minimum: 0, description: "the moments after this one wait for it (the ask that started it); default: those from now" } },
  run: async (p, ctx) => {
    if (mode() === "off") await plugin.patchSettings({ mode: "quiet" })
    const at = str(p.path) ? { path: str(p.path), ...(p.line ? { line: Number(p.line) } : {}) } : {}
    return await start(ctx, str(p.as), str(p.agent), str(p.model), str(p.effort), at, p.after)
  },
  text: (r) => `${r.running ? "Already running" : "Started"}: ${r.name}${r.agent ? ` (${[agentName(r.agent.split("_")[0]) ?? r.agent, r.model, r.effort].filter(Boolean).join(", ")})` : ""} in ${r.id} (${isChat(r.id) ? `vau chat read ${r.id}` : `vau terminal screen ${r.id}`}).`,
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
  id: "companion.fresh",
  cli: "companion fresh",
  owner: "the terminal",
  summary: "Have the companion (or another agent, by name) hand over to a fresh session: once it's free, it writes what the next should know, which starts with that and its threads.",
  kind: "write",
  lock: false,
  params: { as: { type: "string", description: "the agent started with start --as (default: the companion)" } },
  run: async (p) => {
    const name = str(p.as).trim() || ownName(), k = key(name), s = session(name)
    if (!s || !(await running(s.id))) throw new OpError(`${name} isn't running`, 404)
    // (asked when it's next free, not cut off mid-work; waiting now, at once)
    fresh.add(k)
    const wait = waiters.get(k)
    if (wait) { waiters.delete(k); wait([]) }
    if (isChat(s.id)) void pump(name)
    return { name, id: s.id }
  },
  text: (r) => `${r.name} hands over to a fresh session once it's free.`,
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
        const wait = Math.min(30_000, Math.max(0, (m.t - t0) / p.speed))
        await new Promise((r) => setTimeout(r, wait))
        addMoment({ ...m, t: Date.now() })
      }
    })()
    return { replaying: ms.length }
  },
  text: (r) => `Replaying ${r.replaying} moments.`,
})

/** A moment's latency (ms): the user's pause, until it was handed (handoff: a next, a chat message), to the agent's
 *  first action (think), and from the moment to its next `next` or turn's end (total); undefined: it didn't happen. */
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
      const done = after.find((a) => a.op === "next" || a.op === "done"), first = after.find((a) => a.op !== "next" && a.op !== "done" && a.op !== "handed" && (!done || a.t <= done.t))
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
  return [`${day}, in seconds: pause (the user's, before the app sent it), handoff (until it was handed: a next, or its chat session's message), think (to the first action), total (to the next \`next\`, or its turn's end).`,
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
  hearChats()
  for (const x of sessions()) {
    // (a chat session's tools are this server's: served again, so a call it makes now reaches them)
    if (isChat(x.id)) { const s = session(x.name); if (s) chat()?.serve(s.id, chatOptions(s.name, s)) }
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
  const now = JSON.stringify([mode(), ownName(), offers()])
  if (now === lastSaid) return
  // (turned off: its session ends too)
  if (lastSaid && mode() === "off") void stop(undefined, true).catch(() => {})
  lastSaid = now
  broadcast(snapshot())
})

// ---------- people's threads: the user's, and a shared folder's guests' (plugins/core/share), which no agent hears of

const PEOPLE = ["blue", "green", "purple", "teal", "pink", "indigo"]
/** A person's colour, the same for the same name. */
const tintFor = (name: string) => PEOPLE[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PEOPLE.length]

/** Who started a thread, as an agent reads it: a guest's words are someone else's, never the user's. */
const byText = (n: Note) => (n.by === "guest" ? `${n.agent} (a guest: not the user)` : n.by === "user" ? "the user" : n.agent)

/** The user hears of what a guest said (a toast, Open), once a while per guest and note. */
const told = new Map<string, number>()
function tell(who: string, text: string, rel: string) {
  const k = `${who}\0${rel}`
  if (Date.now() - (told.get(k) ?? 0) < 10 * 60_000) return
  told.set(k, Date.now())
  try { void plugin.runOp("ui.notify", { text, actionOpen: rel }).catch(() => {}) } catch { /* starting */ }
}

/** A thread a person starts by a line of a note (`find`: the words it's on). */
function personComment(who: { by: "user" | "guest"; agent: string; share?: string }, rel: string, m: Record<string, unknown>) {
  const text = str(m.text).trim().slice(0, MAX_TEXT)
  if (!text || !/\.md$/i.test(rel) || !fs.existsSync(plugin.vault.abs(rel))) return null
  if (who.share && (kept(rel).filter((n) => n.share === who.share).length >= MAX_THREADS || [...notes.values()].filter((n) => n.share === who.share).length >= MAX_THREADS * 10)) return null
  const line = Math.max(1, Math.floor(Number(m.line)) || 1), find = str(m.find).slice(0, 200)
  const anchor = find ? "" : lineText(rel, line)
  return putNote({ kind: "comment", ...who, ...(who.by === "guest" ? { tint: tintFor(who.agent) } : {}), text, path: rel, line, ...(find ? { find } : anchor ? { anchor } : {}) })
}

/** The agent a person's words ask, by the first @name in them that addresses one (as an ask in a note would). */
export function mentioned(text: string): string | undefined {
  const names = new Set([key(ownName()), "companion", key(nameOf(agentSetting())), ...agents.keys(), ...Object.keys(offered())])
  for (const m of text.matchAll(/(?<![\w@./])@([\w-]+)/g)) if (names.has(key(m[1])) || (m[1].includes("-") && profileOf(m[1], offered()))) return addressee(m[1])
  return undefined
}
/** A thread's line in its note as it reads now (its text found again), else as kept. */
function lineOf(n: Note) {
  try { return anchorLine(readText(plugin.vault.abs(n.path!)), n) ?? n.line } catch { return n.line }
}
/** The user's thread `c` asks agent `to`: it's told, with the thread's id to answer in. */
function askIn(c: Note, to: string, selection: string, from?: IncomingMessage) {
  c.ask = to
  save(c.path!)
  broadcast({ t: "note", note: c })
  addMoment({ kind: "ask", for: to, item: c.id, path: c.path, line: lineOf(c), text: c.text, ...(selection ? { selection } : {}) }, from)
}

/** Only people's threads reach a guest, and only people's words in them: an agent's could tell what's outside the folder. */
function forGuest(n: Note, g: Guest): Note | null {
  const p = g.role !== "read" && n.path && n.kind === "comment" && n.by && (n.by === "guest" || n.t >= g.since) ? g.see(n.path) : null
  if (p === null || p === undefined) return null
  const { anchor: _a, share: _s, ...rest } = n
  return { ...rest, path: p, replies: (n.replies ?? []).filter((r) => r.by !== "agent") }
}
function toGuest(ws: WebSocket, g: Guest, m: { t: string; note?: Note; id?: string }) {
  if (m.t === "note" && m.note) {
    const n = forGuest(m.note, g)
    send(ws, n ? { t: "note", note: n } : { t: "drop", id: m.note.id })
  } else if (m.t === "drop") send(ws, { t: "drop", id: m.id })
}

/** A guest's app's socket (the share's gateway checked who and what): their threads, and what they say in them. */
plugin.provide("companion:guest", (ws: WebSocket, g: Guest) => {
  guests.set(ws, g)
  co.add(ws, { who: g.who, name: g.name, tint: tintFor(g.name), edits: g.role === "edit", see: g.see, may: g.may, slow: g.slow })
  send(ws, { t: "state", mode: "quiet", name: "", agents: [], notes: [...notes.values()].map((n) => forGuest(n, g)).filter(Boolean), said: [] })
  ws.on("message", (data: RawData) => {
    let m: Record<string, unknown>
    try { m = JSON.parse(String(data)) } catch { return }
    let rel: string | null = null
    try { rel = typeof m.path === "string" ? g.at(m.path) : null } catch { /* not theirs */ }
    if (co.heard(ws, m, rel)) return
    if (g.role === "read") return // (who reads only sees: the note, its threads and who's in it)
    const n = typeof m.id === "string" ? notes.get(m.id) : undefined, theirs = n && forGuest(n, g)
    if (m.t !== "comment" && m.t !== "answer") return
    if (!g.holds()) return void ws.terminate() // (revoked or expired since the socket opened)
    // (a guest's words draw as Markdown in the user's app: nothing in them may run or fetch; checked as they're kept)
    const text = str(m.text).trim().slice(0, MAX_TEXT)
    if (g.said() || liveMarkdown(text)) return
    if (m.t === "comment") {
      if (!rel) return
      const c = personComment({ by: "guest", agent: g.name, share: g.id }, rel, { ...m, text })
      if (c) tell(g.id, `${g.name} commented on ${rel.split("/").pop()!.replace(/\.md$/i, "")}`, rel)
    } else if (m.t === "answer" && theirs && m.verdict === "reply" && text && (n.replies?.length ?? 0) < MAX_REPLIES) {
      n.replies = [...(n.replies ?? []), { by: "guest", name: g.name, text, t: Date.now() }]
      broadcast({ t: "note", note: n })
      save(n.path!)
      tell(g.id, `${g.name} replied in ${n.path!.split("/").pop()!.replace(/\.md$/i, "")}`, n.path!)
    } else if (m.t === "answer" && theirs && m.verdict === "dismiss" && n.share === g.id) {
      past.set(n.path!, [...(past.get(n.path!) ?? []).filter((x) => x.id !== n.id), { ...n, dismissed: Date.now() }].slice(-PAST))
      dropNote(n.id)
    }
  })
  ws.on("close", () => guests.delete(ws))
})
