// Dictation that learns: the user fixing a word they just dictated ("for saint" to "Vorssaint") teaches dictation it.
// Only a misheard word's fix counts: not rewording, nor grammar, nor a word any recognizer already knows.
import type { Entry } from "./words.ts"

const WORD = /[@#]?[\p{L}\p{N}](?:[\p{L}\p{N}'’_.+-]*[\p{L}\p{N}])?/gu
type Tok = { w: string; at: number }
const tokens = (s: string): Tok[] => [...s.matchAll(WORD)].map((m) => ({ w: m[0], at: m.index! }))
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")

function lev(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length]
}
const ratio = (x: string, y: string) => (x || y ? 1 - lev(x, y) / Math.max(x.length, y.length) : 1)
/** A word's consonants as they sound, roughly ("phoXiv" and "Fox" both fks): misheard names rarely share a spelling. */
const sound = (s: string) => norm(s).replace(/ph/g, "f").replace(/ck|[cq]/g, "k").replace(/x/g, "ks").replace(/z/g, "s").replace(/v/g, "f")
  .replace(/(?!^)[aeiouyhw]/g, "").replace(/(.)\1+/g, "$1")
/** How alike two words are, 0 to 1: as spelled, or as they sound. */
export const likeness = (a: string, b: string) => {
  const s = ratio(norm(a), norm(b)), x = sound(a), y = sound(b)
  return Math.max(s, Math.max(x.length, y.length) >= 2 ? ratio(x, y) : 0)
}

// (the words any recognizer knows: fixing one is grammar or a homophone, not a word to learn)
const COMMON = new Set(`a about above after again against all also am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into
is it its itself just me more most my myself no nor not now of off on once only or other our ours out over own same she should so some such than
that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom
why will with would you your yours yourself yes yeah okay ok hey hi hello like get got go going went gone come came make made take took know knew
think thought see saw look want need use used work way thing things one two three four five six seven eight nine ten first last new old good bad
great little big long right left write write wrote say said tell told ask asked try tried give gave find found put let lets keep kept call called
run ran show showed mean meant feel felt seem leave left turn start stop open close read set change move play help talk turn back still even
well much many really maybe here hear know no now new knew our hour are its it's your you're they're there their whose who's which witch whether
weather were where wear we're than then too to two four for fore by buy bye peace piece whole hole won one sun son see sea be bee its write right
rite wait weight week weak break brake meet meat plain plane sale sail tail tale fair fare flour flower allowed aloud accept except affect effect
lose loose quiet quite advice advise day days time times year years today tomorrow yesterday morning night people person man men woman women
file files note notes test tests code line lines page word words name names text app thing something anything nothing everything someone anyone
everyone always never sometimes often again already yet soon later before since ago just only also very quite rather sure pretty`.split(/\s+/))
const common = (w: string) => COMMON.has(w.toLowerCase().replace(/’/g, "'"))
/** A word a recognizer may not know: a name (capitalized past a sentence's start), with digits or symbols, or rare. */
const distinctive = (w: string, sentenceStart: boolean) =>
  /[\p{N}@#_.+]/u.test(w) || /\p{Lu}/u.test(sentenceStart ? w.slice(1) : w) || (!common(w) && norm(w).length >= 3)

/** The fixes `now` makes to the dictated `said`: each misheard run (up to 3 words) and what replaced it. A rewrite (most
 *  of it changed, or changed in many places) teaches nothing. */
export function corrections(said: string, now: string): Entry[] {
  const a = tokens(said), b = tokens(now)
  if (!a.length || !b.length) return []
  // (words compared as written, so a fix of only the case shows)
  const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i].w === b[j].w ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const hunks: { from: Tok[]; to: Tok[]; start: boolean }[] = []
  let i = 0, j = 0, cur: (typeof hunks)[number] | null = null
  const startAt = (k: number) => k === 0 || /[.!?]\s*$/.test(now.slice(0, b[k]?.at ?? now.length))
  while (i < n || j < m) {
    if (i < n && j < m && a[i].w === b[j].w) { cur = null; i++; j++; continue }
    cur ??= (hunks.push({ from: [], to: [], start: startAt(j) }), hunks[hunks.length - 1])
    if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) cur.to.push(b[j++])
    else cur.from.push(a[i++])
  }
  const changed = hunks.reduce((s, h) => s + h.from.length, 0)
  if (!hunks.length || hunks.length > 3 || (n > 2 && changed / n > 0.5)) return []
  return hunks.flatMap((h) => {
    if (!h.from.length || !h.to.length || h.from.length > 3 || h.to.length > 3) return []
    const from = h.from.map((t) => t.w).join(" "), to = h.to.map((t) => t.w).join(" ")
    const x = norm(from), y = norm(to)
    if (x === y) {
      // (only the case changed: a name written as one, not a sentence's capital)
      return /\p{Lu}/u.test(h.start ? to.slice(1) : to) && !common(to) ? [{ word: to }] : []
    }
    if (likeness(from, to) < 0.5) return []
    // (an ending changed on a word in lower case: grammar, "test" to "tests")
    if (to === to.toLowerCase() && from === from.toLowerCase() && (x.startsWith(y) || y.startsWith(x)) && Math.abs(x.length - y.length) <= 3) return []
    if (!h.to.some((t, k) => distinctive(t.w, h.start && k === 0))) return []
    return [{ word: to, said: from }]
  })
}

