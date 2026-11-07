// Device sync: each machine keeps the vault as plain files and trades versions with the others (the hub, any peer, the
// iCloud mailbox). A set is a folder synced here: the vault, or in shadow mode a private copy fed from the live one.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { type Conflict, type Entry, FileAnswer, HTTPError, LOCAL, localDate, localTime, MACHINE_CLIENT, Plugin, Replica, sha256hex as sha, SYNC_PROTOCOL as PROTOCOL, unsynced, type Vector } from "../../../core/plugins.ts"
import { DiskFolder, DiskStore } from "./disk.ts"
import { Mailbox } from "./mailbox.ts"
import { Mirror, snapshot } from "./hub.ts"

export const plugin = new Plugin(import.meta.url)

export type SetConfig = {
  /** The vault's id (machines' vault.json), with "-shadow" for a shadow set: devices trade only within one. */
  id: string
  /** The folder synced here. */
  folder: string
  /** Shadow mode: the live vault, read only, its changes copied in as this device's. */
  input?: string
  device?: string
  /** The iCloud mailbox's folder (null: none). Default: iCloud Drive/Vaultite sync/<id>, when iCloud Drive is here. */
  mailbox?: string | null
  /** Peers to trade with (default: Machines' list). */
  peers?: { id: string; url: string }[]
  /** The hub's git snapshots (default ~/Backups/vault.git, or vault-shadow.git) and one-way copy (none by default). */
  git?: string | null
  copy?: string | null
}
type Peer = { id: string; url: string; label: string }
type PeerState = { vector: Vector | null; ok: number; tried: number; error: string; hosts: boolean | null }
export type Compare = { at: number; same: number; differ: string[]; missing: string[]; extra: string[]; keptMore: string[]; lostLines: { path: string; lines: string[] }[] }

const MACHINES = "machines"
const ICLOUD = path.join(os.homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs")
// (VAULTITE_SYNC_MS: one interval for all of them, for tests)
const FAST = Number(process.env.VAULTITE_SYNC_MS) || 0
const PULL_MS = FAST || 20_000, SCAN_MS = FAST || 5 * 60_000, MAIL_MS = FAST || 30_000, GIT_MS = 60 * 60_000, COMPARE_MS = 60 * 60_000
const QUIET_MS = 700
/** Another tool syncs these: Vaultite won't run its own sync in one (one sync per folder). */
const SYNCED_BY_OTHERS = [/\/Library\/Mobile Documents\//, /\/Dropbox( \([^)]*\))?\//, /\/OneDrive[^/]*\//, /\/Google ?Drive\//, /\/My Drive\//]

/** This machine's sync folder: the sets it runs and each one's store (the machine's, whichever vault it serves). */
export const syncDir = () => path.join(process.env.VAULTITE_LOCAL || LOCAL, "sync")
const configFile = () => path.join(syncDir(), "sets.json")
export function readSets(): SetConfig[] {
  try { const s = JSON.parse(fs.readFileSync(configFile(), "utf8")).sets; return Array.isArray(s) ? s : [] } catch { return [] }
}
function writeSets(sets: SetConfig[]) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true })
  fs.writeFileSync(configFile() + ".tmp", JSON.stringify({ sets }, null, 2) + "\n")
  fs.renameSync(configFile() + ".tmp", configFile())
}
/** Why a folder can't be a set's own (not shadow): another tool syncs it. */
export function syncedByOthers(folder: string): string {
  const p = path.resolve(folder) + "/"
  if (SYNCED_BY_OTHERS.some((re) => re.test(p))) return `${folder} is synced by another tool (iCloud Drive, Dropbox, OneDrive or Google Drive): one sync per folder`
  for (let d = path.resolve(folder); ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, ".stfolder"))) return `${folder} is in a Syncthing folder: one sync per folder`; if (d === path.dirname(d)) break }
  return ""
}
/** A tailnet address or this machine's (as Machines checks): a synced file never sends the vault to a host its writer picks. */
function onTailnet(url: string) {
  let h: string
  try { const u = new URL(url); if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false; h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "") } catch { return false }
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h)
  if (v4) return v4[1] === "127" || (v4[1] === "100" && Number(v4[2]) >= 64 && Number(v4[2]) <= 127)
  return h.endsWith(".ts.net") || h === "localhost" || h === "::1" || h.startsWith("fd7a:115c:a1e0:")
}
const readJson = (p: string) => { try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return null } }
/** A plugin's settings in a synced folder (not the served vault: a shadow copy's, another vault's). */
const settingsIn = (folder: string, id: string, file = "data") => readJson(path.join(folder, ".vaultite", "plugins", id, `${file}.json`))

