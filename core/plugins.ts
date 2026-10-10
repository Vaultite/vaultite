// Plugins: every feature is a folder (manifest.json, plugin.ts, index.tsx, pages/, AGENTS.md: plugins/CLAUDE.md).
// A plugin.ts makes `new Plugin(import.meta.url)` and uses only what it offers; each method below says what it does.
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import type { Readable } from "node:stream"
import os from "node:os"
import path from "node:path"
import { setImmediate as turn } from "node:timers/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { type RawData, WebSocket } from "ws"
import { type BlockDecls, blocksDoc, declsOf, settingsDoc, settingsOf } from "./blocks.ts"
import type { EventFilter, VaultEvent } from "./events.ts"
import { entryOf, type Op, type OpCtx, type OpEntry, type OpKind, pluginOpsDoc, type Who } from "./ops.ts"
import { type Job, type When, whenProblems } from "./schedule.ts"
import { ownerLogin, refusal } from "./owner.ts"
export { CONNECT_HEADER, fromInternet } from "./owner.ts"
export { outliving, runtimeDir } from "./runtime.ts"
import { pinFile, pinKind, withPinFile } from "./pins.ts"
import type { ServerError } from "./serverlog.ts"
import { noteSource } from "./sources.ts"
import { type PropTypes, readTypes } from "./proptypes.ts"
import { trustOf } from "./trust.ts"
import { onItsOwn } from "./writegate.ts"
/** A write the core refused: a plugin acting on its own wrote outside .vaultite/ where the user hasn't allowed it
 *  (its manifest's `writes`, core/writegate.ts). Keep the data in .vaultite/, or wait for the user's yes. */
export { WriteRefused } from "./writegate.ts"
import { type ArchiveHook, type CreateHook, type FileCreateHook, isHiddenPath, type Item, Kind, type MoveHook, readText, type Vault, writeAtomic } from "./vault.ts"

/** What kind of file a name is (core/filetypes.ts), for plugins that treat text files differently, and the type it is served with. */
export { contentType, isTextKind, kindOf } from "./filetypes.ts"
/** The app's version and the plugin API's (core/version.ts). */
export { API_VERSION, APP_VERSION } from "./version.ts"
/** [[Links]]: the targets in a file, and a resolver like the app's (core/links.ts). */
export { frontmatterTargets, type LinkFile, linkResolver, wikiTargets } from "./links.ts"
/** A line diff (difflib's opcodes), for what changed between two texts; diffLines: the same, fast at any size. */
export { opcodes } from "./textedit.ts"
export { diffLines } from "./linediff.ts"
// The sidebars' setup (.vaultite/sidebars.json), read and compared the app's way (Workspaces keeps copies).
export { readSidebars, sameSidebars, type Sidebars } from "./sidebars.ts"
export { pinFile, pinKind, placePin, repinList, withPinFile } from "./pins.ts"
/** Property types (core/proptypes.ts): a key's type across the vault, its quiet notes, values as their type compares them. */
export { PROP_TYPES, type PropType, type PropTypes, readTypes, typedValue, typeNotes, typeOf, typeProblem } from "./proptypes.ts"
/** A pin as it is now: its file where it was moved outside the app (Vault.relocated); a search as it is. */
export function relocatedPin(vault: Vault, entry: string) {
  const f = pinFile(entry)
  return f === null ? entry : withPinFile(entry, vault.relocated(f))
}
/** Why `entry` can't be pinned (a file that isn't in the vault, an empty search), or null. */
export function pinProblem(vault: Vault, entry: string): string | null {
  const k = pinKind(entry)
  if ("search" in k) return k.search.trim() ? null : "a pinned search needs a query"
  const full = path.join(vault.path, k.file)
  if (k.file.split("/").includes("..") || isHiddenPath(k.file) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    return `there's no file ${k.file} in the vault to pin`
  }
  return null
}
/** CSV, the vault's tables, parsed the same way everywhere (core/csv.ts: Tables, an artifact's `vau.csv`). */
export { csvRecords, parseCsv } from "./csv.ts"
/** Moment.js-style dates, written and read the same way everywhere (core/dates.ts: Templates, Periodic notes' names). */
export { formatDate, parseDate, type DateOptions } from "./dates.ts"
/** Zips held in memory (core/unzip.ts): Office files and EPUB books are zips of XML, read as text by their plugins. */
export { unzip, xmlDecode, zipText } from "./unzip.ts"
/** A file from outside the vault the desktop app let this window open (an absolute path), or an HTTPError 404: what a
 *  format's backend serves for one (HTML's /v/). core/outside.ts. */
export { allowedPath as outsidePath } from "./outside.ts"
/** A safe path in the vault from what a request names, or an HTTPError: 400 for one outside it (`..`) or hidden while
 *  hidden files aren't shown, 404 (`mustExist`) for one that isn't there (core/files.ts's `clean`). */
export { clean as vaultPath } from "./files.ts"
/** The web from the server: a public page, never this machine or the networks it's on (core/web.ts: Canvas's link
 *  previews, the Web clipper). */
/** The files a block shows, from a helper that has no ctx (ctx.source in a block): see core/sources.ts. */
export { source } from "./sources.ts"
export { type Op, type OpCtx, type OpEntry, OpError, type Param, type Schema, type Who, whoOf } from "./ops.ts"
export type { EventFilter, VaultEvent } from "./events.ts"
/** A path as the user says it ("Today", "Alice Park") made a vault path, given GET /api/files (core/ops.ts): for an op's
 *  parameter that may be a path or something else (a tab's id). */
export { pathAsSaid } from "./ops.ts"
export { BROWSER_UA, type Fetched, fetchPublic, type FetchOptions, pageText, publicUrl } from "./web.ts"

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PLUGINS = path.join(ROOT, "plugins")
/** This machine's own files: secrets. Never synced, never in the vault. */
export const LOCAL = process.env.VAULTITE_LOCAL || path.join(ROOT, "data")

