// What the coding agent plugins (Claude Code, Codex, Cursor, Hermes, OpenClaw, OpenCode) share: their routes and blocks
// (codingAgent), usage tallies, processes, transcripts and databases; Terminal, Dispatch and the Inbox start agents with it.
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type { DatabaseSync } from "node:sqlite"
import { bullets, fmtMin, HTTPError, localDate, OpError, type OpCtx, type Plugin, processTable, type Request, ROOT, section, serverUrl } from "./plugins.ts"
import { stableNode } from "./service.ts"
import { parseTerminal } from "./terminalids.ts"
import { USAGE_BLOCKS } from "./rules.ts"
import { type Item, sortBy } from "./vault.ts"

export const HOME = os.homedir()

/** `vau mcp` as an agent's MCP server: by the Node running this server (an agent may pass its servers no PATH), told
 *  this server's address (another port isn't vau's default). OpenClaw and Hermes save it with their connect ops. */
export function vauMcpServer(): { command: string; args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = { VAULTITE_URL: serverUrl() }
  if (process.env.ELECTRON_RUN_AS_NODE) env.ELECTRON_RUN_AS_NODE = "1"
  return { command: stableNode(process.execPath, process.env.PATH), args: [path.join(ROOT, "bin", "vau"), "mcp"], env }
}
const run = promisify(execFile)
const pad = (n: number) => String(n).padStart(2, "0")
/** Epoch ms -> "2026-09-29T17:57:21.325000Z" (no fraction on a whole second), or null. */
export const isoMicro = (ms: number | null | undefined) =>
  ms ? new Date(ms).toISOString().replace(/\.(\d{3})Z$/, (_, f) => (f === "000" ? "Z" : `.${f}000Z`)) : null
/** How many days back the scans read: 35, and as far as a block or a query has asked for since the server started. */
let reach = 35
export const scanDays = () => reach
/** A block's or a query's `days`: 30 when unset, any range up to ten years; asking for more widens the scans. */
function daysOf(v: unknown) {
  const n = Math.trunc(Number(v || 30))
  const days = Number.isFinite(n) ? Math.min(Math.max(n, 1), 3650) : 30
  reach = Math.max(reach, days + 5)
  return days
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** A number as stored, else 0. */
export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
/** A path with `~` for the home folder, resolved. */
export const expandHome = (p: string) => (p === "~" || p.startsWith("~/") ? path.join(HOME, p.slice(1)) : path.resolve(p))
/** ISO time ("2026-09-29T17:51:25.878Z") -> epoch seconds, or null. */
export function stamp(s: unknown): number | null {
  const t = typeof s === "string" ? Date.parse(s) : NaN
  return Number.isNaN(t) ? null : t / 1000
}
/** Epoch seconds -> the local day. */
export const dayOf = (ts: number) => localDate(new Date(ts * 1000))

/** A price table's entry for a model: the longest key it starts with (after `sep`, so "gpt-5" isn't "gpt-5.1"'s). */
export function priceList<T>(table: Record<string, T>, sep = "") {
  const memo = new Map<string, T | null>()
  return (model: string): T | null => {
    if (!memo.has(model)) {
      const best = Object.keys(table).filter((k) => model === k || model.startsWith(k + sep)).sort((a, b) => b.length - a.length)[0]
      memo.set(model, best ? table[best] : null)
    }
    return memo.get(model)!
  }
}

/** `fn` run at most every `ms` (or sooner when `due`), callers sharing a run in progress. */
export function throttled(ms: number, fn: () => Promise<void>, due?: () => boolean) {
  let at = 0, running: Promise<void> | null = null
  return (): Promise<void> => {
    if (running) return running
    if (Date.now() - at < ms && !due?.()) return Promise.resolve()
    running = fn().finally(() => { at = Date.now(); running = null })
    return running
  }
}

// ---------- projects

/** Folder -> its project's root. A worktree belongs to its repository: `own` maps the agent's own worktree folders,
 *  and a sibling <repo>-<task> of a folder that's also there counts as <repo>. */
export function roots(cwds: Iterable<string>, own = (c: string) => c) {
  const base = new Map([...cwds].map((c) => [c, own(c).replace(/\/+$/, "") || "/"]))
  const names = new Set(base.values())
  const repo = (r: string) => {
    const parent = path.dirname(r), name = path.basename(r)
    let best = ""
    for (const o of names) {
      const on = path.basename(o)
      if (o !== r && path.dirname(o) === parent && name.startsWith(on + "-") && on.length > best.length) best = on
    }
    return best ? path.join(parent, best) : r
  }
  return new Map([...base].map(([c, r]) => [c, repo(r)]))
}

export const projectName = (root: string) => (root === HOME || root === "" ? "Home" : path.basename(root) || root)
/** A folder's project name, through `rootsOf` (an agent's own worktrees). */
export const projectOf = (cwd: string, rootsOf: (cwds: string[]) => Map<string, string> = roots) => projectName(rootsOf([cwd]).get(cwd)!)

/** The accounts `id` names ("" or none: all of them); none of them is a 404 that lists them. */
export function accountsNamed<A extends { id: string }>(all: A[], id: unknown, what: string): A[] {
  if (typeof id !== "string" || !id) return all
  const one = all.filter((a) => a.id === id)
  if (!one.length) throw new HTTPError(404, `no ${what} '${id}' here (they are: ${all.map((a) => a.id).join(", ") || "none"})`)
  return one
}

// ---------- usage

/** A request as a tally counts it: its cost (null: no price for its model), tokens, cache reads, prompt tokens (cached
 *  or not), the model's name and the minutes it worked, when that's known per request. */
export type Counted = { ts: number; day: string; cost: number | null; tokens: number; read: number; prompt: number; model: string; min?: number }
const round4 = (v: number) => Number(v.toFixed(4))
const rounded = (xs: Item[]) => xs.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) =>
  [k, typeof v === "number" && !Number.isInteger(v) ? round4(v) : v])))

