// Hermes: what Hermes Agent (Nous Research) does on this machine, read from each home's SQLite database (state.db: the
// main home and its profiles), its memory and its scheduled jobs. Only hermes.connect writes: a line in its config.yaml.
import fs from "node:fs"
import path from "node:path"
import { isMap, isScalar, type Node, parseDocument, type Scalar } from "yaml"
import { accountsNamed, type AgentStart, ago, busyFirst, cap, codingAgent, cwds, expandHome, HOME, isoMicro as iso, notHere, num, processes,
  projectOf, quote, rebuilt, roots, scanDays, SqliteFile, Tally, terminalOf, vauMcpServer } from "../../../core/codingagents.ts"
import { bullets, HTTPError, localDate, localTime, OpError, Plugin, section } from "../../../core/plugins.ts"
import { type Item, sortBy } from "../../../core/vault.ts"
import { conversation, type Row, textOf } from "./transcript.ts"

export const plugin = new Plugin(import.meta.url)
/** A message's content read as bytes: node:sqlite's text ends at a NUL, and Hermes starts its JSON parts (an image
 *  with the text) with one ("\0json:"), so as text they came back empty. */
const CONTENT = "CAST(content AS BLOB) AS content"
const textCell = (v: unknown) => (v instanceof Uint8Array ? Buffer.from(v).toString("utf8") : typeof v === "string" ? v : null)

// ---------- homes: the main one (HERMES_HOME, else ~/.hermes) and its profiles (<home>/profiles/<name>)

type Account = { id: string; dir: string; label: string }
const PROFILE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** The main home: HERMES_HOME (its root when it names a profile), else ~/.hermes. */
function mainHome() {
  const env = process.env.HERMES_HOME?.trim()
  const home = env ? expandHome(env) : path.join(HOME, ".hermes")
  return path.basename(path.dirname(home)) === "profiles" ? path.dirname(path.dirname(home)) : home
}

/** Every home: the main one ("default") and each profile folder. */
function accounts(): Account[] {
  const main = mainHome()
  const out: Account[] = [{ id: "default", dir: main, label: "Default" }]
  let names: string[] = []
  try { names = fs.readdirSync(path.join(main, "profiles")).sort() } catch { /* none */ }
  for (const n of names) {
    const dir = path.join(main, "profiles", n)
    if (PROFILE.test(n) && n !== "default" && fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) out.push({ id: n, dir, label: cap(n) })
  }
  return out
}

const listed = (all: Account[]) => all.map((a) => a.id).join(", ")

const accountsFor = (id: unknown) => accountsNamed(accounts(), id, "Hermes profile")

/** The one home `id` names, the main one when it's empty; null when there's no such profile. */
function accountOf(id: unknown): Account | null {
  const all = accounts()
  return typeof id === "string" && id ? all.find((a) => a.id === id) ?? null : all[0]
}

// ---------- the database

/** Usage counted on a day: a model's share of a session (Hermes keeps it per session and model, not per request). */
type Use = { session: string; ts: number; day: string; model: string; cost: number | null; tokens: number; read: number; prompt: number }
/** A turn's minutes of work: from what the user said to the last row before they spoke again. */
type Turn = { session: string; day: string; min: number }
type Ses = { id: string; source: string; title: string; model: string; cwd: string; repo: string; branch: string; last: number }

const COUNTS = ["input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens"] as const

/** What a row cost: what was charged, else Hermes' estimate; null when Hermes had no price for it. */
function costOf(r: Item, tokens: number): number | null {
  if (num(r.actual_cost_usd) > 0) return num(r.actual_cost_usd)
  if (num(r.estimated_cost_usd) > 0) return num(r.estimated_cost_usd)
  return r.cost_status === "unknown" && tokens > 0 ? null : 0
}

class Store extends SqliteFile {
  uses: Use[] = []
  turns: Turn[] = []
  sessions = new Map<string, Ses>()
  parents = new Map<string, string>()
  prompts = new Map<string, string>()

  constructor(dir: string) {
    super(path.join(dir, "state.db"))
  }

  /** A message as said: Hermes keeps rewound and compacted ones with active = 0, and marks a compression's summary. */
  active() {
    return [this.has("messages", "active") && "active = 1", this.has("messages", "_compressed_summary") && "_compressed_summary = 0"]
      .filter(Boolean).join(" AND ") || "1"
  }

