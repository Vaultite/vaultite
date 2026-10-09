// Codex: what OpenAI's Codex (the CLI, the IDE extension and the desktop app share its files) does on this machine, read
// from $CODEX_HOME; nothing is written anywhere. Value = the tokens at API list prices (PRICES), not what the plan costs.
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { type AgentStart, ago, busyFirst, cap, codingAgent, cwds, dayOf, HOME, limitRows, limitWindow, notHere, priceList, processes,
  projectOf, quote, readLines, roots, scanDays, stamp, Tally, terminalOf, throttled, Transcript, transcripts } from "../../../core/codingagents.ts"
import { Plugin, section } from "../../../core/plugins.ts"
import { type Item, sortBy } from "../../../core/vault.ts"
import { Conversation, titleOf, userText, WANTED } from "./rollout.ts"

export const plugin = new Plugin(import.meta.url)
const CODEX = process.env.CODEX_HOME || path.join(HOME, ".codex")
plugin.folders(() => [CODEX])

// US dollars per million tokens: input, cached input, output (reasoning is part of output), from the published API
// list (LiteLLM's table). A model takes the longest id it starts with, a whole word (gpt-5.1-codex-max -> gpt-5.1).
const price = priceList<[number, number, number]>({
  "gpt-6.1-sol": [2, 0.1, 10], "gpt-6-sol": [2, 0.2, 10], "gpt-6-luna": [0.1, 0.01, 0.5], "gpt-6-astra": [10, 1, 50],
  "gpt-5.6": [4, 0.4, 20], "gpt-5.6-sol": [4, 0.4, 20], "gpt-5.6-terra": [2, 0.2, 12], "gpt-5.6-luna": [0.2, 0.02, 1.2],
  "gpt-5.5": [5, 0.5, 30], "gpt-5.4": [2.5, 0.25, 15], "gpt-5.4-mini": [0.75, 0.075, 4.5], "gpt-5.4-nano": [0.2, 0.02, 1.25],
  "gpt-5.3-codex": [1.75, 0.175, 14], "gpt-5.2": [1.75, 0.175, 14],
  "gpt-5.1": [1.25, 0.125, 10], "gpt-5.1-codex-mini": [0.25, 0.025, 2], "gpt-5": [1.25, 0.125, 10], "gpt-5-codex": [1.25, 0.125, 10],
  "gpt-5-mini": [0.25, 0.025, 2], "gpt-5-nano": [0.05, 0.005, 0.4], "o3": [2, 0.5, 8], "o4-mini": [1.1, 0.275, 4.4],
  "codex-mini": [1.5, 0.375, 6],
}, "-")
// ChatGPT plans (planType) and their monthly price, to compare the API value with.
const PLANS: Record<string, [string, number | null]> = {
  free: ["Free", 0], go: ["Go", 8], plus: ["Plus", 20], pro: ["Pro", 200], team: ["Team", null], business: ["Business", null],
  enterprise: ["Enterprise", null], edu: ["Edu", null],
}

const iso = (ts: number | null) => (ts ? new Date(ts * 1000).toISOString() : null)

/** gpt-6.1-sol -> GPT-6.1 Sol, gpt-5.1-codex-max -> GPT-5.1 Codex Max, o4-mini -> o4 Mini. */
function modelName(model: string) {
  const m = /^gpt-([\d.]+)(?:-(.*))?$/.exec(model)
  if (m) return [`GPT-${m[1]}`, ...(m[2] ?? "").split("-").filter(Boolean).map(cap)].join(" ")
  const [first, ...rest] = model.split("-")
  return [first, ...rest.map(cap)].join(" ") || model
}

// ---------- the rollouts ($CODEX_HOME/sessions/**/rollout-*.jsonl, archived_sessions/), read as they grow
// Tokens as ccusage counts them: only when a session's running total changed; forks replay their parent's, counted once.

/** A response: when, which model, where, which session, tokens (uncached input, cached input, output), the local day. */
type Resp = { ts: number; model: string; cwd: string; session: string; n: [number, number, number]; day: string }
type Turn = { ts: number; session: string; cwd: string; ms: number; day: string }
/** What's known of a session from its file. */
type Meta = { id: string; file: string; cwd: string; model: string; title: string; source: string; first: number; last: number
  /** The last turn event: a turn started (it's working) or ended. */
  state: "started" | "complete" | ""; stateTs: number }
/** Per file: where reading stopped, and what it needs to read on. */
type FileState = { offset: number; meta: Meta; total: number[] | null; subagent: boolean }