/** This server, as commands on this machine reach it (a shell's VAULTITE_URL, an agent's hooks). */
export function serverUrl() {
  const host = !process.env.HOST || ["0.0.0.0", "::"].includes(process.env.HOST) ? "127.0.0.1" : process.env.HOST
  return `http://${host.includes(":") ? `[${host}]` : host}:${process.env.PORT || 8793}`
}
/** A shell command that posts its stdin (a hook's JSON) to `route` here; `more` is appended to the query as the shell
 *  expands it ("&prev=$prev"). Gives up after 2 s and never fails, so a hook never blocks its agent. */
export function hookCommand(route: string, query: Record<string, string>, more = "") {
  const url = `${serverUrl()}/api/${route}?${new URLSearchParams(query)}${more}`
  return `curl -s -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' --data-binary @- "${url}" >/dev/null 2>&1 || true`
}
export const VAULT_PATH = process.env.VAULTITE_VAULT || path.join(ROOT, "data", "vault")

const keys = new Map<string, { key: string; real: string }>()
/** A vault on this machine: its real path and key (that path's hash), under which what's kept here for it goes
 *  (<LOCAL>/<what>/<key>). */
export function vaultHere(vaultPath: string) {
  const hit = keys.get(vaultPath)
  if (hit) return hit
  let real = vaultPath
  try { real = fs.realpathSync(real) } catch { /* not there yet: not kept */ }
  const out = { key: crypto.createHash("sha1").update(real).digest("hex").slice(0, 12), real }
  if (real !== vaultPath || fs.existsSync(real)) keys.set(vaultPath, out)
  return out
}

export class Request {
  method: string
  parts: string[]
  query: Record<string, string>
  body: Item
  wild: string[] = []
  /** A served address's rest (plugin.serve), as it was sent: not decoded, with its query string ("npm/x@1/y.js?z"). */
  rawPath = ""
  /** The HTTP request it came in (its headers, its socket), when it came over HTTP (server.ts); undefined when the
   *  API is called in-process (tests). For a route only this machine's owner may use: plugin.refusal(req.http). */
  http?: IncomingMessage

  constructor(method: string, parts: string[], query: Record<string, string>, body: Item) {
    this.method = method; this.parts = parts; this.query = query; this.body = body
  }

  /** The i-th wildcard segment of the route (already URL-decoded). */
  arg(i: number) {
    return this.wild[i]
  }
}

/** A route's answer sent as it is (text/markdown, or another type; bytes too: a font), not as JSON. `headers`: more
 *  of them (Cache-Control). */
export class Text {
  text: string | Buffer
  type: string
  headers: Record<string, string>
  constructor(text: string | Buffer, type = "text/markdown; charset=utf-8", headers: Record<string, string> = {}) {
    this.text = text; this.type = type; this.headers = headers
  }
}

/** An answer with a status other than 200: `return reply(201, item)`. */
export class Reply {
  status: number
  body: unknown
  constructor(status: number, body: unknown) { this.status = status; this.body = body }
}

export const reply = (status: number, body: unknown) => new Reply(status, body)

export class HTTPError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Awaitable<T> = T | Promise<T>
/** A route's answer: JSON, Text, or a Reply (a status and either). */
export type Answer = unknown
export type Handler = (req: Request) => Awaitable<Answer>
/** What a block's text gets: the file it's in (or the one its `file:` names), its options (the block's YAML, with the
 *  manifest's declared defaults filled in: core/blocks.ts) and today (YYYY-MM-DD). */
export type BlockCtx = { vault: Vault; path: string; fm: Item; body: string; options: Item; today: string
  /** Drawn inside an embed (`![[Note]]`): the note embedding it, the nearest one. A query's `this` is it. */
  host?: string
  /** Name the files it shows (items, or vault paths): "Show source" on the block leads to them (core/sources.ts). */
  source: (...things: unknown[]) => void }
/** A process on this machine: its parent, its terminal's foreground group, when it started (epoch ms), its command line. */
export type Proc = { ppid: number; tpgid: number; started: number; args: string }
let procs: [number, Promise<Map<number, Proc>>] | null = null
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
/** Every process on this machine by pid, from one `ps` shared by every caller of the last `maxAge` ms. */
export function processTable(maxAge = 1000): Promise<Map<number, Proc>> {
  if (procs && Date.now() - procs[0] < maxAge) return procs[1]
  const p = new Promise<Map<number, Proc>>((resolve) => {
    // (LC_ALL=C: procps writes lstart's day and month in the locale's language, which the pattern wouldn't read)
    execFile("ps", ["-Aww", "-o", "pid=,ppid=,tpgid=,lstart=,args="], { timeout: 3000, maxBuffer: 16 << 20, env: { ...process.env, LC_ALL: "C" } }, (_err, out) => {
      const map = new Map<number, Proc>()
      for (const line of String(out ?? "").split("\n")) {
        const m = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+\w{3}\s+(\w{3})\s+(\d+)\s+(\d+):(\d+):(\d+)\s+(\d{4})\s+(.*)$/.exec(line)
        if (!m) continue
        const started = +new Date(Number(m[9]), MONTHS.indexOf(m[4]), Number(m[5]), Number(m[6]), Number(m[7]), Number(m[8]))
        map.set(Number(m[1]), { ppid: Number(m[2]), tpgid: Number(m[3]), started, args: m[10] })
      }
      resolve(map)
    })
  })
  procs = [Date.now(), p]
  return p
}