/** Usage over the last `days`, by day, project, model and session, as the agents' GET routes answer it. */
export class Tally {
  days: Map<string, Item>
  start: string
  projects = new Map<string, Item>()
  models = new Map<string, Item>()
  sessions = new Map<string, Item>()
  total = { cost: 0, tokens: 0, unpriced: 0, read: 0, prompt: 0 }
  private name: (root: string) => string

  constructor(days: number, name = projectName) {
    const now = new Date()
    const dates = Array.from({ length: days }, (_, i) => localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - i))))
    this.days = new Map(dates.map((d) => [d, { date: d, cost: 0, tokens: 0, active_min: 0, sessions: new Set<string>() }]))
    this.start = dates[0]
    this.name = name
  }

  /** A project by its key: its root folder, or a name of its own when it isn't one (`root` null). */
  project(key: string, root: string | null = key, name = this.name(key)) {
    if (!this.projects.has(key)) this.projects.set(key, { name, ...(root !== null ? { root } : {}), cost: 0, tokens: 0, active_min: 0, sessions: new Set(), last: 0 })
    return this.projects.get(key)!
  }

  /** A session by its id, `init` its fields the first time (a `root` names its project; `model`, one to fall back on). */
  session(id: string, init: () => Item) {
    if (!this.sessions.has(id)) this.sessions.set(id, { id, ...init(), cost: 0, tokens: 0, active_min: 0, votes: new Map<string, number>() })
    return this.sessions.get(id)!
  }

  private static add(b: Item, r: Counted) {
    b.cost += r.cost ?? 0
    b.tokens += r.tokens
    if (r.min && "active_min" in b) b.active_min += r.min
  }

  /** One request, in `session` (an id: a day counts it) of `project`; `s`, the session's own row when it has one, which
   *  `vote` (a model, by `weight`) gives its model. */
  count(r: Counted, session: string, project: Item, s?: Item, vote = r.model, weight = (r.cost ?? 0) + r.tokens / 1e9) {
    this.total.unpriced += r.cost === null ? 1 : 0
    this.total.read += r.read
    this.total.prompt += r.prompt
    Tally.add(this.total, r)
    const day = this.days.get(r.day)
    if (day) { Tally.add(day, r); day.sessions.add(session) }
    Tally.add(project, r)
    project.sessions.add(session)
    project.last = Math.max(project.last, r.ts)
    if (!this.models.has(r.model)) this.models.set(r.model, { name: r.model, cost: 0, tokens: 0 })
    Tally.add(this.models.get(r.model)!, r)
    if (!s) return
    Tally.add(s, r)
    s.first = Math.min(s.first || r.ts, r.ts)
    s.last = Math.max(s.last || 0, r.ts)
    s.votes.set(vote, (s.votes.get(vote) ?? 0) + weight)
  }

  /** Minutes a turn worked, counted apart from its requests. */
  work(day: string, project: string, session: string, min: number) {
    for (const b of [this.days.get(day), this.projects.get(project), this.sessions.get(session)]) if (b) b.active_min += min
  }

  /** The answer: times through `iso`, a session's model its votes' winner through `model`, the 60 latest sessions. */
  result(iso: (ts: number) => string | null, model = (m: string) => m) {
    for (const s of this.sessions.values()) {
      const top = [...(s.votes as Map<string, number>)].reduce<[string, number] | null>((a, b) => (!a || b[1] > a[1] ? b : a), null)?.[0]
      delete s.votes
      s.model = top || s.model ? model(top || s.model) : ""
      Object.assign(s, { lastTs: s.last, first: iso(s.first), last: iso(s.last) })
    }
    for (const p of this.projects.values()) Object.assign(p, { sessions: p.sessions.size, last: iso(p.last) })
    // Two folders with the same name (Work/Acme, Documents/Acme) are told apart by their parent.
    const same = new Map<string, Item[]>()
    for (const p of this.projects.values()) same.set(p.name, [...(same.get(p.name) ?? []), p])
    for (const ps of [...same.values()].filter((ps) => ps.length > 1)) {
      for (const p of ps) if (p.root) p.name = `${p.name} (${path.basename(path.dirname(p.root)) || "/"})`
    }
    for (const s of this.sessions.values()) {
      s.project = this.projects.get(s.root)?.name ?? s.project
      if (s.private) s.root = ""
    }
    const t = this.total
    return {
      days: rounded([...this.days.values()].map((d) => ({ ...d, sessions: d.sessions.size }))),
      projects: rounded(sortBy([...this.projects.values()], (p) => [-p.cost, -p.tokens, -p.sessions])),
      models: rounded(sortBy([...this.models.values()], (m) => [-m.cost, -m.tokens])),
      sessions: rounded(sortBy([...this.sessions.values()], (s) => s.lastTs, true).slice(0, 60).map(({ lastTs: _l, ...s }) => s)),
      total: { cost: Math.round(t.cost * 100) / 100, tokens: t.tokens, unpriced: t.unpriced,
        cache_hit: t.prompt ? Math.round((t.read / t.prompt) * 1000) / 1000 : null },
    }
  }
}

