// One device's side of sync: every file's versions (content-addressed, with parents), each device's log of the versions it
// made, and the merges, worked out alike on every device. The folder is the truth; this only remembers how it got there.
import crypto from "node:crypto"
import { mergeJson, mergeText } from "./merge.ts"

/** A version of a file. `blob` is its bytes' sha-256 (null: deleted); `device` "" for a merge, which any device makes alike. */
export type Node = {
  id: string; file: string; path: string; blob: string | null; size: number; parents: string[]
  clock: number; device: string; at: number
  /** A merge where both sides changed the same lines: the losing side, until a later version settles it. */
  conflict?: Conflict
  /** The conflicts this version settles (the user chose). */
  settles?: string[]
  /** Where an import came from when it isn't this device's own folder ("icloud-copy"). */
  from?: string
  /** A delete among many the user let through on its device: not held again on the others. */
  confirmed?: true
}
export type Conflict = {
  id: string; kind: "text" | "json" | "binary" | "deleted" | "name"
  /** The text to merge `other` in from (merge.ts Clash), as blobs; null where there's none (binary, deleted). */
  base: string | null; other: string | null
  /** The losing side's device and when it changed. */
  device: string; at: number
  /** Binary: where the other side's file was kept beside it. Name: the path it lost. */
  copy?: string; keys?: string[]; lines?: number
}
export type Entry = { device: string; seq: number; node: Node }
export type Vector = Record<string, number>
export type FileStat = { path: string; size: number; mtime: number }

/** The files a device syncs (its vault folder, or one in memory for tests). Paths are vault paths, NFC. */
export interface Folder {
  list(): FileStat[]
  stat(path: string): FileStat | null
  read(path: string): Uint8Array | null
  /** sha-256 of a file's bytes (hex), or null when it's gone. */
  hash(path: string): string | null
  write(path: string, bytes: Uint8Array): FileStat
  move(from: string, to: string): FileStat | null
  remove(path: string): void
  /** Write a stored blob's file without reading it (a clone where the disk can): big media. */
  copyIn?(path: string, from: string, hash: string): FileStat | null
}
/** Where a device keeps its logs, blobs and what it knows of its folder: runtime state, never in the vault. */
export interface Store {
  entries(): Entry[]
  append(entries: Entry[]): void
  state(): Record<string, unknown> | null
  saveState(state: Record<string, unknown>): void
  hasBlob(h: string): boolean
  blob(h: string): Uint8Array | null
  putBlob(h: string, bytes: Uint8Array): void
  /** Keep a folder file's bytes as blob h without reading them into memory (a clone on APFS), if it can. */
  keepFile?(h: string, folder: Folder, path: string): boolean
  /** A blob's own file, to copy from (Folder.copyIn). */
  blobFile?(h: string): string | null
  /** A blob was just written into the folder there (it may keep it as that file, not twice). */
  placed?(h: string, folder: Folder, path: string): void
}

export const sha = (b: Uint8Array | string) => crypto.createHash("sha256").update(b).digest("hex")
const enc = new TextEncoder(), dec = new TextDecoder("utf-8", { fatal: true })
export const PROTOCOL = 1
/** Text bigger than this merges as binary: the later wins, the other kept beside it. */
const TEXT_MAX = 8 << 20

/** The id a version has: a hash of everything else in it, so two devices that make the same merge agree on it. */
export function nodeId(n: Omit<Node, "id">): string {
  return sha(JSON.stringify([n.file, n.path, n.blob, n.size, [...n.parents].sort(), n.clock, n.device, n.at, n.conflict ?? null, n.settles ?? null, n.from ?? null, n.confirmed ?? null]))
}
const made = (n: Omit<Node, "id">): Node => ({ ...n, parents: [...n.parents].sort(), id: nodeId(n) })

const TEXT = /\.(md|markdown|txt|text|csv|tsv|json|jsonl|canvas|base|yaml|yml|toml|ini|css|js|mjs|ts|tsx|jsx|html|htm|xml|svg|py|sh|swift|excalidraw|tex|bib|org|rst|log|ics|vtt|srt)$/i
export type Kind = "text" | "json" | "binary"
export function kindOf(path: string, bytes?: Uint8Array | null): Kind {
  if (/\.(json|canvas|base|excalidraw)$/i.test(path)) return "json"
  if (TEXT.test(path)) return "text"
  if (bytes && bytes.length < 1 << 20 && !bytes.includes(0)) { try { dec.decode(bytes); return "text" } catch { /* binary */ } }
  return "binary"
}
const textOf = (b: Uint8Array | null) => { if (!b) return null; try { return dec.decode(b) } catch { return null } }
/** A path as sync names it: NFC, forward slashes, and the key two paths that clash on a Mac share (case). */
export const norm = (p: string) => p.normalize("NFC").replaceAll("\\", "/").replace(/^\/+/, "")
const keyOf = (p: string) => norm(p).toLowerCase()

