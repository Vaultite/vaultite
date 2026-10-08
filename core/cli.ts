// vau: Vaultite from a terminal. Every command is an op of the server's catalog (help and flags come from the op), so
// agents, scripts and MCP do the same things; what touches this computer's files is LOCAL. Node only: starts fast.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { flagOf, opDoc, type OpEntry, pathAsSaid, usage as opUsage } from "./ops.ts"
import { EVENT_TYPES } from "./events.ts"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DEFAULT_URL = "http://127.0.0.1:8793"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any
export type Obj = Record<string, Any>
export type Args = { _: string[]; flags: Record<string, string | true>
  /** The command line's words as given, after the command's name (a plugin's command handing them to an op as they are). */
  raw?: string[] }
export type Result = { data: unknown; text: string }
/** One API call: the status and the body (JSON parsed, else text). */
export type Api = (method: string, route: string, body?: unknown) => Promise<{ status: number; body: unknown }>
export type Command = {
  name: string
  /** One line, for the list. */
  summary: string
  usage: string
  /** What it does and examples, for `vau <name> --help`. */
  help: string
  /** Flags that take no value. */
  bool?: string[]
  /** A plugin's command: the command it follows in `vau --help`'s list (else it goes at the end). */
  after?: string
  run: (a: Args, c: Ctx) => Promise<Result>
}

/** What an app plugin adds to vau that can't be an op of its plugin.ts (`vau mcp`, a server over stdio): its `cli.ts`
 *  exports `cli` (core/cli.ts finds it, like the server finds plugin.ts). */
export type PluginCli = {
  commands?: Command[]
}

export class CliError extends Error {}

export const done = (data: unknown, text: string): Result => ({ data, text })
export const flag = (a: Args, k: string) => (typeof a.flags[k] === "string" ? a.flags[k] as string : undefined)
export const need = (v: string | undefined, what: string, usage: string) => {
  if (!v) throw new CliError(`${what} is missing. Usage: ${usage}`)
  return v
}

export function parseJson(s: string): Any {
  try {
    return JSON.parse(s)
  } catch (e) {
    throw new CliError(`that isn't JSON (${(e as Error).message})`)
  }
}

// ---------- where the server is ----------

/** One HTTP request, with Node's http module: fetch would load undici, a third of a short command's start. */
async function request(url: string, method: string, body?: string, extra: Record<string, string> = {}) {
  const u = new URL(url)
  const { request: send } = u.protocol === "https:" ? await import("node:https") : await import("node:http")
  return new Promise<{ status: number; type: string; text: string }>((resolve, reject) => {
    const headers = body === undefined ? extra : { ...extra, "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) }
    const req = send(u, { method, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c: Buffer) => chunks.push(c))
      res.on("error", reject)
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), text: Buffer.concat(chunks).toString("utf8") }))
    })
    req.on("error", reject)
    req.end(body)
  })
}

