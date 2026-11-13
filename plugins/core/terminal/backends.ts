import { execFile } from "node:child_process"
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import path from "node:path"
import { agentSession, serversOwn, parseTerminal } from "../../../core/agents.ts"
import { agentLines, HTTPError, LOCAL as LOCAL_DIR, logger, onTailnet, vauDir, writeWslVau, serverUrl, type Access, accessOf } from "../../../core/plugins.ts"
import { loadPty, localBackend, mirrored, plain, ptyLink, serverFiles, termdBackend, type Backend, type Listed as Shell } from "./backend.ts"
import { launch, runScript, SHELL_DIR, shellArgs, shellFiles } from "./launch.ts"
import { kindOf, progName } from "./shells.ts"
import { NAME, SPARE, STATES, TERMINAL_ID, UPLOADS, UPLOADS_KEPT, WIN, plugin, sessions, shell } from "./shared.ts"
import { onEvent } from "./start.ts"

const log = logger("terminal")

const OLD_SERVERS = [1, 2, 3, 4].map((v) => serverFiles(NAME, v))
export const keeper = termdBackend(NAME, { daemon: path.join(plugin.dir, "termd", "termd.ts"), log: console.error, oldServers: OLD_SERVERS })
export const fallback = localBackend({ log: (...a) => console.log("terminal (in this server):", ...a), oldServers: OLD_SERVERS,
  adoptOld: async () => !(await keeper.ready().catch(() => false)) })
let oldBackend = ""
export function pluginBackend(): Backend | null {
  const fn = plugin.service("terminal:backend")
  let b: Backend | null = null
  try { b = typeof fn === "function" ? (fn() as Backend | null) ?? null : null } catch { return null }
  if (b && typeof b.capture !== "function") {
    if (oldBackend !== b.name) { oldBackend = b.name; log.error(`the backend ${b.name} is made for an older Terminal (it has no capture): not used until its plugin is updated`) }
    return null
  }
  if (b && b.events && !heard.has(b)) { heard.add(b); b.events((ev) => onEvent(b!, ev)) }
  return b
}
const heard = new WeakSet<Backend>()
/** What a plugin's backend may use, through plugin.peer("terminal").exports. */
plugin.exports.backendKit = { launch, loadPty, ptyLink, mirrored, runScript, shellArgs, plain }
/** Where this server keeps its terminals: the terminal server's socket (or pipe) and files, and its backend. */
plugin.exports.kept = { name: NAME, socket: keeper.socket, files: keeper.files, backend: keeper }
export const backends = (): Backend[] => [keeper, fallback, ...[pluginBackend()].filter((b): b is Backend => !!b)]

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

export async function backendForNew(): Promise<Backend> {
  const other = pluginBackend()
  if (other?.preferred && (await other.ready().catch(() => false))) return other
  if (await keeper.ready().catch(() => false)) return keeper
  return fallback
}

export async function findShell(id: string): Promise<{ b: Backend; x: Shell } | null> {
  const all = backends(), lists = await Promise.all(all.map((b) => b.list().catch((): Shell[] => [])))
  for (const [i, l] of lists.entries()) { const x = l.find((y) => y.id === id); if (x) return { b: all[i], x } }
  return null
}
export async function backendOf(id: string): Promise<Backend | null> {
  return sessions.get(id)?.backend ?? (await findShell(id))?.b ?? null
}
export const runsHere = async (id: string) => !!(await backendOf(id))

async function access(dir: string): Promise<Access> {
  const other = pluginBackend()
  if (other?.preferred && (await other.ready().catch(() => false))) return { ok: null, why: `terminals run in ${other.label}, which can't tell` }
  return (await keeper.access(dir)) ?? fs.promises.readdir(dir).then((): Access => ({ ok: true }), (e: NodeJS.ErrnoException) => accessOf(e.code ?? "EIO"))
}
plugin.provide("terminal:access", access)

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

