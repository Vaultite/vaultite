// Database views: a query over the vault's files and frontmatter (options: AGENTS.md). One
// evaluator, no Node, for the route and the block's text; comparisons are lenient ("[[A]]" is "A", any of a list).

import { linkIndex } from "../../../core/links.ts"
import { evaluate, type Env, ExprError, parse as parseExpr, plainOf, summary, SUMMARIES, truthy, type V, wrap } from "./expr.ts"

export type Opts = Record<string, unknown>
/** A file to query: path, frontmatter, mtime, created (lazy), tags (frontmatter and inline), type (core/fileprops.ts)
 *  and whether it's archived. */
export type Rec = { path: string; fm: Record<string, unknown>; mtime: number; created?: () => number; tags?: string[]; type?: string | null; archived?: boolean
  /** Its size in bytes, and the [[links]] and ![[embeds]] in it (body and properties), for Bases' `file.size`, `file.links`... */
  size?: number; links?: () => string[]; embeds?: () => string[] }
export type Column = { key: string; label: string }
/** A file on a map: where, and its pin's colour (CSS: an app colour's name is var(--name)) and lucide icon. */
export type Pin = { lat: number; lon: number; color?: string; icon?: string }
export type Row = { path: string; title: string; values: Record<string, unknown>; pin?: Pin }
/** A group: its name as text (null: no value), and `value`, the value a file in it has (what moving a card into its
 *  column writes; a listed group nobody has yet: its name). A calendar's groups are its days ("2026-09-27"). */
export type Group = { name: string | null; value?: unknown; rows: Row[]
  /** Its summaries, by column key (when the view has some and it's one of several groups). */
  summaries?: Record<string, unknown> }
/** A column's summary: which (its name) and its value over the rows shown. */
export type Summary = { key: string; name: string; value: unknown }
type SortKey = { key: string; desc: boolean }
export type View = "table" | "cards" | "list" | "board" | "calendar" | "map"
export type Result = {
  title: string; view: View; columns: Column[]; groups: Group[]; total: number; shown: number
  /** How many matches come before the rows shown (a page past the first: `offset`). */
  offset?: number
  /** The order the rows are in (their `values` have these keys too), so the app can place a moved one. */
  sort: SortKey[]
  /** The key rows are grouped by (a board's columns). */
  group?: string | null
  /** A calendar's date key and month ("2026-09"). */
  date?: string; month?: string
  /** Summaries under the columns (the rows shown). */
  summaries?: Summary[]
  /** What was left out or couldn't be worked out (a filter that doesn't parse, a formula that fails), in words. */
  notes?: string[]
  /** How many archived files match but are hidden (the options don't ask for archived ones). */
  archivedHidden?: number
  /** A map: the key the pins come from, and how many matches have no place on it. */
  coordinates?: string; unplaced?: number
  /** A Bases file's views (bases.ts), and which one this is. */
  views?: { name: string; type: string }[]; current?: number
  /** The declared types of its keys that have one (the vault's property types), so the app sorts them alike. */
  types?: Record<string, string>
}

export class QueryError extends Error {}

const SPECIAL = ["file", "folder", "path", "updated", "created"]
export const VIEWS: View[] = ["table", "cards", "list", "board", "calendar", "map"]
const MONTH = /^(\d{4})-(\d{2})$/

// ---------- the expression language

type Tok = { t: "word" | "str" | "num" | "op" | "(" | ")"; v: string }
type Node =
  | { k: "and" | "or"; a: Node; b: Node }
  | { k: "not"; a: Node }
  | { k: "has"; key: string }
  | { k: "cmp"; key: string; op: string; value: string | number | boolean | null
      /** `this` (""), or `this.<key>`: the note the view is in, or its value of a key, in place of `value`. */
      ref?: string }

const OPS = ["<=", ">=", "!=", "==", "=", "<", ">"]

function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === "(" || c === ")") { out.push({ t: c, v: c }); i++; continue }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1)
      if (end < 0) throw new QueryError(`a quote isn't closed: ${src.slice(i)}`)
      out.push({ t: "str", v: src.slice(i + 1, end) })
      i = end + 1
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) { out.push({ t: "op", v: op === "==" ? "=" : op }); i += op.length; continue }
    const m = /^[^\s()'"<>=!]+/.exec(src.slice(i))
    if (!m) throw new QueryError(`unexpected '${c}' in the where`)
    const w = m[0]
    out.push(/^-?\d+(\.\d+)?$/.test(w) ? { t: "num", v: w } : { t: "word", v: w })
    i += w.length
  }
  return out
}