export type Usage = ReturnType<Tally["result"]> & { plan: { name: string; monthly: number | null } | null; live: Item[] }

// ---------- processes

/** Every process on this machine: its pid, start (epoch ms) and command line. */
export const processes = async () => [...await processTable()].map(([pid, p]) => ({ pid, started: p.started, command: p.args }))

/** Each process's working folder (Linux's /proc, else lsof). */
export async function cwds(pids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (!pids.length) return out
  if (process.platform === "linux") {
    for (const pid of pids) try { out.set(pid, fs.readlinkSync(`/proc/${pid}/cwd`)) } catch { /* gone, or another user's */ }
    return out
  }
  let stdout = ""
  try {
    stdout = (await run("lsof", ["-a", "-d", "cwd", "-Fn", "-p", pids.join(",")], { timeout: 3000 })).stdout
  } catch (e) {
    stdout = String((e as { stdout?: string }).stdout ?? "") // exits 1 when one of them is gone: the rest still counts
  }
  // In a C locale (a service's) lsof writes the bytes of "é" as "\xc3\xa9".
  const bytes = (s: string) => s.replace(/(?:\\x[0-9a-f]{2})+/gi, (m) => Buffer.from(m.replace(/\\x/gi, ""), "hex").toString("utf8"))
  let pid = 0
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1))
    else if (line.startsWith("n") && pid) out.set(pid, bytes(line.slice(1)))
  }
  return out
}

