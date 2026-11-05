// Terminal: login shells on this machine in a backend that outlives the server (the terminal server or another plugin's), a
// WebSocket per tab at /api/terminal/<id>. A shell is everything, so only this machine's owner gets one (plugin.refusal).
import { execFile } from "node:child_process"
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import os from "node:os"
import path from "node:path"
import { type RawData, WebSocket } from "ws"
import { type AgentAsk, type AgentCommand, type AgentHow, type AgentMeter, type AgentStart, type AgentState, agentName, agentSession, MODEL_NAME, PERMISSION_MODES, shellQuote, parseTerminal } from "../../../core/agents.ts"
import {
  agentLines, HTTPError, LOCAL as LOCAL_DIR, vauShims, writeWslVau, machineSocket, pipeSockets, Plugin, processTable, runtimeDir, serverUrl, span, splitMachine, type Machine,
  type Request, type Access, accessOf, NOT_THE_USER, userSurface, whoOf,
} from "../../../core/plugins.ts"
import {
  asPaste, backendName, type BackendEvent, type CaptureFormat, type Ended, launch, limits, loadPty, localBackend, mirrored, plain, psQuote, ptyLink, runScript, serverFiles, SHELL_DIR,
  shellArgs, shellFiles, termdBackend, unmarked, wslPath, type AgentRun, type Backend, type Link, type Listed as Shell, type Made, type Spec,
} from "./backend.ts"
import { defaultShell, gitBash, kindOf, progName, shellsHere, type ShellKind } from "./shells.ts"
import { shown, type Kind, type Said, type SessionState } from "./osc7501.ts"
import { runOps } from "./run.ts"
import type { Job } from "./starter.ts"
import { terminalOps } from "./ops.ts"
export const plugin = new Plugin(import.meta.url)

/** How much output a terminal client may be behind before it's dropped (it reconnects and gets the replay). */
const BEHIND = 16 << 20
/** Output a page may have to draw before its shell is held (its program waits on a full pty), and when it goes on. */
const HOLD = 1 << 20, GO = 256 << 10, STALL = 3000
/** Lines of history every terminal keeps, whatever its backend (the setting `scrollback`): the page's and the terminal
 *  server's, all given back to a page that comes back. */
const scrollback = () => clamp(plugin.settings().scrollback, 100, 1_000_000, 10_000)
limits.scrollback = scrollback
// A shell ends only when its tab closes (idle, its last one), or it's ended on purpose: never for having been left alone.
/** A shell at its prompt: nothing else runs in it (the app's `busy` is the other side of this). */
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "-zsh", "-bash", "-sh", "login", "pwsh", "powershell", "cmd", "wsl", ""])
const WIN = process.platform === "win32"
const VERSION = /^\d+(\.\d+)+$/
/** A shell's process by its name: on Linux node-pty says the path it was started by ("/bin/bash"). */
const byName = (x: Shell): Shell => (x.process?.includes("/") ? { ...x, process: path.basename(x.process) } : x)
/** What runs in front in a shell, or null at its prompt. A script reads as its interpreter (`mo` as "bash"), so a
 *  shell's name is checked against the foreground group: not the shell itself, something runs. */
let readsTable = false // the last list read the process table (inFront): this one asks for it with the backends
async function inFront(x: Shell): Promise<string | null> {
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
const EXITED = 4000 // close code: the shell ended (the client doesn't reconnect)
const GONE = 4004 // close code: ?attach=1 and the agent's session is gone (the client offers a new one)
const REFUSED = 4003 // close code: this request may not have a shell (the client shows why)
const BLOCKED = JSON.stringify({ t: "blocked" })

/** A shell this server shows: its backend's link to it, and the pages' sockets on it. */
type Session = {
  id: string; backend: Backend; link: Link; clients: Set<WebSocket>; started: number
  ended: boolean // ended by us (a tab's close, End session): reported as SIGHUP, like a shell killed directly
  kept?: boolean // ended by us, its tabs kept (end's `keep`)
  pending: Set<WebSocket> // sockets waiting for their picture (they get no output before it: it's in it)
  opened?: string // how its start went, for its first tab's span: "spare 12ms", "new 95ms"
  blocked?: boolean // macOS keeps its shell from the folder its agent runs in: its tabs say so
  queued: string // output not sent yet: what one read of the backend brought, sent as one message (flush)
  owed: Map<WebSocket, number> // bytes sent to each page and not yet drawn, as far as it tells (Terminal.tsx's acks)
  acks: Set<WebSocket> // the pages that tell (an older one doesn't: never waited for)
  held: boolean // its output held for the pages to catch up (pace)
  stall?: ReturnType<typeof setTimeout> // while held: a page that draws nothing in STALL stops setting the pace
}

const sent = (s: Session, ws: WebSocket, n: number) => s.owed.set(ws, (s.owed.get(ws) ?? 0) + n)

/** Holds the shell's output while every page that tells what it drew is HOLD behind, so ⌃C in a flood is answered at
 *  once; the fastest sets the pace (a slower one past BEHIND is dropped, as before). */
function pace(s: Session) {
  let least = Infinity
  for (const ws of s.acks) least = Math.min(least, s.owed.get(ws) ?? 0)
  const hold = least !== Infinity && least > HOLD
  clearTimeout(s.stall)
  // (a page asleep on a live socket, or in a hidden browser tab, mustn't stall an agent's work: left behind, it's dropped)
  if (hold || s.held) s.stall = setTimeout(() => { for (const ws of s.acks) if (s.owed.get(ws)! > GO) s.acks.delete(ws); pace(s) }, STALL)
  if (hold === s.held || (!hold && least !== Infinity && least > GO)) return
  s.held = hold
  if (hold) s.link.pause?.(); else s.link.resume?.()
}

/** Sends what the backend said since the last flush to the pages, as one message; called once the read that brought
 *  it is done, and before anything that must come after it (a new page's join, the exit). */
function flush(s: Session) {
  if (!s.queued) return
  const bytes = Buffer.from(s.queued, "utf8")
  s.queued = ""
  for (const ws of s.clients) {
    if (ws.readyState !== ws.OPEN || s.pending.has(ws)) continue
    // A client that stopped reading (a phone asleep on a live socket) would hold a chatty agent's output in memory
    // without end: dropped, it reconnects and gets the replay.
    if (ws.bufferedAmount > BEHIND) { ws.terminate(); continue }
    ws.send(bytes)
    sent(s, ws, bytes.length)
  }
  pace(s)
}
const sessions = new Map<string, Session>()

/** The shell new terminals start (shells.ts): the setting's, else the login shell (PowerShell on Windows). */
const shell = () => defaultShell(String(plugin.settings().shell ?? ""))
/** Its program's name inside a ready shell's key: a ready shell of another kind can't run an agent's line. */
const sameShell = (sh: string) => (kindOf(sh) === "cmd" ? null : sh)

// --- the backends (backend.ts), named by the port this process serves on (server.ts sets PORT): backendName.
const NAME = backendName(Number(process.env.PORT) || 0)
const TMP = path.join(runtimeDir(), "vaultite-terminal")
const UPLOADS = path.join(TMP, "uploads")
const STATES = path.join(TMP, "states")
/** How long what was pasted into a terminal stays once its shell has ended: as long as Claude Code keeps a session to
 *  resume by default (cleanupPeriodDays), so a resumed one still finds the files it was given. */
const UPLOADS_KEPT = 30 * 86_400_000
const SPARE = "vauspare-" // a shell kept ready (below)

// The terminal server (termd/), which takes over the keeper's terminals from before it (ptyd, protocol 1) once it runs.
const keeper = termdBackend(NAME, { daemon: path.join(plugin.dir, "termd", "termd.ts"), log: console.error, oldServers: [serverFiles(NAME, 1), serverFiles(NAME, 2)] })
// (the keeper's terminals from before are taken over here when the terminal server can't start to take them)
const fallback = localBackend({ log: (...a) => console.error("terminal (in this server):", ...a), oldServers: [serverFiles(NAME, 1), serverFiles(NAME, 2)],
  adoptOld: async () => !(await keeper.ready().catch(() => false)) })
/** Another plugin's backend, while it's on (the service "terminal:backend": herdr's, Rex's), or null. One made for the
 *  Backend before this one (no capture) isn't used: its plugin needs an update. */
let oldBackend = ""
function pluginBackend(): Backend | null {
  const fn = plugin.service("terminal:backend")
  let b: Backend | null = null
  try { b = typeof fn === "function" ? (fn() as Backend | null) ?? null : null } catch { return null }
  if (b && typeof b.capture !== "function") {
    if (oldBackend !== b.name) { oldBackend = b.name; console.error(`terminal: the backend ${b.name} is made for an older Terminal (it has no capture): not used until its plugin is updated`) }
    return null
  }
  if (b && b.events && !heard.has(b)) { heard.add(b); b.events((ev) => onEvent(b!, ev)) }
  return b
}
const heard = new WeakSet<Backend>()
/** What a plugin's backend may use (it implements Backend, backend.ts, through plugin.peer("terminal").exports): */
plugin.exports.backendKit = { launch, loadPty, ptyLink, mirrored, runScript, shellArgs, plain }
/** Where this server keeps its terminals: the terminal server's socket (or pipe) and files. */
plugin.exports.kept = { name: NAME, socket: keeper.socket, files: keeper.files }
/** Every backend, in the order a session's id is looked for. */
const backends = (): Backend[] => [keeper, fallback, ...[pluginBackend()].filter((b): b is Backend => !!b)]

/** The terminals another plugin's backend holds (herdr's panes), as last seen, kept on this machine: a tab of one waits
 *  for that backend when it's away rather than starting a shell under its id. The last 2000. */
let owners: Record<string, { backend: string; label: string }> | null = null
const ownersFile = () => path.join(plugin.localDir(), "backends.json")
function ownerOf(id: string) {
  if (!owners) { try { owners = JSON.parse(fs.readFileSync(ownersFile(), "utf8")) } catch { owners = {} } }
  return owners![id] ?? null
}
let ownersWrite: ReturnType<typeof setTimeout> | null = null
function ownedBy(id: string, b: Backend) {
  if (ownerOf(id)?.backend === b.name) return
  const all = owners!
  delete all[id]
  all[id] = { backend: b.name, label: b.label }
  const ids = Object.keys(all)
  for (const old of ids.slice(0, Math.max(0, ids.length - 2000))) delete all[old]
  ownersWrite ??= setTimeout(() => { ownersWrite = null; try { fs.writeFileSync(ownersFile(), JSON.stringify(owners)) } catch { /* next time */ } }, 1000)
}
const ours = (b: Backend) => b === keeper || b === fallback

/** Where a new terminal starts: a plugin's backend that asks for them (and answers), else the terminal server, else
 *  this server itself if that can't start. */
async function backendForNew(): Promise<Backend> {
  const other = pluginBackend()
  if (other?.preferred && (await other.ready().catch(() => false))) return other
  if (await keeper.ready().catch(() => false)) return keeper
  return fallback
}

/** The backend running terminal `id` (and how it lists it), or null. */
async function findShell(id: string): Promise<{ b: Backend; x: Shell } | null> {
  // (all asked at once: a plugin's answer may be a process of its own, which a busy machine is slow to start)
  const all = backends(), lists = await Promise.all(all.map((b) => b.list().catch(() => [] as Shell[])))
  for (const [i, l] of lists.entries()) { const x = l.find((y) => y.id === id); if (x) return { b: all[i], x } }
  return null
}
async function backendOf(id: string): Promise<Backend | null> {
  return sessions.get(id)?.backend ?? (await findShell(id))?.b ?? null
}
/** A shell with this id runs here (in any backend). */
const runsHere = async (id: string) => !!(await backendOf(id))

/** Whether a new terminal can read `dir` (app.permissions: the vault): the running keeper's own read (an older build
 *  may have started it), else this server's, which a keeper started now reads as; a plugin's backend can't tell. */
async function access(dir: string): Promise<Access> {
  const other = pluginBackend()
  if (other?.preferred && (await other.ready().catch(() => false))) return { ok: null, why: `terminals run in ${other.label}, which can't tell` }
  return (await keeper.access(dir)) ?? fs.promises.readdir(dir).then((): Access => ({ ok: true }), (e: NodeJS.ErrnoException) => accessOf(e.code ?? "EIO"))
}
plugin.provide("terminal:access", access)

/** A file the page sends into terminal `id` (a pasted screenshot, any size), a piece at a time, saved where the shell
 *  can read it: its path once the `last` piece came, else null. `files`: the socket's uploads under way, by the page's id. */
function upload(id: string, files: Map<string, string>, msg: { id?: string; name?: string; data?: string; last?: boolean }): string | null {
  const key = String(msg.id ?? "")
  let file = files.get(key)
  if (!file) {
    const safe = String(msg.name ?? "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(-80) || "file"
    const dir = path.join(UPLOADS, id)
    fs.mkdirSync(dir, { recursive: true })
    files.set(key, file = path.join(dir, `${Date.now().toString(36)}-${safe}`))
  }
  fs.appendFileSync(file, Buffer.from(String(msg.data ?? ""), "base64"))
  if (!msg.last) return null
  files.delete(key)
  if (!fs.statSync(file).size) { fs.rmSync(file, { force: true }); throw new Error("an empty file") }
  return file
}

/** What was pasted into terminals stays while its shell runs, and UPLOADS_KEPT after it ended (its folder's time is
 *  kept current while it runs). */
async function sweep() {
  let names: string[]
  try { names = fs.readdirSync(UPLOADS) } catch { return }
  const now = Date.now()
  for (const f of names) {
    const p = path.join(UPLOADS, f)
    try {
      const dir = fs.statSync(p).isDirectory()
      if (dir && TERMINAL_ID.test(f) && (await runsHere(f))) { fs.utimesSync(p, now / 1000, now / 1000); continue }
      if (now - fs.statSync(p).mtimeMs > UPLOADS_KEPT) fs.rmSync(p, { recursive: true, force: true })
    } catch { /* gone meanwhile */ }
  }
}
setTimeout(() => void sweep(), 5000).unref?.()
const sweeper = setInterval(sweep, 3600 * 1000)
sweeper.unref?.()
plugin.onUnload(() => clearInterval(sweeper))

/** tmux was a backend before the terminal server: its sessions still running aren't listed or taken over here, so the
 *  user is told once (on this machine) where they are. */
function tmuxLeft() {
  const tmux = WIN ? "" : ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"].find((p) => fs.existsSync(p))
  const told = path.join(plugin.localDir(), "tmux-told")
  if (!tmux || fs.existsSync(told)) return
  execFile(tmux, ["-L", NAME, "has-session"], { timeout: 5000 }, (e) => {
    if (e) return
    void plugin.runOp("ui.notify", { text: `Your terminals from before still run in tmux, which Vaultite no longer lists: tmux -L ${NAME} attach reaches them` })
      .then(() => fs.writeFileSync(told, `${new Date().toISOString()}\n`), () => {})
  })
}
setTimeout(tmuxLeft, 10_000).unref?.()

/** The server's environment, less what's about the server itself (npm's variables when run with npm start, PORT) and
 *  the agent's session that started it, if one did. */
function env(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    // (ELECTRON_RUN_AS_NODE: how the desktop app runs this server; a shell that kept it would start every Electron app,
    // Vaultite or VS Code, as plain Node, which exits at once)
    if (v === undefined || k.startsWith("npm_") || k.startsWith("VAULTITE_") || agentSession(k, v)
      || ["PORT", "HOST", "INIT_CWD", "TMUX", "TMUX_PANE", "ELECTRON_RUN_AS_NODE"].includes(k)) continue
    // (Windows' variables have any case, and a shell given Path and PATH would take either: one, Path)
    out[WIN && k.toUpperCase() === "PATH" ? PATH : k] = v
  }
  return { ...out, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Vaultite", LANG: out.LANG || (process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8") } // (a server may not have en_US generated)
}

