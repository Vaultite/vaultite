// Terminal: login shells on this machine in a backend that outlives the server (the keeper, tmux or another plugin's), a
// WebSocket per tab at /api/terminal/<id>. A shell is everything, so only this machine's owner gets one (plugin.refusal).
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import os from "node:os"
import path from "node:path"
import { type RawData, WebSocket } from "ws"
import { type AgentStart, type AgentState, quote } from "../../../core/codingagents.ts"
import { parseTerminal } from "../../../core/terminalids.ts"
import {
  agentLines, HTTPError, machineSocket, pipeSockets, Plugin, processTable, runtimeDir, serverUrl, splitMachine, type Machine, type Request,
} from "../../../core/plugins.ts"
import {
  limits, loadPty, mirrored, plain, plainBackend, ptydBackend, ptyLink, runScript, shellArgs, Tail, type AgentRun, type Backend, type Link, type Listed as Shell,
} from "./backend.ts"
import { terminalOps } from "./ops.ts"
import { tmuxBackend } from "./tmux.ts"

export type { AgentRun } from "./backend.ts"
export const plugin = new Plugin(import.meta.url)

/** How much output a terminal client may be behind before it's dropped (it reconnects and gets the replay). */
const BEHIND = 16 << 20
/** Lines of history every terminal keeps, whatever its backend (the setting `scrollback`): the page's, the keeper's and
 *  tmux's, all given back to a page that comes back. */
const scrollback = () => clamp(plugin.settings().scrollback, 100, 1_000_000, 10_000)
limits.scrollback = scrollback
// A shell ends only when its tab closes (idle, its last one), or it's ended on purpose: never for having been left alone.
/** A shell at its prompt: nothing else runs in it (the app's `busy` is the other side of this). */
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "-zsh", "-bash", "-sh", "login", ""])
const VERSION = /^\d+(\.\d+)+$/
/** A shell's process by its name: on Linux node-pty says the path it was started by ("/bin/bash"). */
const byName = (x: Shell): Shell => (x.process?.includes("/") ? { ...x, process: path.basename(x.process) } : x)
/** What runs in front in a shell, or null at its prompt. A script reads as its interpreter (`mo` as "bash"), so a
 *  shell's name is checked against the foreground group: not the shell itself, something runs. */
async function inFront(x: Shell): Promise<string | null> {
  // A program whose binary is named for its version (Claude Code's native install runs
  // ~/.local/share/claude/versions/2.1.290) reads by the name it was started as ("claude").
  if (!SHELLS.has(x.process) && !VERSION.test(x.process)) return x.process
  if (!x.pid) return SHELLS.has(x.process) ? null : x.process
  const all = await processTable()
  const fg = all.get(x.pid)?.tpgid ?? 0
  if (fg <= 0 || fg === x.pid) return SHELLS.has(x.process) ? null : x.process
  const [bin = "", ...rest] = (all.get(fg)?.args ?? "").split(/\s+/)
  const name = path.basename(bin).replace(/^-/, "")
  const script = SHELLS.has(name) ? rest.find((a) => !a.startsWith("-")) : undefined
  return (script && !rest.includes("-c") ? path.basename(script) : name) || x.process || "shell"
}
const EXITED = 4000 // close code: the shell ended (the client doesn't reconnect)
const GONE = 4004 // close code: ?attach=1 and the agent's session is gone (the client offers a new one)
const REFUSED = 4003 // close code: this request may not have a shell (the client shows why)

/** A shell this server shows: its backend's link to it, and the pages' sockets on it. */
type Session = {
  id: string; backend: Backend; link: Link; clients: Set<WebSocket>; started: number
  ended: boolean // ended by us (a tab's close, End session): reported as SIGHUP, like a shell killed directly
  kept?: boolean // ended by us, its tabs kept (end's `keep`)
  out: Tail // its last `scrollback` lines of output (a backend without pictures)
  pending: Set<WebSocket> // sockets waiting for their picture (they get no output before it: it's in it)
}
const sessions = new Map<string, Session>()

const shell = () => process.env.SHELL || os.userInfo().shell || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")

