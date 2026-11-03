// Dictated words as text, for the app's page and the desktop app's helper alike (no Node, no DOM).

/** `text` said after `before` (what precedes where it goes): a space between words, none before punctuation or at a
 *  line's start. */
export function joinText(before: string, text: string) {
  const t = text.replace(/^\s+/, "")
  if (!t) return ""
  const last = before.slice(-1)
  return last && !/[\s([{"'“‘/-]/u.test(last) && !/^[.,!?;:…)\]}"'”’]/u.test(t) ? ` ${t}` : t
}

/** A replacements line, "said: written" (the last ": " splits it), or null. */
export function parseReplacement(line: string): [string, string] | null {
  const i = line.lastIndexOf(": ")
  const from = i > 0 ? line.slice(0, i).trim() : "", to = i > 0 ? line.slice(i + 2).trim() : ""
  return from && to ? [from, to] : null
}
/** The replacements as patterns: the said words whole, in any case, however they're spaced. */
export function replacer(lines: string[]): [RegExp, string][] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return lines.map(parseReplacement).filter((x) => !!x).map(([from, to]) =>
    [new RegExp(`(?<![\\p{L}\\p{N}@])${from.split(/\s+/).map(esc).join("\\s+")}(?![\\p{L}\\p{N}])`, "giu"), to.replace(/\$/g, "$$$$")])
}
