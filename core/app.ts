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
import { CONNECT_HEADER, overNetwork, ownerRefusal } from "./owner.ts"
import { MARKER as SANDBOX_MARKER } from "./sandbox.ts"
import { accessToMachine, migrate, migrateMoved } from "./migrations.ts"
import { installFrom } from "./coreops/installs.ts"
import * as F from "./files.ts"
import * as O from "./outside.ts"
import * as pages from "./pages.ts"
import { setUpNew } from "./start.ts"
import type { ServerError } from "./serverlog.ts"
import type { Present } from "./live.ts"
import { enabled, hostOps, HTTPError, LOADED, LOCAL, load as loadPlugins, vaultHere, match, matchServed, type Plugin, propertyTypes, Reply, reply, type RequestEnd, type RequestStart, Request, service, settingDefaults, Text } from "./plugins.ts"
import { readTypes } from "./proptypes.ts"
import { blockOn, blockSources, render } from "./render.ts"
import { type BlockDecls, COMMON, drawnBy, drawsOf } from "./blocks.ts"
import { topic, topics } from "./docs.ts"
import * as SP from "./statepatch.ts"
import { coreOps } from "./coreops.ts"
import { SETTINGS } from "./coreops/settings.ts"
import { filing } from "./filing.ts"
import { checkParams, didOf, entryOf, jsonBlock, nearest, type Op, type OpCtx, OpError, opsDoc, pathAsSaid, type Who, whoOf } from "./ops.ts"
import { eventOps, eventsOf, matching, summary, typeMatches, type VaultEvent } from "./events.ts"
import { ARCHIVED, setMarks } from "./fileprops.ts"
import { hookOps } from "./hooks.ts"
import { type Listed, Scheduler, scheduleOps } from "./schedule.ts"
import { digestOf, VaultPlugins } from "./vaultplugins.ts"
import * as G from "./grants.ts"
import { byUser, notHereYet, onItsOwn, overConnect, runHook, WriteRefused } from "./writegate.ts"
import { asLocked, type Fetched, fetchSource, parseSource, readLock } from "./installs.ts"
import { autoUpdates } from "./updates.ts"
import { disclosuresOf, saysMore } from "./pluginmeta.ts"
import { browse, PluginIndex } from "./pluginindex.ts"
import { API_VERSION, APP_VERSION } from "./version.ts"
import { ConfigError, ConflictError, type Item, type Kind, NotFound, publicOf, requestWriter, Vault, type Writer } from "./vault.ts"
import { strings } from "./values.ts"
import { keepReads } from "./fmcache.ts"

/** How many recent states the server keeps as pieces (a device that last loaded before them gets the whole state).
 *  Pieces that stayed the same are shared, so each one past the first costs little more than what changed. */
const KEEP = 32

/** A state as the app was given it: its version, and its pieces (core/statepatch.ts). */
type Snap = { v: string; state: Item; piece: SP.Piece; json?: string; patches: Map<string, string> }


