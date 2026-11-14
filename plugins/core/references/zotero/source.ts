import type { Entry } from "../library.ts"
import { type Conn, groups, keyOwner, type Lib, ZoteroError } from "./api.ts"
import { bbtCitekeys, bbtReady } from "./bbt.ts"
import { type KeptLibrary, sync } from "./sync.ts"

export type ZoteroState = { state: "off" | "ready" | "unreachable" | "refused" | "error"; detail: string; items: number; libraries: string[]; at: number; bbt: string | null }
export type ZoteroOptions = { local: boolean; groups: boolean; webKey: string }
export type ZoteroStore = { load: (web: boolean) => KeptLibrary[]; save: (web: boolean, libs: KeptLibrary[]) => void }

export const LOCAL_URL = () => process.env.VAULTITE_ZOTERO_URL || "http://127.0.0.1:23119"
export const WEB_URL = () => process.env.VAULTITE_ZOTERO_API || "https://api.zotero.org"

const off = (detail = ""): ZoteroState => ({ state: "off", detail, items: 0, libraries: [], at: 0, bbt: null })
const QUIET_FOR = 60_000

export class Zotero {
  store: ZoteroStore
  states = new Map<"local" | "web", ZoteroState>([["local", off()], ["web", off()]])
  private kept = new Map<"local" | "web", KeptLibrary[]>()
  private running = new Map<"local" | "web", Promise<void>>()

  constructor(store: ZoteroStore) { this.store = store }

  entries(options: ZoteroOptions): Entry[] {
    const out: Entry[] = []
    for (const side of ["local", "web"] as const) {
      if (side === "local" ? !options.local : !options.webKey) continue
      const libs = this.kept.get(side) ?? this.store.load(side === "web")
      this.kept.set(side, libs)
      for (const lib of libs) {
        if (lib.prefix.startsWith("groups/") && !options.groups) continue
        for (const k of lib.items) if (k.item) out.push({ key: k.citekey, item: k.item, origin: side === "local" ? "zotero" : "zotero-web", label: lib.name, zotero: { library: lib.prefix, key: k.key, web: side === "web" } })
      }
    }
    return out
  }

  refresh(options: ZoteroOptions, force = false): Promise<void> {
    return Promise.all((["local", "web"] as const).map((side) => this.refreshSide(side, options, force))).then(() => undefined)
  }

  private refreshSide(side: "local" | "web", options: ZoteroOptions, force: boolean): Promise<void> {
    const on = side === "local" ? options.local : !!options.webKey
    if (!on) { this.states.set(side, off()); return Promise.resolve() }
    const was = this.states.get(side) ?? off()
    if (!force && Date.now() - was.at < QUIET_FOR) return Promise.resolve()
    const running = this.running.get(side)
    if (running) return running
    const run = this.syncSide(side, options).finally(() => this.running.delete(side))
    this.running.set(side, run)
    return run
  }

  private async syncSide(side: "local" | "web", options: ZoteroOptions) {
    const at = Date.now()
    try {
      const { conn, libs, bbt } = await this.connect(side, options)
      const before = this.kept.get(side) ?? this.store.load(side === "web")
      const citekeys = bbt ? (keys: string[]) => bbtCitekeys(LOCAL_URL(), keys) : null
      const done: KeptLibrary[] = []
      for (const lib of libs) done.push(await sync(conn, lib, before.find((b) => b.prefix === lib.prefix) ?? null, lib.prefix === "users/0" ? citekeys : null))
      this.kept.set(side, done)
      this.store.save(side === "web", done)
      const items = done.reduce((n, l) => n + l.items.filter((k) => k.item).length, 0)
      this.states.set(side, { state: "ready", detail: "", items, libraries: done.map((l) => l.name), at, bbt })
    } catch (e) {
      const z = e instanceof ZoteroError ? e : new ZoteroError("Zotero couldn't be read", 500)
      const state = z.status === 0 ? "unreachable" : z.status === 403 ? "refused" : "error"
      const had = this.kept.get(side) ?? []
      this.states.set(side, { state, detail: z.message, items: had.reduce((n, l) => n + l.items.filter((k) => k.item).length, 0), libraries: had.map((l) => l.name), at, bbt: null })
    }
  }

  private async connect(side: "local" | "web", options: ZoteroOptions): Promise<{ conn: Conn; libs: Lib[]; bbt: string | null }> {
    if (side === "local") {
      const conn: Conn = { base: `${LOCAL_URL()}/api`, headers: new Map([["Zotero-API-Version", "3"]]), web: false }
      const libs: Lib[] = [{ prefix: "users/0", name: "My Library" }]
      if (options.groups) libs.push(...await groups(conn, "users/0").catch(() => []))
      return { conn, libs, bbt: await bbtReady(LOCAL_URL()) }
    }
    const conn: Conn = { base: WEB_URL(), headers: new Map([["Zotero-API-Version", "3"], ["Zotero-API-Key", options.webKey]]), web: true }
    const owner = await keyOwner(conn)
    const libs: Lib[] = [{ prefix: owner.user, name: "My Library (zotero.org)" }]
    if (options.groups) libs.push(...await groups(conn, owner.user).catch(() => []))
    return { conn, libs, bbt: null }
  }

  conn(web: boolean, webKey: string): Conn {
    return web ? { base: WEB_URL(), headers: new Map([["Zotero-API-Version", "3"], ["Zotero-API-Key", webKey]]), web: true }
      : { base: `${LOCAL_URL()}/api`, headers: new Map([["Zotero-API-Version", "3"]]), web: false }
  }

  forget(web: boolean) {
    const side = web ? "web" : "local"
    this.kept.delete(side)
    this.store.save(web, [])
    this.states.set(side, off())
  }
}