/** The desktop app's folder for this user (its vaults.json; vau's prompt history). */
export const userData = (env: Record<string, string | undefined> = process.env) => env.VAULTITE_USER_DATA || (process.platform === "darwin"
  ? path.join(os.homedir(), "Library", "Application Support", "Vaultite") : path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Vaultite"))

/** Where a server may be when VAULTITE_URL doesn't say, in order: the desktop app's for the vault we're in (its
 *  vaults.json), the default port, then the app's other open vaults, most recent first. */
export function servers(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): string[] {
  const data = userData(env)
  type Known = { path: string; port: number; open?: boolean; last?: number }
  let known: Known[] = []
  try {
    const v = JSON.parse(fs.readFileSync(path.join(data, "vaults.json"), "utf8"))
    known = (Array.isArray(v.vaults) ? v.vaults : []).filter((x: Known) => x && typeof x.path === "string" && Number.isInteger(x.port))
  } catch { /* no desktop app here */ }
  const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
  const inside = (dir: string, root: string) => dir === root || dir.startsWith(root + path.sep)
  const here = [cwd, env.VAULTITE_VAULT].filter((x): x is string => !!x).map(real)
  const url = (k: Known) => `http://127.0.0.1:${k.port}`
  const mine = known.filter((k) => here.some((h) => inside(h, real(k.path))))
  const others = known.filter((k) => !mine.includes(k) && k.open).sort((a, b) => (b.last ?? 0) - (a.last ?? 0))
  return [...new Set([...mine.map(url), DEFAULT_URL, ...others.map(url)])]
}

/** stdin's text; `implicit`: read unasked (a body piped in), so "" rather than an error from a terminal. */
export type Stdin = (implicit?: boolean) => Promise<string>
export type CtxOptions = { url?: string; api?: Api; env?: Record<string, string | undefined>; stdin?: Stdin
  /** No longer used: the vault is the server's (every command is one of its operations). */
  vault?: string
  /** Who's calling, when it isn't the CLI as such (X-Vaultite-Client: "mcp" for `vau mcp`'s tools) and the agent it
   *  calls for (X-Vaultite-Agent: "claude-code"), when its variables can't say (an MCP client names itself). */
  client?: string; agent?: string }

/** What a command works with: the server, through its API. */
export class Ctx {
  url: string
  env: Record<string, string | undefined>
  api: Api
  stdin: Stdin
  /** The command running (`vau open`: "open"), told to the server with each call (X-Vaultite-Command). */
  command = ""
  /** Servers still to try when this one doesn't answer (none when VAULTITE_URL or --url said which). */
  private next: string[]
  /** VAULTITE_URL or --url said which server. */
  fixed: boolean
  private client: string
  private agent: string | undefined

  constructor(o: CtxOptions = {}) {
    this.env = o.env ?? process.env
    const said = o.url ?? this.env.VAULTITE_URL
    this.fixed = !!said
    const found = said || o.api ? [] : servers(this.env)
    this.url = (said ?? found[0] ?? DEFAULT_URL).replace(/\/+$/, "")
    this.next = found.slice(1)
    this.api = o.api ?? ((m, r, b) => this.fetch(m, r, b))
    this.stdin = o.stdin ?? readStdin
    this.client = o.client ?? "cli"
    this.agent = o.agent
  }

  private async fetch(method: string, route: string, body?: unknown) {
    let res: { status: number; type: string; text: string }
    for (;;) {
      try {
        res = await request(`${this.url}/api/${route}`, method, body === undefined ? undefined : JSON.stringify(body), this.who())
        break
      } catch (e) {
        // Nothing listening: the next server that may be, and it's the one from then on (only then: a request that
        // failed on its way may have been done, and must not be done again elsewhere).
        if (!this.next.length || (e as NodeJS.ErrnoException).code !== "ECONNREFUSED") throw new CliError(this.down())
        this.url = this.next.shift()!
      }
    }
    let out: unknown = res.text
    if (res.type.includes("json")) {
      try { out = JSON.parse(res.text) } catch { /* as text */ }
    }
    return { status: res.status, body: out }
  }

  /** Who's calling, for the server's Activity: the CLI, the coding agent it runs under when its variables say so (Claude
   *  Code sets CLAUDECODE, Codex CODEX_SANDBOX..., the server also looks at the calling process), and the command. */
  private who(): Record<string, string> {
    const agent = this.agentName()
    return { "X-Vaultite-Client": this.client, ...(agent ? { "X-Vaultite-Agent": agent } : {}), ...(this.command ? { "X-Vaultite-Command": this.command } : {}) }
  }

  /** The coding agent this runs under, by its variables ("claude-code", "codex"...), or "". */
  agentName(): string {
    const e = this.env
    return this.agent ?? (e.CLAUDECODE ? "claude-code" : Object.keys(e).some((k) => k.startsWith("CODEX_") && k !== "CODEX_HOME") ? "codex"
      : e.OPENCODE ? "opencode" : e.CURSOR_AGENT ? "cursor" : e.GEMINI_CLI ? "gemini" : "")
  }

  down() {
    return `Vaultite isn't answering at ${this.url}. Open the app, or start it with \`npm start\` in ${ROOT} (or its ` +
      "service: vau service install), or set VAULTITE_URL to the server that's running."
  }

  /** An API call's body; a failure (4xx, 5xx) is an error with the server's message. */
  async call(method: string, route: string, body?: unknown): Promise<Any> {
    const r = await this.api(method, route, body)
    if (r.status >= 400) {
      const msg = r.body && typeof r.body === "object" && "error" in r.body ? (r.body as Obj).error : String(r.body).slice(0, 300)
      if (r.status === 404 && msg === "not found") throw new CliError(`the server has no /api/${route.split("?")[0]} (an older version? restart it)`)
      throw new CliError(String(msg))
    }
    return r.body
  }

  /** Is the server up? */
  async up() {
    try {
      await this.api("GET", "ui")
      return true
    } catch (e) {
      if (e instanceof CliError) return false
      throw e
    }
  }
}

let piped: Promise<string> | null = null
/** How long an open pipe nobody writes to (an agent's spawned process: a socket) is waited for, when read unasked. */
const UNASKED_MS = 250

/** stdin's text, read once. Asked for (`-`), it's waited for until it ends; unasked, nothing from a terminal, and a socket
 *  that says nothing at first (an agent's process with stdin left open) isn't waited for. */
export function readStdin(implicit = false): Promise<string> {
  if (process.stdin.isTTY) {
    if (implicit) return Promise.resolve("")
    return Promise.reject(new CliError("give the text with --from <file> or as an argument, or pipe it in: `echo text | vau ...`"))
  }
  piped ??= new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let socket = false
    try { socket = fs.fstatSync(0).isSocket() } catch { /* closed: nothing comes */ }
    const quiet = implicit && socket ? setTimeout(() => { process.stdin.destroy(); resolve("") }, UNASKED_MS) : null
    process.stdin.on("data", (c: Buffer) => { if (quiet) clearTimeout(quiet); chunks.push(c) })
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    process.stdin.on("error", (e: NodeJS.ErrnoException) => (e.code === "EBADF" || e.code === "EPIPE" ? resolve("") : reject(e)))
  })
  return piped
}