const label = async (id: string) => (await machineList()).find((m) => m.id === id)?.label ?? id
async function machineList(): Promise<Peer[]> {
  const ms = await plugin.ask<{ id: string; url: string; label: string; self: boolean; via?: string }[]>("machines", [])
  return ms.filter((m) => !m.self && !m.via && m.url).map((m) => ({ id: m.id, url: m.url.replace(/\/+$/, ""), label: m.label }))
}
const selfId = async () => String(await plugin.ask<string | null>("machines:self", null) ?? "") || os.hostname().replace(/\.local$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")

// ---------- a set, running here

export class SyncSet {
  cfg: SetConfig
  device: string
  folder: DiskFolder
  input: DiskFolder
  store: DiskStore
  replica: Replica
  mailbox: Mailbox | null = null
  mirror: Mirror | null = null
  peers = new Map<string, PeerState>()
  last: Compare | null = null
  lastStep = 0
  log: string[] = []
  private chain: Promise<unknown> = Promise.resolve()
  private stepTimer: ReturnType<typeof setTimeout> | null = null
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private timers: ReturnType<typeof setInterval>[] = []
  private watcher: fs.FSWatcher | null = null
  private copyWatcher: fs.FSWatcher | null = null
  private copyTimer: ReturnType<typeof setTimeout> | null = null
  closed = false

  constructor(cfg: SetConfig, device: string) {
    this.cfg = cfg; this.device = device
    const dir = path.join(syncDir(), "sets", cfg.id)
    this.store = new DiskStore(path.join(dir, "store"))
    fs.mkdirSync(cfg.folder, { recursive: true })
    this.folder = new DiskFolder(cfg.folder)
    this.input = cfg.input ? new DiskFolder(cfg.input) : this.folder
    this.replica = new Replica({ device, store: this.store, folder: this.folder, input: cfg.input ? this.input : undefined })
    this.replica.onEntries = () => this.push()
    this.replica.onLog = (m) => this.note(m)
    const mbox = cfg.mailbox === undefined ? (fs.existsSync(ICLOUD) ? path.join(ICLOUD, "Vaultite sync", cfg.id) : null) : cfg.mailbox
    const saved = this.replica.extra as { mailbox?: { read?: Record<string, number>; written?: number }; mirror?: [string, never][] }
    if (mbox) this.mailbox = new Mailbox(mbox, device, saved.mailbox)
    if (cfg.copy) this.mirror = new Mirror(cfg.copy, "icloud-copy", saved.mirror)
  }
  note(m: string) { this.log.unshift(`${localDate(Date.now())} ${localTime(Date.now())} ${m}`); this.log.length = Math.min(this.log.length, 50) }
  get shadow() { return !!this.cfg.input }

  start() {
    this.watch()
    this.timers.push(setInterval(() => this.later(0), SCAN_MS), setInterval(() => void this.exchangeAll(), PULL_MS),
      setInterval(() => void this.mail(), MAIL_MS), setInterval(() => void this.hubJobs(), GIT_MS))
    if (this.mirror) {
      // (a write into the copy is caught as it happens, and on the periodic look)
      const soon = () => { if (this.copyTimer) clearTimeout(this.copyTimer); this.copyTimer = setTimeout(() => { if (this.isHub()) void this.run(() => this.copy()) }, QUIET_MS); this.copyTimer.unref?.() }
      try { fs.mkdirSync(this.mirror.target, { recursive: true }); this.copyWatcher = fs.watch(this.mirror.target, { recursive: true }, (_e, name) => { if (!name || !unsynced(String(name))) soon() }) } catch { /* the timer looks */ }
      this.timers.push(setInterval(soon, SCAN_MS))
    }
    if (this.shadow) this.timers.push(setInterval(() => void this.compare().catch((e) => this.note(`compare: ${(e as Error).message}`)), COMPARE_MS))
    for (const t of this.timers) t.unref?.()
    // (a device starting fresh takes the others' history first, so its first look finds its files' versions there)
    const fresh = this.replica.seen.size === 0
    void (fresh ? this.exchangeAll().then(() => this.mail()) : Promise.resolve())
      .then(() => this.run(() => this.stepNow())).then(() => this.compact()).then(() => this.exchangeAll()).then(() => this.mail())
  }
  close() {
    this.closed = true
    for (const t of this.timers) clearInterval(t)
    if (this.stepTimer) clearTimeout(this.stepTimer)
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.watcher?.close()
    this.copyWatcher?.close()
    if (this.copyTimer) clearTimeout(this.copyTimer)
    this.store.flush()
  }
  private watch() {
    try {
      this.watcher = fs.watch(this.input.root, { recursive: true }, (_e, name) => {
        if (name && unsynced(String(name).split(path.sep).join("/"))) return
        this.later()
      })
      this.watcher.on("error", () => { this.watcher?.close(); this.watcher = null }) // (the periodic look still runs)
    } catch { this.watcher = null }
  }
  /** Run fn after the ones before it: one step, exchange or mailbox at a time. */
  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const p = this.chain.then(fn)
    this.chain = p.catch((e) => this.note(`error: ${(e as Error).message}`))
    return p
  }
  /** A step once the folder's been quiet a moment. */
  later(ms = QUIET_MS) {
    if (this.closed) return
    if (this.stepTimer) clearTimeout(this.stepTimer)
    this.stepTimer = setTimeout(() => { this.stepTimer = null; void this.run(() => this.stepNow()) }, ms)
    this.stepTimer.unref?.()
  }
  /** The vault's own folder has the right vault in it (a missing disk, a wrong path look like "delete everything"). */
  private present(): boolean {
    const want = this.cfg.id.replace(/-shadow$/, "")
    const v = settingsIn(this.input.root, MACHINES, "vault")
    return !!v && v.id === want
  }
  async stepNow() {
    if (this.closed) return null
    if (!this.present()) { this.note(`${this.input.root} doesn't hold vault ${this.cfg.id}: not looked at`); return null }
    // (hashed ahead, streamed, so a big file doesn't hold the server)
    const files = this.input.list()
    await this.input.prepare(files.map((f) => f.path), (p) => this.replica.seen.get(p))
    const r = this.replica.step()
    this.lastStep = Date.now()
    if (r.held && !this.heldTold) { this.heldTold = true; void tell(`Sync held ${r.held} deletes`, `Many files went missing at once from ${this.input.root}. Nothing is deleted on the other devices until you say so: vau sync release (or --no to put them back).`, "error") }
    if (r.wrote || r.merged) this.after()
    return r
  }
  heldTold = false
  /** Big blobs copied before they could be pointed at (a store from before): pointed at their files now. */
  compact() {
    for (const [p, t] of this.replica.seen) {
      const st = t.size >= 1 << 20 ? this.input.stat(p) : null
      if (st && st.size === t.size && st.mtime === t.mtime) this.store.placed(t.hash, this.input, p)
    }
  }
  /** What the hub does after a change: the copy. */
  private after() {
    if (this.mirror && this.isHub()) void this.run(() => this.copy())
  }

  // ---------- trading with peers

  push() {
    if (this.closed) return
    this.pushTimer ??= setTimeout(() => { this.pushTimer = null; void this.exchangeAll() }, 250)
    this.pushTimer.unref?.()
  }
  /** The machines to trade with: the set's own, else Machines' (on or off here), the vault's list, the synced folder's. */
  async peerList(): Promise<Peer[]> {
    if (this.cfg.peers) return this.cfg.peers.map((p) => ({ ...p, label: p.id }))
    const out = new Map<string, Peer>()
    const listed = (folder: string) => {
      const ms = settingsIn(folder, MACHINES)?.machines
      return (Array.isArray(ms) ? ms : []).filter((m) => typeof m?.id === "string" && typeof m.url === "string" && !m.via && onTailnet(m.url))
        .map((m) => ({ id: String(m.id), url: String(m.url).replace(/\/+$/, ""), label: String(m.label || m.id) }))
    }
    for (const p of [...await machineList(), ...listed(plugin.vault.path), ...listed(this.folder.root)]) if (!out.has(p.id)) out.set(p.id, p)
    out.delete(this.device)
    return [...out.values()]
  }
  private lastPeers = -1
  async exchangeAll() {
    if (this.closed) return
    let ps: Peer[]
    try { ps = await this.peerList() } catch (e) { this.note(`peers: ${(e as Error).message}`); return }
    if (ps.length !== this.lastPeers) { this.lastPeers = ps.length; this.note(`peers: ${ps.map((p) => p.id).join(", ") || "none (Machines lists no other machine)"}`) }
    await Promise.all(ps.map((p) => this.exchange(p).catch((e) => { this.note(`${p.id}: ${(e as Error).message}`); return false })))
  }
  private trading = new Set<string>()
  /** Trade with one peer until neither lacks anything, then fetch the blobs still missing from it. */
  async exchange(p: Peer): Promise<boolean> {
    if (this.trading.has(p.id)) return false
    const st = this.peers.get(p.id) ?? { vector: null, ok: 0, tried: 0, error: "", hosts: null }
    this.peers.set(p.id, st)
    // (a peer without this set is asked again now and then, not on every change)
    if (st.hosts === false && Date.now() - st.tried < 5 * 60_000) return false
    this.trading.add(p.id)
    st.tried = Date.now()
    try {
      let got = 0
      for (let round = 0; round < 20; round++) {
        const send = st.vector ? this.replica.missing(st.vector, 2000) : []
        const r = await fetch(`${p.url}/api/sync/exchange`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
          body: JSON.stringify({ set: this.cfg.id, device: this.device, protocol: PROTOCOL, vector: this.replica.vector(), entries: send, blobs: this.inline(send) }),
          signal: AbortSignal.timeout(30_000) })
        if (r.status === 404) { st.hosts = false; st.error = "doesn't sync this vault"; return false }
        const body = await r.json().catch(() => ({})) as { vector?: Vector; entries?: Entry[]; blobs?: Record<string, string>; more?: boolean; error?: string }
        if (!r.ok) { st.error = body.error ?? `answered ${r.status}`; return false }
        st.hosts = true
        this.take(body.blobs)
        const n = this.replica.receive(body.entries ?? [])
        got += n
        st.vector = body.vector ?? {}
        if (!body.more && !this.replica.missing(st.vector, 1).length) break
      }
      await this.fetchBlobs(p)
      st.ok = Date.now(); st.error = ""
      if (got) { this.later(50); this.push() }
      return true
    } catch (e) {
      st.error = (e as Error).name === "TimeoutError" ? "no answer" : "unreachable"
      return false
    } finally { this.trading.delete(p.id) }
  }
  /** Small blobs the entries name, sent with them (the rest are fetched). */
  inline(es: Entry[]): Record<string, string> {
    const out: Record<string, string> = {}
    let total = 0
    for (const e of es) {
      const b = e.node.blob
      if (!b || out[b] || e.node.size > 256 << 10 || total > 8 << 20) continue
      const bytes = this.store.blob(b)
      if (bytes) { out[b] = Buffer.from(bytes).toString("base64"); total += bytes.length }
    }
    return out
  }
  take(blobs: Record<string, string> | undefined) {
    for (const [h, b64] of Object.entries(blobs ?? {})) {
      if (this.store.hasBlob(h)) continue
      const bytes = new Uint8Array(Buffer.from(b64, "base64"))
      if (sha(bytes) === h) this.store.putBlob(h, bytes)
    }
  }
  private async fetchBlobs(p: Peer) {
    const want = this.replica.missingBlobs().slice(0, 200)
    let i = 0
    const worker = async () => {
      while (i < want.length) {
        const h = want[i++]
        try {
          const r = await fetch(`${p.url}/api/sync/blob?set=${encodeURIComponent(this.cfg.id)}&hash=${h}`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(600_000) })
          if (!r.ok || !r.body) continue
          const to = this.store.blobPath(h), tmp = `${to}.${process.pid}.part`
          fs.mkdirSync(path.dirname(to), { recursive: true })
          const hash = crypto.createHash("sha256")
          const out = fs.createWriteStream(tmp)
          for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) { hash.update(chunk); if (!out.write(chunk)) await new Promise<void>((ok) => out.once("drain", () => ok())) }
          await new Promise<void>((ok, bad) => out.end((e?: Error | null) => (e ? bad(e) : ok())))
          if (hash.digest("hex") === h) fs.renameSync(tmp, to); else fs.rmSync(tmp, { force: true })
        } catch { /* next time */ }
      }
    }
    await Promise.all([worker(), worker(), worker()])
    if (want.length) this.later(50)
  }

  // ---------- the mailbox

  async mail() {
    if (!this.mailbox || this.closed) return
    await this.run(() => {
      const mb = this.mailbox!
      try {
        mb.write(this.replica, this.store)
        const got = mb.take(this.replica, this.store)
        mb.clean()
        this.saveExtra()
        if (got) { this.later(50); this.push() }
      } catch (e) { this.note(`mailbox: ${(e as Error).message}`) }
    })
  }
  private saveExtra() {
    this.replica.extra = { ...this.replica.extra, mailbox: this.mailbox?.saved(), mirror: this.mirror?.saved() }
    this.replica.save()
  }

  // ---------- the hub

  /** The hub's machine id: the folder's sync settings, else the first machine listed (as the schedule's). */
  hub(): string {
    const s = settingsIn(this.folder.root, "sync")
    if (typeof s?.hub === "string" && s.hub) return s.hub
    const ms = settingsIn(this.folder.root, MACHINES)?.machines
    return (Array.isArray(ms) ? ms.find((m: { via?: string }) => !m.via)?.id : null) ?? this.device
  }
  isHub() { return this.hub() === this.device }
  gitDir() {
    if (this.cfg.git === null) return null
    return this.cfg.git ?? path.join(os.homedir(), "Backups", this.shadow ? "vault-shadow.git" : "vault.git")
  }
  async hubJobs() {
    if (!this.isHub() || this.closed) return null
    const g = this.gitDir()
    if (!g) return null
    try {
      const r = await snapshot(g, this.folder.root)
      if (r.committed) this.note(`git snapshot: ${r.files || "committed"}`)
      return r
    } catch (e) { this.note(`git snapshot: ${(e as Error).message}`); return null }
  }
  copy() {
    if (!this.mirror) return
    const notices = this.mirror.check(this.replica)
    if (notices.length) {
      this.replica.step()
      const imported = notices.filter((n) => n.what === "imported").map((n) => n.path)
      if (imported.length) void tell(`Imported ${imported.length} write${imported.length > 1 ? "s" : ""} into the iCloud copy`,
        `Something wrote into the hub's one-way copy (${this.mirror.target}): kept as a change from "iCloud copy", merged with the vault.\n${imported.slice(0, 20).map((p) => `- ${p}`).join("\n")}`, "info")
    }
    this.mirror.update(this.replica, this.folder, this.store)
    this.saveExtra()
  }

  // ---------- shadow mode: the copy against the live vault

  /** Compare the shadow copy with the live vault, file by file, leaving out what changed in the last two minutes. */
  async compare(): Promise<Compare> {
    return this.run(async () => {
      await this.stepNow()
      const recent = Date.now() - (FAST ? 0 : 120_000)
      const live = new Map(this.input.list().map((f) => [f.path, f]))
      const mine = new Map(this.folder.list().map((f) => [f.path, f]))
      const out: Compare = { at: Date.now(), same: 0, differ: [], missing: [], extra: [], keptMore: [], lostLines: [] }
      for (const [p, f] of live) {
        if (f.mtime > recent) continue
        const m = mine.get(p)
        if (!m) { out.missing.push(p); continue }
        if (this.input.hash(p) === this.folder.hash(p)) { out.same++; continue }
        if (m.mtime > recent) continue
        out.differ.push(p)
        // (a difference where the copy has every line the vault has: sync kept a side iCloud hid)
        const lt = textOf(this.input.read(p)), mt = textOf(this.folder.read(p))
        if (lt === null || mt === null) continue
        const have = new Set(mt.split("\n")), lost = lt.split("\n").filter((l) => l.trim() && !have.has(l))
        if (lost.length) out.lostLines.push({ path: p, lines: lost.slice(0, 5) }); else out.keptMore.push(p)
      }
      for (const [p, m] of mine) if (!live.has(p) && m.mtime <= recent) out.extra.push(p)
      this.last = out
      const day = path.join(syncDir(), "sets", this.cfg.id, "compare")
      fs.mkdirSync(day, { recursive: true })
      fs.appendFileSync(path.join(day, `${localDate(out.at)}.jsonl`), JSON.stringify({ ...out, differ: out.differ.slice(0, 200), missing: out.missing.slice(0, 200), extra: out.extra.slice(0, 200) }) + "\n")
      return out
    })
  }
  history(days = 14) {
    const dir = path.join(syncDir(), "sets", this.cfg.id, "compare")
    let names: string[] = []
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort().slice(-days) } catch { /* none yet */ }
    return names.map((n) => {
      const runs = fs.readFileSync(path.join(dir, n), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Compare)
      const clean = runs.filter((r) => !r.missing.length && !r.extra.length && !r.lostLines.length && r.differ.length === r.keptMore.length)
      return { day: n.slice(0, 10), runs: runs.length, clean: clean.length, last: runs[runs.length - 1] }
    })
  }
}
const dec = new TextDecoder("utf-8", { fatal: true })
const textOf = (b: Uint8Array | null) => { if (!b || b.length > 4 << 20) return null; try { return dec.decode(b) } catch { return null } }

