const MARK = "[\\u0300-\\u036f]*"
const MARKS = /[\u0300-\u036f]/g
const FOLDS = /[\u0300-\u036f\u0401\u0451]|(?=\p{L})[\p{sc=Latin}\p{sc=Greek}]/u
const MAY_FOLD = /[\u00c0-\u036f\u0386-\u03d4\u0401\u0451\u1e00-\u1fff\u212b]/
const LETTER = /^\p{L}$/u
const OWN = new Map(Object.entries({
  ı: "i", Ø: "O", ø: "o", Ł: "L", ł: "l", Đ: "D", đ: "d", Ð: "D", ð: "d", Ħ: "H", ħ: "h",
  ẞ: "SS", ß: "ss", Æ: "AE", æ: "ae", Œ: "OE", œ: "oe", Þ: "TH", þ: "th",
}))

let table: Map<string, string> | null = null
function folds(): Map<string, string> {
  if (table) return table
  table = new Map()
  for (let code = 0xc0; code <= 0x212b; code++) {
    const c = String.fromCharCode(code), nfd = c.normalize("NFD"), bare = nfd.replace(MARKS, "")
    if (bare !== nfd && FOLDS.test(c)) table.set(c, OWN.get(bare) ?? bare)
  }
  for (const [c, to] of OWN) table.set(c, to)
  return table
}

export function fold(s: string): string {
  if (!MAY_FOLD.test(s)) return s
  const t = folds()
  let out = "", from = 0
  for (let i = 0; i < s.length; i++) {
    const to = t.get(s[i])
    if (to !== undefined) { out += s.slice(from, i) + to; from = i + 1 }
  }
  return from === 0 ? s : out + s.slice(from)
}

const sourcesCache = new Map<boolean, Map<string, string>>()
function sources(anyCase: boolean): Map<string, string> {
  let m = sourcesCache.get(anyCase)
  if (m) return m
  m = new Map()
  for (const [c, to] of folds()) {
    const key = anyCase ? to.toLowerCase() : to
    if (key) m.set(key, (m.get(key) ?? "") + c)
  }
  sourcesCache.set(anyCase, m)
  return m
}

export function lowerFolded(s: string): string {
  if (!MAY_FOLD.test(s)) return s.toLowerCase()
  const t = folds()
  let out = ""
  for (let i = 0; i < s.length; i++) { const to = t.get(s[i]); out += to?.length === 1 ? to : s[i] }
  return out.toLowerCase()
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const escapeIn = (s: string) => s.replace(/[\\\]^-]/g, "\\$&")

export function foldedPattern(s: string, anyCase: boolean): string {
  const want = anyCase ? fold(s).toLowerCase() : fold(s)
  const src = sources(anyCase), end = want.length - 1
  const pairsWith = (c: string, at: 0 | 1) => [...src].flatMap(([k, v]) => (k.length === 2 && k[at] === c ? [v] : [])).join("")
  const one = (i: number) => {
    const c = want[i]
    const extra = (i === 0 ? pairsWith(c, 1) : "") + (i === end ? pairsWith(c, 0) : "")
    const others = (src.get(c) ?? "") + extra
    return (others ? `[${escapeIn(c + others)}]` : escapeRe(c)) + (LETTER.test(c) ? MARK : "")
  }
  const from = (i: number, depth: number): string => {
    if (i > end) return ""
    const pair = i < end ? src.get(want.slice(i, i + 2)) : undefined
    if (!pair) return one(i) + from(i + 1, depth)
    if (depth > 6) return `(?:[${escapeIn(pair)}]${MARK}|${one(i)}${one(i + 1)})${from(i + 2, depth + 1)}`
    return `(?:[${escapeIn(pair)}]${MARK}${from(i + 2, depth + 1)}|${one(i)}${from(i + 1, depth + 1)})`
  }
  return from(0, 0)
}