/** One of the vault's machines, as the Machines plugin's services ("machines", "machines:machine") answer it. */
export type Machine = { id: string; label: string; url: string; online: boolean; self: boolean; plugins?: string[]; vault?: string }
/** How this server says who it is when it asks another machine (Activity shows it). */
export const MACHINE_CLIENT = { "X-Vaultite-Client": `machine/${os.hostname().replace(/\.local$/, "")}` }
/** "claude-k3j2@studio" -> ["claude-k3j2", "studio"]; an id of this machine's -> [id, ""]. */
export const splitMachine = (full: string): [string, string] => {
  const at = full.indexOf("@")
  return at < 0 ? [full, ""] : [full.slice(0, at), full.slice(at + 1)]
}
/** A socket to `path` (under /api/) on machine `m`. */
export function machineSocket(m: Machine, path: string, query: Record<string, string> = {}) {
  const qs = new URLSearchParams(query).toString()
  return new WebSocket(`${m.url.replace(/^http/, "ws")}/api/${path}${qs ? `?${qs}` : ""}`, { headers: MACHINE_CLIENT })
}
const bytes = (data: RawData) => (Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer))
/** A close code a socket may send on (1005, 1006 and 1015 are only ever reported). */
const sendable = (code: number) => (code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1011)
/** Joins `ws` to `up` (another machine's same socket) both ways, as they are: what's sent before it opens waits, its
 *  close comes back; `failed` when it can't be reached. */
export function pipeSockets(ws: WebSocket, up: WebSocket, failed: () => void) {
  const early: [Buffer, boolean][] = []
  ws.on("message", (data: RawData, binary: boolean) => {
    if (up.readyState === up.OPEN) up.send(bytes(data), { binary })
    else if (up.readyState === up.CONNECTING) early.push([bytes(data), binary])
  })
  up.on("open", () => { for (const [buf, binary] of early.splice(0)) up.send(buf, { binary }) })
  up.on("message", (data: RawData, binary: boolean) => { if (ws.readyState === ws.OPEN) ws.send(bytes(data), { binary }) })
  up.on("close", (code, reason) => { if (ws.readyState === ws.OPEN) ws.close(sendable(code), reason.toString().slice(0, 120)) })
  up.on("error", () => { if (ws.readyState === ws.OPEN) failed() })
  ws.on("close", () => { if (up.readyState === up.CONNECTING) up.terminate(); else if (up.readyState === up.OPEN) up.close() })
}
export type TextBlock = (ctx: BlockCtx) => Awaitable<string | null | undefined>
/** A socket's request: the wildcard segments of its pattern (URL-decoded) and the query string. */
export type SocketParams = { wild: string[]; query: Record<string, string> }
/** Runs once the socket is open. `req` is the HTTP upgrade request (headers, remote address). */
export type SocketHandler = (ws: WebSocket, req: IncomingMessage, params: SocketParams) => void
/** Runs before the upgrade: throw an HTTPError to refuse it. */
export type SocketAccept = (req: IncomingMessage, params: SocketParams) => Awaitable<void>
export type Socket = { pattern: string[]; fn: SocketHandler; accept?: SocketAccept }
/** An API request as it starts: `route` is the path under /api/; `client`, `agent`, `command` its X-Vaultite-* headers;
 *  `remote`/`port` the caller's address (a loopback caller can be looked up). */
export type RequestStart = { t: number; method: string; route: string; query: Record<string, string>; client: string | null
  agent: string | null; command: string | null; ua: string; remote: string; port: number; forwarded: boolean }
/** How it ended: its status, how long it took (ms), and the body it was sent (JSON, parsed; undefined for none). */
export type RequestEnd = { status: number; ms: number; body: unknown }
export type RequestHook = (start: RequestStart) => ((end: RequestEnd) => void) | void
export type { ServerError }
/** `lock: false`: not held while it runs. `stream: true`: the route reads `req.http` itself (uploads of any size),
 *  `req.body` is {}, and it's never held either. */
export type RouteOptions = { lock?: boolean; stream?: boolean }
/** An op being run, as plugin.around sees it: `plugin` is the op's (null: the core's). */
export type OpCall = { op: string; kind: OpKind; plugin: string | null; params: Item; who: Who; ctx: OpCtx }
/** Middleware over ops: answer next(params)'s result (changed params are checked again), changed or your own in the
 *  op's shape, or throw OpError to refuse. */
export type Around = (call: OpCall, next: (params?: Item) => Promise<unknown>) => unknown
export type { Job, When } from "./schedule.ts"

/** What the core gives plugins for operations and events (the App sets it for its vault: core/app.ts `host`). */
export type OpsHost = {
  /** The catalog: every op that's on (GET /api/ops). */
  catalog: () => OpEntry[]
  /** Run an op as `who`, holding the vault for a write (as POST /api/ops does). Always pass `http` (req.http) when
   *  there is one, or anyone who reached your route could do what only the owner may. */
  call: (name: string, params: unknown, who?: Who, opts?: { report?: string; http?: IncomingMessage; input?: Readable }) => Promise<{ entry: OpEntry; params: Item; result: unknown; text: string }>
  /** A route of the HTTP API in-process as `who` (held for a write, synced for a read): its body; a 4xx or 5xx throws an
   *  OpError with its message. `report`, `http`: as call's. */
  api: (method: string, route: string, body?: unknown, who?: Who, opts?: { report?: string; http?: IncomingMessage }) => Promise<unknown>
  /** Tell the vault's event bus (core/events.ts). */
  emit: (type: string, data?: Item) => VaultEvent
}
const hosts = new WeakMap<Vault, OpsHost>()
/** The App gives its vault's plugins operations and events (core/app.ts). */
export function hostOps(vault: Vault, host: OpsHost) {
  hosts.set(vault, host)
}

