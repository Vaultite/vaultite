// Claude Code: what it does on this machine, in each of its accounts (config folders), read from its own files; nothing is
// written anywhere. Value = the tokens at API list prices (PRICES), not what was paid.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { type AgentMeter, type AgentStart, ago, codingAgent, dayOf, expandHome, findBin, HOME, isoOf, jsonLines, JsonlScan, limitRows,
  limitWindow, type Live, type SampleAsk, notOnThisMachine, priceList, processes, projectName, projectOf, shellQuote, projectRoots, epochSeconds, Tally, terminalOf, Transcript, transcripts,
  type Usage } from "../../../core/agents.ts"
import { bullets, localDate, Plugin, section } from "../../../core/plugins.ts"
import { type Item, sortBy } from "../../../core/vault.ts"
import { Conversation, WANTED } from "./transcript.ts"
import { SAMPLE_DIR, sample } from "./sample.ts"
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const int = (v: unknown) => Math.trunc(Number(v) || 0)

export const plugin = new Plugin(import.meta.url)
const DEFAULT_DIR = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(HOME, ".claude")
const APP_HISTORY = path.join(HOME, "Library", "Application Support", "Claude", "plan-usage-history.json")

// US dollars per million tokens: input, output, cache read, cache write (5 min), cache write (1 h), from the published
// API list. A model takes the longest id it starts with (claude-sonnet-5-5 -> claude-sonnet-5). Fast mode costs FAST x.
const price = priceList<[number, number, number, number, number]>({
  "claude-fable-5-1": [10, 50, 0.25, 12.5, 20], "claude-fable-5": [10, 50, 1, 12.5, 20],
  "claude-mythos-5": [10, 50, 1, 12.5, 20],
  "claude-opus-5-5": [4, 20, 0.2, 5, 8], "claude-opus-5": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-8": [5, 25, 0.5, 6.25, 10], "claude-opus-4-7": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-6": [5, 25, 0.5, 6.25, 10], "claude-opus-4-5": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-1": [15, 75, 1.5, 18.75, 30], "claude-opus-4": [15, 75, 1.5, 18.75, 30],
  "claude-sonnet-5": [2, 10, 0.2, 2.5, 4], "claude-sonnet-4": [3, 15, 0.3, 3.75, 6], "claude-3-7-sonnet": [3, 15, 0.3, 3.75, 6],
  "claude-haiku-4-5": [1, 5, 0.1, 1.25, 2], "claude-3-5-haiku": [0.8, 4, 0.08, 1, 1.6],
})
const FAST = 2
const PLANS: [string, string, number | null][] = [["max_20x", "Max 20x", 200], ["max_5x", "Max 5x", 100], ["max", "Max", null],
  ["pro", "Pro", 20], ["team", "Team", null], ["enterprise", "Enterprise", null]]

/** claude-opus-5-5 -> Opus 5.5, claude-haiku-4-5-20251001 -> Haiku 4.5. */
function modelName(model: string) {
  const parts = model.replace(/^claude-/, "").split("-").filter((p) => !(/^\d+$/.test(p) && p.length === 8))
  const words = parts.filter((p) => !/^\d+$/.test(p)), nums = parts.filter((p) => /^\d+$/.test(p))
  return [...words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()), nums.join(".")].join(" ").trim() || model
}

// ---------- accounts (Claude Code's config folders, CLAUDE_CONFIG_DIR)

type Account = { id: string; dir: string; label: string; private: boolean }
const ACCOUNT_ID = /^[a-z0-9]{1,32}$/

/** Every account: the default folder, its siblings <folder>-<name> with sessions, and folders the settings add; minus
 *  hidden ones. One folder is one account (a sibling's name wins over "default"). */
function accounts(): Account[] {
  const set = plugin.loaded ? (plugin.settings({}).accounts ?? {}) as Item : {}
  const byDir = new Map<string, string>([[DEFAULT_DIR, "default"]])
  const parent = path.dirname(DEFAULT_DIR), base = path.basename(DEFAULT_DIR)
  let names: string[] = []
  try { names = fs.readdirSync(parent) } catch { /* none */ }
  for (const n of names.sort()) {
    const id = n.startsWith(base + "-") ? n.slice(base.length + 1).toLowerCase() : ""
    if (ACCOUNT_ID.test(id) && fs.existsSync(path.join(parent, n, "projects"))) byDir.set(path.join(parent, n), id)
  }
  for (const [id, o] of Object.entries(set)) {
    if (ACCOUNT_ID.test(id) && o && typeof o === "object" && typeof o.dir === "string" && o.dir) byDir.set(expandHome(o.dir), id)
  }
  const out: Account[] = []
  for (const [dir, id] of byDir) {
    const o = (set[id] && typeof set[id] === "object" ? set[id] : {}) as Item
    if (o.hidden === true || out.some((a) => a.id === id)) continue
    out.push({ id, dir, label: typeof o.label === "string" && o.label ? o.label : cap(id), private: o.private === true })
  }
  return out
}

