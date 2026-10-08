// Activity: who did what and how fast the app answers. Callers on this machine are looked up as a request starts (a quick
// curl is gone by its end); events are kept on this machine, not the vault, since one per request would churn iCloud.
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { monitorEventLoopDelay } from "node:perf_hooks"
import {
  bullets, hookCommand, HTTPError, LOADED, localDate, localTime, Plugin, processTable, section, type Proc, type RequestEnd, type RequestStart,
} from "../../../core/plugins.ts"
import { joinPath, Kind } from "../../../core/vault.ts"
import { buildRecap, type Sources } from "./build.ts"
import { groupOf, parseRecap, RECAP_GROUPS, type RecapEntry, type RecapGroup, renderRecap } from "./recap.ts"
import { ACTION_KINDS, actionsOf, type Action, type Actor, type ActivityEvent, type ActivityList, type ActivitySummary, type ClientPerf, type Minute, type Perf, type RouteStat, type SlowRequest } from "./model.ts"

export const plugin = new Plugin(import.meta.url)

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000
const KEEP = 5000 // events in memory (the rest are read from the files when asked)
const MERGE = 90_000 // the same thing again within this long is one event with a count
const CLAIM = 2500 // how long a change on disk waits for an agent's hook to say it made it
const SLOW = 300 // ms: a request this slow is listed
const BOOT = Date.now()

// ---------- where it's kept

/** This vault's folder here: <LOCAL>/activity/<vault key>/. */
const dir = () => plugin.localDir()


function settings() {
  const s = plugin.loaded ? plugin.settings() : {}
  return { keep: Math.max(1, Number(s.keep_days) || 14), reads: s.reads !== false }
}

