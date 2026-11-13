import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { bullets, fmtMin, HTTPError, localDate, OpError, type OpCtx, type Plugin, processTable, type Request, section, serverUrl } from "./plugins.ts"
import { stableNode } from "./service.ts"
import { vauEntry } from "./appentry.ts"
import { KNOWN_AGENTS, MODEL_NAME, parseTerminal } from "./terminalids.ts"
import { spawnBin } from "./winbin.ts"
export { spawnBin, winCommand, withPath } from "./winbin.ts"
export { agentIn, agentName, agentSite, KNOWN_AGENTS, MODEL_NAME, newTerminalId, parseTerminal, resumeTerminalId, TERMINAL_AGENT, type TerminalAgent } from "./terminalids.ts"
export { agentSession, serversOwn } from "./sessionenv.ts"
export { trustClaudeProject } from "./claudeconfig.ts"
import { USAGE_BLOCKS } from "./rules.ts"
import { type Item, sortBy, writeAtomic } from "./vault.ts"
import { atExit } from "./exit.ts"

/** This machine's home folder, where agents keep their files. */
export const HOME = os.homedir()

/** `vau mcp` as an agent's MCP server: by the Node running this server (an agent may pass its servers no PATH), told
 *  this server's address (another port isn't vau's default). */
export function vauMcpServer(): { command: string; args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = { VAULTITE_URL: serverUrl() }
  if (process.env.ELECTRON_RUN_AS_NODE) env.ELECTRON_RUN_AS_NODE = "1"
  return { command: stableNode(process.execPath, process.env.PATH), args: [vauEntry(), "mcp"], env }
}
const run = promisify(execFile)
const pad = (n: number) => String(n).padStart(2, "0")
/** Epoch ms -> ISO time, or null. */
export const isoOf = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null)
let reach = 35
/** How many days back the scans read now. */
export const scanDays = () => reach
function daysOf(v: unknown) {
  const n = Math.trunc(Number(v || 30))
  const days = Number.isFinite(n) ? Math.min(Math.max(n, 1), 3650) : 30
  reach = Math.max(reach, days + 5)
  return days
}

/** A JSON text (its bytes too) parsed as `schema`, or undefined when it isn't JSON or isn't one. */
export function parseJson<T>(v: unknown, schema: z.ZodType<T>): T | undefined {
  let json: unknown
  try { json = JSON.parse(v instanceof Uint8Array ? Buffer.from(v).toString("utf8") : String(v)) } catch { return undefined }
  return schema.safeParse(json).data
}
/** A number as stored, else 0. */
export const numberOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
/** A path with `~` for the home folder, resolved. */
export const expandHome = (p: string) => (p === "~" || p.startsWith("~/") ? path.join(HOME, p.slice(1)) : path.resolve(p))
/** ISO time ("2026-09-29T17:51:25.878Z") -> epoch seconds, or null. */
export function epochSeconds(s: unknown): number | null {
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

function throttled(ms: () => number, fn: () => Promise<void>, due?: () => boolean) {
  let at = 0, running: Promise<void> | null = null
  const go = (now = false): Promise<void> => {
    if (running) return now ? running.then(() => go(true)) : running
    if (!now && Date.now() - at < ms() && !due?.()) return Promise.resolve()
    running = fn().finally(() => { at = Date.now(); running = null })
    return running
  }
  return go
}

/** Folder -> its project's root. A worktree belongs to its repository: `own` maps the agent's own worktree folders,
 *  and a sibling <repo>-<task> of a folder that's also there counts as <repo>. */
export function projectRoots(cwds: Iterable<string>, own = (c: string) => c) {
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

/** A project root's name: its folder's, "Home" for the home folder. */
export const projectName = (root: string) => (root === HOME || root === "" ? "Home" : path.basename(root) || root)
/** A folder's project name, through `rootsOf` (an agent's own worktrees). */
export const projectOf = (cwd: string, rootsOf: (cwds: string[]) => Map<string, string> = projectRoots) => projectName(rootsOf([cwd]).get(cwd)!)

const repos = new Map<string, string>()
/** The repository a folder is: a git worktree's own (its .git a file naming <repo>/.git/worktrees/<name>), an agent's
 *  worktree under .claude/worktrees/ its repository's, else the folder's name. Kept per folder. */
export function repoName(cwd: string) {
  if (!cwd) return ""
  let r = repos.get(cwd)
  if (r !== undefined) return r
  r = projectName(cwd.split("/.claude/worktrees/")[0])
  try {
    const m = /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/]/m.exec(fs.readFileSync(path.join(cwd, ".git"), "utf8"))
    if (m) r = projectName(path.resolve(cwd, m[1]))
  } catch {}
  repos.set(cwd, r)
  if (repos.size > 500) repos.delete(repos.keys().next().value!)
  return r
}

function accountsNamed<A extends { id: string }>(all: A[], id: unknown, what: string): A[] {
  if (typeof id !== "string" || !id) return all
  const one = all.filter((a) => a.id === id)
  if (!one.length) throw new HTTPError(404, `no ${what} '${id}' here (they are: ${all.map((a) => a.id).join(", ") || "none"})`)
  return one
}

/** A request as a tally counts it: when (epoch ms), its cost (null: no price for its model), tokens, cache reads, prompt
 *  tokens (cached or not), the model's name and the minutes it worked, when that's known per request. */
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

  project(key: string, root: string | null = key, name = this.name(key)) {
    if (!this.projects.has(key)) this.projects.set(key, { name, ...(root !== null ? { root } : {}), cost: 0, tokens: 0, active_min: 0, sessions: new Set(), last: 0 })
    return this.projects.get(key)!
  }

  session(id: string, init: () => Item) {
    if (!this.sessions.has(id)) this.sessions.set(id, { id, ...init(), cost: 0, tokens: 0, active_min: 0, votes: new Map<string, number>() })
    return this.sessions.get(id)!
  }

  private static add(b: Item, r: Counted) {
    b.cost += r.cost ?? 0
    b.tokens += r.tokens
    if (r.min && "active_min" in b) b.active_min += r.min
  }

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

  work(day: string, project: string, session: string, min: number) {
    for (const b of [this.days.get(day), this.projects.get(project), this.sessions.get(session)]) if (b) b.active_min += min
  }

  result(model = (m: string) => m) {
    const iso = isoOf
    for (const s of this.sessions.values()) {
      const top = [...(s.votes as Map<string, number>)].reduce<[string, number] | null>((a, b) => (!a || b[1] > a[1] ? b : a), null)?.[0]
      delete s.votes
      s.model = top || s.model ? model(top || s.model) : ""
      Object.assign(s, { lastTs: s.last, first: iso(s.first), last: iso(s.last) })
    }
    for (const p of this.projects.values()) Object.assign(p, { sessions: p.sessions.size, last: iso(p.last) })
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

type Summary = ReturnType<Tally["result"]>
/** What an agent's GET route answers: its tally, plan, limits and live sessions. */
export type Usage = Summary & { plan: { name: string; monthly: number | null } | null; limits: Limits | null; live: Item[] } & Item

/** Every process on this machine: its pid, start (epoch ms) and command line. */
export const processes = async () => [...await processTable()].map(([pid, p]) => ({ pid, started: p.started, command: p.args }))

/** A command line's program by its name (no folder, no Windows .exe: "codex"), and the rest of the line. A Windows one's
 *  program may be quoted ("C:\\Program Files\\x.exe" --flag). */
export function programOf(command: string): [string, string] {
  const m = command.startsWith('"') ? /^"([^"]*)"(.*)$/.exec(command) : /^(\S+)(.*)$/.exec(command)
  return m ? [m[1].replace(/^.*[\\/]/, "").replace(/\.exe$/i, ""), m[2]] : ["", ""]
}

