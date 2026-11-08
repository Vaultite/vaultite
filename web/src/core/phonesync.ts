// The iPhone app's copy of the vault (device sync, plugins/core/sync): plain files in the app's container, kept in step
// from the hub's page while online, so the offline app (web/offline/) opens them when the hub can't be reached.
import { type Entry, type FileStat, type Folder, kindOf, norm, PROTOCOL, Replica, sha, type Store, unsynced, type Vector } from "../../../core/syncengine.ts"
import { phoneLocal, type LocalArea } from "@/core/phoneapp"

const BATCH = 4 << 20, TEXT_MAX = 8 << 20, PULL_MS = 15_000
const b64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const enc = new TextEncoder()
/** Kept in memory (and so synced in full): text and settings; media stays a file the app reads from disk. */
const inMemory = (path: string, size: number) => kindOf(path) !== "binary" || size < 64 << 10

type Local = NonNullable<typeof phoneLocal>
/** One native write after another, so a file's writes land in order. */
class Queue {
  private last: Promise<unknown> = Promise.resolve()
  failed = 0
  add(fn: () => Promise<unknown>) { this.last = this.last.then(fn).catch(() => { this.failed++ }); return this.last }
  done() { return this.last }
}

/** The phone's vault folder: text in memory, written through to the container; media there only, by its known hash. */
export class PhoneFolder implements Folder {
  files = new Map<string, { bytes: Uint8Array | null; size: number; mtime: number; hash?: string }>()
  readonly q = new Queue()
  readonly local: Local
  readonly vault: string
  constructor(local: Local, vault: string) { this.local = local; this.vault = vault }
  static async load(local: Local, vault: string, area: LocalArea = "vault") {
    const f = new PhoneFolder(local, vault)
    const { files } = await local.list({ area, vault })
    const want: string[] = []
    for (const s of files) {
      const p = norm(s.path)
      if (unsynced(p)) continue
      f.files.set(p, { bytes: null, size: s.size, mtime: s.mtime })
      if (inMemory(p, s.size)) want.push(p)
    }
    for (let i = 0; i < want.length;) {
      // (read in batches of a few MB: the bridge carries base64)
      const part: string[] = []
      for (let n = 0; i < want.length && (n < BATCH || !part.length); i++) { part.push(want[i]); n += f.files.get(want[i])!.size }
      const got = (await local.read({ area, vault, paths: part })).files
      for (const p of part) { const d = got[p]; if (d != null) { f.files.get(p)!.bytes = unb64(d); f.hash(p) } }
    }
    return f
  }
  list(): FileStat[] { return [...this.files].map(([path, f]) => ({ path, size: f.size, mtime: f.mtime })) }
  stat(p: string): FileStat | null { const f = this.files.get(p); return f ? { path: p, size: f.size, mtime: f.mtime } : null }
  read(p: string) { return this.files.get(p)?.bytes ?? null }
  hash(p: string) { const f = this.files.get(p); if (!f) return null; if (!f.hash && f.bytes) { f.hash = sha(f.bytes); this.byHash.set(f.hash, p) } return f.hash ?? null }
  /** Which file has these bytes (the store's blobs that are the folder's own files). */
  byHash = new Map<string, string>()
  bytesOf(h: string) { const p = this.byHash.get(h), f = p ? this.files.get(p) : null; return f && f.hash === h ? f.bytes : null }
  /** A media file that came straight to disk (localFetch): its bytes' hash, known without reading them. */
  known(p: string, st: { size: number; mtime: number; sha256: string }) { this.files.set(p, { bytes: null, size: st.size, mtime: st.mtime, hash: st.sha256 }); this.byHash.set(st.sha256, p) }
  write(p: string, bytes: Uint8Array): FileStat {
    const prev = this.files.get(p)?.mtime ?? 0, mtime = Math.max(Date.now(), prev + 1)
    const h = sha(bytes)
    this.files.set(p, { bytes, size: bytes.length, mtime, hash: h })
    this.byHash.set(h, p)
    void this.q.add(async () => { const st = await this.local.write({ area: "vault", vault: this.vault, path: p, data: b64(bytes) }); const f = this.files.get(p); if (f && f.bytes === bytes) f.mtime = st.mtime })
    return { path: p, size: bytes.length, mtime }
  }
  move(a: string, b: string): FileStat | null {
    const f = this.files.get(a)
    if (!f) return null
    this.files.delete(a); this.files.set(b, f)
    void this.q.add(() => this.local.move({ area: "vault", vault: this.vault, from: a, to: b }))
    return this.stat(b)
  }
  remove(p: string) { this.files.delete(p); void this.q.add(() => this.local.remove({ area: "vault", vault: this.vault, path: p })) }
  /** Look at the container again: what the offline app or the Files app changed there since. */
  async refresh(area: LocalArea = "vault") {
    const { files } = await this.local.list({ area, vault: this.vault })
    const now = new Map(files.map((s) => [norm(s.path), s])), reread: string[] = []
    for (const p of [...this.files.keys()]) if (!now.has(p)) this.files.delete(p)
    for (const [p, s] of now) {
      if (unsynced(p)) continue
      const f = this.files.get(p)
      if (f && f.size === s.size && f.mtime === s.mtime) continue
      this.files.set(p, { bytes: null, size: s.size, mtime: s.mtime })
      if (inMemory(p, s.size)) reread.push(p)
    }
    for (let i = 0; i < reread.length; i += 100) {
      const got = (await this.local.read({ area, vault: this.vault, paths: reread.slice(i, i + 100) })).files
      for (const p of reread.slice(i, i + 100)) { const d = got[p], f = this.files.get(p); if (d != null && f) { f.bytes = unb64(d); this.hash(p) } }
    }
  }
  /** Read what isn't in memory yet but must be (a file made offline, a photo taken there), so a step can hash it. */
  async prepare(seen: (p: string) => { size: number; mtime: number } | undefined) {
    const want = [...this.files].filter(([p, f]) => !f.bytes && !f.hash && f.size <= TEXT_MAX * 4 && seen(p)?.mtime !== f.mtime).map(([p]) => p)
    for (const p of want) {
      const d = (await this.local.read({ area: "vault", vault: this.vault, paths: [p] })).files[p]
      const f = this.files.get(p)
      if (d != null && f) { const bytes = unb64(d); f.hash = sha(bytes); if (inMemory(p, bytes.length)) f.bytes = bytes; else this.spare.set(f.hash, bytes) }
    }
  }
  /** Bytes read by prepare for a step that keeps them as a blob once (a new photo), then let go. */
  spare = new Map<string, Uint8Array>()
}