/** A path as the user would say it ("Today", "Notes/Idea") made a vault path, when the server knows the files (ops
 *  do this themselves for their `format: "path"` parameters: core/ops.ts pathAsSaid). */
export async function resolvePath(c: Ctx, p: string) {
  try { return pathAsSaid(await c.call("GET", "files"), p) } catch { return p.trim().replace(/^\/+/, "") }
}

// ---------- what only vau does ----------

/** The commands that aren't ops: they run here. */
export const COMMANDS: Command[] = [{
  name: "sandbox",
  summary: "Make the sandbox (a made-up vault to try the app in, dated as of today) in a folder.",
  usage: "vau sandbox <folder> [--today YYYY-MM-DD]",
  help: `Writes the sandbox into <folder>: the sample vault (examples/vault) with its dates moved to today, plus the
weeks of sleep, meals, workouts, reading and practice before today. The folder must be new, empty, or a
sandbox made before (it's replaced). Then open it as a vault (the desktop app: Help > Open sandbox vault does both), or
serve it: VAULTITE_VAULT=<folder> npm start. Never your own vault: it's made up. No server needed.

  vau sandbox /tmp/vaultite-sandbox
  vau sandbox ~/Sandbox --today 2026-12-24`,
  run: async (a) => {
    const dir = a._[0]
    if (!dir) throw new CliError("which folder? vau sandbox <folder>")
    const { makeSandbox, localToday } = await import("./sandbox.ts")
    const r = makeSandbox(path.resolve(dir.replace(/^~(?=\/|$)/, os.homedir())), flag(a, "today") ?? localToday())
    return done({ path: path.resolve(dir), ...r }, `Made the sandbox in ${dir} (${r.files} files, as of ${r.today}).`)
  },
}, {
  name: "service",
  summary: "Keep this checkout's server running on this machine: a launchd agent on macOS, a systemd user unit on Linux.",
  usage: "vau service install --vault <folder> [--port <n>] [--host <address>] [--print] | vau service uninstall",
  bool: ["print"],
  help: `install writes the job and starts it: on macOS ~/Library/LaunchAgents/app.vaultite.server.plist (at login,
logs in ~/Library/Logs/vaultite.log), on Linux ~/.config/systemd/user/vaultite.service (at boot: it turns on linger,
so it runs with nobody logged in, as on a VPS; logs: journalctl --user -u vaultite). It runs this checkout's server.ts
with the Node running vau, serving --vault (else VAULTITE_VAULT) on 127.0.0.1:8793 unless --port/--host say. Install
again after moving the checkout or Node. --print shows the file without writing it. Reach it from your other devices
with Tailscale Serve (\`tailscale serve --bg --https=8447 http://127.0.0.1:8793\`): SECURITY.md. uninstall stops it
and removes the file.

  vau service install --vault ~/Vault
  vau service install --vault ~/Vault --print
  vau service uninstall`,
  run: async (a, c) => {
    const what = a._[0]
    if (what !== "install" && what !== "uninstall") throw new CliError("install or uninstall? vau service install --vault <folder>")
    const S = await import("./service.ts")
    const vault = flag(a, "vault") ?? c.env.VAULTITE_VAULT
    const port = flag(a, "port") !== undefined ? Number(flag(a, "port")) : undefined
    if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new CliError("--port is a port number")
    const o = { root: ROOT, node: S.stableNode(process.execPath, c.env.PATH), vault: vault ? local(vault) : "", port, host: flag(a, "host") }
    if (what === "uninstall") {
      const r = S.uninstallService(process.platform, o)
      return done({ file: r.file, failed: r.failed }, [`Removed ${r.file}.`, ...r.failed].join("\n"))
    }
    if (!vault) throw new CliError("which vault? vau service install --vault <folder>")
    const [maj, min] = process.versions.node.split(".").map(Number)
    if (maj < 23 || (maj === 23 && min < 6)) throw new CliError(`this is Node ${process.versions.node}; the server needs 23.6 or later: run vau with that one (path/to/node bin/vau service install ...)`)
    if (!fs.existsSync(o.vault)) throw new CliError(`no folder ${o.vault}`)
    if (a.flags.print) {
      const p = S.servicePlan(process.platform, o)
      return done({ file: p.file, text: p.text }, `${p.file}:\n\n${p.text}`)
    }
    const r = S.installService(process.platform, o)
    const url = `http://${o.host ?? "127.0.0.1"}:${port ?? 8793}`
    return done({ file: r.file, log: r.log, url, failed: r.failed },
      [`Wrote ${r.file} and started it: ${url} serves ${o.vault}. Logs: ${r.log}`, ...r.failed.map((f) => `Couldn't: ${f}`)].join("\n"))
  },
}, {
  // (streams, so it's a command rather than an op: it's the op events.wait, asked again with each answer's cursor)
  name: "events",
  summary: "Print the vault's events as they happen (files changed, operations done), one JSON object per line.",
  usage: "vau events [--type <t1,t2>] [--path <prefix>] [--once] [--timeout <s>] [--after <cursor>]",
  bool: ["once"],
  help: `Prints each event (core/events.ts) as one line of JSON until stopped: {type, seq, t, cursor, ...}. --type
keeps some types or areas (file is every file event), --path the events about paths starting with a prefix. --once
prints the first and stops; --timeout ends after that many seconds (with --once and nothing come by then, exit 1);
--json prints them as one list when it ends. --after a cursor (an event's) first prints what came after it, so a
script that restarts misses nothing. Types:
${Object.entries(EVENT_TYPES).map(([k, v]) => `  ${k.padEnd(13)} ${v}`).join("\n")}
<plugin>.<x>  a plugin's own

vau events --type file.changed --path Notes/
vau events --once --type op.done --timeout 60
vau events | while read -r ev; do echo "$ev" | jq -r .type; done`,
  run: async (a, c) => {
    const once = !!a.flags.once
    const limit = flag(a, "timeout") !== undefined ? Number(flag(a, "timeout")) : null
    if (limit !== null && !(limit >= 0)) throw new CliError("--timeout is a number of seconds")
    const end = limit === null ? Infinity : Date.now() + limit * 1000
    let after = flag(a, "after") ?? null
    const kept: unknown[] = []
    for (;;) {
      const left = Math.max(0, Math.min(60, (end - Date.now()) / 1000))
      const r = await c.call("POST", "ops/events.wait", { types: flag(a, "type") ?? flag(a, "types"), path: flag(a, "path"), after, timeout: left })
      after = r.cursor ?? after
      if (r.missed) process.stderr.write("vau events: some events were let go of before they could be printed\n")
      for (const ev of r.events ?? []) {
        if (once) return done(ev, JSON.stringify(ev))
        if (a.flags.json) kept.push(ev)
        else process.stdout.write(JSON.stringify(ev) + "\n") // as they come
      }
      if (Date.now() >= end) break
    }
    if (once) throw new CliError(`no matching event within ${limit} s`)
    return done(kept, "")
  },
}]

