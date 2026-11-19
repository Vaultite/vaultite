import fs from "node:fs"
import path from "node:path"
import { parentPort, workerData } from "node:worker_threads"
import { z } from "zod"
import type { ReadFile } from "./readahead.ts"

const SEND_EVERY = 500, LANES = 16
const { root, rels } = z.object({ root: z.string(), rels: z.array(z.string()) }).parse(workerData)
const parsers = Promise.all([import("./frontmatter.ts"), import("./sections.ts")])

function parsed(rel: string, bytes: Buffer, [{ bodyLine, parseText, textOf }, { tagsOf }]: Awaited<typeof parsers>): ReadFile | null {
  try {
    const text = textOf(bytes), [fm, body] = parseText(text), end = text.trimEnd().length
    return [rel, text, fm, end - body.length, end, bodyLine(text), tagsOf(fm, body)]
  } catch { return null }
}

let next = 0, out: ReadFile[] = []
async function lane() {
  for (let i = next++; i < rels.length; i = next++) {
    const bytes = await fs.promises.readFile(path.join(root, rels[i])).catch(() => null)
    const f = bytes && parsed(rels[i], bytes, await parsers)
    if (f) out.push(f)
    if (out.length >= SEND_EVERY) { parentPort?.postMessage(out); out = [] }
  }
}
await Promise.all(Array.from({ length: LANES }, lane))
parentPort?.postMessage(out)