// --- the backends (backend.ts). Names follow the port: a server on another port than the default 8793, like a
// throwaway one for QA, gets `vaultite-<port>`, so its shells never show in the real one's list.
const PORT = Number(process.env.PORT || 8793)
const named = (app: string) => (PORT === 8793 ? app : `${app}-${PORT}`)
const TMP = path.join(runtimeDir(), "vaultite-terminal")
const UPLOADS = path.join(TMP, "uploads")
const STATES = path.join(TMP, "states")
const MAX_UPLOAD = 20 << 20
/** How long what was pasted into a terminal stays once its shell has ended: as long as Claude Code keeps a session to
 *  resume by default (cleanupPeriodDays), so a resumed one still finds the files it was given. */
const UPLOADS_KEPT = 30 * 86_400_000
const SPARE = "vauspare-" // a shell kept ready (below)

const keeper = ptydBackend(named("vaultite"), { daemon: path.join(plugin.dir, "ptyd.ts"), log: console.error })
const tmuxShells = tmuxBackend(named("vaultite"), { conf: path.join(plugin.dir, "tmux.conf"), env })
const fallback = plainBackend()
/** Another plugin's backend, while it's on (the service "terminal:backend": herdr's), or null. */
function pluginBackend(): Backend | null {
  const fn = plugin.service("terminal:backend")
  try { return typeof fn === "function" ? (fn() as Backend | null) ?? null : null } catch { return null }
}
/** What a plugin's backend may use (it implements Backend, backend.ts, through plugin.peer("terminal").exports): */
plugin.exports.backendKit = { loadPty, ptyLink, mirrored, runScript, shellArgs, plain }
/** Every backend, in the order a session's id is looked for. */
const backends = (): Backend[] => [keeper, ...(tmuxShells ? [tmuxShells] : []), fallback, ...[pluginBackend()].filter((b): b is Backend => !!b)]

/** Where a new shell starts: a plugin's backend that asks for them (and answers), else the settings' `backend`
 *  (vaultite, the default, or tmux when it's installed), else this server's own children if the keeper can't start. */
async function backendForNew(): Promise<Backend> {
  const other = pluginBackend()
  if (other?.preferred && (await other.ready().catch(() => false))) return other
  if (plugin.settings().backend === "tmux" && tmuxShells) return tmuxShells
  if (await keeper.ready().catch(() => false)) return keeper
  return fallback
}

/** The backend running the shell `id`, or null. */
async function backendOf(id: string): Promise<Backend | null> {
  const s = sessions.get(id)
  if (s) return s.backend
  for (const b of backends()) if (await b.has(id).catch(() => false)) return b
  return null
}
/** A shell with this id runs here (in any backend). */
const runsHere = async (id: string) => !!(await backendOf(id))