/** The app's terminal a process runs in (Terminal's, while it's on): its session id, or null. `hint`: a tmux pane. */
export const terminalOf = (plugin: Plugin, pid: number, hint = "") => plugin.ask<string | null>("terminal:of", null, pid, hint)

/** Live sessions, working ones first, then by when they started. */
export const busyFirst = (live: Item[]) => sortBy(live, (s) => [s.status !== "busy" ? 1 : 0, s.started || ""])

// ---------- Terminal runs them (the service "agent:<name>")

export type AgentState = "working" | "waiting" | "idle"
/** A live session's context and prompt cache, by the app's terminal it runs in (the service "agent-meters:<name>", for
 *  Agent meters): `tokens` its last request read of a `window`, which cached for `ttl` seconds from `last` (ms). */
export type AgentMeter = { terminal: string; tokens: number; window: number; last: number; ttl: number }
/** What Terminal gives an agent's "agent:<name>" service, which answers the command (and folder) to run in a login
 *  shell, which then stays a plain shell. Ids: <name>-<id>, <name>_<profile>-<id>, resume-<name>-<session>. */
export type AgentStart = {
  /** The session to resume, or null for a new one. */
  resume: string | null
  /** What to tell the agent about where it runs (context.md): its system prompt's addition, if it takes one. */
  context: string
  /** A shell command marking the terminal's state for the Terminals panel, for the agent's hooks; with the Inbox on a
   *  state change is also news. */
  state: ((s: AgentState) => string) | null
  /** A shell command for the agent's hooks to report what it did (the hook's JSON on stdin), to Activity; null when off. */
  report?: string | null
  /** Which of its accounts to start in (the id's `_<profile>`: Claude Code's config folders), or null for its default. */
  profile?: string | null
  /** The first prompt, sent as it starts (Dispatch's, a voice note, a reply to a resumed session's report); null for none. */
  prompt?: string | null
}

/** A new terminal's id: `<agent>-<8 letters and digits>`, or the letters alone for a shell. */

/** Start terminal `id` running its agent (Terminal's route, as `ctx`'s caller), told `prompt` first: its answer. Throws
 *  when no plugin that's on brings that agent (the terminal goes again). */
export async function startAgent(ctx: OpCtx, id: string, prompt?: string) {
  const r = await ctx.api("POST", `terminals/${encodeURIComponent(id)}`, prompt ? { prompt } : undefined) as Record<string, unknown>
  if (!r.agent) {
    await ctx.api("DELETE", `terminals/${encodeURIComponent(id)}`).catch(() => {})
    throw new OpError(`no agent '${parseTerminal(id)?.agent ?? id}' here: its plugin is off, or there's none by that name`, 409)
  }
  return r
}