/** The environment's PATH, as Windows spells it. */
const PATH = WIN ? "Path" : "PATH"

/** The app's folder (the repo, or the packaged app's resources): its bin/ holds the `vau` CLI. */
const APP_ROOT = path.resolve(plugin.dir, "..", "..", "..")

/** The folder whose vau a terminal finds first: the app's bin/ when Node runs the server; the desktop app (no `node`) and
 *  Windows (can't run bin/vau) get LOCAL/bin's shims running it with the server's runtime as Node (vaushims.ts). */
function vauBin(): string {
  if (!process.versions.electron && !WIN) return path.join(APP_ROOT, "bin")
  return shims(path.join(LOCAL_DIR, "bin"), vauShims({ exe: process.execPath, script: path.join(APP_ROOT, "bin", "vau"),
    mark: "vau for Vaultite's terminals (plugins/core/terminal), remade as needed." }))
}
/** Files written into `dir` where they're missing or differ: its path. */
function shims(dir: string, files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name)
    try {
      if (fs.readFileSync(file, "utf8") !== text) throw new Error("old")
    } catch {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, text, { mode: 0o755 })
    }
  }
  return dir
}
/** Where a terminal is opened from: through Tailscale Serve, and which app (the iPhone app and an attached desktop app set
 *  a cookie: core/phoneapp.ts, electron/host.ts). */
type From = { remote: boolean; client: "desktop" | "iphone" | "web" }
const LOCAL: From = { remote: false, client: process.env.VAULTITE_DESKTOP === "1" ? "desktop" : "web" }
function fromReq(req: IncomingMessage): From {
  const app = /(?:^|;\s*)vaultite_client=(iphone|desktop)(?:;|$)/.exec(req.headers.cookie ?? "")?.[1] as From["client"] | undefined
  return { remote: typeof req.headers["tailscale-user-login"] === "string", client: app ?? LOCAL.client }
}

/** Programs a terminal finds right after vau, before the user's own (the server's VAULTITE_AGENT_BIN): QA's stand-in
 *  agents, so QA never starts a real one. */
const AGENT_BIN = process.env.VAULTITE_AGENT_BIN ?? ""

/** What a shell is told about where it runs (see the docstring): Vaultite's variables, and PATH with the app's bin/.
 *  A WSL distro's get them through WSLENV, paths made its own (/p), with its own vau. */
function context(id: string | null, from: From, sh = shell()): Record<string, string> {
  const bin = vauBin(), kind = kindOf(sh)
  shellFiles()
  const out: Record<string, string> = {
    VAULTITE: "1",
    VAULTITE_URL: serverUrl(),
    VAULTITE_VAULT: plugin.vault.path,
    VAULTITE_CLIENT: from.client,
    ...(id ? { VAULTITE_TERMINAL: id } : {}),
    VAULTITE_BIN: bin,
    ...(AGENT_BIN ? { VAULTITE_AGENT_BIN: AGENT_BIN } : {}),
    [PATH]: [bin, AGENT_BIN, env()[PATH]].filter(Boolean).join(path.delimiter),
  }
  // zsh reads its startup files from SHELL_DIR, which reads the user's (backend.ts) and puts VAULTITE_BIN first.
  if (kind === "posix" && progName(sh) === "zsh") {
    Object.assign(out, { ZDOTDIR: SHELL_DIR, VAULTITE_ZDOTDIR: SHELL_DIR })
    if (process.env.ZDOTDIR) out.VAULTITE_USER_ZDOTDIR = process.env.ZDOTDIR
  }
  if (from.remote) out.VAULTITE_REMOTE = "tailscale"
  if (kind === "wsl") {
    out.VAULTITE_BIN = writeWslVau()
    const paths = new Set(["VAULTITE_BIN", "VAULTITE_VAULT", "VAULTITE_AGENT_BIN"])
    const names = [...new Set([...Object.keys(out).filter((k) => k.startsWith("VAULTITE")), "VAULTITE_TERMINAL", "TERM", "COLORTERM", "TERM_PROGRAM"])]
    out.WSLENV = [process.env.WSLENV, ...names.map((k) => (paths.has(k) ? `${k}/p` : k))].filter(Boolean).join(":")
  }
  return out
}

/** What a coding agent run here is told: it's inside Vaultite (context.md, read each time so it can be edited), then
 *  the line of each plugin that's on (its manifest's forAgents: the vault's rules, the user's file...). */
function agentContext() {
  let text = ""
  try { text = fs.readFileSync(path.join(plugin.dir, "context.md"), "utf8").trim() } catch { /* none */ }
  const lines = agentLines(plugin.vault).map((l) => `- ${l.text}`)
  return [text, ...lines].filter(Boolean).join("\n")
}

/** The vault's events hear `type` (plugin.emit), once the app runs this plugin's operations: what the terminal server
 *  tells as it's first reached (an end while the server was away) can come while the plugin still loads. */
const early: [string, Record<string, unknown>][] = []
const hostUp = () => { try { return !!plugin.host } catch { return false } }
function tell(type: string, data: Record<string, unknown>) {
  if (hostUp()) return void plugin.emit(type, data)
  if (early.push([type, data]) > 1) return
  const t = setInterval(() => { if (!hostUp()) return; clearInterval(t); for (const [k, d] of early.splice(0)) plugin.emit(k, d) }, 200)
  t.unref?.()
}

/** Which agent a terminal id runs, and the session it resumes. */
export function agentOf(id: string): { name: string; resume: string | null; profile: string | null } | null {
  const t = parseTerminal(id)
  return t && !t.machine && typeof plugin.service(`agent:${t.agent}`) === "function" ? { name: t.agent, resume: t.resume, profile: t.profile } : null
}

/** Where a terminal's state is kept (what its agent's hooks said last: working, waiting[:kind] or idle), whatever its
 *  backend; `<file>.osc` once its program spoke OSC 7501 (the hooks then say nothing: stateCommand). */
const stateFile = (id: string) => path.join(STATES, id)
const oscMark = (id: string) => `${stateFile(id)}.osc`
function stateOf(id: string) {
  try { return fs.readFileSync(stateFile(id), "utf8").trim() || undefined } catch { return undefined }
}

// --- a terminal's state, for the list and the Inbox ("inbox:state"): OSC 7501 when its program speaks it (osc7501.ts),
// else its agent's hooks (the state file), else its screen (watchAsks); blocked while its agent says it waits (waits).