function append(kind: "events" | "perf", t: number, rows: unknown[]) {
  if (!rows.length) return
  try { fs.appendFileSync(path.join(dir(), `${kind}-${localDate(t)}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n") } catch (e) { if ((e as { code?: string }).code !== "ENOENT") console.error(e) } // its folder gone: nothing to keep
}

function readDay(kind: "events" | "perf", date: string): unknown[] {
  let text: string
  try { text = fs.readFileSync(path.join(dir(), `${kind}-${date}.jsonl`), "utf8") } catch { return [] }
  const out: unknown[] = []
  for (const line of text.split("\n")) { if (line) try { out.push(JSON.parse(line)) } catch { /* a torn line */ } }
  return out
}

/** Files older than keep_days go (at most once an hour). */
let pruned = 0
function prune() {
  if (Date.now() - pruned < HOUR) return
  pruned = Date.now()
  const oldest = localDate(Date.now() - settings().keep * DAY)
  try {
    for (const f of fs.readdirSync(dir())) {
      const m = /^(?:events|perf)-(\d{4}-\d\d-\d\d)\.jsonl$/.exec(f)
      if (m && m[1] < oldest) fs.rmSync(path.join(dir(), f))
    }
  } catch { /* gone */ }
}

// ---------- events

/** Events in memory, the last two days' then what happened since; each written as it happens and again when it grows,
 *  within FLUSH, so a restart (SIGTERM runs no exit hook) loses at most FLUSH. */
let events: ActivityEvent[] | null = null
const open = new Map<string, ActivityEvent>()
const dirty = new Set<ActivityEvent>()
const FLUSH = 3000
let seq = 0

/** One event per id: its last copy. */
function latest(rows: ActivityEvent[]) {
  const by = new Map<string, ActivityEvent>()
  for (const e of rows) if (e && e.id) by.set(e.id, e)
  return [...by.values()]
}

function loaded() {
  if (events) return events
  const now = Date.now()
  events = latest([...readDay("events", localDate(now - DAY)), ...readDay("events", localDate(now))] as ActivityEvent[])
  events.sort((a, b) => a.t - b.t)
  if (events.length > KEEP) events = events.slice(-KEEP)
  return events
}

const keyOf = (e: Pick<ActivityEvent, "actor" | "action" | "text">) => `${e.actor.kind}\0${e.actor.name}\0${e.actor.device ?? ""}\0${e.actor.terminal ?? ""}\0${e.action}\0${e.text}`

/** Record something done: merged into the same thing done by the same one within MERGE, else a new event. */
function record(e: Omit<ActivityEvent, "id">): ActivityEvent {
  const list = loaded()
  const key = keyOf(e)
  const was = open.get(key)
  if (was && e.t - (was.last ?? was.t) < MERGE) {
    was.last = e.t
    was.count = (was.count ?? 1) + 1
    if (e.ms !== undefined) was.ms = Math.max(was.ms ?? 0, e.ms)
    if (e.status !== undefined && e.status >= 400) was.status = e.status
    for (const p of e.paths ?? []) if (!was.paths?.includes(p)) (was.paths ??= []).push(p)
    changed(was)
    return was
  }
  const ev: ActivityEvent = { id: `${e.t.toString(36)}-${(seq++).toString(36)}`, ...e }
  if (ev.paths && !ev.paths.length) delete ev.paths
  // In time order (a caller looked up answers late).
  let i = list.length
  while (i > 0 && list[i - 1].t > ev.t) i--
  list.splice(i, 0, ev)
  if (list.length > KEEP) list.splice(0, list.length - KEEP)
  open.set(key, ev)
  changed(ev)
  return ev
}

/** An event is new or changed: written within FLUSH. */
function changed(e: ActivityEvent) {
  dirty.add(e)
  scheduleFlush()
}

/** Write the events that are new or changed since the last time. */
function flush() {
  const now = Date.now()
  for (const [k, e] of open) if (now - (e.last ?? e.t) >= MERGE) open.delete(k)
  const done = [...dirty]
  dirty.clear()
  // Each goes in the file of the day it started.
  const byDay = new Map<string, ActivityEvent[]>()
  for (const e of done.sort((a, b) => a.t - b.t)) {
    const d = localDate(e.t)
    byDay.set(d, [...(byDay.get(d) ?? []), e])
  }
  for (const rows of byDay.values()) append("events", rows[0].t, rows)
  prune()
}

let flushTimer: ReturnType<typeof setTimeout> | null = null
function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => { flushTimer = null; flush() }, FLUSH)
  flushTimer.unref()
}
process.on("exit", () => { try { if (events) flush(); rollMinute(true) } catch { /* exiting */ } })
plugin.onUnload(() => { if (events) flush() })

// ---------- who's calling

type Caller = { agent: string | null; name: string; terminal?: string; session?: string }
const AGENTS: [RegExp, string, string][] = [
  [/(^|\/)claude(\s|$)|@anthropic-ai\/claude-code|claude-code/, "claude-code", "Claude Code"],
  [/(^|\/)codex(\s|$)|@openai\/codex/, "codex", "Codex"],
  [/(^|\/)opencode(\s|$)/, "opencode", "OpenCode"],
  [/(^|\/)openclaw(\s|$)/, "openclaw", "OpenClaw"],
  [/(^|\/)cursor-agent(\s|$)|Cursor\.app/, "cursor", "Cursor"],
  [/(^|\/)gemini(\s|$)|@google\/gemini-cli/, "gemini", "Gemini CLI"],
  [/Claude\.app\/Contents\/MacOS\/Claude/, "claude-app", "Claude app"],
]
const AGENT_NAMES: Record<string, string> = { ...Object.fromEntries(AGENTS.map(([, id, name]) => [id, name])), claude: "Claude Code", chatgpt: "ChatGPT", mcp: "An MCP client", "ai-import": "AI import" }

const run = (cmd: string, args: string[]) => new Promise<string>((resolve) =>
  execFile(cmd, args, { timeout: 3000, maxBuffer: 4 << 20 }, (_e, out) => resolve(String(out ?? ""))))

type Table = Map<number, Proc>
/** Every process, one `ps` shared by the requests of 2 s (agents call in bursts); `fresh` asks again (a caller newer
 *  than the last one). */
const processes = (fresh = false) => processTable(fresh ? 0 : 2000)

/** Callers already named: by connection (a keep-alive one's next requests skip lsof) and by process. */
const byPort = new Map<number, [number, Caller | null]>(), byPid = new Map<number, [number, Caller | null]>()
const CALLER_TTL = 10_000
const cached = (m: Map<number, [number, Caller | null]>, k: number) => { const hit = m.get(k); return hit && Date.now() - hit[0] < CALLER_TTL ? hit : null }
function remember(m: Map<number, [number, Caller | null]>, k: number, c: Caller | null) {
  m.set(k, [Date.now(), c])
  if (m.size > 200) for (const [key, [at]] of m) if (Date.now() - at >= CALLER_TTL) m.delete(key)
  return c
}

/** The process at the other end of a loopback connection and its parents: the first coding agent names the caller, else
 *  the program itself. Null when it can't be found. */
async function lookup(port: number): Promise<Caller | null> {
  const known = cached(byPort, port)
  if (known) return known[1]
  // Both at once, as the request starts: a quick caller (curl) is gone by the time it's answered.
  // (Linux: iproute2's ss, there by default, where lsof often isn't; it names the processes of this user's sockets)
  let [sockets, table] = await Promise.all([process.platform === "linux"
    ? run("ss", ["-Htnp", "state", "established", `( sport = :${port} )`])
    : run(fs.existsSync("/usr/sbin/lsof") ? "/usr/sbin/lsof" : "lsof", ["-nP", "-a", `-iTCP:${port}`, "-sTCP:ESTABLISHED", "-Fp"]), processes()])
  const pids = (process.platform === "linux" ? [...sockets.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]))
    : sockets.split("\n").filter((l) => l.startsWith("p")).map((l) => Number(l.slice(1)))).filter((p) => p && p !== process.pid)
  let pid = pids[0]
  if (pid) {
    const seen = cached(byPid, pid)
    if (seen) return remember(byPort, port, seen[1])
    if (!table.has(pid)) table = await processes(true) // newer than the shared table
  } else {
    // lsof too late: the newest program with this server's API URL on its command line (an API URL, since tmux's command
    // lines carry the server's address too).
    const self = new RegExp(`(localhost|127\\.0\\.0\\.1|\\[::1\\]):${process.env.PORT || 8793}/api/`)
    const newest = (t: Table) => [...t].filter(([p, x]) => p !== process.pid && self.test(x.args)).map(([p]) => p).sort((a, b) => b - a)[0]
    pid = newest(table)
    if (!pid) pid = newest(table = await processes(true))
  }
  if (!pid || !table.has(pid)) return null
  return remember(byPort, port, remember(byPid, pid, await name(pid, table)))
}

/** A process by the first coding agent among it and its parents, else by its program. */
async function name(pid: number, table: Table): Promise<Caller | null> {
  const chain: number[] = []
  for (let p = pid, n = 0; p > 1 && table.has(p) && n < 40; p = table.get(p)!.ppid, n++) chain.push(p)
  const first = table.get(pid)?.args ?? ""
  const prog = path.basename(first.split(/\s+/)[0] || "")
  for (const p of chain) {
    const hit = AGENTS.find(([re]) => re.test(table.get(p)!.args))
    if (hit) return { agent: hit[1], name: hit[2], ...(await terminalOf(chain)) }
  }
  if (/(^|\/)vau(\s|$)|core\/cli\.ts/.test(first)) return { agent: null, name: "vau CLI", ...(await terminalOf(chain)) }
  return prog ? { agent: null, name: prog, ...(await terminalOf(chain)) } : null
}

/** The app's terminal one of these processes runs in (Terminal's service), if any. */
async function terminalOf(pids: number[]): Promise<{ terminal?: string; session?: string }> {
  const t = await plugin.ask<{ id: string; title?: string } | null>("terminal:of-pids", null, pids)
  return t ? { terminal: t.id, ...(t.title ? { session: t.title } : {}) } : {}
}

const loopback = (a: string) => a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1"

/** Who a request is from, as far as its headers tell; `lookup` says the process should be asked. */
function whoFrom(s: RequestStart): { actor: Actor; lookup: boolean } {
  const c = s.client ?? ""
  if (c.startsWith("app")) return { actor: { kind: "you", name: "You", device: c.split("/")[1] || "web" }, lookup: false }
  // MCP's tools (plugins/core/mcp): the server calling itself, or `vau mcp`, for the client the session named.
  if (c === "mcp") return { actor: { kind: "agent", name: s.agent ? AGENT_NAMES[s.agent] ?? s.agent : "An MCP client" }, lookup: false }
  if (c === "cli") {
    if (s.agent) return { actor: { kind: "agent", name: AGENT_NAMES[s.agent] ?? s.agent }, lookup: loopback(s.remote) }
    return { actor: { kind: "cli", name: "vau CLI" }, lookup: loopback(s.remote) }
  }
  // The app's own requests that don't go through its fetch helper (a file's bytes, an upload): a browser.
  if (/^Mozilla\//.test(s.ua) && !s.agent) return { actor: { kind: "you", name: "You", device: /iPhone|Android/.test(s.ua) ? "phone" : "web" }, lookup: false }
  if (s.agent) return { actor: { kind: "agent", name: AGENT_NAMES[s.agent] ?? s.agent }, lookup: loopback(s.remote) }
  const ua = /^([A-Za-z-]+)/.exec(s.ua)?.[1]?.toLowerCase()
  return { actor: { kind: "script", name: s.forwarded ? "Another device" : ua || "A script" }, lookup: loopback(s.remote) && !s.forwarded }
}

function withCaller(a: Actor, c: Caller | null): Actor {
  if (!c) return a
  const term = { ...(c.terminal ? { terminal: c.terminal } : {}), ...(c.session ? { session: c.session } : {}) }
  if (c.agent) return { kind: "agent", name: AGENT_NAMES[c.agent] ?? c.name, ...term }
  if (a.kind === "cli") return { ...a, ...term }
  if (a.kind === "script") return { ...a, name: c.name, ...term }
  return { ...a, ...term }
}

// ---------- what a request did

type Did = { action: Action; text: string; paths: string[] } | null
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "")
const strip = (p: string) => p.replace(/\.md$/, "")

/** A request, worded ("Edited Notes/Idea.md"); null: not worth an event (the app reading, its own reports). */
/** A day's note, wherever daily notes are (Today's kind), for a tick's activity line. */
function dayFile(date: string) {
  const d = plugin.vault.has("days") ? plugin.vault.get("days", date) : null
  return d ? `${d.id}.md` : `${plugin.vault.has("days") ? plugin.vault.home("days") ?? "Daily" : "Daily"}/${date}.md`
}

function describe(method: string, route: string, query: Record<string, string>, body: unknown, byApp: boolean): Did {
  const parts = route.split("/")
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>
  const p = str(b.path) || str(query.path)
  // (MCP's own requests carry the messages; what each tool did is a request of its own, recorded as the agent's.)
  if (parts[0] === "activity" || parts[0] === "events" || parts[0] === "mcp") return null
  if (parts[0] === "ops" && parts[1] && method === "POST") return describeOp(parts[1], b, byApp)
  if (method === "GET" || method === "HEAD") {
    if (byApp || !settings().reads) return null
    if (route === "render") return { action: "read", text: p ? `Read ${p} as text` : "Read a page as text", paths: p ? [p] : [] }
    if (route === "file") return { action: "read", text: `Read ${p || "a file"}`, paths: p ? [p] : [] }
    if (route === "raw") return { action: "read", text: `Downloaded ${p || "a file"}`, paths: p ? [p] : [] }
    if (route === "search") return { action: "search", text: `Searched for "${(query.q ?? "").slice(0, 80)}"`, paths: [] }
    if (route === "state") return { action: "read", text: "Read everything the app shows (state)", paths: [] }
    if (route === "ui") return null
    return { action: "read", text: `Read /api/${route}${p ? ` for ${p}` : ""}`, paths: p ? [p] : [] }
  }
  // Writes.
  if (route === "artifact/state") return null // an artifact's own storage, written as it runs
  if (route === "file") {
    if (method === "PUT") return { action: "edit", text: `Edited ${p}`, paths: p ? [p] : [] }
    if (method === "POST") return { action: "create", text: `Created ${p}`, paths: p ? [p] : [] }
    if (method === "DELETE") return { action: "delete", text: `Deleted ${p}`, paths: p ? [p] : [] }
  }
  if (route === "file/move") { const f = str(b.from), t = str(b.to); return { action: "move", text: `Moved ${f} to ${t}`, paths: [f, t].filter(Boolean) } }
  if (route === "file/restore") return { action: "create", text: `Restored ${p} from the trash`, paths: p ? [p] : [] }
  if (route === "file/copy") return { action: "create", text: `Duplicated ${p}`, paths: p ? [p] : [] }
  if (route === "file/open") return { action: "ui", text: `${b.reveal ? "Showed" : "Opened"} ${p} in ${b.reveal ? (process.platform === "darwin" ? "Finder" : "its folder") : "its app"}`, paths: p ? [p] : [] }
  if (route === "folder") return { action: "create", text: `Made the folder ${p}`, paths: p ? [p] : [] }
  if (route === "upload") return { action: "create", text: `Added ${p}`, paths: p ? [p] : [] }
  if (route === "upload/name") return null
  if (route === "pins") return { action: "pin", text: `${b.pinned === false ? "Unpinned" : "Pinned"} ${p}`, paths: p ? [p] : [] }
  if (parts[0] === "config" && parts[1]) {
    const keys = Object.keys(b)
    const what: Record<string, string> = { plugins: "plugins and the sidebar", appearance: "the appearance", files: "the file tree's settings", pages: "the pinned pages", hotkeys: "hotkeys" }
    return { action: "settings", text: `Changed ${what[parts[1]] ?? parts[1]}${keys.length ? ` (${keys.slice(0, 4).join(", ")})` : ""}`, paths: [`.vaultite/${parts[1]}.json`] }
  }
  if (route === "ui") {
    const a = str(b.action)
    if (a === "open") return { action: "ui", text: `Opened ${str(b.path)} in the app`, paths: str(b.path) && !str(b.path).startsWith("view:") ? [str(b.path)] : [] }
    if (a === "command") return { action: "ui", text: `Ran the command ${str(b.id)} in the app`, paths: [] }
    if (a === "notify") return { action: "ui", text: `Showed "${str(b.text).slice(0, 80)}"`, paths: [] }
    return null
  }
  if (parts[0] === "workspaces") {
    if (parts[1] === "move") return { action: "move", text: "Moved tabs between workspaces", paths: [] }
    return { action: "settings", text: parts[1] ? `Changed workspace ${parts[1]}` : "Changed the workspaces", paths: [] }
  }
  if (route === "checks") return { action: "save", text: `${b.done === false ? "Unticked" : "Ticked"} ${str(b.routine)}${str(b.date) ? ` for ${str(b.date)}` : ""}`, paths: str(b.date) ? [dayFile(str(b.date))] : [] }
  if (route === "clip") return { action: "create", text: `Clipped ${str(b.url).slice(0, 120) || "a web page"}`, paths: [] }
  if (route === "interactions") return { action: "save", text: `Added to ${str(b.person)}'s timeline${str(b.kind) ? ` (${str(b.kind)})` : ""}`, paths: [] }
  if (route === "calendar/refresh") return { action: "request", text: "Refreshed the calendar", paths: [] }
  // A kind's collection: people, notes, logs...
  if (plugin.vault.has(parts[0])) {
    const kind = plugin.vault.kind(parts[0]).type
    const items = Array.isArray(body) ? body as Record<string, unknown>[] : [b]
    const name = (x: Record<string, unknown>) => str(x.title) || str(x.name) || str(x.ext_id)
    const ref = parts.slice(1).join("/")
    const names = items.map(name).filter(Boolean)
    const who = names.length > 1 ? `${names.length} ${kind}s` : names[0] || strip(ref) || `a ${kind}`
    if (method === "DELETE") return { action: "delete", text: `Deleted the ${kind} ${strip(ref)}`, paths: [] }
    if (method === "PUT") return { action: "save", text: `Changed the ${kind} ${who}`, paths: [] }
    return { action: "save", text: `${kind === "log" ? "Logged" : "Saved"} ${kind === "log" ? who : `the ${kind} ${who}`}`, paths: [] }
  }
  return { action: "request", text: `${method} /api/${route}${p ? ` for ${p}` : ""}`, paths: p ? [p] : [] }
}

// ---------- operations (POST /api/ops/<id>: core/ops.ts)

/** An op's kind (read, write, destructive): a plugin's from its definition, the core's by its area; null: unknown. */
function opKind(id: string): "read" | "write" | "destructive" | null {
  for (const p of LOADED) for (const o of p.ops) if (o.id === id) return o.kind
  if (/^(ops|docs)\./.test(id) || id === "ui.windows") return "read"
  if (id.startsWith("ui.")) return "write"
  return null
}

const quoted = (v: unknown, n = 80) => { const t = str(v).replace(/\s+/g, " "); return t.length > n ? `"${t.slice(0, n)}…"` : `"${t}"` }
const listOf = (v: unknown) => (Array.isArray(v) ? v.map(String) : str(v) ? str(v).split(",").map((x) => x.trim()).filter(Boolean) : [])

/** What an op call did, in the app's words (the ones that write the vault or drive the app, by name; the rest by their
 *  id and what they were about); a read is left out like the app's reads (`reads`: false, or the app's own). */
function describeOp(id: string, b: Record<string, unknown>, byApp: boolean): Did {
  const kind = opKind(id)
  if (kind === "read") {
    if (byApp || !settings().reads) return null
    const p = str(b.path)
    if (id === "docs.read") return { action: "read", text: `Read the docs${str(b.topic) ? ` on ${str(b.topic)}` : ""}`, paths: [] }
    return { action: "read", text: `Read ${id}${p ? ` for ${p}` : ""}`, paths: p ? [p] : [] }
  }
  const p = str(b.path)
  switch (id) {
    case "note.create": return { action: "save", text: `Saved the note ${str(b.title).slice(0, 120) || "untitled"}`, paths: [] }
    case "log.create": {
      const t = str(b.title)
      return { action: "save", text: t.startsWith("[") ? "Logged several things" : `Logged ${t.startsWith("{") ? "an entry" : t.slice(0, 120) || "something"}${str(b.area) ? ` (${str(b.area)})` : ""}`, paths: [] }
    }
    case "person.timeline-add": return { action: "save", text: `Added to ${str(b.person)}'s timeline${str(b.kind) ? ` (${str(b.kind)})` : ""}`, paths: [] }
    case "people.remember": {
      const about = str(b.about)
      return { action: "save", text: `Remembered ${quoted(b.fact)}${about && !/^(me|user|myself|i)$/i.test(about) ? (/^pref/i.test(about) ? " (how to work with them)" : ` about ${about}`) : ""}`, paths: [] }
    }
    case "clipper.save": return { action: "create", text: `Clipped ${str(b.url).slice(0, 120) || "a web page"}${b.inbox === true || b.inbox === "true" ? " into the inbox" : ""}`, paths: [] }
    case "inbox.add": return { action: "create", text: `Left ${quoted(b.title)} in the inbox`, paths: [] }
    case "inbox.read": return { action: "save", text: listOf(b.ids).length ? `Marked ${listOf(b.ids).length} inbox event${listOf(b.ids).length === 1 ? "" : "s"} read` : "Marked the inbox read", paths: [] }
    case "inbox.unread": return { action: "save", text: `Marked ${listOf(b.ids).length || "some"} inbox event${listOf(b.ids).length === 1 ? "" : "s"} unread`, paths: [] }
    case "inbox.clear": return { action: "delete", text: "Cleared the inbox's events", paths: [] }
    case "ui.open": return { action: "ui", text: `Opened ${p} in the app${str(b.split) ? ` (split ${str(b.split)})` : ""}`, paths: p && !p.startsWith("view:") ? [p] : [] }
    case "ui.command": return { action: "ui", text: `Ran the command ${str(b.id)} in the app`, paths: [] }
    case "ui.notify": return { action: "ui", text: `Showed ${quoted(b.text)}`, paths: [] }
    case "terminal.open": return { action: "run", text: `Opened a terminal${str(b.agent) ? ` running ${str(b.agent)}` : ""}`, paths: [] }
    case "terminal.resume": return { action: "run", text: `Resumed the session ${quoted(b.session, 60)} in a terminal`, paths: [] }
    case "terminal.send": return { action: "run", text: `Typed ${quoted(b.text, 60)} into the terminal ${str(b.id)}`, paths: [] }
    case "terminal.end": return { action: "delete", text: `Ended the terminal ${str(b.id)}`, paths: [] }
    case "terminal.tidy": return { action: "ui", text: "Closed the tabs of terminals that are gone", paths: [] }
    case "property.rename": return { action: "edit", text: `Renamed the property ${str(b.from)} to ${str(b.to)}`, paths: [] }
    case "property.retype": return { action: "edit", text: `Made the property ${str(b.key)} a ${str(b.type)}`, paths: [] }
    case "routine.check": return { action: "save", text: `${b.done === false || b.done === "false" ? "Unticked" : "Ticked"} ${str(b.routine)}${str(b.date) ? ` for ${str(b.date)}` : ""}`, paths: str(b.date) ? [dayFile(str(b.date))] : [] }
    case "ai-import.run": return { action: "create", text: `Imported ${p || "an AI's export"}`, paths: [] }
    case "ai-import.apply": return { action: "save", text: `Added the memories ticked in ${p}`, paths: [] }
  }
  // Any other op (a vault plugin's too): its id, and what it was about.
  const about = str(b.path) || str(b.title) || str(b.name) || str(b.person) || str(b.url) || str(b.id) || str(b.key)
  return { action: kind === "destructive" ? "delete" : "request", text: `Ran ${id}${about ? ` (${about.slice(0, 100)})` : ""}`, paths: p ? [p] : [] }
}

// ---------- requests, and the files they changed

/** Writes in progress or just done, to tie the files that change on disk to the request that wrote them: a file whose
 *  mtime falls between a write's start and end is that write's. */
type Write = { t0: number; t1: number; paths: string[]; event: ActivityEvent | null }
const writes: Write[] = []

plugin.onRequest((s) => {
  const route = s.route
  const byApp = (s.client ?? "").startsWith("app")
  const { actor, lookup: ask } = whoFrom(s)
  const write = s.method !== "GET" && s.method !== "HEAD" && !route.startsWith("activity") && !(route.startsWith("ops/") && opKind(route.slice(4)) === "read")
  const caller = ask && (write || !byApp) && !route.startsWith("activity") ? lookup(s.port).catch(() => null) : null
  const w: Write | null = write ? { t0: s.t - 5, t1: Infinity, paths: [], event: null } : null
  if (w) { writes.push(w); if (writes.length > 100) writes.splice(0, writes.length - 100) }
  return (end: RequestEnd) => {
    const late = timing(s, end, actor)
    if (w) w.t1 = Date.now() + 50
    const did = describe(s.method, route, s.query, end.body, byApp || actor.kind === "you")
    if (!did) return
    const finish = (who: Actor) => {
      if (late) late.who = who.name
      const paths = [...new Set([...did.paths, ...(w?.paths ?? [])])]
      const ev = record({ t: s.t, actor: who, action: did.action, text: did.text, paths, method: s.method, route, status: end.status, ms: Math.round(end.ms) })
      if (w) w.event = ev
    }
    if (caller) void caller.then((c) => finish(withCaller(actor, c)))
    else finish(actor)
  }
})

/** Changed on disk and not yet claimed by a request: waits CLAIM ms for an agent's hook to say it made them. */
let unclaimed: { t: number; paths: Set<string> } | null = null
let claimTimer: ReturnType<typeof setTimeout> | null = null
const QUIET = /^(\.vaultite\/(cache|generated|artifacts)\/|\.trash\/|\.git\/)|(^|\/)\.DS_Store$/

plugin.onChange((paths) => {
  if (!paths) return
  const now = Date.now()
  for (const p of paths) {
    if (QUIET.test(p) || ownRecap(p)) continue
    recapsDirty = true
    let mtime: number | null = null
    try { mtime = fs.statSync(plugin.vault.abs(p)).mtimeMs } catch { /* deleted or moved away */ }
    // Written by a request: its mtime is in its time; gone: a write that ended just now (a delete, a move).
    const w = mtime !== null
      ? writes.findLast((x) => mtime! >= x.t0 && mtime! <= x.t1)
      : writes.findLast((x) => x.t1 === Infinity || now - x.t1 < 1500)
    if (w) {
      if (!w.paths.includes(p)) w.paths.push(p)
      if (w.event && !w.event.paths?.includes(p)) { (w.event.paths ??= []).push(p); changed(w.event) }
      continue
    }
    if (mtime !== null && now - mtime > 10 * MINUTE) continue // an old file coming back (iCloud downloading it): nothing done now
    unclaimed ??= { t: now, paths: new Set() }
    unclaimed.paths.add(p)
  }
  if (unclaimed && !claimTimer) {
    claimTimer = setTimeout(() => {
      claimTimer = null
      const u = unclaimed
      unclaimed = null
      if (!u || !u.paths.size) return
      const ps = [...u.paths].sort()
      // Just after the server started, what it writes then (dashboards, pins, the rules' pointer lines): its own,
      // not someone's on disk.
      const self = u.t - BOOT < 20_000 && ps.every((p) => /^(AGENTS\.md|CLAUDE\.md|Dashboards\/|\.vaultite\/)/.test(p))
      record({ t: u.t, actor: self ? { kind: "script", name: "Vaultite" } : { kind: "disk", name: "On disk" }, action: "change",
        text: ps.length === 1 ? `Changed ${ps[0]}` : `Changed ${ps.length} files (${ps.slice(0, 3).join(", ")}${ps.length > 3 ? "..." : ""})`, paths: ps })
    }, CLAIM)
    claimTimer.unref()
  }
})

/** An agent's hook says it wrote `abs`: a change on disk waiting to be claimed is its, not "On disk". */
function claim(rel: string) {
  if (unclaimed?.paths.delete(rel) && !unclaimed.paths.size) unclaimed = null
}

// ---------- coding agents' hooks

/** Where a path is, for an event: vault-relative when it's in the vault, else ~/... */
function relOf(abs: string) {
  const home = os.homedir()
  for (const root of [plugin.vault.path, (() => { try { return fs.realpathSync(plugin.vault.path) } catch { return "" } })()]) {
    if (root && abs.startsWith(root + "/")) return { rel: abs.slice(root.length + 1), inVault: true }
  }
  return { rel: abs.startsWith(home + "/") ? `~/${abs.slice(home.length + 1)}` : abs, inVault: false }
}

/** The command for a coding agent's hook to report what it did (Terminal passes it to the agent it starts: AgentStart
 *  `report`): it sends the hook's JSON (on stdin) here, with the agent's name and its terminal. Never fails the hook. */
plugin.provide("activity:report", (agent: string, terminal: string) => {
  return hookCommand("activity/hook", { agent, terminal })
})

plugin.route("POST", "activity/hook", async (req) => {
  // The hook's JSON is the body; the report command names the agent and its terminal in the query.
  const b = (req.body ?? {}) as Record<string, unknown>
  const agent = str(req.query.agent) || "claude-code"
  const tool = str(b.tool_name)
  const input = (b.tool_input ?? {}) as Record<string, unknown>
  const terminal = str(req.query.terminal)
  const term = terminal ? await terminalInfo(terminal) : {}
  const actor: Actor = { kind: "agent", name: AGENT_NAMES[agent] ?? agent, ...term }
  const t = Date.now()
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
    const file = str(input.file_path) || str(input.notebook_path)
    if (!file) return { ok: true }
    const { rel, inVault } = relOf(file)
    if (inVault) claim(rel)
    record({ t, actor, action: tool === "Write" ? "create" : "edit", text: `${tool === "Write" ? "Wrote" : "Edited"} ${rel}`, paths: inVault ? [rel] : [] })
  } else if (tool === "Bash") {
    const cmd = str(input.command).split("\n")[0].slice(0, 200)
    if (cmd) record({ t, actor, action: "run", text: `Ran ${cmd}`, paths: [] })
  }
  return { ok: true }
})

async function terminalInfo(id: string): Promise<{ terminal?: string; session?: string }> {
  const t = await plugin.ask<{ title?: string } | null>("terminal:info", null, id)
  return { terminal: id, ...(t?.title ? { session: t.title } : {}) }
}

// ---------- the app's own interactions and timings

const ACTIONS = new Set<Action>(["edit", "create", "delete", "move", "save", "settings", "pin", "ui", "read", "search", "run", "open", "command", "drop", "change", "request"])
const clients = new Map<string, ClientPerf>()

plugin.route("POST", "activity", (req) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  const list = Array.isArray(b.events) ? b.events.slice(0, 200) : []
  const device = str(b.device) || "web"
  let n = 0
  for (const x of list as Record<string, unknown>[]) {
    const text = str(x.text).slice(0, 300)
    if (!text) continue
    const action = ACTIONS.has(x.action as Action) ? x.action as Action : "request"
    const t = typeof x.t === "number" && Math.abs(x.t - Date.now()) < DAY ? x.t : Date.now()
    const paths = Array.isArray(x.paths) ? x.paths.filter((p): p is string => typeof p === "string").slice(0, 20) : []
    record({ t, actor: { kind: "you", name: "You", device }, action, text, paths })
    n++
  }
  return { ok: true, recorded: n }
})

plugin.route("POST", "activity/perf", (req) => {
  const b = (req.body ?? {}) as ClientPerf
  const device = str(b.device) || "web"
  const was = clients.get(device)
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : undefined)
  const api = Array.isArray(b.api) ? b.api.slice(0, 50).filter((r) => r && typeof r.route === "string").map((r) => ({ route: r.route.slice(0, 80), n: num(r.n) ?? 0, p50: num(r.p50) ?? 0, max: num(r.max) ?? 0 })) : undefined
  const next: ClientPerf = { device, t: Date.now(),
    ttfb: num(b.ttfb) ?? was?.ttfb, ready: num(b.ready) ?? was?.ready, load: num(b.load) ?? was?.load, state: num(b.state) ?? was?.state,
    longTasks: num(b.longTasks) ?? 0, longMs: num(b.longMs) ?? 0, shift: typeof b.shift === "number" && isFinite(b.shift) && b.shift >= 0 ? Math.round(b.shift * 1000) / 1000 : 0,
    shifts: num(b.shifts) ?? 0, api: api ?? was?.api, heap: num(b.heap) ?? was?.heap }
  clients.set(device, next)
  return { ok: true }
})