/** Each process's working folder (Linux's /proc, else lsof; Windows can't tell another process's: none). */
export async function cwds(pids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (!pids.length || process.platform === "win32") return out
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

/** The app's terminal a process runs in (Terminal's, while it's on): its session id, or null. */
export const terminalOf = (plugin: Plugin, pid: number) => plugin.ask<string | null>("terminal:of", null, pid)

const busyFirst = (live: Item[]) => sortBy(live, (s) => [s.status !== "busy" ? 1 : 0, s.started || ""])

/** A command line's words after its program: `opt(...names)` an option's value ("" for a switch; `--x=v` too), the
 *  next word for those in `valued`, and for those in `maybe` when it isn't an option; `words` the rest. */
export function argvOf(args: string[], valued: Set<string>, maybe = new Set<string>()) {
  const opts = new Map<string, string>(), words: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i], eq = a.startsWith("--") ? a.indexOf("=") : -1
    if (!a.startsWith("-") || a === "-") words.push(a)
    else if (eq > 0) opts.set(a.slice(0, eq), a.slice(eq + 1))
    else if (valued.has(a) || (maybe.has(a) && args[i + 1] && !args[i + 1].startsWith("-"))) opts.set(a, args[++i] ?? "")
    else opts.set(a, "")
  }
  return { words, opt: (...names: string[]) => names.map((n) => opts.get(n)).find((v) => v !== undefined) }
}

/** Each process, newest first, with the session it writes: `pick`ed among those a newer one didn't take (`free`); a
 *  process whose pick was taken is left out. */
export function sessionsOf<P extends { started: number }, S>(procs: P[], key: (s: S) => string, pick: (p: P, free: (s: S) => boolean) => S | null | undefined) {
  const taken = new Set<string>()
  return sortBy(procs, (p) => p.started, true).flatMap((p) => {
    const s = pick(p, (x) => !taken.has(key(x))) ?? undefined
    if (s && taken.has(key(s))) return []
    if (s) taken.add(key(s))
    return [[p, s] as const]
  })
}

/** A program on this machine: on the server's PATH (launchd's is short), beside the Node running it (npm's), or where
 *  installers put it; null when it's nowhere. */
export function findBin(name: string) {
  let npm = ""
  try { npm = path.dirname(fs.realpathSync(process.execPath)) } catch {}
  const win = process.platform === "win32"
  // (Windows: npm's global folder, and its programs by their extensions: claude.exe, codex.cmd)
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), npm, path.join(HOME, ".local", "bin"), path.join(HOME, ".npm-global", "bin"),
    ...(win ? [process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : ""] : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"])]
  const names = win && !path.extname(name) ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => name + e.toLowerCase()) : [name]
  return dirs.filter(Boolean).flatMap((d) => names.map((n) => path.join(d, n))).find((p) => {
    try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile() } catch { return false }
  }) ?? null
}

/** Talks to `bin` in JSON lines over stdio: `first` sent, then `hear` gets each message read (`send` more, `done` with
 *  the answer). An error is null; a timeout after `ms` or an exit, what `end` says (null). */
