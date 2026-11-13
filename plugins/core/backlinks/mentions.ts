import { TAG } from "../../../core/sections.ts"

export type Mention = {
  line: string; nth: number
  col: number; len: number; text: string
}

const WORD = "[\\p{L}\\p{N}_]"
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function covered(line: string): [number, number][] {
  const out: [number, number][] = []
  for (const re of [/!?\[\[[^\]\n]*\]\]/g, /!?\[[^\]\n]*\]\([^)\n]*\)/g, /<[a-z]+:[^>\s]*>/gi, /\bhttps?:\/\/\S+/gi, /(`+)(?:(?!\1).)+?\1/g, TAG]) {
    for (const m of line.matchAll(re)) out.push([m.index!, m.index! + m[0].length])
  }
  return out
}

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