/** `s` as one word of a shell command. */
export const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
/** A session to resume that isn't on this machine (a tab from a synced or shared workspace): a note, then a plain shell. */
export const notHere = (agent: string, id: string) =>
  ({ command: `printf '%s\\n' ${quote(`There's no ${agent} session ${id} on this machine to resume.`)}`, cwd: null })

// ---------- conversations (a session's view tab)

export type Tool = { kind: "tool"; id: string; name: string; summary: string; input: string; result: string | null; error: boolean; at: string }
export type Said = { kind: "user" | "assistant"; text: string; at: string }
export type Entry = Said | Tool
export type Head = { title: string; cwd: string; model: string; first: string; last: string; branch: string }

/** Long texts cut: a view is for reading a conversation back, not for the raw data. */
export const cut = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}\n… (${(s.length - n).toLocaleString("en-US")} more characters)` : s)

/** One line saying what a tool call did: the first of `keys` it has ("git status", "src/app.ts"), else its first text;
 *  a search as "<pattern> in <the first of `where`>". */
export function toolSummary(input: unknown, keys: string[], where?: string[]) {
  const o = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  const text = (v: unknown): v is string => typeof v === "string" && !!v
  let s = typeof input === "string" ? input : keys.map((k) => o[k]).find(text) ?? Object.values(o).find(text) ?? ""
  if (where && typeof o.pattern === "string") {
    const w = where.map((k) => o[k]).find(text)
    s = w ? `${o.pattern} in ${w}` : o.pattern
  }
  return s.replace(/\s+/g, " ").trim().slice(0, 200)
}

/** A page of a conversation: the newest `limit` entries before entry `before` (the query's; 150, at most 500), and
 *  where it starts. */
function page(entries: Entry[], req: Request) {
  const before = req.query.before !== undefined ? Math.trunc(Number(req.query.before)) : NaN
  const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit || 150)) || 150, 1), 500)
  const end = Math.min(Math.max(Number.isFinite(before) ? before : entries.length, 0), entries.length)
  const start = Math.max(end - limit, 0)
  return { start, total: entries.length, entries: entries.slice(start, end) }
}

/** Calls `line` with each whole line of `file` from byte `offset`; returns where the last one ended. An error stops it
 *  quietly: the rest is read next time. */
export async function readLines(file: string, offset: number, line: (b: Buffer) => void, chunk = 1 << 22): Promise<number> {
  let fh: fs.promises.FileHandle | null = null
  try {
    fh = await fs.promises.open(file, "r")
    const into = Buffer.alloc(chunk)
    let rest = Buffer.alloc(0)
    for (;;) {
      const { bytesRead } = await fh.read(into, 0, chunk, offset + rest.length)
      if (!bytesRead) break
      const buf = rest.length ? Buffer.concat([rest, into.subarray(0, bytesRead)]) : into.subarray(0, bytesRead)
      const end = buf.lastIndexOf(10) + 1
      for (let start = 0; start < end;) {
        const nl = buf.indexOf(10, start)
        line(buf.subarray(start, nl))
        start = nl + 1
      }
      offset += end
      rest = Buffer.from(buf.subarray(end))
    }
  } catch {
    // gone or unreadable: try again next time
  } finally {
    await fh?.close()
  }
  return offset
}

type Talk = { line(text: string): void; settle(): unknown }

/** A JSONL transcript read so far, read on from where it stopped when it grows. Only lines with a `wanted` byte string
 *  are parsed (most are tool output). */
export class Transcript<T extends Talk> {
  file: string
  talk: T
  private offset = 0
  private size = 0
  private mtime = 0
  private make: () => T
  private wanted: Buffer[]
  constructor(file: string, make: () => T, wanted: string[]) {
    this.file = file; this.make = make; this.talk = make(); this.wanted = wanted.map((w) => Buffer.from(w))
  }

  async read() {
    const st = await fs.promises.stat(this.file)
    if (st.size === this.size && st.mtimeMs === this.mtime) return this
    if (st.size < this.offset) { this.offset = 0; this.talk = this.make() } // rewritten: from the top
    this.offset = await readLines(this.file, this.offset, (l) => {
      if (this.wanted.some((w) => l.includes(w))) this.talk.line(l.toString("utf8"))
    }, 1 << 20)
    this.size = st.size
    this.mtime = st.mtimeMs
    this.talk.settle()
    return this
  }
}

/** The last few transcripts read, by file: `get` reads one on from where it was left, or null when it can't be read. */
export function transcripts<T extends Talk>(make: (file: string) => Transcript<T>) {
  const kept = new Map<string, Transcript<T>>()
  return async (file: string): Promise<Transcript<T> | null> => {
    let t = kept.get(file)
    if (!t) {
      kept.set(file, (t = make(file)))
      while (kept.size > 4) kept.delete(kept.keys().next().value!)
    }
    try {
      return await t.read()
    } catch {
      kept.delete(file)
      return null
    }
  }
}

// ---------- SQLite databases (Cursor, Hermes, OpenClaw, OpenCode keep theirs in one)

let sqlite: typeof import("node:sqlite") | null | undefined
/** Node's node:sqlite (22.13 and later), loaded when first needed (never while the plugins load); null without it. */
export function nodeSqlite() {
  if (sqlite === undefined) {
    try { sqlite = process.getBuiltinModule("node:sqlite") ?? null } catch { sqlite = null }
  }
  return sqlite
}

/** A database file opened read only, again when it was replaced; a query answers no rows rather than fail (no file, an
 *  older schema, busy). `where` finds the file each time when it can move. */
export class SqliteFile {
  file = ""
  private db: DatabaseSync | null = null
  private where: () => string | null
  private ino = 0
  private version = -1
  private at = 0
  private reach = 0
  private cols = new Map<string, Set<string>>()

  constructor(where: string | (() => string | null)) {
    this.where = typeof where === "string" ? () => where : where
    if (typeof where === "string") this.file = where
  }

  /** The open database, or null when there's none. */
  open(): DatabaseSync | null {
    const file = this.where()
    let ino = 0
    try { ino = file ? fs.statSync(file).ino : 0 } catch { /* no file */ }
    if (this.db && (file !== this.file || ino !== this.ino)) this.close()
    const sql = this.db || !file || !ino ? null : nodeSqlite()
    if (sql) {
      try {
        this.db = new sql.DatabaseSync(file!, { readOnly: true, timeout: 2000 })
        this.file = file!
        this.ino = ino
        this.version = -1
        this.cols.clear()
      } catch {
        this.db = null
      }
    }
    return this.db
  }

  close() {
    try { this.db?.close() } catch { /* already closed */ }
    this.db = null
  }

  all(sql: string, ...args: (string | number | null)[]): Item[] {
    const db = this.open()
    if (!db) return []
    try {
      return db.prepare(sql).all(...args) as Item[]
    } catch {
      return []
    }
  }

  /** Whether `table` has `col`: older versions lack some columns. */
  has(table: string, col: string) {
    if (!this.cols.has(table)) this.cols.set(table, new Set(this.all(`PRAGMA table_info(${table})`).map((r) => String(r.name))))
    return this.cols.get(table)!.has(col)
  }

  /** `col` of `table` for a SELECT, or NULL in its place. */
  col(table: string, col: string) {
    return this.has(table, col) ? col : `NULL AS ${col}`
  }

  /** Something wrote to the database since the last read (another connection's commit changes data_version). */
  changed() {
    const v = Number(this.all("PRAGMA data_version")[0]?.data_version ?? -1)
    const was = this.version
    this.version = v
    return v !== was || v === -1
  }

  /** Whether to read it again: at most every 5 s, only when it changed; `none` runs when there's no database. */
  due(none: () => void) {
    const wider = this.reach < reach
    if (!wider && Date.now() - this.at < 5000) return false
    this.at = Date.now()
    if (!this.open()) { none(); return false }
    this.reach = reach
    return this.changed() || wider
  }
}

/** The last few things built (conversations), by key: `make` runs again only when the key's `version` changed. */
export function rebuilt<T>(keep = 4) {
  const kept = new Map<string, { version: string; data: T }>()
  return (key: string, version: string, make: () => T): T => {
    const hit = kept.get(key)
    if (hit?.version === version) return hit.data
    const data = make()
    kept.delete(key)
    kept.set(key, { version, data })
    while (kept.size > keep) kept.delete(kept.keys().next().value!)
    return data
  }
}

// ---------- blocks as text (GET /api/render)

const fmt = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
const money = (v: number) => (v < 100 ? `$${fmt(v, 2)}` : `$${fmt(v, 0)}`)
const tokens = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** ISO time -> "Thu 09:00 (in 2 h 10 min)". */
function when(s: string) {
  const t = new Date(s)
  const left = (+t - Date.now()) / 60000
  const soon = left < 48 * 60 ? fmtMin(Math.max(left, 1)) : `${Math.round(left / 1440)} days`
  const hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`
  return `${left < 20 * 60 ? hm : `${t.toLocaleDateString("en-US", { weekday: "short" })} ${hm}`} (in ${soon})`
}

