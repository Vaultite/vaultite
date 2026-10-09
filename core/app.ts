// The app without the HTTP: the vault, the plugins, and the API as one function (run), so the backend test can call it
// directly. Routes are in `run` below and each plugin's plugin.ts; `vau docs api` lists them for agents.
import { AsyncLocalStorage } from "node:async_hooks"
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import type { Readable } from "node:stream"
import path from "node:path"
import { setImmediate as turn } from "node:timers/promises"
import * as Look from "./appearance.ts"
import * as B from "./bundles.ts"
import { ownerLogin, refusal as ownerRefusal } from "./owner.ts"
import { MARKER as SANDBOX_MARKER } from "./sandbox.ts"
import * as F from "./files.ts"
import * as O from "./outside.ts"
import * as pages from "./pages.ts"
import { setUpNew } from "./start.ts"
import type { ServerError } from "./serverlog.ts"
import { enabled, hostOps, HTTPError, LOADED, LOCAL, load as loadPlugins, vaultHere, match, matchServed, type Plugin, propertyTypes, Reply, reply, type RequestEnd, type RequestStart, Request, service, Text } from "./plugins.ts"
import { readTypes } from "./proptypes.ts"
import { blockOn, blockSources, render } from "./render.ts"
import { COMMON } from "./blocks.ts"
import { topic, topics } from "./docs.ts"
import * as SP from "./statepatch.ts"
import { coreOps } from "./coreops.ts"
import { SETTINGS } from "./coreops/settings.ts"
import { checkParams, entryOf, jsonBlock, nearest, type Op, type OpCtx, OpError, opsDoc, pathAsSaid, type Who, whoOf } from "./ops.ts"
import { eventOps, eventsOf, matching, summary, typeMatches, type VaultEvent } from "./events.ts"
import { ARCHIVED, setMarks } from "./fileprops.ts"
import { hookOps } from "./hooks.ts"
import { type Listed, Scheduler, scheduleOps } from "./schedule.ts"
import { VaultPlugins } from "./vaultplugins.ts"
import { readLock } from "./installs.ts"
import { PluginIndex } from "./pluginindex.ts"
import { API_VERSION, APP_VERSION } from "./version.ts"
import { ConfigError, ConflictError, type Item, type Kind, NotFound, publicOf, requestWriter, Vault } from "./vault.ts"

/** How many recent states the server keeps as pieces (a device that last loaded before them gets the whole state).
 *  Pieces that stayed the same are shared, so each one past the first costs little more than what changed. */
const KEEP = 32

/** A state as the app was given it: its version, and its pieces (core/statepatch.ts). */
type Snap = { v: string; state: Item; piece: SP.Piece; json?: string; patches: Map<string, string> }


export class App {
  vault: Vault
  plugins: Plugin[] = [] // the app's plugins, then the vault's that are loaded
  app: Plugin[] = [] // the app's own (plugins/ in the repo)
  vaultPlugins!: VaultPlugins
  /** The plugin directory's index and blocklist (core/pluginindex.ts). */
  index: PluginIndex
  private stated: { version: string; plugins: Plugin[]; state: Item } | null = null // the last state() and what it was of
  private snaps: Snap[] = [] // the last states the app was given, oldest first
  private boot = Date.now().toString(36)
  private seq = 0
  private pagesOf = "" // the plugins that were on when their pages were last installed (onKey)
  /** The user's open window, driven from outside (server.ts sets it: POST /api/ui's handler, core/live.ts). */
  ui: ((message: Item | null) => unknown) | null = null
  private core: Op[] | null = null
  /** Set while a call holds the vault, so an op it runs runs at once instead of waiting on itself. Turned off when the
   *  hold ends, so work that outlives it (a job) takes the vault again. */
  private holding = new AsyncLocalStorage<{ on: boolean }>()
  /** Plugins' jobs on a timer (core/schedule.ts); server.ts starts it. */
  scheduler: Scheduler
  private self: [number, Promise<string | null>] | null = null // this machine's Machines id, asked at most every 5 min

  constructor(vaultPath: string) {
    this.vault = new Vault(vaultPath)
    this.index = new PluginIndex(this.vault)
    this.scheduler = new Scheduler({
      file: path.join(LOCAL, "schedules", `${vaultHere(vaultPath).key}.json`),
      jobs: () => {
        const on = enabled(this.vault, this.plugins)
        // The core's own: .trash emptied of what's been there 30 days (one machine does it, so iCloud sees each delete once).
        return [{ plugin: "core", job: { name: "trash", every: "1d", run: () => F.emptyTrash(this.vault) } },
          ...this.plugins.filter((p) => on.has(p.id)).flatMap((p): Listed[] => p.jobs.map((job) => ({ plugin: p.id, job })))]
      },
      here: (machine) => this.runsHere(machine),
      before: () => this.syncPlugins(),
    })
  }

  /** Whether this machine runs a job naming `machine` (else Machines' first). Without Machines, only one naming none. */
  private async runsHere(machine?: string) {
    const ids = (service(this.on(), "machines:ids")?.() ?? []) as string[]
    if (!ids.length) return !machine
    if (!this.self || Date.now() - this.self[0] > 300_000) {
      const ask = service(this.on(), "machines:self")
      this.self = [Date.now(), Promise.resolve(ask ? ask() : null).catch(() => null)]
    }
    return (await this.self[1]) === (machine ?? ids[0])
  }