  /** Read the days the scans reach (scanDays) again, at most every 5 s and only when the database changed. */
  refresh() {
    if (!this.due(() => { this.uses = []; this.turns = []; this.sessions.clear() })) return
    const cutoff = Date.now() / 1000 - scanDays() * 86400
    const c = (k: string) => this.col("sessions", k)
    const last = `coalesce(${this.has("sessions", "last_activity_at") ? "last_activity_at" : "NULL"}, ended_at, started_at)`
    this.parents = new Map(this.all(`SELECT id, parent_session_id AS p FROM sessions WHERE parent_session_id IS NOT NULL`).map((r) => [r.id, r.p]))
    const rows = this.all(`SELECT id, source, title, model, cwd, ${c("git_repo_root")}, ${c("git_branch")}, ${c("cost_status")}, ${last} AS last,
        ${COUNTS.join(", ")}, estimated_cost_usd, actual_cost_usd FROM sessions WHERE ${last} >= ?`, cutoff)
    const ses = (r: Item): Ses => ({ id: r.id, source: String(r.source ?? ""), title: String(r.title ?? ""), model: String(r.model ?? ""),
      cwd: String(r.cwd ?? ""), repo: String(r.git_repo_root ?? ""), branch: String(r.git_branch ?? ""), last: num(r.last) })
    this.sessions = new Map(rows.map((r) => [r.id, ses(r)]))
    // A session's top (a compression's first part, a subagent's parent) names it, even when it's older than the scan.
    for (const r of rows) {
      const top = this.top(r.id)
      if (!this.sessions.has(top)) {
        const t = this.all(`SELECT id, source, title, model, cwd, ${c("git_repo_root")}, ${c("git_branch")}, ${last} AS last FROM sessions WHERE id = ?`, top)[0]
        if (t) this.sessions.set(top, ses(t))
      }
    }
    // Per model when Hermes split it (aux tasks too); what a session's totals have beyond that (a chat app's gateway
    // keeps only totals) counts for its own model.
    const byModel = new Map<string, Item[]>()
    for (const u of this.all(`SELECT session_id, model, task, ${COUNTS.join(", ")}, estimated_cost_usd, actual_cost_usd, cost_status, last_seen
      FROM session_model_usage WHERE session_id IN (SELECT id FROM sessions WHERE ${last} >= ?)`, cutoff)) {
      if (!byModel.has(u.session_id)) byModel.set(u.session_id, [])
      byModel.get(u.session_id)!.push(u)
    }
    const out: Use[] = []
    const add = (session: string, r: Item, ts: number, model: string) => {
      const n = COUNTS.map((k) => num(r[k]))
      const tokens = n.reduce((a, b) => a + b, 0)
      const cost = costOf(r, tokens)
      if (!tokens && !cost) return
      out.push({ session, ts, day: localDate(new Date(ts)), model: modelName(model), cost, tokens, read: n[2], prompt: n[0] + n[2] + n[3] })
    }
    for (const r of rows) {
      const parts = byModel.get(r.id) ?? []
      for (const u of parts) add(r.id, u, (num(u.last_seen) || num(r.last)) * 1000, String(u.model ?? ""))
      const main = parts.filter((u) => !u.task)
      const rest: Item = { cost_status: r.cost_status }
      for (const k of [...COUNTS, "estimated_cost_usd", "actual_cost_usd"]) { const v = num(r[k]) - main.reduce((a, u) => a + num(u[k]), 0); rest[k] = v > 1e-9 ? v : 0 }
      add(r.id, rest, num(r.last) * 1000, String(r.model ?? ""))
    }
    this.uses = out
    const turns: Turn[] = []
    let sid = "", start = 0, end = 0
    const close = () => { if (sid && end > start) turns.push({ session: sid, day: localDate(new Date(start * 1000)), min: Math.min(end - start, 1800) / 60 }) }
    for (const m of this.all(`SELECT session_id AS s, role, timestamp AS t FROM messages WHERE timestamp >= ? AND ${this.active()}
      ORDER BY session_id, timestamp, id`, cutoff)) {
      if (m.s !== sid || m.role === "user") { close(); sid = m.s; start = end = num(m.t); if (m.role !== "user") start = end = 0 }
      else if (start) end = num(m.t)
    }
    close()
    this.turns = turns
  }

