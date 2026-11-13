import { parseReplacement } from "../../../core/dictationtext.ts"
import type { Entry } from "../../../core/desktop/dictationlearn.ts"

export type Dictionary = { words: string[]; replacements: [string, string][] }

const ITEM = /^(\s*[-*+]\s+)(?!\[[ xX]\])(.*\S)\s*$/
const entryOf = (text: string): Entry | null => {
  const t = text.trim()
  if (!t || t.length > 200) return null
  const r = parseReplacement(t)
  return r ? { word: r[1], said: r[0] } : { word: t }
}
const lineOf = (e: Entry) => `- ${e.said ? `${e.said}: ${e.word}` : e.word}`
const same = (a: Entry, b: Entry) => a.word.toLowerCase() === b.word.toLowerCase() && (a.said ?? "").toLowerCase() === (b.said ?? "").toLowerCase()

export function readEntries(body: string): Entry[] {
  return body.split("\n").flatMap((l) => { const m = ITEM.exec(l), e = m && entryOf(m[2]); return e ? [e] : [] })
}
export function readDictionary(body: string): Dictionary {
  const es = readEntries(body)
  return { words: es.filter((e) => !e.said).map((e) => e.word), replacements: es.filter((e) => e.said).map((e) => [e.said!, e.word]) }
}

export function addEntry(body: string, e: Entry): { body: string; did: boolean } {
  if (readEntries(body).some((x) => same(x, e))) return { body, did: false }
  const lines = body.split("\n")
  let last = -1
  lines.forEach((l, i) => { if (ITEM.test(l)) last = i })
  if (last < 0) return { body: `${body.replace(/\s*$/, "")}${body.trim() ? "\n\n" : ""}${lineOf(e)}\n`, did: true }
  lines.splice(last + 1, 0, lineOf(e))
  return { body: lines.join("\n"), did: true }
}

export function removeEntry(body: string, e: Entry): { body: string; did: boolean } {
  const lines = body.split("\n"), i = lines.findIndex((l) => { const m = ITEM.exec(l), x = m && entryOf(m[2]); return !!x && same(x, e) })
  if (i < 0) return { body, did: false }
  lines.splice(i, 1)
  return { body: lines.join("\n"), did: true }
}

export const hintOf = ([said, written]: [string, string]) => (/^[\p{L}\p{N}][\p{L}\p{N}' .-]*$/u.test(written) ? written : said)