/** What isn't synced: the folder's own machinery, the OS's litter, sync's temporary files. */
export function unsynced(rel: string) {
  const parts = rel.split("/"), name = parts[parts.length - 1]
  return parts.some((p) => p === ".git" || p === "node_modules" || p === ".Trash" || p === ".trash" || p === ".sync-tmp")
    || name === ".DS_Store" || name === "Icon\r" || name.startsWith("._") || name.endsWith(".icloud") || /^\.~|~\$/.test(name) || name.endsWith(".sync-part")
}

/** "Notes/Idea.md", "m4", 2026-11-07 -> "Notes/Idea (m4 2026-11-07).md" */
export function besideName(path: string, device: string, at: number, n = 1) {
  const dot = path.lastIndexOf("."), slash = path.lastIndexOf("/")
  const [stem, ext] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ""]
  const day = new Date(at).toISOString().slice(0, 10)
  return `${stem} (${device || "merge"} ${day}${n > 1 ? ` ${n}` : ""})${ext}`
}

type Tracked = { hash: string; node: string; size: number; mtime: number }
export type Guard = { files: number; max: number }
export type Status = {
  device: string; vector: Vector; files: number; heads: number; waiting: number; missingBlobs: number
  held: { deletes: number; since: number } | null; conflicts: number
}

export class Replica {
  readonly device: string
  readonly store: Store
  /** Where versions are written (the vault, or a shadow copy). */
  readonly folder: Folder
  /** Where changes are read from: the folder itself, or in shadow mode the live vault, copied in as if made here. */
  readonly input: Folder
  readonly shadow: boolean
  nodes = new Map<string, Node>()
  kids = new Map<string, Set<string>>()
  byFile = new Map<string, Set<string>>()
  logs = new Map<string, Entry[]>()
  /** Each file's heads (the versions nothing came after), and the live files by name (case aside). */
  private headCache = new Map<string, Node[]>()
  private named = new Map<string, Set<string>>()
  /** Entries that came before the ones before them (a gap in a device's log): applied once it's filled. */
  waiting = new Map<string, Map<number, Entry>>()
  clock = 0
  seq = 0
  /** The input's files as last seen, and which version each was. */
  seen = new Map<string, Tracked>()
  /** The folder's files as last written (in shadow mode; else `seen`). */
  wrote = new Map<string, Tracked>()
  /** Deletes held for the user's yes: too many at once (an unmounted folder looks like that). */
  held: { deletes: string[]; since: number } | null = null
  release = false
  /** What the device keeps with the replica's state (the mailbox's place, the copy's files). */
  extra: Record<string, unknown> = {}
  now: () => number
  /** Files changing now: left until they've been quiet a moment (vault paths -> last change). */
  guard: Guard = { files: 50, max: 0.05 }
  onEntries: (e: Entry[]) => void = () => {}
  onLog: (msg: string) => void = () => {}

  constructor(o: { device: string; store: Store; folder: Folder; input?: Folder; now?: () => number }) {
    this.device = o.device; this.store = o.store; this.folder = o.folder; this.input = o.input ?? o.folder
    this.shadow = !!o.input && o.input !== o.folder
    this.now = o.now ?? Date.now
    const st = this.store.state() as { clock?: number; seen?: [string, Tracked][]; wrote?: [string, Tracked][]; held?: Replica["held"]; extra?: Record<string, unknown> } | null
    for (const e of this.store.entries()) this.take(e)
    this.clock = Math.max(this.clock, st?.clock ?? 0)
    this.seq = this.logs.get(this.device)?.length ?? 0
    this.seen = new Map(st?.seen ?? [])
    this.wrote = this.shadow ? new Map(st?.wrote ?? []) : this.seen
    this.held = st?.held ?? null
    this.extra = st?.extra ?? {}
  }

  save() {
    this.store.saveState({ clock: this.clock, seen: [...this.seen], ...(this.shadow ? { wrote: [...this.wrote] } : {}), held: this.held, extra: this.extra })
  }

  // ---------- the history

  /** Add an entry to its device's log (in order; one ahead of a gap waits). Whether it was new. */
  private take(e: Entry): boolean {
    const log = this.logs.get(e.device) ?? []
    if (e.seq <= log.length) return false
    if (e.seq > log.length + 1) {
      const w = this.waiting.get(e.device) ?? new Map()
      w.set(e.seq, e); this.waiting.set(e.device, w)
      return false
    }
    log.push(e); this.logs.set(e.device, log)
    this.addNode(e.node)
    const w = this.waiting.get(e.device)
    if (w?.has(e.seq + 1)) { const next = w.get(e.seq + 1)!; w.delete(e.seq + 1); if (!w.size) this.waiting.delete(e.device); this.take(next) }
    return true
  }