/** A path on this computer as the shell gave it (~ is home). */
const local = (p: string) => path.resolve(String(p).replace(/^~(?=\/|$)/, os.homedir()))

/** What vau does around an op with this computer's files, which the server (maybe another machine's) can't reach:
 *  `params` turns paths into text, `extra` takes more positional words, `out` handles the answer instead of printing. */
type Local = { params?: (p: Obj, c: Ctx) => Promise<Obj>; extra?: number; out?: (result: Any, p: Obj, extra: string[]) => string }
const LOCAL: Record<string, Local> = {
  // vau write <path> [--from <file>] [--base <file>]: the text from a file or stdin, the base from a file.
  "file.write": {
    params: async ({ from, base, ...p }, c) => {
      const read = (f: string, what: string) => { try { return fs.readFileSync(local(f), "utf8") } catch { throw new CliError(`can't read ${f} (${what})`) } }
      const text = from !== undefined && from !== true ? read(String(from), "--from: the file with the new text") : p.text ?? await c.stdin()
      return { ...p, text, ...(base !== undefined && base !== true ? { base: read(String(base), "--base: the file with the text you started from") } : {}) }
    },
  },
  // vau bundle import <file|folder>: a bundle's JSON file, or a folder shaped like a bundle.
  "bundle.import": {
    params: async (p) => {
      const b = p.bundle
      if (typeof b !== "string" || /^\s*\{/.test(b)) return p
      const from = local(b)
      if (fs.existsSync(from) && fs.statSync(from).isDirectory()) {
        const files: Record<string, string> = {}
        for (const rel of fs.readdirSync(from, { recursive: true }) as string[]) {
          const full = path.join(from, rel)
          if (fs.statSync(full).isFile() && !rel.split(path.sep).some((x) => x.startsWith("."))) files[rel.split(path.sep).join("/")] = fs.readFileSync(full, "utf8")
        }
        return { ...p, bundle: { vaultite: "bundle", format: 1, id: path.basename(from), files } }
      }
      try { return { ...p, bundle: JSON.parse(fs.readFileSync(from, "utf8")) } } catch { throw new CliError(`${from} isn't a bundle's JSON file`) }
    },
  },
  // vau bundle export <id> [<file>|-]: written to <id>.bundle.json, or the file given; - prints it.
  "bundle.export": {
    extra: 1,
    out: (r, p, extra) => {
      const text = JSON.stringify(r, null, 2) + "\n"
      if (extra[0] === "-") return text.trimEnd()
      const out = local(extra[0] ?? `${p.id}.bundle.json`)
      fs.writeFileSync(out, text)
      return `Wrote ${out}.`
    },
  },
}

// ---------- plugins' commands ----------

let loaded: Promise<Command[]> | null = null

/** The built-in plugins' `cli.ts` (a vault plugin's code runs only in the server), merged into the
 *  core's commands, each after the one it names. */
function loadPlugins(): Promise<Command[]> {
  loaded ??= (async () => {
    const subdirs = (d: string) => {
      try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => path.join(d, e.name)).sort() } catch { return [] }
    }
    const dirs = subdirs(path.join(ROOT, "plugins", "core")).filter((d) => fs.existsSync(path.join(d, "cli.ts")))
    const mods = await Promise.all(dirs.map(async (d) => (await import(pathToFileURL(path.join(d, "cli.ts")).href)).cli as PluginCli | undefined))
    const commands = [...COMMANDS]
    for (const c of mods.flatMap((m) => m?.commands ?? [])) {
      const at = c.after ? commands.findIndex((x) => x.name === c.after) : -1
      commands.splice(at < 0 ? commands.length : at + 1, 0, c)
    }
    return commands
  })()
  return loaded
}

