// A folder and a store in memory, for device sync's engine tests (core/syncengine.ts).
import { type Entry, type FileStat, type Folder, sha, type Store } from "../../core/syncengine.ts"

export class MemFolder implements Folder {
  files = new Map<string, { bytes: Uint8Array; mtime: number }>()
  private tick = 1
  list(): FileStat[] { return [...this.files].map(([path, f]) => ({ path, size: f.bytes.length, mtime: f.mtime })) }
  stat(p: string): FileStat | null { const f = this.files.get(p); return f ? { path: p, size: f.bytes.length, mtime: f.mtime } : null }
  read(p: string) { return this.files.get(p)?.bytes ?? null }
  hash(p: string) { const f = this.files.get(p); return f ? sha(f.bytes) : null }
  write(p: string, bytes: Uint8Array): FileStat { this.files.set(p, { bytes, mtime: this.tick++ }); return this.stat(p)! }
  move(a: string, b: string) { const f = this.files.get(a); if (!f) return null; this.files.delete(a); this.files.set(b, { ...f, mtime: this.tick++ }); return this.stat(b) }
  remove(p: string) { this.files.delete(p) }
  text(p: string) { const f = this.files.get(p); return f ? new TextDecoder().decode(f.bytes) : null }
  put(p: string, text: string) { return this.write(p, new TextEncoder().encode(text)) }
}

export class MemStore implements Store {
  log: Entry[] = []
  st: Record<string, unknown> | null = null
  blobs = new Map<string, Uint8Array>()
  entries() { return [...this.log] }
  append(es: Entry[]) { this.log.push(...es) }
  state() { return this.st ? structuredClone(this.st) : null }
  saveState(s: Record<string, unknown>) { this.st = structuredClone(s) }
  hasBlob(h: string) { return this.blobs.has(h) }
  blob(h: string) { return this.blobs.get(h) ?? null }
  putBlob(h: string, b: Uint8Array) { this.blobs.set(h, b) }
}