export class Plugin {
  dir: string
  manifest: Item
  id: string
  tier: string
  kinds: Kind[] = []
  routes: [string, string[], Handler, RouteOptions][] = []
  /** Its operations (plugin.op): core/ops.ts. */
  ops: Op[] = []
  sockets: Socket[] = []
  served = new Map<string, Handler>() // prefix -> fn(req): its addresses outside /api/ (plugin.serve)
  stateFn: (() => Awaitable<Item>) | null = null
  foldersFn: (() => string[]) | null = null
  textBlocks = new Map<string, TextBlock>() // block name -> fn(ctx) -> Markdown (core/render.ts)
  /** What it offers plugins that require it: plugin.peer("logs").exports.areaSummary(...) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exports: Record<string, any> = {}
  /** What it offers the core and any plugin by name, without either naming it (plugin.provide; service()). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  services: Record<string, (...args: any[]) => any> = {}
  /** What to undo when it's unloaded (a vault plugin turned off or changed): plugin.onUnload(() => clearInterval(t)). */
  cleanups: (() => void)[] = []
  private _vault: Vault | null = null
  /** Its hooks into the vault (onSync, onMove...): each adds itself to a vault and answers what removes it. */
  private attachers: ((v: Vault) => () => void)[] = []
  /** plugin.onRequest's and plugin.onChange's functions (the core calls them only while the plugin is on). */
  requestFns: RequestHook[] = []
  changeFns: ((paths: string[] | null) => void)[] = []
  /** plugin.onServerError's functions (the core calls them only while the plugin is on). */
  errorFns: ((e: ServerError) => void)[] = []
  /** plugin.onEvent's filters and functions (the core calls them only while the plugin is on). */
  eventFns: [EventFilter, (ev: VaultEvent) => void][] = []
  /** plugin.around's: op ids or areas and their middleware (only while on). */
  arounds: [string[], Around][] = []
  /** plugin.every's jobs (core/schedule.ts; only while on). */
  jobs: Job[] = []
  private memos = new Map<string, [number, Promise<unknown>]>()

  /** `where`: the plugin's import.meta.url (or any file in its folder). */
  constructor(where: string) {
    const file = where.startsWith("file:") ? fileURLToPath(where) : where
    this.dir = fs.statSync(file).isDirectory() ? file : path.dirname(file)
    this.manifest = JSON.parse(readText(path.join(this.dir, "manifest.json")))
    this.id = this.manifest.id
    // core (the app's built-in plugins) or vault (.vaultite/plugins/<id>/ in the vault: core/vaultplugins.ts)
    this.tier = path.basename(path.dirname(path.dirname(this.dir))) === ".vaultite" ? "vault" : "core"
  }

  /** The vault (set by the loader). */
  get vault(): Vault {
    if (!this._vault) throw new Error(`${this.id} isn't loaded yet: plugin.vault exists once the server loads it, so use it in routes, ops and hooks, not as the module loads`)
    return this._vault
  }

  set vault(v: Vault) {
    this._vault = v
    for (const attach of this.attachers) this.cleanups.push(attach(v))
  }

  /** A hook into the vault: added now when it's loaded, else once it is. */
  private attach<F>(fn: F, attach: (v: Vault) => () => void) {
    this.attachers.push(attach)
    if (this._vault) this.cleanups.push(attach(this._vault))
    return fn
  }

  get loaded() {
    return this._vault !== null
  }

  /** Its blocks as manifest.json declares them (core/blocks.ts): name -> description and options. */
  get blocks(): BlockDecls {
    return declsOf(this.manifest)
  }

  // --- registration
  kind(kind: Kind) {
    kind.plugin = this.id
    this.kinds.push(kind)
    return kind
  }

  /** `pattern`: a path under /api/, * one segment, a last ** the rest. `lock: false` for routes that run ops themselves
   *  or wait on something slow (they hold the vault only to write); `stream: true` leaves the body unread (uploads). */
  route(method: string, pattern: string, fn: Handler, options: RouteOptions = {}) {
    this.routes.push([method, pattern.split("/"), fn, options])
    return fn
  }

  /** An operation, served as `POST /api/ops/<id>`, `vau <id>`, MCP and the docs (core/ops.ts). Its id starts with the
   *  plugin's id or a kind it owns. Only while the plugin is on. */
  op(def: Op) {
    this.ops.push(def)
    return def
  }