  /** Load the plugins (they register the kinds: the core owns none). */
  async init() {
    this.app = await loadPlugins(this.vault)
    this.plugins = this.app
    // Templates' notes are patterns, not people or logs, whatever their `type` (Vault.kindFor).
    this.vault.plain = () => { const f = service(this.plugins, "templates:folder")?.(); return typeof f === "string" && f ? [f] : [] }
    this.vaultPlugins = new VaultPlugins(this.vault, this.app)
    // A version the directory blocks doesn't load: matched by the repo it was installed from, its manifest's, or its id.
    this.vaultPlugins.blocked = (vp) => this.index.blockedWhy(vp.id, typeof vp.manifest.version === "string" ? vp.manifest.version : null,
      [readLock(this.vault)[vp.id]?.repo, typeof vp.manifest.repo === "string" ? vp.manifest.repo : null])
    this.wire()
    await this.syncPlugins(false)
    this.pagesOf = this.onKey()
    // (asked only of a vault with plugins installed from the directory: one day old, the blocklist is fetched again)
    if (Object.keys(readLock(this.vault)).length) this.index.refreshIfStale()
    return this
  }

  /** Load, reload or unload the vault's own plugins. Runs before every request and before the files are read, so a
   *  plugin's kinds apply to them; `refresh`: their dashboards follow. */
  async syncPlugins(refresh = true) {
    const changed = await this.vaultPlugins.sync()
    if (changed) {
      this.plugins = [...this.app, ...this.vaultPlugins.loaded()]
      LOADED.splice(0, LOADED.length, ...this.plugins)
    }
    setMarks(this.plugins.map((p) => p.manifest))
    // Only the pages of plugins that are on are installed (core/pages.ts): one turned on brings its pages now.
    if (refresh && (changed || this.pagesOf !== this.onKey())) this.installPages()
    return changed
  }

  /** Which plugins are on, as one string (what installPages was last run for); "offering" while a new vault is being
   *  offered the bundles. */
  private onKey() {
    return B.offering(this.vault) ? "offering" : [...enabled(this.vault, this.plugins)].sort().join(",")
  }

  /** GET /api/blocks: every plugin's blocks as declared in its manifest, with whether it's on and has a text side (an
   *  undeclared block with a text side too: `declared: false`). */
  blocks() {
    const on = enabled(this.vault, this.plugins)
    const loaded = new Map(this.plugins.map((p) => [p.id, p]))
    const rows: Item[] = []
    const add = (id: string, name: string, tier: string, decls: Item, texts: Set<string> | null) => {
      for (const [block, d] of Object.entries(decls)) {
        rows.push({ name: block, plugin: id, pluginName: name, tier, on: on.has(id), declared: true, text: texts ? texts.has(block) : null,
          description: d.description ?? "", options: d.options ?? {} })
      }
      for (const block of texts ?? []) {
        if (!Object.hasOwn(decls, block)) rows.push({ name: block, plugin: id, pluginName: name, tier, on: on.has(id), declared: false, text: true, description: "", options: {} })
      }
    }
    for (const p of this.app) add(p.id, String(p.manifest.name ?? p.id), p.tier, p.blocks, new Set(p.textBlocks.keys()))
    for (const v of this.vaultPlugins.list()) {
      const p = loaded.get(v.id as string)
      add(v.id as string, v.name as string, "vault", v.blocks as Item, p ? new Set(p.textBlocks.keys()) : null)
    }
    return { common: COMMON, blocks: rows }
  }

  installPages() {
    const key = this.onKey(), picked = this.pagesOf === "offering"
    this.pagesOf = key
    // A new vault picking its setup gets the pages of the plugins it ends up with, not of every plugin on by default.
    if (key === "offering") return []
    // Just after it picked a bundle (which pinned its own pages; skipping picks Minimal) the rest aren't pinned; with no
    // pins yet, all of them are.
    return pages.install(this.vault, this.plugins, { pin: !(picked && fs.existsSync(this.vault.abs(".vaultite/pages.json"))) })
  }