/** A change of a terminal's state, as the service "inbox:state" hears it. `msg` is the program's text: untrusted. */
export type StateChange = { terminal: string; agent: string; state: SessionState; kind?: Kind; msg?: string; from: "osc7501" | "hooks" | "screen" | "agent"; at: number }
type Now = Omit<StateChange, "terminal" | "at">

/** What each terminal's program said in OSC 7501, by terminal. */
const osc = new Map<string, Said>()
/** The question each agent terminal shows that its hooks can't tell (they don't run yet): it waits on the user. */
const asking = new Map<string, AgentAsk>()
/** An OSC 7501 program's own name, as the agent whose service runs it. */
const AGENT_APPS: Record<string, string> = { "claude-code": "claude" }

/** What agent terminals' agents say of themselves outside the terminal (Claude Code's session file): it waits on the
 *  user, for a permission or a question. The service "terminal:agent-waits". */
const waits = new Map<string, Kind>()

/** Terminal `id`'s state now, or null when nothing says. */
function stateNow(id: string): Now | null {
  const now = ownState(id), kind = waits.get(id)
  // (a dialog neither its hooks nor its OSC 7501 reports tell, as Claude Code's one-time notices: it still works there)
  if (!kind || now?.state === "blocked") return now
  const ask = asking.get(id)
  return { agent: now?.agent || agentOf(id)?.name || "", state: "blocked", kind, ...(ask ? { msg: ask.says } : {}), from: "agent" }
}

/** What the terminal's own sources say (stateNow's, before its agent's word). */
function ownState(id: string): Now | null {
  const agent = agentOf(id)?.name ?? ""
  const o = osc.get(id), st = o?.status
  if (st) {
    // (blocked without saying why, as Codex says it: the question its agent declares on its screen does)
    const ask = st.state === "blocked" && !st.kind ? asking.get(id) : undefined
    const kind = st.kind ?? (ask ? "permission" : undefined), msg = shown(st.msg) ?? ask?.says
    return { agent: agent || AGENT_APPS[st.app ?? ""] || st.app || "", state: st.state, ...(kind ? { kind } : {}), ...(msg ? { msg } : {}), from: "osc7501" }
  }
  // (a program that speaks it says nothing before its session starts: Claude Code's folder trust is only on its screen)
  const [hook, kind] = o?.seen ? [] : (stateOf(id) ?? "").split(":")
  if (hook === "working" || hook === "idle") return { agent, state: hook, from: "hooks" }
  if (hook === "waiting") return { agent, state: "blocked", ...(kind === "permission" || kind === "question" ? { kind } : {}), from: "hooks" }
  const ask = asking.get(id)
  if (ask) return { agent, state: "blocked", kind: "permission", msg: ask.says, from: "screen" }
  return null
}

/** What was said last about each terminal (`state` null: nothing after something), and a change waiting its turn. */
const told = new Map<string, { now: Now; at: number; timer?: ReturnType<typeof setTimeout> }>()
/** What hears each state as it's told (terminal.wait). */
const stateHeard = new Set<(id: string, now: Now) => void>()
/** How soon after the last a change is told: a program can change state as fast as it writes, and what it causes
 *  outside the terminal is rate-limited (a new state at most 4 times a second, a new message every 2 s). */
const STATE_GAP = 250, MSG_GAP = 2000

/** The app's meta kept with each terminal by its backend (through restarts): its `name` (terminal.rename) and the `note`
 *  it was started on (terminal.run: its tab opens beside it). A backend without setMeta has it kept here till a restart. */
const metas = new Map<string, Record<string, string>>()
const metaOf = (id: string) => metas.get(id) ?? {}
const noteOf = (id: string) => metaOf(id).note as string | undefined
const nameOf = (id: string) => metaOf(id).name as string | undefined
async function setMeta(id: string, patch: Record<string, string | null>) {
  const next = { ...metaOf(id) }
  for (const [k, v] of Object.entries(patch)) if (v) next[k] = v; else delete next[k]
  metas.set(id, next)
  const b = await backendOf(id)
  if (b?.setMeta) await b.setMeta(id, patch)
  listChanged()
}
const startedOn = (id: string, rel: string) => setMeta(id, { note: rel }).catch(() => {})
/** Where a terminal's name and note were kept before the terminal server kept them: moved there once it lists it. */
const oldMetaFiles = (id: string) => ({ name: `${stateFile(id)}.name`, note: `${stateFile(id)}.note` })
function oldMeta(b: Backend, x: Shell) {
  if (!b.setMeta || x.meta?.name || x.meta?.note) return
  const files = oldMetaFiles(x.id), patch: Record<string, string> = {}
  for (const [k, f] of Object.entries(files)) try { const v = fs.readFileSync(f, "utf8"); if (v) patch[k] = v } catch { /* none */ }
  if (!Object.keys(patch).length) return
  x.meta = { ...x.meta, ...patch }
  void b.setMeta(x.id, patch).then(() => { for (const f of Object.values(files)) fs.rmSync(f, { force: true }) }, () => {})
}

/** Terminal `id`'s state may have changed: the list hears it, and the Inbox ("inbox:state") does once it has. */
function stateChanged(id: string) {
  listChanged()
  const last = told.get(id)
  if (last?.timer) return
  // (nothing says any more after something did: it's at rest, as a program cleared or gone says)
  const now = stateNow(id) ?? (last ? { ...last.now, state: "idle" as const, kind: undefined, msg: undefined } : null)
  if (!now) return
  const gap = !last ? 0 : now.state !== last.now.state || now.kind !== last.now.kind ? STATE_GAP : now.msg !== last.now.msg ? MSG_GAP : -1
  if (gap < 0) return
  const wait = last ? last.at + gap - Date.now() : 0
  if (wait > 0) {
    told.set(id, { ...last!, timer: setTimeout(() => { told.set(id, { ...last!, timer: undefined }); stateChanged(id) }, wait) })
    return
  }
  told.set(id, { now, at: Date.now() })
  const change: StateChange = { terminal: id, ...now, at: Date.now() }
  for (const k of ["kind", "msg"] as const) if (change[k] === undefined) delete change[k]
  // (terminal.wait and `vau events --type terminal` hear it too)
  tell("terminal.state", { id, agent: now.agent, state: now.state, ...(now.kind ? { kind: now.kind } : {}), ...(now.msg ? { msg: now.msg } : {}), from: now.from })
  for (const fn of stateHeard) fn(id, now)
  try { void Promise.resolve(plugin.service("inbox:state")?.(change)).catch((e) => console.error("terminal: inbox:state:", e)) } catch (e) { console.error("terminal: inbox:state:", e) }
}

/** A backend heard terminal `id`'s program in OSC 7501. The first time, its hooks stop saying anything (`oscMark`). */
function oscSaid(id: string, said: Said) {
  if (!TERMINAL_ID.test(id) || id.startsWith(SPARE)) return
  const was = osc.get(id)
  osc.set(id, said)
  if (said.seen && !was?.seen) try { fs.mkdirSync(STATES, { recursive: true }); fs.writeFileSync(oscMark(id), "") } catch { /* hooks go on */ }
  if (JSON.stringify(was) === JSON.stringify(said)) return
  const st = said.status, agent = agentOf(id)?.name
  if (st?.state !== "blocked" || st.kind || !agent) { asking.delete(id); return stateChanged(id) }
  // Blocked, not saying why: told once its screen shows the question (Approve and Deny need it), or soon without.
  void askShown(id, agent).finally(() => stateChanged(id))
}

/** The question agent terminal `id` shows (its agent declares it), looked for while its screen draws it: kept in
 *  `asking` while it's still blocked. */
async function askShown(id: string, agent: string) {
  const asks = await asksOf(agent), b = await backendOf(id)
  if (!asks.length || !b) return
  for (let i = 0; i < 8 && osc.get(id)?.status?.state === "blocked"; i++) {
    const hit = await askOn(b, id, asks)
    if (hit) { if (osc.get(id)?.status?.state === "blocked") asking.set(id, hit); return }
    await new Promise((r) => setTimeout(r, 200))
  }
}

/** A terminal ended: what was kept of its state goes (the Inbox hears "terminal.ended"). */
function forgetState(id: string) {
  for (const f of [stateFile(id), oscMark(id), ...Object.values(oldMetaFiles(id))]) try { fs.rmSync(f, { force: true }) } catch { /* none */ }
  osc.delete(id); asking.delete(id); metas.delete(id); waits.delete(id)
  clearTimeout(told.get(id)?.timer)
  told.delete(id)
}

/** Times agent terminal `id` from its start to its agent's first word (a hook, or OSC 7501), a minute at most: the
 *  span "agent.ready". Its shell finding no such program instead (MISSING) is told to the user. */
function agentReady(id: string, agent: string) {
  const timing = span("agent.ready", { agent }), until = Date.now() + 60_000
  const look = () => {
    if (stateOf(id) === MISSING) return void agentMissing(id, agent)
    if (fs.existsSync(stateFile(id)) || osc.get(id)?.seen) return void timing.end()
    if (Date.now() < until) setTimeout(look, 50).unref?.()
  }
  look()
  void watchAsks(id, agent)
}

const asksOf = (agent: string) => plugin.ask<AgentAsk[]>(`agent-asks:${agent}`, []).catch(() => [] as AgentAsk[])
/** Which of `asks` terminal `id` shows at its bottom now, if any (each looked for in its last `lines`). */
export async function askOn(b: Pick<Backend, "capture">, id: string, asks: AgentAsk[]) {
  if (!asks.length) return null
  const most = Math.max(...asks.map((a) => a.lines ?? 12))
  const all = (await screenOf(b, id, most)).replace(/\s+$/, "").split("\n")
  return asks.find((a) => a.match.test(all.slice(-(a.lines ?? 12)).join("\n"))) ?? null
}

/** Watches agent terminal `id` for a question its agent declares (Approve and Deny press its keys) until its hooks or,
 *  with the Inbox hearing states, OSC 7501 say it; an agent with neither (Codex) while it runs. "terminal:waits". */
