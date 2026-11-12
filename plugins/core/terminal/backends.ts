// The backends (backend.ts), named by the port this process serves on (server.ts sets PORT): backendName.
import { execFile } from "node:child_process"
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import path from "node:path"
import { agentSession, serversOwn, parseTerminal } from "../../../core/agents.ts"
import { agentLines, HTTPError, LOCAL as LOCAL_DIR, onTailnet, vauDir, writeWslVau, serverUrl, type Access, accessOf } from "../../../core/plugins.ts"
import { launch, loadPty, localBackend, mirrored, plain, ptyLink, runScript, serverFiles, SHELL_DIR, shellArgs, shellFiles, termdBackend, type Backend, type Listed as Shell } from "./backend.ts"
import { kindOf, progName } from "./shells.ts"
import { NAME, SPARE, STATES, TERMINAL_ID, UPLOADS, UPLOADS_KEPT, WIN, plugin, sessions, shell } from "./shared.ts"
import { onEvent } from "./start.ts"

// The terminal server (termd/), which takes over the keeper's terminals from before it (ptyd, protocol 1) once it runs.
const OLD_SERVERS = [1, 2, 3, 4].map((v) => serverFiles(NAME, v))
export const keeper = termdBackend(NAME, { daemon: path.join(plugin.dir, "termd", "termd.ts"), log: console.error, oldServers: OLD_SERVERS })
// (the keeper's terminals from before are taken over here when the terminal server can't start to take them)
// (its routine lines, a shell made or ended, aren't errors: what goes wrong comes as a "trouble" event, onEvent)
export const fallback = localBackend({ log: (...a) => console.log("terminal (in this server):", ...a), oldServers: OLD_SERVERS,
  adoptOld: async () => !(await keeper.ready().catch(() => false)) })
/** Another plugin's backend, while it's on (the service "terminal:backend": herdr's, Rex's), or null. One made for the
 *  Backend before this one (no capture) isn't used: its plugin needs an update. */
let oldBackend = ""
export function pluginBackend(): Backend | null {
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
/** Where this server keeps its terminals: the terminal server's socket (or pipe) and files, and its backend. */
plugin.exports.kept = { name: NAME, socket: keeper.socket, files: keeper.files, backend: keeper }
/** Every backend, in the order a session's id is looked for. */
export const backends = (): Backend[] => [keeper, fallback, ...[pluginBackend()].filter((b): b is Backend => !!b)]

/** The terminals another plugin's backend holds (herdr's panes), as last seen, kept on this machine: a tab of one waits
 *  for that backend when it's away rather than starting a shell under its id. The last 2000. */
let owners: Record<string, { backend: string; label: string }> | null = null
const ownersFile = () => path.join(plugin.localDir(), "backends.json")
export function ownerOf(id: string) {
  if (!owners) { try { owners = JSON.parse(fs.readFileSync(ownersFile(), "utf8")) } catch { owners = {} } }
  return owners![id] ?? null
}
let ownersWrite: ReturnType<typeof setTimeout> | null = null
export function ownedBy(id: string, b: Backend) {
  if (ownerOf(id)?.backend === b.name) return
  const all = owners!
  delete all[id]
  all[id] = { backend: b.name, label: b.label }
  const ids = Object.keys(all)
  for (const old of ids.slice(0, Math.max(0, ids.length - 2000))) delete all[old]
  ownersWrite ??= setTimeout(() => { ownersWrite = null; try { fs.writeFileSync(ownersFile(), JSON.stringify(owners)) } catch { /* next time */ } }, 1000)
}
export const ours = (b: Backend) => b === keeper || b === fallback

/** Where a new terminal starts: a plugin's backend that asks for them (and answers), else the terminal server, else
 *  this server itself if that can't start. */
export async function backendForNew(): Promise<Backend> {
  const other = pluginBackend()
  if (other?.preferred && (await other.ready().catch(() => false))) return other
  if (await keeper.ready().catch(() => false)) return keeper
  return fallback
}

/** The backend running terminal `id` (and how it lists it), or null. */
export async function findShell(id: string): Promise<{ b: Backend; x: Shell } | null> {
  // (all asked at once: a plugin's answer may be a process of its own, which a busy machine is slow to start)
  const all = backends(), lists = await Promise.all(all.map((b) => b.list().catch(() => [] as Shell[])))
  for (const [i, l] of lists.entries()) { const x = l.find((y) => y.id === id); if (x) return { b: all[i], x } }
  return null
}
export async function backendOf(id: string): Promise<Backend | null> {
  return sessions.get(id)?.backend ?? (await findShell(id))?.b ?? null
}
/** A shell with this id runs here (in any backend). */
export const runsHere = async (id: string) => !!(await backendOf(id))

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
export function upload(id: string, files: Map<string, string>, msg: { id?: string; name?: string; data?: string; last?: boolean }): string | null {
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
export function env(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || serversOwn(k) || agentSession(k, v)) continue
    // (Windows' variables have any case, and a shell given Path and PATH would take either: one, Path)
    out[WIN && k.toUpperCase() === "PATH" ? PATH : k] = v
  }
  return { ...out, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Vaultite", LANG: out.LANG || (process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8") } // (a server may not have en_US generated)
}

