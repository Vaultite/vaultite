// What this machine said yes to: vault plugins by their content's hash, and the commands settings name (Dispatch's). Kept
// on this machine (VAULTITE_LOCAL/trust/), never in the vault, so what arrives by sync, a shared vault or a bundle waits.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { listOf, readJson, recordOf } from "./jsonfile.ts"
import { LOCAL, vaultHere } from "./plugins.ts"
import type { Disclosures } from "./pluginmeta.ts"
import { writeAtomic } from "./vault.ts"

const Says = z.object({ network: z.array(z.string()).optional(), shell: z.boolean().optional(), outsideVault: z.boolean().optional(),
  clipboard: z.boolean().optional() }) satisfies z.ZodType<Disclosures>

/** An approved version: content hash, each file's, when, version; `edits`: later edits run without asking too; `source`,
 *  `says`: where it came from and what it said it does (an update synced from elsewhere must match both: App.adopt). */
const Approval = z.looseObject({ hash: z.string(), files: z.record(z.string(), z.string()), at: z.string(), version: z.string().optional(),
  edits: z.boolean().optional(), source: z.string().optional(), says: Says.optional(),
  paused: z.string().optional() })
export type Approval = z.infer<typeof Approval>
type More = { version?: string; edits?: boolean; source?: string; says?: Disclosures }

const Store = z.object({
  plugins: recordOf(Approval),
  allowed: recordOf(z.string()),
  local: recordOf(z.record(z.string(), z.unknown())),
  steps: listOf(z.string()),
})
type Store = z.infer<typeof Store>
/** What's hashed of a plugin's folder (core/vaultplugins.ts digestOf). */
export type Digest = { content: string; files: Record<string, string>; note?: (file: string) => boolean }

export function codeHash(files: Record<string, string>, note: (file: string) => boolean = () => false) {
  return sha(Object.keys(files).filter((f) => !note(f)).sort().map((f) => `${f}\0${files[f]}`).join("\0"))
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex")
const Runs = listOf(z.looseObject({ command: z.array(z.string()) }))
const Commands = z.looseObject({ ops: Runs, events: Runs, startup: Runs, schedule: Runs })

/** Its notes: Markdown none of its commands names (a brief an agent reads, its pages). Text, never imported: editing
 *  one needs no new yes (core/trust.ts). */
export function notesOf(dir: string): (file: string) => boolean {
  const r = readJson(path.join(dir, "manifest.json"), Commands)
  const args = r.ok ? [r.value.ops, r.value.events, r.value.startup, r.value.schedule].flat().flatMap((c) => c.command) : []
  return (f) => /\.md$/i.test(f) && !args.some((a) => a.includes(path.posix.basename(f)))
}
/** The store's file name in VAULTITE_LOCAL/trust/ for the vault at `vaultPath` (a copy of a vault has its own). */
export const trustName = (vaultPath: string) => `${sha(vaultHere(vaultPath).real).slice(0, 12)}.json`

export class Trust {
  file: string
  /** Bumped on every change (what /api/state is keyed on, besides the vault's versions). */
  version = 0
  private data: Store | null = null
  private stamp = -1

  constructor(vaultPath: string) {
    this.file = path.join(LOCAL, "trust", trustName(vaultPath))
  }

  /** Whether this vault has a store on this machine yet (made on its first sync, approving nothing). */
  get made() {
    return fs.existsSync(this.file)
  }

  private read(): Store {
    let mtime = 0
    try { mtime = fs.statSync(this.file).mtimeMs } catch { /* none yet */ }
    if (this.data && mtime === this.stamp) return this.data
    const r = readJson(this.file, Store)
    this.data = r.ok ? r.value : Store.parse({})
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
  approved(id: string, d: Digest) {
    const a = this.approval(id)
    if (!d.content || !a) return false
    return a.hash === d.content || a.edits === true || (!!d.note && codeHash(a.files, d.note) === codeHash(d.files, d.note))
  }

  /** Approve it as it is now; `edits`: whether later edits run without asking (left as it was when not given). */
  approve(id: string, d: Digest, o: More = {}) {
    if (!d.content) throw new Error(`${id} can't be read yet: nothing to approve`)
    const keep = o.edits ?? this.approval(id)?.edits
    this.read().plugins[id] = { hash: d.content, files: d.files, at: new Date().toISOString(), ...(o.version ? { version: o.version } : {}), ...(keep ? { edits: true } : {}),
      ...(o.source ? { source: o.source } : {}), ...(o.says ? { says: o.says } : {}) }
    this.save()
  }

  /** Stop letting its edits run without asking (its code came from elsewhere: an update). */
  noEdits(id: string) {
    const a = this.read().plugins[id]
    if (!a?.edits) return
    delete a.edits
    this.save()
  }

  /** Note that the user was told plugin `id` changed and stopped: false if they already were since it was approved. */
  tellPaused(id: string) {
    const a = this.read().plugins[id]
    if (!a || a.paused) return false
    a.paused = new Date().toISOString()
    this.save()
    return true
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
    const names = new Set([...Object.keys(a.files), ...Object.keys(d.files)])
    return { since: a.version ?? a.at.slice(0, 10), files: [...names].filter((f) => a.files[f] !== d.files[f] && !d.note?.(f)).sort() }
  }

  /** Something else a plugin runs that a vault setting names (a command): whether this machine said yes to it. */
  allows(plugin: string, what: string) {
    return !!this.read().allowed[sha(`${plugin}\0${what}`)]
  }

  allow(plugin: string, what: string) {
    this.read().allowed[sha(`${plugin}\0${what}`)] = new Date().toISOString()
    this.save()
  }

  /** A plugin's settings its manifest marks `local` (who may reach it): this machine's, so a synced vault can't set them. */
  local(plugin: string): Record<string, unknown> {
    return this.read().local[plugin] ?? {}
  }

  /** Whether this machine ran migration `step` for this vault; `mark`: note that it has. */
  ran(step: string, mark = false) {
    const d = this.read(), had = d.steps.includes(step)
    if (mark && !had) { d.steps.push(step); this.save() }
    return had
  }

  /** Change some of them (null removes one). */
  patchLocal(plugin: string, changes: Record<string, unknown>) {
    const next = { ...this.local(plugin) }
    for (const [k, v] of Object.entries(changes)) { if (v === null) delete next[k]; else if (v !== undefined) next[k] = v }
    if (JSON.stringify(next) === JSON.stringify(this.local(plugin))) return
    if (Object.keys(next).length) this.read().local[plugin] = next; else delete this.read().local[plugin]
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