async function watchAsks(id: string, agent: string) {
  if (watching.has(id)) return
  watching.add(id)
  try { await watchFor(id, agent) } finally { watching.delete(id) }
}
const watching = new Set<string>()
async function watchFor(id: string, agent: string) {
  const asks = await asksOf(agent)
  if (!asks.length) return
  const said = () => fs.existsSync(stateFile(id)) || !!osc.get(id)?.status
  for (let b = await backendOf(id); b && !said(); b = await backendOf(id)) {
    const hit = await askOn(b, id, asks)
    if (hit?.id !== asking.get(id)?.id) {
      if (hit) asking.set(id, hit)
      else asking.delete(id)
      stateChanged(id)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  if (asking.delete(id)) stateChanged(id)
}

/** The question terminal `id` shows (its agent's, or `agent`'s for one run by hand in a plain shell), or null. */
async function askIn(id: string, agent = "") {
  const b = await backendOf(id), name = agentOf(id)?.name ?? agent
  return b && /^[\w-]{1,40}$/.test(name) ? { b, hit: await askOn(b, id, await asksOf(name)) } : { b, hit: null }
}

/** Whether terminal `id` waits on the user now: a question on its screen, or its state says so. */
plugin.provide("terminal:waits", async (id: string, agent = "") => !!(await askIn(id, agent)).hit || stateNow(id)?.state === "blocked")
/** Terminal `id`'s state now (StateChange without its time), or null when nothing says. */
plugin.provide("terminal:state", (id: string) => (TERMINAL_ID.test(id) ? stateNow(id) : null))
/** Agent terminal `id`'s agent says it waits on the user (`kind`: a permission or a question), or no longer (null). */
plugin.provide("terminal:agent-waits", (id: string, kind: Kind | null) => {
  if (!TERMINAL_ID.test(id) || (kind !== null && kind !== "permission" && kind !== "question") || (waits.get(id) ?? null) === kind) return
  if (kind) waits.set(id, kind)
  else waits.delete(id)
  stateChanged(id)
})
/** A terminal's last `lines` lines as text ("" when it can't be read). */
const screenOf = (b: Pick<Backend, "capture">, id: string, lines: number) => b.capture(id, { format: "text", lines }).then((c) => c.text, () => "")
/** Terminal `id`'s last `lines` lines as text, or "" when it isn't running here. */
plugin.provide("terminal:screen", async (id: string, lines = 40) => {
  const b = TERMINAL_ID.test(id) ? await backendOf(id) : null
  return b ? screenOf(b, id, Math.min(Math.max(1, Math.trunc(lines) || 40), 200)) : ""
})

// The backends tell each terminal's OSC 7501 records as they change (onEvent); the hooks' state files are watched.
let hooksWatch: fs.FSWatcher | null = null
try {
  fs.mkdirSync(STATES, { recursive: true })
  // (the folder is every server's on this machine: only this one's terminals)
  hooksWatch = fs.watch(STATES, (_e, name) => { if (name && TERMINAL_ID.test(String(name))) void runsHere(String(name)).then((here) => here && stateChanged(String(name))) })
  hooksWatch.on("error", () => {})
} catch (e) { console.error("terminal: can't watch the agents' state files:", e) }
plugin.onUnload(() => hooksWatch?.close())

/** What an agent's state file says when its shell had no such command (exit 127): it isn't installed here. */
const MISSING = "missing"
/** The agent's command, then its state file marked MISSING when the shell found no such program. */
export function markMissing(command: string, file: string, sh = shell()) {
  const mark = `printf %s ${MISSING} > ${shellQuote(file)} 2>/dev/null`
  return progName(sh) === "fish" ? `${command}; if test $status -eq 127; ${mark}; end` : `${command}; if [ $? -eq 127 ]; then ${mark}; fi`
}

/** Agent terminal `id`'s program isn't installed: the user is told (its terminal shows the shell's error), and the
 *  plugin that started it hears "terminal.agent-missing". */
function agentMissing(id: string, agent: string) {
  const name = agentName(agent) ?? agent
  tell("terminal.agent-missing", { id, agent })
  void plugin.runOp("ui.notify", { text: `${name} isn't installed on this machine: install it, then start it again`, error: true, terminal: id }).catch(() => {})
}

/** A hook's command marking a terminal's state in `file` (the stream hears it: "inbox:state"); nothing once file `osc`
 *  is there (the agent speaks OSC 7501, which says it all). */
export function stateCommand(file: string, osc?: string | null) {
  const mark = (s: AgentState, kind?: string | null) => `printf %s ${kind && s === "waiting" ? `${s}:${kind}` : s} > ${shellQuote(file)} 2>/dev/null || true`
  return osc ? (s: AgentState, kind?: string | null) => `[ -e ${shellQuote(osc)} ] || { ${mark(s, kind)}; }` : mark
}

/** The URL an agent's hook POSTs to for terminal `id`'s state (the route below), where its hooks can't run a shell line. */
const stateUrl = (id: string, s: AgentState, kind?: string | null) =>
  `${serverUrl()}/api/terminals/${encodeURIComponent(id)}/state?s=${s}${kind && s === "waiting" ? `&kind=${kind}` : ""}`
/** Windows' curl (in System32 since Windows 10), POSTing to `url`: a hook as a program, where no shell line runs. */
const curlPost = (url: string) => [path.join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe"), "-s", "-m", "2", "-o", "NUL", "-X", "POST", url]

/** The line an agent's terminal runs in shell `sh`, and where (null: a plain shell): its command (in WSL, WSL's paths);
 *  in PowerShell and cmd its `argv` through starter.ts (else Git Bash), its hooks POSTing to the server. */
async function agentRun(id: string, prompt: string | null, dark: boolean | null, how: AgentHow, sh: string): Promise<AgentRun | null> {
  const a = agentOf(id)
  if (!a) return null
  try { fs.mkdirSync(STATES, { recursive: true }); forgetState(id) } catch { /* unmarked */ }
  const kind = kindOf(sh), native = kind === "pwsh" || kind === "cmd"
  // (paths in a POSIX line as its shell reads them: WSL's own, Git Bash's C:/x)
  const there = kind === "wsl" ? wslPath : WIN ? (p: string) => p.replace(/\\/g, "/") : (p: string) => p
  // (hooks only for an agent that doesn't speak OSC 7501: until it does, they mark its state)
  const set = native ? null : stateCommand(there(stateFile(id)), there(oscMark(id)))
  try {
    const report = plugin.service("activity:report"), reportUrl = plugin.service("activity:report-url")
    const url = reportUrl ? String(reportUrl(a.name, id)) : null
    const run: AgentCommand | null = await plugin.service(`agent:${a.name}`)!({ resume: a.resume, context: agentContext(), state: set,
      report: native ? null : kind === "wsl" ? (url ? `${curlPost(url).map((x, i) => (i ? shellQuote(x) : "curl.exe")).join(" ")} -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true` : null)
        : report ? report(a.name, id) : null,
      ...(native ? { stateHook: (s: AgentState, k?: string | null) => ({ url: stateUrl(id, s, k), argv: curlPost(stateUrl(id, s, k)) }), reportUrl: url } : {}),
      ...(kind === "wsl" ? { wsl: true } : {}),
      profile: a.profile, prompt, dark, ...how } satisfies AgentStart)
    if (!run || typeof run.command !== "string" || !run.command) return null
    // (a resumed session's own folder, else the one it was asked to start in)
    let cwd = typeof run.cwd === "string" && run.cwd ? run.cwd : how.cwd || null
    try { if (cwd && !fs.statSync(cwd).isDirectory()) cwd = null } catch { cwd = null }
    if (!native) return { command: markMissing(run.command, there(stateFile(id)), kind === "wsl" ? "sh" : sh), cwd }
    const bash = Array.isArray(run.argv) && run.argv.length ? null : gitBash()
    const argv = bash ? [bash, "-l", "-c", markMissing(run.command, stateFile(id).replace(/\\/g, "/"), bash)] : run.argv
    if (!argv?.length) return { command: run.command, cwd }
    return { command: starterLine(id, { argv, env: run.env ?? {}, cwd, state: stateFile(id) }, kind), cwd }
  } catch {
    return null
  }
}

/** The line PowerShell or cmd runs to start `job` (starter.ts), by the server's own runtime as Node. */
function starterLine(id: string, job: Job, kind: ShellKind) {
  fs.mkdirSync(TMP, { recursive: true })
  const file = path.join(TMP, `run-${id}.json`)
  fs.writeFileSync(file, JSON.stringify(job), { mode: 0o600 })
  const words = [process.execPath, path.join(plugin.dir, "starter.ts"), file], electron = !!process.versions.electron
  if (kind === "pwsh") return [electron && "$env:ELECTRON_RUN_AS_NODE = '1'", `& ${words.map(psQuote).join(" ")}`, electron && "Remove-Item Env:ELECTRON_RUN_AS_NODE"].filter(Boolean).join("; ")
  return [electron && 'set "ELECTRON_RUN_AS_NODE=1"', words.map((w) => `"${w}"`).join(" "), electron && 'set "ELECTRON_RUN_AS_NODE="'].filter(Boolean).join(" & ")
}

/** Light or dark as appearance.json sets it, for a terminal started with no window to ask (an agent's); null when it
 *  follows each device's. */
function savedDark(): boolean | null {
  const t = (plugin.vault.configWithDefaults("appearance") as { theme?: unknown } | null)?.theme
  return t === "dark" ? true : t === "light" ? false : null
}

const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Math.trunc(Number(n))
  return Number.isFinite(v) && v > 0 ? Math.min(hi, Math.max(lo, v)) : dflt
}

/** The vault's folder, as the shell sees it (resolved: iCloud's folder is a link). */
function vaultDir() {
  try { return fs.realpathSync(plugin.vault.path) } catch { return plugin.vault.path }
}

// --- a shell kept ready: a login shell's startup files take up to seconds, so one is started ahead per kind of page
// (local, remote), taken by the next terminal (renamed to its id), then replaced. A starting server drops older ones.
const spares = new Map<string, { b: Backend; name: string; ready: Promise<boolean> }>() // by backend and From

async function dropSpares() {
  for (const b of backends()) {
    if (!b.spares) continue
    for (const x of await b.list().catch(() => [] as Shell[])) if (x.id.startsWith(SPARE)) await b.kill(x.id).catch(() => {})
  }
}
const dropped = dropSpares()

function makeSpare(from: From) {
  void (async () => {
    const b = await backendForNew(), sh = shell()
    const key = spareKey(b, from, sh)
    if (!b.spares || !sameShell(sh) || spares.has(key)) return
    const name = `${SPARE}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    // (its id comes when it's taken)
    const ready = dropped.then(() => b.create(name, { shell: sh, run: null, cwd: vaultDir(), env: env(), ctx: context(null, from, sh), cols: 120, rows: 40, scrollback: scrollback() },
      { spare: true })).then(() => true, () => false)
    spares.set(key, { b, name, ready })
  })()
}
const refill = (from: From) => setTimeout(() => makeSpare(from), 1500).unref?.()
/** Which ready shell a terminal can take: its backend's, for its kind of page, of the shell it starts, on the PATH it'd
 *  get now (one made before the server's PATH changed would miss what's on it). */
const spareKey = (b: Backend, from: From, sh: string) => `${b.name}:${from.remote}:${from.client}:${sh}:${process.env[PATH] ?? ""}`

/** The ready shell of backend `b`, renamed to session `id` (the agent's command started in it, which clears its screen
 *  and history: runScript): false when there's none. */
async function takeSpare(b: Backend, id: string, from: From, run: AgentRun | null, sh: string, made: Made) {
  const key = spareKey(b, from, sh)
  const spare = spares.get(key)
  if (!spare || !b.rename) return false
  spares.delete(key)
  if (!(await spare.ready)) return false
  try { await b.rename(spare.name, id, made) } catch { return false }
  if (run) {
    fs.mkdirSync(TMP, { recursive: true })
    // (with its Enter: a shell at its prompt reads it as typed, so no pause before it)
    await b.send(id, { text: `${runScript(path.join(TMP, `run-${id}.sh`), id, run, kindOf(sh))}\r` })
  }
  return true
}

/** Starts a session (in the backend new ones go to), or reattaches to its shell if one runs (`fresh` says which). */
async function start(id: string, cols: number, rows: number, from = LOCAL, prompt: string | null = null, dark: boolean | null = null,
  how: AgentHow = {}, o: { command?: string; name?: string } = {}): Promise<{ s: Session; fresh: boolean }> {
  const agent = agentOf(id), timing = span("terminal.start", { agent: agent?.name ?? "shell", how: "running" })
  let b = await backendOf(id)
  timing.mark("find")
  const fresh = !b
  let cwd = "" // (a new agent's folder)
  if (!b) {
    b = await backendForNew()
    // A coding agent: the login shell (interactive, so it has the user's PATH) runs it, then becomes a plain shell.
    const sh = shell(), command = o.command ? { command: o.command, cwd: how.cwd || null } : null
    const run = command ?? await agentRun(id, prompt, dark, how, sh)
    if (agent) timing.mark("agent")
    const spec: Spec = { shell: sh, run, only: !!command, cwd: how.cwd || vaultDir(), env: env(), ctx: context(id, from, sh), cols, rows, scrollback: scrollback() }
    if (run) cwd = run.cwd || spec.cwd
    // (what its list says it runs, and the name it's given)
    const made: Made = { command: o.command ?? agent?.name ?? progName(sh), ...(o.name ? { meta: { name: o.name } } : {}) }
    timing.tags.how = "spare"
    if (command || !(b.spares && (await takeSpare(b, id, from, run, sh, made)))) {
      timing.tags.how = "new"
      try { await b.create(id, spec, made) } catch (e) {
        // (out of ptys, the server couldn't start one either: the keeper's message says why)
        if (b !== keeper || /no pseudo-terminal left/.test((e as Error).message)) throw e
        console.error("terminal: the keeper couldn't start a shell, so this server holds it:", e)
        b = fallback
        await b.create(id, spec, made)
        // Said out loud: a restart (a deploy) ends this one, and nothing else would show it until then.
        void plugin.runOp("ui.notify", { text: `This terminal runs in the server, not Vaultite's keeper, so restarting the server ends it (the keeper: ${(e as Error).message})`,
          error: true, terminal: id }).catch(() => {})
      }
    }
    if (b.spares) refill(from)
    if (!ours(b)) ownedBy(id, b)
    // (a backend that keeps no meta: kept here)
    if (!b.setMeta && made.meta) metas.set(id, made.meta)
    timing.mark("shell")
    if (agent && run && !command) agentReady(id, agent.name)
  }
  const backend = b
  const link = await backend.attach(id, cols, rows)
  timing.mark("attach")
  const s: Session = { id, backend, link, clients: new Set(), started: Date.now(), pending: new Set(), ended: false,
    opened: `${timing.tags.how} ${Math.round(timing.end())}ms`, queued: "", owed: new Map(), acks: new Set(), held: false }
  link.onData((data) => {
    // (a burst comes as many messages in one read: the microtask runs once that read's are all in)
    if (!s.queued) queueMicrotask(() => flush(s))
    s.queued += data
  })
  link.onExit(async (exit) => {
    clearTimeout(s.stall)
    flush(s)
    if (sessions.get(id) === s) sessions.delete(id)
    listChanged()
    // Only our hold on it ended (a plugin backend's attach client was killed): the clients reconnect, which reattaches.
    if (!exit && !s.ended && (await backend.list().catch(() => [] as Shell[])).some((x) => x.id === id && !x.exit)) {
      for (const ws of s.clients) ws.close(1012, "reattach")
      return
    }
    // Ended by us: a SIGHUP, as when a shell is killed directly.
    const { code, signal, lost } = s.ended ? { code: 0, signal: 1, lost: false } : exit ?? { code: 0, signal: 0, lost: false }
    // (a backend that tells its terminals' ends tells this one: onEvent)
    if (!backend.events) exited(id, { code, signal, lost })
    for (const ws of s.clients) {
      if (ws.readyState !== ws.OPEN) continue
      ws.send(JSON.stringify({ t: "exit", code, signal, ...(lost ? { lost: true } : {}), ...(s.ended && !s.kept ? { ended: true } : {}) }))
      ws.close(EXITED, "exited")
    }
  })
  sessions.set(id, s)
  endedOnPurpose.delete(id)
  listChanged()
  // An agent whose folder macOS keeps from the keeper stops with its own vague error ("Unexpected"): its tabs say why.
  if (cwd && backend === keeper && process.platform === "darwin") {
    void keeper.access(cwd).then((a) => {
      if (a?.ok !== false) return
      s.blocked = true
      for (const ws of s.clients) if (ws.readyState === ws.OPEN) ws.send(BLOCKED)
    })
  }
  return { s, fresh }
}