const FILE_ID = /rollout-[\dT-]+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
const USAGE_KEYS = ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"]
const int = (v: unknown) => Math.max(Math.trunc(Number(v) || 0), 0)

class Scan {
  files = new Map<string, FileState>()
  resp = new Map<string, Resp>()   // time|model|counts -> the response (once across files)
  turns = new Map<string, Turn>()  // turn id -> how long it took
  names = new Map<string, string>() // session -> the name it was given
  limits: { observed: number; rl: Item } | null = null // the newest rate limits a session saw
  pruned = 0
  reach = scanDays()
  /** Read what was appended since the last time, at most every 5 s; all again once asked for older days. */
  refresh = throttled(5000, () => this.run(), () => this.reach < scanDays())

  private async run() {
    if (this.reach < scanDays()) { this.files.clear(); this.resp.clear(); this.turns.clear(); this.reach = scanDays() }
    const cutoff = Date.now() / 1000 - this.reach * 86400
    const names: string[] = []
    for (const dir of ["sessions", "archived_sessions"]) {
      try {
        for (const n of fs.readdirSync(path.join(CODEX, dir), { recursive: true }) as string[]) if (n.endsWith(".jsonl")) names.push(path.join(CODEX, dir, n))
      } catch { /* no Codex here */ }
    }
    for (const p of names) {
      let st: fs.Stats
      try { st = fs.statSync(p) } catch { continue }
      const f = this.files.get(p)
      if (st.mtimeMs / 1000 < cutoff || st.size === f?.offset) continue
      const id = FILE_ID.exec(path.basename(p))?.[1] ?? path.basename(p, ".jsonl")
      const fresh = !f || st.size < f.offset
      const state: FileState = fresh ? { offset: 0, total: null, subagent: false,
        meta: { id, file: p, cwd: "", model: "", title: "", source: "", first: 0, last: 0, state: "", stateTs: 0 } } : f
      this.files.set(p, state)
      state.offset = await readLines(p, state.offset, (l) => this.line(l, state))
    }
    this.readNames()
    if (Date.now() / 1000 - this.pruned > 3600) {
      for (const [k, r] of this.resp) if (r.ts < cutoff) this.resp.delete(k)
      for (const [k, t] of this.turns) if (t.ts < cutoff) this.turns.delete(k)
      this.pruned = Date.now() / 1000
    }
  }

  private readNames() {
    try {
      for (const line of fs.readFileSync(path.join(CODEX, "session_index.jsonl"), "utf8").split("\n")) {
        try {
          const d = JSON.parse(line)
          if (d?.id && typeof d.thread_name === "string") this.names.set(String(d.id), d.thread_name)
        } catch { /* a partial line */ }
      }
    } catch { /* none */ }
  }

  private line(line: Buffer, f: FileState) {
    // Cheap byte tests first: most lines are instructions, messages and tool output nobody needs here.
    let kind: string
    if (line.includes('"token_count"')) kind = "tokens"
    else if (line.includes('"task_started"') || line.includes('"task_complete"')) kind = "turn"
    else if (line.includes('"type":"session_meta"')) kind = "meta"
    else if (line.includes('"type":"turn_context"')) kind = "context"
    else if (!f.meta.title && (line.includes('"type":"UserMessage"') || line.includes('"type":"user_message"'))) kind = "title"
    else return
    let d: Item
    try {
      d = JSON.parse(line.toString("utf8"))
    } catch {
      return
    }
    const p = d?.payload
    if (!p || typeof p !== "object") return
    const ts = stamp(d.timestamp)
    const m = f.meta
    if (ts) { m.first ||= ts; m.last = Math.max(m.last, ts) }
    if (kind === "meta") {
      // A forked session starts with its parent's session_meta: only its own counts.
      if (p.id === m.id || !m.cwd) {
        m.cwd = String(p.cwd || m.cwd)
        const src = p.source
        m.source = typeof src === "string" ? src : src && typeof src === "object" ? Object.keys(src)[0] ?? "" : ""
        f.subagent = m.source === "subagent"
      }
      return
    }
    if (kind === "context") {
      if (typeof p.model === "string" && p.model) m.model = p.model
      if (typeof p.cwd === "string" && p.cwd) m.cwd = p.cwd
      return
    }
    if (kind === "title") {
      const text = p.type === "item_completed" && p.item?.type === "UserMessage" ? userText(p.item.content) : p.type === "user_message" ? String(p.message ?? "") : ""
      if (text.trim()) m.title = titleOf(text)
      return
    }
    if (kind === "turn") {
      if (p.type === "task_started") { m.state = "started"; m.stateTs = ts ?? m.stateTs }
      else if (p.type === "task_complete") {
        m.state = "complete"
        m.stateTs = ts ?? m.stateTs
        const ms = int(p.duration_ms) || (int(p.completed_at) - int(p.started_at)) * 1000
        // By its id alone: a fork replays its parent's turns, which count once (for the first file read).
        const key = p.turn_id ? String(p.turn_id) : `${m.id}:${ts}`
        if (ms > 0 && ts && !this.turns.has(key)) this.turns.set(key, { ts, session: m.id, cwd: m.cwd, ms, day: dayOf(ts) })
      }
      return
    }
    if (p.type !== "token_count" || !ts) return
    if (p.rate_limits && typeof p.rate_limits === "object" && (!p.rate_limits.limit_id || p.rate_limits.limit_id === "codex") &&
      (!this.limits || ts >= this.limits.observed)) this.limits = { observed: ts, rl: p.rate_limits }
    const info = p.info
    if (!info || typeof info !== "object") return
    const total = USAGE_KEYS.map((k) => int(info.total_token_usage?.[k]))
    if (f.total && total.every((v, i) => v === f.total![i])) return // the same total again: a rate limit update
    const last = info.last_token_usage && typeof info.last_token_usage === "object"
      ? USAGE_KEYS.map((k) => int(info.last_token_usage[k]))
      : total.map((v, i) => Math.max(v - (f.total?.[i] ?? 0), 0))
    f.total = total
    const [input, cached, output] = last
    if (!input && !cached && !output) return // a compaction's estimate: no tokens of its own
    const model = m.model || "gpt-5"
    const key = `${d.timestamp}|${model}|${last.join(",")}`
    if (!this.resp.has(key)) this.resp.set(key, { ts, model, cwd: m.cwd, session: m.id, n: [Math.max(input - cached, 0), Math.min(cached, input), output], day: dayOf(ts) })
  }

