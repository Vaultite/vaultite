// The list of sessions (the Terminals panel), a WebSocket at /api/terminals, sent on connect and on every change
// (`process` polled every 2 s while watched; other machines' every 30 s). Same access as a shell: it names what runs.
import os from "node:os"
import path from "node:path"
import { type RawData, WebSocket } from "ws"
import { type AgentMeter, repoName } from "../../../core/agents.ts"
import { machineSocket, processTable, span } from "../../../core/plugins.ts"
import type { Listed as Shell } from "./backend.ts"
import { progName } from "./shells.ts"
import type { Kind, SessionState } from "./osc7501.ts"
import { nowOf } from "./state.ts"
import { SPARE, WIN, plugin, sessions } from "./shared.ts"
import { agentOf, backends, fromReq, ours, ownedBy } from "./backends.ts"
import { FRONT_AGE, frontSeen, metas, nameOf, noteOf, oldMeta, progressOf, sight, terms, watchAsks, watching } from "./terms.ts"
import { makeSpare } from "./start.ts"
import { allowed, terminalMachines } from "./machines.ts"
import { pageInput } from "./routes.ts"
/** A shell at its prompt: nothing else runs in it (the app's `busy` is the other side of this). */
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "-zsh", "-bash", "-sh", "login", "pwsh", "powershell", "cmd", "wsl", ""])
const VERSION = /^\d+(\.\d+)+$/
/** A shell's process by its name: on Linux node-pty says the path it was started by ("/bin/bash"). */
export const byName = (x: Shell): Shell => (x.process?.includes("/") ? { ...x, process: path.basename(x.process) } : x)
/** What runs in front in a shell, or null at its prompt. A script reads as its interpreter (`mo` as "bash"), so a
 *  shell's name is checked against the foreground group: not the shell itself, something runs. */
let readsTable = false // the last list read the process table (inFront): this one asks for it with the backends
export async function inFront(x: Shell): Promise<string | null> {
  if (WIN) return frontOnWindows(x)
  // A program whose binary is named for its version (Claude Code's native install runs
  // ~/.local/share/claude/versions/2.1.290) reads by the name it was started as ("claude").
  if (!SHELLS.has(x.process) && !VERSION.test(x.process)) return x.process
  if (!x.pid) return SHELLS.has(x.process) ? null : x.process
  readsTable = true
  const all = await processTable()
  const fg = all.get(x.pid)?.tpgid ?? 0
  if (fg <= 0 || fg === x.pid) return SHELLS.has(x.process) ? null : x.process
  const [bin = "", ...rest] = (all.get(fg)?.args ?? "").split(/\s+/)
  const name = path.basename(bin).replace(/^-/, "")
  const script = SHELLS.has(name) ? rest.find((a) => !a.startsWith("-")) : undefined
  return (script && !rest.includes("-c") ? path.basename(script) : name) || x.process || "shell"
}
/** Windows has no foreground groups: the newest program the shell started (an agent the starter runs, by its own name).
 *  A WSL distro's programs can't be seen from here: an agent's terminal reads as running its agent. */
async function frontOnWindows(x: Shell): Promise<string | null> {
  if (x.process === "wsl") return agentOf(x.id)?.name ?? null
  if (!x.pid) return null
  readsTable = true
  const all = [...await processTable()]
  const kids = (pid: number) => all.filter(([, p]) => p.ppid === pid && !/^(conhost|openconsole)$/.test(progName(argv0(p.args)))).sort((a, b) => b[1].started - a[1].started)
  const kid = kids(x.pid)[0]
  if (!kid) return null
  if (!/[\\/]starter\.ts\b/.test(kid[1].args)) return progName(argv0(kid[1].args)) || "program"
  const agent = kids(kid[0])[0]
  return agent ? progName(argv0(agent[1].args)) : agentOf(x.id)?.name ?? "agent"
}
/** A Windows command line's program ("C:\\x\\claude.exe" --resume ...). */
const argv0 = (line: string) => (line.startsWith('"') ? line.slice(1, line.indexOf('"', 1) >>> 0) : line.split(" ")[0])

const watchers = new Map<WebSocket, boolean>() // socket -> this machine's sessions only (?local=1)
const lastList = new Map<boolean, string>()
let listTimer: ReturnType<typeof setTimeout> | null = null
let poll: ReturnType<typeof setInterval> | null = null
let follow: ReturnType<typeof setInterval> | null = null