/** Parse a where expression. Throws QueryError with what's wrong. */
export function parseWhere(src: string): Node | null {
  if (src.length > 2000) throw new QueryError("the where is too long")
  const toks = lex(src)
  if (!toks.length) return null
  let i = 0
  const peek = () => toks[i]
  const word = (w: string) => peek()?.t === "word" && peek().v.toLowerCase() === w
  let depth = 0
  const or = (): Node => {
    let a = and()
    while (word("or")) { i++; a = { k: "or", a, b: and() } }
    return a
  }
  const and = (): Node => {
    let a = unary()
    while (word("and")) { i++; a = { k: "and", a, b: unary() } }
    return a
  }
  const unary = (): Node => {
    const t = peek()
    if (!t) throw new QueryError("the where ends too soon")
    if (word("not")) { i++; return { k: "not", a: unary() } }
    if (t.t === "(") {
      if (++depth > 32) throw new QueryError("too many parentheses")
      i++
      const e = or()
      if (peek()?.t !== ")") throw new QueryError("a parenthesis isn't closed")
      i++
      depth--
      return e
    }
    if (word("has")) {
      i++
      const k = peek()
      if (!k || (k.t !== "word" && k.t !== "str")) throw new QueryError("has what? (has <key>)")
      i++
      return { k: "has", key: k.v }
    }
    if (t.t !== "word" && t.t !== "str") throw new QueryError(`expected a key, found '${t.v}'`)
    i++
    const op = peek()
    let o: string
    if (op?.t === "op") o = op.v
    else if (op?.t === "word" && op.v.toLowerCase() === "contains") o = "contains"
    else throw new QueryError(`expected = != < <= > >= or contains after '${t.v}'`)
    i++
    const v = peek()
    if (!v || v.t === "(" || v.t === ")" || v.t === "op") throw new QueryError(`expected a value after '${t.v} ${o}'`)
    i++
    const value = v.t === "num" ? Number(v.v) : v.t === "str" ? v.v
      : v.v === "true" ? true : v.v === "false" ? false : v.v === "null" ? null : v.v
    const ref = v.t === "word" ? refOf(v.v) : undefined
    return { k: "cmp", key: t.v, op: o, value, ...(ref !== undefined ? { ref } : {}) }
  }
  const e = or()
  if (i < toks.length) throw new QueryError(`unexpected '${toks[i].v}' in the where`)
  return e
}

/** `this` -> "" and `this.status` -> "status" (the note the view is in, or its key), else undefined: plain text. */
const refOf = (w: string) => { const m = /^this(?:\.(.+))?$/i.exec(w.trim()); return m ? m[1] ?? "" : undefined }

// ---------- values

const WIKI = /^\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|[^[\]]*)?\]\]$/
/** "[[Alice Park|Alice]]" -> "Alice Park"; anything else as it is. */
const unlink = (v: unknown) => (typeof v === "string" ? v.trim().replace(WIKI, "$1").trim() : v)
const stemOf = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "")
const folderOf = (p: string) => p.split("/").slice(0, -1).join("/")
const pad = (n: number) => String(n).padStart(2, "0")
/** ms -> "2026-09-29 18:00" (this machine's time). */
export function stampOf(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A key's value for a file: a frontmatter key, or file / folder / path / updated / created (and `type`, the file's). */
export function valueOf(r: Rec, key: string): unknown {
  switch (key) {
    case "type": if (r.type !== undefined) return r.type; break
    case "file": return stemOf(r.path)
    case "folder": return folderOf(r.path)
    case "path": return r.path
    case "updated": return r.fm.updated ?? stampOf(r.mtime)
    case "created": return r.fm.created ?? stampOf(r.created ? r.created() : r.mtime)
    case "tags": if (r.tags) return r.tags
  }
  if (key in r.fm) return r.fm[key]
  const low = key.toLowerCase()
  const k = Object.keys(r.fm).find((x) => x.toLowerCase() === low)
  return k ? r.fm[k] : undefined
}

const isNum = (v: unknown) => typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()))
const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)

/** Two values in order: numbers as numbers, text without case (and 2 before 10), blanks last. */
export function compare(a: unknown, b: unknown): number {
  if (blank(a) || blank(b)) return blank(a) && blank(b) ? 0 : blank(a) ? 1 : -1
  if (Array.isArray(a)) a = a[0]
  if (Array.isArray(b)) b = b[0]
  if (isNum(a) && isNum(b)) return Number(a) - Number(b)
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a === true) - Number(b === true)
  return byText.compare(String(unlink(a)), String(unlink(b)))
}
/** Text without case, "2" before "10" (one collator: localeCompare with options makes one per comparison). */
const byText = new Intl.Collator("en", { sensitivity: "base", numeric: true })

const same = (a: unknown, b: unknown) => {
  if (a === null || b === null) return blank(a) && blank(b)
  if (typeof a === "boolean" || typeof b === "boolean") return String(a).toLowerCase() === String(b).toLowerCase()
  if (isNum(a) && isNum(b)) return Number(a) === Number(b)
  return String(unlink(a)).toLowerCase() === String(unlink(b)).toLowerCase()
}

type Get = (r: Rec, key: string) => unknown

/** What a where reads besides the file: `this` (the note the view is in: whether a value names it, and its keys), and
 *  a value as its key's declared type compares it (undefined: as it is). */
type WhereEnv = { here?: { is: (v: unknown) => boolean; get: (key: string) => unknown } | null; typed?: (key: string, v: unknown) => unknown }
/** The note itself, as a value to compare with. */
const THIS = Symbol("this")

/** What a comparison compares with: its value, `this`, or each of this note's values of a key (none: blank). */
function wanted(n: { value: unknown; ref?: string }, env: WhereEnv): unknown[] {
  if (n.ref === undefined) return [n.value]
  if (n.ref === "") return [THIS]
  const v = env.here?.get(n.ref)
  return Array.isArray(v) && v.length ? v : [blank(v) ? null : v]
}