/** A file the page sent (a pasted screenshot) into terminal `id`, saved where the shell can read it: its path. */
function upload(id: string, name: unknown, data: unknown): string {
  const bytes = Buffer.from(String(data ?? ""), "base64")
  if (!bytes.length || bytes.length > MAX_UPLOAD) throw new Error("empty or over 20 MB")
  const safe = String(name ?? "").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(-80) || "file"
  const dir = path.join(UPLOADS, id)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${Date.now().toString(36)}-${safe}`)
  fs.writeFileSync(file, bytes)
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

/** A coding agent's own session, when one started the server or the app: a Claude Code that inherits CLAUDECODE and
 *  CLAUDE_CODE_CHILD_SESSION takes itself for nested and saves no transcript, and `vau` takes the shell for that agent. */
const AGENT_SESSION = ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_PID", "CLAUDE_EFFORT"]
const agentSession = (k: string) => AGENT_SESSION.includes(k) || (k.startsWith("CODEX_") && k !== "CODEX_HOME")

/** The server's environment, less what's about the server itself (npm's variables when run with npm start, PORT) and
 *  the agent's session that started it, if one did. */
function env(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    // (ELECTRON_RUN_AS_NODE: how the desktop app runs this server; a shell that kept it would start every Electron app,
    // Vaultite or VS Code, as plain Node, which exits at once)
    if (v === undefined || k.startsWith("npm_") || k.startsWith("VAULTITE_") || agentSession(k)
      || ["PORT", "HOST", "INIT_CWD", "TMUX", "TMUX_PANE", "ELECTRON_RUN_AS_NODE"].includes(k)) continue
    out[k] = v
  }
  return { ...out, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Vaultite", LANG: out.LANG || (process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8") } // (a server may not have en_US generated)
}

/** The app's folder (the repo, or the packaged app's resources): its bin/ holds the `vau` CLI. */
const APP_ROOT = path.resolve(plugin.dir, "..", "..", "..")

/** Where a terminal is opened from: through Tailscale Serve, and which app (the iPhone app sets a cookie: core/phoneapp.ts). */
type From = { remote: boolean; client: "desktop" | "iphone" | "web" }
const LOCAL: From = { remote: false, client: process.env.VAULTITE_DESKTOP === "1" ? "desktop" : "web" }
function fromReq(req: IncomingMessage): From {
  const iphone = /(?:^|;\s*)vaultite_client=iphone(?:;|$)/.test(req.headers.cookie ?? "")
  return { remote: typeof req.headers["tailscale-user-login"] === "string", client: iphone ? "iphone" : LOCAL.client }
}

/** What a shell is told about where it runs (see the docstring): Vaultite's variables, and PATH with the app's bin/. */
function context(id: string | null, from: From): Record<string, string> {
  const out: Record<string, string> = {
    VAULTITE: "1",
    VAULTITE_URL: serverUrl(),
    VAULTITE_VAULT: plugin.vault.path,
    VAULTITE_CLIENT: from.client,
    ...(id ? { VAULTITE_TERMINAL: id } : {}),
    PATH: [path.join(APP_ROOT, "bin"), env().PATH].filter(Boolean).join(":"),
  }
  if (from.remote) out.VAULTITE_REMOTE = "tailscale"
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

/** Which agent a terminal id runs, and the session it resumes. */
export function agentOf(id: string): { name: string; resume: string | null; profile: string | null } | null {
  const t = parseTerminal(id)
  return t && !t.machine && typeof plugin.service(`agent:${t.agent}`) === "function" ? { name: t.agent, resume: t.resume, profile: t.profile } : null
}

/** Where a terminal's state is kept (what its agent's hooks said last: working, waiting or idle), whatever its backend. */
const stateFile = (id: string) => path.join(STATES, id)
function stateOf(id: string) {
  try { return fs.readFileSync(stateFile(id), "utf8").trim() || undefined } catch { return undefined }
}

/** The shell command a hook runs to mark a terminal's state (its state `file`), and `tell` (Inbox) when the change is
 *  news: finished, asks something, was answered ($prev, the hook's JSON on stdin). */
export function stateCommand(file: string, tell?: ((s: AgentState) => string) | null) {
  const mark = (s: AgentState) => `printf %s ${s} > ${quote(file)} 2>/dev/null || true`
  if (!tell) return mark
  const news: Record<AgentState, string> = { idle: `[ "$prev" = working ]`, waiting: `[ "$prev" != waiting ]`, working: `[ "$prev" = waiting ]` }
  return (s: AgentState) => `prev=$(cat ${quote(file)} 2>/dev/null); ${mark(s)}; if ${news[s]}; then ${tell(s)}; fi`
}

/** The shell command an agent's terminal runs, and where (null: a plain shell). */
async function agentRun(id: string, prompt: string | null = null): Promise<AgentRun | null> {
  const a = agentOf(id)
  if (!a) return null
  try { fs.mkdirSync(STATES, { recursive: true }); fs.rmSync(stateFile(id), { force: true }) } catch { /* unmarked */ }
  const set = stateCommand(stateFile(id), plugin.service("inbox:hook")?.(a.name, id))
  try {
    const report = plugin.service("activity:report")
    const run = await plugin.service(`agent:${a.name}`)!({ resume: a.resume, context: agentContext(), state: set,
      report: report ? report(a.name, id) : null, profile: a.profile, prompt } satisfies AgentStart)
    if (!run || typeof run.command !== "string" || !run.command) return null
    let cwd = typeof run.cwd === "string" && run.cwd ? run.cwd : null
    try { if (cwd && !fs.statSync(cwd).isDirectory()) cwd = null } catch { cwd = null }
    return { command: run.command, cwd }
  } catch {
    return null
  }
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
    const b = await backendForNew()
    const key = `${b.name}:${from.remote}:${from.client}`
    if (!b.spares || spares.has(key)) return
    const name = `${SPARE}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    // (its id comes when it's taken)
    const ready = dropped.then(() => b.create(name, { shell: shell(), run: null, cwd: vaultDir(), env: env(), ctx: context(null, from), cols: 120, rows: 40, scrollback: scrollback() },
      { spare: true })).then(() => true, () => false)
    spares.set(key, { b, name, ready })
  })()
}
const refill = (from: From) => setTimeout(() => makeSpare(from), 1500).unref?.()