async function tell(title: string, body: string, kind: "error" | "info") {
  try { await plugin.ask("inbox:event", null, { source: "sync", kind, key: `sync-${title}`, title, body }) } catch { /* no inbox */ }
}

// ---------- the sets this machine runs

const running = new Map<string, SyncSet>()
export const sets = () => running
async function load() {
  const want = readSets()
  for (const [id, s] of running) if (!want.some((w) => w.id === id && w.folder === s.cfg.folder && w.input === s.cfg.input)) { s.close(); running.delete(id) }
  for (const cfg of want) {
    if (running.has(cfg.id)) continue
    if (!cfg.input && syncedByOthers(cfg.folder)) { console.warn(`sync: ${syncedByOthers(cfg.folder)}`); continue }
    try {
      const s = new SyncSet(cfg, cfg.device ?? await selfId())
      running.set(cfg.id, s)
      s.start()
    } catch (e) { console.warn(`sync: ${cfg.id}: ${(e as Error).message}`) }
  }
}
const boot = setTimeout(() => { if (plugin.loaded) void load() }, FAST ? 200 : 4000)
boot.unref?.()
plugin.onUnload(() => { clearTimeout(boot); for (const s of running.values()) s.close(); running.clear() })

const setOf = (id: unknown) => {
  const s = running.get(String(id ?? ""))
  if (!s) throw new HTTPError(404, `this machine doesn't sync ${String(id)}`)
  return s
}

