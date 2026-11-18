import { parentPort } from "node:worker_threads"
import { pictureOf, type Pictured, type PictureJob } from "./kitty.ts"

parentPort!.on("message", (m: { n: number; job: PictureJob }) => {
  let done: Pictured
  try { done = pictureOf(m.job) } catch (e) { done = { out: m.job.raw, said: e instanceof Error ? e.message : String(e) } }
  parentPort!.postMessage({ n: m.n, ...done })
})
