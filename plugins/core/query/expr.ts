// Obsidian Bases' expression language (filters, formulas, summaries), no Node. Lenient where a vault has only text:
// "[[x]]" is a link and date-looking text acts as a date. Parse errors throw ExprError when compiled.
import { formatDate as formatAt } from "../../../core/dates.ts"
import type { Rec } from "./query.ts"

export class ExprError extends Error {}

// ---------- values

/** A date (ms, this machine's time); `time`: it has a time of day (now(), file.mtime), not only a day (today()). */
class BDate {
  ms: number; time: boolean
  constructor(ms: number, time: boolean) { this.ms = ms; this.time = time }
}
/** A link: to a file (a name, a path) or a URL, with the text it shows. */
class BLink {
  target: string; display?: string
  constructor(target: string, display?: string) { this.target = target; this.display = display }
}
/** A file of the vault (the one tested, `this`, or one a link names). */
class BFile {
  rec: Rec
  constructor(rec: Rec) { this.rec = rec }
}
/** A length of time: ms, plus months (a month or a year isn't a fixed number of ms). */
class BDuration {
  ms: number; months: number
  constructor(ms: number, months = 0) { this.ms = ms; this.months = months }
}
/** `formula`: its fields are the base's formulas, worked out for the file being tested. */
class FormulaRef {}
const FORMULAS = new FormulaRef()
/** `note`: the tested file's properties. */
class NoteRef {}
const NOTE = new NoteRef()

export type V = null | number | string | boolean | BDate | BLink | BFile | BDuration | RegExp | FormulaRef | NoteRef | V[] | { [k: string]: V }

/** What an evaluation can reach beyond the file it tests. */
export type Env = {
  /** The file a link written in `from` names (a name, a path, an alias), or null. */
  resolve: (target: string, from?: string) => Rec | null
  /** `this`: the file the base is shown for (the base itself, or the note embedding it). */
  self: Rec | null
  /** A formula's value for a file (the caller keeps them, and stops a formula that refers to itself). */
  formula: (rec: Rec, name: string) => V
  /** The paths of the files that link to a file (file.backlinks; worked out once, when first asked). */
  backlinks: (rec: Rec) => string[]
  now: number
}

type Scope = { rec: Rec | null; env: Env; vars?: Record<string, V> }

// ---------- dates and durations

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/
/** Text as a date ("2026-09-27", "2026-09-27 18:00:00", ISO with a zone), or null. */
export function parseDate(s: string): BDate | null {
  const m = DATE_RE.exec(s.trim())
  if (!m) return null
  const [y, mo, d, h, mi, sec, msec] = [1, 2, 3, 4, 5, 6, 7].map((i) => Number(m[i] ?? 0))
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  let ms: number
  if (m[8]) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}${m[8] === "Z" ? "Z" : m[8].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")}`
    ms = Date.parse(iso)
  } else ms = new Date(y, mo - 1, d, h, mi, sec, msec).getTime()
  return isNaN(ms) ? null : new BDate(ms, m[4] !== undefined)
}
const asDate = (v: V): BDate | null => (v instanceof BDate ? v : typeof v === "string" ? parseDate(v) : null)

const UNITS: Record<string, [number, number]> = {} // unit -> [ms, months]
for (const [names, ms, months] of [
  [["y", "year", "years"], 0, 12], [["M", "month", "months"], 0, 1], [["w", "week", "weeks"], 7 * 864e5, 0],
  [["d", "day", "days"], 864e5, 0], [["h", "hour", "hours"], 36e5, 0], [["m", "minute", "minutes"], 6e4, 0],
  [["s", "second", "seconds"], 1e3, 0],
] as [string[], number, number][]) for (const n of names) UNITS[n] = [ms, months]

