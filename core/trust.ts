// What this machine said yes to: vault plugins by their content's hash, and the commands settings name (Dispatch's). Kept
// on this machine (VAULTITE_LOCAL/trust/), never in the vault, so what arrives by sync, a shared vault or a bundle waits.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { LOCAL, vaultHere } from "./plugins.ts"
import { writeAtomic } from "./vault.ts"

/** A vault plugin's approved version: its content hash, each file's (to say what changed since), when, its version;
 *  `edits`: later edits run without asking too (a plugin its owner is writing on this machine). */
export type Approval = { hash: string; files: Record<string, string>; at: string; version?: string; edits?: boolean }
type Store = { plugins: Record<string, Approval>; allowed: Record<string, string> }
/** What's hashed of a plugin's folder (core/vaultplugins.ts digestOf). */
export type Digest = { content: string; files: Record<string, string> }

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex")
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

export class Trust {
  file: string
  /** Bumped on every change (what /api/state is keyed on, besides the vault's versions). */
  version = 0
  private data: Store | null = null
  private stamp = -1

  constructor(vaultPath: string) {
    this.file = path.join(LOCAL, "trust", `${sha(vaultHere(vaultPath).real).slice(0, 12)}.json`)
  }

  /** Whether this vault has a store on this machine yet (made on its first sync, approving nothing). */
  get made() {
    return fs.existsSync(this.file)
  }

  private read(): Store {
    let mtime = 0
    try { mtime = fs.statSync(this.file).mtimeMs } catch { /* none yet */ }
    if (this.data && mtime === this.stamp) return this.data
    let o: unknown = null
    try { o = JSON.parse(fs.readFileSync(this.file, "utf8")) } catch { /* none, or unreadable: nothing approved */ }
    const d = isObj(o) ? o : {}
    this.data = { plugins: isObj(d.plugins) ? d.plugins as Store["plugins"] : {}, allowed: isObj(d.allowed) ? d.allowed as Store["allowed"] : {} }
    this.stamp = mtime
    return this.data
  }

  /** Write it (made when there's none). */
  save() {
    const d = this.read()
    writeAtomic(this.file, JSON.stringify(d, null, 2) + "\n", { mode: 0o600 })
    try { this.stamp = fs.statSync(this.file).mtimeMs } catch { this.stamp = -1 }
    this.version++
  }

  approval(id: string): Approval | null {
    return this.read().plugins[id] ?? null
  }

  /** Whether this machine approved plugin `id` with this content, or its edits (an empty hash, a folder that couldn't be read,
   *  never is). */
  approved(id: string, content: string) {
    const a = this.approval(id)
    return !!content && !!a && (a.hash === content || a.edits === true)
  }

  /** Approve it as it is now; `edits`: whether later edits run without asking (left as it was when not given). */
  approve(id: string, d: Digest, version?: string, save = true, edits?: boolean) {
    if (!d.content) throw new Error(`${id} can't be read yet: nothing to approve`)
    const keep = edits ?? this.approval(id)?.edits
    this.read().plugins[id] = { hash: d.content, files: d.files, at: new Date().toISOString(), ...(version ? { version } : {}), ...(keep ? { edits: true } : {}) }
    if (save) this.save()
  }

  /** Stop letting its edits run without asking (its code came from elsewhere: an update). */
  noEdits(id: string) {
    const a = this.read().plugins[id]
    if (!a?.edits) return
    delete a.edits
    this.save()
  }

  forget(id: string) {
    if (!this.read().plugins[id]) return
    delete this.read().plugins[id]
    this.save()
  }

  /** What changed in a plugin since this machine approved it: files added, removed or edited (all of them when it never was). */
  changes(id: string, d: Digest): { since: string | null; files: string[] } {
    const a = this.approval(id)
    if (!a) return { since: null, files: Object.keys(d.files).sort() }
    const names = new Set([...Object.keys(a.files ?? {}), ...Object.keys(d.files)])
    return { since: a.version ?? a.at.slice(0, 10), files: [...names].filter((f) => a.files?.[f] !== d.files[f]).sort() }
  }

  /** Something else a plugin runs that a vault setting names (a command): whether this machine said yes to it. */
  allows(plugin: string, what: string) {
    return !!this.read().allowed[sha(`${plugin}\0${what}`)]
  }

  allow(plugin: string, what: string) {
    this.read().allowed[sha(`${plugin}\0${what}`)] = new Date().toISOString()
    this.save()
  }
}

const stores = new Map<string, Trust>()
/** The vault's trust store on this machine (one per vault path). */
export function trustOf(vaultPath: string) {
  let t = stores.get(vaultPath)
  if (!t) stores.set(vaultPath, t = new Trust(vaultPath))
  return t
}
