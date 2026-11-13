import { AsyncLocalStorage } from "node:async_hooks"
import crypto from "node:crypto"
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import type { Readable } from "node:stream"
import path from "node:path"
import { setImmediate as turn } from "node:timers/promises"
import * as Look from "./appearance.ts"
import * as B from "./bundles.ts"
import { CONNECT_HEADER, overNetwork, ownerRefusal } from "./owner.ts"
import { MARKER as SANDBOX_MARKER, newSandbox } from "./sandbox.ts"
import { accessToMachine, allDone, cachesToKept, migrate, migrateMoved } from "./migrations.ts"
import { installFrom } from "./coreops/installs.ts"
import * as F from "./files.ts"
import { saveBody } from "./contracts/save.ts"
import * as O from "./outside.ts"
import * as pages from "./pages.ts"
import { setUpNew } from "./start.ts"
import type { ServerError } from "./serverlog.ts"
import type { Present } from "./live.ts"
import { enabled, hostOps, HTTPError, LOADED, LOCAL, load as loadPlugins, vaultHere, match, matchServed, type Plugin, propertyTypes, Reply, reply, type RequestEnd, type RequestStart, Request, service, settingDefaults, Text } from "./plugins.ts"
import { readTypes } from "./proptypes.ts"
import { blockOn, blockSources, render } from "./render.ts"
import { type BlockDecls, COMMON, drawnBy, drawsOf, type OptionDecl } from "./blocks.ts"
import { topic, topics } from "./docs.ts"
import * as SC from "./statechunks.ts"
import * as SP from "./statepatch.ts"
import { coreOps } from "./coreops.ts"
import { SETTINGS } from "./coreops/settings.ts"
import { keptOf } from "./kept.ts"
import { filing } from "./filing.ts"
import { checkParams, didOf, entryOf, jsonBlock, nearest, type Op, type OpCtx, OpError, opsDoc, pathAsSaid, type Who, whoOf } from "./ops.ts"
import { eventOps, eventsOf, matching, summary, typeMatches, type VaultEvent } from "./events.ts"
import { ARCHIVED, setMarks } from "./fileprops.ts"
import { hookOps } from "./hooks.ts"
import { type Listed, Scheduler, scheduleOps, timed } from "./schedule.ts"
import { digestOf, VaultPlugins } from "./vaultplugins.ts"
import * as G from "./grants.ts"
import { byUser, notHereYet, onItsOwn, overConnect, runHook, WriteRefused } from "./writegate.ts"
import { asLocked, type Fetched, fetchSource, parseSource, readLock } from "./installs.ts"
import { autoUpdates } from "./updates.ts"
import { disclosuresOf, saysMore } from "./pluginmeta.ts"
import { browse, PluginIndex } from "./pluginindex.ts"
import { API_VERSION, APP_VERSION } from "./version.ts"
import { ConfigError, ConflictError, type Item, type Kind, NotFound, publicOf, requestWriter, Vault, type Writer } from "./vault.ts"
import { isObj, strings } from "./values.ts"
import { keepReads } from "./fmcache.ts"
import { logger } from "./log.ts"

const log = logger("app")

const KEEP = 32

type Snap = { v: string; state: Item; piece: SP.Piece; whole?: Buffer; patches: Map<string, string>; tree?: SC.ChunkNode }
const CHUNK_KEEP = 4


function writerAs(who: Who): Writer {
  const w = requestWriter.getStore()
  return w && w.client === who.client && whoOf(w.client, w.agent).agent === who.agent ? { ...w, agent: who.agent } : { client: who.client, agent: who.agent }
}

export class App {
  vault: Vault
  plugins: Plugin[] = []
  app: Plugin[] = []
  vaultPlugins!: VaultPlugins
  index: PluginIndex
  private stated: { version: string; plugins: Plugin[]; state: Item } | null = null
  private snaps: Snap[] = []
  private chunks = new Map<string, string>()
  private chunked: Set<string>[] = []
  private boot = Date.now().toString(36)
  private seq = 0
  private pagesOf = ""
  ui: ((message: Item | null) => unknown) | null = null
  presence: { list: () => Present[]; tell: (device: string, msg: Item) => number } | null = null
  liveMark: (() => Item) | null = null
  moving: Promise<void> = Promise.resolve()
  private core: Op[] | null = null
  private holding = new AsyncLocalStorage<{ on: boolean }>()
  scheduler: Scheduler
  private self: [number, Promise<string | null>] | null = null