/** env() for a new terminal of backend `b`, with Claude Code's pictures on when `b` draws them (Backend.pictures): an
 *  older terminal server still running, or another plugin's backend, would show the rows they take blank. */
export async function termEnv(b: Backend): Promise<Record<string, string>> {
  const out = env()
  if (!(await b.pictures?.().catch(() => false))) return out
  return { ...out,
    // (Claude Code draws pictures only for a terminal whose XTVERSION names kitty or Ghostty, which ours answers as
    // xterm.js did; this tells it ours draws them, and that it reads their files: termd's kitty.ts)
    CLAUDE_CODE_FORCE_TERMINAL_IMAGES: "1",
    // (and its mod that draws the pictures Claude reads and the person pastes: claude-pictures/)
    CLAUDE_CODE_PLUGIN_DIRS: [out.CLAUDE_CODE_PLUGIN_DIRS, PICTURES_MOD].filter(Boolean).join(path.delimiter) }
}

/** The Claude Code mod Vaultite's terminals load (CLAUDE_CODE_PLUGIN_DIRS). */
const PICTURES_MOD = path.join(plugin.dir, "claude-pictures")

/** The environment's PATH, as Windows spells it. */
export const PATH = WIN ? "Path" : "PATH"

/** Where a terminal is opened from: through Tailscale Serve, and which app (the iPhone app and an attached desktop app set
 *  a cookie: core/phoneapp.ts, electron/host.ts). */
export type From = { remote: boolean; client: "desktop" | "iphone" | "web" }
export const LOCAL: From = { remote: false, client: process.env.VAULTITE_DESKTOP === "1" ? "desktop" : "web" }
export function fromReq(req: IncomingMessage): From {
  const app = /(?:^|;\s*)vaultite_client=(iphone|desktop)(?:;|$)/.exec(req.headers.cookie ?? "")?.[1] as From["client"] | undefined
  return { remote: typeof req.headers["tailscale-user-login"] === "string", client: app ?? LOCAL.client }
}

/** Programs a terminal finds right after vau, before the user's own (the server's VAULTITE_AGENT_BIN): QA's stand-in
 *  agents, so QA never starts a real one. */
const AGENT_BIN = process.env.VAULTITE_AGENT_BIN ?? ""

/** Another server a terminal's vau tells the user through (a job's home: VAULTITE_HOME, core/cli.ts' homeEnv), and
 *  this machine as that one names it. */
export type Home = { url: string; as: string }
export const homeOf = (v: unknown): Home | undefined => {
  const h = v && typeof v === "object" ? v as Record<string, unknown> : null, url = typeof h?.url === "string" ? h.url.replace(/\/+$/, "") : "", as = typeof h?.as === "string" ? h.as : ""
  if (!h) return undefined
  if (!onTailnet(url) || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(as)) throw new HTTPError(400, "home: {url, as}, a server on the tailnet and this machine's id there")
  return { url, as }
}

/** What a shell is told about where it runs (see the docstring): Vaultite's variables, and PATH with the app's bin/.
 *  A WSL distro's get them through WSLENV, paths made its own (/p), with its own vau. */
export function context(id: string | null, from: From, sh = shell(), home?: Home): Record<string, string> {
  // (the folder whose vau a terminal finds first: core/appentry.ts)
  const bin = vauDir(LOCAL_DIR), kind = kindOf(sh)
  shellFiles()
  const out: Record<string, string> = {
    VAULTITE: "1",
    VAULTITE_URL: serverUrl(),
    VAULTITE_VAULT: plugin.vault.path,
    VAULTITE_CLIENT: from.client,
    ...(id ? { VAULTITE_TERMINAL: id } : {}),
    VAULTITE_BIN: bin,
    ...(home ? { VAULTITE_HOME: home.url, VAULTITE_HOME_AS: home.as } : {}),
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
export function agentContext() {
  let text = ""
  try { text = fs.readFileSync(path.join(plugin.dir, "context.md"), "utf8").trim() } catch { /* none */ }
  const lines = agentLines(plugin.vault).map((l) => `- ${l.text}`)
  return [text, ...lines].filter(Boolean).join("\n")
}

/** The vault's events hear `type` (plugin.emit), once the app runs this plugin's operations: what the terminal server
 *  tells as it's first reached (an end while the server was away) can come while the plugin still loads. */
const early: [string, Record<string, unknown>][] = []
const hostUp = () => { try { return !!plugin.host } catch { return false } }
export function tell(type: string, data: Record<string, unknown>) {
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
export const stateFile = (id: string) => path.join(STATES, id)
export const oscMark = (id: string) => `${stateFile(id)}.osc`
export function hooksText(id: string) {
  try { return fs.readFileSync(stateFile(id), "utf8").trim() || null } catch { return null }
}

/** Whether session `id` runs on this machine. */
plugin.provide("terminal:runs", runsHere)

async function dropSpares() {
  for (const b of backends()) {
    if (!b.spares) continue
    for (const x of await b.list().catch(() => [] as Shell[])) if (x.id.startsWith(SPARE)) await b.kill(x.id).catch(() => {})
  }
}
export const dropped = dropSpares()
for (const b of [keeper, fallback]) b.events?.((ev) => onEvent(b, ev))