  /** The session at the top of a chain (a compression's first part, a subagent's parent): itself when it has none. */
  top(id: string) {
    let s = id
    for (let n = 0; this.parents.has(s) && n < 100; n++) s = this.parents.get(s)!
    return s
  }

  /** A session and the parts compression continued it in, in order (Hermes resumes the last one). */
  chain(id: string) {
    const out = [id]
    for (let n = 0; n < 100; n++) {
      const at = out[out.length - 1]
      const r = this.all(`SELECT ${this.col("sessions", "end_reason")} FROM sessions WHERE id = ?`, at)[0]
      if (r?.end_reason !== "compression") break
      const next = this.all(`SELECT id FROM sessions WHERE parent_session_id = ? AND coalesce(source, '') != 'tool'
        ORDER BY started_at DESC LIMIT 1`, at)[0]
      if (!next || out.includes(next.id)) break
      out.push(next.id)
    }
    return out
  }
}

const stores = new Map<string, Store>()
const storeOf = (a: Account) => {
  if (!stores.has(a.dir)) stores.set(a.dir, new Store(a.dir))
  return stores.get(a.dir)!
}
plugin.onUnload(() => { for (const s of stores.values()) s.close() })

// ---------- names

/** "anthropic/claude-sonnet-4.6" -> "claude-sonnet-4.6": the provider is in the id, not in the model's name. */
const modelName = (m: string) => m.split("/").pop() || m || "unknown"

/** Where a session without a folder came from: a chat app, a scheduled job. */
const SOURCES: Record<string, string> = { cli: "Terminal", tui: "Terminal", cron: "Scheduled jobs", api_server: "API", telegram: "Telegram",
  discord: "Discord", slack: "Slack", whatsapp: "WhatsApp", signal: "Signal", matrix: "Matrix", email: "Email", sms: "SMS",
  homeassistant: "Home Assistant", mattermost: "Mattermost", tool: "Subagents" }
const sourceName = (s: string) => SOURCES[s] ?? (s ? cap(s.replace(/_/g, " ")) : "Other")

/** A session's title, or its first prompt when Hermes hasn't named it. */
function titleOf(st: Store, s: { id: string; title: string } | undefined) {
  if (!s) return ""
  if (s.title) return s.title
  if (!st.prompts.has(s.id)) {
    const r = st.all(`SELECT ${CONTENT} FROM messages WHERE session_id = ? AND role = 'user' AND ${st.active()} ORDER BY timestamp, id LIMIT 1`, s.id)[0]
    const text = textOf(textCell(r?.content)).replace(/_\(\w+\)_/g, "").replace(/\s+/g, " ").trim().slice(0, 80)
    if (!text) return ""
    st.prompts.set(s.id, text)
  }
  return st.prompts.get(s.id)!
}

// ---------- usage

/** Every part of a chain counts in its top session; its project is the repository it ran in (else its folder), and a
 *  session without one (a chat app's) is under where it came from. */
function summary(days: number, accts: Account[]) {
  const t = new Tally(days)
  for (const a of accts) {
    const st = storeOf(a)
    st.refresh()
    const uses = st.uses.filter((u) => u.day >= t.start)
    const where = new Map<string, string>()
    for (const u of uses) {
      const top = st.top(u.session), s = st.sessions.get(top)
      if (!where.has(top)) where.set(top, s?.repo || s?.cwd || "")
    }
    const root = roots(new Set([...where.values()].filter(Boolean)))
    const keys = new Map<string, string>()
    for (const u of uses) {
      const sid = st.top(u.session), s = st.sessions.get(sid), dir = where.get(sid)!
      const key = dir ? root.get(dir)! : `\0source:${s?.source ?? ""}`
      keys.set(sid, key)
      const proj = dir ? t.project(key) : t.project(key, null, sourceName(s?.source ?? ""))
      const row = t.session(sid, () => ({ title: titleOf(st, s), root: dir ? key : "", project: proj.name, cwd: s?.cwd ?? "", model: s?.model ? modelName(s.model) : "",
        account: a.id, ...(accts.length > 1 ? { accountLabel: a.label } : {}) }))
      t.count({ ts: u.ts, day: u.day, cost: u.cost, tokens: u.tokens, read: u.read, prompt: u.prompt, model: u.model }, sid, proj, row)
    }
    for (const w of st.turns) {
      const sid = st.top(w.session)
      if (w.day >= t.start && keys.has(sid)) t.work(w.day, keys.get(sid)!, sid, w.min)
    }
  }
  return t.result(iso)
}