export function jsonLines<T>(bin: string, args: string[], o: { env: NodeJS.ProcessEnv; cwd?: string; ms: number; first: Item
  hear: (m: Item, send: (m: Item) => void, done: (v: T | null) => void) => void; end?: () => T | null }): Promise<T | null> {
  return new Promise((resolve) => {
    const child = spawnBin(bin, args, { cwd: o.cwd, stdio: ["pipe", "pipe", "ignore"], env: o.env })
    let buf = "", over = false
    const done = (v: T | null) => {
      if (over) return
      over = true
      clearTimeout(timer)
      child.kill()
      resolve(v)
    }
    const timer = setTimeout(() => done(o.end?.() ?? null), o.ms)
    const send = (m: Item) => { try { child.stdin.write(JSON.stringify(m) + "\n") } catch { done(null) } }
    child.on("error", () => done(null))
    child.on("exit", () => done(o.end?.() ?? null))
    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8")
      for (let nl = buf.indexOf("\n"); nl >= 0 && !over; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let m: Item
        try { m = JSON.parse(line) } catch { continue }
        if (m && typeof m === "object") o.hear(m, send, done)
      }
    })
    send(o.first)
  })
}

/** A terminal's agent as the Terminals panel shows it. */
export type AgentState = "working" | "waiting" | "idle"
/** A live session by its terminal (service "agent-meters:<name>"): its `session` id, `account` id and `cwd`; with
 *  `meters`, `tokens` its last request read of a `window`, cached for `ttl` seconds from `last` (ms). */
export type AgentMeter = { terminal: string; session?: string; account?: string; cwd?: string; tokens?: number; window?: number; last?: number; ttl?: number }
/** What Terminal gives an agent's "agent:<name>" service, which answers the command (and folder) to run in a login
 *  shell, which then stays a plain shell (AgentCommand). Ids: <name>-<id>, <name>_<profile>-<id>, resume-<name>-<session>. */
export type AgentStart = {
  resume: string | null
  context: string
  /** A shell command marking the terminal's state for the Terminals panel and the Inbox, for the agent's hooks (`kind`:
   *  what a waiting one asks). Where the agent speaks OSC 7501 (the terminal reads it), the command does nothing. */
  state: ((s: AgentState, kind?: "permission" | "question") => string) | null
  /** A shell command for the agent's hooks to report what it did (the hook's JSON on stdin), to Activity; null when off. */
  report?: string | null
  /** Instead of `state` and `report` in PowerShell or cmd on Windows (no one shell runs hooks there): the URL a hook
   *  POSTs to for each state, with a program doing the same (`argv`, where only a program runs), and Activity's URL. */
  stateHook?: ((s: AgentState, kind?: "permission" | "question") => { url: string; argv: string[] }) | null
  reportUrl?: string | null
  /** It runs inside WSL (a Windows terminal whose shell is a WSL distro): this machine's paths aren't its own. */
  wsl?: boolean
  /** Which of its accounts to start in (the id's `_<profile>`: Claude Code's config folders), or null for its default. */
  profile?: string | null
  /** The first prompt, sent as it starts (Dispatch's, a voice note, a reply to a resumed session's report); null for none. */
  prompt?: string | null
  /** The app's light or dark where it opens (null: unknown). The terminal's 16 colours are the colour scheme's, so an
   *  agent that can draw in them follows it. */
  dark?: boolean | null
  /** Shell commands it may run without asking, by how they start ("vau companion"), for an agent that takes them. */
  allow?: string[] | null
  /** The model to run ("sonnet", "haiku", a full name) and its effort ("low"…"max"), for an agent that takes them;
   *  null: its own default. */
  model?: string | null
  effort?: string | null
  /** How much it may do without asking (PermissionMode), for an agent whose "agent-models" lists it in `modes`, which
   *  maps it to its own flags; null: its own setting. */
  mode?: PermissionMode | null
  /** The folder a new session starts in (a resumed one runs in its own); null: the vault's. */
  cwd?: string | null
}
/** How much a session may do without asking the user, in Claude Code's words, least first (dontAsk: only what its
 *  rules allow, never asking). Other agents map them to theirs (Codex: its sandbox and approvals). */
export const PERMISSION_MODES = ["plan", "dontAsk", "default", "acceptEdits", "auto", "bypassPermissions"] as const
export type PermissionMode = typeof PERMISSION_MODES[number]
/** What an "agent:<name>" service answers: its line for a POSIX shell, run in `cwd`; `argv` and `env` start it where that
 *  can't run (PowerShell, cmd), else Git Bash runs `command` there. */
export type AgentCommand = { command: string; cwd?: string | null; argv?: string[]; env?: Record<string, string> }
/** A question an agent shows on its screen (the service "agent-asks:<name>"), matched on its last `lines` (default 12),
 *  answered by keys (each written apart) or an option of its menu; Terminal tells the inbox of one before hooks run. */
export type AgentAsk = { id: string; match: RegExp; says: string; approve: string[] | AskOption; deny: string[] | AskOption; lines?: number }
/** An option of a menu its screen shows, by the words it starts with: the menu's cursor (❯) is moved onto it, checked
 *  there on the screen, then Enter (a menu whose default is No is never answered by Enter alone). */
export type AskOption = { option: string }
/** What a choice is called to the user: its option's words, else Approve or Deny. */
export const askLabel = (a: AgentAsk, answer: "approve" | "deny") => { const c = a[answer]; return Array.isArray(c) ? (answer === "approve" ? "Approve" : "Deny") : c.option }
/** A question an agent asks in its own words (Claude Code's AskUserQuestion): its options, one or several of them, an
 *  answer typed instead and Chat about this; `closed`, a dialog read off its screen: only its options. */