function test(n: Node, r: Rec, get: Get, env: WhereEnv = {}): boolean {
  switch (n.k) {
    case "and": return test(n.a, r, get, env) && test(n.b, r, get, env)
    case "or": return test(n.a, r, get, env) || test(n.b, r, get, env)
    case "not": return !test(n.a, r, get, env)
    case "has": return !blank(get(r, n.key))
  }
  const v = get(r, n.key)
  return wanted(n, env)[n.op === "!=" ? "every" : "some"]((w) => one(n.key, n.op, v, w, env))
}

/** One comparison of a file's value with one wanted value (`this`: names the note; else as its key's type, if any). */
function one(key: string, op: string, v: unknown, w: unknown, env: WhereEnv): boolean {
  const vs = Array.isArray(v) ? v : [v]
  if (w === THIS) {
    const is = vs.some((x) => !!env.here?.is(x))
    return op === "!=" ? !is : op === "=" || op === "contains" ? is : false
  }
  const as = (x: unknown) => { const t = env.typed?.(key, x); return t === undefined ? x : t }
  const eq = (x: unknown) => same(as(x), as(w))
  if (op === "!=") return !vs.some(eq)
  if (blank(v)) return w === null && op === "="
  if (op === "=") return vs.some(eq)
  if (op === "contains") {
    const want = String(unlink(w)).toLowerCase()
    return Array.isArray(v) ? v.some((x) => same(x, w)) : String(unlink(v)).toLowerCase().includes(want)
  }
  const c = vs.map((x) => compare(as(x), as(w)))
  return c.some((d) => (op === "<" ? d < 0 : op === "<=" ? d <= 0 : op === ">" ? d > 0 : d >= 0))
}

// ---------- options

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : v === undefined || v === null ? [] : [v])
    .map((x) => String(x).trim()).filter(Boolean)

const label = (k: string) => k === "file" ? "Name"
  : (k.replace(/^(formula|file)\./, "").charAt(0).toUpperCase() + k.replace(/^(formula|file)\./, "").slice(1)).replaceAll("_", " ")

/** A key written the Bases way, as this engine names it: `file.name` is `file` (the name), `file.path` `path`,
 *  `file.folder` `folder`, `note.status` `status`; `formula.x` and other `file.` keys stay as they are. */
export function keyOf(k: string): string {
  const t = k.trim()
  if (t === "file.name" || t === "file.basename" || t === "file.file") return "file"
  if (t === "file.path") return "path"
  if (t === "file.folder") return "folder"
  if (t.startsWith("note.") && t.length > 5) return t.slice(5)
  return t
}
/** The frontmatter key a column writes (moving a card, editing a value), or null when it's computed (a formula, a file
 *  property, the name). */
export const propKey = (k: string): string | null =>
  SPECIAL.includes(k) || k.startsWith("formula.") || k.startsWith("file.") ? null : k

/** A `where` map ({relation: friend, tags: [a, b]}) as a filter: every key must match (a list: any of its values;
 *  `this` and `this.<key>` as in a where's text). */
function whereMap(m: Record<string, unknown>, env: WhereEnv): (r: Rec, get: Get) => boolean {
  return (r, get) => Object.entries(m).every(([k, want]) => {
    const key = keyOf(k), v = get(r, key)
    const ws = (Array.isArray(want) ? want : [want]).flatMap((w) => {
      const ref = typeof w === "string" ? refOf(w) : undefined
      return ref === undefined ? [w ?? null] : wanted({ value: w, ref }, env)
    })
    return ws.some((w) => (w === null ? blank(v) || one(key, "=", v, w, env) : one(key, "=", v, w, env)))
  })
}

/** A sort given as text ("-updated", "file") or the Bases way ({property: file.mtime, direction: DESC}). */
function sortOf(v: unknown): SortKey[] {
  const items = Array.isArray(v) ? v : v === undefined || v === null ? [] : typeof v === "string" ? v.split(",") : [v]
  return items.flatMap((s): SortKey[] => {
    if (s && typeof s === "object" && !Array.isArray(s)) {
      const o = s as Record<string, unknown>
      const key = typeof o.property === "string" ? o.property : typeof o.key === "string" ? o.key : ""
      return key.trim() ? [{ key: keyOf(key), desc: String(o.direction ?? "").toUpperCase() === "DESC" }] : []
    }
    const t = String(s ?? "").trim()
    if (!t) return []
    return [t.startsWith("-") ? { key: keyOf(t.slice(1)), desc: true } : { key: keyOf(t.replace(/^\+/, "")), desc: false }]
  })
}