// ---------- routes: what peers ask

/** POST sync/exchange {set, device, protocol, vector, entries, blobs}: their entries in, what they lack out. */
plugin.route("POST", "sync/exchange", async (req) => {
  await plugin.ownerOnly(req, "Device sync")
  const b = req.body ?? {}
  const s = setOf(b.set)
  if (b.protocol !== PROTOCOL) throw new HTTPError(409, `sync protocol ${String(b.protocol)} here is ${PROTOCOL}: update the older app (nothing is dropped meanwhile)`)
  s.take(b.blobs as Record<string, string>)
  const n = s.replica.receive(Array.isArray(b.entries) ? b.entries as Entry[] : [])
  if (n) { s.later(50); s.push() } // (passed on to the others at once: the relay)
  const theirs = (b.vector && typeof b.vector === "object" ? b.vector : {}) as Vector
  const entries = s.replica.missing(theirs, 2000)
  const more = s.replica.missing(theirs, 2001).length > 2000
  const st = s.peers.get(String(b.device)) ?? { vector: null, ok: 0, tried: 0, error: "", hosts: true }
  st.vector = { ...theirs }; st.ok = Date.now(); st.hosts = true
  s.peers.set(String(b.device), st)
  return { device: s.device, protocol: PROTOCOL, vector: s.replica.vector(), entries, blobs: s.inline(entries), more }
}, { lock: false, sync: false })