  /** Everything the web app shows, worked out again only when the vault, its settings or its plugins changed, frozen
   *  meanwhile. A vault plugin's plugin.state may read anything, so then it's worked out each time. */
  async state() {
    // (what this machine allowed and the directory blocks change what's listed, not the vault)
    const version = `${this.vault.version}:${this.vault.settingsVersion}:${this.vaultPlugins.trust.version}:${this.index.version}`, plugins = this.plugins
    const same = this.stated && this.stated.version === version && this.stated.plugins === plugins &&
      !this.vaultPlugins.loaded().some((p) => p.stateFn)
    if (same) return this.stated!.state
    const out: Item = {}
    for (const p of this.plugins) Object.assign(out, await p.getState())
    // sandbox: a vault core/sandbox.ts made (made afresh each time it opens): the app says changes there don't last.
    out.vault = { path: this.vault.path, problems: this.vault.problemList(), downloading: this.vault.downloading, ...(fs.existsSync(this.vault.abs(SANDBOX_MARKER)) ? { sandbox: true } : {}) }
    out.files = F.tree(this.vault)
    out.vaultPlugins = this.vaultPlugins.list()
    out.app = { version: APP_VERSION, api: API_VERSION }
    out.config = Object.fromEntries(SETTINGS.map((n) => [n, this.vault.config(n)]))
    // Property types (core/proptypes.ts): every declared one, and which of them .vaultite/types.json declares.
    out.propertyTypes = { types: propertyTypes(this.vault, this.plugins), own: Object.keys(readTypes(this.vault.config("types"))) }
    // What the app draws or keeps itself in a kind's files (KindSpec sections and stamps), by collection.
    out.kinds = Object.fromEntries(this.vault.kinds.filter((k) => k.spec.sections?.length || k.spec.stamps?.length)
      .map((k) => [k.collection, { sections: k.spec.sections ?? [], stamps: k.spec.stamps ?? [] }]))
    out.appearance = { themes: Look.listThemes(this.vault), snippets: Look.listSnippets(this.vault) }
    out.pluginSettings = settingsFiles(this.vault.path)
    out.bundles = B.status(this.vault) // the setup a bundle replaced (to restore), and a new vault's offer
    this.stated = { version, plugins, state: Object.freeze(out) }
    return out
  }

  /** GET /api/state?since=<v>: the state as a patch of state v (the one the app has), when it's still kept; else whole.
   *  The answer is JSON made from the pieces, so nothing is serialized twice. */
  async stateSince(since: string) {
    const now = this.snap(await this.state())
    const v = JSON.stringify(now.v)
    let out: string
    if (since === now.v) out = `{"v":${v},"since":${v},"patch":null}`
    else if (this.snaps.some((s) => s.v === since)) {
      let patch = now.patches.get(since)
      if (patch === undefined) now.patches.set(since, patch = SP.patchOf(this.snaps.find((s) => s.v === since)!.piece, now.piece) ?? "null")
      out = `{"v":${v},"since":${JSON.stringify(since)},"patch":${patch}}`
    } else out = `{"v":${v},"state":${now.json ??= SP.jsonOf(now.piece)}}`
    return new Text(out, "application/json")
  }

  /** The state as pieces, with its version: the last one again while the state is the same (the same object, or one
   *  made again with nothing different in it: a settings file no plugin shows changed). */
  private snap(state: Item): Snap {
    const last = this.snaps.at(-1)
    if (last?.state === state) return last
    const piece = SP.snapshot(publicOf(state), last?.piece)
    const patch = last ? SP.patchOf(last.piece, piece) : null
    if (last && patch === null) { last.state = state; return last }
    const snap: Snap = { v: `${this.boot}.${++this.seq}`, state, piece, patches: new Map() }
    if (last) {
      snap.patches.set(last.v, patch!)
      last.json = undefined
      last.patches.clear()
    }
    this.snaps.push(snap)
    if (this.snaps.length > KEEP) this.snaps.shift()
    return snap
  }

  /** What bundles (core/bundles.ts) work with: the vault, the plugins, and this API for their edits (a request made
   *  from inside one that holds the vault: it doesn't take the lock again). */
  host(http?: IncomingMessage): B.Host {
    return {
      vault: this.vault,
      plugins: () => this.plugins,
      vaultPlugins: () => this.vaultPlugins.list(),
      call: async (method, route, body) => {
        const { parts, query } = routeOf(route)
        const res = await this.run(method, parts, query, body ?? {})
        if (res.status >= 400) throw new HTTPError(res.status, String((res.body as Item)?.error ?? res.status))
        return res.body
      },
      syncPlugins: () => this.syncPlugins(),
      allow: async (ids) => {
        if (http && await this.ownerWhy(http, "allowing vault plugins")) return
        for (const id of ids) {
          if (fs.existsSync(this.vault.abs(`.vaultite/plugins/${id}/manifest.json`))) this.vaultPlugins.allow(id)
        }
      },
    }
  }

  /** The plugins that are on (not switched off in plugins.json: Vault.switchedOff). */
  private on() {
    const off = this.vault.switchedOff()
    return off.size ? this.plugins.filter((p) => !off.has(p.id)) : this.plugins
  }

  private pluginsStamp = -1 // plugins.json's mtime when requestStarted last read it

  /** A request starts: plugin.onRequest hooks hear of it; the function returned tells them how it ended. Never throws.
   *  It runs before the sync, so plugins.json is stat'ed here: a plugin turned on just before hears this one. */
  requestStarted(start: RequestStart): (end: RequestEnd) => void {
    let stamp = 0
    try { stamp = fs.statSync(this.vault.abs(".vaultite/plugins.json")).mtimeMs } catch { /* none: all on */ }
    if (stamp !== this.pluginsStamp) { this.pluginsStamp = stamp; this.vault.forgetConfig("plugins") }
    const ends: ((end: RequestEnd) => void)[] = []
    for (const p of this.on()) {
      for (const fn of p.requestFns) {
        try { const end = fn(start); if (end) ends.push(end) } catch (e) { console.error(e) }
      }
    }
    return (end) => { for (const fn of ends) { try { fn(end) } catch (e) { console.error(e) } } }
  }