// ---------- Hermes running now

// What takes a value on Hermes' command line (the rest are switches or its subcommand).
const VALUED = new Set(["-z", "--oneshot", "--usage-file", "-m", "--model", "--provider", "--reasoning", "-t", "--toolsets", "-r",
  "--resume", "--in", "-s", "--skills", "-p", "--profile", "-q", "--query", "--query-file", "--image", "--format", "--max-turns", "--run-budget"])

type Proc = { pid: number; started: number; kind: string; resume: string; latest: boolean; profile: string; dir: string }

/** Hermes processes with a session of their own: `hermes` and `hermes chat`, as it runs them (its console script, maybe
 *  through its Python), never its gateway, dashboard or other subcommands. */
async function sessionProcesses(): Promise<Proc[]> {
  const procs: Proc[] = []
  for (const { pid, started, command } of await processes()) {
    const args = command.trim().split(/\s+/)
    const at = /^python[\d.]*w?$/i.test(path.basename(args[0])) ? 1 : 0
    if (path.basename(args[at] ?? "") !== "hermes") continue
    const p: Proc = { pid, started, kind: "interactive", resume: "", latest: false, profile: "", dir: "" }
    let sub = ""
    for (let i = at + 1; i < args.length; i++) {
      const [a, eq] = args[i].startsWith("--") && args[i].includes("=") ? [args[i].slice(0, args[i].indexOf("=")), args[i].slice(args[i].indexOf("=") + 1)] : [args[i], null]
      const value = () => eq ?? args[++i] ?? ""
      if (a === "-r" || a === "--resume") { p.resume = value(); p.latest = p.resume === "latest" }
      else if (a === "-p" || a === "--profile") p.profile = value().toLowerCase()
      else if (a === "--in") p.dir = value()
      else if (a === "-z" || a === "--oneshot") { p.kind = "run"; if (args[i + 1] && !args[i + 1].startsWith("-")) value() }
      else if (a === "-Q" || a === "--quiet") p.kind = "run"
      else if (a === "-c" || a === "--continue") { p.latest = true; if (eq === null && args[i + 1] && !args[i + 1].startsWith("-") && args[i + 1] !== "chat") i++ }
      else if (VALUED.has(a)) { if (eq === null) i++ }
      else if (!a.startsWith("-") && !sub) sub = a
    }
    if (sub && sub !== "chat") continue
    procs.push(p)
  }
  return procs
}

/** Hermes open now: each process and its session (the one it resumed, else the newest in its folder since it started),
 *  shown as its top session; working while its last row isn't the model's answer. */
async function live(recent: Item[], accts: Account[]) {
  const procs = (await sessionProcesses()).filter((p) => accts.some((a) => a.id === (p.profile || "default")))
  if (!procs.length) return []
  const dirs = await cwds(procs.map((p) => p.pid))
  const byId = new Map(recent.map((s) => [s.id, s]))
  const since = Math.min(...procs.map((p) => p.started)) / 1000 - 5
  const taken = new Set<string>()
  const out: Item[] = []
  for (const p of sortBy(procs, (x) => x.started, true)) {
    const a = accts.find((x) => x.id === (p.profile || "default"))!
    const st = storeOf(a)
    if (!st.open()) continue
    const cwd = p.dir ? path.resolve(dirs.get(p.pid) ?? "/", p.dir) : dirs.get(p.pid) ?? ""
    let id = ""
    if (p.resume && !p.latest) {
      const r = st.all(`SELECT id FROM sessions WHERE id = ?`, p.resume)[0]
      if (r) id = st.chain(r.id).pop()!
    } else {
      const cands = st.all(`SELECT id, cwd, started_at FROM sessions WHERE ended_at IS NULL AND source IN ('cli', 'tui')
        AND (started_at >= ? OR ? = 1) ORDER BY started_at DESC`, since, p.latest ? 1 : 0)
      id = cands.find((c) => !taken.has(c.id) && c.cwd === cwd && (p.latest || num(c.started_at) * 1000 >= p.started - 5000))?.id ?? ""
    }
    if (!id || taken.has(id)) continue
    taken.add(id)
    const s = st.all(`SELECT id, title, model, cwd, started_at FROM sessions WHERE id = ?`, id)[0]
    const top = st.top(id)
    const last = st.all(`SELECT role, tool_calls, timestamp FROM messages WHERE session_id = ? AND ${st.active()} ORDER BY timestamp DESC, id DESC LIMIT 1`, id)[0]
    const calls = (() => { try { return JSON.parse(String(last?.tool_calls ?? "null")) } catch { return null } })()
    const busy = !!last && (last.role === "user" || last.role === "tool" || (last.role === "assistant" && Array.isArray(calls) && calls.length > 0))
    const u = byId.get(top) ?? {}
    const topRow = st.sessions.get(top) ?? { id: top, title: String(s?.title ?? "") }
    out.push({ pid: p.pid, id: top, title: u.title || titleOf(st, topRow), name: "", project: u.project || projectOf(s?.cwd || cwd),
      status: busy ? "busy" : "idle", kind: p.kind, started: iso(p.started), since: iso((num(last?.timestamp) || num(s?.started_at)) * 1000),
      model: u.model || (s?.model ? modelName(String(s.model)) : null), cost: u.cost ?? 0, tokens: u.tokens ?? 0, cwd: s?.cwd || cwd,
      terminal: await terminalOf(plugin, p.pid), account: a.id, ...(accts.length > 1 ? { accountLabel: a.label } : {}) })
  }
  return busyFirst(out)
}