export type Listed = { id: string; agent: string | null; process: string; busy: boolean; clients: number; started: number; title?: string
  /** What its program is doing (state.ts); `kind` and `msg` (untrusted) as it said. */
  state?: SessionState; kind?: Kind; msg?: string
  /** When its state last changed (ms). */
  since?: number
  /** Its agent's command was typed into its shell, its program not in front yet: the shell's prompt is the agent's. */
  starting?: true
  /** The Inbox has a row for it that needs the user, unread (its service "inbox:needs"): an answer to read, a question. */
  needs?: true
  /** A job in it is ready for review (the service "companion:review"): its result is the user's to look at. */
  review?: true
  /** The note it was started on (terminal.run). */
  note?: string
  /** The name the user gave it (terminal.rename). */
  name?: string
  /** Its agent isn't installed here (the shell found no such program). */
  missing?: true
  machine?: string; machineLabel?: string; backend?: string; external?: boolean
  /** Its program's pid, and the older terminal server's it's held through (termd/adopt.ts), which ends after its last. */
  pid?: number; via?: number
  /** The folder it started in, what it was started to run ("claude", "npm test", "zsh"), its size and last activity. */
  cwd?: string; command?: string; cols?: number; rows?: number; activity?: number
  /** Its agent's own session id (what it resumes), when the agent says (its service "agent-meters:<name>"). */
  session?: string
  /** The account its agent runs in (its id), when the agent says; the repository it works in (its folder's, else the
   *  terminal's). The Agents panel groups by them. */
  account?: string; project?: string
  /** Its agent's context and prompt cache, with Agent meters on (the service "terminal:meters"). */
  meter?: unknown }

const HOST = os.hostname().replace(/\.local$/, "")
/** A pane's title as a name: without Claude Code's leading status glyph (✳, a spinner), and none for a shell's default. */
function titleOf(raw: string) {
  const t = raw.replace(/^[^\p{L}\p{N}]+/u, "").trim()
  return !t || t === HOST || t === os.hostname() ? undefined : t.slice(0, 120)
}

/** This machine's sessions, oldest first, from every backend (one nobody reattached since a restart too), with what
 *  runs and what its agent's hooks said. Another program's own shells are `external`. */
export function localList(): Promise<Listed[]> {
  if (lastLocal && performance.now() - lastLocal.at < LIST_FRESH) return lastLocal.list
  const mine = { at: performance.now(), list: readList() }
  lastLocal = mine
  mine.list.catch(() => { if (lastLocal === mine) lastLocal = null })
  return mine.list
}
/** The last list made, shared by what asks soon after (the panel's poll, agents' terminal.list, a tab's title):
 *  reading it runs `ps` and asks every backend. A change (listChanged) forgets it. */
export let lastLocal: { at: number; list: Promise<Listed[]> } | null = null
const LIST_FRESH = 1900 // (under the poll's 2 s, so each poll reads it again)