  private addNode(n: Node) {
    if (this.nodes.has(n.id)) return
    this.nodes.set(n.id, n)
    this.clock = Math.max(this.clock, n.clock)
    for (const p of n.parents) { const k = this.kids.get(p) ?? new Set(); k.add(n.id); this.kids.set(p, k) }
    const f = this.byFile.get(n.file) ?? new Set(); f.add(n.id); this.byFile.set(n.file, f)
    this.reindex(n.file)
    for (const p of n.parents) { const pn = this.nodes.get(p); if (pn && pn.file !== n.file) this.reindex(pn.file) }
  }

  private reindex(file: string) {
    for (const h of this.headCache.get(file) ?? []) { const s = this.named.get(keyOf(h.path)); s?.delete(file); if (s && !s.size) this.named.delete(keyOf(h.path)) }
    const hs: Node[] = []
    for (const id of this.byFile.get(file) ?? []) if (!(this.kids.get(id)?.size)) hs.push(this.nodes.get(id)!)
    hs.sort(order)
    this.headCache.set(file, hs)
    for (const h of hs) { const k = keyOf(h.path), s = this.named.get(k) ?? new Set(); s.add(file); this.named.set(k, s) }
  }

  /** Entries from another device (any device's, relayed). Checked: a version whose id doesn't match its content is refused. */
  receive(entries: Entry[]): number {
    const fresh: Entry[] = []
    for (const e of entries) {
      if (!e || typeof e.device !== "string" || !Number.isInteger(e.seq) || e.seq < 1 || !e.node || e.device === this.device) continue
      const { id, ...rest } = e.node
      if (nodeId(rest) !== id) { this.onLog(`refused a version from ${e.device} whose id doesn't match`); continue }
      const before = this.logs.get(e.device)?.length ?? 0
      this.take(e)
      const log = this.logs.get(e.device) ?? []
      fresh.push(...log.slice(before))
    }
    if (fresh.length) this.store.append(fresh)
    return fresh.length
  }

  vector(): Vector {
    const v: Vector = {}
    for (const [d, log] of this.logs) v[d] = log.length
    return v
  }

  /** What a device that has `vector` lacks, oldest first per device (at most `max`). */
  missing(vector: Vector, max = 5000): Entry[] {
    const out: Entry[] = []
    for (const [d, log] of this.logs) {
      const from = Math.max(0, Math.min(vector[d] ?? 0, log.length))
      for (let i = from; i < log.length && out.length < max; i++) out.push(log[i])
    }
    return out
  }

  /** Append a version this device made (or a merge it worked out) to its own log. */
  private record(n: Node): Node {
    if (this.nodes.has(n.id)) return this.nodes.get(n.id)!
    const e: Entry = { device: this.device, seq: ++this.seq, node: n }
    this.take(e)
    this.store.append([e])
    this.onEntries([e])
    return n
  }

  heads(file: string): Node[] { return this.headCache.get(file) ?? [] }

  /** Whether every version this file's heads came from is here (else a merge waits: its base could be wrong). */
  private whole(file: string) {
    for (const h of this.heads(file)) for (const id of this.ancestors(h.id)) if (!this.nodes.has(id)) return false
    return true
  }

  /** The device behind a version: its own, or for a merge the latest one's it came from. */
  author(n: Node): Node {
    if (n.device) return n
    let best: Node | null = null
    for (const id of this.ancestors(n.id)) { const a = this.nodes.get(id); if (a?.device && (!best || order(best, a) < 0)) best = a }
    return best ?? n
  }

  /** The file's version now: its one head (null while it has several, until they're merged). */
  head(file: string): Node | null {
    const h = this.heads(file)
    return h.length === 1 ? h[0] : null
  }

  private ancestors(id: string): Set<string> {
    const out = new Set<string>(), todo = [id]
    while (todo.length) {
      const x = todo.pop()!
      if (out.has(x)) continue
      out.add(x)
      for (const p of this.nodes.get(x)?.parents ?? []) todo.push(p)
    }
    return out
  }

  /** The versions both sides came from, newest only (none: two files that began apart). */
  private bases(xs: string[], ys: string[]): Node[] {
    const ax = new Set<string>(), ay = new Set<string>()
    for (const x of xs) for (const a of this.ancestors(x)) ax.add(a)
    for (const y of ys) for (const a of this.ancestors(y)) ay.add(a)
    const common = [...ax].filter((id) => ay.has(id) && this.nodes.has(id))
    const below = new Set<string>()
    for (const c of common) for (const p of this.nodes.get(c)!.parents) for (const a of this.ancestors(p)) below.add(a)
    return common.filter((c) => !below.has(c)).map((c) => this.nodes.get(c)!).sort(order)
  }

