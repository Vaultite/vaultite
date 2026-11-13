const MASK = "•••"
export const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const patterns = new Map<string, RegExp>()
function pattern(s: string) {
  let re = patterns.get(s)
  if (re) return re
  const hex = (b: number) => `%${b.toString(16).padStart(2, "0").toUpperCase().replace(/[A-F]/g, (x) => `[${x}${x.toLowerCase()}]`)}`
  re = new RegExp([...s].map((c) => `(?:${literal(c)}|${[...new TextEncoder().encode(c)].map(hex).join("")}${c === " " ? "|\\+" : ""})`).join(""), "g")
  if (patterns.size > 100) patterns.clear()
  patterns.set(s, re)
  return re
}
export function mask(text: string, secrets: Iterable<string>): string {
  let out = text
  for (const s of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) out = out.replace(pattern(s), MASK)
  return out
}