/** The options checked: throws QueryError on a bad `where`, sort or view. */
export function compile(o: Opts, env: WhereEnv = {}) {
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new QueryError("the query's options must be a map of key: value lines")
  const from = list(o.from).map((f) => f.replace(/^\/+/, "").toLowerCase())
  const types = list(o.type).map((t) => t.toLowerCase())
  const tags = list(o.tags).map((t) => t.replace(/^#/, "").toLowerCase())
  let where: (r: Rec, get: Get) => boolean = () => true
  if (typeof o.where === "string") {
    const n = parseWhere(o.where)
    if (n) where = (r, get) => test(n, r, get, env)
  } else if (o.where && typeof o.where === "object" && !Array.isArray(o.where)) where = whereMap(o.where as Record<string, unknown>, env)
  else if (o.where !== undefined && o.where !== null) throw new QueryError("where is an expression (relation = friend) or a map ({relation: friend})")
  const sort = sortOf(o.sort)
  const view = (o.view === undefined ? "table" : String(o.view)) as View
  if (!VIEWS.includes(view)) throw new QueryError(`view is table, cards, list, board, calendar or map, not '${view}'`)
  // Every match unless a limit is given (the app draws rows as they near the screen); offset: a page past the first.
  const n = Number(o.limit), at = Number(o.offset)
  const limit = o.limit === undefined || o.limit === null || o.limit === "" || !Number.isFinite(n) ? Infinity : Math.max(Math.trunc(n), 1)
  const offset = Number.isFinite(at) ? Math.max(Math.trunc(at), 0) : 0
  // group: a key, or the Bases way ({property: status, direction: DESC}).
  const g = o.group && typeof o.group === "object" && !Array.isArray(o.group) ? o.group as Record<string, unknown> : null
  const groupKey = g ? (typeof g.property === "string" ? g.property : "") : typeof o.group === "string" ? o.group : ""
  const group = groupKey.trim() ? keyOf(groupKey) : null
  const groupDesc = !!g && String(g.direction ?? "").toUpperCase() === "DESC"
  if (view === "board" && !group) throw new QueryError("a board needs a group: the key its columns are (group: status)")
  const date = typeof o.date === "string" && o.date.trim() ? keyOf(o.date) : null
  let month: string | null = null
  if (view === "calendar") {
    const m = o.month === undefined || o.month === null || o.month === "" ? "" : String(o.month).trim()
    if (m && (!MONTH.test(m) || Number(m.slice(5)) < 1 || Number(m.slice(5)) > 12)) throw new QueryError(`month is YYYY-MM, not '${m}'`)
    month = m || null
  }
  const arch = o.archived === undefined || o.archived === null ? false : o.archived === "only" ? "only" : o.archived === true || o.archived === "true" ? true
    : o.archived === false || o.archived === "false" ? false : null
  if (arch === null) throw new QueryError(`archived is true, false or only, not '${String(o.archived)}'`)
  /** Left out for being archived (or, with `only`, for not being). */
  const outByArchive = (r: Rec) => (arch === "only" ? !r.archived : !arch && !!r.archived)
  /** Everything but the archive test. */
  const match = (r: Rec, get: Get) => {
    const low = r.path.toLowerCase()
    if (from.length && !from.some((f) => low.startsWith(f.endsWith("/") ? f : `${f}/`) || low === f)) return false
    if (types.length && !types.includes(String(valueOf(r, "type") ?? "").toLowerCase())) return false
    if (tags.length) {
      // Nested tags count for their parents (`project` matches `project/lighthouse`).
      const has = (r.tags ?? list(r.fm.tags)).map((t) => t.replace(/^#/, "").toLowerCase())
      if (!tags.every((t) => has.some((h) => h === t || h.startsWith(`${t}/`)))) return false
    }
    return where(r, get)
  }
  const keyName = (k: unknown) => (typeof k === "string" ? keyOf(k) : "")
  return {
    match, outByArchive, hidesArchived: arch === false, sort, view, limit, offset, group, groupDesc, groups: list(o.groups), date, month, columns: list(o.columns).map(keyOf),
    title: typeof o.title === "string" ? o.title : "",
    coordinates: keyName(o.coordinates) || "coordinates", markerColor: keyName(o.markerColor), markerIcon: keyName(o.markerIcon),
  }
}

/** The day a value names ("2026-09-27", "2026-09-27 18:00", "2026-09-27T18:00:00Z"), or null. */
export function dayOf(v: unknown): string | null {
  if (Array.isArray(v)) v = v[0]
  const m = typeof v === "string" ? /^(\d{4}-\d{2}-\d{2})(?=$|[ T])/.exec(v.trim()) : null
  return m ? m[1] : null
}

/** A group's name for a value: its text ("" when it has none; a list's values joined). */
export const groupName = (v: unknown) =>
  blank(v) ? "" : Array.isArray(v) ? v.map((x) => String(unlink(x))).join(", ") : String(unlink(v))

/** An order by these keys (blanks last either way), then by path. `types`: the keys' declared types, and `typed` a value
 *  as its type compares it (core/proptypes.ts typedValue). */
export function byKeys<T extends { path: string }>(sort: SortKey[], get: (x: T, key: string) => unknown, types?: Record<string, string>, typed?: Typed) {
  const cmps = sort.map((s) => comparer(types?.[s.key], typed))
  return (a: T, b: T) => {
    for (let i = 0; i < sort.length; i++) {
      const s = sort[i], va = get(a, s.key), vb = get(b, s.key)
      const d = blank(va) || blank(vb) ? compare(va, vb) : cmps[i](va, vb) * (s.desc ? -1 : 1)
      if (d) return d
    }
    return a.path.localeCompare(b.path)
  }
}

/** A value as its declared type compares it (core/proptypes.ts typedValue): undefined leaves it as it is. */
export type Typed = (type: string, v: unknown) => unknown
/** How two values of a key with this declared type compare: as their type has them (dates by time, numbers as
 *  numbers; one that isn't of its type after those that are), text as text (`1.10` after `1.9`), else `compare`. */
export function comparer(type: string | null | undefined, typed?: Typed): (a: unknown, b: unknown) => number {
  if (!type) return compare
  if (type === "text") return (a, b) => (blank(a) || blank(b) ? compare(a, b) : byText.compare(text(unlink(a)), text(unlink(b))))
  if (!typed) return compare
  return (a, b) => {
    const ta = typed(type, a), tb = typed(type, b)
    return ta === undefined || tb === undefined ? compare(a, b) : compare(ta, tb)
  }
}

/** [lat, lon] from a value: a list of two numbers (or numeric texts), "lat, lon", or {lat, lon | lng}; null if none. */
function coordsOf(v: unknown): [number, number] | null {
  let lat: unknown, lon: unknown
  if (Array.isArray(v) && v.length >= 2) [lat, lon] = v
  else if (typeof v === "string") [lat, lon] = v.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim())
  else if (v && typeof v === "object") { const o = v as Record<string, unknown>; lat = o.lat ?? o.latitude; lon = o.lon ?? o.lng ?? o.longitude }
  const a = Number(lat), b = Number(lon)
  if (lat === "" || lon === "" || lat === null || lon === null || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null
  return [a, b]
}

const TINTS = ["red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "gray", "grey"]
/** A pin's colour from a value: an app colour's name (`red`: var(--red), so schemes recolour it), else a CSS colour
 *  (hex, rgb(), hsl(), var(--x), a named one); anything else none. */
export function colorOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (TINTS.includes(t.toLowerCase())) return `var(--${t.toLowerCase() === "grey" ? "gray" : t.toLowerCase()})`
  return /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%a-z/-]+\)|var\(--[\w-]+\)|[a-z]{3,20})$/i.test(t) ? t : undefined
}

/** Extras for a run: the file `this` is (the base, or the note the view is drawn in: AGENTS.md), and the vault's
 *  property types (`of`: a key's, null for none; `value`: core/proptypes.ts typedValue). */
export type RunCtx = { self?: Rec | null; types?: { of: (key: string) => string | null; value: Typed } }

/** Run a query over the files. `now` decides a calendar's default month and Bases' now() and today(). */
export function run(o: Opts, recs: Iterable<Rec>, now = new Date(), ctx: RunCtx = {}): Result {
  const all = [...recs]
  const notes: string[] = []
  const note = (s: string) => { if (!notes.includes(s) && notes.length < 20) notes.push(s) }

  // Bases: links to files, formulas (each worked out once per file), backlinks when asked.
  // (like the vault's links, core/links.ts: a name several files have goes to the closest to the file it's written in)
  const linkable = ctx.self && !all.some((r) => r.path === ctx.self!.path) ? [...all, ctx.self] : all
  const index = linkIndex(linkable.map((r) => ({ value: r, path: r.path, labels: list(r.fm.aliases).map(String) })))
  const resolve = (t: string, from?: string) => index.resolve(t.split("|")[0], from)
  // A key's declared type (frontmatter keys only: file, folder, formulas... are the engine's), and `this` for a where.
  const typeMemo = new Map<string, string | null>()
  const typeOfKey = (k: string) => {
    if (!ctx.types || SPECIAL.includes(k) || k.startsWith("formula.") || k.startsWith("file.")) return null
    if (!typeMemo.has(k)) typeMemo.set(k, ctx.types.of(k))
    return typeMemo.get(k)!
  }
  const self = ctx.self ?? null
  const q = compile(o, {
    here: self && {
      is: (v) => (typeof v === "string" ? resolve(String(unlink(v)))?.path === self.path : false),
      get: (k) => valueOf(self, keyOf(k)),
    },
    typed: (k, v) => { const t = typeOfKey(k); return t ? ctx.types!.value(t, v) : undefined },
  })
  if (!self && (typeof o.where === "string" ? /(^|[\s(=<>!])this(\.|\s|\)|$)/i.test(o.where) : JSON.stringify(o.where ?? "").includes('"this'))) {
    note("`this` is the note the view is in, and there's none here: it matches nothing")
  }
  let back: Map<string, string[]> | null = null
  const backlinks = (r: Rec) => {
    if (!back) {
      back = new Map()
      for (const x of all) for (const t of new Set(x.links?.() ?? [])) {
        const to = resolve(t, x.path)?.path
        if (to && to !== x.path) back.set(to, [...(back.get(to) ?? []), x.path])
      }
    }
    return back.get(r.path) ?? []
  }
  // (a formula that doesn't parse is said so when a view uses it)
  const formulas = new Map<string, ReturnType<typeof parseExpr> | string>()
  const fo = o.formulas && typeof o.formulas === "object" && !Array.isArray(o.formulas) ? o.formulas as Record<string, unknown> : {}
  for (const [name, src] of Object.entries(fo)) {
    try { formulas.set(name, parseExpr(String(src ?? ""))) } catch (e) { formulas.set(name, (e as Error).message) }
  }
  const cache = new Map<Rec, Map<string, V>>()
  const busy = new Set<string>()
  const env: Env = {
    resolve, self: ctx.self ?? null, backlinks, now: now.getTime(),
    formula: (r, name) => {
      let m = cache.get(r)
      if (!m) cache.set(r, m = new Map())
      if (m.has(name)) return m.get(name)!
      if (!formulas.has(name)) { note(`There's no formula ${name}`); m.set(name, null); return null }
      const n = formulas.get(name)!
      let v: V = null
      const key = `${r.path}\0${name}`
      if (typeof n === "string") note(`Formula ${name} isn't worked out: ${n}`)
      else if (!busy.has(key)) {
        busy.add(key)
        try { v = evaluate(n, r, env) } catch (e) {
          if (!(e instanceof ExprError)) throw e
          note(`Formula ${name}: ${e.message}`)
        } finally { busy.delete(key) }
      } else note(`Formula ${name} refers to itself`)
      m.set(name, v)
      return v
    },
  }
  // A key's value as the language has it (for summaries), and as plain data (the rows, sorting, grouping).
  const parsed = new Map<string, ReturnType<typeof parseExpr> | null>()
  const raw = (r: Rec, key: string): V => {
    if (key.startsWith("formula.")) return env.formula(r, key.slice(8))
    if (key.startsWith("file.")) {
      if (!parsed.has(key)) { try { parsed.set(key, parseExpr(key)) } catch { parsed.set(key, null) } }
      const n = parsed.get(key)
      try { return n ? evaluate(n, r, env) : null } catch { return null }
    }
    return wrap(valueOf(r, key))
  }
  const get: Get = (r, key) => (key.startsWith("formula.") || key.startsWith("file.") ? plainOf(raw(r, key)) : valueOf(r, key))

  // Bases filters: the file is in when they're true; one that can't be read is left out (and said so).
  let filter: ((r: Rec) => boolean) | null = null
  if (o.filters !== undefined && o.filters !== null) {
    filter = filterOf(o.filters, env, note) ?? null
  }
  let hits = all.filter((r) => q.match(r, get) && (!filter || filter(r)))
  // Archived files matching are hidden (archived: true shows them); how many is said, so nothing goes missing unseen.
  let archived = q.hidesArchived ? hits.filter((r) => r.archived) : []
  hits = hits.filter((r) => !q.outByArchive(r))
  // A calendar: the files whose date falls in its month.
  let date: string | undefined, month: string | undefined
  if (q.view === "calendar") {
    date = q.date ?? (hits.some((r) => dayOf(get(r, "date"))) ? "date" : "created")
    month = q.month ?? `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
    hits = hits.filter((r) => dayOf(get(r, date!))?.startsWith(`${month}-`))
    archived = archived.filter((r) => dayOf(get(r, date!))?.startsWith(`${month}-`))
  }
  // No columns asked: the name and the keys most of the matches have (up to 4).
  let cols = q.columns
  if (!cols.length) {
    const count = new Map<string, number>()
    for (const r of hits.slice(0, 200)) for (const k of Object.keys(r.fm)) {
      if (!["type", "id", "aliases", "title", "archived"].includes(k)) count.set(k, (count.get(k) ?? 0) + 1)
    }
    cols = ["file", ...[...count].filter(([, c]) => c >= Math.max(1, hits.length / 3)).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k)]
  }
  const sort = q.sort.length ? q.sort : [...(date ? [{ key: date, desc: false }] : []), { key: "file", desc: false }]
  const sortVals = new Map<Rec, Map<string, unknown>>()
  const sv = (r: Rec, k: string) => {
    let m = sortVals.get(r)
    if (!m) sortVals.set(r, m = new Map())
    if (!m.has(k)) m.set(k, get(r, k))
    return m.get(k)
  }
  const map = q.view === "map"
  const keys = [...new Set([...cols, ...(q.group ? [q.group] : []), ...(date ? [date] : []), ...sort.map((s) => s.key)])]
  const types: Record<string, string> = {}
  for (const k of keys) { const t = typeOfKey(k); if (t) types[k] = t }
  hits.sort(byKeys(sort, sv, types, ctx.types?.value))
  const shown = hits.slice(q.offset, q.offset + q.limit)
  let unplaced = 0
  const rowOf = new Map<Row, Rec>()
  const rows: Row[] = shown.map((r) => {
    const row: Row = { path: r.path, title: stemOf(r.path), values: Object.fromEntries(keys.map((k) => [k, get(r, k) ?? null])) }
    if (map) {
      const c = coordsOf(get(r, q.coordinates))
      if (c) {
        const color = q.markerColor ? colorOf(get(r, q.markerColor)) : undefined
        const icon = q.markerIcon ? get(r, q.markerIcon) : undefined
        row.pin = { lat: c[0], lon: c[1], ...(color ? { color } : {}), ...(typeof icon === "string" && /^[a-z0-9-]{1,40}$/i.test(icon) ? { icon } : {}) }
      } else unplaced++
    }
    rowOf.set(row, r)
    return row
  })
  const groups: Group[] = []
  if (date) {
    // A calendar: a group per day, in order.
    const by = new Map<string, Row[]>()
    for (const r of rows) {
      const d = dayOf(r.values[date])!
      by.set(d, [...(by.get(d) ?? []), r])
    }
    for (const d of [...by.keys()].sort()) groups.push({ name: d, rows: by.get(d)! })
  } else if (q.group) {
    const by = new Map<string, Group>()
    for (const r of rows) {
      const v = r.values[q.group]
      const name = groupName(v)
      const g = by.get(name) ?? { name: name || null, value: blank(v) ? null : v, rows: [] }
      g.rows.push(r)
      by.set(name, g)
    }
    // A board shows the groups it lists even when nobody is in them, and always "No value" (a place to clear it).
    if (q.view === "board") {
      for (const name of q.groups) if (![...by.keys()].some((k) => same(k, name))) by.set(name, { name, value: name, rows: [] })
      if (!by.has("")) by.set("", { name: null, value: null, rows: [] })
    }
    // The listed ones first, in their order; the rest after, in order (Bases' direction: DESC, the other way); no value last.
    const rank = (k: string) => { const i = q.groups.findIndex((g) => k && same(k, g)); return i < 0 ? q.groups.length : i }
    const dir = q.groupDesc ? -1 : 1
    for (const k of [...by.keys()].sort((a, b) => rank(a) - rank(b) || (!a || !b ? compare(a, b) : compare(a, b) * dir))) groups.push(by.get(k)!)
  } else groups.push({ name: null, rows })

  // Summaries: a column's values in the rows shown (and in each group's, when there are several).
  let summaries: Summary[] | undefined
  const so = o.summaries && typeof o.summaries === "object" && !Array.isArray(o.summaries) ? o.summaries as Record<string, unknown> : {}
  const custom = o.summaryFormulas && typeof o.summaryFormulas === "object" ? o.summaryFormulas as Record<string, unknown> : {}
  const wanted = Object.entries(so).map(([k, name]) => ({ key: keyOf(k), name: String(name ?? "").trim() })).filter((s) => s.name)
  if (wanted.length) {
    const fns = new Map<string, ((vals: V[]) => V) | null>()
    for (const s of wanted) {
      if (fns.has(s.name)) continue
      const builtin = SUMMARIES.find((x) => x.toLowerCase() === s.name.toLowerCase()) ?? (["mean", "avg", "total"].includes(s.name.toLowerCase()) ? s.name : null)
      if (builtin) { fns.set(s.name, (vals) => summary(builtin, vals) ?? null); continue }
      const src = Object.hasOwn(custom, s.name) ? String(custom[s.name] ?? "") : s.name
      try {
        const n = parseExpr(src)
        fns.set(s.name, (vals) => { try { return evaluate(n, null, env, { values: vals }) } catch (e) { note(`Summary ${s.name}: ${(e as Error).message}`); return null } })
      } catch (e) {
        fns.set(s.name, null)
        note(`Summary ${s.name} isn't worked out: ${(e as Error).message}`)
      }
    }
    const sum = (rs: Row[]) => Object.fromEntries(wanted.map((s) => {
      const fn = fns.get(s.name)
      return [s.key, fn ? plainOf(fn(rs.map((r) => raw(rowOf.get(r)!, s.key)))) : null]
    }))
    const total = sum(rows)
    summaries = wanted.map((s) => ({ key: s.key, name: s.name, value: total[s.key] }))
    if (groups.length > 1) for (const g of groups) g.summaries = sum(g.rows)
  }

  // Labels: Bases' display names (properties: {key: {displayName}}), else the key's.
  const props = o.properties && typeof o.properties === "object" && !Array.isArray(o.properties) ? o.properties as Record<string, unknown> : {}
  const labels = new Map<string, string>()
  for (const [k, v] of Object.entries(props)) {
    const d = v && typeof v === "object" ? (v as Record<string, unknown>).displayName : undefined
    if (typeof d === "string" && d.trim()) labels.set(keyOf(k), d.trim())
  }
  return {
    title: q.title, view: q.view, columns: cols.map((k) => ({ key: k, label: labels.get(k) ?? label(k) })), groups, total: hits.length, shown: rows.length, ...(q.offset ? { offset: q.offset } : {}), sort,
    ...(q.group ? { group: q.group } : {}), ...(date ? { date, month } : {}), ...(summaries ? { summaries } : {}),
    ...(map ? { coordinates: q.coordinates, unplaced } : {}), ...(notes.length ? { notes } : {}), ...(archived.length ? { archivedHidden: archived.length } : {}), ...(Object.keys(types).length ? { types } : {}),
  }
}