/** "1d", "2 weeks", "1M 4h", "-3 days" as a duration, or null. ("m" is minutes, "M" months.) */
export function parseDuration(s: string): BDuration | null {
  const t = s.trim()
  const parts = [...t.matchAll(/(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*/gy)]
  // (the scan must cover the whole text: "1d" is a duration, "1d later" isn't)
  if (!parts.length || parts.reduce((n, p) => n + p[0].length, 0) !== t.length) return null
  let ms = 0, months = 0
  for (const p of parts) {
    // One letter: as written ("m" minutes, "M" months); words in any case.
    const u = p[2].length === 1 ? UNITS[p[2]] : UNITS[p[2].toLowerCase()]
    if (!u) return null
    ms += Number(p[1]) * u[0]; months += Number(p[1]) * u[1]
  }
  return new BDuration(ms, months)
}
const asDuration = (v: V): BDuration | null => (v instanceof BDuration ? v : typeof v === "string" ? parseDuration(v) : typeof v === "number" ? new BDuration(v) : null)

function shift(d: BDate, dur: BDuration, sign: number): BDate {
  let ms = d.ms
  if (dur.months) {
    const x = new Date(ms)
    x.setMonth(x.getMonth() + sign * dur.months)
    ms = x.getTime()
  }
  return new BDate(ms + sign * dur.ms, d.time || dur.ms % 864e5 !== 0)
}

/** A date in a format (YYYY-MM-DD, dddd, MMM Do...: core/dates.ts), in this machine's time. */
export const formatDate = (d: BDate, fmt: string) => formatAt(new Date(d.ms), fmt)
/** A date as the app writes one: "2026-09-27", or "2026-09-27 18:00" when it has a time. */
export const dateText = (d: BDate) => formatDate(d, d.time ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD")

function relative(d: BDate, now: number) {
  const diff = d.ms - now, abs = Math.abs(diff)
  const steps: [number, string][] = [[365 * 864e5, "year"], [30 * 864e5, "month"], [7 * 864e5, "week"], [864e5, "day"], [36e5, "hour"], [6e4, "minute"]]
  for (const [ms, unit] of steps) {
    if (abs >= ms) { const n = Math.round(abs / ms); const t = `${n} ${unit}${n === 1 ? "" : "s"}`; return diff < 0 ? `${t} ago` : `in ${t}` }
  }
  return "now"
}

/** A duration as words ("3 days", "2 hours"). */
export function durationText(ms: number) {
  const abs = Math.abs(ms)
  for (const [n, unit] of [[864e5, "day"], [36e5, "hour"], [6e4, "minute"], [1e3, "second"]] as [number, string][]) {
    if (abs >= n) { const k = Math.round((ms / n) * 10) / 10; return `${k} ${unit}${Math.abs(k) === 1 ? "" : "s"}` }
  }
  return `${ms} ms`
}

// ---------- the language

type Tok = { t: "num" | "str" | "re" | "id" | "op" | "p"; v: string; at: number; re?: RegExp }
type Node =
  | { k: "lit"; v: V }
  | { k: "id"; name: string }
  | { k: "member"; obj: Node; name: string }
  | { k: "index"; obj: Node; idx: Node }
  | { k: "call"; fn: Node; args: Node[] }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "list"; items: Node[] }
  | { k: "obj"; entries: [string, Node][] }

const OPS = ["==", "!=", ">=", "<=", "&&", "||", ">", "<", "+", "-", "*", "/", "%", "!", "="]
const ID_START = /[\p{L}_$]/u, ID_PART = /[\p{L}\p{N}_$]/u

function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const valueBefore = () => { const p = out[out.length - 1]; return !!p && (p.t === "num" || p.t === "str" || p.t === "id" || p.t === "re" || p.v === ")" || p.v === "]") }
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === "'" || c === '"') {
      let j = i + 1, s = ""
      for (; j < src.length && src[j] !== c; j++) {
        if (src[j] === "\\" && j + 1 < src.length) { j++; s += ({ n: "\n", t: "\t" } as Record<string, string>)[src[j]] ?? src[j] } else s += src[j]
      }
      if (j >= src.length) throw new ExprError(`a quote isn't closed: ${src.slice(i)}`)
      out.push({ t: "str", v: s, at: i }); i = j + 1; continue
    }
    if (c === "/" && !valueBefore()) {
      let j = i + 1, inClass = false
      for (; j < src.length; j++) {
        if (src[j] === "\\") { j++; continue }
        if (src[j] === "[") inClass = true
        else if (src[j] === "]") inClass = false
        else if (src[j] === "/" && !inClass) break
      }
      if (j >= src.length) throw new ExprError(`a regular expression isn't closed: ${src.slice(i)}`)
      const flags = /^[gimsuy]*/.exec(src.slice(j + 1))![0]
      let re: RegExp
      try { re = new RegExp(src.slice(i + 1, j), flags) } catch (e) { throw new ExprError(`bad regular expression: ${(e as Error).message}`) }
      out.push({ t: "re", v: src.slice(i, j + 1 + flags.length), at: i, re }); i = j + 1 + flags.length; continue
    }
    if (/\d/.test(c)) {
      const m = /^\d+(?:\.\d+)?/.exec(src.slice(i))!
      out.push({ t: "num", v: m[0], at: i }); i += m[0].length; continue
    }
    if (ID_START.test(c)) {
      let j = i + 1
      // (a dash between letters is part of the name: `due-date`; `a - b` is a minus)
      while (j < src.length && (ID_PART.test(src[j]) || (src[j] === "-" && j + 1 < src.length && ID_START.test(src[j + 1]) && ID_PART.test(src[j - 1])))) j++
      out.push({ t: "id", v: src.slice(i, j), at: i }); i = j; continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) { out.push({ t: "op", v: op === "=" ? "==" : op, at: i }); i += op.length; continue }
    if ("()[]{},.:".includes(c)) { out.push({ t: "p", v: c, at: i }); i++; continue }
    throw new ExprError(`unexpected '${c}'`)
  }
  return out
}

/** Global functions, and how many arguments each takes at least. */
const GLOBALS: Record<string, number> = {
  date: 1, duration: 1, file: 1, if: 2, image: 1, icon: 1, link: 1, list: 1, max: 0, min: 0, now: 0, number: 1, today: 0,
  random: 0, escapeHTML: 1, html: 1,
}