plugin.route("DELETE", "activity", () => {
  events = []
  open.clear()
  try { for (const f of fs.readdirSync(dir())) if (f.endsWith(".jsonl")) fs.rmSync(path.join(dir(), f)) } catch { /* gone */ }
  return { ok: true }
})

// ---------- reading events

/** Events from `since` (ms) on, oldest first: memory, and the files for days before it. */
function between(since: number): ActivityEvent[] {
  const list = loaded()
  const memFrom = list.length ? list[0].t : Date.now()
  if (since >= memFrom) return list.filter((e) => e.t >= since)
  const older: ActivityEvent[] = []
  for (let d = since; localDate(d) <= localDate(memFrom); d += DAY) {
    for (const e of latest(readDay("events", localDate(d)) as ActivityEvent[])) if (e.t >= since && e.t < memFrom) older.push(e)
  }
  return [...older.sort((a, b) => a.t - b.t), ...list]
}

function query(q: Record<string, string>): ActivityList {
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 50))
  const before = Number(q.before) || Infinity
  const since = Number(q.since) || Date.now() - settings().keep * DAY
  const pathQ = q.path ? strip(q.path) : ""
  const acts = actionsOf(q.action)
  const at = (e: ActivityEvent) => e.last ?? e.t
  const all = between(since).filter((e) => at(e) < before &&
    (!q.actor || e.actor.kind === q.actor) && (!acts || acts.has(e.action)) && (!q.name || e.actor.name === q.name) &&
    (!pathQ || (e.paths ?? []).some((p) => strip(p) === pathQ)))
  // By when each last happened: a run still going (an editor's autosaves) stays on top.
  all.sort((a, b) => at(a) - at(b))
  return { events: all.slice(-limit).reverse(), total: all.length }
}