  /** Every session's meta, by id (a session's files: the newest wins). */
  sessions() {
    const out = new Map<string, Meta>()
    for (const f of this.files.values()) {
      const old = out.get(f.meta.id)
      if (!old || f.meta.last > old.last) out.set(f.meta.id, f.meta)
    }
    return out
  }
}

const scan = new Scan()
void scan.refresh() // the first read of a big history, before anyone asks

function cost(r: Resp) {
  const p = price(r.model)
  return p ? (r.n[0] * p[0] + r.n[1] * p[1] + r.n[2] * p[2]) / 1e6 : null
}

/** Codex's own worktrees (~/.codex/worktrees/<id>/<repo>) belong to their repository. */
const WORKTREES = path.join(CODEX, "worktrees") + "/"
const rootsOf = (cwds: Iterable<string>) => roots(cwds, (c) => (c.startsWith(WORKTREES) ? c.slice(WORKTREES.length).split("/").slice(1).join("/") || c : c))

async function summary(days: number) {
  await scan.refresh()
  const t = new Tally(days)
  const metas = scan.sessions()
  const rows = sortBy([...scan.resp.values()].filter((r) => r.day >= t.start), (r) => [r.ts, r.model, r.cwd, r.session])
  const turns = [...scan.turns.values()].filter((x) => x.day >= t.start)
  const root = rootsOf(new Set([...rows.map((r) => r.cwd), ...turns.map((x) => x.cwd)]))
  for (const r of rows) {
    const proj = root.get(r.cwd)!
    const s = t.session(r.session, () => ({ root: proj, cwd: r.cwd, title: scan.names.get(r.session) || metas.get(r.session)?.title || "" }))
    t.count({ ts: r.ts, day: r.day, cost: cost(r), tokens: r.n[0] + r.n[1] + r.n[2], read: r.n[1], prompt: r.n[0] + r.n[1], model: modelName(r.model) },
      r.session, t.project(proj), s, r.model)
  }
  for (const x of turns) t.work(x.day, root.get(x.cwd)!, x.session, x.ms / 60000)
  return t.result(iso, modelName)
}

// ---------- sessions running now

/** Codex processes (the CLI's native binary: the TUI or `codex exec`, not its app-server or the npm wrapper), with
 *  when each started (epoch s) and its folder. */
const codexProcesses = () => plugin.memo(2, async function codexProcesses() {
  const out = (await processes()).flatMap(({ pid, started, command }) => {
    const m = /^(\S+)(.*)$/.exec(command)
    if (!m || path.basename(m[1]) !== "codex" || /\b(app-server|exec-server|mcp-server|daemon|remote-control)\b/.test(m[2])) return []
    return [{ pid, started: started / 1000, exec: /^\s+(exec|e)\b/.test(m[2]), cwd: "" }]
  })
  const dirs = await cwds(out.map((p) => p.pid))
  for (const p of out) p.cwd = dirs.get(p.pid) ?? ""
  return out
})

