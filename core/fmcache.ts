import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { LOCAL } from "./plugins.ts"
import { writeAtomic } from "./vault.ts"
import { readBefore } from "./yaml.ts"
import { logger } from "./log.ts"

const log = logger("fmcache")

const fileFor = (vault: string, what: string) => path.join(LOCAL, "cache", `${what}-${crypto.createHash("sha1").update(path.resolve(vault)).digest("hex").slice(0, 12)}.json`)

export type KeptText = [ns: string, size: number, text: string, tags?: string[]]
export type StartTexts = { had: Map<string, KeptText>; now: Map<string, KeptText> }
const KEEP_MAX = 1 << 20

export function keepReads(vault: string): { texts: StartTexts; read: Promise<void>; done: (tagsOf: (rel: string) => string[] | undefined) => void } {
  const texts: StartTexts = { had: new Map(), now: new Map() }
  const file = fileFor(vault, "frontmatter")
  try { for (const [text, json] of JSON.parse(fs.readFileSync(file, "utf8")) as [string, string][]) readBefore.json.set(text, json) } catch { /* none yet */ }
  readBefore.on = true
  const read = readTexts(textsFile(vault)).then((had) => { texts.had = had })
  return { texts, read, done: (tagsOf) => { keepTexts(vault, texts, tagsOf); keepHeaders(file) } }
}

const textsFile = (vault: string) => fileFor(vault, "texts").replace(/\.json$/, ".bin")
const TextsIndex = z.array(z.tuple([z.string(), z.string(), z.number(), z.number(), z.array(z.string()).optional()]))

async function readTexts(file: string) {
  const had = new Map<string, KeptText>()
  try {
    const all = await fs.promises.readFile(file), start = 4 + all.readUInt32LE(0)
    let at = start
    for (const [rel, ns, size, bytes, tags] of TextsIndex.parse(JSON.parse(all.toString("utf8", 4, start)))) had.set(rel, [ns, size, all.toString("utf8", at, at += bytes), tags])
    if (at !== all.length) had.clear()
  } catch { /* none yet */ }
  return had
}

function keepTexts(vault: string, { had, now }: StartTexts, tagsOf: (rel: string) => string[] | undefined) {
  const out = [...now].filter(([, k]) => k[2].length <= KEEP_MAX)
  if (out.length === had.size && out.every(([rel, k]) => had.get(rel)?.[0] === k[0] && had.get(rel)?.[1] === k[1] && had.get(rel)?.[3])) return
  setTimeout(() => writeTexts(vault, out.map(([rel, k]) => [rel, [k[0], k[1], k[2], tagsOf(rel)]])), 2000).unref()
}

function writeTexts(vault: string, out: [string, KeptText][]) {
  const texts = out.map(([, k]) => Buffer.from(k[2])), index = Buffer.from(JSON.stringify(out.map(([rel, k], i) => [rel, k[0], k[1], texts[i].length, k[3]])))
  const length = Buffer.alloc(4)
  length.writeUInt32LE(index.length)
  try {
    writeAtomic(textsFile(vault), Buffer.concat([length, index, ...texts]))
    fs.rmSync(fileFor(vault, "texts"), { force: true })
  } catch (e) { log.error("keeping the start's reads failed", e) }
}

function keepHeaders(file: string) {
  const { json, used, added } = readBefore
  const out = added || used.size !== json.size ? [...json].filter(([text]) => used.has(text)) : null
  Object.assign(readBefore, { on: false, json: new Map(), used: new Set(), added: 0 })
  if (out) write(file, out)
}

function write(file: string, value: unknown) {
  try { writeAtomic(file, JSON.stringify(value)) } catch (e) { log.error("keeping the start's reads failed", e) }
}