// Its accounts' folders: a block's menu opens them in Finder.
plugin.folders(() => accounts().map((a) => a.dir))

/** Where an account keeps its .claude.json: beside ~/.claude for the default folder, inside any other. */
const accountJson = (a: Account) => (a.dir === path.join(HOME, ".claude") ? path.join(HOME, ".claude.json") : path.join(a.dir, ".claude.json"))
/** A private account's sessions have this as their folder: one project, the account's. */
const PRIVATE = "\0private:"

// ---------- the transcripts (<account>/projects/**/*.jsonl), read as they grow; only the fields counted are kept

/** A response: when (epoch s), which model, where, which session, the token counts, fast mode, the local day. */
type Resp = { ts: number; model: string; cwd: string; session: string; n: [number, number, number, number, number]; fast: boolean; day: string }
const N_INPUT = 0, N_WRITE5 = 1, N_WRITE1H = 2, N_READ = 3, N_OUTPUT = 4

class Scan extends JsonlScan<Resp> {
  titles = new Map<string, [string, string]>()  // session -> [custom | ai, title]

  protected line(line: Buffer) {
    // Cheap byte tests first: most lines are tool output nobody needs.
    let kind: string
    if (line.includes('"type":"assistant"') && line.includes('"usage"')) kind = "assistant"
    else if (line.includes('"turn_duration"')) kind = "turn"
    else if (line.includes('"ai-title"') || line.includes('"custom-title"')) kind = "title"
    else return
    let d: Item
    try { d = JSON.parse(line.toString("utf8")) } catch { return }
    if (!d || typeof d !== "object" || Array.isArray(d)) return
    if (kind === "title") {
      const sid = d.sessionId
      if (d.type === "custom-title" && d.customTitle) this.titles.set(sid, ["custom", d.customTitle])
      else if (d.type === "ai-title" && d.aiTitle && this.titles.get(sid)?.[0] !== "custom") this.titles.set(sid, ["ai", d.aiTitle])
      return
    }
    const ts = epochSeconds(d.timestamp)
    if (ts === null) return
    if (kind === "turn") {
      if (d.subtype === "turn_duration" && d.durationMs) {
        this.turns.set(String(d.uuid), { ts, session: d.sessionId || "", cwd: d.cwd || "", ms: Math.trunc(d.durationMs), day: dayOf(ts) })
      }
      return
    }
    const m = d.message || {}
    const u = m.usage, model = m.model
    if (!u || typeof u !== "object" || Array.isArray(u) || !model || String(model).startsWith("<")) return
    const w = int(u.cache_creation_input_tokens)
    const w1 = int((u.cache_creation || {}).ephemeral_1h_input_tokens)
    const row: Resp = { ts, model, cwd: d.cwd || "", session: d.sessionId || "",
      n: [int(u.input_tokens), Math.max(w - w1, 0), w1, int(u.cache_read_input_tokens), int(u.output_tokens)],
      fast: u.speed === "fast", day: dayOf(ts) }
    // A streamed reply is logged once per content block; the largest counts are the final ones.
    const key = m.id ? `${m.id}:${d.requestId ?? "None"}` : String(d.uuid)
    const old = this.resp.get(key)
    if (old) row.n = old.n.map((a, i) => Math.max(a, row.n[i])) as Resp["n"]
    this.resp.set(key, old ? { ...old, n: row.n } : row)
  }
}

const scans = new Map<string, Scan>() // account folder -> its transcripts
const scanOf = (a: Account) => {
  let s = scans.get(a.dir)
  if (!s) scans.set(a.dir, (s = new Scan(() => [path.join(a.dir, "projects")])))
  return s
}
/** A session's title, whichever account it's in (never a private one's). */
function titleOf(id: string, accts = accounts()) {
  for (const a of accts) if (!a.private) { const t = scans.get(a.dir)?.titles.get(id)?.[1]; if (t) return t }
  return ""
}

function cost(r: Resp) {
  const p = price(r.model)
  if (!p) return null
  const c = (r.n[N_INPUT] * p[0] + r.n[N_OUTPUT] * p[1] + r.n[N_READ] * p[2] + r.n[N_WRITE5] * p[3] + r.n[N_WRITE1H] * p[4]) / 1e6
  return r.fast ? c * FAST : c
}