/** Codex sessions open now: each process with the session it's writing (the newest in its folder since it started),
 *  working while a turn runs. A TUI not asked anything yet has none: listed only when in one of the app's terminals. */
async function live(recent: Item[]) {
  const byId = new Map(recent.map((s) => [s.id, s]))
  const metas = [...scan.sessions().values()]
  const taken = new Set<string>()
  const out: Item[] = []
  for (const p of sortBy(await codexProcesses(), (x) => -x.started)) {
    const m = sortBy(metas.filter((s) => s.cwd === p.cwd && s.last >= p.started - 5 && !taken.has(s.id)), (s) => -s.last)[0]
    const terminal = await terminalOf(plugin, p.pid)
    if (!m && !terminal) continue
    if (m) taken.add(m.id)
    const u = m ? byId.get(m.id) ?? {} : {}
    const busy = m?.state === "started"
    out.push({ pid: p.pid, id: m?.id ?? "", title: (m && (scan.names.get(m.id) || m.title)) || "", name: m ? scan.names.get(m.id) ?? "" : "",
      project: u.project || projectOf(p.cwd, rootsOf), status: busy ? "busy" : "idle", kind: p.exec ? "exec" : "interactive",
      cwd: p.cwd, started: iso(p.started), since: iso(m?.stateTs || p.started), model: m?.model ? modelName(m.model) : null,
      cost: u.cost ?? 0, tokens: u.tokens ?? 0, terminal })
  }
  return busyFirst(out)
}

// ---------- the plan and its limits

/** The codex binary: the server's PATH (launchd's) may not have it, and its npm wrapper needs node on PATH. */
function codexBin() {
  const dirs = [...(process.env.PATH ?? "").split(":"), "/opt/homebrew/bin", "/usr/local/bin", path.join(HOME, ".local", "bin")]
  return dirs.map((d) => path.join(d, "codex")).find((p) => { try { return fs.statSync(p).isFile() } catch { return false } }) ?? null
}

/** Asks `codex app-server` (JSON-RPC over stdio, one JSON object per line) for the account and its rate limits. */
function appServer(): Promise<{ account: Item | null; limits: Item | null } | null> {
  const bin = codexBin()
  if (!bin) return Promise.resolve(null)
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: [path.dirname(process.execPath), path.dirname(bin), process.env.PATH].filter(Boolean).join(":") }
    const child = spawn(bin, ["app-server"], { stdio: ["pipe", "pipe", "ignore"], env })
    const got: { account: Item | null; limits: Item | null } = { account: null, limits: null }
    let buf = "", done = false
    const finish = (v: typeof got | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.kill()
      resolve(v)
    }
    const timer = setTimeout(() => finish(got.limits ? got : null), 15000)
    const send = (m: Item) => { try { child.stdin.write(JSON.stringify(m) + "\n") } catch { finish(null) } }
    child.on("error", () => finish(null))
    child.on("exit", () => finish(got.limits ? got : null))
    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8")
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let m: Item
        try { m = JSON.parse(line) } catch { continue }
        if (m.id === 1) {
          if (m.error) return finish(null)
          send({ method: "initialized" })
          send({ id: 2, method: "account/read", params: {} })
          send({ id: 3, method: "account/rateLimits/read" })
        } else if (m.id === 2) got.account = m.result?.account ?? null
        else if (m.id === 3) { got.limits = m.result ?? null; finish(got) }
      }
    })
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "vaultite", title: "Vaultite", version: "1.0" } } })
  })
}

/** What ChatGPT says now, asked at most once a minute (a failure too, so a missing login isn't asked for every block).
 *  memo() tells its functions apart by name: these have one. */
const account = () => plugin.memo(60, async function chatgptAccount() { return { at: Date.now() / 1000, got: await appServer() } })

function label(minutes: number) {
  if (minutes === 300) return "Current session"
  if (minutes === 10080) return "This week"
  if (minutes >= 40000 && minutes <= 45000) return "This month"
  return minutes % 1440 === 0 ? `${minutes / 1440} days` : `${Math.round(minutes / 60)} hours`
}

const window = (id: string, minutes: number, used: number, resets: number | null, now: number) =>
  limitWindow(id, label(minutes), minutes, used, resets, now, iso)