/** An expression parsed. Throws ExprError saying what's wrong. */
export function parse(src: string): Node {
  if (typeof src !== "string") src = String(src ?? "")
  if (src.length > 4000) throw new ExprError("the expression is too long")
  const toks = lex(src)
  if (!toks.length) throw new ExprError("the expression is empty")
  let i = 0, depth = 0
  const peek = (v?: string) => { const t = toks[i]; return t && (v === undefined || ((t.t === "op" || t.t === "p") && t.v === v)) ? t : undefined }
  const expect = (v: string) => { if (!peek(v)) throw new ExprError(toks[i] ? `expected '${v}', found '${toks[i].v}'` : `expected '${v}' at the end`); i++ }
  const bin = (next: () => Node, ops: string[]) => () => {
    let a = next()
    while (toks[i]?.t === "op" && ops.includes(toks[i].v)) { const op = toks[i++].v; a = { k: "bin", op, a, b: next() } }
    return a
  }
  const unary = (): Node => {
    const t = toks[i]
    if (t?.t === "op" && (t.v === "!" || t.v === "-")) { i++; return { k: "un", op: t.v, a: unary() } }
    return postfix()
  }
  const mul = bin(unary, ["*", "/", "%"])
  const add = bin(mul, ["+", "-"])
  const cmp = bin(add, [">", "<", ">=", "<="])
  const eq = bin(cmp, ["==", "!="])
  const and = bin(eq, ["&&"])
  const or = bin(and, ["||"])
  const expr = (): Node => {
    if (++depth > 64) throw new ExprError("the expression nests too deeply")
    const e = or()
    depth--
    return e
  }
  const args = (close: string): Node[] => {
    const out: Node[] = []
    if (peek(close)) { i++; return out }
    for (;;) {
      out.push(expr())
      if (peek(",")) { i++; if (peek(close)) { i++; return out } continue }
      expect(close)
      return out
    }
  }
  function postfix(): Node {
    let n = primary()
    for (;;) {
      if (peek(".")) {
        i++
        const t = toks[i]
        if (!t || (t.t !== "id" && t.t !== "num")) throw new ExprError("expected a name after '.'")
        i++
        n = { k: "member", obj: n, name: t.v }
      } else if (peek("[")) { i++; const idx = expr(); expect("]"); n = { k: "index", obj: n, idx } }
      else if (peek("(")) {
        i++
        if (n.k === "id" && !(n.name in GLOBALS)) throw new ExprError(`there's no function ${n.name}()`)
        if (n.k !== "id" && n.k !== "member") throw new ExprError("only a function can be called")
        const a = args(")")
        if (n.k === "id" && a.length < GLOBALS[n.name]) throw new ExprError(`${n.name}() needs ${GLOBALS[n.name]} argument${GLOBALS[n.name] === 1 ? "" : "s"}`)
        n = { k: "call", fn: n, args: a }
      } else return n
    }
  }
  function primary(): Node {
    const t = toks[i]
    if (!t) throw new ExprError("the expression ends too soon")
    i++
    if (t.t === "num") return { k: "lit", v: Number(t.v) }
    if (t.t === "str") return { k: "lit", v: t.v }
    if (t.t === "re") return { k: "lit", v: t.re! }
    if (t.t === "id") {
      if (t.v === "true" || t.v === "false") return { k: "lit", v: t.v === "true" }
      if (t.v === "null") return { k: "lit", v: null }
      return { k: "id", name: t.v }
    }
    if (t.v === "(") { const e = expr(); expect(")"); return e }
    if (t.v === "[") return { k: "list", items: args("]") }
    if (t.v === "{") {
      const entries: [string, Node][] = []
      if (peek("}")) { i++; return { k: "obj", entries } }
      for (;;) {
        const key = toks[i]
        if (!key || (key.t !== "str" && key.t !== "id")) throw new ExprError("expected a key in { }")
        i++
        expect(":")
        entries.push([key.v, expr()])
        if (peek(",")) { i++; continue }
        expect("}")
        return { k: "obj", entries }
      }
    }
    throw new ExprError(`unexpected '${t.v}'`)
  }
  const e = expr()
  if (i < toks.length) throw new ExprError(`unexpected '${toks[i].v}'`)
  return e
}

// ---------- evaluating

const WIKI = /^\[\[([^[\]|#]+)(#[^[\]|]*)?(?:\|([^[\]]*))?\]\]$/
/** A property's value as the language sees it: "[[Alice Park]]" is a link; lists likewise. */
export function wrap(v: unknown): V {
  if (v === undefined || v === null) return null
  if (typeof v === "string") {
    const m = WIKI.exec(v.trim())
    return m ? new BLink(m[1].trim() + (m[2] ?? ""), m[3]?.trim()) : v
  }
  if (Array.isArray(v)) return v.map(wrap)
  if (typeof v === "object" && !(v instanceof BDate || v instanceof BLink || v instanceof BFile || v instanceof BDuration || v instanceof RegExp)) {
    return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, wrap(x)]))
  }
  return v as V
}

export const truthy = (v: V): boolean =>
  !(v === null || v === undefined || v === false || v === 0 || v === "" || (typeof v === "number" && isNaN(v)))

const isPlainObj = (v: V): v is { [k: string]: V } =>
  !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof BDate || v instanceof BLink || v instanceof BFile || v instanceof BDuration || v instanceof RegExp || v instanceof FormulaRef || v instanceof NoteRef)