/** A worktree under .claude/worktrees/ belongs to the repository it's in. */
const rootsOf = (cwds: Iterable<string>) => projectRoots(cwds, (c) => c.split("/.claude/worktrees/")[0])
const nameOf = (root: string, accts: Account[] = []) => root.startsWith(PRIVATE)
  ? accts.find((a) => a.id === root.slice(PRIVATE.length))?.label ?? "Private" : projectName(root)

// The last summary, and what it was of: worked out again when the transcripts, the days asked for or the date changed.
let summarized: { key: string; out: ReturnType<typeof summarize> } | null = null

async function summary(days: number, accts: Account[]) {
  await Promise.all(accts.map((a) => scanOf(a).refresh()))
  const key = `${accts.map((a) => `${a.id}=${a.dir}:${a.private}:${a.label}:${scanOf(a).version}`).join(",")}:${days}:${localDate(new Date())}`
  if (summarized?.key !== key) summarized = { key, out: summarize(days, accts) }
  return summarized.out
}

function summarize(days: number, accts: Account[]) {
  const t = new Tally(days, (root) => nameOf(root, accts))
  // Each row knows its account; a private account's have its one folder.
  const acctOf = new Map<string, Account>() // session -> account
  const rows = sortBy(accts.flatMap((a) => [...scanOf(a).resp.values()].filter((r) => r.day >= t.start).map((r) => {
    acctOf.set(r.session, a)
    return a.private ? { ...r, cwd: PRIVATE + a.id } : r
  })), (r) => [r.ts, r.model, r.cwd, r.session])
  const turns = accts.flatMap((a) => [...scanOf(a).turns.values()].filter((x) => x.day >= t.start).map((x) => (a.private ? { ...x, cwd: PRIVATE + a.id } : x)))
  const root = rootsOf(new Set([...rows.map((r) => r.cwd), ...turns.map((x) => x.cwd)]))
  for (const r of rows) {
    const proj = root.get(r.cwd)!, a = acctOf.get(r.session)!
    const s = t.session(r.session, () => ({ root: proj, cwd: a.private ? "" : r.cwd, account: a.id, ...(a.private ? { private: true } : {}),
      title: a.private ? "" : scanOf(a).titles.get(r.session)?.[1] ?? "" }))
    t.count({ ts: r.ts * 1000, day: r.day, cost: cost(r), tokens: r.n.reduce((x, y) => x + y, 0), read: r.n[N_READ],
      prompt: r.n[N_INPUT] + r.n[N_WRITE5] + r.n[N_WRITE1H] + r.n[N_READ], model: modelName(r.model) },
    r.session, t.project(proj, proj.startsWith(PRIVATE) ? "" : proj), s, r.model)
  }
  for (const x of turns) t.work(x.day, root.get(x.cwd)!, x.session, x.ms / 60000)
  return t.result(modelName)
}

// ---------- sessions running now (<account>/sessions/<pid>.json)

/** ps's lstart ("Tue Sep 29 10:00:00 2026") -> epoch ms, in this machine's zone or in UTC; null when unreadable. */
function lstart(s: string, utc = false) {
  const m = /^\w{3} (\w{3}) +(\d+) (\d\d):(\d\d):(\d\d) (\d{4})$/.exec(s.trim().split(/\s+/).join(" "))
  if (!m) return null
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[1])
  const parts = [Number(m[6]), mon, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])] as const
  return utc ? Date.UTC(...parts) : +new Date(...parts)
}

const started = new Map<number, [unknown, boolean]>() // pid -> [the start its session file says, whether ps agreed]

function alive(pid: number, start: unknown) {
  try {
    process.kill(pid, 0)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") { started.delete(pid); return false }
  }
  if (!start) return true
  // A pid can be reused: the process must be the one that wrote the file (its start in UTC; ps says local time). Asked
  // once per process (a running process's start doesn't change): ps is a process of its own.
  const seen = started.get(pid)
  if (seen && seen[0] === start) return seen[1]
  let out: string
  try {
    out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 3000 })
  } catch (e) {
    return (e as { status?: number }).status === undefined // ps couldn't run: assume it's alive; no such process: not
  }
  if (!out.trim()) return false
  const ran = lstart(out), wrote = lstart(String(start), true)
  const same = ran === null || wrote === null || Math.abs(ran - wrote) < 5000
  started.set(pid, [start, same])
  return same
}