plugin.route("GET", "activity", (req) => query(req.query))

function summary(days: number): ActivitySummary {
  const now = Date.now()
  const bucket = days <= 1 ? "hour" : "day"
  const size = bucket === "hour" ? HOUR : DAY
  // Whole hours (or local days) ending with the current one.
  const n = bucket === "hour" ? 24 : days
  let start: number
  if (bucket === "hour") start = Math.floor(now / HOUR) * HOUR - (n - 1) * HOUR
  else { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (n - 1)); start = +d }
  const list = between(start)
  const buckets = Array.from({ length: n }, (_, i) => ({ t: bucket === "hour" ? start + i * size : +new Date(new Date(start).setDate(new Date(start).getDate() + i)), you: 0, agents: 0, other: 0 }))
  const actors = new Map<string, ActivitySummary["actors"][number]>()
  const files = new Map<string, ActivitySummary["files"][number]>()
  for (const e of list) {
    const c = e.count ?? 1
    let i = buckets.length - 1
    while (i > 0 && buckets[i].t > e.t) i--
    const b = buckets[i]
    if (e.actor.kind === "you") b.you += c; else if (e.actor.kind === "agent") b.agents += c; else b.other += c
    const k = `${e.actor.kind}\0${e.actor.name}`
    const a = actors.get(k) ?? { kind: e.actor.kind, name: e.actor.name, n: 0, last: 0 }
    a.n += c
    if ((e.last ?? e.t) >= a.last) { a.last = e.last ?? e.t; if (e.actor.terminal) { a.terminal = e.actor.terminal; a.session = e.actor.session } }
    actors.set(k, a)
    if (e.action === "read" || e.action === "search" || e.action === "open") continue // looked at, not touched
    for (const p of e.paths ?? []) {
      if (p.startsWith(".vaultite/")) continue
      const f = files.get(p) ?? { path: p, n: 0, last: 0, actors: [] }
      f.n += c
      f.last = Math.max(f.last, e.last ?? e.t)
      if (!f.actors.includes(e.actor.name)) f.actors.push(e.actor.name)
      files.set(p, f)
    }
  }
  return { since: start, total: list.reduce((s, e) => s + (e.count ?? 1), 0), bucket, buckets,
    actors: [...actors.values()].sort((a, b) => b.n - a.n),
    files: [...files.values()].sort((a, b) => b.n - a.n || b.last - a.last).slice(0, 12) }
}

