import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { LOCAL } from "./plugins.ts"
import { writeAtomic } from "./vault.ts"
import { readBefore } from "./yaml.ts"
import { logger } from "./log.ts"

const log = logger("fmcache")

const fileFor = (vault: string, what: string) => path.join(LOCAL, "cache", `${what}-${crypto.createHash("sha1").update(path.resolve(vault)).digest("hex").slice(0, 12)}.json`)

export type KeptText = [ns: string, size: number, text: string]
export type StartTexts = { had: Map<string, KeptText>; now: Map<string, KeptText> }
const KEEP_MAX = 1 << 20

export function keepReads(vault: string): { texts: StartTexts; done: () => void } {
  const texts: StartTexts = { had: new Map(), now: new Map() }
  try { texts.had = new Map(JSON.parse(fs.readFileSync(fileFor(vault, "texts"), "utf8")) as [string, KeptText][]) } catch { /* none yet */ }
  const file = fileFor(vault, "frontmatter")
  try { for (const [text, json] of JSON.parse(fs.readFileSync(file, "utf8")) as [string, string][]) readBefore.json.set(text, json) } catch { /* none yet */ }
  readBefore.on = true
  return { texts, done: () => { keepTexts(vault, texts); keepHeaders(file) } }
}

function keepTexts(vault: string, { had, now }: StartTexts) {
  const out = [...now].filter(([, k]) => k[2].length <= KEEP_MAX)
  if (out.length === had.size && out.every(([rel, k]) => had.get(rel)?.[0] === k[0] && had.get(rel)?.[1] === k[1])) return
  setTimeout(() => write(fileFor(vault, "texts"), out), 2000).unref()
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