/** GET sync/blob?set=&hash=: a blob's bytes (a file's version), streamed. */
plugin.route("GET", "sync/blob", async (req) => {
  await plugin.ownerOnly(req, "Device sync")
  const s = setOf(req.query.set), h = String(req.query.hash ?? "")
  if (!/^[0-9a-f]{64}$/.test(h)) throw new HTTPError(400, "hash: a blob's sha-256")
  const file = s.store.blobFile(h)
  if (file) return new FileAnswer(file, "application/octet-stream")
  for (const [p, t] of s.replica.wrote) if (t.hash === h && s.folder.hash(p) === h) return new FileAnswer(s.folder.abs(p), "application/octet-stream")
  throw new HTTPError(404, "no such blob here")
}, { lock: false, sync: false })

/** POST sync/blob?set=&hash= (the bytes): a blob from a device that isn't a server (the phone). */
plugin.route("POST", "sync/blob", async (req) => {
  await plugin.ownerOnly(req, "Device sync")
  const s = setOf(req.query.set), h = String(req.query.hash ?? "")
  if (!/^[0-9a-f]{64}$/.test(h) || !req.http) throw new HTTPError(400, "hash: a blob's sha-256, with its bytes")
  if (s.store.hasBlob(h)) { req.http.resume(); return { have: true } }
  const to = s.store.blobPath(h), tmp = `${to}.${process.pid}.up`
  fs.mkdirSync(path.dirname(to), { recursive: true })
  await pipeline(req.http, fs.createWriteStream(tmp))
  const got = crypto.createHash("sha256").update(fs.readFileSync(tmp)).digest("hex")
  if (got !== h) { fs.rmSync(tmp, { force: true }); throw new HTTPError(400, "the bytes don't match the hash") }
  fs.renameSync(tmp, to)
  s.later(50)
  return { have: true }
}, { lock: false, sync: false, stream: true })

/** POST sync/blobs {set, hashes}: several small blobs at once (a phone catching up), base64, up to 8 MB. */
plugin.route("POST", "sync/blobs", async (req) => {
  await plugin.ownerOnly(req, "Device sync")
  const s = setOf(req.body?.set), out: Record<string, string> = {}
  let total = 0
  for (const h of Array.isArray(req.body?.hashes) ? (req.body.hashes as unknown[]).slice(0, 2000) : []) {
    if (typeof h !== "string" || !/^[0-9a-f]{64}$/.test(h) || total > 8 << 20) continue
    const b = s.store.blob(h)
    if (b && b.length <= 8 << 20) { out[h] = Buffer.from(b).toString("base64"); total += b.length }
  }
  return { blobs: out }
}, { lock: false, sync: false })

/** GET sync/phone: what the iPhone app's copy syncs with here: the vault's own set, or while it's in shadow mode the
 *  shadow copy's, read only (edits made offline then would never reach the vault). */
plugin.route("GET", "sync/phone", async (req) => {
  await plugin.ownerOnly(req, "Device sync")
  const real = servedSet()
  if (real) return { set: real.cfg.id, vault: real.cfg.id, readOnly: false, device: "iphone" }
  let here = plugin.vault.path
  try { here = fs.realpathSync(here) } catch { /* as given */ }
  const shadow = [...running.values()].find((s) => { try { return s.shadow && fs.realpathSync(s.cfg.input!) === here } catch { return false } })
  return shadow ? { set: shadow.cfg.id, vault: shadow.cfg.id, readOnly: true, device: "iphone" } : { set: null }
}, { lock: false, sync: false })

// ---------- the note's conflicts (sync-conflicts draws them, beside iCloud's)