/** A Bases filter (an expression, or {and | or | not: [filters]}) as a test; one that can't be read is left out of its
 *  group, and `note` says why. null: nothing to test. */
function filterOf(f: unknown, env: Env, note: (s: string) => void, depth = 0): ((r: Rec) => boolean) | null {
  if (depth > 32) { note("The filters nest too deeply"); return null }
  if (typeof f === "string" || typeof f === "number" || typeof f === "boolean") {
    const src = String(f)
    let n: ReturnType<typeof parseExpr>
    try { n = parseExpr(src) } catch (e) { note(`Filter ${src} is left out: ${(e as Error).message}`); return null }
    return (r) => {
      try { return truthy(evaluate(n, r, env)) } catch (e) {
        if (!(e instanceof ExprError)) throw e
        note(`Filter ${src}: ${e.message}`)
        return false
      }
    }
  }
  if (f && typeof f === "object" && !Array.isArray(f)) {
    const o = f as Record<string, unknown>
    const kind = ["and", "or", "not"].find((k) => k in o)
    if (!kind) { note(`A filter group is and, or or not, not ${Object.keys(o).join(", ") || "empty"}`); return null }
    const items = Array.isArray(o[kind]) ? o[kind] as unknown[] : o[kind] === undefined || o[kind] === null ? [] : [o[kind]]
    const tests = items.map((x) => filterOf(x, env, note, depth + 1)).filter((x): x is (r: Rec) => boolean => !!x)
    if (!tests.length) return null
    if (kind === "and") return (r) => tests.every((t) => t(r))
    if (kind === "or") return (r) => tests.some((t) => t(r))
    return (r) => !tests.some((t) => t(r))
  }
  if (Array.isArray(f)) return filterOf({ and: f }, env, note, depth + 1)
  note("A filter is an expression or a group (and, or, not)")
  return null
}

