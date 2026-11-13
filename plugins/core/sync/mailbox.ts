import fs from "node:fs"
import path from "node:path"
import type { Replica, Vector } from "../../../core/plugins.ts"
import type { DiskStore } from "./disk.ts"
import { Entries } from "./wire.ts"

const SEGMENT = 1000, BLOB_MAX = 8 << 20
const segName = (from: number, to: number) => `seg-${String(from).padStart(9, "0")}-${String(to).padStart(9, "0")}.jsonl`
const SEG = /^seg-(\d+)-(\d+)\.jsonl$/

export class Mailbox {
  readonly root: string
  readonly device: string
  read: Record<string, number> = {}
  written = 0
  private acked = ""
  constructor(root: string, device: string, saved?: { read?: Record<string, number>; written?: number }) {
    this.root = root; this.device = device
    this.read = { ...(saved?.read ?? {}) }; this.written = saved?.written ?? 0
  }
  private own() { return path.join(this.root, encodeURIComponent(this.device)) }
  saved() { return { read: this.read, written: this.written } }

  write(r: Replica, store: DiskStore): number {
    const log = r.logs.get(this.device) ?? []
    const dir = this.own()
    fs.mkdirSync(path.join(dir, "blobs"), { recursive: true })
    if (this.written && !fs.readdirSync(dir).some((n) => SEG.test(n))) this.written = 0
    let n = 0
    while (this.written < log.length) {
      const part = log.slice(this.written, this.written + SEGMENT)
      for (const e of part) {
        const b = e.node.blob
        if (!b || !e.node.device && !e.node.parents.length || e.node.size > BLOB_MAX) continue
        const to = path.join(dir, "blobs", b)
        if (fs.existsSync(to)) continue
        const from = store.blobFile(b)
        if (!from) continue
        try { fs.copyFileSync(from, `${to}.tmp`, fs.constants.COPYFILE_FICLONE); fs.renameSync(`${to}.tmp`, to) } catch {}
      }
      const name = segName(part[0].seq, part[part.length - 1].seq)
      fs.writeFileSync(path.join(dir, `${name}.tmp`), part.map((e) => JSON.stringify(e)).join("\n") + "\n")
      fs.renameSync(path.join(dir, `${name}.tmp`), path.join(dir, name))
      this.written += part.length; n += part.length
    }
    const v = JSON.stringify(r.vector())
    if (v !== this.acked && !r.missingBlobs().length) { fs.writeFileSync(path.join(dir, "ack.json.tmp"), JSON.stringify({ vector: r.vector(), at: Date.now() })); fs.renameSync(path.join(dir, "ack.json.tmp"), path.join(dir, "ack.json")); this.acked = v }
    return n
  }

  acks(): Record<string, Vector> {
    const out: Record<string, Vector> = {}
    for (const d of this.devices()) {
      try { out[d] = JSON.parse(fs.readFileSync(path.join(this.root, encodeURIComponent(d), "ack.json"), "utf8")).vector ?? {} } catch { /* none yet, or iCloud hasn't brought it */ }
    }
    return out
  }
  devices(): string[] {
    try { return fs.readdirSync(this.root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => decodeURIComponent(d.name)) } catch { return [] }
  }

  take(r: Replica, store: DiskStore): number {
    let got = 0
    for (const d of this.devices()) {
      if (d === this.device) continue
      const dir = path.join(this.root, encodeURIComponent(d))
      let names: string[]
      try { names = fs.readdirSync(dir).filter((n) => SEG.test(n)).sort() } catch { continue }
      for (const name of names) {
        const [, , to] = SEG.exec(name)!.map(Number)
        if (to <= (this.read[d] ?? 0)) continue
        let text: string
        try { text = fs.readFileSync(path.join(dir, name), "utf8") } catch { break }
        const es: unknown[] = []
        for (const line of text.split("\n")) { if (!line.trim()) continue; try { es.push(JSON.parse(line)) } catch {} }
        got += r.receive(Entries.parse(es))
        this.read[d] = Math.max(this.read[d] ?? 0, to)
      }
    }
    for (const h of r.missingBlobs()) {
      for (const d of this.devices()) {
        const p = path.join(this.root, encodeURIComponent(d), "blobs", h)
        try { if (fs.existsSync(p)) { store.putBlob(h, new Uint8Array(fs.readFileSync(p))); break } } catch {}
      }
    }
    return got
  }

  clean(): number {
    const acks = this.acks(), others = Object.keys(acks).filter((d) => d !== this.device)
    if (!others.length) return 0
    const upto = Math.min(...others.map((d) => acks[d][this.device] ?? 0))
    const dir = this.own()
    let names: string[]
    try { names = fs.readdirSync(dir).filter((n) => SEG.test(n)).sort() } catch { return 0 }
    let removed = 0
    const keepBlobs = new Set<string>()
    for (const name of names) {
      const to = Number(SEG.exec(name)![2])
      if (to <= upto) { fs.rmSync(path.join(dir, name), { force: true }); removed++; continue }
      for (const line of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) { try { const b = JSON.parse(line).node?.blob; if (b) keepBlobs.add(b) } catch {} }
    }
    if (removed) for (const b of fs.readdirSync(path.join(dir, "blobs"))) if (!keepBlobs.has(b)) fs.rmSync(path.join(dir, "blobs", b), { force: true })
    return removed
  }
}