async function readList(): Promise<Listed[]> {
  const out = new Map<string, Listed>(), timing = span("terminal.list"), seen = Date.now() - FRONT_AGE
  // (all at once: a plugin's list may start a process, and so does the process table inFront reads)
  if (readsTable) void processTable()
  readsTable = false
  const all = backends(), lists = await Promise.all(all.map((b) => b.list().catch(() => [] as Shell[])))
  timing.mark("backends")
  for (const [i, b] of all.entries()) {
    for (const x of lists[i].map(byName)) {
      if (x.spare || x.id.startsWith(SPARE) || out.has(x.id)) continue
      oldMeta(b, x)
      if (b.setMeta) metas.set(x.id, x.meta ?? {})
      if (!ours(b)) ownedBy(x.id, b)
      const s = sessions.get(x.id)
      // Who's watching: the app's sockets plus holds besides this server's own (another server's), so a session
      // no tab shows reads as detached.
      const clients = s ? s.clients.size + Math.max(0, x.attached - 1) : x.attached
      sight(x)
      const front = await inFront(x)
      frontSeen(b, x.id, front !== null, seen)
      const t = terms.get(x.id), now = t ? nowOf(t) : null
      // (an agent's terminal from before this server started: its questions are watched for again)
      const agent = agentOf(x.id)?.name
      if (agent && front !== null && !watching.has(x.id) && !t?.osc?.status && !t?.hooks) void watchAsks(x.id, agent)
      out.set(x.id, { id: x.id, agent: agentOf(x.id)?.name ?? null, process: front ?? x.process, busy: front !== null, clients, started: x.created || s?.started || 0,
        // (what an agent titled its terminal goes with it: a shell at its prompt keeps no title)
        title: front !== null ? titleOf(x.title ?? "") : undefined, backend: b.name,
        ...(x.cwd ? { cwd: x.cwd, project: repoName(x.cwd) } : {}), ...(x.command ? { command: x.command } : {}), ...(x.cols ? { cols: x.cols, rows: x.rows } : {}), ...(x.activity ? { activity: x.activity } : {}),
        ...(now ? { state: now.state, since: t!.at, ...(now.kind ? { kind: now.kind } : {}), ...(now.msg ? { msg: now.msg } : {}) } : {}),
        ...(progressOf(x.id) ? { progress: progressOf(x.id)! } : {}),
        ...(t?.starting ? { starting: true as const } : {}),
        ...(noteOf(x.id) ? { note: noteOf(x.id) } : {}),
        ...(nameOf(x.id) ? { name: nameOf(x.id) } : {}),
        ...(t?.phase.state === "missing" ? { missing: true as const } : {}),
        ...(x.external ? { external: true } : {}), ...(x.pid ? { pid: x.pid } : {}), ...(x.via ? { via: x.via } : {}) })
    }
  }
  timing.mark("in front")
  // (an agent run by hand in a plain terminal goes by its program's name: claude, codex)
  const meters = plugin.service("terminal:meters"), agents = [...new Set([...out.values()].flatMap((x) => (x.busy ? [x.agent ?? x.process] : [])))]
  const live = (await Promise.all(agents.map((a) => liveOf(a, typeof meters === "function")))).flat().filter((m) => out.get(m.terminal)?.busy)
  for (const m of live) {
    const x = out.get(m.terminal)!
    if (m.session) x.session = m.session
    if (m.account) x.account = m.account
    if (m.cwd) x.project = repoName(m.cwd)
  }
  timing.mark("agents")
  for (const x of out.values()) if (x.state && await plugin.ask<boolean>("inbox:needs", false, x.id, x.session ?? "")) x.needs = true
  timing.mark("inbox")
  if (typeof meters === "function" && live.length) {
    const by = await Promise.resolve(meters(live)).catch(() => null) as Record<string, unknown> | null
    for (const [id, m] of Object.entries(by ?? {})) { const x = out.get(id); if (x) x.meter = m }
    timing.mark("meters")
  }
  timing.tags.sessions = String(out.size)
  timing.end()
  return [...out.values()].sort((a, b) => a.started - b.started)
}

// Asked on every list (every 2 s while watched): agents' answers are kept a few seconds.
const kept = new Map<string, { at: number; list: Promise<AgentMeter[]> }>()
/** An agent's live sessions by terminal (its plugin's service "agent-meters:<name>"), with their meters when drawn. */
function liveOf(agent: string, meters: boolean): Promise<AgentMeter[]> {
  const fn = plugin.service(`agent-meters:${agent}`)
  if (typeof fn !== "function") return Promise.resolve([])
  const key = `${agent}:${meters}`, was = kept.get(key)
  if (was && Date.now() - was.at < 3000) return was.list
  const list = Promise.resolve(fn(meters)).then((l) => (Array.isArray(l) ? l as AgentMeter[] : []), () => [])
  kept.set(key, { at: Date.now(), list })
  return list
}

/** The other machines' sessions, as their lists said last: machine id -> its socket and list. */
export const remotes = new Map<string, { sock: WebSocket; list: Listed[] }>()

async function list(local: boolean): Promise<Listed[]> {
  const mine = await localList()
  const all = local ? mine : [...mine, ...[...remotes.values()].flatMap((r) => r.list)]
  const review = new Set(await plugin.ask<string[]>("companion:review", []))
  return review.size ? all.map((x) => (review.has(x.id) ? { ...x, review: true as const } : x)) : all
}

/** Follow every other machine that has a terminal (and drop the ones that went away). */
async function followMachines() {
  const want = await terminalMachines()
  for (const [id, r] of remotes) if (!want.some((m) => m.id === id)) { r.sock.terminate(); remotes.delete(id); listChanged() }
  for (const m of want) {
    if (remotes.has(m.id) || ![...watchers.values()].some((local) => !local)) continue
    const sock = machineSocket(m, "terminals", { local: "1" })
    const r = { sock, list: [] as Listed[] }
    remotes.set(m.id, r)
    sock.on("message", (data: RawData) => {
      let msg: { t?: string; list?: Listed[] }
      try { msg = JSON.parse(String(data)) } catch { return }
      if (msg.t !== "sessions" || !Array.isArray(msg.list)) return
      r.list = msg.list.filter((x) => x && typeof x.id === "string" && !x.id.includes("@"))
        .map((x) => ({ ...x, id: `${x.id}@${m.id}`, machine: m.id, machineLabel: m.label }))
      listChanged()
    })
    const gone = () => { if (remotes.get(m.id) === r) { remotes.delete(m.id); listChanged() } }
    sock.on("close", gone)
    sock.on("error", gone)
  }
}

