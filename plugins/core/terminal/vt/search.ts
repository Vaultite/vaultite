import type { Match, Screen } from "./screen.ts"

export type FindSpec = { text: string; caseSensitive: boolean; wholeWord: boolean; regexp: boolean }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function findAll(s: Screen, spec: FindSpec, max: number): Match[] {
  if (!spec.text) { s.searchFor(null); return [] }
  // (Ghostty's: plain text, any case; pure ASCII, since its case folding is ASCII's)
  if (!spec.regexp && !spec.caseSensitive && !spec.wholeWord && /^[\x20-\x7e]+$/.test(spec.text)) {
    s.searchFor(spec.text)
    return order(s.searchMatches(max))
  }
  s.searchFor(null)
  let re: RegExp
  try { re = new RegExp(spec.regexp ? spec.text : escape(spec.text), spec.caseSensitive ? "g" : "gi") } catch { return [] }
  if (spec.wholeWord) re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${re.source})(?![\\p{L}\\p{N}_])`, re.flags + "u")
  const rows = s.textFrom(0, false).split("\n"), out: Match[] = []
  for (let y = 0; y < rows.length && out.length < max; y++) {
    if (!rows[y]) continue
    re.lastIndex = 0
    let line: ReturnType<Screen["line"]> | undefined
    for (const m of rows[y].matchAll(re)) {
      if (!m[0]) continue
      line ??= s.line(y)
      if (!line) break
      // (the formatter's text and the row's agree but for its trailing blanks: map through the row's own)
      const a = line.at[m.index] ?? m.index, b = line.at[m.index + m[0].length - 1] ?? m.index + m[0].length - 1
      out.push({ start: { x: a, y }, end: { x: b, y } })
      if (out.length >= max) break
    }
  }
  return out
}

const order = (ms: Match[]) => ms.sort((a, b) => a.start.y - b.start.y || a.start.x - b.start.x)
