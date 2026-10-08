// Unlinked mentions: a file's name (or an alias) written as plain text in another file, where a [[link]] could be. One
// place for the server (plugin.ts finds them and makes the link) and the tests. No Node here.

export type Mention = {
  /** The line it's on, exactly, and which of the file's lines with that same text it is (0: the first). */
  line: string; nth: number
  /** Where in the line, and what's written there ("alice park"). */
  col: number; len: number; text: string
}

const WORD = "[\\p{L}\\p{N}_]"
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Spans of a line that are already links or code (not plain text): [[links]], ![[embeds]], [text](url), <url>, bare
 *  URLs and `code`. */
function covered(line: string): [number, number][] {
  const out: [number, number][] = []
  for (const re of [/!?\[\[[^\]\n]*\]\]/g, /!?\[[^\]\n]*\]\([^)\n]*\)/g, /<[a-z]+:[^>\s]*>/gi, /\bhttps?:\/\/\S+/gi, /(`+)(?:(?!\1).)+?\1/g]) {
    for (const m of line.matchAll(re)) out.push([m.index!, m.index! + m[0].length])
  }
  return out
}

/** Every place in `body` (a file's text after its frontmatter) where one of `names` is written as plain text: a whole
 *  word or phrase, any case, not inside a link, code or a fenced block. Longer names first, never overlapping. */
export function findMentions(body: string, names: string[]): Mention[] {
  const wanted = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length)
  if (!wanted.length) return []
  const re = new RegExp(`(?<!${WORD})(?:${wanted.map(escape).join("|")})(?!${WORD})`, "giu")
  const out: Mention[] = []
  const seen = new Map<string, number>()
  let fence: string | null = null
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\r$/, "")
    const nth = seen.get(line) ?? 0
    seen.set(line, nth + 1)
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f && (fence === null || (f[1][0] === fence[0] && f[1].length >= fence.length))) { fence = fence ? null : f[1]; continue }
    if (fence) continue
    const skip = covered(line)
    for (const m of line.matchAll(re)) {
      const a = m.index!, b = a + m[0].length
      if (skip.some(([x, y]) => a < y && b > x)) continue
      out.push({ line, nth, col: a, len: m[0].length, text: m[0] })
    }
  }
  return out
}

/** `text` (a whole file) with the mention turned into `link` ("[[Alice Park]]"), or null when the file no longer has
 *  it there (it changed since). The frontmatter is never touched. */
export function linkMention(text: string, m: Pick<Mention, "line" | "nth" | "col" | "len" | "text">, link: string): string | null {
  const lines = text.split("\n")
  const fm = /^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*\r?(?:\n|$)/.exec(text)
  let i = fm ? fm[0].split("\n").length - (fm[0].endsWith("\n") ? 1 : 0) : 0
  for (let seen = 0; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, "") !== m.line) continue
    if (seen++ < m.nth) continue
    const line = lines[i]
    if (line.slice(m.col, m.col + m.len) !== m.text) return null
    lines[i] = line.slice(0, m.col) + link + line.slice(m.col + m.len)
    return lines.join("\n")
  }
  return null
}