/** The ready shell of backend `b`, renamed to session `id` (the agent's command started in it): false when there's none. */
async function takeSpare(b: Backend, id: string, from: From, run: AgentRun | null) {
  const key = `${b.name}:${from.remote}:${from.client}`
  const spare = spares.get(key)
  if (!spare || !b.rename) return false
  spares.delete(key)
  if (!(await spare.ready)) return false
  try { await b.rename(spare.name, id) } catch { return false }
  if (run) {
    fs.mkdirSync(TMP, { recursive: true })
    // (with its Enter: a shell at its prompt reads it as typed, so no pause before it)
    await b.send(id, `${runScript(path.join(TMP, `run-${id}.sh`), id, run)}\r`, false)
    // Once the agent runs, the line typed (and the prompt before it) leave the history too (the script's `clear` does
    // that in the keeper; tmux keeps its own): scrolling up from it shows nothing it didn't print.
    if (b.clearHistory) void (async () => {
      for (let i = 0; i < 50 && SHELLS.has(path.basename((await b.list()).find((x) => x.id === id)?.process ?? "")); i++) await new Promise((r) => setTimeout(r, 100))
      await b.clearHistory!(id)
    })()
  }
  return true
}

/** Starts a session (in the backend new ones go to), or reattaches to its shell if one runs (`fresh` says which). */
async function start(id: string, cols: number, rows: number, from = LOCAL, prompt: string | null = null): Promise<{ s: Session; fresh: boolean }> {
  let b = await backendOf(id)
  const fresh = !b
  if (!b) {
    b = await backendForNew()
    // A coding agent: the login shell (interactive, so it has the user's PATH) runs it, then becomes a plain shell.
    const run = await agentRun(id, prompt)
    const spec = { shell: shell(), run, cwd: vaultDir(), env: env(), ctx: context(id, from), cols, rows, scrollback: scrollback() }
    if (!(b.spares && (await takeSpare(b, id, from, run)))) {
      try { await b.create(id, spec) } catch (e) {
        if (b !== keeper) throw e
        console.error("terminal: the keeper couldn't start a shell, so this server holds it:", e)
        b = fallback
        await b.create(id, spec)
        // Said out loud: a restart (a deploy) ends this one, and nothing else would show it until then.
        void plugin.runOp("ui.notify", { text: `This terminal runs in the server, not Vaultite's keeper, so restarting the server ends it (the keeper: ${(e as Error).message})`,
          error: true, terminal: id }).catch(() => {})
      }
    }
    if (b.spares) refill(from)
  }
  const backend = b
  const link = await backend.attach(id, cols, rows)
  const s: Session = { id, backend, link, clients: new Set(), started: Date.now(), out: new Tail(scrollback()), pending: new Set(), ended: false }
  link.onData((data) => {
    if (!link.snapshot) s.out.push(data)
    const bytes = Buffer.from(data, "utf8")
    for (const ws of s.clients) {
      if (ws.readyState !== ws.OPEN || s.pending.has(ws)) continue
      // A client that stopped reading (a phone asleep on a live socket) would hold a chatty agent's output in memory
      // without end: dropped, it reconnects and gets the replay.
      if (ws.bufferedAmount > BEHIND) { ws.terminate(); continue }
      ws.send(bytes)
    }
  })
  link.onExit(async (exit) => {
    if (sessions.get(id) === s) sessions.delete(id)
    listChanged()
    // Only our hold on it ended (the server's tmux client was killed): the clients reconnect, which reattaches.
    if (!exit && !s.ended && (await backend.has(id).catch(() => false))) {
      for (const ws of s.clients) ws.close(1012, "reattach")
      return
    }
    // Ended by us: a SIGHUP, as when a shell is killed directly.
    const { code, signal } = s.ended ? { code: 0, signal: 1 } : exit ?? { code: 0, signal: 0 }
    // A shell's clean exit closes its tabs: the ones away now too (another device's), once they're put back. An
    // agent's session that ends by itself keeps its tabs, saying so, with Restart.
    if (!code && !signal && !agentOf(id)) markEnded(id)
    try { fs.rmSync(stateFile(id), { force: true }) } catch { /* none */ }
    for (const ws of s.clients) {
      if (ws.readyState !== ws.OPEN) continue
      ws.send(JSON.stringify({ t: "exit", code, signal, ...(s.ended && !s.kept ? { ended: true } : {}) }))
      ws.close(EXITED, "exited")
    }
  })
  sessions.set(id, s)
  endedOnPurpose.delete(id)
  listChanged()
  return { s, fresh }
}