/** Each account's sessions running now (<account>/sessions/<pid>.json), their process still the one that wrote them. */
function running(accts: Account[]) {
  return accts.flatMap((a) => {
    const d = path.join(a.dir, "sessions")
    let names: string[] = []
    try { names = fs.readdirSync(d).filter((n) => n.endsWith(".json")).sort() } catch { return [] }
    return names.flatMap((n) => {
      let s: Item
      try { s = JSON.parse(fs.readFileSync(path.join(d, n), "utf8")) } catch { return [] }
      const pid = Math.trunc(Number(s.pid)), cwd = String(s.cwd || "")
      if (!Number.isFinite(pid) || isAsking(cwd) || !alive(pid, s.procStart)) return []
      return [{ a, s, pid, cwd, sid: typeof s.sessionId === "string" ? s.sessionId : "", tmux: typeof s.tmux === "string" ? s.tmux : "" }]
    })
  })
}

async function live(accts: Account[]): Promise<Live[]> {
  const ms = (v: unknown) => (typeof v === "number" ? v : null)
  return running(accts).map(({ a, s, pid, cwd, sid, tmux }) => ({ pid, id: sid, title: a.private ? "" : scanOf(a).titles.get(sid)?.[1] || s.name || "",
    name: a.private ? "" : s.name || "", status: s.status || "", kind: s.kind || "", cwd: a.private ? "" : cwd, started: ms(s.startedAt),
    since: ms(s.statusUpdatedAt), tmux, account: a.id, ...(a.private ? { project: a.label, private: true } : {}) }))
}

// ---------- plan limits: asked of Claude Code itself, else the status line's snapshots, else the Claude app's history;
// the plan from .claude.json

const LABELS: Record<string, string> = { session: "Current session", week: "This week", opus: "This week, Opus", sonnet: "This week, Sonnet" }

const window = (key: string, minutes: number, used: number, resets: number | null, now: number, label = LABELS[key]) =>
  limitWindow(key, label, minutes, used, resets, now)
/** The plan's windows Claude Code tells (its /usage and its status line): ours, and their minutes. */
const KEYS: Record<string, [string, number]> = { five_hour: ["session", 300], seven_day: ["week", 10080],
  seven_day_opus: ["opus", 10080], seven_day_sonnet: ["sonnet", 10080] }
const windows = (rl: Item, used: string, resets: (v: unknown) => number | null, now: number) => Object.entries(KEYS).flatMap(([name, [k, m]]) => {
  const w = rl[name]
  return w && typeof w === "object" && typeof w[used] === "number" ? [window(k, m, w[used], resets(w.resets_at), now)] : []
})

/** Where the asking runs: its brief session is told apart from the user's by this folder (live() leaves it out). */
const ASKING_DIR = path.join(os.tmpdir(), "vaultite-claude-limits")
let askingReal = ""
let sampleReal = ""
const isAsking = (cwd: string) => (!!askingReal && cwd === askingReal) || cwd === (sampleReal ||= (() => { try { return fs.realpathSync(SAMPLE_DIR) } catch { return "" } })())

/** Asks Claude Code (stream-json, its SDK's control requests; no prompt, so nothing is sent to a model) what the
 *  account's plan has used: what /usage shows, with the account's own login. Null when it can't say. */
function askClaude(dir: string): Promise<Item | null> {
  const bin = findBin("claude")
  if (!bin) return Promise.resolve(null)
  try { fs.mkdirSync(ASKING_DIR, { recursive: true }); askingReal ||= fs.realpathSync(ASKING_DIR) } catch { return Promise.resolve(null) }
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: [path.dirname(bin), process.env.PATH].filter(Boolean).join(":") }
  if (dir === path.join(HOME, ".claude")) delete env.CLAUDE_CONFIG_DIR
  else env.CLAUDE_CONFIG_DIR = dir
  return jsonLines<Item>(bin, ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
    "--strict-mcp-config"], { env, cwd: ASKING_DIR, ms: 20000, first: { type: "control_request", request_id: "init", request: { subtype: "initialize" } },
  hear: (m, send, done) => {
    if (m.type !== "control_response") return
    const r = m.response ?? {}
    if (r.subtype !== "success") done(null)
    else if (r.request_id === "init") send({ type: "control_request", request_id: "usage", request: { subtype: "get_usage", skipBehaviors: true } })
    else if (r.request_id === "usage") done(r.response ?? null)
  } })
}

/** What Claude Code says now, asked at most every two minutes (a failure too, so a missing login isn't asked for every
 *  block). memo() tells its functions apart by name: this has one. */
const asked = (dir: string) => plugin.memoStale(120, async function claudeUsage(d: string) { return { at: Date.now() / 1000, got: await askClaude(d) } }, dir)