export function ago(s: string | null) {
  const m = s ? (Date.now() - Date.parse(s)) / 60000 : 0
  return m < 1 ? "just now" : m < 48 * 60 ? `${fmtMin(m)} ago` : `${Math.floor(m / 1440)} days ago`
}

/** A plan limit's window at `now` (epoch s), `resets` written by `iso`: one that renewed since it was read is unused. */
export function limitWindow(id: string, label: string, minutes: number, used: number, resets: number | null, now: number,
  iso: (ts: number | null) => string | null) {
  if (resets && resets <= now) { used = 0; resets = null }
  return { id, label, minutes, used: Math.round(Number(used) * 10) / 10, resets_at: iso(resets) }
}

/** A plan's limits, one line each: how much is used and when it renews. */
export const limitRows = (windows: { label: string; used: number; resets_at: string | null }[]) =>
  bullets(windows.map((w) => `${w.label}: ${String(Number(w.used.toPrecision(6)))}% used` + (w.resets_at ? `, renews ${when(w.resets_at)}` : "")))

const sessionLine = (s: Item) => [s.private ? "Private session" : s.title || s.name || "Untitled", s.project, s.accountLabel, s.model,
  (s.active_min ?? 0) >= 1 && fmtMin(s.active_min), money(s.cost || 0)].filter(Boolean).join(" · ")