/** The served vault's own set (not shadow): its folder is the vault. */
function servedSet(): SyncSet | null {
  const here = fs.realpathSync(plugin.vault.path)
  for (const s of running.values()) { if (s.shadow) continue; try { if (fs.realpathSync(s.folder.root) === here) return s } catch { /* gone */ } }
  return null
}
export type SyncVersion = { id: string; at: number; from: string; text: string | null; base: string | null }
/** The served vault's clashes sync kept, for the note's banner: by path ({id, at, from}), or one file's with their text and base. */
plugin.provide("sync:conflicts", async (rel?: string): Promise<Record<string, { id: string; at: number; from: string }[]> | SyncVersion[]> => {
  const s = servedSet()
  if (!s) return rel === undefined ? {} : []
  const cs = s.replica.conflicts().filter((c) => c.conflict.kind === "text" || c.conflict.kind === "json")
  if (rel === undefined) {
    const out: Record<string, { id: string; at: number; from: string }[]> = {}
    for (const c of cs) (out[c.path] ??= []).push({ id: `sync:${c.conflict.id}`, at: c.conflict.at, from: c.conflict.device })
    return out
  }
  return Promise.all(cs.filter((c) => c.path === rel).map(async (c) => ({ id: `sync:${c.conflict.id}`, at: c.conflict.at, from: await label(c.conflict.device),
    text: s.replica.blobText(c.conflict.other), base: c.conflict.base ? s.replica.blobText(c.conflict.base) : null })))
})
/** Settle one (the user merged it in or kept the note as it is): a version on the file that says so, on every device. */
plugin.provide("sync:settle", async (rel: string, id: string) => {
  const s = servedSet()
  const c = s?.replica.conflicts().find((x) => x.path === rel && `sync:${x.conflict.id}` === id)
  if (!s || !c) return 0
  await s.run(async () => { await s.stepNow(); s.replica.settle(c.file, [c.conflict.id]); s.push() })
  return 1
})

/** Where this machine's windows type a note together with the others' (companion's bridge.ts): the hub's rooms, for every
 *  note, while this machine syncs the vault it serves and isn't the hub; null otherwise (its own rooms). */
plugin.provide("sync:rooms", async () => {
  const s = servedSet()
  if (!s || s.isHub()) return null
  const m = await plugin.ask<{ id: string; url: string; online: boolean } | null>("machines:machine", null, s.hub())
  return m?.online && m.url ? { m, folders: [""] } : null
})

/** The hub this vault's settings name (vau sync hub), or null: Machines' first then. */
plugin.provide("sync:hub", () => { const h = plugin.settings({}).hub; return typeof h === "string" && h ? h : null })

// ---------- ops

const ago = (t: number) => (!t ? "never" : t > Date.now() - 90_000 ? `${Math.round((Date.now() - t) / 1000)} s ago` : `${localDate(t)} ${localTime(t)}`)
const conflictLine = (c: { path: string; conflict: Conflict }) => `- ${c.path}: ${c.conflict.kind === "binary" ? `the other side kept as ${c.conflict.copy}`
  : c.conflict.kind === "deleted" ? `deleted on ${c.conflict.device}, kept because it was edited elsewhere` : c.conflict.kind === "name" ? `moved aside from ${c.conflict.copy} (two files had the name)`
  : `${c.conflict.lines ?? 1} clash${(c.conflict.lines ?? 1) > 1 ? "es" : ""} with ${c.conflict.device}${c.conflict.keys ? ` (${c.conflict.keys.join(", ")})` : ""}`} (${localDate(c.conflict.at)} ${localTime(c.conflict.at)})`

type SetStatus = ReturnType<typeof statusOf>
function statusOf(s: SyncSet) {
  return { id: s.cfg.id, folder: s.cfg.folder, input: s.cfg.input ?? null, shadow: s.shadow, hub: s.hub(), isHub: s.isHub(), ...s.replica.status(),
    peers: [...s.peers].map(([id, p]) => ({ id, ok: p.ok, error: p.error, hosts: p.hosts, behind: p.vector ? s.replica.missing(p.vector, 10_000).length : null })),
    mailbox: s.mailbox ? { root: s.mailbox.root, devices: s.mailbox.devices() } : null, lastStep: s.lastStep, compare: s.last, log: s.log.slice(0, 8) }
}

plugin.op({
  id: "sync.status", cli: "sync", kind: "read", owner: "Device sync",
  summary: "Device sync on this machine: the folders it syncs, its peers and how far behind each is, the mailbox, held deletes, conflicts.",
  help: `Each folder this machine syncs (a set): the vault itself, or in shadow mode a private copy fed from the live vault
and compared with it. Versions go to the hub (normally the M1) and any other machine over the tailnet, and through the
iCloud mailbox when no machine answers.

  vau sync
  vau sync conflicts            what clashed, kept for you to settle
  vau sync shadow               start shadow mode for this vault (vau sync shadow --vault <id> on a machine without it)
  vau sync compare              the shadow copy against the live vault, now and by day
  vau sync release              let held deletes through (--no: put the files back)
  vau sync hub m4               make another machine the hub`,
  run: () => [...running.values()].map(statusOf),
  text: (r: SetStatus[]) => !r.length ? "This machine syncs no folder (vau sync shadow starts shadow mode)." : r.map((s) => [
    `## ${s.shadow ? "Shadow copy" : "Vault"} ${s.id} on ${s.device}${s.isHub ? " (the hub)" : `, hub ${s.hub}`}`,
    `${s.folder}${s.input ? ` (copied from ${s.input})` : ""}: ${s.files} files, ${s.merging} waiting to merge, ${s.missingBlobs} blobs to fetch, last look ${ago(s.lastStep)}`,
    ...s.peers.map((p) => `- ${p.id}: ${p.hosts === false ? "doesn't sync this vault" : p.error ? `${p.error} (last traded ${ago(p.ok)})` : `traded ${ago(p.ok)}${p.behind ? `, ${p.behind} entries behind` : ", up to date"}`}`),
    s.mailbox ? `- iCloud mailbox: ${s.mailbox.devices.join(", ") || "empty"}` : "- no iCloud mailbox",
    s.held ? `Held: ${s.held.deletes} deletes since ${ago(s.held.since)}: vau sync release` : "",
    s.conflicts ? `${s.conflicts} conflict${s.conflicts > 1 ? "s" : ""}: vau sync conflicts` : "No open conflicts.",
    ...(s.log.length ? ["Lately:", ...s.log.slice(0, 5).map((l) => `  ${l}`)] : []),
    s.compare ? `Last compare (${ago(s.compare.at)}): ${s.compare.same} same, ${s.compare.differ.length} differ (${s.compare.keptMore.length} where sync kept more), ${s.compare.missing.length} missing, ${s.compare.extra.length} extra, ${s.compare.lostLines.length} with lines lost` : "",
  ].filter(Boolean).join("\n")).join("\n\n"),
})

