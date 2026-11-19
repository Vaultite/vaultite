import os from "node:os"
import { Worker } from "node:worker_threads"
import type { Listed } from "./listing.ts"
import type { Item } from "./vault.ts"

export type ReadFile = [rel: string, text: string, fm: Item, start: number, end: number, line: number, tags: string[]]
export type FromReader = { listed: Listed } | { files: ReadFile[] }
export type Reading = { listing(): Promise<Listed | null>; read(rels: string[]): Promise<Map<string, ReadFile>> }
export type ReadAhead = (root: string) => Reading

const WORTH_IT = 500, GIVE_UP = 5000, UNASKED = 30_000
const threads = () => Math.max(1, Math.min(3, os.availableParallelism() - 1))

export const readAhead: ReadAhead = (root) => {
  const workers = Array.from({ length: threads() }, (_, i) => new Worker(new URL("./readworker.ts", import.meta.url), { argv: [root, i === 0 ? "lists" : ""] }))
  const stop = () => { for (const w of workers) void w.terminate() }
  const unasked = setTimeout(stop, UNASKED)
  unasked.unref()
  for (const w of workers) { w.unref(); w.on("error", () => {}) }
  let listed: Promise<Listed | null> | null = new Promise((done) => {
    workers[0].once("message", (m: FromReader) => done("listed" in m ? m.listed : null))
    workers[0].once("exit", () => done(null))
  })
  let asked = false
  const read = (rels: string[]) => new Promise<Map<string, ReadFile>>((done) => {
    const got = new Map<string, ReadFile>(), size = Math.ceil(rels.length / workers.length)
    let left = workers.length
    const finish = () => { clearTimeout(timer); stop(); done(got) }
    const timer = setTimeout(finish, GIVE_UP)
    workers.forEach((w, i) => {
      w.on("message", (m: FromReader) => { if ("files" in m) for (const f of m.files) got.set(f[0], f) })
      w.on("exit", () => { if (--left === 0) finish() })
      w.postMessage(rels.slice(i * size, (i + 1) * size).join("\0"))
    })
  })
  return {
    listing() { const l = listed ?? Promise.resolve(null); listed = null; return l },
    read(rels) {
      const first = !asked
      asked = true
      clearTimeout(unasked)
      if (first && rels.length >= WORTH_IT) return read(rels)
      if (first) stop()
      return Promise.resolve(new Map())
    },
  }
}