// ---------- as text

/** A value as plain text, for a Markdown table cell or a card line. */
export function text(v: unknown): string {
  if (blank(v)) return ""
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(", ")
  if (typeof v === "boolean") return v ? "yes" : "no"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

const cell = (s: string) => s.replaceAll("|", "\\|").replace(/\s*\n\s*/g, " ")

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
/** "2026-09" -> "September 2026". */
export const monthName = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`

/** A summary's value as text: a number to two decimals at most. */
export function summaryText(v: unknown): string {
  if (typeof v === "number") return String(Math.round(v * 100) / 100)
  return text(v)
}

/** The result as Markdown for agents: a table per group, a section per board column, bullets by date or place. What was
 *  left out (a filter that doesn't parse) comes first, in italics. */
export function markdown(res: Result, level = 2): string {
  const h = (n: number) => "#".repeat(Math.min(level + n, 6))
  const sumRow = (by: Record<string, unknown> | undefined) => {
    if (!res.summaries?.length || !by) return null
    return `| ${res.columns.map((c) => {
      const s = res.summaries!.find((x) => x.key === c.key)
      return s ? cell(`**${s.name}** ${summaryText(by[c.key])}`) : ""
    }).join(" | ")} |`
  }
  const total = Object.fromEntries((res.summaries ?? []).map((s) => [s.key, s.value]))
  const table = (rows: Row[], sums?: Record<string, unknown>) => {
    const head = `| ${res.columns.map((c) => cell(c.label)).join(" | ")} |\n| ${res.columns.map(() => "---").join(" | ")} |`
    const foot = sumRow(sums)
    return [head, ...rows.map((r) => `| ${res.columns.map((c) => cell(c.key === "file" ? `[[${r.title}]]` : text(r.values[c.key]))).join(" | ")} |`), ...(foot ? [foot] : [])].join("\n")
  }
  // A file on one line: its [[name]], then its other columns' values (not the one its place already says).
  const line = (r: Row, skip?: string) =>
    [`[[${r.title}]]`, ...res.columns.filter((c) => c.key !== "file" && c.key !== skip).map((c) => cell(text(r.values[c.key]))).filter(Boolean)].join(" · ")
  const parts = [`${h(0)} ${res.title || "Query"}`]
  for (const n of res.notes ?? []) parts.push(`_(${n})_`)
  if (res.archivedHidden) parts.push(`_(${res.archivedHidden} archived ${res.archivedHidden === 1 ? "file" : "files"} hidden: \`archived: true\` shows them)_`)
  if (res.view === "calendar") {
    parts.push(`${h(1)} ${monthName(res.month!)}`)
    if (!res.total) parts.push("_Nothing this month._")
    else parts.push(res.groups.flatMap((g) => g.rows.map((r) => `- ${g.name} · ${line(r, res.date)}`)).join("\n"))
  } else if (!res.total) parts.push("_Nothing matches._")
  else if (res.view === "board") {
    for (const g of res.groups) {
      parts.push(`${h(1)} ${g.name ?? "No value"} (${g.rows.length})`)
      parts.push(g.rows.length ? g.rows.map((r) => `- ${line(r, res.group ?? undefined)}`).join("\n") : "_Empty._")
    }
  } else if (res.view === "map") {
    const rows = res.groups.flatMap((g) => g.rows)
    const placed = rows.filter((r) => r.pin)
    if (placed.length) parts.push(placed.map((r) => `- ${line(r, res.coordinates)} · ${r.pin!.lat}, ${r.pin!.lon}`).join("\n"))
    if (res.unplaced) parts.push(`_${res.unplaced} without a place on the map (no ${res.coordinates}): ${rows.filter((r) => !r.pin).map((r) => `[[${r.title}]]`).join(", ")}_`)
  } else {
    for (const g of res.groups) {
      if (res.groups.length > 1 || g.name) parts.push(`${h(1)} ${g.name ?? "No value"}`)
      parts.push(table(g.rows, res.groups.length > 1 ? g.summaries : total))
    }
    if (res.groups.length > 1 && res.summaries?.length) {
      parts.push(`Summaries: ${res.summaries.map((s) => `${res.columns.find((c) => c.key === s.key)?.label ?? s.key} ${s.name.toLowerCase()} ${summaryText(s.value)}`).join(" · ")}`)
    }
  }
  const from = res.offset ?? 0
  if (res.total > res.shown) parts.push(`_${res.shown ? `${from + 1}-${from + res.shown}` : "None"} of ${res.total} shown${from + res.shown < res.total ? `; more: offset ${from + res.shown}` : ""}._`)
  return parts.join("\n\n")
}
