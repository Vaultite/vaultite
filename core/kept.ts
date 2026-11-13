// On disk at <LOCAL>/kept/<vault key>/, never the vault.
import { AsyncLocalStorage } from "node:async_hooks"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { readJson } from "./jsonfile.ts"
import { LOCAL, vaultHere } from "./plugins.ts"
import { writeAtomic } from "./vault.ts"
import { atExit } from "./exit.ts"

/** An entry as kept: its JSON (`null`: removed, kept a while so a removal travels too), when it last changed (this or
 *  another machine's clock, ms), whether other machines get it, and the change number it got here. */
type Entry = { text: string; at: number; shared: boolean; seq: number }
/** An entry as it travels between machines. */
export type Shared = { name: string; at: number; data: unknown }

const Stored = z.record(z.string(), z.unknown())
const StoredEntry = z.object({ at: z.number(), seq: z.number().catch(0), shared: z.boolean().catch(false), data: z.unknown() })
const StoreFile = z.object({ id: z.string() })

const SAVE_MS = 1000
const TOMBSTONE_DAYS = 30
const NAME = /^[a-z0-9][a-z0-9-]*\/[\w.-]+(\/[\w.-]+)*$/
const reading = new AsyncLocalStorage<Set<string>>()

export class Kept {
  readonly dir: string
  private storeId = ""
  seq = 0
  stateVersion = 0
  private entries = new Map<string, Entry>()
  private loaded = false
  private dirty = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<(names: string[], merged: boolean) => void>()
  private stateReads = new Set<string>() // names, and "<prefix>*" for lists, the last state read

  constructor(dir: string) {
    this.dir = dir
  }

  /** This store's id: another machine that has seen a different one reads it whole again. */
  get id() {
    this.load()
    return this.storeId
  }

  private load() {
    if (this.loaded) return
    this.loaded = true
    let files: string[] = []
    try { files = fs.readdirSync(this.dir) } catch { /* none yet */ }
    const old = Date.now() - TOMBSTONE_DAYS * 86400_000
    for (const f of files) {
      if (f === "_store.json") {
        const r = readJson(path.join(this.dir, f), StoreFile)
        if (r.ok) this.storeId = r.value.id
        continue
      }
      if (!f.endsWith(".json")) continue
      const r = readJson(path.join(this.dir, f), Stored)
      if (!r.ok) { console.error(`kept: ${f} doesn't read (${r.why}): left out`); continue }
      for (const [name, raw] of Object.entries(r.value)) {
        const e = StoredEntry.safeParse(raw)
        if (!NAME.test(name) || !e.success) continue
        const { at, seq, shared, data } = e.data, text = JSON.stringify(data ?? null)
        if (text === "null" && at < old) continue
        this.entries.set(name, { text, at, shared, seq })
        if (seq > this.seq) this.seq = seq
      }
    }
    if (!this.storeId) {
      this.storeId = crypto.randomUUID()
      try { writeAtomic(path.join(this.dir, "_store.json"), JSON.stringify({ id: this.storeId }) + "\n", { mode: 0o600 }) } catch (e) { console.error("kept:", e) }
    }
  }

  /** An entry's data (a new copy each time: change it freely), or `fallback` while there's none. */
  get<T = unknown>(name: string, fallback?: T): T {
    this.load()
    reading.getStore()?.add(name)
    const e = this.entries.get(name)
    return !e || e.text === "null" ? (fallback as T) : JSON.parse(e.text)
  }

  names(prefix: string): string[] {
    this.load()
    reading.getStore()?.add(`${prefix}*`)
    return [...this.entries].filter(([n, e]) => n.startsWith(prefix) && e.text !== "null").map(([n]) => n).sort()
  }

  isShared(name: string) {
    this.load()
    return !!this.entries.get(name)?.shared
  }

  /** When an entry last changed (ms; 0: never). */
  at(name: string) {
    this.load()
    return this.entries.get(name)?.at ?? 0
  }