plugin.route("GET", "activity/summary", (req) => summary(Math.min(31, Math.max(1, Number(req.query.days) || 1))))

// ---------- timings

/** Requests by route since the server started: a reservoir of recent durations for percentiles. */
type Agg = { n: number; errors: number; total: number; max: number; recent: number[] }
const routes = new Map<string, Agg>()
const slow: SlowRequest[] = []
let reqs = 0, errs = 0, syncs = 0
// This minute's requests (ms each), then one Minute per minute: the last 24 h in memory, each written to perf-<date>.
let cur: { t: number; ms: number[]; errors: number } = { t: Math.floor(Date.now() / MINUTE) * MINUTE, ms: [], errors: 0 }
let minutes: Minute[] | null = null
const lag = monitorEventLoopDelay({ resolution: 20 })
lag.enable()
plugin.onUnload(() => lag.disable())
plugin.onSync(() => { syncs++ })

/** A route as a pattern: its words kept, ids (anything with a digit, a space, a dot, a capital) as *. */
export function routeOf(route: string) {
  if (/^ops\/[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(route)) return route // an op by its id (POST /api/ops/note.create)
  return route.split("/").map((s) => (/^[a-z][a-z-]*$/.test(s) && s.length <= 24 ? s : "*")).slice(0, 4).join("/") || "/"
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0)
const r1 = (n: number) => Math.round(n * 10) / 10
const mb = (n: number) => Math.round(n / 1048576)

/** Count a request; a slow one is listed too (returned, so who it was can be filled in once known). */
function timing(s: RequestStart, end: RequestEnd, actor: Actor): SlowRequest | null {
  rollMinute()
  const key = `${s.method} ${routeOf(s.route)}`
  const a = routes.get(key) ?? { n: 0, errors: 0, total: 0, max: 0, recent: [] }
  const err = end.status >= 500
  a.n++; a.total += end.ms; a.max = Math.max(a.max, end.ms)
  if (err) a.errors++
  a.recent.push(end.ms)
  if (a.recent.length > 200) a.recent.shift()
  routes.set(key, a)
  reqs++
  if (err) errs++
  cur.ms.push(end.ms)
  if (err) cur.errors++
  if (end.ms < SLOW || s.route.startsWith("activity")) return null
  const row = { t: s.t, method: s.method, route: s.route.slice(0, 120), ms: Math.round(end.ms), status: end.status, who: actor.name }
  slow.push(row)
  if (slow.length > 30) slow.shift()
  return row
}

function loadMinutes() {
  if (minutes) return minutes
  const now = Date.now()
  minutes = [...readDay("perf", localDate(now - DAY)), ...readDay("perf", localDate(now))] as Minute[]
  minutes = minutes.filter((m) => m && now - m.t < DAY).sort((a, b) => a.t - b.t)
  return minutes
}

/** Close the minute that ended (or this one, `force`: exiting) into a Minute. */
function rollMinute(force = false) {
  const now = Math.floor(Date.now() / MINUTE) * MINUTE
  if (!force && now === cur.t) return
  const ms = cur.ms.sort((a, b) => a - b)
  const mem = process.memoryUsage()
  const m: Minute = { t: cur.t, n: ms.length, errors: cur.errors, p50: r1(pct(ms, 0.5)), p95: r1(pct(ms, 0.95)), max: r1(ms[ms.length - 1] ?? 0),
    lag: r1(lag.percentile(99) / 1e6), lagMax: r1(lag.max / 1e6), rss: mb(mem.rss), heap: mb(mem.heapUsed) }
  lag.reset()
  cur = { t: now, ms: [], errors: 0 }
  if (!plugin.loaded) return
  const list = loadMinutes()
  list.push(m)
  while (list.length && Date.now() - list[0].t > DAY) list.shift()
  append("perf", m.t, [m])
}
const roller = setInterval(() => { if (plugin.loaded) rollMinute() }, 15_000)
roller.unref()
plugin.onUnload(() => clearInterval(roller))

function perf(window: number): Perf {
  rollMinute()
  const mem = process.memoryUsage()
  const rs: RouteStat[] = [...routes].map(([route, a]) => {
    const s = [...a.recent].sort((x, y) => x - y)
    return { route, n: a.n, errors: a.errors, avg: r1(a.total / a.n), p50: r1(pct(s, 0.5)), p95: r1(pct(s, 0.95)), max: r1(a.max) }
  }).sort((a, b) => b.avg * b.n - a.avg * a.n)
  const since = Date.now() - window * MINUTE
  return {
    now: Date.now(), uptime: Math.round(process.uptime()), node: process.version, pid: process.pid,
    rss: mb(mem.rss), heap: mb(mem.heapUsed),
    lag: { p50: r1(lag.percentile(50) / 1e6), p99: r1(lag.percentile(99) / 1e6), max: r1(lag.max / 1e6) },
    requests: reqs, errors: errs, syncs, routes: rs, slow: [...slow].reverse(),
    minutes: loadMinutes().filter((m) => m.t >= since),
    clients: [...clients.values()].sort((a, b) => b.t - a.t),
  }
}

plugin.route("GET", "activity/perf", (req) => perf(Math.min(1440 * 7, Math.max(10, Number(req.query.minutes) || 1440))))

// ---------- operations (core/ops.ts): `vau activity`, `vau perf`

plugin.op({
  id: "activity.list",
  cli: "activity",
  summary: "What was done to the vault and the app, and by whom (you, coding agents, the CLI, scripts, changes on disk), newest first.",
  help: `One line each: when, who (an agent with its terminal's session name), what. Runs of the same thing (an editor's
autosaves) are one line with a count. Kept on the server's machine for keep_days (default 14).

  vau activity                       the last 30 things done
  vau activity --actor agent         only coding agents (Claude Code, Codex...)
  vau activity --action changes      only changes (edits, new files, moves, deletes, saves, on disk)
  vau activity --path Notes/Idea.md  everything done to one file`,
  kind: "read",
  params: {
    limit: { type: "integer", minimum: 1, maximum: 500, default: 30, description: "at most this many events" },
    actor: { type: "string", enum: ["you", "agent", "cli", "script", "disk"], description: "only this kind of actor" },
    action: { type: "string", description: `only these kinds of action, comma-separated: ${ACTION_KINDS.map((k) => k.id).join(", ")}, or an action (edit, open, run...)` },
    name: { type: "string", description: "only this actor (\"Claude Code\", \"You\")" },
    path: { type: "string", format: "path", description: "only what was done to this file" },
  },
  run: (p) => query(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))),
  text: (r: ActivityList) => {
    let last = ""
    const lines: string[] = []
    for (const e of r.events) {
      const d = new Date(e.t).toDateString()
      if (d !== last) { last = d; lines.push(`${lines.length ? "\n" : ""}${d}`) }
      const who = `${e.actor.name}${e.actor.device ? ` (${e.actor.device})` : ""}${e.actor.session ? ` [${e.actor.session}]` : ""}`
      lines.push(`  ${localTime(e.t)}  ${who}: ${e.text}${(e.count ?? 1) > 1 ? ` (x${e.count})` : ""}${e.status && e.status >= 400 ? ` [${e.status}]` : ""}`)
    }
    return lines.length ? lines.join("\n") : "Nothing recorded yet."
  },
})