export type Question = { question: string; header?: string; multi?: boolean; closed?: boolean; options: { label: string; description?: string }[] }
/** What a session waits on the user for, as it said it (the service "agent-asking:<name>"): questions, or a plan. */
export type Asking = { kind: "question"; questions: Question[] } | { kind: "plan"; plan: string }
/** A question's answer: its options' numbers (from 1), text typed as its own answer (its picker's Type something), or in a
 *  multi-select both. */
export type Choice = number[] | string | { options: number[]; text: string }
/** One question's answer: `given`, an option's number or name (a multi-select's comma-separated) else text of its own;
 *  `typed`, its Type something row's (with a multi-select's picks). Not `strict`: a closed one's text comes back as is. */
export function choiceOf(q: Question, given: string, typed = "", strict = true): Choice {
  const said = given.trim().replace(/\s+/g, " "), text = typed.trim().replace(/\s+/g, " ")
  const name = (s: string) => s.toLowerCase().replace(/\s*\(recommended\)$/, "").trim()
  const one = (s: string) => {
    const n = /^\d+$/.test(s.trim()) ? Number(s) : q.options.findIndex((o) => name(o.label) === name(s)) + 1
    return n >= 1 && n <= q.options.length ? n : 0
  }
  if (!said && !text) throw new OpError(`"${q.question}": an answer`)
  if (q.closed && strict && (text || (!q.multi && !one(said)))) throw new OpError(`"${q.question}" takes one of its ${q.options.length} options, by number or name`)
  if (!q.multi) return text || (one(said) ? [one(said)] : said)
  const ns = said ? said.split(",").map(one) : []
  if (ns.includes(0)) throw new OpError(`"${q.question}" takes some of its ${q.options.length} options, by number or name`)
  const options = [...new Set(ns)]
  return !text ? options : options.length ? { options, text } : text
}
/** A new chat session told `prompt` (the service "agent-chat-new:<name>"), in an account and folder: its id, or null
 *  when none can run here (an app serving no port: a test's). */
export type AgentChatNew = (o: { prompt: string; account?: string; cwd?: string; by?: string }) => Promise<{ id: string } | null>
/** How a session is started, besides its id and first prompt. */
export type AgentHow = Pick<AgentStart, "allow" | "model" | "effort" | "mode" | "cwd">
/** What an agent's service "agent-models:<name>" answers: the models a session of it may run (`id` as its --model takes
 *  it), its efforts, least first, and the permission modes it's held to (AgentStart's `mode`; none: it takes none). */
export type AgentModels = { models: { id: string; label: string }[]; efforts: string[]; modes?: PermissionMode[] }

/** What an agent's service "agent-model-id:<name>" answers for a model as people say it ("Fable 5.2"): its id as its
 *  --model takes it and the name it reads as ("" for none), or why it names none of the agent's. */
export type AgentModel = { id: string; label: string } | { error: string }
/** `said` as agent `name` (claude, codex...) takes it (its service "agent-model-id:<name>"); one whose agent has none keeps its words. */
export async function agentModel(plugin: Plugin, name: string, said: string): Promise<{ id: string; label: string }> {
  const s = said.trim()
  if (!s) return { id: "", label: "" }
  const r = await plugin.ask<AgentModel | null>(`agent-model-id:${name}`, null, s)
  if (r && "error" in r) throw new OpError(r.error)
  if (r) return r
  if (!MODEL_NAME.test(s)) throw new OpError(`'${s}' isn't a model's name`)
  return { id: s, label: s }
}

/** What the service "sample" is asked: one reply to `prompt`, no tools, nothing remembered (an artifact's
 *  claude.sample). It answers SampleAnswer, or throws an Error with `code` (a claude.sample error code). */
export type SampleAsk = { prompt: string; system: string; tier: "quick" | "default" | "complex"; model?: string; effort?: string
  onText?: (delta: string) => void; signal?: AbortSignal }
export type SampleAnswer = { text: string; truncated: boolean; model?: string }

const Opened = z.looseObject({ agent: z.unknown().optional() })

export async function startAgent(ctx: OpCtx, id: string, prompt?: string, how: AgentHow = {}, home?: { url: string; as: string }) {
  const body = { prompt, ...how, ...(home ? { home } : {}) }
  const r = Opened.parse(await ctx.api("POST", `terminals/${encodeURIComponent(id)}`, Object.values(body).some((v) => v) ? body : undefined))
  if (!r.agent) {
    await ctx.api("DELETE", `terminals/${encodeURIComponent(id)}`).catch(() => {})
    throw new OpError(`no agent '${parseTerminal(id)?.agent ?? id}' here: its plugin is off, or there's none by that name`, 409)
  }
  return r
}

/** `s` as one word of a shell command. */
export const shellQuote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
/** What a terminal shows instead of running its agent (`text`, why not), then a plain shell. */
export const agentRefusal = (text: string): AgentCommand => ({ command: `printf '%s\\n' ${shellQuote(text)}`, argv: ["cmd.exe", "/d", "/c", "echo", text], cwd: null })
/** A session to resume that isn't on this machine (a tab from a synced or shared workspace): a note, then a plain shell. */
export const notOnThisMachine = (agent: string, id: string): AgentCommand => agentRefusal(`There's no ${agent} session ${id} on this machine to resume.`)

/** A conversation's entries (a session's view tab): a tool call, what was said, and its head. */
export type Tool = { kind: "tool"; id: string; name: string; summary: string; input: string; result: string | null; error: boolean; at: string }
export type Said = { kind: "user" | "assistant"; text: string; at: string }
export type Entry = Said | Tool
export type Head = { title: string; cwd: string; model: string; first: string; last: string; branch: string }