  constructor(vaultPath: string) {
    this.vault = new Vault(vaultPath)
    this.index = new PluginIndex(this.vault)
    this.scheduler = new Scheduler({
      file: path.join(LOCAL, "schedules", `${vaultHere(vaultPath).key}.json`),
      jobs: () => {
        return [{ plugin: "core", job: { name: "trash", every: "1d", run: () => F.emptyTrash(this.vault) } },
          { plugin: "core", job: { name: "plugin-updates", every: "1h", run: () => Object.keys(readLock(this.vault)).length ? this.runOp("plugin.update", { auto: true }) : null } },
          ...this.on().flatMap((p): Listed[] => p.jobs.flatMap((j) => {
            const t = timed(j, (k) => p.settingText(k))
            return "job" in t ? [{ plugin: p.id, job: t.job }] : []
          }))]
      },
      here: (machine) => this.runsHere(machine),
      before: async () => { await this.syncPlugins(); await this.checkWriter() },
      paused: () => [...this.vaultPlugins.paused().flatMap((p) => p.jobs.map((job) => ({ plugin: p.id, job,
        why: `${p.name} changed and waits for you to allow it again (vau plugin allow ${p.id})` }))),
      ...this.on().flatMap((p) => p.jobs.flatMap((job) => {
        const t = timed(job, (k) => p.settingText(k))
        return "why" in t ? [{ plugin: p.id, job, why: t.why }] : []
      }))],
    })
  }

  private async runsHere(machine?: string) {
    const ids = strings(service(this.on(), "machines:ids")?.())
    if (!ids.length) return !machine
    const writer = String(await Promise.resolve(service(this.on(), "machines:writer")?.()).catch(() => null) ?? "") || ids[0]
    if (!this.self || Date.now() - this.self[0] > 300_000) {
      const ask = service(this.on(), "machines:self")
      this.self = [Date.now(), Promise.resolve(ask ? ask() : null).catch(() => null)]
    }
    return (await this.self[1]) === (machine ?? writer)
  }

  private async checkWriter() {
    try { this.vault.writerHere = await this.runsHere() } catch { /* as it was */ }
  }

  async init(timing?: { mark(part: string): void }) {
    await this.vault.fetchSettings()
    this.app = await loadPlugins(this.vault)
    timing?.mark("plugins")
    this.plugins = this.app
    this.vault.plain = () => { const f = service(this.plugins, "templates:folder")?.(); return [...typeof f === "string" && f ? [f] : [], ...this.vault.samples()] }
    this.vault.defaults = () => settingDefaults(this.vault, this.plugins)
    this.vault.mayWrite = (id, rel) => G.may(this.vault, this.plugins, id, rel, this.vault.writerHere)
    this.vault.writeRefused = (id, rel) => {
      if (!this.vault.writerHere && G.generated(this.vault, this.plugins, id, rel)) return
      const asking = G.refused(this.vault, this.plugins, id, rel)
      eventsOf(this.vault).emit("plugin.write-refused", { plugin: id, path: rel, asking })
    }
    this.vaultPlugins = new VaultPlugins(this.vault, this.app)
    this.vaultPlugins.blocked = (vp) => this.index.blockedWhy(vp.id, vp.manifest.version ?? null,
      [readLock(this.vault)[vp.id]?.repo, vp.manifest.repo ?? null])
    this.wire()
    await this.syncPlugins()
    timing?.mark("vault plugins")
    this.pagesOf = this.onKey()
    if (Object.keys(readLock(this.vault)).length) this.index.refreshIfStale()
    return this
  }

  tidyPluginLists() {
    const conf = this.vault.config("plugins")
    const disabled = strings(conf.disabled), enabled = strings(conf.enabled), both = disabled.filter((id) => enabled.includes(id))
    if (!both.length) return
    const optIn = (id: string) => { const p = this.app.find((x) => x.id === id); return !p || !!p.manifest.offByDefault }
    this.vault.patchConfig("plugins", { disabled: disabled.filter((id) => !both.includes(id) || !optIn(id)), enabled: enabled.filter((id) => !both.includes(id) || optIn(id)) })
  }

  async syncPlugins({ pages: write = true, trusting = false } = {}) {
    const key = `${this.vault.heardCount}:${this.vault.settingsVersion}:${this.vaultPlugins.trust.version}:${this.index.version}`
    if (trusting && this.pluginsSynced === key && this.vault.vouched()) return false
    const changed = await this.loadPlugins()
    this.pluginsSynced = key
    this.adopt()
    this.tellPaused()
    this.followPlugins(write)
    return changed
  }

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

  private pluginsSynced = ""

  trusts(http?: IncomingMessage) {
    if (!http?.socket) return false
    return String(http.headers["x-vaultite-client"] ?? "").startsWith("app/") || overNetwork(http)
  }

  private adopting = new Map<string, number>()