/** The writer for a call made as `who`: the request's own (its terminal, session, model) when it's the same caller. */
function writerAs(who: Who): Writer {
  const w = requestWriter.getStore()
  return w && w.client === who.client && whoOf(w.client, w.agent).agent === who.agent ? { ...w, agent: who.agent } : { client: who.client, agent: who.agent }
}

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
  private pagesOf = "" // the plugins that were on at the last look (onKey): those turned on since get their pages
  /** The user's open window, driven from outside (server.ts sets it: POST /api/ui's handler, core/live.ts). */
  ui: ((message: Item | null) => unknown) | null = null
  /** The devices with app windows open on this server, and a message to one's windows (server.ts: core/live.ts). */
  presence: { list: () => Present[]; tell: (device: string, msg: Item) => number } | null = null
  /** The plugins that moved out of the app being installed, once it's open (core/migrations.ts migrateMoved). */
  moving: Promise<void> = Promise.resolve()
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
        // The core's own: .trash emptied of what's been there 30 days (one machine does it, so iCloud sees each delete once).
        return [{ plugin: "core", job: { name: "trash", every: "1d", run: () => F.emptyTrash(this.vault) } },
          // Installed plugins that update on their own (core/updates.ts): one machine fetches them, the others follow (adopt).
          { plugin: "core", job: { name: "plugin-updates", every: "1h", run: () => Object.keys(readLock(this.vault)).length ? this.runOp("plugin.update", { auto: true }) : null } },
          ...this.on().flatMap((p): Listed[] => p.jobs.map((job) => ({ plugin: p.id, job })))]
      },
      here: (machine) => this.runsHere(machine),
      before: () => this.syncPlugins(),
      paused: () => this.vaultPlugins.paused().flatMap((p) => p.jobs.map((job) => ({ plugin: p.id, job,
        why: `${p.name} changed and waits for you to allow it again (vau plugin allow ${p.id})` }))),
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
  async init(timing?: { mark(part: string): void }) {
    await this.vault.fetchSettings()
    this.app = await loadPlugins(this.vault)
    timing?.mark("plugins")
    this.plugins = this.app
    // Templates' notes are patterns, and samples examples, not people or logs, whatever their `type` (Vault.kindFor).
    this.vault.plain = () => { const f = service(this.plugins, "templates:folder")?.(); return [...typeof f === "string" && f ? [f] : [], ...this.vault.samples()] }
    this.vault.defaults = () => settingDefaults(this.vault, this.plugins)
    // The write gate (core/writegate.ts): a plugin acting on its own writes outside .vaultite/ only where it's granted.
    this.vault.mayWrite = (id, rel) => G.may(this.vault, this.plugins, id, rel)
    this.vault.writeRefused = (id, rel) => {
      const asking = G.refused(this.vault, this.plugins, id, rel)
      eventsOf(this.vault).emit("plugin.write-refused", { plugin: id, path: rel, asking })
    }
    this.vaultPlugins = new VaultPlugins(this.vault, this.app)
    // A version the directory blocks doesn't load: matched by the repo it was installed from, its manifest's, or its id.
    this.vaultPlugins.blocked = (vp) => this.index.blockedWhy(vp.id, typeof vp.manifest.version === "string" ? vp.manifest.version : null,
      [readLock(this.vault)[vp.id]?.repo, typeof vp.manifest.repo === "string" ? vp.manifest.repo : null])
    this.wire()
    await this.syncPlugins()
    timing?.mark("vault plugins")
    this.pagesOf = this.onKey()
    // (asked only of a vault with plugins installed from the directory: one day old, the blocklist is fetched again)
    if (Object.keys(readLock(this.vault)).length) this.index.refreshIfStale()
    return this
  }

  /** plugins.json with each plugin in only the list that counts for it now: one whose default changed was left in both
   *  (written only then). The app's are opt-in when `offByDefault`, the vault's always. */
  tidyPluginLists() {
    const conf = this.vault.config("plugins")
    const disabled = strings(conf.disabled), enabled = strings(conf.enabled), both = disabled.filter((id) => enabled.includes(id))
    if (!both.length) return
    const optIn = (id: string) => { const p = this.app.find((x) => x.id === id); return !p || !!p.manifest.offByDefault }
    this.vault.patchConfig("plugins", { disabled: disabled.filter((id) => !both.includes(id) || !optIn(id)), enabled: enabled.filter((id) => !both.includes(id) || optIn(id)) })
  }

  /** Load, reload or unload the vault's own plugins, and adopt updates made elsewhere. Runs before every request and
   *  before the files are read, so a plugin's kinds apply to them; then the pages of plugins turned on (followPlugins). */
  async syncPlugins({ pages: write = true, trusting = false } = {}) {
    // (the app's reads skip it while nothing changed on disk, by the watcher's word, nor here: Vault.vouched)
    const key = `${this.vault.heardCount}:${this.vault.settingsVersion}:${this.vaultPlugins.trust.version}:${this.index.version}`
    if (trusting && this.pluginsSynced === key && this.vault.vouched()) return false
    const changed = await this.loadPlugins()
    this.pluginsSynced = key
    this.adopt()
    this.tellPaused()
    this.followPlugins(write)
    return changed
  }

  /** Load, reload or unload the vault's own plugins as plugins.json and this machine's yes say now. */
  private async loadPlugins() {
    const changed = await this.vaultPlugins.sync()
    if (changed) {
      this.plugins = [...this.app, ...this.vaultPlugins.loaded()]
      LOADED.splice(0, LOADED.length, ...this.plugins)
      this.vault.pluginList = this.plugins
    }
    setMarks(this.plugins.map((p) => p.manifest))
    return changed
  }

  private pluginsSynced = "" // what syncPlugins last ran at (its key)

  /** Whether a request may trust the vault's watcher (Vault.synced): the app's own, or one from another machine, which
   *  can't have just written a file here. A local agent or script may have, before the watcher heard of it. */
  trusts(http?: IncomingMessage) {
    if (!http?.socket) return false // (a request made in-process, as tests do)
    return String(http.headers["x-vaultite-client"] ?? "").startsWith("app/") || overNetwork(http)
  }

  private adopting = new Map<string, number>() // plugin id + hash -> when it was last checked against its source

  /** A plugin another machine updated (its files synced) is allowed here only if this machine allowed it before and a
   *  fetch from the source it allowed, at the lock's version, has the same files: the lock is a vault file, not enough alone. */
  private adopt() {
    const lock = readLock(this.vault)
    const vps = this.vaultPlugins
    for (const vp of vps.found.values()) {
      const l = lock[vp.id], a = vps.trust.approval(vp.id)
      if (!l?.history?.length || !a || a.edits || !asLocked(vp.dir, l, vp.digest.content) || vps.trust.approved(vp.id, vp.digest.content)) continue
      // (the lock could name another source, and the new version could say it does more: both the user's call)
      if (a.source !== l.source || !a.says || saysMore(a.says, disclosuresOf(vp.manifest))) continue
      if (!vps.enabled().has(vp.id) || vp.problems.length || !autoUpdates(this.vault.config("plugins"), vp.id, l.source)) continue
      const key = `${vp.id}\0${vp.digest.content}`
      if (Date.now() - (this.adopting.get(key) ?? 0) < 10 * 60_000) continue
      this.adopting.set(key, Date.now())
      vps.adopting.add(vp.id)
      void (async () => {
        let f: Fetched | null = null
        try {
          f = await fetchSource({ ...parseSource(l.source), tag: l.tag }, new Map(this.app.map((p) => [p.id, p.tier])),
            new Map([...vps.found].filter(([x]) => x !== vp.id).map(([x, o]) => [x, o.dir])))
          const d = digestOf(f.dir)
          if (d.content !== vp.digest.content || digestOf(vp.dir).content !== d.content) return
          vps.allow(vp.id, { version: l.version, digest: d })
          await this.syncPlugins()
          const u = l.history!.at(-1)!
          await this.tellUpdated([{ id: vp.id, name: typeof vp.manifest.name === "string" ? vp.manifest.name : vp.id, to: l.version, notes: u.to === l.version ? u.notes : [] }])
        } catch (e) {
          console.error(`plugin updates: ${vp.id} couldn't be checked against its source:`, (e as Error).message)
        } finally {
          f?.done()
          vps.adopting.delete(vp.id)
        }
      })()
    }
  }

  /** Tell the user: an event kept in the inbox (the service "inbox:event"), else a toast whose `button` opens its link.
   *  The event, or null for a toast. */
  async notice(e: Item, button = "Open"): Promise<Item | null> {
    const add = service(this.on(), "inbox:event")
    if (add) return await add(e) as Item
    if (!this.ui) throw new OpError("no inbox to keep it and no window to show it", 503)
    await this.ui({ action: "notify", text: e.title, kind: e.kind === "error" ? "error" : null, ...(e.link ? { button: { label: button, open: e.link } } : {}) })
    return null
  }

  /** Tell the user plugins updated on their own: one notice for them all. */
  async tellUpdated(rows: { id: string; name: string; to: string; notes?: string[] }[]) {
    if (!rows.length) return
    const one = rows.length === 1 ? rows[0] : null
    const title = one ? `${one.name} updated to ${one.to}${one.notes?.length ? `: ${one.notes[0]}` : ""}`
      : `${rows.length} plugins updated: ${rows.map((r) => `${r.name} ${r.to}`).join(", ")}`
    try { await this.notice({ source: "plugins", kind: "info", title, link: one ? `detail:plugin/${one.id}` : "view:plugins" }, "What's new") } catch { /* no window */ }
  }

  private pausedTold = new Set<string>() // plugins whose paused notice is in the inbox, read once allowed again

  /** A plugin that changed after this machine allowed it stops until allowed again, its schedule too: say so once, in
   *  the inbox as waiting on the user, since a toast nobody saw lets a morning job go quiet for days. */
  private tellPaused() {
    const vps = this.vaultPlugins
    const paused = vps.paused()
    for (const id of this.pausedTold) {
      if (paused.some((p) => p.id === id)) continue
      this.pausedTold.delete(id)
      service(this.on(), "inbox:read")?.("plugins", `paused:${id}`)
    }
    for (const p of paused) {
      if (!vps.trust.tellPaused(p.id)) continue
      const jobs = p.jobs.map((j) => `${j.name} (every ${j.every}${j.at ? ` at ${j.at}` : ""})`)
      const title = `${p.name} changed and is paused until you allow it again${jobs.length ? `: ${jobs.join(", ")} won't run` : ""}`
      const body = `Changed: ${p.changed.join(", ")}. Allow it: vau plugin allow ${p.id}`
      this.notice({ source: "plugins", kind: "waiting", title, body, link: `detail:plugin/${p.id}`, key: `paused:${p.id}` }, "Review")
        .then((e) => { if (e) this.pausedTold.add(p.id) }, () => { /* no window */ })
    }
  }

  /** Which plugins are on, as one string; "offering:" before it while a new vault is being offered the bundles. */
  private onKey() {
    const on = [...enabled(this.vault, this.plugins)].sort().join(",")
    return B.offering(this.vault) ? `offering:${on}` : on
  }

  /** GET /api/blocks: every plugin's blocks as declared in its manifest, with whether it's on and has a text side (an
   *  undeclared block with a text side too: `declared: false`); a `by` option takes the plugins on that draw it. */
  blocks() {
    const on = enabled(this.vault, this.plugins)
    const loaded = new Map(this.plugins.map((p) => [p.id, p]))
    const drawers = (block: string) => this.plugins.filter((p) => drawsOf(p.manifest).includes(block))
    const rows: Item[] = []
    const add = (id: string, name: string, tier: string, decls: BlockDecls, texts: Set<string> | null, draws: string[]) => {
      for (const [block, d] of Object.entries(decls)) {
        const by = d.by ? drawers(block) : null
        rows.push({ name: block, plugin: id, pluginName: name, tier, on: on.has(id), declared: true,
          text: by ? by.some((p) => p.textBlocks.has(block)) : texts ? texts.has(block) : null,
          description: d.description ?? "", options: (by ? drawnBy(d, by.filter((p) => on.has(p.id)).map((p) => p.id)) : d).options ?? {} })
      }
      for (const block of texts ?? []) {
        if (!Object.hasOwn(decls, block) && !draws.includes(block)) rows.push({ name: block, plugin: id, pluginName: name, tier, on: on.has(id), declared: false, text: true, description: "", options: {} })
      }
    }
    for (const p of this.app) add(p.id, String(p.manifest.name ?? p.id), p.tier, p.blocks, new Set(p.textBlocks.keys()), drawsOf(p.manifest))
    for (const v of this.vaultPlugins.list()) {
      const p = loaded.get(v.id as string)
      add(v.id as string, v.name as string, "vault", v.blocks as BlockDecls, p ? new Set(p.textBlocks.keys()) : null, v.draws as string[])
    }
    return { common: COMMON, blocks: rows }
  }

  /** Plugins a request turned on (in a hold: the app, vau, a bundle) write their pages (core/pages.ts; a new vault's pick:
   *  those it turned on, unpinned, so Standard adds none). Turned on elsewhere (by hand, another machine) or on opening: none. */
  private followPlugins(write = true) {
    const key = this.onKey(), was = this.pagesOf
    this.pagesOf = key
    if (!write || key === was || key.startsWith("offering:") || !this.holding.getStore()?.on) return []
    const offered = was.startsWith("offering:"), before = new Set((offered ? was.slice("offering:".length) : was).split(","))
    return pages.writePages(this.vault, this.plugins, key.split(",").filter((id) => id && !before.has(id)), { pin: !offered })
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
    out.writeGrants = G.grantList(this.vault, this.plugins) // (what plugins write on their own, and the user's answers)
    out.settingDefaults = settingDefaults(this.vault, this.plugins) // (another app's, under the vault's own: never written)
    out.filing = filing(this.vault)
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

  /** GET <route>?patch=<v>: a frozen answer (the graph) as a patch of answer v, which the app has, when it's still kept
   *  (`{v, since, patch}`), else whole (`{v, whole}`); `v` is "" for an answer that isn't kept. */
  private patched(key: string, since: string, res: Reply): Reply {
    const body = res.body
    if (res.status !== 200 || body === null || typeof body !== "object" || !Object.isFrozen(body)) {
      return res.status === 200 ? reply(200, new Text(`{"v":"","whole":${JSON.stringify(publicOf(body) ?? null)}}`, "application/json")) : res
    }
    let kept = this.answers.get(key) ?? []
    this.answers.delete(key)
    let now = kept.find((a) => a.body === body)
    if (!now) {
      now = { v: `${this.boot}.${++this.seq}`, body, piece: SP.snapshot(publicOf(body), kept.at(-1)?.piece) }
      kept = [...kept, now].slice(-2)
    }
    this.answers.set(key, kept)
    if (this.answers.size > 20) this.answers.delete(this.answers.keys().next().value!)
    const v = JSON.stringify(now.v), was = kept.find((a) => a.v === since)
    const text = was ? `{"v":${v},"since":${JSON.stringify(since)},"patch":${was === now ? "null" : SP.patchOf(was.piece, now.piece) ?? "null"}}`
      : `{"v":${v},"whole":${SP.jsonOf(now.piece)}}`
    return reply(200, new Text(text, "application/json"))
  }
  private answers = new Map<string, { v: string; body: object; piece: SP.Piece }[]>() // (patched's, by route: the last two)

  /** What bundles (core/bundles.ts) work with: the vault, the plugins, and this API for their edits (apiAs, as the
   *  plugins call it: held, as `http`'s caller). */
  host(http?: IncomingMessage): B.Host {
    return {
      vault: this.vault,
      plugins: () => this.plugins,
      vaultPlugins: () => this.vaultPlugins.list(),
      call: (method, route, body) => this.apiAs(method, route, body, this.who(), { http }),
      syncPlugins: (opts) => this.syncPlugins(opts),
      writePages: (opts) => pages.writePages(this.vault, this.plugins, [...enabled(this.vault, this.plugins)].filter((id) => !opts?.only || opts.only.includes(id)), opts),
      allow: async (ids) => {
        if (http && await this.ownerWhy(http, "allowing vault plugins")) return
        for (const id of ids) {
          if (fs.existsSync(this.vault.abs(`.vaultite/plugins/${id}/manifest.json`))) this.vaultPlugins.allow(id)
        }
      },
      install: async (source, tag, { commit, hash }) => {
        await this.callOp("plugin.install", { source, ...(tag ? { tag } : {}), ...(commit ? { commit } : {}), ...(hash ? { hash } : {}) }, this.who(), { http })
      },
      uninstall: async (id) => { await this.callOp("plugin.uninstall", { id }, this.who(), { http }) },
    }
  }

  /** The plugins that are on (Vault.switchedOff). */
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
    for (const p of this.on()) for (const fn of p.changeFns) runHook(p.id, "onChange", () => fn(paths))
  }

  /** GET /<prefix>/<rest> outside /api/, when a plugin that's on serves that prefix (plugin.serve: HTML's /v/ and
   *  /cdn/), else null. `rest` decoded, `raw` as sent with its query string. Never throws: errors are answers too. */
  async serve(prefix: string, rest: string, raw: string, query: Record<string, string>): Promise<Reply | null> {
    const fn = matchServed(this.on(), prefix)
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
    const o = match(this.plugins, method, parts)?.[2]
    return o?.lock === false || o?.sync === false
  }

  /** Whether a request goes to a plugin route that reads nothing of the vault (`sync: false`): run at once. */
  unsynced(method: string, parts: string[]) {
    return match(this.plugins, method, parts)?.[2].sync === false
  }

  /** Does this route read its request's body itself (an upload: the core's, plugin.route's `stream: true`, or an op
   *  that takes bytes, sent as they are: `type`, the body's Content-Type, isn't JSON)? */
  streams(method: string, parts: string[], type = "") {
    if (method === "POST" && parts.length === 1 && parts[0] === "upload") return true
    if (method === "POST" && parts.length === 2 && parts[0] === "ops") return !!type && !/json/i.test(type) && !!this.opNamed(parts[1])?.op.input
    return match(this.plugins, method, parts)?.[2].stream === true
  }

  /** One API request as it comes in (parts: the path under /api/, decoded; `http`: the HTTP request, for the routes
   *  that look at who's asking), held like every call (respond). Never throws: errors are answers too. */
  async run(method: string, parts: string[], query: Record<string, string>, body: unknown, http?: IncomingMessage): Promise<Reply> {
    try {
      // (a plugin that's off answers no request from outside; the app's own calls still reach it, a bundle editing it)
      if (http && !match(this.on(), method, parts) && match(this.plugins, method, parts)) return reply(404, { error: `not found: its plugin is off` })
      // Who asked, for the hooks its writes run (plugin.onCreate): only a request over HTTP says.
      const h = (k: string) => { const v = http?.headers[k]; return typeof v === "string" && v ? v.slice(0, 200) : null }
      // A request is the user's own action, unless a plugin's command says it acts on its own (core/hooks.ts).
      const actor = h("x-vaultite-actor"), as = <T>(fn: () => T) => (actor ? onItsOwn(actor, fn) : byUser(fn))
      const go = () => this.respond(method, parts, query, body, http)
      const writer = { client: h("x-vaultite-client"), agent: h("x-vaultite-agent"), terminal: h("x-vaultite-terminal"), session: h("x-vaultite-session"),
        model: h("x-vaultite-model"), effort: h("x-vaultite-effort") }
      // (Connect without owner tools: CONNECT_HEADER, which only Connect sets; core/writegate.ts refuses what runs code)
      const via = <T>(fn: () => T) => (http && CONNECT_HEADER in http.headers ? overConnect(fn) : fn())
      return http ? await via(() => as(() => requestWriter.run(writer, go))) : await go()
    } catch (e) {
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
        // (its address names its build: kept by the browser, so a reload imports it without asking)
        return new Text(code, "text/javascript; charset=utf-8", { "Cache-Control": "private, max-age=31536000, immutable" })
      }
    }
    if (parts.join("/") === "blocks" && method === "GET") return this.blocks()
    if (parts.join("/") === "blocks/sources" && method === "GET") return await blockSources(this.vault, this.plugins, query)
    if (parts[0] === "docs" && method === "GET" && parts.length <= 2) {
      if (parts.length === 1) return topics(this.plugins).map(({ id, title, plugin }) => ({ id, title, plugin }))
      return new Text(topic(this.plugins, parts[1]).text + "\n", "text/markdown; charset=utf-8")
    }
    if (parts.join("/") === "bundles/browse" && method === "GET") {
      const got = await this.index.get(query.refresh === "1")
      return { url: got.url, available: got.available, fetched: got.fetched, ...(got.error ? { error: got.error } : {}), bundles: browse(got.index, query.q ?? "", B.imports(this.vault)) }
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
    // A plugin's settings, .vaultite/plugins/<id>/data.json: PUT and PATCH change only the keys sent, PATCH's null removes
    // one. Its `local` keys are this machine's (core/trust.ts), and only its owner changes them.
    if (parts.length === 3 && parts[0] === "config" && parts[1] === "plugin" && /^[a-z0-9][a-z0-9-]*$/.test(parts[2])) {
      const p = this.plugins.find((x) => x.id === parts[2]), name = `plugins/${parts[2]}/data`
      if (method === "PUT" || method === "PATCH") {
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new HTTPError(400, "send an object of the keys to change")
        const local = p?.localKeys().filter((k) => Object.hasOwn(body, k)) ?? []
        const why = local.length && http ? await this.ownerWhy(http, `changing ${local.join(", ")}`) : ""
        if (why) throw new HTTPError(403, why)
        return p ? p.patchSettings(body as Item, { nullRemoves: method === "PATCH" }) : this.vault.patchConfig(name, body as Item, { nullRemoves: method === "PATCH" })
      }
      return p ? p.settings() : this.vault.config(name)
    }
    // Several plugins' settings at once ({<id>: settings}): the app reads them so as it loads.
    if (route === "config/plugin" && method === "GET") {
      const ids = String(query.ids ?? "").split(",").filter((id) => /^[a-z0-9][a-z0-9-]*$/.test(id)).slice(0, 500)
      return Object.fromEntries(ids.map((id) => [id, this.plugins.find((x) => x.id === id)?.settings() ?? this.vault.config(`plugins/${id}/data`)]))
    }
    // Ids have slashes ("People/Alice Park"): an unencoded one arrives as several parts.
    if (parts.length && this.vault.has(parts[0])) return await this.crud(method, this.vault.kind(parts[0]), parts.slice(1).join("/") || null, body)
    return reply(404, { error: "not found" })
  }

  // ---------- operations (core/ops.ts) ----------

  /** Every op that's available: the core's, then each plugin's that's on, with the plugin it's of (null: the core's). */
  ops(): { op: Op; plugin: string | null }[] {
    this.core ??= [...coreOps(this), ...eventOps(), ...hookOps(() => this.vaultPlugins.hooks), ...scheduleOps(() => this.scheduler)]
    return [...this.core.map((op) => ({ op, plugin: null })),
      ...this.on().flatMap((p) => p.ops.map((op) => ({ op, plugin: p.id as string | null })))]
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
      const tree = (await this.respond("GET", ["files"], {}, {}, undefined, true)).body as Item
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
        return bodyOrThrow(await this.respond(method, parts, query, body, http, true))
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
  async ownerWhy(http: IncomingMessage, what: string) {
    return ownerRefusal(http, {}, what)
  }

  /** dispatch() as an answer (errors as replies; a bug still throws). */
  private async dispatchOrReply(method: string, parts: string[], query: Record<string, string>, body: unknown, http?: IncomingMessage): Promise<Reply> {
    try {
      return asReply(await this.dispatch(method, parts, query, body, http))
    } catch (e) {
      const out = errorReply(e)
      if (out) return out
      throw e
    }
  }

  /** /api/ops: GET the catalog or one entry, POST runs one (`?as=text`: its answer as Markdown; `?as=answer`: that and
   *  its picture, for `vau mcp`). */
  private async opsRoute(method: string, parts: string[], query: Record<string, string>, body: unknown, http?: IncomingMessage): Promise<unknown> {
    if (method === "GET" && parts.length === 0) {
      if (query.as === "text") return new Text(this.opsDoc() + "\n")
      // ?word=: only the ops a command line starting with it can name (`vau <word> ...` asks, not for all of them each time)
      const w = query.word
      return w ? this.ops().filter(({ op }) => op.id === w || op.id.startsWith(`${w}.`) || op.cli?.split(" ")[0] === w).map(({ op, plugin }) => entryOf(op, plugin)) : this.catalog()
    }
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
    const { result, text, image } = await this.callOp(parts[0], given, undefined, { synced: true, http, input: raw ? http : undefined })
    if (query.as === "answer") return { text, ...(image ? { image } : {}) }
    return query.as !== "text" ? result ?? null : new Text(text)
  }

  // ---------- holding the vault, calling ops and the API in-process, events (core/events.ts) ----------

  /** fn with the vault held (a write: synced first, then nobody else's write until it's done), as server.ts runs every
   *  write request; at once when this call already holds it (an op run by an op). Then plugins it turned on: followPlugins. */
  hold<T>(fn: () => Promise<T> | T, { trusting = false } = {}): Promise<T> {
    if (this.holding.getStore()?.on) return Promise.resolve().then(fn)
    return this.vault.lock(async () => {
      const token = { on: true }
      try {
        return await this.holding.run(token, async () => {
          if (!trusting || !this.vault.vouched()) await this.vault.sync() // (the app's writes trust the watcher: Vault.synced)
          this.pagesOf = this.onKey()
          try { return await fn() } finally { await this.loadPlugins().then(() => this.followPlugins(), (e) => console.error("plugins:", e)) }
        })
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
    return this.requestStarted({ t: Date.now(), method, route, query, client: who.client, agent: who.agent, label: who.label, command, ua: "", remote: "", port: 0, forwarded: false })
  }

  /** Run an op as every surface does: a read after a sync, unheld; a write holding the vault (unless `lock: false`),
   *  as `who`, then `op.done` on the events. Throws OpError; `report` tells request watchers (Activity). */
  async callOp(name: string, given: unknown, who: Who = this.who(), opts: { synced?: boolean; report?: string; http?: IncomingMessage; input?: Readable } = {}) {
    const hit = this.opNamed(name)
    if (!hit) throw this.noOp(name)
    const { op, plugin } = hit
    const write = op.kind !== "read"
    const run = () => requestWriter.run(writerAs(who), () => this.runOp(op.id, given, { who, http: opts.http, input: opts.input }))
    const t0 = performance.now()
    const end = this.reported("POST", `ops/${op.id}`, {}, who, opts.report)
    try {
      const out = this.holding.getStore()?.on ? await run() : write && op.lock !== false ? await this.hold(run)
        : opts.synced ? await run() : await this.vault.synced().then(run)
      const text = op.text ? op.text(out.result, out.params, who) : typeof out.result === "string" ? out.result
        : jsonBlock(out.result ?? null)
      const image = op.image?.(out.result) ?? null
      if (write) this.done(op, plugin, who, out.params, null, t0)
      end?.({ status: 200, ms: performance.now() - t0, body: given })
      return { entry: entryOf(op, plugin), params: out.params, result: out.result, text, image }
    } catch (e) {
      if (write) this.done(op, plugin, who, given, e, t0)
      end?.({ status: e instanceof OpError || e instanceof HTTPError || e instanceof ConfigError ? e.status : 500, ms: performance.now() - t0, body: given, error: String((e as Error)?.message ?? e) })
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

  /** The one way into the API, over HTTP (run) or in-process: a read after a sync (unless `synced`), a write held from
   *  its sync to its last write (at once inside a hold); `lock: false` routes and ops sync like a read. */
  private async respond(method: string, parts: string[], query: Record<string, string>, body: unknown, http?: IncomingMessage, synced = false): Promise<Reply> {
    if (method === "GET" && query.patch !== undefined) {
      const { patch: since, ...rest } = query
      return this.patched(`${parts.join("/")}?${new URLSearchParams(rest)}`, since, await this.respond(method, parts, rest, body, http, synced))
    }
    const go = () => this.dispatchOrReply(method, parts, query, body ?? {}, http)
    if (this.holding.getStore()?.on || this.unsynced(method, parts)) return go()
    if (method === "GET" || this.unlocked(method, parts)) return synced ? go() : this.vault.synced({ trusting: this.trusts(http), drained: !!http?.socket }).then(go)
    return this.hold(go, { trusting: this.trusts(http) })
  }

  /** A route of the API in-process as `who` (for plugins: plugin.host.api): its body without private keys (text for a
   *  text answer); a 4xx or 5xx throws an OpError with its message. `report`: as callOp's. */
  async apiAs(method: string, route: string, body?: unknown, who: Who = this.who(), opts: { report?: string; http?: IncomingMessage } = {}): Promise<unknown> {
    const t0 = performance.now()
    const { parts, query } = routeOf(route)
    const end = this.reported(method, parts.join("/"), query, who, opts.report)
    let res: Reply
    try {
      res = await requestWriter.run(writerAs(who), () => this.respond(method, parts, query, body, opts.http))
    } catch (e) {
      end?.({ status: 500, ms: performance.now() - t0, body })
      throw e
    }
    end?.({ status: res.status, ms: performance.now() - t0, body, ...(res.status >= 400 ? { error: String((res.body as Item)?.error ?? "") } : {}) })
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
      did: (name, params) => { const hit = this.opNamed(name); return hit ? didOf(hit.op, params) : null },
      emit: (type, data) => bus.emit(type, data ?? {}),
      devices: () => this.presence?.list() ?? [],
      tell: (device, msg) => this.presence?.tell(device, msg) ?? 0,
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
        if (seen) runHook(p.id, "onEvent", () => fn(seen))
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
  if (e instanceof WriteRefused) return reply(403, { error: e.message })
  if (e instanceof ConflictError) return reply(409, { error: e.message })
  if (notHereYet(e)) return reply(503, { error: (e as Error).message }) // (iCloud hasn't brought a file down yet)
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
 *  frozen (state(), the graph): it's serialized once, from its frozen items' JSON (core/statepatch.ts). */
export function jsonOf(body: unknown): string | Buffer {
  if (body === null || typeof body !== "object" || !Object.isFrozen(body)) return JSON.stringify(publicOf(body) ?? null)
  let data = serialized.get(body)
  if (!data) serialized.set(body, data = Buffer.from(SP.jsonOf(SP.snapshot(publicOf(body)))))
  return data
}

/** Open a vault: load the plugins, read every file (writing nothing outside .vaultite/). The event loop turns between
 *  steps, so a starting server answers its web app's files meanwhile. */
export async function open(vaultPath: string, { start = true, timing }: { start?: boolean; timing?: { mark(part: string): void } } = {}) {
  fs.mkdirSync(vaultPath, { recursive: true })
  // A vault the app has never opened (no .vaultite/ yet): it starts from Standard (core/start.ts); the pages of the
  // plugins its pick turns on come when it picks its setup (core/bundles.ts offering).
  const fresh = start && !fs.existsSync(path.join(vaultPath, ".vaultite"))
  const kept = start ? keepReads(vaultPath) : null
  const app = await new App(vaultPath).init(timing)
  if (fresh) B.markNew(app.vault)
  if (start) {
    await migrate(app.vault, fresh)
    accessToMachine(app.vault, app.plugins)
    app.tidyPluginLists()
    B.tidy(app.vault)
    await turn()
    await app.vault.sync()
    kept?.()
    timing?.mark("vault read")
    if (fresh) await setUpNew(app.host()).catch((e) => console.error("setting up the new vault:", e))
    // (in the background: it waits on the network)
    app.moving = migrateMoved({ vault: app.vault, has: (id) => app.app.some((p) => p.id === id),
      install: (source) => installFrom(app, source, null, { moved: true }) }).catch((e) => console.error("installing the plugins that moved out of the app:", e))
  }
  return app
}