  /** The text a set of versions stands for: one's own, or several merged in order, each from the versions they share
   *  (git's recursive merge base, for a criss-cross); clashes go to the later. null: a blob isn't here. */
  private textOfSet(ns: Node[]): string | null {
    if (!ns.length) return ""
    let acc = this.blobText(ns[0].blob)
    const done = [ns[0].id]
    for (const n of ns.slice(1)) {
      const t = this.blobText(n.blob), base = this.textOfSet(this.bases(done, [n.id]))
      if (acc === null || t === null || base === null) return null
      acc = mergeText(base, t, acc, true).text
      done.push(n.id)
    }
    return acc
  }

  blobText(h: string | null): string | null { return h === null ? "" : textOf(this.store.blob(h)) }

  // ---------- merging

  /** Blobs the versions need that aren't here (to fetch from a peer). */
  missingBlobs(): string[] {
    const out = new Set<string>()
    for (const [file] of this.byFile) {
      const hs = this.heads(file)
      for (const h of hs) if (h.blob && !this.store.hasBlob(h.blob)) out.add(h.blob)
      if (hs.length > 1) for (const b of this.bases([hs[0].id], [hs[1].id])) if (b.blob && !this.store.hasBlob(b.blob)) out.add(b.blob)
    }
    return [...out]
  }

  private putText(text: string): { blob: string; size: number } {
    const bytes = enc.encode(text), blob = sha(bytes)
    if (!this.store.hasBlob(blob)) this.store.putBlob(blob, bytes)
    return { blob, size: bytes.length }
  }

  /** Merge two heads into one version, the same on every device: null when a blob it needs isn't here yet. */
  private merge2(x: Node, y: Node): Node | null {
    // x is the earlier (order), y the later: y wins a clash.
    const bs = this.bases([x.id], [y.id]), base = bs[bs.length - 1] ?? null
    const parents = [x.id, y.id], clock = Math.max(x.clock, y.clock), at = Math.max(x.at, y.at)
    const path = mergedPath(base?.path ?? null, x.path, y.path)
    const ax = this.author(x)
    const loser = (k: Conflict["kind"], extra: Partial<Conflict> = {}): Conflict =>
      ({ id: "", kind: k, base: null, other: null, device: ax.device || "merge", at: ax.at, ...extra })
    const node = (blob: string | null, size: number, conflict?: Conflict) => {
      const c = conflict ? { ...conflict, id: sha(JSON.stringify([parents.sort(), conflict])).slice(0, 16) } : undefined
      return made({ file: x.file, path, blob, size, parents, clock, device: "", at, ...(c ? { conflict: c } : {}) })
    }
    if (x.blob === y.blob) return node(x.blob, x.size)
    const baseBlob = bs.length === 1 ? base!.blob : null
    if (x.blob === null || y.blob === null) {
      // A delete against an edit: the edit wins (the file comes back), unless the other side never changed it.
      const kept = x.blob === null ? y : x
      if (bs.length && bs.every((b) => b.blob === kept.blob)) return node(null, 0)
      const del = this.author(x.blob === null ? x : y)
      return node(kept.blob, kept.size, loser("deleted", { device: del.device || "merge", at: del.at }))
    }
    if (bs.length === 1 && baseBlob === x.blob) return node(y.blob, y.size)
    if (bs.length === 1 && baseBlob === y.blob) return node(x.blob, x.size)
    const kind = Math.max(x.size, y.size) > TEXT_MAX ? "binary" : kindOf(path, y.size < 1 << 20 ? this.store.blob(y.blob) : null)
    if (kind !== "binary") {
      if (!this.store.hasBlob(x.blob) || !this.store.hasBlob(y.blob) || bs.some((b) => b.blob && !this.store.hasBlob(b.blob))) return null
      const bt = this.textOfSet(bs), xt = this.blobText(x.blob), yt = this.blobText(y.blob)
      if (bt !== null && xt !== null && yt !== null) {
        const m = (kind === "json" && mergeJson(bt, yt, xt, true)) || mergeText(bt, yt, xt, true)
        const { blob, size } = this.putText(m.text)
        if (!m.clash) return node(blob, size)
        const keys = "keys" in m && Array.isArray(m.keys) ? { keys: m.keys as string[] } : {}
        return node(blob, size, loser(kind === "json" && "keys" in m ? "json" : "text",
          { base: this.putText(m.clash.base).blob, other: this.putText(m.clash.other).blob, lines: m.clash.lines, ...keys }))
      }
    }
    // Binary (or text that isn't UTF-8): the later stays, the other is kept beside it as a file of its own.
    return node(y.blob, y.size, loser("binary", { other: x.blob, copy: this.freeName(besideName(path, ax.device, ax.at), x.file) }))
  }