plugin.op({
  id: "activity.perf",
  cli: "perf",
  summary: "How fast the server answers: its routes' and operations' timings, slow requests, memory, event loop delay, the app's load times.",
  help: `Timings since the server started (per route: count, average, p50, p95, max), the slowest recent requests, and
what each app window last reported (load, /api/state, long tasks).

  vau perf
  vau perf --routes 30`,
  kind: "read",
  params: {
    routes: { type: "integer", minimum: 1, default: 15, description: "how many routes to list, the busiest first" },
    minutes: { type: "integer", minimum: 10, maximum: 1440 * 7, default: 60, description: "the window for the per-minute timings" },
  },
  run: ({ routes, minutes }) => { const p = perf(minutes); return { ...p, routes: p.routes.slice(0, routes) } },
  text: (p: Perf) => {
    const pad = (s: string | number, w: number) => String(s).padStart(w)
    const out = [
      `Up ${Math.round(p.uptime / 60)} min, Node ${p.node}, ${p.rss} MB (heap ${p.heap} MB), event loop p99 ${p.lag.p99} ms`,
      `${p.requests} requests${p.errors ? `, ${p.errors} failed` : ""}, ${p.syncs} vault syncs`, "",
      `${"route".padEnd(34)} ${pad("n", 6)} ${pad("avg", 7)} ${pad("p50", 7)} ${pad("p95", 7)} ${pad("max", 7)}`,
      ...p.routes.map((r) => `${r.route.slice(0, 34).padEnd(34)} ${pad(r.n, 6)} ${pad(r.avg, 7)} ${pad(r.p50, 7)} ${pad(r.p95, 7)} ${pad(r.max, 7)}`),
    ]
    if (p.slow.length) out.push("", "Slow requests:", ...p.slow.slice(0, 8).map((s) => `  ${localTime(s.t)}  ${s.method} /api/${s.route}  ${s.ms} ms  (${s.who})`))
    if (p.clients.length) out.push("", "The app:", ...p.clients.map((x) => `  ${x.device}: load ${x.load ?? "?"} ms, state ${x.state ?? "?"} ms, ${x.longTasks ?? 0} long tasks, ${x.shifts ?? 0} layout shifts (${x.shift ?? 0})`))
    return out.join("\n")
  },
})