/** The phone's logs, state and text blobs, in the container's sync area; a blob that's a file of the folder isn't kept twice. */
export class PhoneStore implements Store {
  log: Entry[] = []
  st: Record<string, unknown> | null = null
  blobs = new Map<string, Uint8Array>()
  readonly q = new Queue()
  private timer: ReturnType<typeof setTimeout> | null = null
  folder: PhoneFolder | null = null
  readonly local: Local
  readonly vault: string
  constructor(local: Local, vault: string) { this.local = local; this.vault = vault }
  static async load(local: Local, vault: string) {
    const s = new PhoneStore(local, vault)
    const { files } = await local.list({ area: "sync", vault })
    const names = files.map((f) => f.path).filter((p) => p.startsWith("log/") || p === "state.json" || p.startsWith("blobs/"))
    for (let i = 0; i < names.length; i += 200) {
      const got = (await local.read({ area: "sync", vault, paths: names.slice(i, i + 200) })).files
      for (const [p, d] of Object.entries(got)) {
        if (d == null) continue
        const bytes = unb64(d)
        if (p === "state.json") { try { s.st = JSON.parse(new TextDecoder().decode(bytes)) } catch { /* a broken one: rebuilt */ } }
        else if (p.startsWith("blobs/")) s.blobs.set(p.slice(p.lastIndexOf("/") + 1), bytes)
        else for (const line of new TextDecoder().decode(bytes).split("\n")) { if (line.trim()) try { s.log.push(JSON.parse(line)) } catch { /* cut short */ } }
      }
    }
    s.log.sort((a, b) => (a.device < b.device ? -1 : a.device > b.device ? 1 : a.seq - b.seq))
    return s
  }
  entries() { return [...this.log] }
  append(es: Entry[]) {
    this.log.push(...es)
    const by = new Map<string, string>()
    for (const e of es) by.set(e.device, (by.get(e.device) ?? "") + JSON.stringify(e) + "\n")
    for (const [d, text] of by) void this.q.add(() => this.local.write({ area: "sync", vault: this.vault, path: `log/${encodeURIComponent(d)}.jsonl`, data: b64(enc.encode(text)), append: true }))
  }
  state() { return this.st ? structuredClone(this.st) : null }
  saveState(s: Record<string, unknown>) {
    this.st = s
    this.timer ??= setTimeout(() => this.flush(), 1500)
  }
  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const s = this.st
    if (s) void this.q.add(() => this.local.write({ area: "sync", vault: this.vault, path: "state.json", data: b64(enc.encode(JSON.stringify(s))) }))
  }
  private inFolder(h: string) { return this.folder?.bytesOf(h) ?? null }
  hasBlob(h: string) { return this.blobs.has(h) || !!this.inFolder(h) || !!this.folder?.spare.has(h) }
  blob(h: string) { return this.blobs.get(h) ?? this.inFolder(h) ?? this.folder?.spare.get(h) ?? null }
  putBlob(h: string, b: Uint8Array) {
    if (this.blobs.has(h) || b.length > TEXT_MAX) return
    this.blobs.set(h, b)
    void this.q.add(() => this.local.write({ area: "sync", vault: this.vault, path: `blobs/${h.slice(0, 2)}/${h}`, data: b64(b) }))
  }
}