/** The sessions ended for good here (End session, x, vau terminal end, a shell's clean exit), lately: their tabs close,
 *  the ones open now (the exit says `ended`) and the ones put back later (they hear "gone", `ended`), on any device. */
const endedOnPurpose = new Set<string>()
function markEnded(id: string) {
  endedOnPurpose.add(id)
  if (endedOnPurpose.size > 500) endedOnPurpose.delete(endedOnPurpose.values().next().value!)
}

/** Ends a session for good: its shell, not just this server's hold on it. `keep`: its tabs stay, saying it ended (an
 *  agent's handed session after its report). */
function end(s: Session, keep = false) {
  s.ended = true
  if (!keep) markEnded(s.id)
  else s.kept = true
  void s.backend.kill(s.id).catch(() => {})
}

/** One shell, one size: the last device to send its own wins. Every device hears it, so one that's used again and
 * doesn't fit (the phone shrank it) sends its size back (Terminal.tsx: claim) and the program redraws for it. */
function resize(s: Session, cols: number, rows: number) {
  if (s.link.cols === cols && s.link.rows === rows) return
  s.link.resize(cols, rows)
  const msg = JSON.stringify({ t: "size", cols, rows })
  for (const ws of s.clients) if (ws.readyState === ws.OPEN) ws.send(msg)
}

function attach(s: Session, ws: WebSocket, fresh: boolean) {
  s.clients.add(ws)
  listChanged()
  ws.send(JSON.stringify({ t: "attached", fresh, tmux: s.backend.redraws, scrollback: scrollback() }))
  ws.send(JSON.stringify({ t: "size", cols: s.link.cols, rows: s.link.rows }))
  if (s.link.snapshot) {
    // The screen and its history as they are now, then what it prints from there on.
    s.pending.add(ws)
    s.link.snapshot((picture) => {
      s.pending.delete(ws)
      if (picture && ws.readyState === ws.OPEN) ws.send(Buffer.from(picture, "utf8"))
    })
  } else {
    const replay = fresh ? "" : s.out.text()
    if (replay) ws.send(Buffer.from(replay, "utf8"))
    // The backend draws its screen again (the replay can end mid-screen).
    if (!fresh) s.link.redraw?.()
  }
  ws.on("message", (data: RawData, binary: boolean) => {
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
    if (binary) {
      s.link.write(buf)
      // Enter may have started a program (claude, vim): tabs show its name soon, not at the next poll.
      if (buf.includes(13)) setTimeout(listChanged, 400)
      return
    }
    let msg: { t?: string; cols?: number; rows?: number; name?: string; data?: string; lines?: number }
    try { msg = JSON.parse(buf.toString("utf8")) } catch { return }
    if (msg.t === "resize") resize(s, clamp(msg.cols, 2, 1000, s.link.cols), clamp(msg.rows, 1, 500, s.link.rows))
    else if (msg.t === "close") end(s)
    else if (msg.t === "scroll") { if (Number.isInteger(msg.lines) && msg.lines) s.link.scroll?.(msg.lines!) }
    else if (msg.t === "upload") {
      let file = ""
      try { file = upload(s.id, msg.name, msg.data) } catch (e) { console.error("terminal upload:", e); return }
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "uploaded", path: file }))
    }
  })
  ws.on("close", () => {
    s.clients.delete(ws)
    s.pending.delete(ws)
    listChanged()
  })
}

