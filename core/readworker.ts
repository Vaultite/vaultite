import fs from "node:fs"
import path from "node:path"
import { parentPort } from "node:worker_threads"
import { listVault, placeholderStat, statsNow } from "./listing.ts"
import type { FromReader, ReadFile } from "./readahead.ts"

const SEND_EVERY = 500, LANES = 16
const [root = "", lists] = process.argv.slice(2)
const parsers = Promise.all([import("./frontmatter.ts"), import("./sections.ts")])
const send = (m: FromReader) => parentPort?.postMessage(m)

function parsed(rel: string, bytes: Buffer, [{ bodyLine, parseText, textOf }, { tagsOf }]: Awaited<typeof parsers>): ReadFile | null {
  try {
    const text = textOf(bytes), [fm, body] = parseText(text), end = text.trimEnd().length
    return [rel, text, fm, end - body.length, end, bodyLine(text), tagsOf(fm, body)]
  } catch { return null }
}

async function readAll(rels: string[]) {
  let next = 0, out: ReadFile[] = []
  const lane = async () => {
    for (let i = next++; i < rels.length; i = next++) {
      const bytes = await fs.promises.readFile(path.join(root, rels[i])).catch(() => null)
      const f = bytes && parsed(rels[i], bytes, await parsers)
      if (f) out.push(f)
      if (out.length >= SEND_EVERY) { send({ files: out }); out = [] }
    }
  }
  await Promise.all(Array.from({ length: LANES }, lane))
  send({ files: out })
}

parentPort?.once("message", (rels: string) => void readAll(rels.split("\0").filter(Boolean)))
if (lists === "lists") send({ listed: await listVault(root, (_abs, st) => process.platform === "darwin" && placeholderStat(st), statsNow) })