export function typeOf(v: V): string {
  if (v === null || v === undefined) return "null"
  if (Array.isArray(v)) return "list"
  if (v instanceof BDate) return "date"
  if (v instanceof BLink) return "link"
  if (v instanceof BFile) return "file"
  if (v instanceof BDuration) return "duration"
  if (v instanceof RegExp) return "regexp"
  if (typeof v === "object") return "object"
  return typeof v
}

const stem = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "")
const fileName = (p: string) => p.slice(p.lastIndexOf("/") + 1)

/** A value as text (for `+` with text, join, toString, a table cell). */
export function show(v: V): string {
  if (v === null || v === undefined) return ""
  if (Array.isArray(v)) return v.map(show).join(", ")
  if (v instanceof BDate) return dateText(v)
  if (v instanceof BLink) return v.display ?? v.target
  if (v instanceof BFile) return stem(v.rec.path)
  if (v instanceof BDuration) return durationText(v.ms + v.months * 30 * 864e5)
  if (v instanceof RegExp) return String(v)
  if (typeof v === "number") return String(Math.round(v * 1e10) / 1e10)
  if (typeof v === "object") return JSON.stringify(plainOf(v))
  return String(v)
}

/** A value as plain data for the app and Markdown: a date as "2026-09-27 18:00", a link or a file as "[[Name]]" (or
 *  "[[Name|text]]"), a URL link as its address, a duration as words. */
export function plainOf(v: V): unknown {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return v.map(plainOf)
  if (v instanceof BDate) return dateText(v)
  if (v instanceof BLink) return /^[a-z][a-z0-9+.-]*:\/\//i.test(v.target) ? v.target : `[[${v.target}${v.display ? `|${v.display}` : ""}]]`
  if (v instanceof BFile) return `[[${v.rec.path.replace(/\.md$/i, "")}|${stem(v.rec.path)}]]`
  if (v instanceof BDuration) return durationText(v.ms + v.months * 30 * 864e5)
  if (v instanceof RegExp) return String(v)
  if (v instanceof FormulaRef || v instanceof NoteRef) return null
  if (typeof v === "number") return isFinite(v) ? Math.round(v * 1e10) / 1e10 : null
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plainOf(x)]))
  return v
}

/** The path a link, a file or a name points to, or null. */
function pathOf(v: V, env: Env): string | null {
  if (v instanceof BFile) return v.rec.path
  if (v instanceof BLink) return env.resolve(v.target)?.path ?? null
  if (typeof v === "string") return env.resolve(v.replace(/^\[\[|\]\]$/g, "").split("|")[0])?.path ?? null
  return null
}
const linkName = (t: string) => t.split("#")[0].trim().replace(/\.md$/i, "").toLowerCase()

/** Equality as Bases has it: a link equals the file it points to (or a link with the same text), dates by time,
 *  lists item by item, a number its text. */
export function equal(a: V, b: V, env: Env): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null)
  if (a instanceof BLink || b instanceof BLink || a instanceof BFile || b instanceof BFile) {
    if (a instanceof BFile && b instanceof BFile) return a.rec.path === b.rec.path
    const name = (x: V) => (x instanceof BLink ? linkName(x.target) : x instanceof BFile ? stem(x.rec.path).toLowerCase() : typeof x === "string" ? linkName(x.replace(/^\[\[|\]\]$/g, "").split("|")[0]) : null)
    const na = name(a), nb = name(b)
    if (na !== null && na === nb) return true
    const pa = pathOf(a, env), pb = pathOf(b, env)
    return !!pa && pa === pb
  }
  const da = a instanceof BDate ? a : null, db = b instanceof BDate ? b : null
  if (da || db) { const x = asDate(a), y = asDate(b); return !!x && !!y && x.ms === y.ms }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i], env))
  }
  if (typeof a === "number" && typeof b === "string" && b.trim() !== "" && !isNaN(Number(b))) return a === Number(b)
  if (typeof b === "number" && typeof a === "string" && a.trim() !== "" && !isNaN(Number(a))) return b === Number(a)
  if (isPlainObj(a) && isPlainObj(b)) return JSON.stringify(plainOf(a)) === JSON.stringify(plainOf(b))
  return a === b
}

/** Order of two values (numbers, dates, text, durations), or null when they can't be compared. */
export function order(a: V, b: V): number | null {
  if (a === null || b === null) return null
  if (typeof a === "number" && typeof b === "number") return a - b
  if (a instanceof BDate || b instanceof BDate) { const x = asDate(a), y = asDate(b); return x && y ? x.ms - y.ms : null }
  if (a instanceof BDuration && b instanceof BDuration) return a.ms + a.months * 30 * 864e5 - (b.ms + b.months * 30 * 864e5)
  const na = typeof a === "number" ? a : typeof a === "string" && a.trim() && !isNaN(Number(a)) ? Number(a) : null
  const nb = typeof b === "number" ? b : typeof b === "string" && b.trim() && !isNaN(Number(b)) ? Number(b) : null
  if (na !== null && nb !== null) return na - nb
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b)
  return null
}