/** A conversation's latest turn (what "agent-turn:<agent>" answers): the user's last message, the agent's last answer
 *  after it ("" while none), when (ms, else 0), if it's final (no tool call after it), and the files its edits changed. */
export function lastTurn(entries: Entry[]): { prompt: string; text: string; at: number; final: boolean; files: string[] } {
  let prompt = "", text = "", at = 0, final = true, from = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.kind === "tool" && !text) final = false
    else if (e.kind === "assistant" && !text) { text = e.text; at = Date.parse(e.at) || 0 }
    else if (e.kind === "user") { prompt = e.text; from = i; break }
  }
  return { prompt, text, at, final: final && !!text, files: changedFiles(entries.slice(from)) }
}

/** The files `entries`' edits changed, in order: Claude Code's Edit, Write and NotebookEdit (their input's path),
 *  Codex's file changes (a line per file: "update ~/src/app.ts"). */
export function changedFiles(entries: Entry[]): string[] {
  const out = new Set<string>()
  for (const e of entries) {
    if (e.kind !== "tool" || e.error || !/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(e.name)) continue
    const m = /"(?:file_path|notebook_path)":\s*"((?:[^"\\]|\\.)+)"/.exec(e.input)
    if (m) out.add(m[1].replace(/\\(.)/g, "$1"))
    else for (const c of e.input.matchAll(/^(?:add|update|delete) (~[/\\].*|\/.*|[A-Za-z]:[/\\].*)$/gm)) out.add(c[1][0] === "~" ? path.join(HOME, c[1].slice(2)) : c[1])
  }
  return [...out]
}