export type PhoneSync = {
  vault: string; set: string; readOnly: boolean; replica: Replica; folder: PhoneFolder; store: PhoneStore
  last: number; error: string; downloading: Set<string>
  step(): Promise<void>
}

/** What the hub says about syncing this phone (GET sync/phone): the set, whether it's the real vault yet, the rules. */
type Info = { set: string | null; vault: string; readOnly: boolean; device: string }

/** Where an image's small picture is kept on the phone (the sync area), so the offline app shows it for an image left on the hub. */
export const previewPath = (path: string) => `previews/${sha(norm(path))}.jpg`

let running: PhoneSync | null = null
export const phoneSync = () => running

/** Start the phone's copy, once, from the hub's page in the iPhone app. Nothing elsewhere. */
export async function startPhoneSync(get: (route: string) => Promise<unknown>, post: (route: string, body: unknown) => Promise<unknown>, server = location.origin) {
  if (!phoneLocal || running) return running
  const info = await get("sync/phone").catch(() => null) as Info | null
  if (!info?.set) return null
  await phoneLocal.setOffline({ server, vault: info.vault }).catch(() => {})
  const [folder, store] = await Promise.all([PhoneFolder.load(phoneLocal, info.vault), PhoneStore.load(phoneLocal, info.vault)])
  store.folder = folder
  const replica = new Replica({ device: info.device, store, folder })
  const s: PhoneSync = { vault: info.vault, set: info.set, readOnly: info.readOnly, replica, folder, store, last: 0, error: "", downloading: new Set(),
    step: () => chain = chain.then(() => once(s, post)).catch((e) => { s.error = (e as Error).message }) }
  let chain: Promise<void> = Promise.resolve()
  running = s
  void s.step()
  setInterval(() => void s.step(), PULL_MS)
  addEventListener("vaultite:back", () => void s.step())
  addEventListener("online", () => void s.step())
  return s
}