  /** The server logged an error (core/serverlog.ts): plugins that record them (plugin.onServerError) hear it. */
  serverError(e: ServerError) {
    for (const p of this.on()) for (const fn of p.errorFns) { try { fn(e) } catch { /* not logged: it would come back here */ } }
  }

  /** Files changed on disk (core/live.ts, after reading them): plugins that follow them (plugin.onChange) hear which. */
  changed(paths: string[] | null) {
    for (const p of this.on()) for (const fn of p.changeFns) { try { fn(paths) } catch (e) { console.error(e) } }
  }

  /** GET /<prefix>/<rest> outside /api/, when a plugin that's on serves that prefix (plugin.serve: HTML's /v/ and
   *  /cdn/), else null. `rest` decoded, `raw` as sent with its query string. Never throws: errors are answers too. */
  async serve(prefix: string, rest: string, raw: string, query: Record<string, string>): Promise<Reply | null> {
    const on = enabled(this.vault, this.plugins)
    const fn = matchServed(this.plugins.filter((p) => on.has(p.id)), prefix)
    if (!fn) return null
    const req = new Request("GET", [prefix, ...rest.split("/")], query, {})
    req.wild = [rest]
    req.rawPath = raw
    try {
      return asReply(await fn(req))
    } catch (e) {
      if (e instanceof HTTPError) return reply(e.status, new Text(e.message, "text/plain; charset=utf-8"))
      console.error(e)
      return reply(500, new Text(String((e as Error).message ?? e), "text/plain; charset=utf-8"))
    }
  }

  /** Whether a request goes to a plugin route that asked not to have the vault held for it (`lock: false`:
   *  plugin.route): server.ts then syncs the vault first, as for a read, and runs it without holding the vault. */
  unlocked(method: string, parts: string[]) {
    // An op holds the vault itself, only for a write (callOp), so an op that waits (events.wait) holds nothing.
    if (method === "POST" && parts.length === 2 && parts[0] === "ops") return true
    if (this.streams(method, parts)) return true
    return match(this.plugins, method, parts)?.[2].lock === false
  }

  /** Does this route read its request's body itself (an upload: the core's, plugin.route's `stream: true`, or an op
   *  that takes bytes, sent as they are: `type`, the body's Content-Type, isn't JSON)? */
  streams(method: string, parts: string[], type = "") {
    if (method === "POST" && parts.length === 1 && parts[0] === "upload") return true
    if (method === "POST" && parts.length === 2 && parts[0] === "ops") return !!type && !/json/i.test(type) && !!this.opNamed(parts[1])?.op.input
    return match(this.plugins, method, parts)?.[2].stream === true
  }

  /** One API request (parts: the path under /api/, decoded; `http`: the HTTP request it came in, for the routes that
   *  look at who's asking). Never throws: errors are answers too. */
  async run(method: string, parts: string[], query: Record<string, string>, body: unknown, http?: IncomingMessage): Promise<Reply> {
    try {
      // Who asked, for the hooks its writes run (plugin.onCreate): only a request over HTTP says.
      const h = (k: string) => { const v = http?.headers[k]; return typeof v === "string" && v ? v.slice(0, 200) : null }
      return asReply(http ? await requestWriter.run({ client: h("x-vaultite-client"), agent: h("x-vaultite-agent") }, () => this.dispatch(method, parts, query, body, http))
        : await this.dispatch(method, parts, query, body, http))
    } catch (e) {
      const out = errorReply(e)
      if (out) return out
      console.error(e)
      return reply(500, { error: String((e as Error).message ?? e) })
    }
  }