function arith(op: string, a: V, b: V): V {
  if (op === "+") {
    if (typeof a === "number" && typeof b === "number") return a + b
    const da = asDate(a)
    if (da && (a instanceof BDate || (b !== null && !(typeof b === "string" && !parseDuration(b))))) {
      const dur = asDuration(b)
      if (dur) return shift(da, dur, 1)
    }
    if (a instanceof BDuration && b instanceof BDuration) return new BDuration(a.ms + b.ms, a.months + b.months)
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b]
    if (typeof a === "string" || typeof b === "string") return show(a) + show(b)
    if (a === null || b === null) return null
    return show(a) + show(b)
  }
  if (op === "-") {
    if (typeof a === "number" && typeof b === "number") return a - b
    const da = asDate(a)
    if (da) {
      const db = b instanceof BDate ? b : typeof b === "string" && !parseDuration(b) ? parseDate(b) : null
      if (db) return da.ms - db.ms
      const dur = asDuration(b)
      if (dur) return shift(da, dur, -1)
    }
    if (a instanceof BDuration && b instanceof BDuration) return new BDuration(a.ms - b.ms, a.months - b.months)
  }
  if (a instanceof BDuration && typeof b === "number") {
    if (op === "*") return new BDuration(a.ms * b, a.months * b)
    if (op === "/") return new BDuration(a.ms / b, a.months / b)
  }
  const x = num(a), y = num(b)
  if (x === null || y === null) return null
  switch (op) {
    case "-": return x - y
    case "*": return x * y
    case "/": return y === 0 ? null : x / y
    case "%": return y === 0 ? null : x % y
  }
  return null
}

function num(v: V): number | null {
  if (typeof v === "number") return v
  if (typeof v === "boolean") return v ? 1 : 0
  if (typeof v === "string" && v.trim() && !isNaN(Number(v))) return Number(v)
  if (v instanceof BDate) return v.ms
  if (v instanceof BDuration) return v.ms + v.months * 30 * 864e5
  return null
}

/** A property of the tested file (its frontmatter, case-insensitive when not exact). */
function prop(rec: Rec | null, name: string): V {
  if (!rec) return null
  if (name in rec.fm) return wrap(rec.fm[name])
  const low = name.toLowerCase()
  const k = Object.keys(rec.fm).find((x) => x.toLowerCase() === low)
  return k ? wrap(rec.fm[k]) : null
}

function linksOf(rec: Rec): BLink[] {
  return (rec.links?.() ?? []).map((t) => new BLink(t))
}

/** A file's field (file.name, file.mtime...); other names are its properties. */
function fileField(f: BFile, name: string, s: Scope): V {
  const r = f.rec
  switch (name) {
    case "name": return fileName(r.path)
    case "basename": return fileName(r.path).replace(/\.[^.]+$/, "")
    case "path": return r.path
    case "folder": return r.path.includes("/") ? r.path.slice(0, r.path.lastIndexOf("/")) : ""
    case "ext": return /\.([^./]+)$/.exec(r.path)?.[1] ?? ""
    case "size": return r.size ?? null
    case "ctime": return new BDate(r.created ? r.created() : r.mtime, true)
    case "mtime": return new BDate(r.mtime, true)
    case "tags": return [...(r.tags ?? [])].map((t) => (t.startsWith("#") ? t : `#${t}`))
    case "links": return linksOf(r)
    case "embeds": return (r.embeds?.() ?? []).map((t) => new BLink(t))
    case "backlinks": return s.env.backlinks(r).map((p) => new BLink(p.replace(/\.md$/i, "")))
    case "properties": return wrap(r.fm)
    case "file": return f
  }
  return prop(r, name)
}

const DATE_FIELDS = ["year", "month", "day", "hour", "minute", "second", "millisecond"]
function dateField(d: BDate, name: string): number {
  const x = new Date(d.ms)
  return [x.getFullYear(), x.getMonth() + 1, x.getDate(), x.getHours(), x.getMinutes(), x.getSeconds(), x.getMilliseconds()][DATE_FIELDS.indexOf(name)]
}

function member(obj: V, name: string, s: Scope): V {
  if (obj === null || obj === undefined) return null
  if (obj instanceof FormulaRef) { if (!s.rec) return null; return s.env.formula(s.rec, name) }
  if (obj instanceof NoteRef) return prop(s.rec, name)
  if (obj instanceof BFile) return fileField(obj, name, s)
  if (DATE_FIELDS.includes(name)) { const d = asDate(obj); if (d) return dateField(d, name) }
  if (name === "length") {
    if (typeof obj === "string" || Array.isArray(obj)) return obj.length
  }
  if (obj instanceof BLink) {
    // (a link's file's fields, like Obsidian's link.asFile().x, for the common case)
    const r = s.env.resolve(obj.target, s.rec?.path)
    return r ? fileField(new BFile(r), name, s) : null
  }
  if (isPlainObj(obj)) {
    if (name in obj) return obj[name]
    const k = Object.keys(obj).find((x) => x.toLowerCase() === name.toLowerCase())
    return k ? obj[k] : null
  }
  return null
}