/** The commands that run here: the sandbox and the plugins', in `vau --help`'s order. */
export const commands = () => loadPlugins()

// ---------- running ----------

/** vau's own switches, on any command: --copy also puts the output on the clipboard; --count and --paths read a list. */
const GLOBAL_BOOL = ["json", "help", "copy", "count", "paths"]

export function parseArgs(argv: string[], bool: Iterable<string> = []): Args {
  const b = new Set([...GLOBAL_BOOL, ...bool])
  const _: string[] = [], flags: Args["flags"] = {}
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (x === "--") { _.push(...argv.slice(i + 1)); break }
    if (x === "-h") flags.help = true
    else if (x.startsWith("--") && x.length > 2) {
      const eq = x.indexOf("=")
      const k = eq > 0 ? x.slice(2, eq) : x.slice(2)
      if (eq > 0) flags[k] = x.slice(eq + 1)
      else if (b.has(k) || i + 1 >= argv.length || (argv[i + 1].startsWith("--") && argv[i + 1].length > 2)) flags[k] = true
      else flags[k] = argv[++i]
    } else _.push(x)
  }
  return { _, flags }
}

/** The words a command line starts with, before its first flag (global ones before them skipped): what names the
 *  command (`vau plugin on reddit --json`: plugin, on, reddit). */
function leadingWords(argv: string[]) {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (!out.length && (GLOBAL_BOOL.includes(x.slice(2)) && x.startsWith("--") || x === "-h")) continue
    if (!out.length && x === "--url") { i++; continue }
    if (x === "--") { out.push(...argv.slice(i + 1)); break }
    if (x.startsWith("-") && x.length > 1) break
    out.push(x)
  }
  return out
}

export function usage(cmds: Command[], ops: OpEntry[] | null = null) {
  // Ops with a CLI name, one row each (a group of several words under its first: `inbox`), then the local commands.
  const rows: [string, string][] = []
  for (const e of ops ?? []) {
    if (!e.cli) continue
    const first = e.cli.split(" ")[0]
    if (rows.some(([n]) => n === first)) continue
    const group = (ops ?? []).filter((x) => x.cli?.split(" ")[0] === first)
    rows.push([first, group.length === 1 && group[0].cli === first ? e.summary : group.find((x) => x.cli === first)?.summary ??
      `${group.map((x) => x.cli!.split(" ").slice(1).join(" ") || first).join(", ")}: vau ${first} --help`])
  }
  for (const c of cmds) if (!rows.some(([n]) => n === c.name)) rows.push([c.name, c.summary])
  const w = Math.max(...rows.map(([n]) => n.length))
  return `vau: drive Vaultite (the user's vault and app) from a terminal.

Commands:
${rows.map(([n, s]) => `  ${n.padEnd(w)}  ${s}`).join("\n")}

${ops ? `And every operation of the API by its id (${ops.length} here): \`vau ops\` lists them, \`vau <id> --help\` explains one.`
    : "The rest (context, render, read, search, panels, plugins...) are the server's operations: they're listed once it answers."}