/** Long texts cut short: a view is for reading a conversation back, not for the raw data. */
export const truncate = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}\n… (${(s.length - n).toLocaleString("en-US")} more characters)` : s)

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
    let parts: Buffer[] = [], partLen = 0
    for (;;) {
      const { bytesRead } = await fh.read(into, 0, chunk, offset + partLen)
      if (!bytesRead) break
      const got = into.subarray(0, bytesRead)
      let start = 0
      for (let nl = got.indexOf(10); nl >= 0; nl = got.indexOf(10, start)) {
        const piece = got.subarray(start, nl)
        line(partLen ? Buffer.concat([...parts, piece]) : piece)
        offset += partLen + nl - start + 1
        parts = []
        partLen = 0
        start = nl + 1
      }
      if (start < got.length) { parts.push(Buffer.from(got.subarray(start))); partLen += got.length - start }
    }
  } catch {
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
  private reading: Promise<unknown> = Promise.resolve()
  constructor(file: string, make: () => T, wanted: string[]) {
    this.file = file; this.make = make; this.talk = make(); this.wanted = wanted.map((w) => Buffer.from(w))
  }

  read(): Promise<this> {
    const r = this.reading.then(() => this.readOn())
    this.reading = r.catch(() => {})
    return r
  }

  private async readOn() {
    const st = await fs.promises.stat(this.file)
    if (st.size === this.size && st.mtimeMs === this.mtime) return this
    if (st.size < this.offset) { this.offset = 0; this.talk = this.make() }
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

/** How long a turn worked, as a JSONL agent's transcripts say. */
export type Turn = { ts: number; session: string; cwd: string; ms: number; day: string }

let scanMs = 5000
/** How often the scans read new lines at most (the tests: whenever asked). */
export const scanEvery = (ms: number) => { scanMs = ms }

/** An agent's JSONL transcripts under `dirs`, read as they grow (at most every 5 s; all again once asked for older
 *  days): `line` hears each new line with its file's state (`fresh`, again when the file was rewritten). */
export class JsonlScan<R extends { ts: number }, F extends { offset: number } = { offset: number }> {
  files = new Map<string, F>()
  resp = new Map<string, R>()
  turns = new Map<string, Turn>()
  version = 0
  refresh = throttled(() => scanMs, () => this.scan(), () => this.reach < scanDays())
  private dirs: () => string[]
  private pruned = 0
  private reach = scanDays()
  private keep: (() => string) | null
  close = () => {}
  private loaded = false
  private running = false
  private saved = { version: 0, at: 0 }
  private seen = new Set<string>()
  constructor(dirs: () => string[], keep?: () => string) {
    this.dirs = dirs
    this.keep = keep ?? null
    if (keep) this.close = atExit(() => { if (!this.running) this.save() })
  }

  protected fresh(_file: string): F { return { offset: 0 } as F }
  protected line(_line: Buffer, _f: F) { /* the agent's */ }
  protected extra(): unknown { return null }
  protected restore(_extra: unknown) { /* the agent's */ }

  private async scan() {
    this.running = true
    try {
      if (!this.loaded) this.load()
      await this.run()
    } finally { this.running = false }
    if (this.version !== this.saved.version && Date.now() - this.saved.at > SAVE_MS) this.save()
  }

  protected async run() {
    if (this.reach < scanDays()) { this.files.clear(); this.resp.clear(); this.turns.clear(); this.reach = scanDays() }
    const cutoff = Date.now() / 1000 - this.reach * 86400
    this.seen = new Set()
    for (const dir of this.dirs()) {
      let names: string[] = []
      try { names = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((n) => n.endsWith(".jsonl")) } catch { continue }
      for (const n of names) {
        const p = path.join(dir, n)
        let st: fs.Stats
        try { st = fs.statSync(p) } catch { continue }
        const f = this.files.get(p)
        if (st.mtimeMs / 1000 < cutoff) continue
        this.seen.add(p)
        if (st.size === f?.offset) continue
        const state = !f || st.size < f.offset ? this.fresh(p) : f
        this.files.set(p, state)
        state.offset = await readLines(p, state.offset, (l) => this.line(l, state))
        this.version++
      }
    }
    if (Date.now() / 1000 - this.pruned > 3600) {
      for (const [k, r] of this.resp) if (r.ts < cutoff) this.resp.delete(k)
      for (const [k, t] of this.turns) if (t.ts < cutoff) this.turns.delete(k)
      this.pruned = Date.now() / 1000
      this.version++
    }
  }

  private stamp() {
    return createHash("sha1").update(`${KEEP_FORMAT}\0${this.constructor.toString()}\0${Intl.DateTimeFormat().resolvedOptions().timeZone}`).digest("hex").slice(0, 16)
  }

  private load() {
    this.loaded = true
    const file = this.keep?.()
    if (!file) return
    let k: Item
    try { k = JSON.parse(fs.readFileSync(file, "utf8")) } catch { return }
    if (k?.stamp !== this.stamp() || !(k.reach >= this.reach) || !Array.isArray(k.files)) return
    this.files = new Map(k.files)
    this.resp = new Map(k.resp)
    this.turns = new Map(k.turns)
    this.reach = k.reach
    try { this.restore(k.extra) } catch {}
    this.version++
    this.saved = { version: this.version, at: Date.now() }
  }

  private save() {
    const file = this.keep?.()
    if (!file || !this.loaded) return
    const cutoff = Date.now() / 1000 - this.reach * 86400
    const fresh = <V extends { ts: number }>(m: Map<string, V>) => [...m].filter(([, v]) => v.ts >= cutoff)
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      writeAtomic(file, JSON.stringify({ stamp: this.stamp(), reach: this.reach, files: [...this.files].filter(([p]) => this.seen.has(p)),
        resp: fresh(this.resp), turns: fresh(this.turns), extra: this.extra() }))
      this.saved = { version: this.version, at: Date.now() }
    } catch {}
  }
}
const SAVE_MS = 30 * 60_000
const KEEP_FORMAT = 1

/** A session's first prompt as its title (`find` it by id), on one line and cut to 80 characters; kept once found. */
export function firstPrompts(find: (id: string) => string) {
  const kept = new Map<string, string>()
  return (id: string) => {
    if (!kept.has(id)) {
      const text = find(id).replace(/\s+/g, " ").trim().slice(0, 80)
      if (!text) return ""
      kept.set(id, text)
    }
    return kept.get(id)!
  }
}

let sqlite: typeof import("node:sqlite") | null | undefined
function nodeSqlite() {
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
  private frozen = ""
  private version = -1
  private at = 0
  private reach = 0
  private cols = new Map<string, Set<string>>()

  constructor(where: string | (() => string | null)) {
    this.where = typeof where === "string" ? () => where : where
    if (typeof where === "string") this.file = where
  }

  /** The open database, or null when there's none. One in WAL mode whose -wal and -shm are gone opens only immutable
   *  (only then: immutable misses a live WAL), until the file changes. */
  open(): DatabaseSync | null {
    const file = this.where()
    let st: fs.Stats | null = null
    try { st = file ? fs.statSync(file) : null } catch {}
    const sig = st ? `${st.size}:${st.mtimeMs}` : ""
    if (this.db && (file !== this.file || st?.ino !== this.ino || (this.frozen && this.frozen !== sig))) this.close()
    const sql = this.db || !file || !st ? null : nodeSqlite()
    if (sql) {
      this.frozen = ""
      try {
        this.db = new sql.DatabaseSync(file!, { readOnly: true, timeout: 2000 })
        this.db.prepare("SELECT count(*) FROM sqlite_master").get()
      } catch {
        this.close()
        if (!fs.existsSync(`${file}-wal`) && !fs.existsSync(`${file}-shm`)) {
          try {
            const u = new URL(`file://${encodeURI(file!)}`)
            u.searchParams.set("immutable", "1")
            this.db = new sql.DatabaseSync(u, { readOnly: true })
            this.frozen = sig
          } catch { this.db = null }
        }
      }
      if (this.db) {
        this.file = file!
        this.ino = st!.ino
        this.version = -1
        this.cols.clear()
      }
    }
    return this.db
  }

  close() {
    try { this.db?.close() } catch {}
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

  has(table: string, col: string) {
    if (!this.cols.has(table)) this.cols.set(table, new Set(this.all(`PRAGMA table_info(${table})`).map((r) => String(r.name))))
    return this.cols.get(table)!.has(col)
  }

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
export function buildCache<T>(keep = 4) {
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

const fmt = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
const money = (v: number) => (v < 100 ? `$${fmt(v, 2)}` : `$${fmt(v, 0)}`)
const tokens = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** ISO time -> "Thu 09:00 (in 2 h 10 min)". */
export function when(s: string) {
  const t = new Date(s)
  const left = (+t - Date.now()) / 60000
  const soon = left < 48 * 60 ? fmtMin(Math.max(left, 1)) : `${Math.round(left / 1440)} days`
  const hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`
  return `${left < 20 * 60 ? hm : `${t.toLocaleDateString("en-US", { weekday: "short" })} ${hm}`} (in ${soon})`
}

/** An ISO time as "2 h 10 min ago", "3 days ago". */
export function ago(s: string | null) {
  const m = s ? (Date.now() - Date.parse(s)) / 60000 : 0
  return m < 1 ? "just now" : m < 48 * 60 ? `${fmtMin(m)} ago` : `${Math.floor(m / 1440)} days ago`
}

/** A plan limit's window at `now` (epoch s; `resets` too): one that renewed since it was read is unused. */
export function limitWindow(id: string, label: string, minutes: number, used: number, resets: number | null, now: number) {
  if (resets && resets <= now) { used = 0; resets = null }
  return { id, label, minutes, used: Math.round(Number(used) * 10) / 10, resets_at: resets ? isoOf(resets * 1000) : null }
}
/** A plan's limits as an agent reads them: where from, when, and each window. */
export type Limits = { source: string; observed: string | null; windows: ReturnType<typeof limitWindow>[] }

/** A plan's limits, one line each: how much is used and when it renews. */
export const limitRows = (windows: { label: string; used: number; resets_at: string | null }[]) =>
  bullets(windows.map((w) => `${w.label}: ${String(Number(w.used.toPrecision(6)))}% used` + (w.resets_at ? `, renews ${when(w.resets_at)}` : "")))

const sessionLine = (s: Item) => [s.private ? "Private session" : s.title || s.name || "Untitled", s.project, s.accountLabel, s.model,
  (s.active_min ?? 0) >= 1 && fmtMin(s.active_min), money(s.cost || 0)].filter(Boolean).join(" · ")

type Words = {
  /** Its name ("Claude Code"). */
  name: string
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
  /** It runs in the cloud (Grok Bot): no session is open here, none is in a folder, so no project blocks. */
  cloud?: boolean
}

/** One of an agent's accounts: Claude Code's config folders, Hermes' homes, OpenClaw's agents. */
export type Account = { id: string; label: string; private?: boolean }

/** An agent a plugin runs, as a terminal names it (claude_agent: with its account), and for what ("Companion chat"):
 *  the service "agents-used:<plugin>" answers a list. */
export type AgentUse = { agent: string; as: string }

/** `accts` with what each is used for (`uses`), the ones in `used` first in its order: an agent's accounts for
 *  a plugin that runs them (agent-limits' `for:`). */
export function usedFirst<A extends { id: string }>(accts: A[], used: Map<string, string[]>): (A & { uses?: string[] })[] {
  const tagged = accts.map((a) => (used.has(a.id) ? { ...a, uses: used.get(a.id)! } : a))
  return [...[...used.keys()].flatMap((id) => tagged.filter((a) => a.id === id)), ...tagged.filter((a) => !used.has(a.id))]
}

function accountUses(uses: AgentUse[], terminal: string, all: { id: string }[]) {
  const out = new Map<string, string[]>()
  for (const u of uses) {
    const t = typeof u?.agent === "string" && typeof u.as === "string" ? parseTerminal(`${u.agent}-x`) : null
    const a = t && t.agent === terminal ? (t.profile ? all.find((x) => x.id === t.profile) : all[0]) : undefined
    if (a && !out.get(a.id)?.includes(u.as)) out.set(a.id, [...(out.get(a.id) ?? []), u.as])
  }
  return out
}

/** A session open now as its process tells (times in epoch ms): codingAgent adds what the usage
 *  knows of it (cost, tokens, project, model) and the app's terminal it runs in. */
export type Live = { pid: number; id: string; status: string; kind: string; cwd: string; started: number | null; since: number | null
  title?: string; name?: string; project?: string; model?: string | null; terminal?: string | null; account?: string; private?: boolean }

type Got<T> = T | Promise<T>
type Read = (Item & { entries: Entry[] }) | null

/** A coding agent plugin: what it reads from its tool, which `codingAgent` makes its routes and blocks of. */
export type CodingAgent<A extends Account> = Words & {
  /** Its routes: GET /api/<id>?days=&account=, /api/<id>/limits, /api/<id>/session/<session> and /api/<id>/accounts. */
  id: string
  /** What its session ids look like: any other is a 404. */
  sessionId: RegExp
  /** Its accounts, when it has them (`word`: what one is called in a 404): a block's `account:` picks one. */
  accounts?: { all: () => A[]; word: string }
  /** `days` of usage of `accts` (all of them, or the one asked for): a Tally's result. */
  summary(days: number, accts: A[]): Got<Summary>
  /** Its sessions open now (after `summary`). */
  live(accts: A[]): Promise<Live[]>
  /** Its plan and limits (none: null), and what more its blocks show. */
  plan?(accts: A[]): Promise<{ plan: Usage["plan"]; limits: Limits | null } & Item>
  /** A session's title, folder, times, model, branch (and what more it says) and conversation; null when it isn't here. */
  session(id: string): Got<Read>
  /** A model id as said ("Opus 5.5"), and a folder's project (default: its name, a worktree its repository's). */
  modelName?: (model: string) => string
  projectOf?: (cwd: string) => string
  /** The first read of a big history, before anyone asks (2 s after loading, when it's on). */
  warm?: () => unknown
  /** What it remembers outside its plugin (an account read with another plugin's), asked again on Refresh too. */
  forget?: () => void
}

/** A coding agent's routes and blocks; it answers which accounts an `account` option names. */
export function codingAgent<A extends Account>(plugin: Plugin, a: CodingAgent<A>) {
  const accountsFor = (id: unknown) => (a.accounts ? accountsNamed(a.accounts.all(), id, a.accounts.word) : [])
  const project = a.projectOf ?? ((cwd: string) => projectOf(cwd))
  const terminal = KNOWN_AGENTS.find((k) => k.id === a.id)?.terminal ?? a.id
  async function usedBy(by: unknown) {
    if (typeof by !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(by) || !a.accounts) return new Map<string, string[]>()
    const uses = await plugin.ask<AgentUse[]>(`agents-used:${by}`, [])
    return accountUses(Array.isArray(uses) ? uses : [], terminal, a.accounts.all())
  }
  async function planOf(accts: A[], by: unknown) {
    const p = await a.plan?.(accts) ?? { plan: null, limits: null }
    const each = p.accounts as { id: string }[] | undefined
    if (!Array.isArray(each) || each.length < 2) return p
    const used = await usedBy(by)
    return used.size ? { ...p, accounts: usedFirst(each, used) } : p
  }
  async function usage(days: number, account: unknown, by?: unknown): Promise<Usage> {
    const accts = accountsFor(account)
    const s = await a.summary(days, accts)
    const label = (id: unknown) => (accts.length > 1 ? accts.find((x) => x.id === id)?.label : undefined)
    for (const x of s.sessions) if (label(x.account)) x.accountLabel = label(x.account)
    const byId = new Map(s.sessions.map((x) => [x.id, x]))
    const live = await Promise.all((await a.live(accts)).map(async (r) => {
      const u = byId.get(r.id) ?? {}
      return { pid: r.pid, id: r.id, title: r.title || u.title || "", name: r.name ?? "", project: u.project || r.project || project(r.cwd),
        status: r.status, kind: r.kind, cwd: r.cwd, started: isoOf(r.started), since: isoOf(r.since), model: u.model || r.model || null,
        cost: u.cost ?? 0, tokens: u.tokens ?? 0, terminal: r.terminal !== undefined ? r.terminal : r.pid ? await terminalOf(plugin, r.pid) : null,
        ...(r.account ? { account: r.account } : {}), ...(label(r.account) ? { accountLabel: label(r.account) } : {}), ...(r.private ? { private: true } : {}) }
    }))
    return { ...(await planOf(accts, by)), live: busyFirst(live), ...s }
  }
  plugin.route("GET", a.id, async (req) => await usage(daysOf(req.query.days), req.query.account, req.query.for))
  plugin.route("GET", `${a.id}/limits`, async (req) => await planOf(accountsFor(req.query.account), req.query.for))
  plugin.route("GET", `${a.id}/session/*`, async (req) => {
    const id = req.arg(0)
    const s = a.sessionId.test(id) ? await a.session(id) : null
    if (!s) throw new HTTPError(404, `no ${a.name} ${a.noun ?? "session"} '${id}' on this machine`)
    const { entries, ...head } = s
    return { id, ...head, model: head.model ? (a.modelName ?? String)(head.model) : "", project: head.project ?? (head.cwd ? project(head.cwd) : ""),
      ...page(entries, req) }
  })
  if (a.accounts) plugin.route("GET", `${a.id}/accounts`, () => a.accounts!.all().map((x) => ({ id: x.id, label: x.label, ...(x.private ? { private: true } : {}) })))
  let forgot = 0
  plugin.route("POST", `${a.id}/refresh`, () => {
    if (Date.now() - forgot > 10_000) { forgot = Date.now(); plugin.forget(); a.forget?.() }
    return { ok: true }
  })
  if (a.warm) setTimeout(() => { if (plugin.loaded && !plugin.isOff()) void a.warm!() }, 2000).unref()
  usageBlocks(plugin, a, usage)
  return { accountsFor, usedBy, accountOf: (id: unknown) => (id ? accountsFor(id)[0] : a.accounts?.all()[0]) }
}

function usageBlocks(plugin: Plugin, w: Words, usage: (days: number, account: unknown) => Promise<Usage>) {
  const [sessions, usageBlock, projects, models, project] = USAGE_BLOCKS
  const noun = w.noun ?? "session", count = w.count ?? "session"
  const working = (min: number) => (!w.estimate ? `, ${fmtMin(min)} working` : "")
  plugin.block(sessions, async (ctx) => {
    const data = await usage(30, ctx.options.account)
    const now = bullets(data.live.map((s) => `${w.state(s)}: ${sessionLine(s)}`), `No ${w.name} ${noun} is open.`)
    const open = new Set(data.live.map((s) => s.id))
    const recent = bullets(data.sessions.filter((s) => !open.has(s.id)).map((s) => `${sessionLine(s)} (${ago(s.last)})`)
      .slice(0, Math.trunc(Number(ctx.options.recent || 5))), `No ${noun}s yet.`)
    return section(`${w.name} sessions`, ...(w.cloud ? [recent] : ["### Now", now, "### Recent", recent]), `_Costs ${w.value}._`, ...(w.more?.(data) ?? []))
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
  plugin.block(models, async (ctx) => {
    const days = daysOf(ctx.options.days)
    const data = await usage(days, ctx.options.account)
    return section(`${w.name} by model, last ${days} days`, bullets(data.models.map((m) => `${m.name}: ${money(m.cost)}, ${tokens(m.tokens)} tokens`), "None yet."), `_Costs ${w.value}._`)
  })
  if (w.cloud) return
  plugin.block(projects, async (ctx) => {
    const days = daysOf(ctx.options.days)
    const data = await usage(days, ctx.options.account)
    const rows = data.projects.map((p) => `${p.name}: ${money(p.cost)}, ${tokens(p.tokens)} tokens, ${plural(p.sessions, count)}` +
      (p.active_min >= 1 ? working(p.active_min) : ""))
    return section(`${w.name} by project, last ${days} days`, bullets(rows, `No ${noun}s yet.`), `_Costs ${w.value}._`)
  })
  plugin.block(project, async (ctx) => {
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