plugin.op({
  id: "sync.conflicts", cli: "sync conflicts", kind: "read", owner: "Device sync",
  summary: "What device sync couldn't merge: where two devices changed the same lines (the later stays, the other waits in the note), binaries kept side by side, deletes undone by an edit.",
  help: "  vau sync conflicts",
  run: () => [...running.values()].map((s) => ({ set: s.cfg.id, conflicts: s.replica.conflicts().map((c) => ({ path: c.path, conflict: c.conflict })) })),
  text: (r: { set: string; conflicts: { path: string; conflict: Conflict }[] }[]) => r.map((x) => `## ${x.set}\n${x.conflicts.length ? x.conflicts.map(conflictLine).join("\n") : "No open conflicts."}`).join("\n\n") || "This machine syncs no folder.",
})

plugin.op({
  id: "sync.shadow", cli: "sync shadow", kind: "write", owner: "Device sync",
  summary: "Start (or stop) shadow mode: a private copy of the vault, synced with the other machines and compared with the live one, served by nothing.",
  help: `The copy is in this machine's sync folder, outside the vault and iCloud; the live vault is only read.

  vau sync shadow                       copy this vault, fed from its folder
  vau sync shadow --vault <id>          on a machine that doesn't have the vault (the mini PC): a copy from the others
  vau sync shadow --stop                stop (the copy and its history stay)`,
  params: {
    vault: { type: "string", description: "the vault's id (vault.json in Machines), when it isn't the one served here" },
    stop: { type: "boolean", description: "stop shadow mode here" },
  },
  run: async ({ vault, stop }) => {
    const own = String(await plugin.ask<string>("machines:vault", "") ?? "")
    const id = String(vault || own)
    if (!id) throw new HTTPError(400, "this vault has no id yet (list its machines in Machines first), or say which: `vault`")
    const setId = `${id}-shadow`
    let list = readSets().filter((s) => s.id !== setId)
    if (!stop) {
      const folder = path.join(syncDir(), "sets", setId, "files")
      list = [...list, { id: setId, folder, ...(id === own ? { input: plugin.vault.path } : {}) }]
      if (id !== own) {
        // (a copy from the others: the vault id file comes with it; until then nothing here is looked at)
        const vf = path.join(folder, ".vaultite", "plugins", MACHINES, "vault.json")
        fs.mkdirSync(path.dirname(vf), { recursive: true })
        if (!fs.existsSync(vf)) fs.writeFileSync(vf, JSON.stringify({ id }, null, 2) + "\n")
      }
    }
    writeSets(list)
    await load()
    return { set: setId, running: running.has(setId) }
  },
  text: (r: { set: string; running: boolean }) => r.running ? `Shadow mode on: ${r.set} (vau sync to follow it).` : `Shadow mode off for ${r.set}.`,
})

plugin.op({
  id: "sync.compare", cli: "sync compare", kind: "read", owner: "Device sync",
  summary: "Compare each shadow copy with the live vault now, and the days so far: shadow mode ends after a run of days with no differences and no lost lines.",
  help: "  vau sync compare",
  run: async () => Promise.all([...running.values()].filter((s) => s.shadow).map(async (s) => ({ set: s.cfg.id, now: await s.compare(), days: s.history() }))),
  text: (r: { set: string; now: Compare; days: ReturnType<SyncSet["history"]> }[]) => !r.length ? "No shadow copy here (vau sync shadow)." : r.map((x) => [
    `## ${x.set}`, `Now: ${x.now.same} files the same, ${x.now.differ.length} differ, ${x.now.missing.length} missing from the copy, ${x.now.extra.length} only in the copy.`,
    ...x.now.keptMore.slice(0, 10).map((p) => `- ${p}: the copy has every line the vault has, and more (a side iCloud hid)`),
    ...x.now.lostLines.slice(0, 10).map((l) => `- ${l.path}: lines the copy lacks: ${l.lines.map((s) => JSON.stringify(s.slice(0, 60))).join(", ")}`),
    ...x.now.missing.slice(0, 10).map((p) => `- missing: ${p}`), ...x.now.extra.slice(0, 10).map((p) => `- only in the copy: ${p}`),
    "", "By day:", ...x.days.map((d) => `- ${d.day}: ${d.clean} of ${d.runs} compares clean`),
  ].join("\n")).join("\n\n"),
})