Start with \`vau context\`. \`vau <command> --help\` explains one, with examples.
When you finish something the user should know about, \`vau notify <text>\` tells them (a toast, kept in their inbox).

Options: --json (machine-readable output), --count (how many a list answer holds), --paths (its files, one a line),
--copy (the output on the clipboard too), --url <server>. \`-\` as a value reads stdin. \`vau\` alone in a terminal
is a prompt (Tab completes, with history).
Environment: VAULTITE_URL (else the desktop app's server for the vault you're in, then ${DEFAULT_URL}, then the
app's other open vaults: the first that answers), VAULTITE_CLIENT (desktop, iphone or web: set by the app's terminal).
Settings and data both go through the server (settings key by key, the rest of each file kept); the app follows
every change live. File formats: vau docs.`
}

export const commandHelp = (c: Command) => `${c.usage}\n\n${c.summary}\n\n${c.help}`

// ---------- operations (core/ops.ts): every op is a command ----------

/** The server's catalog of operations, or null when it can't be asked (no server, an older one). */
async function catalog(c: Ctx): Promise<OpEntry[] | null> {
  try {
    const r = await c.api("GET", "ops")
    return r.status === 200 && Array.isArray(r.body) ? r.body as OpEntry[] : null
  } catch (e) {
    if (e instanceof CliError) return null
    throw e
  }
}

const camel = (k: string) => k.replace(/-([a-z])/g, (_, x: string) => x.toUpperCase())
const kebab = (k: string) => k.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`)

/** An op's parameters from a command line: `args` by position, the rest as --flags (kebab or camel), `--params <json>`,
 *  `-` for stdin. Values stay text (the server reads the schema); extra words are `extra`, up to `allow`. */
async function opParams(e: OpEntry, argv: string[], c: Ctx, allow = 0): Promise<{ params: Obj; extra: string[] }> {
  const props = e.params.properties ?? {}
  const bools = Object.entries(props).filter(([, s]) => s.type === "boolean").flatMap(([k]) => [k, kebab(k)])
  // A switch takes no value (`--error`), unless the next word is one (`--inbox false`): written `--inbox=false` then.
  const said = argv.flatMap((x, i) => (x.startsWith("--") && bools.includes(x.slice(2)) && /^(true|false|yes|no|on|off)$/i.test(argv[i + 1] ?? "") ? [`${x}=${argv[i + 1]}`] : i > 0 && argv[i - 1].startsWith("--") && bools.includes(argv[i - 1].slice(2)) && /^(true|false|yes|no|on|off)$/i.test(x) ? [] : [x]))
  // A list's flag takes the words after it, and adds up when given again (`--images a.png b.png`, `--questions a
  // --questions b`); one word stays text, a list at its commas as before (`--blocks a,b`).
  const lists: Record<string, string[]> = {}, rest: string[] = []
  for (let i = 0; i < said.length; i++) {
    const k = said[i].startsWith("--") ? camel(said[i].slice(2)) : ""
    if (!k || props[k]?.type !== "array" || said[i].includes("=")) { rest.push(said[i]); continue }
    const got = (lists[k] ??= [])
    while (i + 1 < said.length && !(said[i + 1].startsWith("--") && said[i + 1].length > 2)) got.push(said[++i])
  }
  const a = parseArgs(rest, bools)
  const params: Obj = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length === 1 ? v[0] : v]))
  const pos = [...a._]
  e.args.forEach((k, i) => {
    if (!pos.length) return
    const last = i === e.args.length - 1 && !allow
    params[k] = last && props[k]?.type === "array" ? pos.splice(0) : last && props[k]?.type === "string" ? pos.splice(0).join(" ") : pos.shift()
  })
  if (pos.length > allow) throw new CliError(`too many arguments (${pos.slice(allow).join(" ")}). ${opUsage(e)}`)
  if (typeof a.flags.params === "string") Object.assign(params, parseJson(a.flags.params === "-" ? await c.stdin() : a.flags.params))
  for (const [k, v] of Object.entries(a.flags)) {
    if (["url", "params", ...GLOBAL_BOOL].includes(k)) continue
    params[camel(k) in props ? camel(k) : k] = v
  }
  // `-` as a value is stdin (`--body -`, `vau dev eval -`); a param that takes it (`stdin`) is filled when text is piped in.
  for (const [k, v] of Object.entries(params)) if (v === "-") params[k] = (await c.stdin()).replace(/\n$/, "")
  for (const [k, s] of Object.entries(props)) if (params[k] === undefined && s.env && c.env[s.env]) params[k] = c.env[s.env]
  const fill = Object.entries(props).find(([k, s]) => s.stdin && params[k] === undefined)
  if (fill) {
    const text = (await c.stdin(true).catch(() => "")).replace(/\n$/, "")
    if (text.trim()) params[fill[0]] = text
  }
  return { params, extra: pos }
}

/** How an answer is printed: Markdown (the op's own text), JSON, or what its list holds (how many, or their paths). */
type Shape = { json?: boolean; count?: boolean; paths?: boolean }

