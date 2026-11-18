import { Worker } from "node:worker_threads"
import type { Pictured, PictureJob } from "./kitty.ts"

type Done = Pictured & { n: number }
let worker: Worker | null = null, sent = 0
const waiting = new Map<number, { raw: string; ok: (out: string) => void; log: (...a: unknown[]) => void }>()

function start() {
  const w = new Worker(new URL("./pictureworker.ts", import.meta.url))
  w.on("message", (m: Done) => {
    const x = waiting.get(m.n)
    if (!x) return
    waiting.delete(m.n)
    if (m.said) x.log("kitty", m.said)
    x.ok(m.out)
  })
  const lost = (why: string) => {
    if (worker !== w) return
    worker = null
    for (const x of waiting.values()) { x.log("kitty", `pictures' thread ${why}: sent on as they came`); x.ok(x.raw) }
    waiting.clear()
  }
  w.on("error", (e) => lost(`failed (${e.message})`))
  w.on("exit", (code) => lost(`ended (${code})`))
  w.unref()
  return w
}

export function decodeElsewhere(log: (...a: unknown[]) => void) {
  return (job: PictureJob) => new Promise<string>((ok) => {
    const n = ++sent
    waiting.set(n, { raw: job.raw, ok, log })
    ;(worker ??= start()).postMessage({ n, job })
  })
}