  /** GET /<prefix>/<rest> outside /api/, for what a browser loads by address (an artifact's sandboxed frame at /v/...).
   *  Only while the plugin is on; the vault isn't synced first and onRequest doesn't hear of it. */
  serve(prefix: string, fn: Handler) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(prefix) || /^(api|assets)$/i.test(prefix)) throw new Error(`${this.id}: can't serve /${prefix}/`)
    this.served.set(prefix, fn)
    return fn
  }

  /** A WebSocket at /api/<pattern>. `opts.accept` runs before the upgrade and refuses it by throwing an HTTPError.
   *  Sockets of a plugin that's off are refused. */
  socket(pattern: string, fn: SocketHandler, opts: { accept?: SocketAccept } = {}) {
    this.sockets.push({ pattern: pattern.split("/"), fn, accept: opts.accept })
    return fn
  }

  /** fn(ctx) -> Markdown: what ```block-<name> shows as text, for AIs (GET /api/render). Every block the app draws has
   *  one (npm run check); ctx.options has the manifest's declared defaults filled in. */
  block(name: string, fn: TextBlock) {
    this.textBlocks.set(name, fn)
    return fn
  }

  /** fn() runs when the plugin is unloaded: a vault plugin turned off, or changed (it's loaded again). Stop timers and
   *  close what it opened here. */
  onUnload(fn: () => void) {
    this.cleanups.push(fn)
    return fn
  }

  /** fn(vault) runs after every sync of the vault (before each request, and when files change on disk: core/live.ts),
   *  to follow the files themselves (File history keeps their earlier versions). Keep it cheap: it runs often. */
  onSync(fn: (vault: Vault) => void) {
    return this.attach(fn, (v) => v.afterSync((vault) => onItsOwn(this.id, () => fn(vault))))
  }

  /** fn(from, to) when the API moves, restores or trashes a file (to: null; `trashed`: where it went), so what the
   *  plugin keeps follows; even while it's off. Moves on disk (Finder, iCloud) aren't heard. */
  onMove(fn: MoveHook) {
    return this.attach(fn, (v) => v.onMove(fn))
  }

  /** fn(path, fm, writer) before the API writes a new Markdown file: the keys it returns are added (the file's own win).
   *  `writer` is who asked (null for no request). Only while on; files written on disk aren't heard. */
  onCreate(fn: CreateHook) {
    return this.attach(fn, (v) => v.onCreate(this.id, fn))
  }

  /** fn(path, file, writer) before the API writes a new file that isn't Markdown (an upload, an SVG): `file` (NewFile)
   *  is read-only and read only as far as asked, as an upload can be any size. Only while on; files written on disk
   *  aren't heard. */
  onCreateFile(fn: FileCreateHook) {
    return this.attach(fn, (v) => v.onCreateFile(this.id, fn))
  }

  /** fn(path, archived) when the API archives or unarchives an item (`archived` set or changed in a write): the folder
   *  its file moves to (links follow, like a move), or null to leave it. Only while on (the Archive plugin's). */
  onArchive(fn: ArchiveHook) {
    return this.attach(fn, (v) => v.onArchive(this.id, fn))
  }

  /** fn(start) as each API request starts; the function it returns runs when it's answered. Keep it cheap and never
   *  throw: it runs for every request. */
  onRequest(fn: RequestHook) {
    this.requestFns.push(fn)
    return fn
  }

  /** fn(paths) runs after files in the vault changed on disk and were read (the app's own writes too: they come back
   *  from the watcher like anyone's), with their vault paths, or null when the watcher couldn't say which. */
  onChange(fn: (paths: string[] | null) => void) {
    this.changeFns.push(fn)
    return fn
  }

  /** fn(error) for each error the server logs, with its request. Runs synchronously and isn't heard again for its own
   *  errors: write what you keep at once, never throw. */
  onServerError(fn: (e: ServerError) => void) {
    this.errorFns.push(fn)
    return fn
  }

  /** fn(event) for each event of the vault matching `filter` (core/events.ts: `types`, a type or an area, "file";
   *  `path`, a vault path prefix), only while the plugin is on. Keep it quick: events come from every write. */
  onEvent(filter: EventFilter, fn: (ev: VaultEvent) => void) {
    this.eventFns.push([filter, fn])
    return fn
  }

  /** fn around every op matching `ops` (an id, an area "note" or "note.*", "*"), the outermost first by plugin order:
   *  rewrite, answer or refuse what agents, the CLI and other plugins ask. The app's own edits are routes, not ops. */
  around(ops: string | string[], fn: Around) {
    this.arounds.push([Array.isArray(ops) ? ops : [ops], fn])
    return fn
  }

  /** fn on a timer, run by the server: `every` "15m", "2h", "1d", "1w"; `at` "07:00" (this machine's time) with whole days;
   *  `machine` a Machines id (else the first listed). Runs once at a time; `vau schedule list` shows it. Called again by
   *  name it's replaced; `when` null removes it (a schedule its settings set). */
  every(name: string, when: When | null, fn: () => unknown = () => {}) {
    const problems = when ? whenProblems(when, `${this.id}: ${name}`) : []
    if (problems.length) throw new Error(problems.join("; "))
    this.jobs = [...this.jobs.filter((j) => j.name !== name), ...(when ? [{ ...when, name, run: fn }] : [])]
    return fn
  }

  /** The core's operations and events, for this plugin's vault (core/app.ts gives them). */
  get host(): OpsHost {
    const h = hosts.get(this.vault)
    if (!h) throw new Error("no app runs operations for this vault")
    return h
  }

  /** Run an op of the catalog (any plugin's, by id or CLI name) as `who` (else the request's), for the request `http`
   *  (req.http: pass it, so owner checks apply): plugin.host.call. */
  runOp(name: string, params: unknown = {}, who?: Who, http?: IncomingMessage) {
    return this.host.call(name, params, who, { http })
  }

  /** Tell the vault's events something happened: its type is `<plugin id>.<name>` ("finance.imported"). */
  emit(type: string, data: Item = {}) {
    if (!type.startsWith(`${this.id}.`)) throw new Error(`${this.id}'s events are named ${this.id}.<name>, not '${type}'`)
    return this.host.emit(type, data)
  }

  /** fn() -> a record merged into /api/state. Default: each of the plugin's kinds as {collection: items}. */
  state(fn: () => Awaitable<Item>) {
    this.stateFn = fn
    return fn
  }

  /** fn() -> the folders on this machine its live data is read from (absolute): a block's menu offers to open them
   *  (POST /api/file/open opens these and nothing else outside the vault). */
  folders(fn: () => string[]) {
    this.foldersFn = fn
  }

  /** Its folders that are there now. */
  liveFolders(): string[] {
    let all: string[] = []
    try { all = this.foldersFn?.() ?? [] } catch { /* none */ }
    return all.filter((d) => path.isAbsolute(d) && fs.existsSync(d))
  }

  async getState(): Promise<Item> {
    if (this.stateFn) return await this.stateFn()
    return Object.fromEntries(this.kinds.map((k) => [k.collection, this.vault.items(k.collection)]))
  }

  /** Offer `fn` as the service `name` (People: plugin.provide("geocode", geocode), which Me uses for ME.md's place);
   *  whoever needs one asks for it by name with service(plugins, name), never by the plugin's id. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provide<F extends (...args: any[]) => any>(name: string, fn: F) {
    this.services[name] = fn
    return fn
  }

  // --- what a plugin may use
  /** This plugin's settings, .vaultite/plugins/<id>/data.json (another's: plugin.peer(id)?.settings()). `file`: another
   *  file of its own, for parts written often, so devices changing different parts never write the same file. */
  settings(fallback?: Item, file = "data"): Item {
    return this.vault.config(this.settingsName(file), fallback)
  }

  /** This plugin's settings with the defaults another app's settings give them under its own (Vault.configWithDefaults):
   *  what applies; never saved back (settings() is what's written). */
  seeded(file = "data"): Item {
    return this.vault.configWithDefaults(this.settingsName(file))
  }

  /** The settings as they are on disk now, for a read-modify-write: null when there's none; throws ConfigError (from
   *  core/vault.ts) when the file is there but can't be read or doesn't parse, which settings() would take for empty. */
  readSettings(file = "data"): Item | null {
    return this.vault.readConfig(this.settingsName(file))
  }

  /** Write the settings (null removes the file). */
  saveSettings(data: Item | null, file = "data") {
    if (data === null) this.vault.removeConfig(this.settingsName(file))
    else this.vault.setConfig(this.settingsName(file), data)
  }

  private settingsName(file: string) {
    if (!/^[\w-]+$/.test(file)) throw new Error(`a settings file is a name of letters, digits, - and _, not '${file}'`)
    return `plugins/${this.id}/${file}`
  }

  /** Its folder on this machine for this vault, <LOCAL>/<id>/<vault key>/ (disposable, never synced): made unless `make`
   *  is false, with vault.txt naming the vault. */
  localDir(make = true) {
    const { key, real } = vaultHere(this.vault.path)
    const d = path.join(LOCAL, this.id, key)
    if (make && !fs.existsSync(path.join(d, "vault.txt"))) {
      fs.mkdirSync(d, { recursive: true })
      try { fs.writeFileSync(path.join(d, "vault.txt"), real + "\n") } catch { /* read-only: fine */ }
    }
    return d
  }

  /** .vaultite/cache/<id>.json in the vault (the vault's folder when run on its own, like the GitHub refresh). */
  cachePath() {
    return path.join(this._vault ? this._vault.path : VAULT_PATH, ".vaultite", "cache", `${this.id}.json`)
  }

  readCache(fallback: Item | null = null): Item | null {
    noteSource("caches", this.id)
    try { return JSON.parse(readText(this.cachePath())) } catch { return fallback }
  }

  writeCache(data: unknown) {
    writeAtomic(this.cachePath(), JSON.stringify(data))
  }

  /** This machine's data/config.json (private URLs, keys). Never copy these into the vault. */
  secrets(): Item {
    try {
      return JSON.parse(readText(path.join(LOCAL, "config.json")))
    } catch {
      return {}
    }
  }

  /** Sets this plugin's own key in data/config.json (`secrets()[plugin.id]`; null removes it), the rest as it is. The
   *  file is readable by this machine's user only. */
  saveSecrets(data: Item | null) {
    const file = path.join(LOCAL, "config.json")
    let all: Item = {}
    try { all = JSON.parse(readText(file)) } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("data/config.json doesn't parse: not changed")
    }
    if (data === null) delete all[this.id]; else all[this.id] = data
    writeAtomic(file, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 })
  }

  /** Why this request may not have what only this machine's owner may (a shell, the screen), or "" (core/owner.ts). Reads the
   *  plugin's `allowUsers` and `allowRemote` settings. */
  async refusal(req: IncomingMessage, what = this.manifest.name as string): Promise<string> {
    const set = this.settings({})
    const allowRemote = set.allowRemote === true
    const needsOwner = typeof req.headers["tailscale-user-login"] === "string" && !allowRemote
    return refusal(req, { allowRemote, allowUsers: Array.isArray(set.allowUsers) ? set.allowUsers : [],
      owner: needsOwner ? await ownerLogin() : "" }, what)
  }

  /** Whether this machine's owner said yes to `what` (a command a vault setting names: a synced or shared vault mustn't
   *  choose what runs here). Kept on this machine, never in the vault (core/trust.ts). */
  allows(what: string) {
    return trustOf(this.vault.path).allows(this.id, what)
  }

  /** Remember this machine's owner said yes to `what` (only after asking them: plugin.refusal). */
  allow(what: string) {
    trustOf(this.vault.path).allow(this.id, what)
  }

  /** fn(...args), remembered in memory for ttl seconds (live data: fetched again when it's stale). A failure isn't. */
  memo<A extends unknown[], T>(ttl: number, fn: (...args: A) => Awaitable<T>, ...args: A): Promise<T> {
    noteSource("live", this.id)
    const key = fn.name + "\0" + JSON.stringify(args)
    const hit = this.memos.get(key)
    if (hit && Date.now() / 1000 - hit[0] < ttl) return hit[1] as Promise<T>
    const val = Promise.resolve().then(() => fn(...args))
    this.memos.set(key, [Date.now() / 1000, val])
    val.catch(() => { if (this.memos.get(key)?.[1] === val) this.memos.delete(key) })
    return val
  }

  /** Forget everything memo() remembers. */
  forget() {
    this.memos.clear()
  }

  /** A small edit of one line of a vault file: line `n` (from 0, the whole file's, frontmatter too) from `was` to `now`
   *  (a list: several lines in its place; null: removed). 409 when that line isn't `was` any more (edited meanwhile). */
  editLine(rel: string, n: number, was: string, now: string | string[] | null) {
    const abs = this.vault.abs(rel)
    let text: string
    // (readText waits out iCloud's download; then the file as it is, CRLF kept)
    try { readText(abs); text = fs.readFileSync(abs, "utf8") } catch { throw new HTTPError(404, `no file '${rel}' to read now`) }
    const eol = text.includes("\r\n") ? "\r\n" : "\n", lines = text.split(/\r?\n/)
    if (!Number.isInteger(n) || n < 0 || n >= lines.length || lines[n] !== was) throw new HTTPError(409, `line ${n + 1} of ${rel} changed since it was read`)
    lines.splice(n, 1, ...(now === null ? [] : Array.isArray(now) ? now : [now]))
    writeAtomic(abs, lines.join(eol))
  }

  /** Another loaded plugin (one this plugin requires), to use what it offers: logs.exports.areaSummary(...), or its
   *  settings: plugin.peer("templates")?.settings(). */
  peer(id: string) {
    return LOADED.find((p) => p.id === id) ?? null
  }

  /** The vault's property types (propertyTypes, below). */
  propertyTypes(): PropTypes {
    return propertyTypes(this.vault, LOADED)
  }

  /** Whether this plugin is switched off in plugins.json (Vault.switchedOff: `disabled`, or `offByDefault` and not
   *  turned on): its routes still answer, so one that mustn't checks. */
  isOff() {
    return this.vault.switchedOff().has(this.id)
  }

  /** The service `name` of a plugin that's on (plugin.provide), or null: what this plugin asks of others without
   *  naming them (Terminal runs a coding agent through "agent:<name>", whoever brings it). */
  service(name: string) {
    const skip = this.loaded ? this.vault.switchedOff() : new Set<string>()
    return service(LOADED.filter((p) => !skip.has(p.id)), name)
  }
  /** The service `name`'s answer (`args` passed), or `fallback` when no plugin that's on provides it or it fails. */
  async ask<T>(name: string, fallback: T, ...args: unknown[]): Promise<T> {
    const fn = this.service(name)
    if (typeof fn !== "function") return fallback
    try { return (await fn(...args)) ?? fallback } catch { return fallback }
  }

  /** Its docs (core/docs.ts): its AGENTS.md, then settings, blocks and operations generated from the manifest and ops,
   *  so what AIs read is what the app checks. null when it has none. */
  docs(): { text: string } | null {
    const p = path.join(this.dir, "AGENTS.md")
    const own = (fs.existsSync(p) ? readText(p) : "").replace(/\n{3,}/g, "\n\n").trim()
    const extra = [settingsDoc(this.id, settingsOf(this.manifest)), blocksDoc(this.blocks), pluginOpsDoc(this.ops.map((o) => entryOf(o, this.id)))].filter(Boolean)
    if (!own && !extra.length) return null
    return { text: [own || `## ${this.manifest.name ?? this.id}`, ...extra].join("\n\n") }
  }
}