/** How an agent's blocks word things. */
type Words = {
  /** Its name ("Claude Code") and its blocks' prefix ("claude": claude-sessions, claude-usage...). */
  name: string
  prefix: string
  /** What a session is called ("chat"), and what's counted as one ("conversation"). */
  noun?: string
  count?: string
  /** How its cost is reckoned ("estimated at list prices"). */
  value: string
  /** Its time working is an estimate, said only for today. */
  estimate?: boolean
  /** A live session's state ("Working"). */
  state: (s: Item) => string
  /** More of the sessions block (Remote Control servers). */
  more?: (u: Usage) => string[]
}

/** A coding agent plugin: what it reads from its tool, which `codingAgent` makes its routes and blocks of. */
export type CodingAgent = Words & {
  /** Its routes: GET /api/<id>?days=&account=, /api/<id>/session/<session> and /api/<id>/accounts. */
  id: string
  /** What its session ids look like: any other is a 404. */
  sessionId: RegExp
  /** All the blocks show: plan, limits, live sessions and `days` of usage, of `account` (none: all of them). */
  usage(days: number, account: unknown): Promise<Usage>
  /** A session's title, folder, times, model, project (and what more it says) and conversation; null when it isn't here. */
  session(id: string): (Item & { entries: Entry[] }) | null | Promise<(Item & { entries: Entry[] }) | null>
  /** Its accounts, for "New <name>" in one. */
  accounts?: () => Item[]
  /** How the usage's `updated` is written (epoch ms; default isoMicro). */
  updated?: (ms: number) => string | null
}

/** A coding agent's routes and blocks. */
export function codingAgent(plugin: Plugin, a: CodingAgent) {
  const updated = a.updated ?? isoMicro
  plugin.route("GET", a.id, async (req) => {
    const u = await a.usage(daysOf(req.query.days), req.query.account)
    return { updated: updated(Date.now()), ...u }
  })
  plugin.route("GET", `${a.id}/session/*`, async (req) => {
    const id = req.arg(0)
    const s = a.sessionId.test(id) ? await a.session(id) : null
    if (!s) throw new HTTPError(404, `no ${a.name} ${a.noun ?? "session"} '${id}' on this machine`)
    const { entries, ...head } = s
    return { id, ...head, ...page(entries, req) }
  })
  if (a.accounts) plugin.route("GET", `${a.id}/accounts`, a.accounts)
  usageBlocks(plugin, a, a.usage)
}

