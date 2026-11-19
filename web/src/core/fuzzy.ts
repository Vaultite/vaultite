import { lowerFolded } from "../../../core/fold.ts"
export type Match = { score: number; marks: number[]; tier: number }

export const TIER = { LETTERS: 0, INSIDE: 1, START: 2, WORD: 3, NAME: 4 } as const
const TIER_WORTH = 10000

const SEPARATORS = new Set(" \t\n-_/:.,(")
const boundary = (s: string, i: number) => i === 0 || SEPARATORS.has(s[i - 1]) || (s[i - 1] >= "a" && s[i - 1] <= "z" && s[i] >= "A" && s[i] <= "Z")

const IN_ORDER = 15, PHRASE = 40

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

type At = { at: number; w: string; stem: string }
type Name = { ls: string; ws: At[] }
function nameOf(s: string): Name {
  const ls = lowerFolded(s), ws: At[] = []
  for (let i = 0; i < s.length; i++) {
    if (SEPARATORS.has(s[i]) || !boundary(s, i)) continue
    let j = i + 1
    while (j < s.length && !SEPARATORS.has(s[j]) && !boundary(s, j)) j++
    const w = ls.slice(i, j)
    ws.push({ at: i, w, stem: stem(w) })
  }
  return { ls, ws }
}
const KEEP_NAMES = 100_000, KEEP_UNDER = 256
const names = new Map<string, Name>()
function named(s: string): Name {
  if (s.length > KEEP_UNDER) return nameOf(s)
  let n = names.get(s)
  if (!n) {
    if (names.size >= KEEP_NAMES) names.clear()
    names.set(s, n = nameOf(s))
  }
  return n
}

type Word = { tier: number; score: number; marks: number[]; whole?: number }
const run = (at: number, n: number) => { const out: number[] = []; for (let k = 0; k < n; k++) out.push(at + k); return out }
const common = (a: string, b: string) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n }

type Typed = { w: string; sw: string; lead: string }
function word({ w, sw }: Typed, ws: At[], ls: string, s: string): Word | null {
  let best: Word | null = null
  const take = (m: Word) => { if (!best || m.tier > best.tier || (m.tier === best.tier && m.score > best.score)) best = m }
  ws.forEach((x, k) => {
    const lead = x.at === 0 ? 0.15 : 0
    if (x.w === w) take({ tier: TIER.WORD, score: 390 + lead, marks: run(x.at, w.length), whole: k })
    else if (x.stem === sw) take({ tier: TIER.WORD, score: 380 + lead, marks: run(x.at, Math.max(common(x.w, w), 1)), whole: k })
    else if (x.w.startsWith(w)) take({ tier: TIER.START, score: 250 + 40 * w.length / x.w.length + lead, marks: run(x.at, w.length) })
    else if (sw.length >= 3 && x.w.startsWith(sw)) take({ tier: TIER.START, score: 230 + 40 * sw.length / x.w.length + lead, marks: run(x.at, sw.length) })
  })
  if (best) return best
  const at = ls.indexOf(w)
  if (at >= 0) return { tier: TIER.INSIDE, score: 150 + Math.min(w.length * 4, 40), marks: run(at, w.length) }
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

let lastQ = "", lastWords: Typed[] = []
const wordsOf = (q: string) => q === lastQ ? lastWords : (lastQ = q, lastWords = lowerFolded(q).split(/\s+/).filter(Boolean).map((w) => { const sw = stem(w); return { w, sw, lead: sw.replace(/y$/, "") } }))

function inOrderIn(w: string, ls: string) {
  for (let i = 0, at = 0; i < w.length; i++, at++) { at = ls.indexOf(w[i], at); if (at < 0) return false }
  return true
}
const NONE: Name = { ls: "", ws: [] }
const mayIn = (words: Typed[], ls: string) => words.every((x) => inOrderIn(x.w, ls) || (x.lead !== x.w && ls.includes(x.lead)))
const namedIfMay = (words: Typed[], s: string) => (mayIn(words, lowerFolded(s)) ? named(s) : NONE)
export const mayFind = (q: string, lowered: string) => mayIn(wordsOf(q), lowered)
export const leadsOf = (q: string) => wordsOf(q).map((x) => x.lead)

export function fuzzy(q: string, s: string): Match | null {
  const words = wordsOf(q)
  if (!words.length) return { score: 0, marks: [], tier: TIER.NAME }
  const { ls, ws } = namedIfMay(words, s)
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
  const typed = words.length > 1 ? words.map((x) => x.w).join(" ") : "", phrase = typed ? ls.indexOf(typed) : -1
  const score = tier * TIER_WORTH + sum + (words.length > 1 && inOrder ? IN_ORDER : 0) + (phrase >= 0 ? PHRASE : 0) - s.length * 0.1
  if (phrase >= 0) return { score, tier, marks: run(phrase, typed.length) }
  return { score, tier, marks: [...marks].sort((a, b) => a - b) }
}

export const hasWords = (q: string, s: string) => {
  const ls = lowerFolded(s)
  return lowerFolded(q).split(/\s+/).filter(Boolean).every((w) => { const st = stem(w); return ls.includes(w) || (st.length >= 4 && ls.includes(st)) })
}

export const startsWords = (q: string, s: string) => {
  const ws = lowerFolded(s).split(/[\s\-_/]+/).filter(Boolean)
  return lowerFolded(q).split(/\s+/).filter(Boolean).every((t) => {
    const st = stem(t)
    return ws.some((w) => w.startsWith(t) || stem(w) === st || (st.length >= 3 && w.startsWith(st)))
  })
}