// --- helpers for blocks as text (plugin.block): plain Markdown, the way the app words things

/** 90 -> "1 h 30 min". */
export function fmtMin(m: unknown) {
  const n = Math.trunc(Number(m) || 0)
  const h = Math.floor(n / 60), r = ((n % 60) + 60) % 60
  return n >= 60 && r ? `${h} h ${r} min` : n >= 60 ? `${h} h` : `${n} min`
}

const day = (date: string) => new Date(date.slice(0, 10) + "T00:00:00Z")
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** The Monday of a YYYY-MM-DD's week. */
export function weekStart(date: string) {
  const d = day(date)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return iso(d)
}

export function addDays(date: string, n: number) {
  const d = day(date)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

/** Days from a to b (YYYY-MM-DD). */
export function daysBetween(a: string, b: string) {
  return Math.round((+day(b) - +day(a)) / 86400000)
}

const pad2 = (n: number) => String(n).padStart(2, "0")
/** A time (a Date or epoch ms) as this machine's date, YYYY-MM-DD, and its time, HH:MM. */
export const localDate = (t: Date | number) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
export const localTime = (t: Date | number) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }

/** Today on this machine, YYYY-MM-DD. */
export const today = () => localDate(new Date())

/** A Markdown list, or a line saying there's nothing. */
export function bullets(rows: Iterable<unknown>, empty = "Nothing yet.") {
  const rs = [...rows].filter((r) => r !== null && r !== undefined && r !== false && r !== "" && r !== 0)
  return rs.length ? rs.map((r) => `- ${r}`).join("\n") : `_${empty}_`
}