/** Look at the copy (what the offline app changed), trade with the hub, take the text and previews, write the copy. */
async function once(s: PhoneSync, post: (route: string, body: unknown) => Promise<unknown>) {
  await s.folder.q.done()
  await s.folder.refresh()
  await s.folder.prepare((p) => s.replica.seen.get(p))
  const looked = s.replica.scan()
  let theirs: Vector | null = null
  for (let round = 0; round < 30; round++) {
    const send = theirs ? s.replica.missing(theirs, 2000) : []
    const blobs: Record<string, string> = {}
    let total = 0
    for (const e of send) { const h = e.node.blob, b = h && !blobs[h] ? s.store.blob(h) : null; if (b && total < BATCH * 2) { blobs[h!] = b64(b); total += b.length } }
    const r = await post("sync/exchange", { set: s.set, device: s.replica.device, protocol: PROTOCOL, vector: s.replica.vector(), entries: send, blobs }) as
      { vector: Vector; entries: Entry[]; blobs?: Record<string, string>; more?: boolean }
    for (const [h, d] of Object.entries(r.blobs ?? {})) { const bytes = unb64(d); if (sha(bytes) === h) s.store.putBlob(h, bytes) }
    s.replica.receive(r.entries ?? [])
    theirs = r.vector
    if (!r.more && !s.replica.missing(theirs, 1).length) break
  }
  // Text the logs name that didn't come inline, in batches.
  const textWant = s.replica.missingBlobs().filter((h) => { const n = headWith(s.replica, h); return !n || kindOf(n.path) !== "binary" || n.size < 64 << 10 })
  for (let i = 0; i < textWant.length; i += 300) {
    const r = await post("sync/blobs", { set: s.set, hashes: textWant.slice(i, i + 300) }) as { blobs: Record<string, string> }
    for (const [h, d] of Object.entries(r.blobs ?? {})) { const bytes = unb64(d); if (sha(bytes) === h) s.store.putBlob(h, bytes) }
  }
  s.replica.mergeAll()
  s.replica.materialize()
  // (a merge made here goes to the hub at once)
  const after = s.replica.missing(theirs ?? {}, 2000)
  if (after.length) await post("sync/exchange", { set: s.set, device: s.replica.device, protocol: PROTOCOL, vector: s.replica.vector(), entries: after, blobs: {} })
  s.store.flush()
  await Promise.all([s.folder.q.done(), s.store.q.done()])
  s.last = Date.now(); s.error = ""
  dispatchEvent(new Event("vaultite:phone-sync"))
  if (looked.waiting) setTimeout(() => void s.step(), 1000) // (deletes wait a look: the next one, soon)
}

function headWith(r: Replica, blob: string) {
  for (const [file] of r.byFile) { const h = r.head(file); if (h?.blob === blob) return h }
  return null
}

/** Bring a media file onto the phone (its bytes straight from the hub to the container), as its version. */
export async function keepHere(s: PhoneSync, path: string, blobUrl: (set: string, hash: string) => string) {
  const p = norm(path), h = [...s.replica.byFile.keys()].map((f) => s.replica.head(f)).find((n) => n?.path === p && n.blob)
  if (!h || !phoneLocal || s.downloading.has(p)) return false
  s.downloading.add(p)
  dispatchEvent(new Event("vaultite:phone-sync"))
  try {
    const st = await phoneLocal.fetch({ area: "vault", vault: s.vault, path: p, url: new URL(blobUrl(s.set, h.blob!), location.href).href })
    if (st.sha256 !== h.blob) { await phoneLocal.remove({ area: "vault", vault: s.vault, path: p }); return false }
    s.folder.known(p, st)
    s.replica.adoptFile(p, st.sha256, st.size, st.mtime)
    return true
  } finally { s.downloading.delete(p); dispatchEvent(new Event("vaultite:phone-sync")) }
}

/** Let a media file go from the phone (its preview stays): online only again, never deleted anywhere. */
export async function letGo(s: PhoneSync, path: string) {
  const p = norm(path)
  if (!phoneLocal || !s.folder.files.has(p) || inMemory(p, s.folder.files.get(p)!.size)) return false
  s.replica.forget(p)
  s.folder.files.delete(p)
  await phoneLocal.remove({ area: "vault", vault: s.vault, path: p })
  dispatchEvent(new Event("vaultite:phone-sync"))
  return true
}