/** A line as typed after a paste in a terminal, followed key by key (`keydown`s), from the end of what was pasted. Keys
 *  it can't follow (up and down, a click, tab, a shortcut) lose it: `lost`. */
export class TypedLine {
  text: string
  at: number
  edited = false
  lost = false
  constructor(text: string) { this.text = text; this.at = text.length }
  private word(dir: -1 | 1) {
    let k = this.at
    if (dir < 0) { while (k > 0 && /\s/.test(this.text[k - 1])) k--; while (k > 0 && !/\s/.test(this.text[k - 1])) k-- }
    else { while (k < this.text.length && /\s/.test(this.text[k])) k++; while (k < this.text.length && !/\s/.test(this.text[k])) k++ }
    return k
  }
  private cut(from: number, to: number) { if (from < to) { this.text = this.text.slice(0, from) + this.text.slice(to); this.edited = true } this.at = from }
  /** One key; `false` when it ends the line (Enter). */
  key(e: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean }): boolean {
    if (this.lost) return true
    const { key } = e
    if (typeof key !== "string") { this.lost = true; return true }
    if (e.isComposing) { this.lost = true; return true }
    if (/^(Dead|Shift|Alt|Control|Meta|CapsLock)$/.test(key)) return true
    if (key === "Enter") return false
    if (key.length === 1 && !e.ctrlKey && !e.metaKey) {
      this.text = this.text.slice(0, this.at) + key + this.text.slice(this.at)
      this.at++
      this.edited = true
      return true
    }
    if (key === "Backspace") {
      // (past the start: into what was there before, which this never knew)
      if (this.at === 0) return !(this.lost = true)
      this.cut(e.metaKey ? 0 : e.altKey ? this.word(-1) : this.at - 1, this.at)
    } else if (key === "w" && e.ctrlKey && !e.metaKey) this.cut(this.word(-1), this.at)
    else if (key === "Delete") this.cut(this.at, Math.min(this.text.length, this.at + 1))
    else if (key === "ArrowLeft" || (key === "b" && e.ctrlKey)) this.at = e.metaKey ? 0 : e.altKey ? this.word(-1) : Math.max(0, this.at - 1)
    else if (key === "ArrowRight" || (key === "f" && e.ctrlKey)) this.at = e.metaKey ? this.text.length : e.altKey ? this.word(1) : Math.min(this.text.length, this.at + 1)
    else if (key === "End" || (key === "e" && e.ctrlKey)) this.at = this.text.length
    else this.lost = true
    return true
  }
}