/** The sessions ended for good here (End session, x, vau terminal end, a shell's clean exit), lately: their tabs close,
 *  the ones open now (the exit says `ended`) and the ones put back later (they hear "gone", `ended`), on any device. */
const endedOnPurpose = new Set<string>()
function markEnded(id: string) {
  endedOnPurpose.add(id)
  if (endedOnPurpose.size > 500) endedOnPurpose.delete(endedOnPurpose.values().next().value!)
}

/** The terminals ended on purpose (End session, x, vau terminal end) whose end isn't told yet; `keep`: their tabs stay,
 *  saying it ended (an agent's handed session after its report). */
const purposeful = new Map<string, { keep: boolean }>()
/** The terminals whose end was told (by id, till one starts again with it). */
const toldEnded = new Set<string>()

/** Terminal `id` ended (its backend tells, else its link here): the Inbox and the rest hear "terminal.ended", once. */
function exited(id: string, exit: { code: number; signal: number; lost?: boolean }) {
  if (toldEnded.has(id)) return
  toldEnded.add(id)
  if (toldEnded.size > 500) toldEnded.delete(toldEnded.values().next().value!)
  const p = purposeful.get(id)
  purposeful.delete(id)
  // Ended by us: a SIGHUP, as when a shell is killed directly.
  const { code, signal } = p ? { code: 0, signal: 1 } : exit
  const lost = !p && !!exit.lost
  // A clean exit (an agent's too: the shell after it) closes its tabs, the ones away now once they're put back; an
  // agent's session that died, or one lost with its terminal server, keeps its tabs, saying so, with Restart.
  if (!code && !signal && !lost) markEnded(id)
  forgetState(id)
  // (onPurpose: the user ended it, End session or vau terminal end: the Inbox takes its row as dealt with)
  tell("terminal.ended", { id, code, signal, ...(lost ? { lost: true } : {}), ...(p && !p.keep ? { onPurpose: true } : {}) })
  exits.set(id, { ...exit, at: Date.now() })
  if (exits.size > 200) exits.delete(exits.keys().next().value!)
  for (const fn of exitHeard) fn(id)
  listChanged()
}

/** Ends a session for good: its shell, not just this server's hold on it. `keep`: see purposeful. */
function end(s: Session, keep = false) {
  s.ended = true
  s.kept = keep
  purposeful.set(s.id, { keep })
  if (!keep) markEnded(s.id)
  void s.backend.kill(s.id).catch(() => {})
}
/** The same, for one this server holds no session of (a tab closed after a restart, vau terminal end). */
async function endHere(b: Backend, id: string, keep = false) {
  purposeful.set(id, { keep })
  if (!keep) markEnded(id)
  await b.kill(id)
  if (!b.events) exited(id, { code: 0, signal: 1 })
}

/** What a backend tells as it happens: its programs' OSC 7501, terminals starting and ending, their meta. (A title is
 *  read with the next list: an agent's spinner retitles it many times a second.) */
function onEvent(b: Backend, ev: BackendEvent) {
  if (!TERMINAL_ID.test(ev.id) || ev.id.startsWith(SPARE)) return
  if (ev.type === "status") return oscSaid(ev.id, ev.said)
  if (ev.type === "exited") return exited(ev.id, ev.exit)
  if (ev.type === "title") return
  if (ev.type === "started") {
    toldEnded.delete(ev.id)
    exits.delete(ev.id)
    const meta = ev.info?.meta ?? {}
    tell("terminal.started", { id: ev.id, agent: agentOf(ev.id)?.name ?? null, ...(ev.info?.command ? { command: ev.info.command } : {}), ...(meta.name ? { name: meta.name } : {}) })
  }
  if (ev.type === "meta" && b.setMeta) metas.set(ev.id, ev.meta)
  listChanged()
}
for (const b of [keeper, fallback]) b.events?.((ev) => onEvent(b, ev))

/** One shell, one size: the last device to send its own wins. Every device hears it, so one that's used again and
 * doesn't fit (the phone shrank it) sends its size back (Terminal.tsx: claim) and the program redraws for it. */
function resize(s: Session, cols: number, rows: number) {
  if (s.link.cols === cols && s.link.rows === rows) return
  s.link.resize(cols, rows)
  const msg = JSON.stringify({ t: "size", cols, rows })
  for (const ws of s.clients) if (ws.readyState === ws.OPEN) ws.send(msg)
}

function attach(s: Session, ws: WebSocket, fresh: boolean) {
  flush(s) // (what came before it is in its picture or replay)
  s.clients.add(ws)
  listChanged()
  ws.send(JSON.stringify({ t: "attached", fresh, scrollback: scrollback(), ...(fresh ? { started: s.opened } : {}) }))
  ws.send(JSON.stringify({ t: "size", cols: s.link.cols, rows: s.link.rows }))
  if (s.blocked) ws.send(BLOCKED)
  // The screen and its history as they are now, then what it prints from there on.
  s.pending.add(ws)
  s.link.snapshot((picture) => {
    flush(s) // (what came before the picture is in it: not for this page)
    s.pending.delete(ws)
    if (!picture || ws.readyState !== ws.OPEN) return
    const bytes = Buffer.from(picture, "utf8")
    ws.send(bytes)
    sent(s, ws, bytes.length)
  })
  const uploads = new Map<string, string>()
  ws.on("message", (data: RawData, binary: boolean) => {
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
    if (binary) {
      s.link.write(buf)
      // (a page's own answers to its terminal's questions aren't typing: a focus report, a DA)
      if (!buf.includes(27) || buf.length === 1) lastInput.set(s.id, Date.now())
      // Enter may have started a program (claude, vim): tabs show its name soon, not at the next poll.
      if (buf.includes(13)) setTimeout(listChanged, 400)
      return
    }
    let msg: { t?: string; cols?: number; rows?: number; id?: string; name?: string; data?: string; last?: boolean; lines?: number; n?: number }
    try { msg = JSON.parse(buf.toString("utf8")) } catch { return }
    if (msg.t === "resize") resize(s, clamp(msg.cols, 2, 1000, s.link.cols), clamp(msg.rows, 1, 500, s.link.rows))
    else if (msg.t === "ack" && Number.isSafeInteger(msg.n)) {
      s.owed.set(ws, Math.max(0, (s.owed.get(ws) ?? 0) - msg.n!))
      s.acks.add(ws)
      pace(s)
    }
    else if (msg.t === "close") end(s)
    else if (msg.t === "upload") {
      let file: string | null = null
      try { file = upload(s.id, uploads, msg) } catch (e) { console.error("terminal upload:", e); return }
      // (a WSL distro's shell is given the path as it sees it)
      if (file) void inWsl(s).then((wsl) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "uploaded", path: wsl ? wslPath(file!) : file })) })
    }
  })
  ws.on("close", () => {
    for (const f of uploads.values()) fs.rmSync(f, { force: true }) // (cut off: never pasted)
    s.clients.delete(ws)
    s.pending.delete(ws)
    s.owed.delete(ws)
    if (s.acks.delete(ws)) pace(s)
    listChanged()
  })
}