/** The list an answer is: itself, or its first list (file.list's files, tag.list's tags); null when it has none. */
export function listOf(r: unknown): unknown[] | null {
  if (Array.isArray(r)) return r
  if (r && typeof r === "object") for (const v of Object.values(r)) if (Array.isArray(v)) return v
  return null
}

/** An answer as --count or --paths print it: the number of items its list has, or each one's vault path on a line. */
async function listed(r: unknown, how: Shape, c: Ctx): Promise<string> {
  const rows = listOf(r)
  if (!rows) throw new CliError(`${how.count ? "--count" : "--paths"} reads a list, and this command's answer isn't one (see it with --json)`)
  if (how.count) return String(rows.length)
  // An item's path, file, or id (a vault path without .md: kept when it's a file of the vault).
  let tree: Set<string> | null = null
  const out: string[] = []
  for (const x of rows) {
    const o = (x && typeof x === "object" ? x : {}) as Obj
    let p = typeof x === "string" ? x : typeof o.path === "string" ? o.path : typeof o.file === "string" ? o.file : null
    if (p === null && typeof o.id === "string") {
      if (!tree) { const t = await c.call("GET", "files").catch(() => ({})); tree = new Set([...(t.files ?? []), ...(t.others ?? [])].map((f: Obj) => f.path)) }
      p = tree.has(`${o.id}.md`) ? `${o.id}.md` : tree.has(o.id) ? o.id : null
    }
    if (p === null) throw new CliError("--paths: this command's answer lists things that aren't files (see it with --json)")
    out.push(p)
  }
  return out.join("\n")
}

/** Run an op from a command line, printed as `how` says. */
async function runOp(e: OpEntry, argv: string[], c: Ctx, how: Shape): Promise<string> {
  const loc = LOCAL[e.id] ?? {}
  const given = await opParams(e, argv, c, loc.extra ?? 0)
  const params = loc.params ? await loc.params(given.params, c) : given.params
  const list = !!how.count || !!how.paths
  const json = !!how.json || list
  const out = !!loc.out && !json
  const r = await c.api("POST", `ops/${encodeURIComponent(e.id)}${json || out ? "" : "?as=text"}`, params)
  if (r.status >= 400) {
    const b = r.body as Obj
    // (its parameters named as this command line's flags: actionOpen is --action-open)
    let msg = String(b && typeof b === "object" && "error" in b ? b.error : r.body).replace(`${e.id}: `, "")
    for (const k of Object.keys(e.params.properties ?? {})) if (!e.args.includes(k)) msg = msg.replace(new RegExp(`(?<![-\\w])${k}\\b(?![\\]>-])`, "g"), flagOf(k))
    // (what's wrong, when the answer lists it apart: a plugin that can't be installed)
    const problems = Array.isArray(b?.problems) ? (b.problems as string[]).filter((x) => !msg.includes(x)) : []
    throw new CliError([msg, ...problems.map((x) => `  - ${x}`)].join("\n"))
  }
  if (out) return loc.out!(r.body, params, given.extra)
  if (list) return await listed(r.body, how, c)
  return json ? JSON.stringify(r.body, null, 2) : String(r.body ?? "").replace(/\n+$/, "")
}

/** Run one command line: [exit code, stdout, stderr]. Nothing is printed (bin/vau prints; tests read). A command is an
 *  operation of the server's catalog, by id or CLI name, else one that runs here (COMMANDS, the plugins'). */