function index(obj: V, idx: V, s: Scope): V {
  if (obj === null || obj === undefined || idx === null) return null
  if (Array.isArray(obj) || typeof obj === "string") {
    const n = num(idx)
    if (n === null) return typeof idx === "string" && Array.isArray(obj) ? null : null
    const i = n < 0 ? obj.length + n : n
    const v = obj[i]
    return v === undefined ? null : (v as V)
  }
  return member(obj, show(idx), s)
}

/** Evaluate an expression for a file (rec: the file tested; null in a summary). */
export function evaluate(n: Node, rec: Rec | null, env: Env, vars?: Record<string, V>): V {
  return ev(n, { rec, env, vars })
}

function ev(n: Node, s: Scope): V {
  switch (n.k) {
    case "lit": return n.v
    case "list": return n.items.map((x) => ev(x, s))
    case "obj": return Object.fromEntries(n.entries.map(([k, x]) => [k, ev(x, s)]))
    case "id": {
      if (s.vars && n.name in s.vars) return s.vars[n.name]
      switch (n.name) {
        case "file": return s.rec ? new BFile(s.rec) : null
        case "note": return NOTE
        case "formula": return FORMULAS
        case "this": return s.env.self ? new BFile(s.env.self) : null
      }
      return prop(s.rec, n.name)
    }
    case "member": return member(ev(n.obj, s), n.name, s)
    case "index": return index(ev(n.obj, s), ev(n.idx, s), s)
    case "un": {
      const a = ev(n.a, s)
      if (n.op === "!") return !truthy(a)
      const x = num(a)
      return a instanceof BDuration ? new BDuration(-a.ms, -a.months) : x === null ? null : -x
    }
    case "bin": {
      if (n.op === "&&") { const a = ev(n.a, s); return truthy(a) ? ev(n.b, s) : a }
      if (n.op === "||") { const a = ev(n.a, s); return truthy(a) ? a : ev(n.b, s) }
      const a = ev(n.a, s), b = ev(n.b, s)
      switch (n.op) {
        case "==": return equal(a, b, s.env)
        case "!=": return !equal(a, b, s.env)
        case ">": case "<": case ">=": case "<=": {
          const d = order(a, b)
          if (d === null) return false
          return n.op === ">" ? d > 0 : n.op === "<" ? d < 0 : n.op === ">=" ? d >= 0 : d <= 0
        }
      }
      return arith(n.op, a, b)
    }
    case "call": {
      if (n.fn.k === "id") return global(n.fn.name, n.args, s)
      const fn = n.fn as { k: "member"; obj: Node; name: string }
      return method(ev(fn.obj, s), fn.name, n.args, s)
    }
  }
}

function global(name: string, args: Node[], s: Scope): V {
  if (name === "if") return truthy(ev(args[0], s)) ? ev(args[1], s) : args[2] ? ev(args[2], s) : null
  const a = args.map((x) => ev(x, s))
  switch (name) {
    case "now": return new BDate(s.env.now, true)
    case "today": { const d = new Date(s.env.now); return new BDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), false) }
    case "date": return a[0] instanceof BDate ? a[0] : typeof a[0] === "string" ? parseDate(a[0]) : typeof a[0] === "number" ? new BDate(a[0], true) : null
    case "duration": return asDuration(a[0])
    case "file": {
      if (a[0] instanceof BFile) return a[0]
      const p = a[0] instanceof BLink ? a[0].target : typeof a[0] === "string" ? a[0].replace(/^\[\[|\]\]$/g, "") : null
      const r = p ? s.env.resolve(p, s.rec?.path) : null
      return r ? new BFile(r) : null
    }
    case "link": {
      const d = a[1] === undefined || a[1] === null ? undefined : show(a[1])
      if (a[0] instanceof BFile) return new BLink(a[0].rec.path.replace(/\.md$/i, ""), d ?? stem(a[0].rec.path))
      if (a[0] instanceof BLink) return new BLink(a[0].target, d ?? a[0].display)
      if (a[0] === null) return null
      const t = show(a[0]).trim(), m = WIKI.exec(t)
      return m ? new BLink(m[1].trim(), d ?? m[3]) : new BLink(t, d)
    }
    case "list": return a[0] === null ? [] : Array.isArray(a[0]) ? a[0] : [a[0]]
    case "max": case "min": {
      const ns = a.flat().map(num).filter((x): x is number => x !== null)
      return ns.length ? (name === "max" ? Math.max(...ns) : Math.min(...ns)) : null
    }
    case "number": return num(a[0])
    case "random": return Math.random()
    case "image": return a[0] instanceof BLink || a[0] instanceof BFile ? a[0] : a[0] === null ? null : show(a[0])
    case "icon": return a[0] === null ? null : show(a[0])
    case "html": return show(a[0])
    case "escapeHTML": return show(a[0]).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c])
  }
  throw new ExprError(`there's no function ${name}()`)
}

const textOf = (v: V) => (v instanceof BLink ? v.target : show(v))

function stats(xs: V[]) {
  return xs.map(num).filter((x): x is number => x !== null)
}