  /** A name no other live file has (case aside), from `want`. */
  private freeName(want: string, self: string): string {
    const taken = (p: string) => [...this.named.get(keyOf(p)) ?? []].some((f) => f !== self && this.heads(f).some((h) => h.blob !== null && keyOf(h.path) === keyOf(p)))
    let name = want
    for (let n = 2; taken(name); n++) name = want.replace(/(\)(\.[^./]*)?)$/, ` ${n}$1`)
    return name
  }

  /** Merge every file with several heads, and part files that came to share a name. Returns how many it made. */
  mergeAll(): number {
    let made_ = 0
    for (const [file] of this.byFile) {
      let hs = this.heads(file)
      if (hs.length > 1 && !this.whole(file)) continue
      while (hs.length > 1) {
        const m = this.merge2(hs[0], hs[1])
        if (!m) break
        this.record(m)
        made_++
        if (m.conflict?.kind === "binary" && m.conflict.copy && m.conflict.other) {
          // (the copy's file id comes from the merge, so every device makes the same one)
          const loser = this.nodes.get(m.parents.find((p) => this.nodes.get(p)!.blob === m.conflict!.other)!)!
          this.record(made({ file: sha(`copy:${m.id}`), path: m.conflict.copy, blob: m.conflict.other, size: loser.size, parents: [], clock: m.clock, device: "", at: m.at }))
        }
        hs = this.heads(file)
      }
    }
    // Two live files at one name (case aside): the one whose version is later moves aside.
    const byName = new Map<string, Node[]>()
    for (const [file] of this.byFile) { const h = this.head(file); if (h && h.blob !== null) { const k = keyOf(h.path); byName.set(k, [...(byName.get(k) ?? []), h]) } }
    for (const hs of byName.values()) {
      if (hs.length < 2) continue
      hs.sort(order)
      for (const h of hs.slice(1)) {
        const a = this.author(h), to = this.freeName(besideName(h.path, a.device, a.at), h.file)
        this.record(made({ file: h.file, path: to, blob: h.blob, size: h.size, parents: [h.id], clock: h.clock, device: "", at: h.at,
          conflict: { id: sha(`name:${h.id}`).slice(0, 16), kind: "name", base: null, other: null, device: a.device, at: a.at, copy: h.path } }))
        made_++
      }
    }
    return made_
  }

  // ---------- this device's own changes

  /** The live file whose version now is at `path` (case aside), or a deleted one last there. */
  private fileAt(path: string): { file: string; head: Node } | null {
    let gone: { file: string; head: Node } | null = null
    for (const file of this.named.get(keyOf(path)) ?? []) {
      const hs = this.heads(file).filter((h) => keyOf(h.path) === keyOf(path))
      const live = hs.filter((h) => h.blob !== null).pop()
      if (live) return { file, head: live }
      // (deleted only when every head is: one live head means the file is there)
      if (this.heads(file).some((h) => h.blob !== null)) continue
      const h = hs.pop()
      if (h && (!gone || order(gone.head, h) < 0)) gone = { file, head: h }
    }
    return gone
  }

  private fresh(o: { file: string; path: string; blob: string | null; size: number; parents: string[]; from?: string; settles?: string[]; confirmed?: boolean }): Node {
    const { from, settles, confirmed, ...rest } = o
    return made({ ...rest, clock: ++this.clock, device: this.device, at: this.now(), ...(from ? { from } : {}), ...(settles ? { settles } : {}), ...(confirmed ? { confirmed: true as const } : {}) })
  }

  /** Keep a file's bytes as a blob (text read, big binaries cloned when the store can). */
  private keep(folder: Folder, path: string, hash: string): boolean {
    if (this.store.hasBlob(hash)) return true
    if (this.store.keepFile?.(hash, folder, path)) return true
    const bytes = folder.read(path)
    if (!bytes || sha(bytes) !== hash) return false
    this.store.putBlob(hash, bytes)
    return true
  }

  /** Look at the input's files (these paths, or all of them) and record what changed as new versions. `seed`: the first
   *  look, where a file nobody has a version of yet becomes one every device makes alike. */
  scan(paths?: string[], { from }: { from?: string } = {}): { changed: number; held: number } {
    const all = !paths
    const list = paths ? paths.map(norm).filter((p) => !unsynced(p)) : this.input.list().map((s) => norm(s.path)).filter((p) => !unsynced(p))
    const now = new Map<string, FileStat | null>()
    for (const p of list) now.set(p, this.input.stat(p))
    if (all) for (const p of this.seen.keys()) if (!now.has(p)) now.set(p, null)
    const seed = this.seen.size === 0 && all && this.nodes.size === 0
    const gone: string[] = [], added: { path: string; st: FileStat; hash: string }[] = []
    let changed = 0
    for (const [p, st] of now) {
      const was = this.seen.get(p)
      if (!st) { if (was) gone.push(p); continue }
      if (was && was.size === st.size && was.mtime === st.mtime) continue
      const hash = this.input.hash(p)
      if (!hash) continue
      if (was && was.hash === hash) { this.seen.set(p, { ...was, size: st.size, mtime: st.mtime }); continue }
      if (!this.keep(this.input, p, hash)) continue
      if (!was) { added.push({ path: p, st, hash }); continue }
      const prev = this.nodes.get(was.node)
      if (!prev) { added.push({ path: p, st, hash }); continue }
      this.seen.set(p, { hash, node: this.adopt(prev, hash, p, st.size, from).id, size: st.size, mtime: st.mtime })
      changed++
    }
    // A file gone from one name and there under another, the same bytes: moved.
    for (const a of added) {
      const at = gone.findIndex((g) => this.seen.get(g)!.hash === a.hash)
      let node: Node
      if (at >= 0) {
        const g = gone.splice(at, 1)[0], was = this.seen.get(g)!, prev = this.nodes.get(was.node)!
        this.seen.delete(g)
        // (on the version that was there: one that came since and isn't written yet is merged with it, not undone)
        node = this.record(this.fresh({ file: prev.file, path: a.path, blob: a.hash, size: a.st.size, parents: [prev.id], from }))
      } else {
        const there = this.fileAt(a.path)
        const known = there && [...this.byFile.get(there.file)!].map((id) => this.nodes.get(id)!).filter((n) => n.blob === a.hash && keyOf(n.path) === keyOf(a.path)).sort(order).pop()
        if (there && there.head.blob === a.hash) node = there.head
        else if (known) node = known // (a version it had before: what came after stays, and is written here)
        // (a file made here at a name another device's file has, unseen here: begun apart, so both are kept when merged)
        else if (there && !this.tracks(there.file)) node = this.record(this.fresh({ file: there.file, path: a.path, blob: a.hash, size: a.st.size, parents: there.head.blob === null ? this.heads(there.file).map((h) => h.id) : [], from }))
        else {
          // (a new file; at a name another's file just moved to but that file is still here under its old name: a file
          // of its own, the two then part by name)
          const id = sha(`file:${keyOf(a.path)}`)
          const taken = this.byFile.has(id)
          const file = taken ? sha(`file:${keyOf(a.path)}:${this.device}:${this.clock + 1}`) : id
          // (a file found at the first look is one every device has the same version of: device "" and clock 0)
          node = this.record(seed && !taken ? made({ file, path: a.path, blob: a.hash, size: a.st.size, parents: [], clock: 0, device: "", at: 0 })
            : this.fresh({ file, path: a.path, blob: a.hash, size: a.st.size, parents: [], from }))
        }
      }
      this.seen.set(a.path, { hash: a.hash, node: node.id, size: a.st.size, mtime: a.st.mtime })
      changed++
    }
    // Deletes: many at once wait for the user (a folder that went missing looks like everything deleted).
    let heldN = 0
    if (gone.length) {
      const total = Math.max(this.seen.size, 1)
      if (!this.release && gone.length > this.guard.files && gone.length / total > this.guard.max) {
        this.held = { deletes: gone, since: this.now() }
        heldN = gone.length
        this.onLog(`held ${gone.length} deletes for your yes (sync.release)`)
      } else {
        for (const g of gone) {
          const was = this.seen.get(g)!, prev = this.nodes.get(was.node)
          this.seen.delete(g)
          if (!prev) continue
          const cur = this.current(prev)
          if (cur.blob === null) continue // (already gone)
          // (on the version that was there: an edit since, from elsewhere, brings the file back)
          this.record(this.fresh({ file: prev.file, path: prev.path, blob: null, size: 0, parents: [prev.id], from, confirmed: this.release }))
          changed++
        }
        if (this.release) { this.release = false; this.held = null }
      }
    }
    this.save()
    return { changed, held: heldN }
  }

  /** Whether the input has this file under some name. */
  private tracks(file: string) {
    for (const t of this.seen.values()) if (this.nodes.get(t.node)?.file === file) return true
    return false
  }

  /** The version a file is at now, from one it was at (its single head, else that one). */
  private current(n: Node): Node { return this.head(n.file) ?? n }

  /** The input's file went from version `prev` to bytes `hash`: a version another device already made of it (it came
   *  here by another route, iCloud say), else a new one. */
  private adopt(prev: Node, hash: string, path: string, size: number, from?: string): Node {
    const h = this.head(prev.file)
    if (h && h.blob === hash && keyOf(h.path) === keyOf(path)) return h
    for (const k of this.kids.get(prev.id) ?? []) { const n = this.nodes.get(k)!; if (n.blob === hash && keyOf(n.path) === keyOf(path)) return n }
    return this.record(this.fresh({ file: prev.file, path, blob: hash, size, parents: [prev.id], from }))
  }

  /** A file written where this device keeps a one-way copy (the iCloud copy): a version on the one copied there, or a
   *  new file. Merged with what came since like any edit, so nothing written there is lost or written over unseen. */
  foreign(path: string, bytes: Uint8Array, parent: string | null, from: string): Node {
    const blob = sha(bytes)
    if (!this.store.hasBlob(blob)) this.store.putBlob(blob, bytes)
    const p = parent ? this.nodes.get(parent) : null
    if (p) return this.record(this.fresh({ file: p.file, path: norm(path), blob, size: bytes.length, parents: [p.id], from }))
    const there = this.fileAt(norm(path))
    if (there) return this.record(this.fresh({ file: there.file, path: norm(path), blob, size: bytes.length, parents: there.head.blob === null ? [there.head.id] : [], from }))
    return this.record(this.fresh({ file: sha(`file:${keyOf(path)}:${from}:${this.clock + 1}`), path: norm(path), blob, size: bytes.length, parents: [], from }))
  }

  /** Settle a conflict (the user chose): a version on the file's head that says so. */
  settle(file: string, ids: string[]): Node | null {
    const h = this.head(file)
    if (!h) return null
    return this.record(this.fresh({ file, path: h.path, blob: h.blob, size: h.size, parents: [h.id], settles: ids }))
  }

  /** The open conflicts: a merge's clash no later version settled, newest first. */
  conflicts(): { file: string; path: string; node: string; conflict: Conflict }[] {
    const out: { file: string; path: string; node: string; conflict: Conflict }[] = []
    for (const [file] of this.byFile) {
      const h = this.head(file)
      if (!h) continue
      const settled = new Set<string>(), seenOther = new Set<string>()
      const anc = [...this.ancestors(h.id)].map((id) => this.nodes.get(id)!).sort((a, b) => order(b, a))
      for (const n of anc) for (const s of n.settles ?? []) settled.add(s)
      for (const n of anc) {
        const c = n.conflict
        if (!c || settled.has(c.id)) continue
        const key = `${c.kind}:${c.other ?? c.copy ?? c.id}`
        if (seenOther.has(key)) continue // (two merges of the same clash, made on two devices)
        seenOther.add(key)
        out.push({ file, path: h.path, node: n.id, conflict: c })
      }
    }
    return out
  }

  // ---------- writing versions into the folder

  /** Write each file's version into the folder where it isn't yet. A file changed there since it was last seen is
   *  looked at first (a new version, merged), never written over. */
  materialize(): { wrote: number; held: number } {
    const target = new Map<string, Node>()
    for (const [file] of this.byFile) { const h = this.head(file); if (h) target.set(file, h) }
    const at = new Map<string, Tracked & { path: string }>() // file -> where it's written now
    for (const [p, t] of this.wrote) { const n = this.nodes.get(t.node); if (n) at.set(n.file, { ...t, path: p }) }
    const deletes = [...target.values()].filter((h) => h.blob === null && at.has(h.file) && !h.confirmed)
    const total = Math.max(this.wrote.size, 1)
    if (!this.release && deletes.length > this.guard.files && deletes.length / total > this.guard.max) {
      if (!this.held) { this.held = { deletes: deletes.map((d) => d.path), since: this.now() }; this.onLog(`held ${deletes.length} deletes for your yes (sync.release)`) }
      this.save()
      return { wrote: 0, held: deletes.length }
    }
    let wrote = 0
    const changedHere = (t: Tracked & { path: string }) => {
      const st = this.folder.stat(t.path)
      return !!st && (st.size !== t.size || st.mtime !== t.mtime) && this.folder.hash(t.path) !== t.hash
    }
    // Deletes first, so the names they leave are free.
    let pending: Node[] = []
    for (const h of target.values()) {
      const now = at.get(h.file)
      if (now && now.node === h.id) continue
      if (now && now.hash === h.blob && now.path === h.path) { this.wrote.set(h.path, { ...now, node: h.id }); continue }
      if (now && changedHere(now)) continue // (changed here: looked at first, then merged)
      if (h.blob === null) { if (now) { this.folder.remove(now.path); this.wrote.delete(now.path); at.delete(h.file); wrote++ } continue }
      pending.push(h)
    }
    // Then moves and writes, each once its name is free; files trading names go through a temporary one.
    const moving = () => new Set(pending.map((h) => h.file))
    for (let round = 0; pending.length && round < pending.length * 3 + 3; round++) {
      const left: Node[] = [], away = moving()
      let progress = false
      for (const h of pending) {
        const now = at.get(h.file), there = this.wrote.get(h.path), thereFile = there && this.nodes.get(there.node)?.file
        if (there && thereFile !== h.file) {
          if (thereFile && away.has(thereFile)) { left.push(h); continue } // (it's leaving: next round)
          continue // (another live file has the name: the name clash is merged first)
        }
        if (!there && !now && this.folder.stat(h.path) && !this.shadow) continue // (a file here not looked at yet)
        if (!this.store.hasBlob(h.blob!) && !(now && now.hash === h.blob)) continue // (its bytes aren't here yet)
        let st: FileStat | null
        if (now && now.path !== h.path && now.hash === h.blob) st = this.folder.move(now.path, h.path)
        else {
          const file = h.size > 1 << 20 && this.folder.copyIn ? this.store.blobFile?.(h.blob!) : null
          if (file) { st = this.folder.copyIn!(h.path, file, h.blob!); if (st) this.store.placed?.(h.blob!, this.folder, h.path) }
          else {
            const bytes = this.store.blob(h.blob!)
            if (!bytes) continue
            st = this.folder.write(h.path, bytes)
          }
          if (now && now.path !== h.path) this.folder.remove(now.path)
        }
        if (now) this.wrote.delete(now.path)
        if (st) { const t = { hash: h.blob!, node: h.id, size: st.size, mtime: st.mtime }; this.wrote.set(h.path, t); at.set(h.file, { ...t, path: h.path }) }
        wrote++; progress = true
      }
      pending = left
      if (!progress && pending.length) {
        // (a cycle: one steps aside to a name sync never syncs, and goes to its own next round)
        const h = pending[0], now = at.get(h.file)!
        const there = this.wrote.get(h.path)!, f = this.nodes.get(there.node)!.file, occupant = at.get(f)!
        const tmp = `${occupant.path}.${there.node.slice(0, 8)}.sync-part`
        const st = this.folder.move(occupant.path, tmp)
        this.wrote.delete(occupant.path)
        if (st) { const t = { ...occupant, size: st.size, mtime: st.mtime }; this.wrote.set(tmp, t); at.set(f, { ...t, path: tmp }) }
        void now
      }
    }
    if (this.release) { this.release = false; this.held = null }
    this.save()
    return { wrote, held: 0 }
  }

  /** Look, merge, write: what a device does after a change of its own or a peer's. */
  step(paths?: string[]) {
    const s = this.scan(paths)
    if (process.env.SYNC_DEBUG) this.audit("scan")
    const m = this.mergeAll()
    const w = this.materialize()
    if (process.env.SYNC_DEBUG) this.audit("materialize")
    // (writing may have shown a file changed here meanwhile: looked at again next step)
    return { changed: s.changed, merged: m, wrote: w.wrote, held: s.held + w.held }
  }

  /** Let held deletes through (the user said yes), or forget them (`no`: the files are written back). */
  releaseHeld(yes: boolean) {
    if (!this.held) return 0
    const n = this.held.deletes.length
    if (yes) this.release = true
    else {
      // (no: what looked deleted is written back from its versions)
      for (const p of this.held.deletes) { const t = this.seen.get(p); if (t && this.input === this.folder) this.wrote.delete(p) }
      this.held = null
    }
    this.save()
    return n
  }

  audit(where: string) {
    const by = new Map<string, string>()
    for (const [p, t] of this.wrote) { const f = this.nodes.get(t.node)?.file ?? "?"; if (by.has(f)) throw new Error(`${this.device} after ${where}: file ${f.slice(0, 6)} at ${by.get(f)} and ${p}`); by.set(f, p) }
  }

  status(): Status {
    let files = 0, heads = 0
    for (const [file] of this.byFile) { const h = this.heads(file); heads += h.length; if (h.length === 1 && h[0].blob !== null) files++ }
    let waiting = 0
    for (const w of this.waiting.values()) waiting += w.size
    return { device: this.device, vector: this.vector(), files, heads, waiting, missingBlobs: this.missingBlobs().length,
      held: this.held ? { deletes: this.held.deletes.length, since: this.held.since } : null, conflicts: this.conflicts().length }
  }

  /** Each live file's path and blob, as its versions say now (to compare devices, or a copy with the vault). */
  snapshot(): Map<string, string> {
    const out = new Map<string, string>()
    for (const [file] of this.byFile) { const h = this.head(file); if (h && h.blob) out.set(h.path, h.blob) }
    return out
  }
}

/** The later of two versions: Lamport clock, then device, then id; never the wall clock. */
export function order(a: Node, b: Node) {
  return a.clock - b.clock || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** A merge's path: the side that moved it (both: the later one, y). */
function mergedPath(base: string | null, x: string, y: string) {
  if (x === y) return x
  if (base !== null && x === base) return y
  if (base !== null && y === base) return x
  return y
}

export const textBytes = (s: string) => enc.encode(s)