/** The blocks every agent has: its sessions, usage, projects, models, and one project's (`<prefix>`). */
function usageBlocks(plugin: Plugin, w: Words, usage: (days: number, account: unknown) => Promise<Usage>) {
  const [sessions, usageBlock, projects, models, project] = USAGE_BLOCKS(w.prefix)
  const noun = w.noun ?? "session", count = w.count ?? "session"
  const working = (min: number) => (!w.estimate ? `, ${fmtMin(min)} working` : "")
  plugin.block(sessions, async (ctx) => {
    const data = await usage(30, ctx.options.account)
    const now = bullets(data.live.map((s) => `${w.state(s)}: ${sessionLine(s)}`), `No ${w.name} ${noun} is open.`)
    const open = new Set(data.live.map((s) => s.id))
    const recent = bullets(data.sessions.filter((s) => !open.has(s.id)).map((s) => `${sessionLine(s)} (${ago(s.last)})`)
      .slice(0, Math.trunc(Number(ctx.options.recent || 5))), `No ${noun}s yet.`)
    return section(`${w.name} sessions`, "### Now", now, "### Recent", recent, `_Costs ${w.value}._`, ...(w.more?.(data) ?? []))
  })
  plugin.block(usageBlock, async (ctx) => {
    const days = daysOf(ctx.options.days)
    const data = await usage(days, ctx.options.account)
    const today = data.days[data.days.length - 1], p = data.plan
    const vs = p && p.monthly ? `, ${((data.total.cost / p.monthly) * 30 / days).toFixed(1)}x the ${p.name} plan's price` : ""
    const worked = w.estimate ? (today.active_min >= 1 ? `, about ${fmtMin(today.active_min)} working` : "") : working(today.active_min)
    const head = `Today: ${money(today.cost)} ${w.value}, ${tokens(today.tokens)} tokens, ${plural(today.sessions, count)}${worked}. ` +
      `Last ${days} days: ${money(data.total.cost)}${vs}.`
    const rows = data.days.slice(-7).reverse().filter((d) => d.tokens).map((d) => `${d.date}: ${money(d.cost)}, ${tokens(d.tokens)} tokens` +
      (d.active_min >= 1 ? working(d.active_min) : ""))
    return section(`${w.name} usage`, head, bullets(rows, "Nothing this week."))
  })
  plugin.block(projects, async (ctx) => {
    const days = daysOf(ctx.options.days)
    const data = await usage(days, ctx.options.account)
    const rows = data.projects.map((p) => `${p.name}: ${money(p.cost)}, ${tokens(p.tokens)} tokens, ${plural(p.sessions, count)}` +
      (p.active_min >= 1 ? working(p.active_min) : ""))
    return section(`${w.name} by project, last ${days} days`, bullets(rows, `No ${noun}s yet.`), `_Costs ${w.value}._`)
  })
  plugin.block(models, async (ctx) => {
    const days = daysOf(ctx.options.days)
    const data = await usage(days, ctx.options.account)
    return section(`${w.name} by model, last ${days} days`, bullets(data.models.map((m) => `${m.name}: ${money(m.cost)}, ${tokens(m.tokens)} tokens`), "None yet."), `_Costs ${w.value}._`)
  })
  plugin.block(project, async (ctx) => {
    // The names a project file answers to: the block's `project`, else its name, its path's folder, its repo.
    const ks = new Set(ctx.options.project ? [String(ctx.options.project).toLowerCase()]
      : [path.basename(ctx.path).replace(/\.[^.]*$/, ""), ...[ctx.fm.path, ctx.fm.repo].filter(Boolean).map((v) => path.basename(String(v).replace(/\/+$/, "")))]
        .map((k) => k.toLowerCase()))
    const data = await usage(30, ctx.options.account)
    const p = data.projects.find((x) => ks.has(String(x.name).toLowerCase()))
    if (!p) return section(w.name, `_No ${w.name} ${noun}s in this project in the last 30 days._`)
    const sessions = data.sessions.filter((s) => s.project === p.name).map((s) => `${sessionLine(s)} (${ago(s.last)})`).slice(0, 3)
    return section(w.name, `Last 30 days: ${money(p.cost)} ${w.value}, ${tokens(p.tokens)} tokens, ${plural(p.sessions, count)}${working(p.active_min)}.`,
      bullets(sessions))
  })
}