/** Live sessions and `days` of usage, of one home or all of them. Hermes has no plan or limits of its own. */
async function usage(days: number, account: unknown) {
  const accts = accountsFor(account)
  const s = summary(days, accts)
  return { plan: null, limits: null, live: await live(s.sessions, accts), ...s }
}

// ---------- one session's conversation (the view tab: view:hermes-session/<id>)

const SESSION_ID = /^[\w.:-]{4,100}$/
const talks = rebuilt<ReturnType<typeof conversation>>()

/** The session `id`, whichever home it's in. */
function findSession(id: string): { a: Account; st: Store; row: Item } | null {
  if (!SESSION_ID.test(id)) return null
  for (const a of accounts()) {
    const st = storeOf(a)
    const row = st.all(`SELECT id, source, title, model, cwd, ${st.col("sessions", "git_repo_root")}, ${st.col("sessions", "git_branch")}
      FROM sessions WHERE id = ?`, id)[0]
    if (row) return { a, st, row }
  }
  return null
}

/** A session's conversation and the parts compression continued it in, built again only when one of them changed. */
function talk(st: Store, id: string) {
  const ids = st.chain(id)
  const marks = ids.map(() => "?").join(", ")
  const n = st.all(`SELECT count(*) AS n, max(id) AS m FROM messages WHERE session_id IN (${marks})`, ...ids)[0] ?? {}
  const rows = () => (st.all(`SELECT role, ${CONTENT}, tool_calls, tool_call_id, tool_name, timestamp
    FROM messages WHERE session_id IN (${marks}) AND ${st.active()} ORDER BY timestamp, id`, ...ids) as Row[]).map((r) => ({ ...r, content: textCell(r.content) }))
  return talks(`${st.file}\0${id}`, `${ids.join()}:${n.n}:${n.m}`, () => conversation(rows()))
}

/** A session's title, folder, times, model and conversation (with the parts compression continued it in). */
function session(id: string) {
  const found = findSession(id)
  if (!found) return null
  const { st, row, a } = found
  const t = talk(st, id)
  const cwd = String(row.cwd ?? "")
  const dir = String(row.git_repo_root ?? "") || cwd
  return { id, title: String(row.title ?? "") || t.prompt, cwd, model: row.model ? modelName(String(row.model)) : "", first: t.first, last: t.last,
    branch: String(row.git_branch ?? ""), project: dir ? projectOf(dir) : sourceName(String(row.source ?? "")), account: a.id, entries: t.entries }
}

// ---------- Terminal runs it (the service "agent:hermes")

/** `hermes`, or `hermes -r <id>` in the folder it ran in, in the profile the terminal names or the session is in (`-p`);
 *  a first prompt seeds the session (`chat -q`). Hermes takes no added instructions, so `context` isn't passed. */