// ---------- blocks as text (GET /api/render)

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000)
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < DAY / 1000 ? `${Math.round(s / 3600)} h ago` : localDate(t)
}
const who = (a: Actor) => `${a.name}${a.device && a.kind === "you" ? ` (${a.device})` : ""}${a.session ? ` in "${a.session}"` : ""}`
/** An event as one line, its vault files as [[links]]. */
function line(e: ActivityEvent) {
  let text = e.text
  for (const p of e.paths ?? []) if (/\.md$/.test(p) && !p.startsWith(".")) text = text.replace(p, `[[${strip(p)}]]`)
  return `${localTime(e.t)} · ${who(e.actor)} · ${text}${(e.count ?? 1) > 1 ? ` (×${e.count})` : ""}${e.ms !== undefined && e.ms >= SLOW ? ` · ${e.ms} ms` : ""}`
}

plugin.block("activity", (ctx) => {
  const o = ctx.options
  const pathQ = o.path === "this" ? ctx.path : typeof o.path === "string" ? o.path : ""
  const { events: list } = query({ limit: String(Number(o.limit) || 30), ...(typeof o.actor === "string" ? { actor: o.actor } : {}), ...(pathQ ? { path: pathQ } : {}) })
  const byDay = new Map<string, ActivityEvent[]>()
  for (const e of list) byDay.set(localDate(e.t), [...(byDay.get(localDate(e.t)) ?? []), e])
  if (!byDay.size) return section("Activity", "_Nothing yet._")
  return section("Activity", ...[...byDay].map(([d, es]) => `### ${d}\n\n${bullets(es.map(line))}`))
})

plugin.block("activity-summary", (ctx) => {
  const s = summary(Math.max(1, Number(ctx.options.days) || 1))
  const span = s.bucket === "hour" ? "the last 24 hours" : `the last ${s.buckets.length} days`
  return section(`Activity in ${span}`, `${s.total} things done.`,
    `### Who\n\n${bullets(s.actors.map((a) => `${a.name}: ${a.n}, last ${ago(a.last)}`))}`,
    `### Files\n\n${bullets(s.files.map((f) => `${/\.md$/.test(f.path) ? `[[${strip(f.path)}]]` : f.path}: ${f.n} (${f.actors.join(", ")})`))}`)
})

const dur = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.floor(s / 86400)} d ${Math.round((s % 86400) / 3600)} h`)

plugin.block("perf-server", (ctx) => {
  const p = perf(Math.max(10, Number(ctx.options.minutes) || 1440))
  const busy = [...p.minutes].sort((a, b) => b.p95 - a.p95)[0]
  return section("Server", bullets([
    `Up ${dur(p.uptime)} (Node ${p.node})`, `Memory: ${p.rss} MB (heap ${p.heap} MB)`,
    `Event loop delay: p50 ${p.lag.p50} ms, p99 ${p.lag.p99} ms, max ${p.lag.max} ms`,
    `Requests: ${p.requests}${p.errors ? `, ${p.errors} failed` : ""}; vault syncs: ${p.syncs}`,
    busy && busy.p95 > 0 ? `Slowest minute: ${localTime(busy.t)}, p95 ${busy.p95} ms over ${busy.n} requests` : "",
  ]))
})

plugin.block("perf-routes", () => {
  const p = perf(60)
  const rows = p.routes.slice(0, 25).map((r) => `| ${r.route} | ${r.n} | ${r.avg} | ${r.p50} | ${r.p95} | ${r.max} | ${r.errors} |`)
  return section("Routes", rows.length ? ["| Route | Count | Avg ms | p50 | p95 | Max | Errors |", "|---|---|---|---|---|---|---|", ...rows].join("\n") : "_No requests yet._",
    `### Slow requests\n\n${bullets(p.slow.slice(0, 10).map((r) => `${localTime(r.t)} · ${r.method} /api/${r.route} · ${r.ms} ms · ${r.who}`), "None over 300 ms.")}`)
})

plugin.block("perf-app", () => {
  const p = perf(60)
  return section("The app", bullets(p.clients.map((c) => [
    `${c.device} (reported ${ago(c.t)})`,
    c.load !== undefined ? `loaded in ${c.load} ms` : "", c.state !== undefined ? `state ${c.state} ms` : "",
    c.longTasks ? `${c.longTasks} long tasks (${c.longMs} ms)` : "", c.shifts ? `${c.shifts} layout shifts (${c.shift})` : "",
    c.heap !== undefined ? `heap ${c.heap} MB` : "",
  ].filter(Boolean).join(", ")), "No app has reported yet."))
})

// ---------- day recaps (Recaps/<date>.md): what you did each day, in the vault to keep (recap.ts, build.ts)

plugin.kind(new Kind({
  type: "recap", collection: "recaps", folder: "Recaps",
  parse: (_fm, body, stem) => [{ date: stem, body }, /^\d{4}-\d\d-\d\d$/.test(stem) ? [] : ["a recap's name is its date: YYYY-MM-DD.md"]],
  render: (r) => [{}, r.body || ""],
  filename: (r, at) => joinPath(at.folder, str(r.date)), key: (r) => r.date ?? null,
}))
// (Read through activity/recap: a year of them is too much for every window's state.)
plugin.state(() => ({}))

const DATE = /^\d{4}-\d\d-\d\d$/
const GRACE = 3 * HOUR // after midnight, yesterday's recap still takes what arrives late (an edit on the phone, synced)
let recapsDirty = true
/** Recaps this server wrote, just now: not someone's change. */
const ownWrites = new Map<string, number>()
function ownRecap(p: string) { const t = ownWrites.get(p); return t !== undefined && Date.now() - t < 10_000 }

function recapSettings() {
  const s = plugin.loaded ? plugin.settings() : {}
  const folders = Array.isArray(s.capture_folders) ? s.capture_folders.map((x: unknown) => str(x).replace(/^\/+|\/+$/g, "")).filter(Boolean) : []
  return { on: s.recaps !== false, folders }
}

/** Local midnight of a date, and of the next day. */
function bounds(date: string): [number, number] {
  const [y, m, d] = date.split("-").map(Number)
  return [+new Date(y, m - 1, d), +new Date(y, m - 1, d + 1)]
}
const dayBefore = (date: string, n = 1) => { const [y, m, d] = date.split("-").map(Number); return localDate(new Date(y, m - 1, d - n)) }

/** The kinds that are records of your life (their plugin is about life or health): kept one by one even when an
 *  agent wrote them. */
function lifeTypes() {
  return new Set(LOADED.filter((p) => p.manifest.category === "life" || p.manifest.category === "health").flatMap((p) => p.kinds.map((k) => k.type)))
}

/** The Tasks plugin's own checkbox statuses (its settings, where Obsidian or this app keeps them). */
function taskStatuses(): Record<string, "todo" | "doing" | "done" | "cancelled"> {
  const map = { TODO: "todo", ON_HOLD: "todo", NON_TASK: "todo", IN_PROGRESS: "doing", DONE: "done", CANCELLED: "cancelled" } as const
  for (const dir of [".obsidian", ".vaultite/obsidian"]) {
    try {
      const d = JSON.parse(fs.readFileSync(plugin.vault.abs(`${dir}/plugins/obsidian-tasks-plugin/data.json`), "utf8"))
      const all = [...(d?.statusSettings?.coreStatuses ?? []), ...(d?.statusSettings?.customStatuses ?? [])] as { symbol?: string; type?: string }[]
      return Object.fromEntries(all.filter((x) => typeof x.symbol === "string" && x.type && x.type in map).map((x) => [x.symbol!, map[x.type as keyof typeof map]]))
    } catch { /* not there */ }
  }
  return {}
}

async function sourcesOf(date: string): Promise<Sources> {
  const [from, to] = bounds(date)
  const life = lifeTypes()
  return {
    from, to,
    events: between(from - HOUR).filter((e) => e.t < to + HOUR),
    changed: await plugin.ask<string[]>("history:changed", [], from),
    versions: (rel) => plugin.ask("history:versions", { gone: false, versions: [] }, rel),
    text: (rel, t) => plugin.ask<string | null>("history:text", null, rel, t),
    exists: (rel) => fs.existsSync(plugin.vault.abs(rel)),
    kindOf: (type) => ({ life: !!type && life.has(type), log: type === "log" }),
    captureFolders: recapSettings().folders,
    statuses: taskStatuses(),
  }
}