  private async dispatch(method: string, parts: string[], query: Record<string, string>, body: unknown, http?: IncomingMessage): Promise<unknown> {
    const obj = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Item
    if (parts[0] === "ops") return await this.opsRoute(method, parts.slice(1), query, body, http)
    // A file from outside the vault, opened in the desktop app (core/outside.ts)
    if (parts.join("/") === "file" && O.isOutside(method === "GET" ? query.path : obj.path)) return O.handle(method, method === "GET" ? query.path : obj.path, obj)
    if (parts.join("/") === "file/info" && method === "GET" && O.isOutside(query.path)) return O.info(query.path)
    if (method === "POST" && parts.join("/") === "upload") return await F.upload(this.vault, query, obj, http, (fn) => this.hold(fn))
    const res = (await F.handle(this.vault, method, parts, query, obj)) ?? Look.handle(this.vault, method, parts, obj)
    if (res !== undefined) return res
    // The core's own routes for vault plugins, before any plugin's.
    if (parts[0] === "plugins" && method === "GET") {
      if (parts.length === 1) return this.vaultPlugins.list()
      // (its version in the path: a chunk importing ./bundle.js gets the same module the app imported)
      if (parts.length === 4 && parts[3].endsWith(".js")) {
        const code = this.vaultPlugins.code(parts[1], parts[2], parts[3])
        if (code === null) throw new HTTPError(404, `no ${parts[3]} of a vault plugin '${parts[1]}' that's on and built at ${parts[2]}`)
        return new Text(code, "text/javascript; charset=utf-8")
      }
    }
    if (parts.join("/") === "blocks" && method === "GET") return this.blocks()
    if (parts.join("/") === "blocks/sources" && method === "GET") return await blockSources(this.vault, this.plugins, query)
    if (parts[0] === "docs" && method === "GET" && parts.length <= 2) {
      if (parts.length === 1) return topics(this.plugins).map(({ id, title, plugin }) => ({ id, title, plugin }))
      return new Text(topic(this.plugins, parts[1]).text + "\n", "text/markdown; charset=utf-8")
    }
    if (parts[0] === "bundles") {
      const out = await B.handle(this.host(http), method, parts.slice(1), query, obj)
      if (out !== undefined) return out
    }
    const req = new Request(method, parts, query, body as Item)
    req.http = http
    const hit = match(this.plugins, method, parts)
    if (hit) {
      req.wild = hit[1]
      return await hit[0](req)
    }
    const route = parts.join("/")
    if (route === "state" && method === "GET") return query.since !== undefined ? await this.stateSince(query.since) : await this.state()
    if (route === "render" && method === "GET") return new Text(await render(this.vault, this.plugins, query.path))
    if (route === "render/block" && method === "GET") return new Text(await blockOn(this.vault, this.plugins, query))
    if (route === "vault" && method === "GET") return { path: this.vault.path, problems: this.vault.problemList() }
    if (parts.length === 2 && parts[0] === "config" && SETTINGS.includes(parts[1])) {
      if (method === "PUT" || method === "PATCH") {
        // Only the keys sent change (a setting written from an old copy of the file doesn't put back the others: another
        // app version's, the CLI's, a key an AI changed); PATCH's null removes one.
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          if (method === "PATCH") throw new HTTPError(400, "send an object of the keys to change")
          this.vault.setConfig(parts[1], body)
        } else this.vault.patchConfig(parts[1], body as Item, { nullRemoves: method === "PATCH" })
      }
      return this.vault.config(parts[1])
    }
    // A plugin's settings, .vaultite/plugins/<id>/data.json, for one with no backend of its own (Vim): PUT and PATCH
    // change only the keys sent, PATCH's null removes one.
    if (parts.length === 3 && parts[0] === "config" && parts[1] === "plugin" && /^[a-z0-9][a-z0-9-]*$/.test(parts[2])) {
      const name = `plugins/${parts[2]}/data`
      if (method === "PUT" || method === "PATCH") {
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new HTTPError(400, "send an object of the keys to change")
        this.vault.patchConfig(name, body as Item, { nullRemoves: method === "PATCH" })
      }
      return this.vault.config(name)
    }
    // Ids have slashes ("People/Alice Park"): an unencoded one arrives as several parts.
    if (parts.length && this.vault.has(parts[0])) return await this.crud(method, this.vault.kind(parts[0]), parts.slice(1).join("/") || null, body)
    return reply(404, { error: "not found" })
  }

  // ---------- operations (core/ops.ts) ----------

  /** Every op that's available: the core's, then each plugin's that's on, with the plugin it's of (null: the core's). */
  ops(): { op: Op; plugin: string | null }[] {
    this.core ??= [...coreOps(this), ...eventOps(), ...hookOps(() => this.vaultPlugins.hooks), ...scheduleOps(() => this.scheduler)]
    const on = enabled(this.vault, this.plugins)
    return [...this.core.map((op) => ({ op, plugin: null })),
      ...this.plugins.filter((p) => on.has(p.id)).flatMap((p) => p.ops.map((op) => ({ op, plugin: p.id as string | null })))]
  }

  /** An op by its id, or by its CLI name (`note`). */
  opNamed(name: string) {
    const all = this.ops()
    return all.find((o) => o.op.id === name) ?? all.find((o) => o.op.cli === name) ?? null
  }

  /** The catalog as the API lists it. */
  catalog() {
    return this.ops().map(({ op, plugin }) => entryOf(op, plugin))
  }

  /** The catalog as Markdown (`vau docs api`). */
  opsDoc() {
    return opsDoc(this.catalog())
  }

  /** Run an op as `who`, its params checked here. `http` is the request it came in, which routes it calls see as their
   *  own so owner checks still apply; without one (tests) nothing is refused. Throws OpError. */
  async runOp(name: string, given: unknown, { who = this.who(), http, input }: { who?: Who; http?: IncomingMessage; input?: Readable } = {}): Promise<{ op: Op; params: Item; result: unknown; who: Who }> {
    const hit = this.opNamed(name)
    if (!hit) throw this.noOp(name)
    const { op, plugin } = hit
    const refusal = async (what: string) => {
      if (!http) return ""
      const p = plugin ? this.plugins.find((x) => x.id === plugin) : null
      return p ? await p.refusal(http, what) : await this.ownerWhy(http, what)
    }
    if (op.owner) {
      const why = await refusal(op.owner)
      if (why) throw new OpError(why, 403)
    }
    const params = checkParams(op, given)
    // Paths as the user says them ("Today", "Alice Park") are read as the vault's (core/ops.ts pathAsSaid).
    const paths = Object.entries(op.params ?? {}).filter(([k, p]) => p.format === "path" && params[k] !== undefined)
    if (paths.length) {
      const tree = (await this.dispatchOrReply("GET", ["files"], {}, {})).body as Item
      for (const [k, p] of paths) params[k] = p.type === "array" ? (params[k] as string[]).map((x) => pathAsSaid(tree, x)) : pathAsSaid(tree, params[k] as string)
    }
    const ctx: OpCtx = {
      vault: this.vault,
      who,
      plugin,
      // (as the op runs: a write op holds the vault already, and so do routes that run ops while holding it)
      op: async (id, p, input) => (await this.runOp(id, p ?? {}, { who, http, input })).result,
      api: async (method, route, body) => {
        const { parts, query } = routeOf(route)
        return bodyOrThrow(await this.dispatchOrReply(method, parts, query, body, http))
      },
      ui: async (message) => {
        if (!this.ui) throw new OpError("the app's window can only be driven through the server (it isn't running one here)", 503)
        return await this.ui(message)
      },
      refusal,
      ...(input && op.input ? { input } : {}),
    }
    // Plugins' middleware (plugin.around), the outermost first; one that throws before next() is skipped, unless it refuses.
    const arounds = this.on().flatMap((p) => p.arounds.filter(([ids]) => typeMatches(op.id, ids)).map(([, fn]) => [p.id, fn] as const))
    const step = async (i: number, ps: Item): Promise<unknown> => {
      if (i === arounds.length) return await op.run(ps, ctx)
      const [by, fn] = arounds[i]
      let called = false
      const next = (given?: Item) => { called = true; return step(i + 1, given === undefined || given === ps ? ps : checkParams(op, given)) }
      try {
        return await fn({ op: op.id, kind: op.kind, plugin, params: ps, who, ctx }, next)
      } catch (e) {
        if (called || e instanceof OpError) throw e
        console.error(`${by}: around ${op.id}:`, e)
        return await next()
      }
    }
    return { op, params, result: await step(0, params), who }
  }

  /** Why this request isn't this machine's owner for `what` (core/owner.ts), or "". */
  private async ownerWhy(http: IncomingMessage, what: string) {
    return ownerRefusal(http, { allowRemote: false, allowUsers: [], owner: typeof http.headers["tailscale-user-login"] === "string" ? await ownerLogin() : "" }, what)
  }

  /** dispatch() as an answer (errors as replies), for an op's in-process API calls. */
  private async dispatchOrReply(method: string, parts: string[], query: Record<string, string>, body: unknown, http?: IncomingMessage): Promise<Reply> {
    try {
      return asReply(await this.dispatch(method, parts, query, body, http))
    } catch (e) {
      const out = errorReply(e)
      if (out) return out
      throw e
    }
  }

  /** /api/ops: GET the catalog or one entry, POST runs one (`?as=text`: its answer as Markdown). */
  private async opsRoute(method: string, parts: string[], query: Record<string, string>, body: unknown, http?: IncomingMessage): Promise<unknown> {
    if (method === "GET" && parts.length === 0) return query.as === "text" ? new Text(this.opsDoc() + "\n") : this.catalog()
    if (parts.length !== 1) return reply(404, { error: "not found" })
    if (method === "GET") {
      const hit = this.opNamed(parts[0])
      if (!hit) throw new OpError(`no operation '${parts[0]}' (GET /api/ops lists them)`, 404)
      return entryOf(hit.op, hit.plugin)
    }
    if (method !== "POST") return reply(405, { error: "POST /api/ops/<id> runs an op; GET lists them" })
    // Bytes sent as they are (an op that takes them): its parameters are the query's.
    const raw = http && this.streams(method, ["ops", parts[0]], String(http.headers?.["content-type"] ?? ""))
    const given = raw ? Object.fromEntries(Object.entries(query).filter(([k]) => k !== "as")) : body
    // (server.ts synced the vault for it: unlocked() above; callOp holds it for a write)
    const { result, text } = await this.callOp(parts[0], given, undefined, { synced: true, http, input: raw ? http : undefined })
    return query.as !== "text" ? result ?? null : new Text(text)
  }

  // ---------- holding the vault, calling ops and the API in-process, events (core/events.ts) ----------

  /** fn with the vault held (a write: synced first, then nobody else's write until it's done), as server.ts runs every
   *  write request; at once when this call already holds it (an op run by an op). */
  hold<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.holding.getStore()?.on) return Promise.resolve().then(fn)
    return this.vault.lock(async () => {
      const token = { on: true }
      try {
        return await this.holding.run(token, async () => { await this.vault.sync(); return await fn() })
      } finally {
        token.on = false
      }
    })
  }

  /** Who made the request being answered (X-Vaultite-Client and -Agent), as ops name them. */
  private who(): Who {
    const w = requestWriter.getStore()
    return whoOf(w?.client ?? null, w?.agent ?? null)
  }

  /** A call from inside the server told to the plugins watching requests (Activity), as if it had come over HTTP. */
  private reported(method: string, route: string, query: Record<string, string>, who: Who, command: string | undefined) {
    if (!command) return null
    return this.requestStarted({ t: Date.now(), method, route, query, client: who.client, agent: who.agent, command, ua: "", remote: "", port: 0, forwarded: false })
  }

  /** Run an op as every surface does: a read after a sync, unheld; a write holding the vault (unless `lock: false`),
   *  as `who`, then `op.done` on the events. Throws OpError; `report` tells request watchers (Activity). */
  async callOp(name: string, given: unknown, who: Who = this.who(), opts: { synced?: boolean; report?: string; http?: IncomingMessage; input?: Readable } = {}) {
    const hit = this.opNamed(name)
    if (!hit) throw this.noOp(name)
    const { op, plugin } = hit
    const write = op.kind !== "read"
    const run = () => requestWriter.run({ client: who.client, agent: who.agent }, () => this.runOp(op.id, given, { who, http: opts.http, input: opts.input }))
    const t0 = performance.now()
    const end = this.reported("POST", `ops/${op.id}`, {}, who, opts.report)
    try {
      const out = this.holding.getStore()?.on ? await run() : write && op.lock !== false ? await this.hold(run)
        : opts.synced ? await run() : await this.vault.synced().then(run)
      const text = op.text ? op.text(out.result, out.params, who) : typeof out.result === "string" ? out.result
        : jsonBlock(out.result ?? null)
      if (write) this.done(op, plugin, who, out.params, null, t0)
      end?.({ status: 200, ms: performance.now() - t0, body: given })
      return { entry: entryOf(op, plugin), params: out.params, result: out.result, text }
    } catch (e) {
      if (write) this.done(op, plugin, who, given, e, t0)
      end?.({ status: e instanceof OpError || e instanceof HTTPError || e instanceof ConfigError ? e.status : 500, ms: performance.now() - t0, body: given })
      throw e
    }
  }

  /** op.done: a write op ran (or failed: its parameters as given, then). */
  private done(op: Op, plugin: string | null, who: Who, params: unknown, error: unknown, t0: number) {
    eventsOf(this.vault).emit("op.done", {
      id: op.id, plugin, kind: op.kind, who: { client: who.client, agent: who.agent, label: who.label },
      params: params && typeof params === "object" && !Array.isArray(params) ? summary(params as Item) : {},
      ok: !error, ...(error ? { error: String((error as Error)?.message ?? error).slice(0, 300) } : {}), ms: Math.round(performance.now() - t0),
    })
  }

  private noOp(name: string) {
    const near = nearest(name, this.ops().map((o) => o.op.id))
    return new OpError(`no operation '${name}'${near ? `: did you mean ${near}?` : ""} (vau ops lists them)`, 404)
  }

  /** A route of the API in-process (a path under /api/ with its query string): a read after a sync (unless `synced`),
   *  a write held like server.ts holds one (at once inside a hold). Its answer, errors as answers. */
  private async request(method: string, route: string, body: unknown, http?: IncomingMessage, synced = false): Promise<Reply> {
    const { parts, query } = routeOf(route)
    const go = () => this.dispatchOrReply(method, parts, query, body ?? {}, http)
    if (this.holding.getStore()?.on) return go()
    if (method === "GET" || this.unlocked(method, parts)) return synced ? go() : this.vault.synced().then(go)
    return this.hold(go)
  }

  /** A route of the API in-process as `who` (for plugins: plugin.host.api): its body without private keys (text for a
   *  text answer); a 4xx or 5xx throws an OpError with its message. `report`: as callOp's. */
  async apiAs(method: string, route: string, body?: unknown, who: Who = this.who(), opts: { report?: string; http?: IncomingMessage } = {}): Promise<unknown> {
    const t0 = performance.now()
    const { parts, query } = routeOf(route)
    const end = this.reported(method, parts.join("/"), query, who, opts.report)
    let res: Reply
    try {
      res = await requestWriter.run({ client: who.client, agent: who.agent }, () => this.request(method, route, body, opts.http))
    } catch (e) {
      end?.({ status: 500, ms: performance.now() - t0, body })
      throw e
    }
    end?.({ status: res.status, ms: performance.now() - t0, body })
    return publicOf(bodyOrThrow(res))
  }

  /** Operations and events for the plugins (plugin.host, plugin.runOp, plugin.emit), the events plugins hear
   *  (plugin.onEvent, a vault plugin's manifest `events`), and the core's own: file.moved and file.trashed. */
  private wire() {
    const bus = eventsOf(this.vault)
    hostOps(this.vault, {
      catalog: () => this.catalog(),
      call: (name, params, who, o) => this.callOp(name, params, who, { report: o?.report, http: o?.http, input: o?.input }),
      api: (method, route, body, who, o) => this.apiAs(method, route, body, who, o),
      emit: (type, data) => bus.emit(type, data ?? {}),
    })
    // Heard after the emitter's turn and outside its call (not holding the vault, not as its request), so a plugin
    // that runs an op on an event takes the vault like anyone.
    bus.on({}, (ev) => this.holding.exit(() => requestWriter.exit(() => setImmediate(() => this.heard(ev)))))
    this.vault.onMove((from, to) => { bus.emit(to === null ? "file.trashed" : "file.moved", to === null ? { path: from } : { from, to }) })
  }

  private heard(ev: VaultEvent) {
    for (const p of this.on()) {
      for (const [filter, fn] of p.eventFns) {
        const seen = matching(ev, filter)
        if (seen) try { fn(seen) } catch (e) { console.error(`${p.id}: onEvent:`, e) }
      }
    }
    this.vaultPlugins.heard(ev)
  }

  private async crud(method: string, k: Kind, ref: string | null, body: unknown): Promise<unknown> {
    const c = k.collection, v = this.vault
    const obj = (body ?? {}) as Item
    if (k.file) { // a single file (ME.md): GET and PUT the whole thing
      const cur = v.get(c, c)
      if (method === "GET") return cur ?? reply(404, { error: `no ${k.file}` })
      if (method === "PUT" || method === "POST") return await v.save(c, obj, cur && cur.id)
    } else if (method === "GET") {
      if (ref === null) return v.items(c)
      return v.get(c, ref) ?? reply(404, { error: `no ${k.type} '${ref}'` })
    } else if (method === "POST" && ref === null) {
      if (Array.isArray(body)) {
        const items = []
        for (const b of body) items.push(await v.save(c, b))
        return { ok: true, upserted: items.length, ids: items.map((i) => i?.id) }
      }
      return reply(201, await v.save(c, obj))
    } else if (method === "PUT" && ref) {
      const item = v.get(c, ref)
      if (!item) return reply(404, { error: `no ${k.type} '${ref}'` })
      return await v.save(c, obj, item.id, ARCHIVED in obj)
    } else if (method === "DELETE" && ref) {
      return { ok: v.delete(c, ref) }
    }
    return reply(404, { error: "not found" })
  }
}

