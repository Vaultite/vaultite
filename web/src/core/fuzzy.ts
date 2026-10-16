// Fuzzy matching for every list that filters as one types (the palette, the quick switcher, pickers, the slash menu).
// Words match in any order, as in VS Code's quick open, fzf and Raycast; typed order and the whole phrase rank higher.

export type Match = { score: number; marks: number[] }

const SEPARATORS = new Set(" \t\n-_/:.,(")
const boundary = (s: string, i: number) => i === 0 || SEPARATORS.has(s[i - 1]) || (s[i - 1] >= "a" && s[i - 1] <= "z" && s[i] >= "A" && s[i] <= "Z")

/** Bonuses for a query of several words: all of them in the order typed, and all of them together as typed. */
const IN_ORDER = 15, PHRASE = 40

type Word = { score: number; marks: number[]; exact: boolean }

/** One word (lowercase, no spaces) in `s` (`ls` lowercased), fzf-style: a contiguous hit first, else its letters in
 *  order, word starts and runs scoring higher. The score leaves out the candidate's length. */
function word(w: string, ls: string, s: string): Word | null {
  let at = ls.indexOf(w)
  if (at >= 0) {
    // At a word start when there's one (people type the starts of words: "set" means settings, not reset).
    if (!boundary(s, at)) for (let k = ls.indexOf(w, at + 1); k >= 0; k = ls.indexOf(w, k + 1)) if (boundary(s, k)) { at = k; break }
    const marks = Array.from({ length: w.length }, (_, k) => at + k)
    return { score: 100 + w.length * 6 + (boundary(s, at) ? 30 : 0) + (at === 0 ? 20 : 0), marks, exact: true }
  }
  const marks: number[] = []
  let score = 0, run = 0, i = 0
  for (const c of w) {
    const j = ls.indexOf(c, i)
    if (j < 0) return null
    run = marks.length && j === marks[marks.length - 1] + 1 ? run + 1 : 0
    score += 1 + run * 3 + (boundary(s, j) ? 8 : 0) - Math.min(j - i, 10) * 0.3
    marks.push(j)
    i = j + 1
  }
  return { score, marks, exact: false }
}

// A list asks once per candidate with the same query: split it once.
let lastQ = "", lastWords: string[] = []
const wordsOf = (q: string) => q === lastQ ? lastWords : (lastQ = q, lastWords = q.toLowerCase().split(/\s+/).filter(Boolean))

/** Every word of `q` somewhere in `s`, in any order. Returns the score and matched positions (for highlighting), or
 *  null. Comparable only between candidates for the same query. */
export function fuzzy(q: string, s: string): Match | null {
  const words = wordsOf(q)
  if (!words.length) return { score: 0, marks: [] }
  const ls = s.toLowerCase()
  if (words.length === 1) {
    const m = word(words[0], ls, s)
    return m && { score: m.score - s.length * 0.1, marks: m.marks }
  }
  // Each word scored alone, the 100 a contiguous hit gets counted once: every word as typed beats any letters-only one.
  let score = 0, exact = true, inOrder = true, last = -1
  const marks = new Set<number>()
  for (const w of words) {
    const m = word(w, ls, s)
    if (!m) return null
    score += m.score - (m.exact ? 100 : 0)
    exact &&= m.exact
    if (m.marks[0] <= last) inOrder = false
    last = m.marks[0]
    for (const i of m.marks) marks.add(i)
  }
  const phrase = words.join(" "), at = exact ? ls.indexOf(phrase) : -1
  score += (exact ? 100 : 0) + (inOrder ? IN_ORDER : 0) + (at >= 0 ? PHRASE : 0) - s.length * 0.1
  if (at >= 0) return { score, marks: Array.from({ length: phrase.length }, (_, k) => at + k) }
  return { score, marks: [...marks].sort((a, b) => a - b) }
}

/** Every word of `q` is in `s` as typed, in any order (a plain filter, without fuzzy's loose letters). */
export const hasWords = (q: string, s: string) => {
  const ls = s.toLowerCase()
  return q.toLowerCase().split(/\s+/).every((w) => ls.includes(w))
}