const at = (v: unknown) => { const t = typeof v === "string" ? Date.parse(v) / 1000 : NaN; return Number.isFinite(t) ? t : null }

async function accountLimits(now: number, dir: string) {
  const { at: observed, got } = await asked(dir)
  const rl = got?.rate_limits_available ? got.rate_limits : null
  if (!rl || typeof rl !== "object") return null
  const wins = windows(rl, "utilization", at, now)
  // A week of one model only ("This week, Fable"), when the plan has one.
  for (const l of Array.isArray(rl.limits) ? rl.limits : []) {
    const name = l?.kind === "weekly_scoped" && typeof l.percent === "number" ? l.scope?.model?.display_name : null
    if (typeof name === "string" && name && !wins.some((w) => w.label === `This week, ${name}`))
      wins.push(window(`week-${name.toLowerCase()}`, 10080, l.percent, at(l.resets_at), now, `This week, ${name}`))
  }
  return wins.length ? { source: "Claude account", observed, windows: wins } : null
}

/** The newest status line snapshot of this account's sessions (written on every render of Claude Code's status line):
 *  in its folder, or ~/.claude's (a status line may write there whatever account runs it), with limits in it. */
function statusLineLimits(now: number, a: Account) {
  const files: string[] = []
  for (const dir of new Set([a.dir, path.join(HOME, ".claude")])) {
    const d = path.join(dir, "usage-snapshots")
    try { for (const n of fs.readdirSync(d)) if (n.endsWith(".json")) files.push(path.join(d, n)) } catch { /* none */ }
  }
  let projects: string[] = []
  try { projects = fs.readdirSync(path.join(a.dir, "projects")).map((n) => path.join(a.dir, "projects", n)) } catch { return null }
  const mine = (sid: string) => projects.some((p) => fs.existsSync(path.join(p, `${sid}.jsonl`)))
  const byAge = files.flatMap((f) => { try { return [[fs.statSync(f).mtimeMs / 1000, f] as const] } catch { return [] } }).sort((x, y) => y[0] - x[0])
  for (const [observed, f] of byAge) {
    if (now - observed > 7 * 86400) break
    let rl: Item
    try { rl = JSON.parse(fs.readFileSync(f, "utf8")).rate_limits } catch { continue }
    if (!rl || typeof rl !== "object" || !mine(path.basename(f, ".json"))) continue
    const wins = windows(rl, "used_percentage", (v) => (typeof v === "number" ? v : null), now)
    if (wins.length) return { source: "status line", observed, windows: wins }
  }
  return null
}

const hour = (ts: number) => ts - (ts % 3600) // allowances renew on the hour, in UTC

/** The Claude app's history: percentages only. A session renews five hours after the hour its use began (the history
 *  brackets it, this machine's own first request narrows it); a week renews seven days after its last drop. */
function appLimits(now: number, org: string | null, scan: Scan) {
  let data: Item
  try { data = JSON.parse(fs.readFileSync(APP_HISTORY, "utf8")) } catch { return null }
  if (data.version !== 1 && data.version !== 2) return null
  const samples: [number, Record<string, number>][] = []
  for (const e of data.samples || []) {
    if (!e || typeof e !== "object" || typeof e.t !== "number" || (org && e.org !== undefined && e.org !== null && e.org !== org)) continue
    const u = data.version === 1 ? e : (e.u || {})
    samples.push([e.t / 1000, Object.fromEntries(Object.entries(u as Item)
      .filter(([k, v]) => ["fh", "sd", "so", "sn"].includes(k) && typeof v === "number")) as Record<string, number>])
  }
  samples.sort((a, b) => a[0] - b[0])
  if (!samples.length || now - samples[samples.length - 1][0] > 7 * 86400) return null
  const [t, latest] = samples[samples.length - 1]
  const wins = []
  if ("fh" in latest && now - t < 5 * 3600) {
    let end: number | null = null
    if (latest.fh > 0) {
      let i = samples.length - 1
      while (i > 0 && (samples[i - 1][1].fh ?? 0) > 0 && samples[i][0] - samples[i - 1][0] < 5 * 3600) i--
      const began = samples[i][0], earliest = i ? samples[i - 1][0] : samples[i][0] - 5 * 3600
      const mine = [...scan.resp.values()].map((r) => r.ts).filter((ts) => earliest < ts && ts <= began)
      end = hour(mine.length ? Math.min(...mine) : began) + 5 * 3600
    }
    wins.push(window("session", 300, latest.fh, end, now))
  }
  for (const [key, name] of [["sd", "week"], ["so", "opus"], ["sn", "sonnet"]]) {
    if (!(key in latest)) continue
    let resets: number | null = null
    for (let j = samples.length - 1; j >= 1; j--) {
      const [t0, a] = samples[j - 1], [t1, b] = samples[j]
      if (key in a && key in b && b[key] + 1 < a[key]) {
        resets = Math.min(hour(t0) + 3600, t1)
        while (resets <= t) resets += 7 * 86400
        break
      }
    }
    if (resets === null && now - t > 86400) continue
    wins.push(window(name, 10080, latest[key], resets, now))
  }
  return wins.length ? { source: "Claude app", observed: t, windows: wins } : null
}