  private adopt() {
    const lock = readLock(this.vault)
    const vps = this.vaultPlugins
    for (const vp of vps.found.values()) {
      const l = lock[vp.id], a = vps.trust.approval(vp.id)
      if (!l?.history?.length || !a || a.edits || !asLocked(vp.dir, l, vp.digest.content) || vps.trust.approved(vp.id, vp.digest)) continue
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
          await this.tellUpdated([{ id: vp.id, name: vp.manifest.name ?? vp.id, to: l.version, notes: u.to === l.version ? u.notes : [] }])
        } catch (e) {
          log.error(`plugin updates: ${vp.id} couldn't be checked against its source: ${messageOf(e)}`)
        } finally {
          f?.done()
          vps.adopting.delete(vp.id)
        }
      })()
    }
  }

  async notice(e: Item, button = "Open"): Promise<Item | null> {
    const add = service(this.on(), "inbox:event")
    if (add) return await add(e)
    if (!this.ui) throw new OpError("no inbox to keep it and no window to show it", 503)
    await this.ui({ action: "notify", text: e.title, kind: e.kind === "error" ? "error" : null, ...(e.link ? { button: { label: button, open: e.link } } : {}) })
    return null
  }

  async tellUpdated(rows: { id: string; name: string; to: string; notes?: string[] }[]) {
    if (!rows.length) return
    const one = rows.length === 1 ? rows[0] : null
    const title = one ? `${one.name} updated to ${one.to}${one.notes?.length ? `: ${one.notes[0]}` : ""}`
      : `${rows.length} plugins updated: ${rows.map((r) => `${r.name} ${r.to}`).join(", ")}`
    try { await this.notice({ source: "plugins", kind: "info", title, link: one ? `detail:plugin/${one.id}` : "view:plugins" }, "What's new") } catch { /* no window */ }
  }

  private pausedTold = new Set<string>()

  private tellPaused() {
    const vps = this.vaultPlugins
    const paused = vps.paused()
    for (const id of this.pausedTold) {
      if (paused.some((p) => p.id === id)) continue
      this.pausedTold.delete(id)
      service(this.on(), "inbox:done")?.("plugins", `paused:${id}`)
    }
    const add = service(this.on(), "inbox:event")
    for (const p of paused) {
      const jobs = p.jobs.map((j) => `${j.name} (every ${j.every}${j.at ? ` at ${j.at}` : ""})`)
      const title = `${p.name} changed and is paused until you allow it again${jobs.length ? `: ${jobs.join(", ")} won't run` : ""}`
      const body = `Changed: ${p.changed.join(", ")}. Allow it: vau plugin allow ${p.id}`
      const e = { source: "plugins", kind: "waiting", title, body, link: `detail:plugin/${p.id}`, key: `paused:${p.id}`, stays: true }
      const first = vps.trust.tellPaused(p.id)
      if (first) { log.error(`${title}. ${body}`); if (!add) this.notice(e, "Review").catch(() => {}) }
      if (add) Promise.resolve(add(e)).then(() => { this.pausedTold.add(p.id) }, () => {})
    }
  }

  private onKey() {
    const conf = this.vault.config("plugins"), list = (k: string) => strings(conf[k])
    const own = (p: Plugin) => !list("disabled").includes(p.id) && (!(p.manifest.offByDefault || p.tier === "vault") || list("enabled").includes(p.id))
    const set = enabled(this.vault, this.plugins)
    if (conf.ai === false) for (const p of this.plugins) if (p.manifest.ai === true && own(p)) set.add(p.id)
    const on = [...set].sort().join(",")
    return B.offering(this.vault) ? `offering:${on}` : on
  }

  blocks() {
    const on = enabled(this.vault, this.plugins)
    const loaded = new Map(this.plugins.map((p) => [p.id, p]))
    const drawers = (block: string) => this.plugins.filter((p) => drawsOf(p.manifest).includes(block))
    const rows: BlockRow[] = []
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
    for (const p of this.app) add(p.id, p.manifest.name ?? p.id, p.tier, p.blocks, new Set(p.textBlocks.keys()), drawsOf(p.manifest))
    for (const v of this.vaultPlugins.list()) {
      const p = loaded.get(v.id)
      add(v.id, v.name, "vault", v.blocks, p ? new Set(p.textBlocks.keys()) : null, v.draws)
    }
    return { common: COMMON, blocks: rows }
  }

  private followPlugins(write = true) {
    const key = this.onKey(), was = this.pagesOf
    this.pagesOf = key
    if (!write || key === was || key.startsWith("offering:") || !this.holding.getStore()?.on) return []
    const offered = was.startsWith("offering:"), before = new Set((offered ? was.slice("offering:".length) : was).split(","))
    return pages.writePages(this.vault, this.plugins, key.split(",").filter((id) => id && !before.has(id)), { pin: !offered })
  }

  async state() {
    const kept = keptOf(this.vault.path)
    const version = `${this.vault.version}:${this.vault.settingsVersion}:${this.vaultPlugins.trust.version}:${this.index.version}:${kept.stateVersion}`, plugins = this.plugins
    const same = this.stated && this.stated.version === version && this.stated.plugins === plugins &&
      !this.vaultPlugins.loaded().some((p) => p.stateFn)
    if (same) return this.stated!.state
    const out: Item = {}
    await kept.readingFor(async () => { for (const p of this.plugins) Object.assign(out, await p.getState()) })
    out.vault = { path: this.vault.path, problems: this.vault.problemList(), downloading: this.vault.downloading, ...(fs.existsSync(this.vault.abs(SANDBOX_MARKER)) ? { sandbox: true } : {}) }
    out.files = F.tree(this.vault)
    out.vaultPlugins = this.vaultPlugins.list()
    out.app = { version: APP_VERSION, api: API_VERSION }
    out.config = Object.fromEntries(SETTINGS.map((n) => [n, this.vault.config(n)]))
    out.propertyTypes = { types: propertyTypes(this.vault, this.plugins), own: Object.keys(readTypes(this.vault.config("types"))) }
    out.kinds = Object.fromEntries(this.vault.kinds.filter((k) => k.spec.sections?.length || k.spec.stamps?.length)
      .map((k) => [k.collection, { sections: k.spec.sections ?? [], stamps: k.spec.stamps ?? [] }]))
    out.appearance = { themes: Look.listThemes(this.vault), snippets: Look.listSnippets(this.vault) }
    out.pluginSettings = settingsFiles(this.vault.path)
    out.writeGrants = G.grantList(this.vault, this.plugins)
    out.settingDefaults = settingDefaults(this.vault, this.plugins)
    out.filing = filing(this.vault)
    out.bundles = B.status(this.vault)
    this.stated = { version, plugins, state: Object.freeze(out) }
    return out
  }

  async stateSince(since: string, http?: IncomingMessage) {
    const mark = this.liveMark?.()
    const now = this.snap(await this.state())
    const v = JSON.stringify(now.v)
    let out: string | Buffer
    if (since === now.v) out = `{"v":${v},"since":${v},"patch":null}`
    else if (this.snaps.some((s) => s.v === since)) {
      let patch = now.patches.get(since)
      if (patch === undefined) now.patches.set(since, patch = SP.patchOf(this.snaps.find((s) => s.v === since)!.piece, now.piece) ?? "null")
      out = `{"v":${v},"since":${JSON.stringify(since)},"patch":${patch}}`
    // (kept as UTF-8 bytes: half a string's size when a character outside Latin-1 makes it two bytes a character)
    } else out = now.whole ??= Buffer.from(`{"v":${v},"state":${SP.jsonOf(now.piece)}}`)
    const extra = [mark ? `"live":${JSON.stringify(mark)}` : "", http && CONNECT_HEADER in http.headers ? `"here":"connect"` : ""].filter(Boolean)
    if (extra.length) out = Buffer.concat([Buffer.from(`{${extra.join(",")},`), (typeof out === "string" ? Buffer.from(out) : out).subarray(1)])
    return new Text(out, "application/json")
  }

  async stateManifest(http?: IncomingMessage) {
    const mark = this.liveMark?.()
    const now = this.snap(await this.state())
    if (SC.sizeOf(now.piece) < SC.WHOLE_UNDER) return this.stateSince("0", http)
    if (!now.tree) {
      const made = new Map<string, string>()
      now.tree = SC.chunkState(now.piece, (t) => crypto.hash("sha256", t, "base64url").slice(0, 22), made)
      for (const [h, t] of made) this.chunks.set(h, t)
      this.chunked.push(new Set(made.keys()))
      if (this.chunked.length > CHUNK_KEEP) for (const h of this.chunked.shift()!) if (!this.chunked.some((g) => g.has(h))) this.chunks.delete(h)
    }
    const m: SC.Manifest = { v: now.v, tree: now.tree, ...(mark ? { live: mark } : {}), ...(http && CONNECT_HEADER in http.headers ? { here: "connect" } : {}) }
    return new Text(JSON.stringify(m), "application/json", { "X-Vaultite-Chunks": "1" })
  }

  private snap(state: Item): Snap {
    const last = this.snaps.at(-1)
    if (last?.state === state) return last
    const piece = SP.snapshot(publicOf(state), last?.piece)
    const patch = last ? SP.patchOf(last.piece, piece) : null
    if (last && patch === null) { last.state = state; return last }
    const snap: Snap = { v: `${this.boot}.${++this.seq}`, state, piece, patches: new Map() }
    if (last) {
      snap.patches.set(last.v, patch!)
      last.whole = undefined
      last.patches.clear()
    }
    this.snaps.push(snap)
    if (this.snaps.length > KEEP) this.snaps.shift()
    return snap
  }

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
  private answers = new Map<string, { v: string; body: object; piece: SP.Piece }[]>()

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

  private on() {
    const off = this.vault.switchedOff()
    return off.size ? this.plugins.filter((p) => !off.has(p.id)) : this.plugins
  }

  private pluginsStamp = -1

  requestStarted(start: RequestStart): (end: RequestEnd) => void {
    let stamp = 0
    try { stamp = fs.statSync(this.vault.abs(".vaultite/plugins.json")).mtimeMs } catch { /* none: all on */ }
    if (stamp !== this.pluginsStamp) { this.pluginsStamp = stamp; this.vault.forgetConfig("plugins") }
    const ends: ((end: RequestEnd) => void)[] = []
    for (const p of this.on()) {
      for (const fn of p.requestFns) {
        try { const end = fn(start); if (end) ends.push(end) } catch (e) { log.error("a plugin's request hook failed", e) }
      }
    }
    return (end) => { for (const fn of ends) { try { fn(end) } catch (e) { log.error("a plugin's request-end hook failed", e) } } }
  }

  serverError(e: ServerError) {
    for (const p of this.on()) for (const fn of p.errorFns) { try { fn(e) } catch { /* not logged: it would come back here */ } }
  }

  changed(paths: string[] | null) {
    for (const p of this.on()) for (const fn of p.changeFns) runHook(p.id, "onChange", () => fn(paths))
  }

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
      log.error(`a plugin's ${prefix} route failed`, e, { path: rest })
      return reply(500, new Text(messageOf(e), "text/plain; charset=utf-8"))
    }
  }

  unlocked(method: string, parts: string[]) {
    if (method === "POST" && parts.length === 2 && parts[0] === "ops") return true
    if (this.streams(method, parts)) return true
    const o = match(this.plugins, method, parts)?.[2]
    return o?.lock === false || o?.sync === false
  }

  unsynced(method: string, parts: string[]) {
    return match(this.plugins, method, parts)?.[2].sync === false
  }

  streams(method: string, parts: string[], type = "") {
    if (method === "POST" && parts.length === 1 && parts[0] === "upload") return true
    if (method === "POST" && parts.length === 2 && parts[0] === "ops") return !!type && !/json/i.test(type) && !!this.opNamed(parts[1])?.op.input
    return match(this.plugins, method, parts)?.[2].stream === true
  }

  async run(method: string, parts: string[], query: Record<string, string>, body: unknown, http?: IncomingMessage): Promise<Reply> {
    try {
      const h = (k: string) => { const v = http?.headers[k]; return typeof v === "string" && v ? v.slice(0, 200) : null }
      const actor = h("x-vaultite-actor"), as = <T>(fn: () => T) => (actor ? onItsOwn(actor, fn) : byUser(fn))
      const go = () => this.respond(method, parts, query, body, http)
      const writer = { client: h("x-vaultite-client"), agent: h("x-vaultite-agent"), terminal: h("x-vaultite-terminal"), session: h("x-vaultite-session"),
        model: h("x-vaultite-model"), effort: h("x-vaultite-effort") }
      const via = <T>(fn: () => T) => (http && CONNECT_HEADER in http.headers ? overConnect(fn) : fn())
      return http ? await via(() => as(() => requestWriter.run(writer, go))) : await go()
    } catch (e) {
      log.error("a request failed", e)
      return reply(500, { error: messageOf(e) })
    }
  }

  private async dispatch(method: string, parts: string[], query: Record<string, string>, body: unknown, http?: IncomingMessage): Promise<unknown> {
    const obj: Item = isObj<Item>(body) ? body : {}
    if (parts[0] === "ops") return await this.opsRoute(method, parts.slice(1), query, body, http)
    if (parts.join("/") === "file" && O.isOutside(method === "GET" ? query.path : obj.path)) return O.handle(method, method === "GET" ? query.path : obj.path, saveBody(obj))
    if (parts.join("/") === "file/info" && method === "GET" && O.isOutside(query.path)) return O.info(query.path)
    if (method === "POST" && parts.join("/") === "upload") return await F.upload(this.vault, query, obj, http, (fn) => this.hold(fn))
    const res = (await F.handle(this.vault, method, parts, query, obj)) ?? Look.handle(this.vault, method, parts, obj)
    if (res !== undefined) return res
    if (parts[0] === "plugins" && method === "GET") {
      if (parts.length === 1) return this.vaultPlugins.list()
      // (its version in the path: a chunk importing ./bundle.js gets the same module the app imported)
      if (parts.length === 4 && parts[3].endsWith(".js")) {
        const code = this.vaultPlugins.code(parts[1], parts[2], parts[3])
        if (code === null) throw new HTTPError(404, `no ${parts[3]} of a vault plugin '${parts[1]}' that's on and built at ${parts[2]}`)
        return new Text(code, "text/javascript; charset=utf-8", { "Cache-Control": "private, max-age=31536000, immutable" })
      }
    }
    if (parts.join("/") === "blocks" && method === "GET") return this.blocks()
    if (parts.join("/") === "blocks/sources" && method === "GET") return await blockSources(this.vault, this.plugins, query)
    if (parts[0] === "docs" && method === "GET" && parts.length <= 2) {
      if (parts.length === 1) return topics(this.plugins).map(({ id, title, plugin }) => ({ id, title, plugin }))
      return new Text(topic(this.plugins, parts[1]).text + "\n", "text/markdown; charset=utf-8")
    }
    if (parts.join("/") === "bundles/browse" && method === "GET") return await this.bundleDirectory(query.q ?? "", query.refresh === "1")
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
    if (route === "state" && method === "GET") return query.since !== undefined ? await this.stateSince(query.since, http) : await this.state()
    if (route === "state/manifest" && method === "GET") return await this.stateManifest(http)
    if (parts.length === 3 && route.startsWith("state/chunk/") && method === "GET") {
      const text = this.chunks.get(parts[2])
      if (text === undefined) throw new HTTPError(404, "no such chunk of the state (ask for the manifest again)")
      return new Text(text, "application/json", { "Cache-Control": "private, max-age=31536000, immutable" })
    }
    if (route === "render" && method === "GET") return new Text(await render(this.vault, this.plugins, query.path))
    if (route === "render/block" && method === "GET") return new Text(await blockOn(this.vault, this.plugins, query))
    if (route === "vault" && method === "GET") return { path: this.vault.path, problems: this.vault.problemList() }
    if (parts.length === 2 && parts[0] === "config" && SETTINGS.includes(parts[1])) {
      if (method === "PUT" || method === "PATCH") {
        if (!isObj<Item>(body)) {
          if (method === "PATCH") throw new HTTPError(400, "send an object of the keys to change")
          this.vault.setConfig(parts[1], body)
        } else this.vault.patchConfig(parts[1], body, { nullRemoves: method === "PATCH" })
      }
      return this.vault.config(parts[1])
    }
    if (parts.length === 3 && parts[0] === "config" && parts[1] === "plugin" && /^[a-z0-9][a-z0-9-]*$/.test(parts[2])) {
      const p = this.plugins.find((x) => x.id === parts[2]), name = `plugins/${parts[2]}/data`
      if (method === "PUT" || method === "PATCH") {
        if (!isObj<Item>(body)) throw new HTTPError(400, "send an object of the keys to change")
        const local = p?.localKeys().filter((k) => Object.hasOwn(body, k)) ?? []
        const why = local.length && http ? await this.ownerWhy(http, `changing ${local.join(", ")}`) : ""
        if (why) throw new HTTPError(403, why)
        return p ? p.patchSettings(body, { nullRemoves: method === "PATCH" }) : this.vault.patchConfig(name, body, { nullRemoves: method === "PATCH" })
      }
      return p ? p.settings() : this.vault.config(name)
    }
    if (route === "config/plugin" && method === "GET") {
      const ids = String(query.ids ?? "").split(",").filter((id) => /^[a-z0-9][a-z0-9-]*$/.test(id)).slice(0, 500)
      return Object.fromEntries(ids.map((id) => [id, this.plugins.find((x) => x.id === id)?.settings() ?? this.vault.config(`plugins/${id}/data`)]))
    }
    if (parts.length && this.vault.has(parts[0])) return await this.crud(method, this.vault.kind(parts[0]), parts.slice(1).join("/") || null, body)
    return reply(404, { error: "not found" })
  }

  async bundleDirectory(q: string, refresh: boolean) {
    const got = await this.index.get(refresh)
    return { url: got.url, available: got.available, fetched: got.fetched, ...(got.error ? { error: got.error } : {}), bundles: browse(got.index, q, B.imports(this.vault)) }
  }

  ops(): { op: Op; plugin: string | null }[] {
    this.core ??= [...coreOps(this), ...eventOps(), ...hookOps(() => this.vaultPlugins.hooks), ...scheduleOps(() => this.scheduler)]
    return [...this.core.map((op) => ({ op, plugin: null })),
      ...this.on().flatMap((p) => p.ops.map((op) => ({ op, plugin: p.id })))]
  }

  opNamed(name: string) {
    const all = this.ops()
    return all.find((o) => o.op.id === name) ?? all.find((o) => o.op.cli === name) ?? null
  }

  catalog() {
    return this.ops().map(({ op, plugin }) => entryOf(op, plugin))
  }

  opsDoc() {
    return opsDoc(this.catalog())
  }

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
    const paths = Object.entries(op.params ?? {}).filter(([k, p]) => p.format === "path" && params[k] !== undefined)
    if (paths.length) {
      const tree = F.tree(this.vault)
      for (const [k, p] of paths) {
        const said = (x: string) => pathAsSaid(tree, x, { root: this.vault.path, outside: p.outside })
        params[k] = p.type === "array" ? strings(params[k]).map(said) : said(String(params[k]))
      }
    }
    const ctx: OpCtx = {
      vault: this.vault,
      who,
      plugin,
      op: async (id, p, input) => (await this.runOp(id, p ?? {}, { who, http, input })).result,
      api: async (method, route, body) => {
        const { parts, query } = routeOf(route)
        return bodyOrThrow(await this.respond(method, parts, query, body, http, true))
      },
      ui: (message) => this.driveUi(message),
      refusal,
      ...(input && op.input ? { input } : {}),
    }
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
        log.error(`${by}'s hook around ${op.id} failed`, e)
        return await next()
      }
    }
    return { op, params, result: await step(0, params), who }
  }

  async ownerWhy(http: IncomingMessage, what: string) {
    return ownerRefusal(http, {}, what)
  }

  private async dispatchOrReply(method: string, parts: string[], query: Record<string, string>, body: unknown, http?: IncomingMessage): Promise<Reply> {
    try {
      return asReply(await this.dispatch(method, parts, query, body, http))
    } catch (e) {
      const out = errorReply(e)
      if (out) return out
      throw e
    }
  }

  private async opsRoute(method: string, parts: string[], query: Record<string, string>, body: unknown, http?: IncomingMessage): Promise<unknown> {
    if (method === "GET" && parts.length === 0) {
      if (query.as === "text") return new Text(this.opsDoc() + "\n")
      const w = query.word
      if (query.actions) return this.ops().filter(({ op }) => op.action).map(({ op, plugin }) => entryOf(op, plugin))
      return w ? this.ops().filter(({ op }) => op.id === w || op.id.startsWith(`${w}.`) || op.cli?.split(" ")[0] === w).map(({ op, plugin }) => entryOf(op, plugin)) : this.catalog()
    }
    if (parts.length !== 1) return reply(404, { error: "not found" })
    if (method === "GET") {
      const hit = this.opNamed(parts[0])
      if (!hit) throw new OpError(`no operation '${parts[0]}' (GET /api/ops lists them)`, 404)
      return entryOf(hit.op, hit.plugin)
    }
    if (method !== "POST") return reply(405, { error: "POST /api/ops/<id> runs an op; GET lists them" })
    const raw = http && this.streams(method, ["ops", parts[0]], String(http.headers?.["content-type"] ?? ""))
    const given = raw ? Object.fromEntries(Object.entries(query).filter(([k]) => k !== "as")) : body
    const { result, text, image } = await this.callOp(parts[0], given, undefined, { synced: true, http, input: raw ? http : undefined })
    if (query.as === "answer") return { text, ...(image ? { image } : {}) }
    if (query.as === "both") return { result: result ?? null, text }
    return query.as !== "text" ? result ?? null : new Text(text)
  }

  hold<T>(fn: () => Promise<T> | T, { trusting = false } = {}): Promise<T> {
    if (this.holding.getStore()?.on) return Promise.resolve().then(fn)
    return this.vault.lock(async () => {
      const token = { on: true }
      try {
        return await this.holding.run(token, async () => {
          if (!trusting || !this.vault.vouched()) await this.vault.sync()
          this.pagesOf = this.onKey()
          try { return await fn() } finally { await this.loadPlugins().then(() => this.followPlugins(), (e) => log.error("loading the plugins failed", e)) }
        })
      } finally {
        token.on = false
      }
    })
  }

  private async driveUi(message: Item | null) {
    if (!this.ui) throw new OpError("the app's window can only be driven through the server (it isn't running one here)", 503)
    return await this.ui(message)
  }

  private who(): Who {
    const w = requestWriter.getStore()
    return whoOf(w?.client ?? null, w?.agent ?? null)
  }

  private reported(method: string, route: string, query: Record<string, string>, who: Who, command: string | undefined) {
    if (!command) return null
    return this.requestStarted({ t: Date.now(), method, route, query, client: who.client, agent: who.agent, label: who.label, command, ua: "", remote: "", port: 0, forwarded: false })
  }

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
      end?.({ status: e instanceof OpError || e instanceof HTTPError || e instanceof ConfigError ? e.status : 500, ms: performance.now() - t0, body: given, error: messageOf(e) })
      throw e
    }
  }

  private done(op: Op, plugin: string | null, who: Who, params: unknown, error: unknown, t0: number) {
    eventsOf(this.vault).emit("op.done", {
      id: op.id, plugin, kind: op.kind, who: { client: who.client, agent: who.agent, label: who.label },
      params: isObj<Item>(params) ? summary(params) : {},
      ok: !error, ...(error ? { error: messageOf(error).slice(0, 300) } : {}), ms: Math.round(performance.now() - t0),
    })
  }

  private noOp(name: string) {
    const near = nearest(name, this.ops().map((o) => o.op.id))
    return new OpError(`no operation '${name}'${near ? `: did you mean ${near}?` : ""} (vau ops lists them)`, 404)
  }

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
    end?.({ status: res.status, ms: performance.now() - t0, body, ...(res.status >= 400 ? { error: String(isObj<Item>(res.body) ? res.body.error ?? "" : "") } : {}) })
    return publicOf(bodyOrThrow(res))
  }

  private wire() {
    const bus = eventsOf(this.vault)
    hostOps(this.vault, {
      catalog: () => this.catalog(),
      call: (name, params, who, o) => this.callOp(name, params, who, { report: o?.report, http: o?.http, input: o?.input }),
      api: (method, route, body, who, o) => this.apiAs(method, route, body, who, o),
      did: (name, params) => { const hit = this.opNamed(name); return hit ? didOf(hit.op, params) : null },
      ui: (message) => this.driveUi(message),
      emit: (type, data) => bus.emit(type, data ?? {}),
      devices: () => this.presence?.list() ?? [],
      tell: (device, msg) => this.presence?.tell(device, msg) ?? 0,
    })
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
    if (k.file) {
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

export type BlockRow = { name: string; plugin: string; pluginName: string; tier: string; on: boolean; declared: boolean; text: boolean | null; description: string
  options: Record<string, OptionDecl> }

const messageOf = (cause: unknown) => String(cause instanceof Error ? cause.message : cause)

export const decodePart = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

export function queryOf(params: URLSearchParams) {
  const query: Record<string, string> = {}
  for (const [k, v] of params) if (v !== "" && !(k in query)) query[k] = v
  return query
}

function routeOf(route: string) {
  const at = route.indexOf("?")
  return { parts: (at < 0 ? route : route.slice(0, at)).split("/").filter(Boolean).map(decodePart), query: queryOf(new URLSearchParams(at < 0 ? "" : route.slice(at + 1))) }
}

const asReply = (x: unknown) => (x instanceof Reply ? x : reply(200, x))

function bodyOrThrow(res: Reply) {
  if (res.status >= 400) throw new OpError(String(isObj<Item>(res.body) ? res.body.error ?? res.status : res.status), res.status)
  return res.body instanceof Text ? String(res.body.text) : res.body
}

function errorReply(e: unknown): Reply | null {
  if (e instanceof OpError) return reply(e.status, { error: e.message, ...(e.problems.length ? { problems: e.problems } : {}) })
  if (e instanceof HTTPError || e instanceof ConfigError) return reply(e.status, { error: e.message })
  if (e instanceof NotFound) return reply(404, { error: e.message })
  if (e instanceof WriteRefused) return reply(403, { error: e.message })
  if (e instanceof ConflictError) return reply(409, { error: e.message })
  if (notHereYet(e)) return reply(503, { error: messageOf(e) })
  return null
}

function settingsFiles(vaultPath: string) {
  const dir = path.join(vaultPath, ".vaultite", "plugins")
  try {
    return fs.readdirSync(dir).filter((id) => !id.startsWith(".") && fs.existsSync(path.join(dir, id, "data.json"))).sort()
  } catch {
    return []
  }
}

const serialized = new WeakMap<object, Buffer>()

export function jsonOf(body: unknown): string | Buffer {
  if (body === null || typeof body !== "object" || !Object.isFrozen(body)) return JSON.stringify(publicOf(body) ?? null)
  let data = serialized.get(body)
  if (!data) serialized.set(body, data = Buffer.from(SP.jsonOf(SP.snapshot(publicOf(body)))))
  return data
}

export async function open(vaultPath: string, { start = true, timing, watch }: { start?: boolean; timing?: { mark(part: string): void }; watch?: (vault: Vault) => void } = {}) {
  fs.mkdirSync(vaultPath, { recursive: true })
  const fresh = start && !fs.existsSync(path.join(vaultPath, ".vaultite")), sandbox = start && newSandbox(vaultPath)
  const kept = start ? keepReads(vaultPath) : null
  const app = await new App(vaultPath).init(timing)
  app.vault.startTexts = kept?.texts ?? null
  if (fresh) B.markNew(app.vault)
  watch?.(app.vault)
  if (start) {
    if (sandbox) allDone(app.vault)
    await migrate(app.vault, fresh)
    accessToMachine(app.vault, app.plugins)
    cachesToKept(app.vault)
    app.tidyPluginLists()
    B.tidy(app.vault)
    await turn()
    await app.vault.sync()
    app.vault.startTexts = null
    kept?.done()
    timing?.mark("vault read")
    if (fresh) await setUpNew(app.host()).catch((e) => log.error("setting up the new vault failed", e))
    app.moving = migrateMoved({ vault: app.vault, has: (id) => app.app.some((p) => p.id === id),
      install: (source) => installFrom(app, source, null, { moved: true }) }).catch((e) => log.error("installing the plugins that moved out of the app failed", e))
  }
  return app
}
