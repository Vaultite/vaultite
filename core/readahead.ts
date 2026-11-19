import os from "node:os"
import { Worker } from "node:worker_threads"
import type { Item } from "./vault.ts"

export type ReadFile = [rel: string, text: string, fm: Item, start: number, end: number, line: number, tags: string[]]
export type ReadAhead = (root: string, rels: string[]) => Promise<Map<string, ReadFile>>

const WORTH_IT = 500, GIVE_UP = 5000
const threads = () => Math.max(1, Math.min(4, os.availableParallelism() - 1))

export const readAhead: ReadAhead = (root, rels) => new Promise((done) => {
  const got = new Map<string, ReadFile>()
  if (rels.length < WORTH_IT) return done(got)
  const n = threads(), size = Math.ceil(rels.length / n)
  let left = n
  const finish = () => { clearTimeout(timer); for (const w of workers) void w.terminate(); done(got) }
  const timer = setTimeout(finish, GIVE_UP)
  const workers = Array.from({ length: n }, (_, i) => {
    const w = new Worker(new URL("./readworker.ts", import.meta.url), { workerData: { root, rels: rels.slice(i * size, (i + 1) * size) } })
    w.on("message", (files: ReadFile[]) => { for (const f of files) got.set(f[0], f) })
    w.on("error", () => {})
    w.on("exit", () => { if (--left === 0) finish() })
    return w
  })
})