/** An account's login, as its .claude.json says (the plan, the organization). */
function login(file: string): Item {
  try { return JSON.parse(fs.readFileSync(file, "utf8")).oauthAccount || {} } catch { return {} }
}

async function plan(a: Account) {
  const o = await plugin.memo(300, login, accountJson(a))
  const tier = `${o.organizationRateLimitTier || ""} ${o.organizationType || ""}`.toLowerCase()
  const hit = PLANS.find(([match]) => tier.includes(match))
  return hit ? { name: hit[1], monthly: hit[2] } : null
}

async function limits(a: Account) {
  const now = Date.now() / 1000
  const live = await accountLimits(now, a.dir)
  if (live) return { ...live, observed: isoOf(live.observed * 1000) }
  const found = [statusLineLimits(now, a), appLimits(now, (await plugin.memo(300, login, accountJson(a))).organizationUuid ?? null, scanOf(a))]
    .filter((x) => x !== null)
  if (!found.length) return null
  const best = found.reduce((x, y) => (y.observed > x.observed ? y : x))
  return { ...best, observed: isoOf(best.observed * 1000) }
}

// ---------- Remote Control servers (`claude remote-control`) running here

/** Every `claude remote-control` server on this machine: its name (--name), account (its CLAUDE_CONFIG_DIR) and start. */
async function servers(accts: Account[]) {
  const rows: Item[] = []
  for (const { pid, started, command } of await processes()) {
    if (!/^(\S*\/)?claude\s+remote-control(\s|$)/.test(command) || /\s(-h|--help)(\s|$)/.test(command)) continue
    // Unnamed, its sessions are named after the machine (Remote Control's default).
    const name = /--name(?:=|\s+)("[^"]*"|'[^']*'|\S+)/.exec(command)?.[1]?.replace(/^["']|["']$/g, "") || os.hostname().replace(/\.local$/, "")
    // Its account: the CLAUDE_CONFIG_DIR it was started with (ps shows a process's environment to its user).
    let dir = DEFAULT_DIR
    try {
      const env = execFileSync("ps", ["eww", "-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 3000 })
      const d = /(?:^|\s)CLAUDE_CONFIG_DIR=(\S+)/.exec(env)?.[1]
      if (d) dir = expandHome(d)
    } catch { /* gone */ }
    const a = accts.find((x) => x.dir === dir)
    rows.push({ pid, name, account: a?.id ?? "", accountLabel: a?.label ?? path.basename(dir), started: isoOf(started) })
  }
  return sortBy(rows, (r) => [r.started ?? "", r.pid])
}

/** Each account's plan and limits, the Remote Control servers, of one account or all of them. */
async function plans(accts: Account[]) {
  const each = await Promise.all(accts.map(async (a) => ({ id: a.id, label: a.label, private: a.private, plan: await plan(a), limits: await limits(a) })))
  const plans = each.map((a) => a.plan).filter((p) => p !== null)
  // All of them: one plan whose price is theirs together (when each is known).
  const both = plans.length === each.length && plans.length > 1
    ? { name: plans.map((p) => p.name).join(" + "), monthly: plans.every((p) => p.monthly) ? plans.reduce((n, p) => n + p.monthly!, 0) : null } : null
  return { plan: each.length === 1 ? each[0].plan : both, limits: each.find((a) => a.limits)?.limits ?? null,
    accounts: each, servers: await plugin.memoStale(10, servers, accts) }
}

// ---------- one session's transcript (the view tab: view:claude-session/<id>)

const SESSION_ID = /^[\w-]{1,80}$/
const transcript = transcripts((file) => new Transcript(file, () => new Conversation(), WANTED))

/** A session's transcript file (<account>/projects/<folder>/<id>.jsonl) and its account, or null. `all`: private
 *  accounts too (to resume one, never to read it). */
function sessionFile(id: string, all = false): { file: string; account: Account } | null {
  if (!SESSION_ID.test(id)) return null
  for (const a of accounts().filter((x) => all || !x.private)) {
    const dir = path.join(a.dir, "projects")
    let folders: string[] = []
    try { folders = fs.readdirSync(dir) } catch { continue }
    for (const f of folders) {
      const p = path.join(dir, f, `${id}.jsonl`)
      if (fs.existsSync(p)) return { file: p, account: a }
    }
  }
  return null
}