/** ## Title, then the parts (blank ones left out). */
export function section(title: string, ...parts: unknown[]) {
  return [`## ${title}`, ...parts.filter((p) => typeof p === "string" && p)].join("\n\n")
}

/** Every built-in plugin folder (plugins/core/): [tier, id, dir], by name. */
export function discover(): [string, string, string][] {
  const base = path.join(PLUGINS, "core")
  return fs.readdirSync(base).sort().map((name) => path.join(base, name))
    .filter((d) => fs.existsSync(path.join(d, "manifest.json"))).map((d) => ["core", path.basename(d), d])
}

export const LOADED: Plugin[] = [] // every plugin, once load() ran

/** Import every plugin.ts and register its kinds, in discover() order (manifest-only plugins too, for their AGENTS.md).
 *  The event loop turns between them, so a starting server still answers its web app's files. */
export async function load(vault: Vault): Promise<Plugin[]> {
  const plugins: Plugin[] = []
  for (const [, , d] of discover()) {
    await turn()
    const file = path.join(d, "plugin.ts")
    // (one that fails to load is left out, said in the log, not the server kept from starting)
    try {
      // (loaded as the plugin acting on its own: the timers it starts as it loads keep that: core/writegate.ts)
      const p: Plugin = fs.existsSync(file) ? (await onItsOwn(path.basename(d), () => import(pathToFileURL(file).href))).plugin : new Plugin(path.join(d, "manifest.json"))
      if (!(p instanceof Plugin)) throw new Error("plugin.ts exports no plugin")
      p.vault = vault
      for (const k of p.kinds) vault.register(k)
      plugins.push(p)
    } catch (e) { console.error(`plugin ${path.basename(d)} couldn't load:`, e) }
  }
  vault.optIn = new Set(plugins.filter((p) => p.manifest.offByDefault === true).map((p) => p.id))
  LOADED.splice(0, LOADED.length, ...plugins)
  return plugins
}