  /** Keep `data` under `name` (null removes it); `shared`: the other machines serving this vault get it. Nothing
   *  happens when it's what's kept already. Returns whether it changed. */
  set(name: string, data: unknown, { shared = false, at = Date.now() }: { shared?: boolean; at?: number } = {}): boolean {
    if (!NAME.test(name)) throw new Error(`a kept name is "<plugin id>/<name>", not '${name}'`)
    this.load()
    const text = JSON.stringify(data ?? null), was = this.entries.get(name)
    if (was ? was.text === text && was.shared === shared : text === "null") return false
    this.entries.set(name, { text, at: Math.max(at, (was?.at ?? 0) + 1), shared, seq: ++this.seq })
    this.changed([name], false)
    return true
  }

  /** The shared entries changed here after change `after` (0: all of them), for another machine. */
  since(after: number): { seq: number; entries: Shared[] } {
    this.load()
    const entries = [...this.entries].filter(([, e]) => e.shared && e.seq > after).map(([name, e]) => ({ name, at: e.at, data: JSON.parse(e.text) }))
    return { seq: this.seq, entries }
  }

  shared(names: string[]): Shared[] {
    this.load()
    return names.flatMap((name) => { const e = this.entries.get(name); return e?.shared ? [{ name, at: e.at, data: JSON.parse(e.text) }] : [] })
  }

  /** Take another machine's shared entries: each one newer than what's here wins (a tie: the larger text, so every
   *  machine ends with the same). Returns the names that changed. */
  merge(list: Shared[]): string[] {
    this.load()
    const changed: string[] = []
    for (const s of list) {
      if (!s || typeof s.name !== "string" || !NAME.test(s.name) || typeof s.at !== "number" || !Number.isFinite(s.at)) continue
      const text = JSON.stringify(s.data ?? null), was = this.entries.get(s.name)
      if (was && !was.shared && was.text !== "null") continue
      if (was && (was.at > s.at || (was.at === s.at && was.text >= text))) continue
      if (!was && text === "null") continue
      this.entries.set(s.name, { text, at: s.at, shared: true, seq: ++this.seq })
      changed.push(s.name)
    }
    if (changed.length) this.changed(changed, true)
    return changed
  }

  /** fn(names, merged) after each change (`merged`: it came from another machine). */
  onChange(fn: (names: string[], merged: boolean) => void) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** Run fn noting what it reads: what /api/state shows, so only a change to that reloads the app's state. */
  async readingFor<T>(fn: () => Promise<T>): Promise<T> {
    const reads = new Set<string>()
    try { return await reading.run(reads, fn) } finally { this.stateReads = reads }
  }

  private changed(names: string[], merged: boolean) {
    for (const n of names) this.dirty.add(n.slice(0, n.indexOf("/")))
    if (names.some((n) => this.stateReads.has(n) || [...this.stateReads].some((r) => r.endsWith("*") && n.startsWith(r.slice(0, -1))))) this.stateVersion++
    this.timer ??= setTimeout(() => this.flush(), SAVE_MS)
    this.timer.unref?.()
    for (const fn of this.listeners) try { fn(names, merged) } catch (e) { console.error(e) }
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const ns of this.dirty) {
      const mine = [...this.entries].filter(([n]) => n.startsWith(`${ns}/`))
      const file = path.join(this.dir, `${ns}.json`)
      try {
        if (!mine.length) { fs.rmSync(file, { force: true }); continue }
        const body = mine.map(([n, e]) => `${JSON.stringify(n)}:{"at":${e.at},"seq":${e.seq}${e.shared ? `,"shared":true` : ""},"data":${e.text}}`)
        writeAtomic(file, `{${body.join(",\n")}}\n`, { mode: 0o600 })
      } catch (e) { console.error(`kept: couldn't write ${file}:`, e) }
    }
    this.dirty.clear()
  }
}

const stores = new Map<string, Kept>()
/** The store of the vault at `vaultPath` on this machine. */
export function keptOf(vaultPath: string): Kept {
  const key = vaultHere(vaultPath).key
  let k = stores.get(key)
  if (!k) stores.set(key, (k = new Kept(path.join(LOCAL, "kept", key))))
  return k
}

export function flushKept() {
  for (const k of stores.values()) k.flush()
}
atExit(flushKept)