// --- another machine's shells (Machines): an id ending in @<machine> is let in here first, then joined to the same
// socket there, which checks again. A machine that doesn't answer drops the socket, so the tab tries again.

export const TERMINAL_ID = /^[\w-]{1,64}(@[a-z0-9][a-z0-9-]{0,62})?$/

const machineOf = (id: string) => plugin.ask<Machine | null>("machines:machine", null, id)
const machineList = () => plugin.ask<Machine[]>("machines", [])

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
  const others = (await machineList()).filter((m) => !m.self && m.online && m.plugins?.includes("terminal"))
  const found = await Promise.all(others.map(async (m) => ((await sessionsOn(m))?.some((x) => x.id === id) ? m.id : null)))
  return found.find(Boolean) ?? null
}
plugin.provide("terminal:locate", locate)
/** Whether session `id` runs on this machine. */
plugin.provide("terminal:runs", runsHere)

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
    else { markEnded(id); await (await backendOf(id))?.kill(id).catch(() => {}) } // a tab closed while its session had no client here (after a restart)
    return ws.close(EXITED, "ended")
  }
  const cols = clamp(query.cols, 2, 1000, 80), rows = clamp(query.rows, 1, 500, 24)
  const s = sessions.get(id)
  if (s) {
    resize(s, cols, rows)
    return attach(s, ws, false)
  }
  // A tab put back asks only to attach: an agent's new session that ended (or died with tmux) isn't started again, nor
  // a session ended for good (its tab closes).
  const agent = agentOf(id), ended = endedOnPurpose.has(id)
  if (query.attach && (ended || (agent && !agent.resume)) && !starting.has(id) && !(await runsHere(id))) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "gone", ...(ended ? { ended: true } : {}) }))
    return ws.close(GONE, "gone")
  }
  const first = !starting.has(id)
  // Through Tailscale Serve (allowed() checked who), or from the iPhone app: the shell may say so.
  if (first) starting.set(id, start(id, cols, rows, fromReq(req)).finally(() => starting.delete(id)))
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
  state?: string; machine?: string; machineLabel?: string; backend?: string; external?: boolean
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
async function localList(): Promise<Listed[]> {
  const out = new Map<string, Listed>()
  for (const b of backends()) {
    for (const x of (await b.list().catch(() => [] as Shell[])).map(byName)) {
      if (x.spare || x.id.startsWith(SPARE) || out.has(x.id)) continue
      const s = sessions.get(x.id)
      // Who's watching: the app's sockets plus holds besides this server's own (tmux attach in a real terminal), so a session
      // no tab shows reads as detached.
      const clients = s ? s.clients.size + Math.max(0, x.attached - 1) : x.attached
      const state = stateOf(x.id) ?? x.state
      const front = await inFront(x)
      out.set(x.id, { id: x.id, agent: agentOf(x.id)?.name ?? null, process: front ?? x.process, busy: front !== null, clients, started: x.created || s?.started || 0,
        // (what an agent titled its terminal goes with it: a shell at its prompt keeps no title)
        title: front !== null ? titleOf(x.title ?? "") : undefined, state: state && !SHELLS.has(x.process) ? state : undefined, backend: b.name,
        ...(x.external ? { external: true } : {}) })
    }
  }
  // (an agent run by hand in a plain terminal goes by its program's name: claude, codex)
  const meters = plugin.service("terminal:meters"), agents = [...out.values()].flatMap((x) => (x.busy ? [x.agent ?? x.process] : []))
  if (typeof meters === "function" && agents.length) {
    const by = await Promise.resolve(meters(agents)).catch(() => null) as Record<string, unknown> | null
    for (const [id, m] of Object.entries(by ?? {})) { const x = out.get(id); if (x?.busy) x.meter = m }
  }
  return [...out.values()].sort((a, b) => a.started - b.started)
}

