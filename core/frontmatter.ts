// A file's text and its frontmatter header: parsed, written and edited line by line, without touching the disk.
import { patchFrontmatter, renameKey } from "./textedit.ts"
import { dates, dump, load, YAMLError } from "./yaml.ts"
import { fmTags, renameTagsIn, scan, tagName, viewsIn, withoutBlocks } from "./sections.ts"
import type { Item } from "./vault.ts"

export function frontmatter(data: Item, body = "") {
  const fm = dump(dates(data) as Item).trim()
  const b = (body ?? "").trim()
  return b ? `---\n${fm}\n---\n\n${b}\n` : `---\n${fm}\n---\n`
}

export const FM = /^---\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/

/** Frontmatter text -> a record. Throws when it doesn't parse or isn't key: value lines. */
export function loadFm(raw: string): Item {
  const fm = load(raw) ?? {}
  if (typeof fm !== "object" || Array.isArray(fm)) throw new YAMLError("frontmatter is not a set of key: value lines")
  return fm as Item
}

const HEAD = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/
/** [frontmatter, body]. Throws on a broken header. */
export function parseText(text: string): [Item, string] {
  const m = HEAD.exec(text)
  if (!m) return [{}, text.trim()]
  return [loadFm(m[1]), m[2].trim()]
}

/** The line (0-based) of `text` that parseText's body starts on: a body's line n is the file's line n + this. */
export function bodyLine(text: string): number {
  const m = HEAD.exec(text)
  const rest = m ? m[2] : text
  const at = text.length - rest.length + (rest.length - rest.trimStart().length)
  let n = 0
  for (let i = text.indexOf("\n"); i >= 0 && i < at; i = text.indexOf("\n", i + 1)) n++
  return n
}

/** A file's text with its frontmatter key `from` renamed `to`, nothing else changed (core/textedit.ts renameKey); null
 *  when it has no such key, already has `to`, or its header can't be changed line by line. */
export function renameProperty(text: string, from: string, to: string): string | null {
  const m = FM.exec(text)
  if (!m) return null
  const inner = renameKey(m[1] ?? "", from, to, loadFm)
  // (what follows the closing --- stays as it was, its line break included)
  return inner === null ? null : `---\n${inner}\n---${text.slice(m[0].length - (m[0].endsWith("\n") ? 1 : 0))}`
}

/** A file's text with one frontmatter key set to `value` (undefined: removed), only that key's lines rewritten; null
 *  when the header can't be patched line by line (it's left alone then). A file without a header gets one. */
export function setPropertyText(text: string, key: string, value: unknown): string | null {
  const m = FM.exec(text)
  const raw = m ? m[1] ?? "" : ""
  let old: Item
  try { old = m ? loadFm(raw) : {} } catch { return null }
  const inner = patchFrontmatter(raw, old, value === undefined ? {} : { [key]: dates(value) }, value === undefined ? [key] : [], [],
    (k, v) => dump({ [k]: v }), loadFm)
  if (inner === null) return null
  const rest = m ? text.slice(m[0].length) : text
  if (!inner.trim()) return rest.replace(/^\n/, "")
  return `---\n${inner}\n---\n${m ? rest : rest ? `\n${rest}` : ""}`
}

/** A file's text with tag `from`, and those nested under it, renamed `to`: in its frontmatter `tags` (a list or text, as
 *  it was written; a tag twice once) and its #tags. null when its header can't be patched line by line. */
export function renameTagText(text: string, from: string, to: string): string | null {
  const f = tagName(from).toLowerCase(), t = tagName(to)
  const hit = (x: string) => x.toLowerCase() === f || x.toLowerCase().startsWith(`${f}/`)
  let out = text
  const m = FM.exec(text)
  if (m) {
    let fm: Item
    try { fm = loadFm(m[1] ?? "") } catch { return null }
    for (const key of ["tags", "tag"]) {
      const list = fm[key] == null ? [] : fmTags(fm[key])
      if (!list.some(hit)) continue
      const seen = new Set<string>(), renamed: string[] = []
      for (const x of list.map((x) => (hit(x) ? t + x.slice(f.length) : x))) if (!seen.has(x.toLowerCase())) { seen.add(x.toLowerCase()); renamed.push(x) }
      const next = setPropertyText(out, key, Array.isArray(fm[key]) ? renamed : renamed.join(", "))
      if (next === null) return null
      out = next
    }
  }
  const head = FM.exec(out)?.[0] ?? ""
  return head + renameTagsIn(out.slice(head.length), from, to)
}

export const stripNl = (s: string) => s.replace(/^\n+|\n+$/g, "")

/** The body without its blocks and ```base fences: what a kind parses. */
export function prose(body: string) {
  return withoutBlocks(body ?? "")
}

/** `neu` (a body written whole) with the views `old` placed (blocks, ```base fences): those above all of its text on top,
 *  the rest at the end. */
export function keepBlocks(old: string, neu: string) {
  const top: string[] = [], end: string[] = []
  const s = scan(old ?? "")
  for (const b of viewsIn(old ?? "", s)) (prose(s.lines.slice(0, b.open).join("\n")).trim() ? end : top).push(s.lines.slice(b.open, b.close + 1).join("\n"))
  if (!top.length && !end.length) return neu
  return [top.join("\n\n"), stripNl(neu ?? ""), end.join("\n\n")].filter(Boolean).join("\n\n")
}