function stopFollowing() {
  if (follow) { clearInterval(follow); follow = null }
  for (const r of remotes.values()) r.sock.terminate()
  remotes.clear()
}

// One at a time, in order: a list read earlier never lands after a later one (a new session's note, then its tab opening).
let sending = Promise.resolve()
export function sendList() {
  sending = sending.then(sendOnce, sendOnce)
  return sending
}
async function sendOnce() {
  for (const local of [true, false]) {
    const to = [...watchers].filter(([, l]) => l === local).map(([ws]) => ws)
    if (!to.length) continue
    // (without each one's last output time: a busy terminal's changes every poll, and the app draws nothing from it)
    const text = JSON.stringify({ t: "sessions", list: (await list(local)).map(({ activity: _, ...x }) => x) })
    if (text === lastList.get(local)) continue
    lastList.set(local, text)
    for (const ws of to) if (ws.readyState === ws.OPEN) ws.send(text)
  }
}

/** Something changed: tell the watchers (bursts, like a tab closing and its shell ending, coalesce). */
export function listChanged() {
  lastLocal = null
  if (!watchers.size || listTimer) return
  listTimer = setTimeout(() => { listTimer = null; void sendList() }, 50)
}
export function listNow() { lastLocal = null; return sendList() }

plugin.socket("terminals", async (ws, req, { query }) => {
  if (!(await allowed(ws, req))) return
  const local = !!query.local
  watchers.set(ws, local)
  // A page with the app open: a shell kept ready for its next terminal.
  if (!local) makeSpare(fromReq(req))
  ws.send(JSON.stringify({ t: "sessions", list: await list(local) }))
  poll ??= setInterval(() => void sendList(), 2000)
  if (!local) {
    follow ??= setInterval(() => void followMachines(), 30000)
    void followMachines()
  }
  ws.on("close", () => {
    watchers.delete(ws)
    if (![...watchers.values()].some((l) => !l)) stopFollowing()
    if (!watchers.size && poll) { clearInterval(poll); poll = null }
  })
})
plugin.onUnload(() => { if (poll) clearInterval(poll); if (listTimer) clearTimeout(listTimer); stopFollowing() })


/** Every backend's shells: shell pid -> {id, title} (a second ago at most). */
const shellPids = () => plugin.memo(1, async function shellPids() {
  const map = new Map<number, { id: string; title?: string }>()
  for (const b of backends()) for (const x of await b.list().catch(() => [] as Shell[])) if (x.pid && !x.spare) map.set(x.pid, { id: x.id, title: nameOf(x.id) ?? titleOf(x.title ?? "") })
  return map
})

/** The terminal session a process runs in, or null: walking the process's parents up to a terminal's shell. */
plugin.provide("terminal:of", async (pid: number): Promise<string | null> => {
  const shells = await shellPids()
  const up = await processTable()
  for (let p = pid, n = 0; p > 1 && n < 30; p = up.get(p)?.ppid ?? 0, n++) {
    const id = shells.get(p)?.id
    if (id) return id
  }
  return null
})

/** The app's terminal one of these processes runs in (the shell of one of its sessions, or that shell's descendants:
 *  pass a process and its parents), for Activity to say which session did something: {id, title} or null. */
plugin.provide("terminal:of-pids", async (pids: number[]) => {
  const shells = await shellPids()
  for (const p of pids) { const x = shells.get(p); if (x) return x }
  return null
})

/** A terminal's id and title (the user's name for it, else a Claude Code session's), whether something runs in it, its
 *  agent's session id and when it was last typed into in a tab (`typed`), or null when it isn't running. */
plugin.provide("terminal:info", async (id: string) => {
  const s = (await localList()).find((x) => x.id === id), typed = pageInput.get(id)
  return s ? { id: s.id, title: s.name ?? s.title, busy: s.busy, ...(s.session ? { session: s.session } : {}), ...(typed ? { typed } : {}) } : null
})
