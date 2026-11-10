// Fuzzy matching for every list that filters as one types (palette, quick switcher, pickers, slash menu), words in any
// order as in fzf; ranked by tier (TIER: whole word or its stem, word start, inside, letters), order and length ties.

/** `tier`: how well its weakest word met the name (TIER); lists that rank by something else too (the palette:
 *  commands before settings) compare it first. */
export type Match = { score: number; marks: number[]; tier: number }

/** Every word typed met the name as LETTERS < INSIDE < START < WORD; NAME is a name that is all whole words typed. */
export const TIER = { LETTERS: 0, INSIDE: 1, START: 2, WORD: 3, NAME: 4 } as const
/** A tier is worth more than any sum of word scores under it (each under 400, a query of a few words). */
const TIER_WORTH = 10000

const SEPARATORS = new Set(" \t\n-_/:.,(")
const boundary = (s: string, i: number) => i === 0 || SEPARATORS.has(s[i - 1]) || (s[i - 1] >= "a" && s[i - 1] <= "z" && s[i] >= "A" && s[i] <= "Z")

/** Bonuses for a query of several words: all of them in the order typed, and all of them together as typed. */
const IN_ORDER = 15, PHRASE = 40

/** A word without its plural or verb ending, the way people type either: files → file, matches → match, opening and
 *  opened → open, settings → set. Light on purpose (no dictionary): short words are left as they are. */
export function stem(w: string): string {
  let s = w
  if (s.length > 3) {
    if (s.endsWith("ies")) s = s.slice(0, -3) + "y"
    else if (/(s|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2)
    else if (s.endsWith("s") && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1)
  }
  const verb = /^(.{4,}?)(ing|ed)$/.exec(s)
  if (verb) s = /([^aeiouls])\1$/.test(verb[1]) ? verb[1].slice(0, -1) : verb[1]
  return s
}

type At = { at: number; w: string }
/** The words of `s`: where each starts and its lowercase text (camelCase splits as separators do). */
function wordsIn(s: string, ls: string): At[] {
  const out: At[] = []
  for (let i = 0; i < s.length; i++) {
    if (SEPARATORS.has(s[i]) || !boundary(s, i)) continue
    let j = i + 1
    while (j < s.length && !SEPARATORS.has(s[j]) && !boundary(s, j)) j++
    out.push({ at: i, w: ls.slice(i, j) })
  }
  return out
}

type Word = { tier: number; score: number; marks: number[]; whole?: number }
const run = (at: number, n: number) => Array.from({ length: n }, (_, k) => at + k)
const common = (a: string, b: string) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n }

/** One typed word (lowercase) in `s` at its best tier; `score` under 400 orders within it. `whole`: which of the
 *  name's words it is, when it is one. */
function word(w: string, ws: At[], ls: string, s: string): Word | null {
  const sw = stem(w)
  let best: Word | null = null
  const take = (m: Word) => { if (!best || m.tier > best.tier || (m.tier === best.tier && m.score > best.score)) best = m }
  ws.forEach((x, k) => {
    // (the first word a hair ahead, worth under two letters of length)
    const lead = x.at === 0 ? 0.15 : 0
    if (x.w === w) take({ tier: TIER.WORD, score: 390 + lead, marks: run(x.at, w.length), whole: k })
    else if (stem(x.w) === sw) take({ tier: TIER.WORD, score: 380 + lead, marks: run(x.at, Math.max(common(x.w, w), 1)), whole: k })
    else if (x.w.startsWith(w)) take({ tier: TIER.START, score: 250 + 40 * w.length / x.w.length + lead, marks: run(x.at, w.length) })
    else if (sw.length >= 3 && x.w.startsWith(sw)) take({ tier: TIER.START, score: 230 + 40 * sw.length / x.w.length + lead, marks: run(x.at, sw.length) })
  })
  if (best) return best
  const at = ls.indexOf(w)
  if (at >= 0) return { tier: TIER.INSIDE, score: 150 + Math.min(w.length * 4, 40), marks: run(at, w.length) }
  // Its letters in order, fzf-style: word starts and runs score higher, gaps lower.
  const marks: number[] = []
  let score = 0, streak = 0, i = 0
  for (const c of w) {
    const j = ls.indexOf(c, i)
    if (j < 0) return null
    streak = marks.length && j === marks[marks.length - 1] + 1 ? streak + 1 : 0
    score += 1 + streak * 3 + (boundary(s, j) ? 8 : 0) - Math.min(j - i, 10) * 0.3
    marks.push(j)
    i = j + 1
  }
  return { tier: TIER.LETTERS, score: Math.max(0, Math.min(99, 50 + score)), marks }
}

// A list asks once per candidate with the same query: split it once.
let lastQ = "", lastWords: string[] = []
const wordsOf = (q: string) => q === lastQ ? lastWords : (lastQ = q, lastWords = q.toLowerCase().split(/\s+/).filter(Boolean))

/** Every word of `q` somewhere in `s`, in any order. Returns the score, its tier and the matched positions (for
 *  highlighting), or null. Comparable only between candidates for the same query. */
export function fuzzy(q: string, s: string): Match | null {
  const words = wordsOf(q)
  if (!words.length) return { score: 0, marks: [], tier: TIER.NAME }
  const ls = s.toLowerCase(), ws = wordsIn(s, ls)
  let sum = 0, tier: number = TIER.WORD, inOrder = true, last = -1
  const marks = new Set<number>(), whole = new Set<number>()
  for (const w of words) {
    const m = word(w, ws, ls, s)
    if (!m) return null
    sum += m.score
    tier = Math.min(tier, m.tier)
    if (m.whole !== undefined) whole.add(m.whole)
    if (m.marks[0] <= last) inOrder = false
    last = m.marks[0]
    for (const i of m.marks) marks.add(i)
  }
  if (tier === TIER.WORD && whole.size === ws.length) tier = TIER.NAME
  const phrase = words.length > 1 ? ls.indexOf(words.join(" ")) : -1
  const score = tier * TIER_WORTH + sum + (words.length > 1 && inOrder ? IN_ORDER : 0) + (phrase >= 0 ? PHRASE : 0) - s.length * 0.1
  if (phrase >= 0) return { score, tier, marks: run(phrase, words.join(" ").length) }
  return { score, tier, marks: [...marks].sort((a, b) => a - b) }
}

/** Every word of `q` is in `s` as typed or by a stem of 4 letters or more (files: file), in any order (a plain
 *  filter, without fuzzy's loose letters). */
export const hasWords = (q: string, s: string) => {
  const ls = s.toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => { const st = stem(w); return ls.includes(w) || (st.length >= 4 && ls.includes(st)) })
}

/** Every word of `q` is one of `s`'s words or starts one, by its stem too ("files" finds "file tree"): the other words
 *  a thing is found by (a command's, a slash item's keywords). */
export const startsWords = (q: string, s: string) => {
  const ws = s.toLowerCase().split(/[\s\-_/]+/).filter(Boolean)
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => {
    const st = stem(t)
    return ws.some((w) => w.startsWith(t) || stem(w) === st || (st.length >= 3 && w.startsWith(st)))
  })
}
