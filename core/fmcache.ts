// A start's reads kept on this machine for the next: the files' texts by mtime and size (a file unchanged since isn't
// read again), and the YAML library's reads of headers that aren't plain key: value lines. Only what's still there stays.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { LOCAL } from "./plugins.ts"
import { readBefore } from "./yaml.ts"

const fileFor = (vault: string, what: string) => path.join(LOCAL, "cache", `${what}-${crypto.createHash("sha1").update(path.resolve(vault)).digest("hex").slice(0, 12)}.json`)

/** A file's text as a start read it: its mtime (ns) and size then, and the text. */
export type KeptText = [ns: string, size: number, text: string]
/** What a vault's first walk takes texts from (`had`) and puts the ones it read in (`now`): Vault.startTexts. */
export type StartTexts = { had: Map<string, KeptText>; now: Map<string, KeptText> }
const KEEP_MAX = 1 << 20 // (a bigger file is read again: it would make the cache slow to load)

/** Load what was kept for this vault for the start's read of it; done() ends that, keeping what was read (the vault's
 *  texts and headers now) and letting go of the rest. */
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
  // (a moment later: the first answers go out before megabytes of JSON are made)
  setTimeout(() => write(fileFor(vault, "texts"), out), 2000).unref()
}

function keepHeaders(file: string) {
  const { json, used, added } = readBefore
  const out = added || used.size !== json.size ? [...json].filter(([text]) => used.has(text)) : null
  Object.assign(readBefore, { on: false, json: new Map(), used: new Set(), added: 0 })
  if (out) write(file, out)
}

function write(file: string, value: unknown) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value))
    fs.renameSync(`${file}.tmp`, file)
  } catch (e) { console.error("keeping the start's reads:", e) }
}