export async function execute(argv: string[], opts: CtxOptions = {}): Promise<{ code: number; out: string; err: string }> {
  const all = await commands()
  const a = parseArgs(argv, all.flatMap((c) => c.bool ?? []))
  const words = leadingWords(argv)
  const ctx = () => new Ctx({ ...opts, url: flag(a, "url") ?? opts.url })
  const help = words[0] === "help"
  if (!words.length || (help && words.length === 1)) return { code: 0, out: usage(all, await catalog(ctx())), err: "" }
  const named = help ? words.slice(1) : words
  const which = named[0]
  const cmd = all.find((c) => c.name === which)
  if (cmd) {
    if (help || a.flags.help) return { code: 0, out: commandHelp(cmd), err: "" }
    const c = ctx()
    c.command = cmd.name
    const args = parseArgs(argv, cmd.bool ?? [])
    args._.splice(args._.indexOf(which), 1)
    args.raw = argv.slice(argv.indexOf(which) + 1)
    try {
      const r = await cmd.run(args, c)
      if (a.flags.count || a.flags.paths) return { code: 0, out: await listed(r.data, { count: !!a.flags.count, paths: !!a.flags.paths }, c), err: "" }
      return { code: 0, out: a.flags.json ? JSON.stringify(r.data, null, 2) : r.text, err: "" }
    } catch (e) {
      if (e instanceof CliError) return { code: 1, out: "", err: `vau ${cmd.name}: ${e.message}` }
      throw e
    }
  }
  const c = ctx()
  const ops = await catalog(c)
  // An op by its id, or by its CLI name, which may be several words (`plugin on`): the longest the words start with.
  const said = (e: OpEntry) => (e.cli ?? "").split(" ").filter(Boolean)
  const fits = (ops ?? []).filter((e) => e.id === which || (e.cli && said(e).every((w, i) => named[i] === w)))
    .sort((x, y) => (y.id === which ? 99 : said(y).length) - (x.id === which ? 99 : said(x).length))
  const op = fits[0]
  if (!ops && !(await c.up())) return { code: 1, out: "", err: `vau ${which}: ${c.down()}` }
  if (!op) {
    // A group's name (`vau bundle`): the ops under it.
    const group = (ops ?? []).filter((e) => e.cli?.startsWith(`${which} `) || e.id.startsWith(`${which}.`))
    const more = named.length > 1 && !help && !a.flags.help
    if (group.length) return { code: more ? 2 : 0, out: group.map((e) => `  vau ${(e.cli ?? e.id).padEnd(24)} ${e.summary}`).join("\n") + `\n\n\`vau ${which} <command> --help\` explains one.`, err: more ? `vau: no command '${named.slice(0, 2).join(" ")}'` : "" }
    const names = [...all.map((x) => x.name), ...(ops ?? []).flatMap((e) => [e.id, e.cli ?? ""]).filter(Boolean)]
    const near = names.filter((n) => n.startsWith(which.slice(0, 3)))
    return { code: 2, out: "", err: `vau: no command '${which}'.${near.length ? ` Did you mean ${near.slice(0, 4).join(" or ")}?` : ""} See vau --help${ops ? " (a plugin's commands are there while it's on: vau plugins)" : ` (and ${c.down()})`}.` }
  }
  if (help || a.flags.help) return { code: 0, out: opDoc(op, "#").replace(/^# .*/, `vau ${op.cli ? `${op.cli} (${op.id})` : op.id}`), err: "" }
  c.command = op.cli ?? op.id
  // The words that named it are left out of its arguments.
  const rest = [...argv]
  for (const w of [...(help ? ["help"] : []), ...(op.id === which ? [which] : said(op))]) rest.splice(rest.indexOf(w), 1)
  try {
    return { code: 0, out: await runOp(op, rest, c, { json: !!a.flags.json, count: !!a.flags.count, paths: !!a.flags.paths }), err: "" }
  } catch (e) {
    if (e instanceof CliError) return { code: 1, out: "", err: `vau ${op.cli ?? op.id}: ${e.message}` }
    throw e
  }
}

/** Put text on the clipboard with the system's tool: "" when it's there, else why not. */
export async function toClipboard(text: string, platform: string = process.platform, env: Record<string, string | undefined> = process.env): Promise<string> {
  const tools = platform === "darwin" ? [["pbcopy"]] : platform === "win32" ? [["clip"]]
    : [...(env.WAYLAND_DISPLAY ? [["wl-copy"]] : []), ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]]
  const { spawn } = await import("node:child_process")
  for (const [cmd, ...args] of tools) {
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"], env: env as NodeJS.ProcessEnv })
      p.on("error", () => resolve(false))
      p.on("close", (code) => resolve(code === 0))
      p.stdin.on("error", () => {})
      p.stdin.end(text)
    })
    if (ok) return ""
  }
  return `--copy: no clipboard here (${tools.map((t) => t[0]).join(", ")} not found): printed only`
}

/** A command line's result printed: stdout, stderr, and with --copy the output on the clipboard too. */
export async function print(r: { code: number; out: string; err: string }, copy = false) {
  if (r.out) process.stdout.write(r.out.endsWith("\n") ? r.out : r.out + "\n")
  if (r.err) process.stderr.write(r.err + "\n")
  if (copy && r.code === 0 && r.out) {
    const why = await toClipboard(r.out.replace(/\n$/, ""))
    if (why) process.stderr.write(`vau: ${why}\n`)
  }
}

export async function main(argv = process.argv.slice(2)) {
  // Piped into a reader that stops (`vau files | head`): its going away ends vau quietly, not with an error.
  // (macOS may say ECONNRESET instead of EPIPE for a reader gone mid-write: a rare failure of the test for it)
  const gone = (e: NodeJS.ErrnoException) => e.code === "EPIPE" || e.code === "ECONNRESET" || e.code === "ERR_STREAM_DESTROYED"
  process.stdout.on("error", (e: NodeJS.ErrnoException) => { if (!gone(e)) throw e; process.exit(process.exitCode ?? 0) })
  process.stderr.on("error", (e: NodeJS.ErrnoException) => { if (!gone(e)) throw e })
  if (!argv.length && process.stdin.isTTY && process.stdout.isTTY) return (await import("./repl.ts")).repl()
  const r = await execute(argv)
  await print(r, !!parseArgs(argv).flags.copy)
  return r.code
}