plugin.provide("agent:hermes", async ({ resume, profile, prompt }: AgentStart) => {
  const found = resume ? findSession(resume) : null
  if (resume && !found) return notHere("Hermes", resume)
  const a = found?.a ?? (profile ? accounts().find((x) => x.id === profile) : undefined)
  const env = process.env.HERMES_HOME ? `HERMES_HOME=${quote(mainHome())}` : ""
  return {
    command: [env, "hermes", a && a.id !== "default" && `-p ${quote(a.id)}`, resume && `-r ${quote(resume)}`, prompt && `chat -q ${quote(prompt)}`]
      .filter(Boolean).join(" "),
    cwd: found ? String(found.row.cwd ?? "") || null : null,
  }
})

// ---------- its memory (SOUL.md, memories/MEMORY.md and USER.md) and its scheduled jobs (cron/jobs.json)

const read = (file: string) => { try { return fs.readFileSync(file, "utf8") } catch { return null } }
/** A memory file's entries: Hermes separates them with a line of "§". */
const entries = (text: string | null) => (text === null ? null : text.split(/^[ \t]*§[ \t]*$/m).map((e) => e.trim()).filter(Boolean))

type Memory = { account: string; soul: string | null; memory: string[] | null; user: string[] | null }
function memory(a: Account): Memory {
  return { account: a.id, soul: read(path.join(a.dir, "SOUL.md")), memory: entries(read(path.join(a.dir, "memories", "MEMORY.md"))),
    user: entries(read(path.join(a.dir, "memories", "USER.md"))) }
}

type Job = { id: string; name: string; prompt: string; schedule: string; enabled: boolean; next: string | null
  last: string | null; status: string | null; error: string | null }
const str = (v: unknown) => (typeof v === "string" ? v : "")

/** How a job's schedule reads: as Hermes shows it, else from its kind ("0 7 * * *", "every 60m", "once at ..."). */
function scheduleOf(j: Item) {
  const s = j.schedule && typeof j.schedule === "object" ? j.schedule : {}
  return str(j.schedule_display) || str(s.display) || str(s.expr) || (s.minutes ? `every ${s.minutes}m` : "") ||
    (s.run_at ? `once at ${s.run_at}` : "") || str(j.schedule)
}