plugin.op({
  id: "sync.release", cli: "sync release", kind: "write", owner: "Device sync",
  summary: "Let deletes sync held through (many files went missing at once), or put the files back with `no`.",
  help: "  vau sync release\n  vau sync release --no",
  params: { no: { type: "boolean", description: "don't delete: write them back" } },
  run: async ({ no }) => {
    let n = 0
    for (const s of running.values()) { n += s.replica.releaseHeld(!no); s.heldTold = false; await s.run(() => s.stepNow()) }
    return { released: n, yes: !no }
  },
  text: (r: { released: number; yes: boolean }) => !r.released ? "Nothing held." : r.yes ? `Let ${r.released} deletes through.` : `Put ${r.released} files back.`,
})

plugin.op({
  id: "sync.hub", cli: "sync hub", kind: "write", owner: "Device sync",
  summary: "Make another machine the hub (the one always on: relays, backups, generated files). A setting of the vault, so it syncs.",
  help: "When the M1 is gone for good: vau sync hub m4. The new hub has everything but the old one's last seconds, which are in its mailbox if they reached iCloud.\n\n  vau sync hub m4",
  args: ["machine"], params: { machine: { type: "string", required: true, description: "a machine's id (Machines)" } },
  run: ({ machine }) => {
    const cur = plugin.settings({})
    const epoch = (Number(cur.epoch) || 0) + 1
    plugin.saveSettings({ ...cur, hub: machine, epoch })
    return { hub: machine, epoch }
  },
  text: (r: { hub: string; epoch: number }) => `The hub is ${r.hub} now (epoch ${r.epoch}).`,
})

const BYTES = /^(\d+(?:\.\d+)?)\s*(kb|mb|gb)$/i
plugin.op({
  id: "sync.keep", cli: "sync keep", kind: "write",
  summary: "Choose what a device keeps offline (the phone): a file, a note with its media, or a folder (new files in it too), by kind and age; or all media, or the storage cap.",
  help: `A device's rules are vault settings (devices.<id> in the sync plugin's data.json), so they sync: the phone takes
them the next time it connects (big files on Wi-Fi only). Notes are always on it in full; this is for media.

  vau sync keep "Inbox/Clips" --kind video --since 7d     the videos clipped this week
  vau sync keep "Projects/Trip.md"                        a note and the media in it
  vau sync keep "Podcasts" --kind audio --latest 5        the latest five
  vau sync keep "Inbox/Clips" --off                       stop keeping it
  vau sync keep --all                                     every media file (--all false: the rules again)
  vau sync keep --cap 3GB`,
  args: ["path"],
  params: {
    path: { type: "string", description: "a file, a note (its media) or a folder" },
    kind: { type: "string", enum: ["image", "video", "audio", "pdf"], description: "only this kind of file (in a folder)" },
    since: { type: "string", description: "only files changed in the last: 7d, 2w, 12h" },
    latest: { type: "integer", minimum: 1, description: "only the latest n (in a folder)" },
    off: { type: "boolean", description: "stop keeping it" },
    all: { type: "boolean", description: "keep every media file (false: by the rules again)" },
    cap: { type: "string", description: "the most it keeps: 2GB, 500MB" },
    device: { type: "string", default: "iphone", description: "which device (the phone: iphone)" },
  },
  run: ({ path: p, kind, since, latest, off, all, cap, device }) => {
    const cur = plugin.settings({}), devices = { ...(cur.devices ?? {}) } as Record<string, Record<string, unknown>>, d = { ...(devices[device] ?? {}) }
    if (all !== undefined) d.keepAll = all
    if (cap) {
      const m = BYTES.exec(cap)
      if (!m) throw new HTTPError(400, "`cap`: a size like 2GB or 500MB")
      d.cap = Math.round(Number(m[1]) * { kb: 1 << 10, mb: 1 << 20, gb: 1 << 30 }[m[2].toLowerCase() as "kb"]!)
    }
    if (p !== undefined) {
      const at = String(p).replace(/^\/+|\/+$/g, "")
      const keep = (Array.isArray(d.keep) ? d.keep : []).filter((r: { path?: string }) => r.path !== at)
      d.keep = off ? keep : [...keep, { path: at, ...(kind ? { kind } : {}), ...(since ? { since } : {}), ...(latest ? { latest } : {}) }]
    } else if (all === undefined && !cap) throw new HTTPError(400, "say what: a `path`, `all` or `cap`")
    devices[device] = d
    plugin.saveSettings({ ...cur, devices })
    return { device, rules: d }
  },
  text: (r: { device: string; rules: { keep?: { path: string; kind?: string; since?: string; latest?: number }[]; keepAll?: boolean; cap?: number } }) =>
    [`${r.device} keeps${r.rules.keepAll ? " every media file" : ":"}`, ...(r.rules.keep ?? []).map((k) => `- ${k.path || "everything"}${k.kind ? `, ${k.kind}` : ""}${k.since ? `, last ${k.since}` : ""}${k.latest ? `, latest ${k.latest}` : ""}`),
      r.rules.cap ? `Cap: ${Math.round(r.rules.cap / (1 << 20))} MB` : ""].filter(Boolean).join("\n"),
})

plugin.op({
  id: "sync.snapshot", cli: "sync snapshot", kind: "write", owner: "Device sync",
  summary: "Take the hub's git snapshot now (text and settings; it takes one hourly).",
  help: "  vau sync snapshot",
  run: async () => Promise.all([...running.values()].map(async (s) => ({ set: s.cfg.id, hub: s.isHub(), git: s.gitDir(), result: await s.hubJobs() }))),
  text: (r: { set: string; hub: boolean; git: string | null; result: { committed: boolean; files?: string } | null }[]) =>
    r.map((x) => `- ${x.set}: ${!x.hub ? "not the hub here" : !x.git ? "no snapshots" : x.result?.committed ? `committed to ${x.git} (${x.result.files})` : `nothing new in ${x.git}`}`).join("\n") || "This machine syncs no folder.",
})

plugin.exports.load = load