/** Functions on a value (`"hello".contains("ell")`, `file.hasTag("book")`, `[1, 2].map(value + 1)`). */
function method(obj: V, name: string, args: Node[], s: Scope): V {
  // Lazy ones first (their argument runs per item).
  if (Array.isArray(obj) && (name === "filter" || name === "map" || name === "reduce" || name === "find" || name === "some" || name === "every")) {
    const run = (value: V, i: number, acc?: V) => ev(args[0], { ...s, vars: { ...s.vars, value, index: i, ...(acc !== undefined ? { acc } : {}) } })
    if (!args[0]) throw new ExprError(`${name}() needs an expression`)
    if (name === "filter") return obj.filter((v, i) => truthy(run(v, i)))
    if (name === "map") return obj.map((v, i) => run(v, i))
    if (name === "find") return obj.find((v, i) => truthy(run(v, i))) ?? null
    if (name === "some") return obj.some((v, i) => truthy(run(v, i)))
    if (name === "every") return obj.every((v, i) => truthy(run(v, i)))
    let acc: V = args[1] ? ev(args[1], s) : null
    obj.forEach((v, i) => { acc = run(v, i, acc) })
    return acc
  }
  const a = args.map((x) => ev(x, s))
  // Any value.
  switch (name) {
    case "isTruthy": return truthy(obj)
    case "isType": return typeOf(obj) === show(a[0]).toLowerCase() || (show(a[0]).toLowerCase() === "string" && typeof obj === "string")
    case "toString": return show(obj)
    case "isEmpty":
      return obj === null || obj === undefined || obj === "" || (Array.isArray(obj) && !obj.length) || (isPlainObj(obj) && !Object.keys(obj).length)
  }
  if (obj === null || obj === undefined) return null
  if (obj instanceof BFile) {
    const r = obj.rec
    switch (name) {
      case "asLink": return new BLink(r.path.replace(/\.md$/i, ""), a[0] === undefined || a[0] === null ? stem(r.path) : show(a[0]))
      case "hasTag": {
        const tags = (r.tags ?? []).map((t) => t.replace(/^#/, "").toLowerCase())
        return a.flat().some((w) => { const t = show(w).replace(/^#/, "").toLowerCase(); return tags.some((h) => h === t || h.startsWith(`${t}/`)) })
      }
      case "inFolder": {
        const f = show(a[0]).replace(/^\/+|\/+$/g, "").toLowerCase()
        return !f || r.path.toLowerCase().startsWith(`${f}/`)
      }
      case "hasProperty": { const k = show(a[0]); return Object.hasOwn(r.fm, k) || Object.keys(r.fm).some((x) => x.toLowerCase() === k.toLowerCase()) }
      case "hasLink": {
        const want = pathOf(a[0], s.env)
        const wname = a[0] instanceof BFile ? stem(a[0].rec.path).toLowerCase() : a[0] instanceof BLink ? linkName(a[0].target) : typeof a[0] === "string" ? linkName(a[0].replace(/^\[\[|\]\]$/g, "")) : null
        return (r.links?.() ?? []).some((t) => (want && s.env.resolve(t, r.path)?.path === want) || (wname !== null && linkName(t) === wname))
      }
      case "asFile": return obj
    }
  }
  if (obj instanceof BLink) {
    switch (name) {
      case "asFile": { const r = s.env.resolve(obj.target, s.rec?.path); return r ? new BFile(r) : null }
      case "linksTo": {
        const r = s.env.resolve(obj.target, s.rec?.path)
        return r ? method(new BFile(r), "hasLink", args, s) : false
      }
      case "asLink": return obj
    }
  }
  if (obj instanceof RegExp && name === "matches") { obj.lastIndex = 0; return obj.test(show(a[0])) }
  // A date (or text that is one).
  const d = asDate(obj)
  if (d && (obj instanceof BDate || ["date", "format", "time", "relative"].includes(name))) {
    switch (name) {
      case "date": { const x = new Date(d.ms); return new BDate(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), false) }
      case "format": return formatDate(d, a[0] === undefined || a[0] === null ? "YYYY-MM-DD" : show(a[0]))
      case "time": return formatDate(d, "HH:mm:ss")
      case "relative": return relative(d, s.env.now)
    }
  }
  if (typeof obj === "number") {
    switch (name) {
      case "abs": return Math.abs(obj)
      case "ceil": return Math.ceil(obj)
      case "floor": return Math.floor(obj)
      case "round": { const p = 10 ** (num(a[0] ?? 0) ?? 0); return Math.round(obj * p) / p }
      case "toFixed": return obj.toFixed(Math.min(Math.max(num(a[0] ?? 0) ?? 0, 0), 20))
    }
  }
  if (typeof obj === "string" || obj instanceof BLink) {
    const t = textOf(obj)
    switch (name) {
      case "contains": return t.includes(show(a[0]))
      case "containsAll": return a.every((x) => t.includes(show(x)))
      case "containsAny": return a.some((x) => t.includes(show(x)))
      case "startsWith": return t.startsWith(show(a[0]))
      case "endsWith": return t.endsWith(show(a[0]))
      case "lower": return t.toLowerCase()
      case "upper": return t.toUpperCase()
      case "title": return t.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase())
      case "trim": return t.trim()
      case "reverse": return [...t].reverse().join("")
      case "repeat": return t.repeat(Math.min(Math.max(num(a[0]) ?? 0, 0), 1000))
      case "slice": return t.slice(num(a[0]) ?? 0, a[1] === undefined ? undefined : num(a[1]) ?? undefined)
      case "split": {
        const parts = a[0] instanceof RegExp ? t.split(a[0]) : t.split(show(a[0]))
        return a[1] === undefined ? parts : parts.slice(0, num(a[1]) ?? undefined)
      }
      case "replace": {
        if (a[0] instanceof RegExp) return t.replace(a[0], show(a[1]))
        return t.split(show(a[0])).join(show(a[1]))
      }
    }
  }
  if (Array.isArray(obj)) {
    const has = (x: V) => obj.some((y) => equal(y, x, s.env))
    switch (name) {
      case "contains": return has(a[0])
      case "containsAll": return a.every(has)
      case "containsAny": return a.some(has)
      case "join": return obj.map(show).join(a[0] === undefined ? "," : show(a[0]))
      case "flat": return obj.flat(Infinity as 1) as V[]
      case "reverse": return [...obj].reverse()
      case "slice": return obj.slice(num(a[0]) ?? 0, a[1] === undefined ? undefined : num(a[1]) ?? undefined)
      case "sort": return [...obj].sort((x, y) => order(x, y) ?? show(x).localeCompare(show(y)))
      case "unique": return obj.filter((x, i) => obj.findIndex((y) => equal(x, y, s.env)) === i)
      case "first": return obj[0] ?? null
      case "last": return obj[obj.length - 1] ?? null
      // (for summaries: `values.mean().round(3)`)
      case "sum": return stats(obj).reduce((t, x) => t + x, 0)
      case "mean": case "average": { const xs = stats(obj); return xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null }
      case "min": { const xs = stats(obj); return xs.length ? Math.min(...xs) : null }
      case "max": { const xs = stats(obj); return xs.length ? Math.max(...xs) : null }
      case "median": return median(stats(obj))
    }
  }
  if (isPlainObj(obj)) {
    switch (name) {
      case "keys": return Object.keys(obj)
      case "values": return Object.values(obj)
    }
  }
  throw new ExprError(`there's no function ${name}() on ${typeOf(obj) === "string" ? "text" : `a ${typeOf(obj)}`}`)
}

function median(xs: number[]) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ---------- summaries

/** The summaries every view offers (Obsidian's names; any case). `values`: the column's values in the rows shown. */
export const SUMMARIES = ["Average", "Min", "Max", "Sum", "Range", "Median", "Stddev", "Earliest", "Latest", "Checked", "Unchecked", "Empty", "Filled", "Unique", "Count"]
const ALIASES: Record<string, string> = { mean: "average", avg: "average", total: "sum", count: "count" }

/** A built-in summary of values, or undefined when `name` isn't one. */
export function summary(name: string, values: V[]): V | undefined {
  const key = ALIASES[name.toLowerCase()] ?? name.toLowerCase()
  const blank = (v: V) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)
  const numbers = values.filter((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)))).map(Number)
  const dates = values.map((v) => (v instanceof BDate ? v : typeof v === "string" ? parseDate(v) : null)).filter((x): x is BDate => !!x)
  switch (key) {
    case "count": return values.length
    case "empty": return values.filter(blank).length
    case "filled": return values.filter((v) => !blank(v)).length
    case "unique": return new Set(values.filter((v) => !blank(v)).map((v) => JSON.stringify(plainOf(v)))).size
    case "checked": return values.filter((v) => v === true).length
    case "unchecked": return values.filter((v) => v === false).length
    case "sum": return numbers.reduce((t, x) => t + x, 0)
    case "average": return numbers.length ? numbers.reduce((t, x) => t + x, 0) / numbers.length : null
    case "median": return median(numbers)
    case "stddev": {
      if (!numbers.length) return null
      const m = numbers.reduce((t, x) => t + x, 0) / numbers.length
      return Math.sqrt(numbers.reduce((t, x) => t + (x - m) ** 2, 0) / numbers.length)
    }
    case "min": return numbers.length ? Math.min(...numbers) : dates.length ? dates.reduce((a, b) => (b.ms < a.ms ? b : a)) : null
    case "max": return numbers.length ? Math.max(...numbers) : dates.length ? dates.reduce((a, b) => (b.ms > a.ms ? b : a)) : null
    case "earliest": return dates.length ? dates.reduce((a, b) => (b.ms < a.ms ? b : a)) : null
    case "latest": return dates.length ? dates.reduce((a, b) => (b.ms > a.ms ? b : a)) : null
    case "range": {
      if (numbers.length) return Math.max(...numbers) - Math.min(...numbers)
      if (dates.length) { const ms = dates.map((d) => d.ms); return new BDuration(Math.max(...ms) - Math.min(...ms)) }
      return null
    }
  }
  return undefined
}