/** Whether session `s` is a WSL distro's shell. */
async function inWsl(s: Session) {
  return WIN && (await s.backend.list().catch(() => [] as Shell[])).find((x) => x.id === s.id)?.process === "wsl"
}

// --- another machine's shells (Machines): an id ending in @<machine> is let in here first, then joined to the same
// socket there, which checks again. A machine that doesn't answer drops the socket, so the tab tries again.

export const TERMINAL_ID = /^[\w-]{1,64}(@[a-z0-9][a-z0-9-]{0,62})?$/

const machineOf = (id: string) => plugin.ask<Machine | null>("machines:machine", null, id)
/** The other machines online that have a terminal. */
const terminalMachines = async () => (await plugin.ask<Machine[]>("machines", [])).filter((m) => !m.self && m.online && m.plugins?.includes("terminal"))

/** Joins this socket to `path` on machine `m` (see above). */
function joinRemote(ws: WebSocket, m: Machine | null, id: string, path: string, query: Record<string, string>) {
  if (!m || !m.online || !m.plugins?.includes("terminal")) {
    // Never a shell here instead: it's that machine's. Not listed, it won't come; listed, it may (the page tries again).
    if (!m) { ws.send(JSON.stringify({ t: "refused", reason: `this terminal runs on '${id}', which isn't one of this vault's machines` })); return ws.close(REFUSED, "refused") }
    ws.send(JSON.stringify({ t: "unreachable", machine: m.id, label: m.label, reason: !m.online ? "isn't answering" : "has its terminal turned off" }))
    return ws.close(1013, "unavailable")
  }
  pipeSockets(ws, machineSocket(m, path, query), () => {
    ws.send(JSON.stringify({ t: "unreachable", machine: m.id, label: m.label, reason: "isn't answering" }))
    ws.close(1011, "unreachable")
  })
}


/** Another machine's sessions: as followed for the Terminals panel, else asked once (its /api/terminals?local=1's first
 *  list); null when it doesn't answer in time. */
function sessionsOn(m: Machine, ms = 2500): Promise<Listed[] | null> {
  const r = remotes.get(m.id)
  if (r?.list.length) return Promise.resolve(r.list.map((x) => ({ ...x, id: splitMachine(x.id)[0] })))
  return new Promise((resolve) => {
    const sock = machineSocket(m, "terminals", { local: "1" })
    const done = (v: Listed[] | null) => { clearTimeout(timer); sock.terminate(); resolve(v) }
    const timer = setTimeout(() => done(null), ms)
    sock.on("message", (data: RawData) => {
      try { const msg = JSON.parse(String(data)); if (msg.t === "sessions" && Array.isArray(msg.list)) done(msg.list) } catch { /* not ours */ }
    })
    sock.on("error", () => done(null))
    sock.on("close", () => done(null))
  })
}

/** The machine a session runs on: this one's id (Machines' "machines:self"), another's whose list has it, or null (none
 *  that answers has it, or there are no machines). */
async function locate(id: string): Promise<string | null> {
  if (!TERMINAL_ID.test(id) || id.includes("@")) return null
  const self = await plugin.ask<unknown>("machines:self", null)
  if (await runsHere(id)) return typeof self === "string" && self ? self : null
  const others = await terminalMachines()
  const found = await Promise.all(others.map(async (m) => ((await sessionsOn(m))?.some((x) => x.id === id) ? m.id : null)))
  return found.find(Boolean) ?? null
}
plugin.provide("terminal:locate", locate)
/** Whether session `id` runs on this machine. */
plugin.provide("terminal:runs", runsHere)
/** What an agent the app runs outside a terminal gets as its environment (Claude Code's chat sessions): a shell's here,
 *  Vaultite's variables and the app's vau first on PATH, so its commands run as they would in a terminal. */
plugin.provide("terminal:agent-env", (): Record<string, string> => ({ ...env(), ...context(null, LOCAL) }))

const starting = new Map<string, Promise<{ s: Session; fresh: boolean }>>() // two sockets to a new id get the same shell

/** Refuse this socket if its request may not have a shell (in the socket, not before it: a refused upgrade reaches the
 *  page only as "closed", so it would retry forever). True when it may go on. */
async function allowed(ws: WebSocket, req: IncomingMessage) {
  const why = await plugin.refusal(req, "the terminal")
  if (why) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "refused", reason: why }))
    ws.close(REFUSED, "refused")
    return false
  }
  return ws.readyState === ws.OPEN
}

plugin.socket("terminal/*", async (ws, req, { wild, query }) => {
  const [id, at] = splitMachine(wild[0])
  if (!(await allowed(ws, req))) return
  if (at) {
    const m = await machineOf(at)
    // Machines turned off (no list to ask): a shell here with this id is the one (it was saved as this machine's).
    if (!m && !plugin.service("machines:machine") && (await runsHere(id))) { /* here */ }
    else if (!m?.self) return joinRemote(ws, m, at, `terminal/${encodeURIComponent(id)}`, query)
  }
  if (query.end) {
    const s = sessions.get(id)
    if (s) end(s)
    else { const b = await backendOf(id); if (b) await endHere(b, id).catch(() => {}) } // a tab closed while its session had no client here (after a restart)
    return ws.close(EXITED, "ended")
  }
  const cols = clamp(query.cols, 2, 1000, 80), rows = clamp(query.rows, 1, 500, 24)
  const s = sessions.get(id)
  if (s) {
    resize(s, cols, rows)
    return attach(s, ws, false)
  }
  // A tab put back asks only to attach: an agent's new session that ended (or was lost) isn't started again, nor
  // a session ended for good (its tab closes).
  const agent = agentOf(id), ended = endedOnPurpose.has(id)
  if (query.attach && (ended || (agent && !agent.resume)) && !starting.has(id) && !(await runsHere(id))) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "gone", ...(ended ? { ended: true } : {}) }))
    return ws.close(GONE, "gone")
  }
  // One another plugin's backend held (herdr's pane) is that backend's: while it's away its tab waits for it, never
  // starting a shell of its own under that id; gone from it, it's gone.
  const owned = ownerOf(id)
  if (owned && !starting.has(id) && !(await runsHere(id))) {
    const b = pluginBackend()
    if (b?.name === owned.backend && (await b.ready().catch(() => false))) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "gone" }))
      return ws.close(GONE, "gone")
    }
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "unreachable", backend: owned.backend, label: owned.label, reason: "isn't running here (or its plugin is off)" }))
    return ws.close(1013, "unavailable")
  }
  const first = !starting.has(id)
  // Through Tailscale Serve (allowed() checked who), or from the iPhone app: the shell may say so.
  if (first) starting.set(id, start(id, cols, rows, fromReq(req), null, query.dark === "1" ? true : query.dark === "0" ? false : null).finally(() => starting.delete(id)))
  starting.get(id)!.then(({ s, fresh }) => ws.readyState === ws.OPEN && attach(s, ws, first && fresh), (e) => {
    console.error("terminal:", e)
    if (ws.readyState !== ws.OPEN) return
    ws.send(Buffer.from(`\r\nCouldn't start a shell: ${(e as Error).message}\r\n`))
    ws.close(EXITED, "failed")
  })
}, {
  accept: (_req, { wild }) => {
    if (!TERMINAL_ID.test(wild[0])) throw new HTTPError(400, "a terminal id is letters, digits, - and _ (then @machine for another machine's)")
  },
})

// --- the list of sessions (the Terminals panel), a WebSocket at /api/terminals, sent on connect and on every change
// (`process` polled every 2 s while watched; other machines' every 30 s). Same access as a shell: it names what runs.
const watchers = new Map<WebSocket, boolean>() // socket -> this machine's sessions only (?local=1)
const lastList = new Map<boolean, string>()
let listTimer: ReturnType<typeof setTimeout> | null = null
let poll: ReturnType<typeof setInterval> | null = null
let follow: ReturnType<typeof setInterval> | null = null

type Listed = { id: string; agent: string | null; process: string; busy: boolean; clients: number; started: number; title?: string
  /** What its program is doing (stateNow), while something runs in it; `kind` and `msg` (untrusted) as it said. */
  state?: SessionState; kind?: Kind; msg?: string
  /** The Inbox has a row for it that needs the user, unread (its service "inbox:needs"): an answer to read, a question. */
  needs?: true
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
function localList(): Promise<Listed[]> {
  if (lastLocal && performance.now() - lastLocal.at < LIST_FRESH) return lastLocal.list
  const mine = { at: performance.now(), list: readList() }
  lastLocal = mine
  mine.list.catch(() => { if (lastLocal === mine) lastLocal = null })
  return mine.list
}
/** The last list made, shared by what asks soon after (the panel's poll, agents' terminal.list, a tab's title):
 *  reading it runs `ps` and asks every backend. A change (listChanged) forgets it. */
let lastLocal: { at: number; list: Promise<Listed[]> } | null = null
const LIST_FRESH = 1900 // (under the poll's 2 s, so each poll reads it again)

async function readList(): Promise<Listed[]> {
  const out = new Map<string, Listed>(), timing = span("terminal.list")
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
      // (a backend's word on what its program said, kept till it tells a change: after a restart, its first)
      if (x.said && !osc.has(x.id)) {
        osc.set(x.id, x.said)
        const now = stateNow(x.id)
        if (now) told.set(x.id, { now, at: Date.now() })
      }
      const front = await inFront(x)
      // (an agent's terminal from before this server started: its questions are watched for again)
      const agent = agentOf(x.id)?.name
      if (agent && front !== null && !watching.has(x.id) && !osc.get(x.id)?.status && !fs.existsSync(stateFile(x.id))) void watchAsks(x.id, agent)
      // Its program ended (the shell is at its prompt again): what it was working on or blocked on is over.
      const said = osc.get(x.id)?.status?.state
      if (front === null && (said === "working" || said === "blocked")) void b.dropStatus?.(x.id)
      // (Windows' backends name only the shell: what runs in front says)
      const now = stateNow(x.id), shows = WIN ? front !== null : !SHELLS.has(x.process)
      const state = stateOf(x.id) === MISSING ? null : now?.state ?? (x.state === "working" || x.state === "idle" ? x.state : x.state === "waiting" ? "blocked" : null)
      out.set(x.id, { id: x.id, agent: agentOf(x.id)?.name ?? null, process: front ?? x.process, busy: front !== null, clients, started: x.created || s?.started || 0,
        // (what an agent titled its terminal goes with it: a shell at its prompt keeps no title)
        title: front !== null ? titleOf(x.title ?? "") : undefined, backend: b.name,
        ...(x.cwd ? { cwd: x.cwd } : {}), ...(x.command ? { command: x.command } : {}), ...(x.cols ? { cols: x.cols, rows: x.rows } : {}), ...(x.activity ? { activity: x.activity } : {}),
        ...(state && shows ? { state, ...(now?.kind ? { kind: now.kind } : {}), ...(now?.msg ? { msg: now.msg } : {}) } : {}),
        ...(noteOf(x.id) ? { note: noteOf(x.id) } : {}),
        ...(nameOf(x.id) ? { name: nameOf(x.id) } : {}),
        ...(stateOf(x.id) === MISSING ? { missing: true as const } : {}),
        ...(x.external ? { external: true } : {}), ...(x.pid ? { pid: x.pid } : {}), ...(x.via ? { via: x.via } : {}) })
    }
  }
  timing.mark("in front")
  // (an agent run by hand in a plain terminal goes by its program's name: claude, codex)
  const meters = plugin.service("terminal:meters"), agents = [...new Set([...out.values()].flatMap((x) => (x.busy ? [x.agent ?? x.process] : [])))]
  const live = (await Promise.all(agents.map((a) => liveOf(a, typeof meters === "function")))).flat().filter((m) => out.get(m.terminal)?.busy)
  for (const m of live) if (m.session) out.get(m.terminal)!.session = m.session
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
const remotes = new Map<string, { sock: WebSocket; list: Listed[] }>()