async function limits() {
  const now = Date.now() / 1000
  const { at, got } = await account()
  const snap = got?.limits?.rateLimitsByLimitId?.codex ?? got?.limits?.rateLimits
  if (snap && typeof snap === "object") {
    const wins = (["primary", "secondary"] as const).flatMap((k) => {
      const w = snap[k]
      return w && typeof w.usedPercent === "number" ? [window(k, int(w.windowDurationMins), w.usedPercent, w.resetsAt ?? null, now)] : []
    })
    if (wins.length) return { source: "ChatGPT account", observed: iso(at), windows: wins, plan: String(snap.planType ?? got?.account?.planType ?? "") }
  }
  // Without the app server: what the newest session was told.
  await scan.refresh()
  const seen = scan.limits
  if (!seen || now - seen.observed > 7 * 86400) return null
  const wins = (["primary", "secondary"] as const).flatMap((k) => {
    const w = seen.rl[k]
    return w && typeof w.used_percent === "number" ? [window(k, int(w.window_minutes), w.used_percent, w.resets_at ?? null, now)] : []
  })
  return wins.length ? { source: "last session", observed: iso(seen.observed), windows: wins, plan: String(seen.rl.plan_type ?? "") } : null
}

function planOf(type: string) {
  const hit = PLANS[type.toLowerCase()]
  return hit ? { name: hit[0], monthly: hit[1] || null } : type ? { name: type.charAt(0).toUpperCase() + type.slice(1), monthly: null } : null
}

/** Limits, live sessions, and `days` of usage. */
async function usage(days: number) {
  const s = await summary(days)
  const lim = await limits()
  const plan = planOf(lim?.plan ?? "")
  return { plan, limits: lim && { source: lim.source, observed: lim.observed, windows: lim.windows },
    live: await live(s.sessions), ...s }
}

// ---------- one session's conversation (the view tab: view:codex-session/<id>)

const SESSION_ID = /^[0-9a-f-]{8,64}$/i
const read = transcripts((file) => new Transcript(file, () => new Conversation(FILE_ID.exec(path.basename(file))?.[1] ?? path.basename(file, ".jsonl")), WANTED))

/** A session's rollout: the one the scan knows, else found by its id in the file names (older than the scan keeps). */
async function sessionFile(id: string): Promise<string | null> {
  if (!SESSION_ID.test(id)) return null
  await scan.refresh()
  const known = scan.sessions().get(id)
  if (known && fs.existsSync(known.file)) return known.file
  for (const dir of ["sessions", "archived_sessions"]) {
    try {
      const hit = (fs.readdirSync(path.join(CODEX, dir), { recursive: true }) as string[]).find((n) => n.endsWith(".jsonl") && n.includes(id))
      if (hit) return path.join(CODEX, dir, hit)
    } catch { /* none */ }
  }
  return null
}

async function transcript(id: string) {
  const file = await sessionFile(id)
  return file ? read(file) : null
}

/** A session's title, folder, times, model and conversation (the view tab: view:codex-session/<id>). */
async function session(id: string) {
  const t = await transcript(id)
  if (!t) return null
  const { head } = t.talk
  return { ...head, title: scan.names.get(id) || head.title, model: head.model ? modelName(head.model) : "",
    project: head.cwd ? projectOf(head.cwd, rootsOf) : "", entries: t.talk.entries }
}

// ---------- Terminal runs it (the service "agent:codex")

/** `codex`, or `codex resume <id>` in the folder it ran in. Nothing more: any `-c` makes it run without its shared
 *  background server, so no context (it reads the vault's AGENTS.md itself) and no hooks. */
plugin.provide("agent:codex", async ({ resume, prompt }: AgentStart) => {
  const t = resume ? await transcript(resume) : null
  if (resume && !t) return notHere("Codex", resume)
  return { command: resume ? `codex resume ${quote(resume)}${prompt ? ` ${quote(prompt)}` : ""}` : prompt ? `codex -- ${quote(prompt)}` : "codex",
    cwd: t?.talk.head.cwd || null }
})

// ---------- blocks as text (GET /api/render)

plugin.block("codex-limits", async () => {
  const lim = await limits()
  const p = planOf(lim?.plan ?? "")
  if (!lim) return section("Codex plan limits", "_No limits read yet: they come from ChatGPT through the codex CLI, or from Codex's last session._")
  return section("Codex plan limits", limitRows(lim.windows), `_${p ? `${p.name} plan, from` : "From"} the ${lim.source}, ${ago(lim.observed)}._`)
})

codingAgent(plugin, { id: "codex", name: "Codex", prefix: "codex", value: "estimated at list prices", state: (s) => (s.status === "busy" ? "Working" : "Idle"),
  sessionId: SESSION_ID, usage, session, updated: (ms) => new Date(ms).toISOString() })