/** A session's title, folder, times, model and conversation (the view tab: view:claude-session/<id>). */
async function session(id: string) {
  const file = sessionFile(id)?.file
  const t = file ? await transcript(file) : null
  if (!t) return null
  return { ...t.talk.head, title: titleOf(id) || t.talk.head.title, entries: t.talk.entries }
}

// An artifact asking Claude (claude.sample), in the default account.
plugin.provide("sample", (a: SampleAsk) => sample(a, DEFAULT_DIR))

// ---------- Terminal runs it (the service "agent:claude")

/** Claude Code's hooks for a session it runs in (`--settings`, added to the user's own). `report` (Activity's) hears
 *  each edit and command; the rest mark the terminal working, waiting (it asks something) or idle. */
function hooks(state: AgentStart["state"], report: string | null): object | null {
  if (!state && !report) return null
  const told = report ? [{ matcher: "^(Edit|Write|MultiEdit|NotebookEdit|Bash)$", hooks: [{ type: "command", command: report }] }] : []
  if (!state) return { hooks: { PostToolUse: told } }
  const set = (s: "working" | "waiting" | "idle") => [{ type: "command", command: state(s) }]
  const asks = "AskUserQuestion|ExitPlanMode"
  return { hooks: {
    SessionStart: [{ hooks: set("idle") }],
    UserPromptSubmit: [{ hooks: set("working") }],
    PreToolUse: [{ matcher: `^(?!(${asks})$).*`, hooks: set("working") }, { matcher: `^(${asks})$`, hooks: set("waiting") }],
    PostToolUse: [{ hooks: set("working") }, ...told],
    // A turn that was interrupted fires no Stop: a minute idle at its prompt counts too.
    Notification: [{ matcher: "permission_prompt|elicitation_dialog", hooks: set("waiting") }, { matcher: "idle_prompt", hooks: set("idle") }],
    Stop: [{ hooks: set("idle") }],
  } }
}

/** `claude`, or `claude --resume <id>` in the folder it ran in (sessions are per folder), in the account the profile
 *  names or the session is in (CLAUDE_CONFIG_DIR, unless that's the default and the server has none). */
plugin.provide("agent:claude", async ({ resume, context, state, report, profile, prompt, dark, allow, model, effort }: AgentStart) => {
  const found = resume ? sessionFile(resume, true) : null
  if (resume && !found) return notOnThisMachine("Claude Code", resume)
  const a = found?.account ?? (profile ? accounts().find((x) => x.id === profile) : undefined)
  const env = a && (a.dir !== path.join(HOME, ".claude") || process.env.CLAUDE_CONFIG_DIR) ? `CLAUDE_CONFIG_DIR=${shellQuote(a.dir)}` : ""
  const cwd = found ? (await transcript(found.file))?.talk.head.cwd || null : null
  // Its ANSI themes draw in the terminal's 16 colours, which are the app's colour scheme.
  const theme = typeof dark === "boolean" ? { theme: dark ? "dark-ansi" : "light-ansi" } : null
  const told = hooks(state, report ?? null)
  const settings = told || theme ? { ...told, ...theme } : null
  return {
    command: [env, "claude", resume && `--resume ${shellQuote(resume)}`, context && `--append-system-prompt ${shellQuote(context)}`,
      settings && `--settings ${shellQuote(JSON.stringify(settings))}`, allow?.length && `--allowedTools ${allow.map((a) => shellQuote(`Bash(${a}:*)`)).join(" ")}`,
      model && `--model ${shellQuote(model)}`, effort && `--effort ${shellQuote(effort)}`,
      prompt && `-- ${shellQuote(prompt)}`].filter(Boolean).join(" "),
    cwd,
  }
})

/** A session's last response and how long its prompt cache lasts (the service "agent-session:claude": the Inbox resumes
 *  it while cached). The TTL is an hour when its last responses wrote 1 h cache, else five minutes. */
plugin.provide("agent-session:claude", (id: string): { transcript: string; last: number; ttl: number; account: string } | null => {
  const found = sessionFile(id, true), t = found && tail(found.file)
  return t ? { transcript: found.file, last: t.st.mtimeMs, ttl: ttlOf(t.text), account: found.account.id } : null
})