function jobs(a: Account): Job[] {
  let data: unknown
  try { data = JSON.parse(read(path.join(a.dir, "cron", "jobs.json")) ?? "null") } catch { data = null }
  const raw = Array.isArray(data) ? data : (data as Item)?.jobs
  const list: Item[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.entries(raw).map(([id, v]) => ({ id, ...(v as Item) })) : []
  return list.filter((j) => j && typeof j === "object").map((j) => {
    const prompt = str(j.prompt).replace(/\s+/g, " ").trim()
    return { id: String(j.id ?? ""), name: str(j.name) || prompt.slice(0, 60) || String(j.id ?? "Job"), prompt: prompt.slice(0, 300),
      schedule: scheduleOf(j), enabled: j.enabled !== false && j.state !== "paused", next: str(j.next_run_at) || null, last: str(j.last_run_at) || null,
      status: str(j.last_status) || null, error: str(j.last_error) || null }
  })
}

const oneHome = (id: unknown) => {
  const a = accountOf(id)
  if (!a) throw new HTTPError(404, `no Hermes profile '${id}' here (they are: ${listed(accounts())})`)
  return a
}
plugin.route("GET", "hermes/memory", (req) => memory(oneHome(req.query.account)))
plugin.route("GET", "hermes/cron", (req) => ({ account: oneHome(req.query.account).id, jobs: jobs(oneHome(req.query.account)) }))

// ---------- hermes.connect: Vaultite's MCP server in Hermes' config.yaml

type Server = { command: string; args: string[]; env?: Record<string, string> }

const yq = (s: string) => JSON.stringify(s) // a JSON string is a YAML double-quoted one
const entryLines = (s: Server, ind: string, step: string) => [`${ind}vaultite:`, `${ind}${step}command: ${yq(s.command)}`,
  `${ind}${step}args: [${s.args.map(yq).join(", ")}]`,
  ...(s.env ? [`${ind}${step}env:`, ...Object.entries(s.env).map(([k, v]) => `${ind}${step}${step}${k}: ${yq(v)}`)] : [])]
const same = (a: unknown, b: Server) => {
  const o = (a && typeof a === "object" ? a : {}) as Item
  return o.command === b.command && JSON.stringify(o.args) === JSON.stringify(b.args) && JSON.stringify(o.env ?? null) === JSON.stringify(b.env ?? null)
}

/** config.yaml with `mcp_servers.vaultite` set to `server`, as a small edit (every other line kept as written): the new
 *  text and whether it was added or updated, or null when it's already so. */
function withVaultite(text: string, server: Server): { text: string; how: "added" | "updated" } | null {
  const doc = parseDocument(text)
  const byHand = (why: string) => new OpError(`${why}: add this under mcp_servers by hand:\n${entryLines(server, "  ", "  ").join("\n")}`)
  if (doc.errors.length) throw new OpError(`config.yaml doesn't read as YAML (${doc.errors[0].message.split("\n")[0]}): fix it first`)
  const root = doc.contents
  if (root !== null && !isMap(root)) throw byHand("config.yaml isn't a list of settings")
  const lineStart = (i: number) => text.lastIndexOf("\n", i - 1) + 1
  // The end of the line a node ends on (its range may run on over blank lines).
  const lineEnd = (i: number) => {
    let e = i
    while (e > 0 && /\s/.test(text[e - 1])) e--
    const n = text.indexOf("\n", e)
    return n < 0 ? text.length : n
  }
  const indentOf = (n: Node) => text.slice(lineStart(n.range![0]), n.range![0])
  const pair = root?.items.find((p) => isScalar(p.key) && p.key.value === "mcp_servers")
  let out: { text: string; how: "added" | "updated" }
  if (!pair) {
    const pre = text.trim() ? (text.endsWith("\n") ? "\n" : "\n\n") : ""
    out = { text: `${text.trim() ? text : ""}${pre}mcp_servers:\n${entryLines(server, "  ", "  ").join("\n")}\n`, how: "added" }
  } else {
    const key = pair.key as Scalar, v = pair.value as Node | null
    if (v === null || (isScalar(v) && v.value === null) || (isMap(v) && v.flow && !v.items.length)) {
      // `mcp_servers:` with nothing under it (or {}): that line becomes the list
      const s = lineStart(key.range![0]), e = lineEnd((v ?? key).range![1])
      out = { text: `${text.slice(0, s)}${indentOf(key)}mcp_servers:\n${entryLines(server, `${indentOf(key)}  `, "  ").join("\n")}${text.slice(e)}`, how: "added" }
    } else {
      if (!isMap(v) || v.flow) throw byHand("mcp_servers in config.yaml is written on one line")
      const first = v.items[0].key as Scalar
      const ind = indentOf(first), step = ind.slice(indentOf(key).length) || "  "
      if (/\S/.test(ind)) throw byHand("mcp_servers in config.yaml is written in a way this can't edit")
      const lines = entryLines(server, ind, step).join("\n")
      const mine = v.items.find((p) => isScalar(p.key) && p.key.value === "vaultite")
      if (mine) {
        if (same((mine.value as Node | null)?.toJSON?.() ?? null, server)) return null
        const k = mine.key as Scalar
        const s = lineStart(k.range![0]), e = lineEnd(((mine.value as Node | null) ?? k).range![1])
        out = { text: text.slice(0, s) + lines + text.slice(e), how: "updated" }
      } else {
        const last = v.items[v.items.length - 1]
        const e = lineEnd(((last.value as Node | null) ?? (last.key as Node)).range![1])
        out = { text: `${text.slice(0, e)}\n${lines}${text.slice(e)}`, how: "added" }
      }
    }
  }
  // The edit must read as the old settings with only this one changed; anything else and the file stays as it is.
  const before = (doc.toJS() ?? {}) as Item, after = parseDocument(out.text)
  const want = { ...before, mcp_servers: { ...(before.mcp_servers && typeof before.mcp_servers === "object" ? before.mcp_servers : {}), vaultite: server } }
  if (after.errors.length || JSON.stringify(after.toJS()) !== JSON.stringify(want)) throw byHand("config.yaml couldn't be edited safely")
  return out
}

const tilde = (p: string) => (p.startsWith(HOME + path.sep) ? `~${p.slice(HOME.length)}` : p)

plugin.op({
  id: "hermes.connect",
  cli: "hermes connect",
  owner: "Hermes' settings on this machine",
  lock: false,
  summary: "Give Hermes Agent the vault's tools: add Vaultite's MCP server (vau mcp) to Hermes' config.yaml.",
  help: `Adds mcp_servers.vaultite to the config.yaml of Hermes' home on the machine the server runs on (~/.hermes, or a
profile's), as a small edit that keeps the rest of the file: Hermes then starts \`vau mcp\` and gets the vault's tools,
run by this server. Running it again changes nothing; a stale entry (the app moved) is updated. Hermes picks it up in its
next session, or after /reload-mcp; it needs Hermes' MCP support (its installer's; pip: hermes-agent[mcp]).

  vau hermes connect                 (the main home)
  vau hermes connect --account work  (the profile "work")`,
  kind: "write",
  params: { account: { type: "string", description: "which Hermes home: a profile's name; the main home (~/.hermes) when left out" } },
  run: (p: Item) => {
    const a = accountOf(p.account)
    if (!a) throw new OpError(`no Hermes profile '${p.account}' here (they are: ${listed(accounts())})`, 404)
    if (!fs.statSync(a.dir, { throwIfNoEntry: false })?.isDirectory()) throw new OpError(`Hermes isn't set up on this machine: there's no ${tilde(a.dir)} (install Hermes and run it once)`, 404)
    const file = path.join(a.dir, "config.yaml")
    const text = read(file)
    if (text === null && fs.existsSync(file)) throw new OpError(`can't read ${tilde(file)}`)
    // (Hermes' MCP client calls itself "mcp", the SDK's default: VAULTITE_AGENT says who writes)
    const base = vauMcpServer()
    const server = { ...base, env: { ...base.env, VAULTITE_AGENT: "hermes" } }
    const r = withVaultite(text ?? "", server)
    if (r) {
      const tmp = `${file}.vaultite-${process.pid}`
      fs.writeFileSync(tmp, r.text, { mode: fs.statSync(file, { throwIfNoEntry: false })?.mode ?? 0o600 })
      fs.renameSync(tmp, file)
    }
    return { file, account: a.id, changed: r?.how ?? "unchanged", server }
  },
  text: (r: Item) => r.changed === "unchanged"
    ? `${tilde(r.file)} already has Vaultite's MCP server (mcp_servers.vaultite): nothing changed.`
    : `${r.changed === "added" ? "Added" : "Updated"} Vaultite's MCP server in ${tilde(r.file)}: mcp_servers.vaultite runs \`${[r.server.command, ...r.server.args].join(" ")}\`. ` +
      "Hermes picks it up in its next session, or after /reload-mcp (with its MCP support: hermes-agent[mcp]).",
})

// ---------- blocks as text (GET /api/render)

codingAgent(plugin, { id: "hermes", name: "Hermes", prefix: "hermes", value: "as Hermes recorded it",
  state: (s) => (s.status === "busy" ? "Working" : "Idle"), sessionId: SESSION_ID, usage, session,
  accounts: () => accounts().map(({ id, label }) => ({ id, label })) })

const list = (xs: string[] | null, none: string) => (xs === null ? `_${none}_` : bullets(xs.map((e) => e.replace(/\n+/g, "\n  ")), "Empty."))
plugin.block("hermes-memory", (ctx) => {
  const m = memory(oneHome(ctx.options.account))
  const soul = m.soul?.trim() ? m.soul.trim().split("\n").map((l) => `> ${l}`.trimEnd()).join("\n") : "_No SOUL.md._"
  return section("Hermes memory", "### Its soul (SOUL.md)", soul, "### What it noted (MEMORY.md)", list(m.memory, "No MEMORY.md."),
    "### What it knows about you (USER.md)", list(m.user, "No USER.md."))
})

const at = (s: string) => { const d = new Date(s); return Number.isNaN(+d) ? s : `${localDate(d)} ${localTime(d)}` }
plugin.block("hermes-cron", (ctx) => {
  const rows = jobs(oneHome(ctx.options.account)).map((j) => `${j.name}: ${j.schedule}${j.enabled ? "" : " (paused)"}` +
    (j.enabled && j.next ? `, next ${at(j.next)}` : "") + (j.last ? `, last ran ${Number.isNaN(Date.parse(j.last)) ? j.last : ago(new Date(j.last).toISOString())}${j.status ? ` (${j.status})` : ""}` : ", never ran") +
    (j.error ? `: ${j.error.replace(/\s+/g, " ").slice(0, 200)}` : ""))
  return section("Hermes scheduled jobs", bullets(rows, "No scheduled jobs."))
})
