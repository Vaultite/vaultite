// A device's folder and store on disk. The folder is written like iCloud writes it (whole files, replaced at once), not
// through the app's write gate: sync carries files, it doesn't author them.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { type Entry, type FileStat, type Folder, norm, sha, type Store, unsynced } from "./engine.ts"

const rel = (root: string, abs: string) => norm(path.relative(root, abs).split(path.sep).join("/"))

export class DiskFolder implements Folder {
  readonly root: string
  /** Hashes worked out ahead (prepare), by path, for the size and mtime they were of. */
  private hashes = new Map<string, { size: number; mtime: number; hash: string }>()
  constructor(root: string) { this.root = root }
  abs(p: string) { return path.join(this.root, ...p.split("/")) }

  list(): FileStat[] {
    const out: FileStat[] = []
    const walk = (dir: string) => {
      let names: fs.Dirent[]
      try { names = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const d of names) {
        const abs = path.join(dir, d.name), r = rel(this.root, abs)
        if (unsynced(r)) continue
        if (d.isDirectory()) walk(abs)
        else if (d.isFile()) { const st = this.stat(r); if (st) out.push(st) }
      }
    }
    walk(this.root)
    return out
  }
  stat(p: string): FileStat | null {
    try { const st = fs.statSync(this.abs(p)); return st.isFile() ? { path: p, size: st.size, mtime: Math.round(st.mtimeMs) } : null } catch { return null }
  }
  read(p: string) { try { return new Uint8Array(fs.readFileSync(this.abs(p))) } catch { return null } }
  hash(p: string): string | null {
    const st = this.stat(p)
    if (!st) return null
    const c = this.hashes.get(p)
    if (c && c.size === st.size && c.mtime === st.mtime) return c.hash
    const b = this.read(p)
    if (!b) return null
    const h = sha(b)
    this.hashes.set(p, { size: st.size, mtime: st.mtime, hash: h })
    return h
  }
  /** Hash these files ahead, streamed and a few at a time, so the engine's look at them doesn't hold the server. */
  async prepare(paths: string[], known: (p: string) => { size: number; mtime: number } | undefined) {
    for (const p of paths) {
      const st = this.stat(p)
      if (!st) continue
      const k = known(p), c = this.hashes.get(p)
      if ((k && k.size === st.size && k.mtime === st.mtime) || (c && c.size === st.size && c.mtime === st.mtime)) continue
      if (st.size < 256 << 10) continue // (small: hashed on the spot)
      try {
        const h = crypto.createHash("sha256")
        for await (const chunk of fs.createReadStream(this.abs(p))) h.update(chunk as Buffer)
        this.hashes.set(p, { size: st.size, mtime: st.mtime, hash: h.digest("hex") })
      } catch { /* gone, or not downloaded yet: looked at later */ }
    }
  }
  write(p: string, bytes: Uint8Array): FileStat {
    const abs = this.abs(p), tmp = `${abs}.${process.pid}.sync-part`
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(tmp, bytes)
    fs.renameSync(tmp, abs)
    const st = this.stat(p)!
    this.hashes.set(p, { size: st.size, mtime: st.mtime, hash: sha(bytes) })
    return st
  }
  /** Write a stored blob's file without reading it into memory (a clone where the disk can). */
  copyIn(p: string, from: string, hash: string): FileStat | null {
    const abs = this.abs(p), tmp = `${abs}.${process.pid}.sync-part`
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.copyFileSync(from, tmp, fs.constants.COPYFILE_FICLONE)
    fs.renameSync(tmp, abs)
    const st = this.stat(p)
    if (st) this.hashes.set(p, { size: st.size, mtime: st.mtime, hash })
    return st
  }
  move(a: string, b: string): FileStat | null {
    const to = this.abs(b)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    try { fs.renameSync(this.abs(a), to) } catch { return null }
    const c = this.hashes.get(a)
    this.hashes.delete(a)
    const st = this.stat(b)
    if (c && st) this.hashes.set(b, { ...c, mtime: st.mtime })
    this.prune(path.dirname(this.abs(a)))
    return st
  }
  remove(p: string) {
    fs.rmSync(this.abs(p), { force: true })
    this.hashes.delete(p)
    this.prune(path.dirname(this.abs(p)))
  }
  /** Folders a delete or move left empty go too (as another device's would), never the root. */
  private prune(dir: string) {
    while (dir.startsWith(this.root + path.sep)) {
      try { if (fs.readdirSync(dir).some((n) => n !== ".DS_Store")) return; fs.rmSync(dir, { recursive: true }) } catch { return }
      dir = path.dirname(dir)
    }
  }
}