/** A file's last 256 KB and its stat, or null when it can't be read. */
function tail(file: string) {
  try {
    const fd = fs.openSync(file, "r")
    try {
      const st = fs.fstatSync(fd), n = Math.min(st.size, 256 << 10), buf = Buffer.alloc(n)
      fs.readSync(fd, buf, 0, n, st.size - n)
      return { st, text: buf.toString("utf8") }
    } finally { fs.closeSync(fd) }
  } catch { return null }
}
/** How long a transcript's prompt cache lasts: an hour when its tail wrote 1 h cache, else five minutes. */
const ttlOf = (tail: string) => (/"ephemeral_1h_input_tokens":\s*[1-9]/.test(tail) ? 3600 : 300)

/** Live sessions by terminal ("agent-meters:claude"); `meters`: context from each transcript's last request, the window
 *  the status line's (else 200k, 1M once exceeded). A terminal is asked once, a transcript reread only when grown. */
const terminals = new Map<string, string>() // pid@start -> terminal
type Read = { tokens: number; last: number; ttl: number }
const lastRead = new Map<string, { size: number; meter: Read | null }>()
plugin.provide("agent-meters:claude", async (meters?: boolean): Promise<AgentMeter[]> => {
  const out: AgentMeter[] = []
  for (const { a, s, pid, sid, tmux } of running(accounts())) {
    if (!sid) continue
    const key = `${pid}@${s.procStart}`
    let terminal = terminals.get(key)
    if (!terminal) {
      terminal = await terminalOf(plugin, pid, tmux) ?? undefined
      if (!terminal) continue
      terminals.set(key, terminal)
    }
    const found = meters && sessionFile(sid, true), m = found && lastRequest(found.file)
    if (!m) { out.push({ terminal, session: sid }); continue }
    let window = 0
    // A status line may write to ~/.claude whatever account runs it: a session id is the same in either.
    for (const dir of new Set([a.dir, path.join(HOME, ".claude")])) {
      try { window = Number(JSON.parse(fs.readFileSync(path.join(dir, "usage-snapshots", `${sid}.json`), "utf8")).context_window?.context_window_size) || 0 } catch { /* none */ }
      if (window) break
    }
    out.push({ terminal, session: sid, ...m, window: window || (m.tokens > 200_000 ? 1_000_000 : 200_000) })
  }
  return out
})

/** A transcript's last request: what it read, when, and its cache's TTL (an hour when the tail wrote 1 h cache). */
function lastRequest(file: string) {
  let size = 0
  try { size = fs.statSync(file).size } catch { return null }
  const was = lastRead.get(file)
  if (was?.size === size) return was.meter
  const t = tail(file)
  if (!t) return null
  let meter: Read | null = null
  for (const line of t.text.split("\n").reverse()) {
    if (!line.includes('"type":"assistant"') || !line.includes('"usage"') || line.includes('"isSidechain":true')) continue
    try {
      const e = JSON.parse(line), u = e.message?.usage ?? {}
      const tokens = int(u.input_tokens) + int(u.cache_read_input_tokens) + int(u.cache_creation_input_tokens)
      if (!tokens) continue
      meter = { tokens, last: Date.parse(e.timestamp) || 0, ttl: ttlOf(t.text) }
      break
    } catch { /* a cut line */ }
  }
  lastRead.set(file, { size, meter })
  return meter
}

// ---------- blocks as text (GET /api/render)

plugin.block("agent-limits", async (ctx) => {
  const each = await Promise.all(agent.accountsFor(ctx.options.account).map(async (a) => ({ a, lim: await limits(a) })))
  return section("Plan limits", ...each.flatMap(({ a, lim }) => {
    const head = each.length > 1 ? `### ${a.label}` : ""
    if (!lim) return [head, "_No limits read yet: they come from Claude Code (signed in), its status line or the Claude app._"]
    return [head, limitRows(lim.windows), `_From the ${lim.source}, ${ago(lim.observed)}._`]
  }))
})

const agent = codingAgent(plugin, {
  id: "claude-code", name: "Claude Code", value: "estimated at list prices", sessionId: SESSION_ID, summary, live, plan: plans,
  session, modelName, projectOf: (cwd) => projectOf(cwd, rootsOf), accounts: { all: accounts, word: "Claude Code account" },
  warm: () => Promise.all(accounts().map((a) => scanOf(a).refresh())),
  state: (s) => (s.status === "busy" ? "Working" : cap(String(s.status).toLowerCase()) || "Open"),
  more: (u) => {
    const rc = (u as Usage & { servers: Item[] }).servers
    return rc.length ? ["### Remote Control", bullets(rc.map((r) => `${r.name || "Unnamed"}${r.accountLabel ? ` (${r.accountLabel})` : ""}, since ${ago(r.started)}`))] : []
  },
})