/** The other machines' sessions, as their lists said last: machine id -> its socket and list. */
const remotes = new Map<string, { sock: WebSocket; list: Listed[] }>()

async function list(local: boolean): Promise<Listed[]> {
  const mine = await localList()
  return local ? mine : [...mine, ...[...remotes.values()].flatMap((r) => r.list)]
}

/** Follow every other machine that has a terminal (and drop the ones that went away). */
async function followMachines() {
  const want = (await machineList()).filter((m) => !m.self && m.online && m.plugins?.includes("terminal"))
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

async function sendList() {
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

async function owner(req: Request) {
  const why = req.http ? await plugin.refusal(req.http, "the terminal") : ""
  if (why) throw new HTTPError(403, why)
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

plugin.route("GET", "terminals/sessions", async (req) => {
  await owner(req)
  return { sessions: await localList(), backend: (await backendForNew()).name, tmux: !!tmuxShells }
})

plugin.route("GET", "terminals/*/screen", async (req) => {
  await owner(req)
  const id = localId(req)
  const lines = clamp(req.query.lines, 1, scrollback(), 50)
  // The visible screen plus `lines` above it, wrapped lines joined, trailing blank lines left out.
  const all = (await (await mustRun(id)).screen(id, lines)).replace(/\s+$/, "").split("\n")
  return { id, lines: all.slice(-lines) }
})

plugin.route("POST", "terminals/*", async (req) => {
  await owner(req)
  const id = localId(req)
  if (await runsHere(id)) return { id, started: false }
  const prompt = typeof req.body?.prompt === "string" && req.body.prompt.trim() ? req.body.prompt : null
  if (!starting.has(id)) starting.set(id, start(id, 80, 24, LOCAL, prompt).finally(() => starting.delete(id)))
  await starting.get(id)!
  return { id, started: true, agent: agentOf(id)?.name ?? null }
}, { lock: false })

plugin.route("POST", "terminals/*/send", async (req) => {
  await owner(req)
  const id = localId(req)
  const b = await mustRun(id)
  const text = typeof req.body?.text === "string" ? req.body.text : ""
  const enter = req.body?.enter !== false
  if (!text && !enter) throw new HTTPError(400, "send needs a text (or enter)")
  await b.send(id, text, enter)
  setTimeout(listChanged, 400)
  return { id, sent: text.length, enter }
}, { lock: false })

plugin.route("DELETE", "terminals/*", async (req) => {
  await owner(req)
  const id = localId(req)
  const b = await mustRun(id)
  // (?keep=1: its tabs stay, saying it ended)
  const s = sessions.get(id), keep = req.query.keep === "1"
  if (s) end(s, keep)
  else { if (!keep) markEnded(id); await b.kill(id) }
  listChanged()
  return { id, ended: true }
}, { lock: false })

// --- which terminal a process runs in (the Claude Code plugin: a running session -> its tab)

/** Every backend's shells: shell pid -> {id, title} (a second ago at most). */
const shellPids = () => plugin.memo(1, async function shellPids() {
  const map = new Map<number, { id: string; title?: string }>()
  for (const b of backends()) for (const x of await b.list().catch(() => [] as Shell[])) if (x.pid && !x.spare) map.set(x.pid, { id: x.id, title: titleOf(x.title ?? "") })
  return map
})

/** The terminal session a process runs in, or null: by Claude Code's tmux pane `hint` when it has one, else by walking
 *  the process's parents up to a terminal's shell. */
plugin.provide("terminal:of", async (pid: number, hint = ""): Promise<string | null> => {
  const shells = await shellPids()
  const named = /^vau-([\w-]+):/.exec(hint)?.[1]
  if (named && [...shells.values()].some((x) => x.id === named)) return named
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

/** A terminal's id and title (a Claude Code session's name), or null when it isn't running. */
plugin.provide("terminal:info", async (id: string) => {
  const s = (await localList()).find((x) => x.id === id)
  return s ? { id: s.id, title: s.title } : null
})