/** A day's entries made now from what this machine has (a few seconds' cache: every window asks). */
const built = new Map<string, { at: number; entries: Promise<RecapEntry[]> }>()
function build(date: string) {
  const hit = built.get(date)
  if (hit && Date.now() - hit.at < 20_000) return hit.entries
  const entries = sourcesOf(date).then(buildRecap)
  built.set(date, { at: Date.now(), entries })
  if (built.size > 40) built.delete(built.keys().next().value!)
  entries.catch(() => built.delete(date))
  return entries
}

/** The recap file of a date, if there's one. */
const recapOf = (date: string) => (plugin.vault.has("recaps") ? plugin.vault.get("recaps", date) : null)

/** Write a day's recap as it is now: its entries replaced, your own lines kept; nothing when nothing changed. A day
 *  with nothing done gets no file. */
async function writeRecap(date: string) {
  const entries = await build(date)
  const vault = plugin.vault
  return await vault.lock(async () => {
    await vault.sync()
    const old = recapOf(date)
    if (!old && !entries.length) return null
    const body = renderRecap(entries, parseRecap(old?.body ?? ""))
    if (old && old.body.trim() === body.trim()) return old.id + ".md"
    const rel = `${old ? old.id : joinPath(vault.home("recaps") ?? "Recaps", date)}.md`
    ownWrites.set(rel, Date.now())
    const saved = await vault.save("recaps", { date, body }, old?.id ?? null)
    if (saved) ownWrites.set(`${saved.id}.md`, Date.now())
    await vault.sync()
    return saved ? `${saved.id}.md` : null
  })
}

/** The days this machine already wrote (or found nothing for), so a recap you deleted isn't made again. */
function written(): Set<string> {
  try { return new Set(JSON.parse(fs.readFileSync(path.join(dir(), "recaps.json"), "utf8")).days ?? []) } catch { return new Set() }
}
function markWritten(dates: string[]) {
  const all = [...new Set([...written(), ...dates])].sort().slice(-400)
  try { fs.writeFileSync(path.join(dir(), "recaps.json"), JSON.stringify({ days: all })) } catch { /* its folder gone */ }
}

/** Today's recap when something changed, yesterday's too just after midnight; the first time, the days before that
 *  File history still has. One machine does it (Machines' first). */
export async function recapsDue() {
  if (!recapSettings().on || !plugin.vault.has("recaps")) return
  const now = Date.now(), today = localDate(now)
  const done = written()
  const late = now - bounds(today)[0] < GRACE
  const days = recapsDirty ? [today, ...(late ? [dayBefore(today)] : [])] : []
  recapsDirty = false
  // The days before, once: as far back as File history keeps versions (a week by default).
  for (let i = late ? 2 : 1; i <= 7; i++) { const d = dayBefore(today, i); if (!done.has(d) && !recapOf(d)) days.push(d) }
  for (const d of days) { built.delete(d); await writeRecap(d) }
  markWritten(days.filter((d) => d !== today))
}
plugin.every("recaps", { every: "5m" }, recapsDue)

type RecapDay = { date: string; entries: RecapEntry[]; live: boolean; path?: string }
/** A day as the app shows it: today (and yesterday just after midnight) made now, any other from its file, else
 *  made now from what this machine still has. */
async function recapDay(date: string): Promise<RecapDay> {
  const today = localDate(Date.now())
  const f = recapOf(date)
  const fresh = date === today || (date === dayBefore(today) && Date.now() - bounds(today)[0] < GRACE)
  if (f && !fresh) return { date, entries: parseRecap(f.body).entries, live: false, path: `${f.id}.md` }
  if (date > today) return { date, entries: [], live: false }
  return { date, entries: await build(date), live: true, ...(f ? { path: `${f.id}.md` } : {}) }
}

/** `days` days ending with `date`, newest first. */
async function recapDays(date: string, days: number) {
  const out: RecapDay[] = []
  for (let i = 0; i < days; i++) out.push(await recapDay(dayBefore(date, i)))
  return out
}

const dateOf = (v: unknown) => {
  const s = str(v).toLowerCase()
  if (!s || s === "today") return localDate(Date.now())
  if (s === "yesterday") return dayBefore(localDate(Date.now()))
  if (!DATE.test(s)) throw new HTTPError(400, `a date is YYYY-MM-DD, today or yesterday, not '${v}'`)
  return s
}

plugin.route("GET", "activity/recap", async (req) => ({ days: await recapDays(dateOf(req.query.date), Math.min(31, Math.max(1, Number(req.query.days) || 1))) }), { lock: false })

/** Each day's count of entries by group (Notes, Tasks...), `weeks` weeks to today: from the recap files (today's made now). */
async function recapCounts(weeks: number) {
  const today = localDate(Date.now())
  const from = dayBefore(today, weeks * 7 - 1)
  const out: Record<string, Partial<Record<RecapGroup, number>>> = {}
  const count = (date: string, entries: RecapEntry[]) => {
    const c: Partial<Record<RecapGroup, number>> = {}
    for (const e of entries) { const g = groupOf(e.kind); if (g) c[g] = (c[g] ?? 0) + Math.max(1, e.items.length) }
    out[date] = c
  }
  for (const r of plugin.vault.has("recaps") ? plugin.vault.items("recaps") : []) {
    if (typeof r.date === "string" && r.date >= from && r.date < today) count(r.date, parseRecap(r.body ?? "").entries)
  }
  count(today, await build(today))
  return { from, to: today, days: out }
}

plugin.route("GET", "activity/recap/counts", async (req) => recapCounts(Math.min(53, Math.max(1, Number(req.query.weeks) || 10))), { lock: false })

const recapText = (days: RecapDay[]) => days.map((d) =>
  `### ${d.date}\n\n${d.entries.length ? renderRecap(d.entries).trim() : "_Nothing recorded._"}`).join("\n\n")

plugin.op({
  id: "activity.recap",
  cli: "recap",
  summary: "What the user did on a day: notes made and changed (with what changed), tasks done or dropped, things captured, logs, agents' sessions.",
  help: `A day's recap, as its Recaps/<date>.md says it (today's made now). Kept in the vault for good; made from this
machine's Activity and File history, so a past day without a file can be made only while those still have it.

  vau recap                      today
  vau recap yesterday
  vau recap 2026-10-06 --days 7  that week, newest first
  vau recap 2026-10-06 --write   write (or refresh) that day's file now`,
  kind: "read",
  params: {
    date: { type: "string", description: "YYYY-MM-DD, today (the default) or yesterday" },
    days: { type: "integer", minimum: 1, maximum: 31, default: 1, description: "how many days, ending with that date" },
    write: { type: "boolean", description: "write that day's Recaps file now from what this machine has (its entries replaced, your lines kept)" },
  },
  args: ["date"],
  run: async ({ date, days, write }) => {
    const d = dateOf(date)
    if (write) { built.delete(d); await writeRecap(d) }
    return { days: await recapDays(d, days ?? 1) }
  },
  text: (r: { days: RecapDay[] }) => recapText(r.days),
})

plugin.block("recap", async (ctx) => {
  const o = ctx.options
  const stem = ctx.path.split("/").pop()!.replace(/\.md$/, "")
  const date = typeof o.date === "string" && o.date ? dateOf(o.date) : DATE.test(stem) ? stem : ctx.today
  const days = await recapDays(date, Math.max(1, Number(o.days) || 1))
  return section(typeof o.title === "string" && o.title ? o.title : days.length === 1 ? `What you did on ${date}` : `What you did, the ${days.length} days to ${date}`, recapText(days))
})

plugin.block("recap-stats", async (ctx) => {
  const c = await recapCounts(Math.max(1, Number(ctx.options.weeks) || 10))
  const total = (g: RecapGroup) => Object.values(c.days).reduce((n, d) => n + (d[g] ?? 0), 0)
  const active = Object.values(c.days).filter((d) => Object.values(d).some((n) => n)).length
  return section(`Since ${c.from}`, `${active} days with something done.`, bullets(RECAP_GROUPS.map((g) => total(g.id) ? `${g.label}: ${total(g.id)}` : "")))
})