/** A path part decoded (one that doesn't decode stays as sent). */
export const decodePart = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

/** A query's parameters as the API takes them: each key's first value, empty ones left out. */
export function queryOf(params: URLSearchParams) {
  const query: Record<string, string> = {}
  for (const [k, v] of params) if (v !== "" && !(k in query)) query[k] = v
  return query
}

/** A route of the API in-process (the path under /api/ and its query string) read as server.ts reads a request's. */
function routeOf(route: string) {
  const at = route.indexOf("?")
  return { parts: (at < 0 ? route : route.slice(0, at)).split("/").filter(Boolean).map(decodePart), query: queryOf(new URLSearchParams(at < 0 ? "" : route.slice(at + 1))) }
}

const asReply = (x: unknown) => (x instanceof Reply ? x : reply(200, x))

/** An in-process answer's body (text for a text answer); a 4xx or 5xx throws an OpError with its message. */
function bodyOrThrow(res: Reply) {
  if (res.status >= 400) throw new OpError(String((res.body as Item)?.error ?? res.status), res.status)
  return res.body instanceof Text ? String(res.body.text) : res.body
}

/** A thrown error as the API answers it (what ops, routes and the vault throw), or null for a bug. */
function errorReply(e: unknown): Reply | null {
  if (e instanceof OpError) return reply(e.status, { error: e.message, ...(e.problems.length ? { problems: e.problems } : {}) })
  if (e instanceof HTTPError || e instanceof ConfigError) return reply(e.status, { error: e.message })
  if (e instanceof NotFound) return reply(404, { error: e.message })
  if (e instanceof ConflictError) return reply(409, { error: e.message })
  return null
}