export function env(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || serversOwn(k) || agentSession(k, v)) continue
    // Windows' variables have any case, and a shell given Path and PATH would take either.
    out[WIN && k.toUpperCase() === "PATH" ? PATH : k] = v
  }
  return { ...out, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Vaultite", LANG: out.LANG || (process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8") } // a Linux server may not have en_US generated
}

/** Claude Code's pictures go on only where `b` draws them: elsewhere Claude Code leaves the rows they take blank. */
export async function termEnv(b: Backend): Promise<Record<string, string>> {
  const out = env()
  if (!(await b.pictures?.().catch(() => false))) return out
  return { ...out,
    // Claude Code draws pictures only for a terminal whose XTVERSION names kitty or Ghostty, which ours answers as
    // xterm.js did; this tells it ours draws them, and reads their files.
    CLAUDE_CODE_FORCE_TERMINAL_IMAGES: "1",
    CLAUDE_CODE_PLUGIN_DIRS: [out.CLAUDE_CODE_PLUGIN_DIRS, PICTURES_MOD].filter(Boolean).join(path.delimiter) }
}

const PICTURES_MOD = path.join(plugin.dir, "claude-pictures")

export const PATH = WIN ? "Path" : "PATH"

export type From = { remote: boolean; client: "desktop" | "iphone" | "web" }
export const LOCAL: From = { remote: false, client: process.env.VAULTITE_DESKTOP === "1" ? "desktop" : "web" }
export function fromReq(req: IncomingMessage): From {
  const app = /(?:^|;\s*)vaultite_client=(iphone|desktop)(?:;|$)/.exec(req.headers.cookie ?? "")?.[1]
  return { remote: typeof req.headers["tailscale-user-login"] === "string", client: app === "iphone" || app === "desktop" ? app : LOCAL.client }
}

const AGENT_BIN = process.env.VAULTITE_AGENT_BIN ?? ""

export type Home = { url: string; as: string }
export const homeOf = (v: unknown): Home | undefined => {
  if (!v || typeof v !== "object") return undefined
  const url = "url" in v && typeof v.url === "string" ? v.url.replace(/\/+$/, "") : "", as = "as" in v && typeof v.as === "string" ? v.as : ""
  if (!onTailnet(url) || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(as)) throw new HTTPError(400, "home: {url, as}, a server on the tailnet and this machine's id there")
  return { url, as }
}

export function context(id: string | null, from: From, sh = shell(), home?: Home): Record<string, string> {
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

export function agentContext() {
  let text = ""
  try { text = fs.readFileSync(path.join(plugin.dir, "context.md"), "utf8").trim() } catch { /* none */ }
  const lines = agentLines(plugin.vault).map((l) => `- ${l.text}`)
  return [text, ...lines].filter(Boolean).join("\n")
}

const early: [string, Record<string, unknown>][] = []
const hostUp = () => { try { return !!plugin.host } catch { return false } }
export function tell(type: string, data: Record<string, unknown>) {
  if (hostUp()) return void plugin.emit(type, data)
  if (early.push([type, data]) > 1) return
  const t = setInterval(() => { if (!hostUp()) return; clearInterval(t); for (const [k, d] of early.splice(0)) plugin.emit(k, d) }, 200)
  t.unref?.()
}

export function agentOf(id: string): { name: string; resume: string | null; profile: string | null } | null {
  const t = parseTerminal(id)
  return t && !t.machine && typeof plugin.service(`agent:${t.agent}`) === "function" ? { name: t.agent, resume: t.resume, profile: t.profile } : null
}

export const stateFile = (id: string) => path.join(STATES, id)
export const oscMark = (id: string) => `${stateFile(id)}.osc`
export function hooksText(id: string) {
  try { return fs.readFileSync(stateFile(id), "utf8").trim() || null } catch { return null }
}

plugin.provide("terminal:runs", runsHere)

async function dropSpares() {
  for (const b of backends()) {
    if (!b.spares) continue
    for (const x of await b.list().catch((): Shell[] => [])) if (x.id.startsWith(SPARE)) await b.kill(x.id).catch(() => {})
  }
}
export const dropped = dropSpares()
for (const b of [keeper, fallback]) b.events?.((ev) => onEvent(b, ev))