/** Logs (a JSON line per entry, a file per device), blobs by hash, and the state, under one folder. */
export class DiskStore implements Store {
  readonly dir: string
  private pending: Record<string, unknown> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(dir: string) { this.dir = dir; fs.mkdirSync(path.join(dir, "log"), { recursive: true }); fs.mkdirSync(path.join(dir, "blobs"), { recursive: true }) }

  entries(): Entry[] {
    const out: Entry[] = []
    for (const f of fs.readdirSync(path.join(this.dir, "log")).filter((n) => n.endsWith(".jsonl")).sort()) {
      for (const line of fs.readFileSync(path.join(this.dir, "log", f), "utf8").split("\n")) {
        if (!line.trim()) continue
        try { out.push(JSON.parse(line)) } catch { /* a line cut short by a crash: its entry comes again from a peer */ }
      }
    }
    // (each device's in order: take() fills gaps from what comes later)
    return out.sort((a, b) => (a.device < b.device ? -1 : a.device > b.device ? 1 : a.seq - b.seq))
  }
  append(es: Entry[]) {
    const by = new Map<string, string[]>()
    for (const e of es) by.set(e.device, [...(by.get(e.device) ?? []), JSON.stringify(e)])
    for (const [d, lines] of by) fs.appendFileSync(path.join(this.dir, "log", `${encodeURIComponent(d)}.jsonl`), lines.join("\n") + "\n")
  }
  state() {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, "state.json"), "utf8")) } catch { return null }
  }
  /** Written a moment later (a step saves often); `flush` writes it now. */
  saveState(s: Record<string, unknown>) {
    this.pending = s
    this.timer ??= setTimeout(() => this.flush(), 1500)
    this.timer.unref?.()
  }
  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.pending) return
    const file = path.join(this.dir, "state.json"), tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.pending))
    fs.renameSync(tmp, file)
    this.pending = null
  }
  blobPath(h: string) { return path.join(this.dir, "blobs", h.slice(0, 2), h) }
  hasBlob(h: string) { return fs.existsSync(this.blobPath(h)) }
  blob(h: string) {
    try {
      const b = new Uint8Array(fs.readFileSync(this.blobPath(h)))
      if (sha(b) === h) return b
      fs.rmSync(this.blobPath(h), { force: true }) // (a linked copy changed under it: not that version any more)
    } catch { /* none */ }
    return null
  }
  putBlob(h: string, b: Uint8Array) {
    const p = this.blobPath(h)
    if (fs.existsSync(p)) return
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(`${p}.tmp`, b)
    fs.renameSync(`${p}.tmp`, p)
  }
  /** A clone on APFS (no space until one changes); elsewhere a hard link, checked by hash when read. */
  keepFile(h: string, folder: Folder, p: string) {
    if (!(folder instanceof DiskFolder)) return false
    const to = this.blobPath(h)
    if (fs.existsSync(to)) return true
    fs.mkdirSync(path.dirname(to), { recursive: true })
    try {
      if (process.platform === "darwin") fs.copyFileSync(folder.abs(p), `${to}.tmp`, fs.constants.COPYFILE_FICLONE_FORCE)
      else fs.linkSync(folder.abs(p), `${to}.tmp`)
      fs.renameSync(`${to}.tmp`, to)
      return true
    } catch { fs.rmSync(`${to}.tmp`, { force: true }); return false }
  }
  blobFile(h: string) { const p = this.blobPath(h); return fs.existsSync(p) ? p : null }
  blobSize(h: string) { try { return fs.statSync(this.blobPath(h)).size } catch { return -1 } }
}