/** The plugins (by id) that have a settings file in the vault, .vaultite/plugins/<id>/data.json, sorted. */
function settingsFiles(vaultPath: string) {
  const dir = path.join(vaultPath, ".vaultite", "plugins")
  try {
    return fs.readdirSync(dir).filter((id) => !id.startsWith(".") && fs.existsSync(path.join(dir, id, "data.json"))).sort()
  } catch {
    return []
  }
}

const serialized = new WeakMap<object, Buffer>()

/** An answer as JSON, without its private keys (what server.ts sends). One given again while nothing changed is
 *  frozen (state(), the graph): it's serialized once. */
export function jsonOf(body: unknown): string | Buffer {
  if (body === null || typeof body !== "object" || !Object.isFrozen(body)) return JSON.stringify(publicOf(body) ?? null)
  let data = serialized.get(body)
  if (!data) serialized.set(body, data = Buffer.from(JSON.stringify(publicOf(body))))
  return data
}

/** Open a vault: load the plugins, install dashboards, read every file. The event loop turns between steps, so a
 *  starting server answers its web app's files meanwhile. */
export async function open(vaultPath: string, { start = true } = {}) {
  fs.mkdirSync(vaultPath, { recursive: true })
  // A vault the app has never opened (no .vaultite/ yet): it starts from Minimal (core/start.ts); until then, no
  // plugin's pages are installed (core/bundles.ts offering).
  const fresh = start && !fs.existsSync(path.join(vaultPath, ".vaultite"))
  const empty = fresh && fs.readdirSync(vaultPath).every((f) => f === ".DS_Store")
  const app = await new App(vaultPath).init()
  if (fresh) B.markNew(app.vault)
  if (start) {
    await turn()
    app.installPages()
    await turn()
    await app.vault.sync()
    if (fresh) await setUpNew(app.host(), empty).catch((e) => console.error("setting up the new vault:", e))
  }
  return app
}