async function list(local: boolean): Promise<Listed[]> {
  const mine = await localList()
  return local ? mine : [...mine, ...[...remotes.values()].flatMap((r) => r.list)]
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
function sendList() {
  sending = sending.then(sendOnce, sendOnce)
  return sending
}
async function sendOnce() {
  for (const local of [true, false]) {
    const to = [...watchers].filter(([, l]) => l === local).map(([ws]) => ws)
    if (!to.length) continue
    const text = JSON.stringify({ t: "sessions", list: await list(local) })
    if (text === lastList.get(local)) continue
    lastList.set(local, text)
    for (const ws of to) if (ws.readyState === ws.OPEN) ws.send(text)
  }
}

/** Something changed: tell the watchers (bursts, like a tab closing and its shell ending, coalesce). */
function listChanged() {
  lastLocal = null
  if (!watchers.size || listTimer) return
  listTimer = setTimeout(() => { listTimer = null; void sendList() }, 50)
}

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

// --- sessions from outside the app (`vau terminal`): routes for list, screen, start, send and end; this machine's only,
// same access as a shell.
terminalOps(plugin) // vau terminal ...: terminal.list, open, resume, screen, send, end, tidy (ops.ts), through these routes
runOps(plugin, { startedOn, listNow: () => { lastLocal = null; return sendList() } }) // vau terminal run: a file handed to an agent or a command, here or on another machine (run.ts)

/** A name for a terminal as kept: one line, at most 80 characters. */
const cleanName = (s: string) => s.replace(/[\s\p{Cc}]+/gu, " ").trim().slice(0, 80)

/** When each terminal was last typed into (a page, vau terminal send): a state told before that is an older turn's. */
const lastInput = new Map<string, number>()
/** What was sent into each terminal from outside its tabs (vau terminal send and key, the inbox), by whom: the last 20. */
type Sent = { at: number; by: string; text?: string; keys?: string[] }
const inputs = new Map<string, Sent[]>()
function typed(id: string, sent?: Omit<Sent, "at">) {
  lastInput.set(id, Date.now())
  if (sent) {
    const log = inputs.get(id) ?? []
    log.push({ at: Date.now(), ...sent, ...(sent.text ? { text: sent.text.length > 500 ? `${sent.text.slice(0, 500)}…` : sent.text } : {}) })
    inputs.set(id, log.slice(-20))
  }
  // Enter may have started a program (claude, vim): tabs show its name soon, not at the next poll.
  setTimeout(listChanged, 400)
}
/** How long typed text needs before its Enter: an agent takes a long text as a paste, and an Enter inside that is a new line. */
const settle = (text: string) => Math.min(1000, 150 + Math.floor(text.length / 4))
/** Types `text` into terminal `id` as typed (a long one as a paste: asPaste), then Enter apart from it. */
async function sendText(b: Backend, id: string, text: string, enter: boolean, by = "app") {
  if (text) await b.send(id, { text, paste: asPaste(text) })
  if (enter) {
    if (text) await new Promise((r) => setTimeout(r, settle(text)))
    await b.send(id, { keys: ["Enter"] })
  }
  typed(id, { by, ...(text ? { text } : {}), ...(enter ? { keys: ["Enter"] } : {}) })
}

/** What terminal.wait waits for: the terminal's end, one of its program's states, or its output going quiet. */
const WAITS = new Set(["exit", "idle", "working", "blocked", "done", "error", "quiet"])
const MAX_WAIT = 3600

/** How the terminals that ended lately ended, as told here (exited), for a wait that comes after. */
const exits = new Map<string, { code: number; signal: number; lost?: boolean; at: number }>()

/** The terminals that ended lately, as their backends keep them (the terminal server: an hour), newest last. */
async function endedList() {
  const all = await Promise.all(backends().map(async (b) => (await b.list({ ended: true }).catch(() => [] as Shell[])).filter((x) => x.exit).map((x) => ({ b, x }))))
  return all.flat().sort((a, b) => a.x.exit!.at - b.x.exit!.at).map(({ b, x }) => ({ id: x.id, backend: b.name, command: x.command ?? "", ...(x.meta?.name ? { name: x.meta.name } : {}),
    ...(x.meta?.note ? { note: x.meta.note } : {}), started: x.created, exit: x.exit! }))
}
/** Terminal `id` if it ended lately: its backend and how. */
async function endedOf(id: string): Promise<{ b: Backend; exit: Ended } | null> {
  for (const b of backends()) {
    const x = (await b.list({ ended: true }).catch(() => [] as Shell[])).find((y) => y.id === id && y.exit)
    if (x) return { b, exit: x.exit! }
  }
  const e = exits.get(id)
  return e ? { b: fallback, exit: e } : null
}

/** The wait itself (see the route): what it met (null: the time ran out), the state now, and how it ended if it did. */
async function waitFor(id: string, wants: string[], o: { ms: number; quiet: number; abort: AbortSignal; match?: RegExp; hold?: number }) {
  // (left out: an agent's turn over, as herdr has it, else its end; a pattern alone: only it)
  const want = new Set(wants.length ? wants : o.match ? [] : agentOf(id) || stateNow(id) ? ["idle", "blocked", "done", "error"] : ["exit"])
  if (o.match) want.add("match")
  // An agent at rest for a moment between steps of one turn isn't done: idle and done count once they've held.
  const hold = o.hold ?? 1500
  const since = Date.now()
  const result = (met: string | null, exit?: { code: number; signal: number; lost?: boolean } | null, matched?: string) => {
    const now = stateNow(id)
    return { met, ...(matched !== undefined ? { matched } : {}), timedOut: met === null && !o.abort.aborted, waited: Math.round((Date.now() - since) / 100) / 10, for: [...want],
      ...(now ? { state: now.state, ...(now.kind ? { kind: now.kind } : {}), ...(now.msg ? { msg: now.msg } : {}) } : {}), ...(exit ? { exit } : {}) }
  }
  const gone = async () => {
    // (told here first: its session here may still be letting go of it)
    const told = exits.get(id)
    if (!told && (await backendOf(id))) return null
    const e = told ?? (await endedOf(id))?.exit
    return e ? { code: e.code, signal: e.signal, ...(e.lost ? { lost: true } : {}) } : { code: -1, signal: 0 }
  }
  const stateMet = () => {
    // (nothing saying any more after something did was told as idle: stateChanged)
    const now = stateNow(id) ?? told.get(id)?.now, at = told.get(id)?.at ?? 0
    if (!now || !want.has(now.state) || at < (lastInput.get(id) ?? 0)) return null
    return (now.state === "idle" || now.state === "done") && Date.now() - at < hold ? null : now.state
  }
  if (!(await backendOf(id)) && !(await endedOf(id))) throw new HTTPError(404, `there's no terminal '${id}' (vau terminal lists them)`)
  return await new Promise<ReturnType<typeof result>>((resolve) => {
    let over = false
    const finish = (r: ReturnType<typeof result>) => {
      if (over) return
      over = true
      clearTimeout(timer); clearInterval(poll); stateHeard.delete(heard); exitHeard.delete(onExit); o.abort.removeEventListener("abort", stop)
      resolve(r)
    }
    const check = async () => {
      const exit = await gone()
      if (exit) return finish(result(want.has("exit") ? "exit" : null, exit))
      const s = stateMet()
      if (s) return finish(result(s))
      if (o.match) {
        const b = await backendOf(id), text = b ? await screenOf(b, id, 200) : ""
        const hit = o.match.exec(text)
        if (hit) return finish(result("match", null, hit[0].slice(0, 500)))
      }
      if (want.has("quiet")) {
        const x = (await findShell(id))?.x, last = Math.max(x?.activity ?? 0, lastInput.get(id) ?? 0, since)
        if (Date.now() - last >= o.quiet) finish(result("quiet"))
      }
    }
    const heard = (x: string) => { if (x === id) void check() }
    const onExit = (x: string) => { if (x === id) void check() }
    const stop = () => finish(result(null))
    const timer = setTimeout(stop, o.ms)
    // (each second too: output going quiet, a backend that tells nothing)
    const poll = setInterval(() => void check(), want.has("quiet") ? Math.min(1000, o.quiet / 2) : o.match || hold < 1000 ? 500 : 1000)
    stateHeard.add(heard)
    exitHeard.add(onExit)
    o.abort.addEventListener("abort", stop)
    void check()
  })
}
/** What hears each terminal's end as it's told (terminal.wait). */
const exitHeard = new Set<(id: string) => void>()
/** terminal.wait for this server's plugins (the service "terminal:wait"), `signal` ending it early (met null). */
plugin.provide("terminal:wait", (id: string, o: { for?: string[]; timeout?: number; quiet?: number; hold?: number; signal?: AbortSignal } = {}) =>
  waitFor(id, (o.for ?? []).filter((w) => WAITS.has(w)), { ms: Math.min(MAX_WAIT, o.timeout ?? 300) * 1000, quiet: (o.quiet ?? 2) * 1000,
    abort: o.signal ?? new AbortController().signal, ...(o.hold !== undefined ? { hold: o.hold * 1000 } : {}) }))

async function owner(req: Request) {
  await plugin.ownerOnly(req, "the terminal")
}
/** The id a route names, this machine's: another machine's (id@machine) is answered there. */
function localId(req: Request) {
  const id = req.arg(0)
  if (!TERMINAL_ID.test(id)) throw new HTTPError(400, "a terminal id is letters, digits, - and _")
  if (id.includes("@")) throw new HTTPError(400, `${id} is another machine's: ask that machine's server (vau --url <its address>)`)
  return id
}
async function mustRun(id: string): Promise<Backend> {
  const b = await backendOf(id)
  if (!b) throw new HTTPError(404, `there's no terminal session '${id}' (vau terminal lists them)`)
  return b
}

// An agent's hooks marking its state where they can't run a shell line (Windows: AgentStart's stateHook), as
// stateCommand does: nothing once it speaks OSC 7501.
plugin.route("POST", "terminals/*/state", async (req) => {
  await owner(req)
  const id = localId(req), st = req.query.s, kind = req.query.kind
  if (st !== "working" && st !== "waiting" && st !== "idle") throw new HTTPError(400, "s: working, waiting or idle")
  if (fs.existsSync(oscMark(id))) return {}
  fs.mkdirSync(STATES, { recursive: true })
  fs.writeFileSync(stateFile(id), st === "waiting" && (kind === "permission" || kind === "question") ? `${st}:${kind}` : st)
  return {}
}, { lock: false, sync: false })

/** The shells a terminal can start here, as the setting `shell` offers them: "" its default (the login shell, on
 *  Windows PowerShell), then each by the name its users know (Windows Terminal's). */
plugin.route("GET", "terminals/shells", async (req) => {
  await owner(req)
  const all = await shellsHere(), dflt = defaultShell()
  const name = all.find((x) => x.shell === dflt)?.label ?? progName(dflt)
  return { choices: [{ value: "", label: `Default (${name})` }, ...all.map((x) => ({ value: x.shell, label: x.label }))] }
})

// What a coding agent started here is told, exactly (Show what agents are told; vau terminal instructions).
plugin.route("GET", "terminals/instructions", () => ({ text: agentContext() }))

/** This machine's terminals; `ended=1`: the ones that ended lately too (kept a while by their backend, with how). */
plugin.route("GET", "terminals/sessions", async (req) => {
  await owner(req)
  return { sessions: await localList(), backend: (await backendForNew()).name, ...(req.query.ended ? { ended: await endedList() } : {}) }
})

/** What a terminal shows: its last `lines` lines (its screen and the history above it; `all`: all it keeps), as text
 *  (wrapped lines joined), vt (its own sequences: colors, the cursor) or html. One that ended lately too. */
plugin.route("GET", "terminals/*/capture", async (req) => {
  await owner(req)
  const id = localId(req)
  const format: CaptureFormat = req.query.format === "vt" || req.query.format === "html" ? req.query.format : "text"
  // (none given: its screen)
  const lines = req.query.lines === "all" ? null : req.query.lines ? clamp(req.query.lines, 1, scrollback() + 500, 50) : undefined
  const b = (await backendOf(id)) ?? (await endedOf(id))?.b
  if (!b) throw new HTTPError(404, `there's no terminal '${id}' (vau terminal lists them)`)
  const c = await b.capture(id, { format, lines }).catch((e: Error) => { throw new HTTPError(409, e.message) })
  return { id, format, ...c }
})

plugin.route("POST", "terminals/*", async (req) => {
  await owner(req)
  const id = localId(req)
  if (await runsHere(id)) return { id, started: false }
  const prompt = typeof req.body?.prompt === "string" && req.body.prompt.trim() ? req.body.prompt : null
  const allow = Array.isArray(req.body?.allow) ? req.body.allow.filter((a: unknown): a is string => typeof a === "string" && /^[\w .:/-]+$/.test(a)) : null
  const word = (v: unknown) => (typeof v === "string" && MODEL_NAME.test(v) ? v : null)
  const mode = PERMISSION_MODES.find((m) => m === req.body?.mode) ?? null
  const cwd = typeof req.body?.cwd === "string" && path.isAbsolute(req.body.cwd) ? req.body.cwd : null
  if (cwd && !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new HTTPError(404, `there's no folder ${cwd}`)
  // (a command alone, as the terminal's program: it ends with it; a name for its list and tabs)
  const command = typeof req.body?.command === "string" && req.body.command.trim() ? req.body.command.trim() : undefined
  const name = typeof req.body?.name === "string" ? cleanName(req.body.name) : ""
  if (command && agentOf(id)) throw new HTTPError(400, "a terminal runs an agent or a command, not both")
  const cols = clamp(req.body?.cols, 2, 1000, 120), rows = clamp(req.body?.rows, 1, 500, 40)
  if (!starting.has(id)) starting.set(id, start(id, cols, rows, LOCAL, prompt, savedDark(), { allow, model: word(req.body?.model), effort: word(req.body?.effort), mode, cwd },
    { command, ...(name ? { name } : {}) })
    .finally(() => starting.delete(id)))
  try { await starting.get(id)! } catch (e) {
    // (a command that ended within ms has nothing left to attach to: how it ended is the answer)
    const ended = command ? await endedOf(id) : null
    if (!ended) throw e
    return { id, started: true, agent: null, exit: ended.exit }
  }
  return { id, started: true, agent: agentOf(id)?.name ?? null }
}, { lock: false })

/** Name a session (terminal.rename): its tabs, Terminals and agents' list show it; "" gives back what its program
 *  titles it. */
plugin.route("POST", "terminals/*/name", async (req) => {
  await owner(req)
  const id = localId(req)
  await mustRun(id)
  const name = typeof req.body?.name === "string" ? cleanName(req.body.name) : ""
  await setMeta(id, { name: name || null })
  return { id, name: name || null }
}, { lock: false })

/** Answer the question an agent terminal shows (approve or deny) with the keys its agent declares (`agent`: whose, for
 *  one run by hand in a plain shell); 409 when it shows none. */
plugin.route("POST", "terminals/*/answer", async (req) => {
  await owner(req)
  const h = (k: string) => { const v = req.http?.headers[k]; return typeof v === "string" ? v : null }
  // (the user's yes or no, never an agent's: inbox.answer checks its caller, then asks this in-process)
  if (req.http && !userSurface(whoOf(h("x-vaultite-client"), h("x-vaultite-agent")))) throw new HTTPError(403, NOT_THE_USER)
  const id = localId(req), answer: unknown = req.body?.answer
  if (answer !== "approve" && answer !== "deny") throw new HTTPError(400, "answer: approve or deny")
  await mustRun(id)
  const { b, hit } = await askIn(id, typeof req.body?.agent === "string" ? req.body.agent : "")
  if (!b || !hit) throw new HTTPError(409, "its terminal isn't asking anything now")
  for (const [i, k] of hit[answer].entries()) {
    if (i) await new Promise((r) => setTimeout(r, 150))
    await b.send(id, { text: k })
  }
  typed(id, { by: "the user", text: `${answer} (${hit.id})` })
  return { id, ask: hit.id, answer }
}, { lock: false })

/** What was sent into a terminal from outside its tabs lately, and by whom (typed, the last 20). */
plugin.route("GET", "terminals/*/inputs", async (req) => {
  await owner(req)
  const id = localId(req)
  return { id, inputs: inputs.get(id) ?? [] }
})

/** Type `text` (then Enter, unless `enter` is false), or press `keys` by name (keys.ts: Enter, C-c, Up, M-x...). */
plugin.route("POST", "terminals/*/send", async (req) => {
  await owner(req)
  const id = localId(req)
  const b = await mustRun(id)
  const keys = Array.isArray(req.body?.keys) ? req.body.keys.map(String).filter(Boolean) as string[] : []
  const by = typeof req.http?.headers["x-vaultite-agent"] === "string" ? req.http.headers["x-vaultite-agent"] : String(req.http?.headers["x-vaultite-client"] ?? "app")
  if (keys.length) {
    // (named wrong: the terminal server says which)
    await b.send(id, { keys }).catch((e: Error) => { throw new HTTPError(400, e.message) })
    typed(id, { by, keys })
    return { id, keys }
  }
  const text = typeof req.body?.text === "string" ? unmarked(req.body.text) : ""
  const enter = req.body?.enter !== false
  if (!text && !enter) throw new HTTPError(400, "send needs a text (or enter)")
  const before = stateNow(id), since = Date.now()
  await sendText(b, id, text, enter, by)
  // (`confirm`: say whether an agent took it, as terminal.send does; the Inbox's reply checks in its own way)
  return { id, sent: text.length, enter, ...(req.body?.confirm && enter && text && (agentOf(id) || before) ? await submitted(b, id, text, before, since) : {}) }
}, { lock: false })

/** Whether a text sent with its Enter reached an agent as a message: it started working on it (a state told after it),
 *  else why not, as far as its screen says: the text still in its input (vim mode, a survey, a dialog took the Enter). */
async function submitted(b: Backend, id: string, text: string, before: Now | null, since: number): Promise<{ submitted: boolean | null; why?: string }> {
  if (before?.state === "blocked") return { submitted: false, why: `it was waiting on the user${before.kind ? ` (${before.kind}${before.msg ? `: ${before.msg}` : ""})` : ""}: what you typed went to that` }
  for (const until = Date.now() + 6000; Date.now() < until; await new Promise((r) => setTimeout(r, 200))) {
    const now = stateNow(id), at = told.get(id)?.at ?? 0
    if (now && at >= since && now.state !== "idle") return { submitted: true }
  }
  const c = await b.capture(id, { format: "text", lines: 8 }).catch(() => null)
  const squash = (s: string) => s.replace(/\s+/g, "")
  if (c && squash(c.input?.typed ?? c.text.split("\n").slice(-4).join("")).includes(squash(text).slice(-24))) {
    return { submitted: false, why: "its input still shows the text: the Enter didn't take (vim mode, a survey or a dialog over it?): look with vau terminal capture" }
  }
  return { submitted: null, why: "it didn't say it started working on it (vau terminal capture shows its screen)" }
}

/** Waits until terminal `id` ends (`for` exit), is in a state `for` names (told after its last input: waitFor), or prints
 *  nothing for `quiet` seconds (quiet); at most `timeout` seconds. */
plugin.route("POST", "terminals/*/wait", async (req) => {
  await owner(req)
  const id = localId(req)
  const wants = (Array.isArray(req.body?.for) ? req.body.for : String(req.body?.for ?? "").split(",")).map((x: unknown) => String(x).trim()).filter(Boolean) as string[]
  const bad = wants.find((w) => !WAITS.has(w))
  if (bad) throw new HTTPError(400, `\`for\` is exit, ${[...WAITS].filter((w) => w !== "exit").join(", ")}: not '${bad}'`)
  const timeout = Math.max(0, Math.min(MAX_WAIT, Number(req.body?.timeout ?? 300) || 0))
  const quiet = Math.max(0.2, Math.min(600, Number(req.body?.quiet ?? 2) || 2))
  let match: RegExp | undefined
  if (typeof req.body?.match === "string" && req.body.match) {
    try { match = new RegExp(req.body.match, "m") } catch (e) { throw new HTTPError(400, `\`match\` isn't a pattern: ${(e as Error).message}`) }
  }
  const hold = req.body?.hold === undefined ? undefined : Math.max(0, Math.min(60, Number(req.body.hold) || 0)) * 1000
  // (the caller gone: its socket closed)
  const abort = new AbortController(), sock = req.http?.socket, gone = () => abort.abort()
  sock?.once("close", gone)
  try { return { id, ...await waitFor(id, wants, { ms: timeout * 1000, quiet: quiet * 1000, abort: abort.signal, match, hold }) } } finally { sock?.off("close", gone) }
}, { lock: false })

plugin.route("DELETE", "terminals/*", async (req) => {
  await owner(req)
  const id = localId(req)
  const b = await mustRun(id)
  // (?keep=1: its tabs stay, saying it ended)
  const s = sessions.get(id), keep = req.query.keep === "1"
  if (s) end(s, keep)
  else await endHere(b, id, keep)
  listChanged()
  return { id, ended: true }
}, { lock: false })

// --- which terminal a process runs in (the Claude Code plugin: a running session -> its tab)

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

/** A terminal's id and title (the user's name for it, else a Claude Code session's), whether something runs in it and
 *  its agent's session id, or null when it isn't running. */
plugin.provide("terminal:info", async (id: string) => {
  const s = (await localList()).find((x) => x.id === id)
  return s ? { id: s.id, title: s.name ?? s.title, busy: s.busy, ...(s.session ? { session: s.session } : {}) } : null
})