/** Ids of the plugins that are on (not switched off, `offByDefault` ones turned on, and everything they require on). */
export function enabled(vault: Vault, plugins: Plugin[]) {
  const off = vault.switchedOff()
  const by = new Map(plugins.map((p) => [p.id, p]))
  const on = (pid: string, seen: string[] = []): boolean => {
    const p = by.get(pid)
    return !!p && !off.has(pid) && !seen.includes(pid) && ((p.manifest.requires ?? []) as string[]).every((r) => on(r, [...seen, pid]))
  }
  return new Set(plugins.filter((p) => on(p.id)).map((p) => p.id))
}

/** What each plugin that's on tells agents up front, its manifest's `forAgents` (a `{key}` in it is that setting's
 *  value): composed into the vault's rules (Agent files), MCP's instructions and a terminal agent's context. */
export function agentLines(vault: Vault, plugins: Plugin[] = LOADED): { plugin: string; text: string }[] {
  const on = enabled(vault, plugins)
  return plugins.filter((p) => on.has(p.id) && typeof p.manifest.forAgents === "string" && p.manifest.forAgents.trim()).map((p) => {
    const decls = settingsOf(p.manifest), mine = p.settings()
    const text = String(p.manifest.forAgents).trim().replace(/\{(\w+)\}/g, (all, k: string) => {
      const v = Object.hasOwn(mine, k) && mine[k] !== null && mine[k] !== "" ? mine[k] : decls[k]?.default
      return v === undefined || v === null ? all : String(v)
    })
    return { plugin: p.id, text }
  })
}

/** The vault's property types: another app's (the service `property-types` of a plugin that's on), with
 *  `.vaultite/types.json`'s over them (`own`: false leaves those out). An undeclared key is its value's type. */
export function propertyTypes(vault: Vault, plugins: Plugin[] = LOADED, own = true): PropTypes {
  const on = enabled(vault, plugins)
  const other = service(plugins.filter((p) => on.has(p.id)), "property-types")
  return { ...readTypes(typeof other === "function" ? { types: other() } : null), ...(own ? readTypes(vault.config("types")) : {}) }
}

/** The defaults other apps' settings give the vault's settings files, by file ("files", "plugins/<id>/data"): each plugin
 *  that's on answers `setting-defaults` (Vaults from other apps: .obsidian/); the first to set a key wins. */
export function settingDefaults(vault: Vault, plugins: Plugin[] = LOADED): Record<string, Item> {
  const on = enabled(vault, plugins), out: Record<string, Item> = {}
  for (const p of plugins) {
    const fn = on.has(p.id) && Object.hasOwn(p.services, "setting-defaults") ? p.services["setting-defaults"] : null
    if (typeof fn !== "function") continue
    const got = fn()
    if (got && typeof got === "object") for (const [name, keys] of Object.entries(got as Record<string, Item>)) out[name] = { ...keys, ...out[name] }
  }
  return out
}

/** The first plugin's service called `name` (plugin.provide), or null when no plugin offers it. */
export function service(plugins: Plugin[], name: string) {
  return plugins.find((p) => Object.hasOwn(p.services, name))?.services[name] ?? null
}

/** The service `<kind>:<ext>` a plugin offers for a file by its extension (a double one first: "excalidraw.md"), or
 *  null. `plugins`: the ones that are on. */
export function serviceFor(plugins: Plugin[], kind: string, rel: string) {
  const exts = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase().split(".").slice(1)
  for (let i = 0; i < exts.length; i++) {
    const fn = service(plugins, `${kind}:${exts.slice(i).join(".")}`)
    if (fn) return fn
  }
  return null
}

/** The wildcard values of `parts` for a pattern, or null when it doesn't match: "*" is one segment, a last "**" the
 *  rest (one segment or more, joined with "/"). */
function wildcards(pat: string[], parts: string[]): string[] | null {
  const rest = pat[pat.length - 1] === "**"
  if (rest ? parts.length < pat.length : parts.length !== pat.length) return null
  const out: string[] = []
  for (let i = 0; i < pat.length; i++) {
    if (rest && i === pat.length - 1) { out.push(parts.slice(i).join("/")); break }
    if (pat[i] === "*") out.push(parts[i])
    else if (pat[i] !== parts[i]) return null
  }
  return out
}

/** The handler for a request path (parts under /api/), the wildcard values and the route's options. */
export function match(plugins: Plugin[], method: string, parts: string[]): [Handler, string[], RouteOptions] | null {
  for (const p of plugins) {
    for (const [m, pat, fn, options] of p.routes) {
      const wild = m === method ? wildcards(pat, parts) : null
      if (wild) return [fn, wild, options]
    }
  }
  return null
}

/** The plugin serving an address outside /api/ (plugin.serve) by its first segment, among `plugins` (the ones on). */
export function matchServed(plugins: Plugin[], prefix: string): Handler | null {
  for (const p of plugins) { const fn = p.served.get(prefix); if (fn) return fn }
  return null
}

/** The plugin and socket for a WebSocket request path (parts under /api/), and the wildcard values. */
export function matchSocket(plugins: Plugin[], parts: string[]): [Plugin, Socket, string[]] | null {
  for (const p of plugins) {
    for (const s of p.sockets) {
      const wild = wildcards(s.pattern, parts)
      if (wild) return [p, s, wild]
    }
  }
  return null
}
