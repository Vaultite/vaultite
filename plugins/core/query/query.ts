
import { linkIndex } from "../../../core/links.ts"
import {
  blank, byText, compare, evaluate, type Env, ExprError, type Node as Expr, parse as parseExpr, plainOf, same, summary, SUMMARIES, truthy, unlink, type V, wrap,
} from "./expr.ts"
import { obj } from "./bases.ts"

export type Opts = Record<string, unknown>
export type Rec = { path: string; fm: Record<string, unknown>; mtime: number; created?: () => number; tags?: string[]; type?: string | null; archived?: boolean
  size?: number; links?: () => string[]; embeds?: () => string[] }
export type Column = { key: string; label: string }
export type Pin = { lat: number; lon: number; color?: string; icon?: string }
export type Row = { path: string; title: string; values: Record<string, unknown>; pin?: Pin
  image?: string }
export type Group = { name: string | null; value?: unknown; rows: Row[]
  summaries?: Record<string, unknown> }
export type Summary = { key: string; name: string; value: unknown }
type SortKey = { key: string; desc: boolean }
export type View = "table" | "cards" | "list" | "board" | "calendar" | "map"
export type Result = {
  title: string; view: View; columns: Column[]; groups: Group[]; total: number; shown: number
  offset?: number
  sort: SortKey[]
  group?: string | null
  allGroups?: { name: string | null; value: unknown; n: number; shown?: boolean }[]
  date?: string; month?: string
  summaries?: Summary[]
  notes?: string[]
  archivedHidden?: number
  coordinates?: string; unplaced?: number
  cards?: { size?: number; fit?: "cover" | "contain"; ratio?: number }
  views?: { name: string; type: string }[]; current?: number
  types?: Record<string, string>
  keys?: string[]
}

export class QueryError extends Error {}

const SPECIAL = ["file", "folder", "path", "updated", "created"]
export const VIEWS: View[] = ["table", "cards", "list", "board", "calendar", "map"]
const MONTH = /^(\d{4})-(\d{2})$/

type Tok = { t: "word" | "str" | "num" | "op" | "(" | ")"; v: string }
type Node =
  | { k: "and" | "or"; a: Node; b: Node }
  | { k: "not"; a: Node }
  | { k: "has"; key: string }
  | { k: "cmp"; key: string; op: string; value: string | number | boolean | null
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

const refOf = (w: string) => { const m = /^this(?:\.(.+))?$/i.exec(w.trim()); return m ? m[1] ?? "" : undefined }

function exprOf(n: Node): Expr {
  switch (n.k) {
    case "and": case "or": return { k: "bin", op: n.k === "and" ? "&&" : "||", a: exprOf(n.a), b: exprOf(n.b) }
    case "not": return { k: "un", op: "!", a: exprOf(n.a) }
    case "has": return { k: "has", a: { k: "key", name: n.key } }
  }
  return { k: "loose", op: n.op, a: { k: "key", name: n.key }, b: wantOf(n.value, n.ref) }
}
const wantOf = (value: unknown, ref?: string): Expr =>
  ref === undefined ? { k: "lit", v: (value ?? null) as V } : ref === "" ? { k: "id", name: "this" } : { k: "key", name: keyOf(ref), self: true }

function mapExpr(m: Record<string, unknown>): Expr {
  const all = (xs: Expr[], op: "&&" | "||"): Expr => (xs.length ? xs.reduce((a, b) => ({ k: "bin", op, a, b })) : { k: "lit", v: op === "&&" })
  return all(Object.entries(m).map(([k, want]) => all((Array.isArray(want) ? want : [want]).map((w) =>
    ({ k: "loose", op: "=", a: { k: "key", name: keyOf(k) }, b: wantOf(w, typeof w === "string" ? refOf(w) : undefined) })), "||")), "&&")
}

const stemOf = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "")
const folderOf = (p: string) => p.split("/").slice(0, -1).join("/")
const pad = (n: number) => String(n).padStart(2, "0")
export function stampOf(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

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

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : v === undefined || v === null ? [] : [v])
    .map((x) => String(x).trim()).filter(Boolean)

export const label = (k: string) => k === "file" ? "Name"
  : (k.replace(/^(formula|file)\./, "").charAt(0).toUpperCase() + k.replace(/^(formula|file)\./, "").slice(1)).replaceAll("_", " ")

export function keyOf(k: string): string {
  const t = k.trim()
  if (t === "file.name" || t === "file.basename" || t === "file.file") return "file"
  if (t === "file.path") return "path"
  if (t === "file.folder") return "folder"
  if (t.startsWith("note.") && t.length > 5) return t.slice(5)
  return t
}
export const propKey = (k: string): string | null =>
  SPECIAL.includes(k) || k.startsWith("formula.") || k.startsWith("file.") ? null : k

export function sortOf(v: unknown): SortKey[] {
  const items = Array.isArray(v) ? v : v === undefined || v === null ? [] : typeof v === "string" ? v.split(",") : [v]
  return items.flatMap((s): SortKey[] => {
    const o = obj(s)
    if (o) {
      const key = typeof o.property === "string" ? o.property : typeof o.key === "string" ? o.key : ""
      return key.trim() ? [{ key: keyOf(key), desc: String(o.direction ?? "").toUpperCase() === "DESC" }] : []
    }
    const t = String(s ?? "").trim()
    if (!t) return []
    return [t.startsWith("-") ? { key: keyOf(t.slice(1)), desc: true } : { key: keyOf(t.replace(/^\+/, "")), desc: false }]
  })
}

export function compile(o: Opts) {
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new QueryError("the query's options must be a map of key: value lines")
  const from = list(o.from).map((f) => f.replace(/^\/+/, "").toLowerCase())
  const types = list(o.type).map((t) => t.toLowerCase())
  const tags = list(o.tags).map((t) => t.replace(/^#/, "").toLowerCase())
  let where: Expr | null = null
  const whereMap = obj(o.where)
  if (typeof o.where === "string") {
    const n = parseWhere(o.where)
    if (n) where = exprOf(n)
  } else if (whereMap) where = mapExpr(whereMap)
  else if (o.where !== undefined && o.where !== null) throw new QueryError("where is an expression (relation = friend) or a map ({relation: friend})")
  const sort = sortOf(o.sort)
  const asked = o.view === undefined ? "table" : String(o.view), view = VIEWS.find((v) => v === asked)
  if (!view) throw new QueryError(`view is table, cards, list, board, calendar or map, not '${asked}'`)
  const n = Number(o.limit), at = Number(o.offset)
  const limit = o.limit === undefined || o.limit === null || o.limit === "" || !Number.isFinite(n) ? Infinity : Math.max(Math.trunc(n), 1)
  const offset = Number.isFinite(at) ? Math.max(Math.trunc(at), 0) : 0
  const g = obj(o.group)
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
  const outByArchive = (r: Rec) => (arch === "only" ? !r.archived : !arch && !!r.archived)
  const inScope = (r: Rec) => {
    const low = r.path.toLowerCase()
    if (from.length && !from.some((f) => low.startsWith(f.endsWith("/") ? f : `${f}/`) || low === f)) return false
    if (types.length && !types.includes(String(valueOf(r, "type") ?? "").toLowerCase())) return false
    if (tags.length) {
      const has = (r.tags ?? list(r.fm.tags)).map((t) => t.replace(/^#/, "").toLowerCase())
      if (!tags.every((t) => has.some((h) => h === t || h.startsWith(`${t}/`)))) return false
    }
    return true
  }
  const keyName = (k: unknown) => (typeof k === "string" ? keyOf(k) : "")
  return {
    inScope, where, outByArchive, hidesArchived: arch === false, sort, view, limit, offset, group, groupDesc, groupOrder: orderOf(o.groupOrder), date, month, columns: list(o.columns).map(keyOf),
    title: typeof o.title === "string" ? o.title : "",
    coordinates: keyName(o.coordinates) || "coordinates", markerColor: keyName(o.markerColor), markerIcon: keyName(o.markerIcon),
    image: keyName(o.image), cards: cardLook(o),
  }
}

const FITS = ["contain", "cover"] as const

function cardLook(o: Opts): { size?: number; fit?: "cover" | "contain"; ratio?: number } | undefined {
  const size = Number(o.cardSize), ratio = Number(o.imageAspectRatio), fit = FITS.find((f) => f === o.imageFit)
  const out = {
    ...(size >= 80 && size <= 800 ? { size: Math.round(size) } : {}),
    ...(fit ? { fit } : {}),
    ...(ratio >= 0.1 && ratio <= 4 ? { ratio } : {}),
  }
  return Object.keys(out).length ? out : undefined
}

export function dayOf(v: unknown): string | null {
  if (Array.isArray(v)) v = v[0]
  const m = typeof v === "string" ? /^(\d{4}-\d{2}-\d{2})(?=$|[ T])/.exec(v.trim()) : null
  return m ? m[1] : null
}

const orderOf = (v: unknown): { name: string | null; value: unknown }[] | null =>
  Array.isArray(v) ? v.map((x) => (blank(x) ? { name: null, value: null } : { name: groupName(x), value: x })) : null

export const groupName = (v: unknown) =>
  blank(v) ? "" : Array.isArray(v) ? v.map((x) => String(unlink(x))).join(", ") : String(unlink(v))

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

export type Typed = (type: string, v: unknown) => unknown
export function comparer(type: string | null | undefined, typed?: Typed): (a: unknown, b: unknown) => number {
  if (!type) return compare
  if (type === "text") return (a, b) => (blank(a) || blank(b) ? compare(a, b) : byText.compare(text(unlink(a)), text(unlink(b))))
  if (!typed) return compare
  return (a, b) => {
    const ta = typed(type, a), tb = typed(type, b)
    return ta === undefined || tb === undefined ? compare(a, b) : compare(ta, tb)
  }
}

function coordsOf(v: unknown): [number, number] | null {
  let lat: unknown, lon: unknown
  if (Array.isArray(v) && v.length >= 2) [lat, lon] = v
  else if (typeof v === "string") [lat, lon] = v.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim())
  else if (obj(v)) { const o = obj(v) ?? {}; lat = o.lat ?? o.latitude; lon = o.lon ?? o.lng ?? o.longitude }
  const a = Number(lat), b = Number(lon)
  if (lat === "" || lon === "" || lat === null || lon === null || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null
  return [a, b]
}

const TINTS = ["red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "gray", "grey"]
export function colorOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (TINTS.includes(t.toLowerCase())) return `var(--${t.toLowerCase() === "grey" ? "gray" : t.toLowerCase()})`
  return /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%a-z/-]+\)|var\(--[\w-]+\)|[a-z]{3,20})$/i.test(t) ? t : undefined
}

export type RunCtx = { self?: Rec | null; types?: { of: (key: string) => string | null; value: Typed } }

export function run(o: Opts, recs: Iterable<Rec>, now = new Date(), ctx: RunCtx = {}): Result {
  const all = [...recs]
  const notes: string[] = []
  const note = (s: string) => { if (!notes.includes(s) && notes.length < 20) notes.push(s) }

  const linkable = ctx.self && !all.some((r) => r.path === ctx.self!.path) ? [...all, ctx.self] : all
  const index = linkIndex(linkable.map((r) => ({ value: r, path: r.path, labels: list(r.fm.aliases).map(String) })))
  const resolve = (t: string, from?: string) => index.resolve(t.split("|")[0], from)
  const typeMemo = new Map<string, string | null>()
  const typeOfKey = (k: string) => {
    if (!ctx.types || SPECIAL.includes(k) || k.startsWith("formula.") || k.startsWith("file.")) return null
    if (!typeMemo.has(k)) typeMemo.set(k, ctx.types.of(k))
    return typeMemo.get(k)!
  }
  const q = compile(o)
  if (!ctx.self && (typeof o.where === "string" ? /(^|[\s(=<>!])this(\.|\s|\)|$)/i.test(o.where) : JSON.stringify(o.where ?? "").includes('"this'))) {
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
  const formulas = new Map<string, ReturnType<typeof parseExpr> | string>()
  const fo = obj(o.formulas) ?? {}
  for (const [name, src] of Object.entries(fo)) {
    try { formulas.set(name, parseExpr(String(src ?? ""))) } catch (e) { formulas.set(name, (e instanceof Error ? e.message : String(e))) }
  }
  const cache = new Map<Rec, Map<string, V>>()
  const busy = new Set<string>()
  const env: Env = {
    resolve, self: ctx.self ?? null, backlinks, now: now.getTime(),
    key: (r, k) => get(r, k),
    typed: (k, v) => { const t = typeOfKey(k); return t ? ctx.types!.value(t, v) : undefined },
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
  const get = (r: Rec, key: string): unknown => (key.startsWith("formula.") || key.startsWith("file.") ? plainOf(raw(r, key)) : valueOf(r, key))

  let filter: ((r: Rec) => boolean) | null = null
  if (o.filters !== undefined && o.filters !== null) {
    filter = filterOf(o.filters, env, note) ?? null
  }
  const where = q.where
  let hits = all.filter((r) => q.inScope(r) && (!where || truthy(evaluate(where, r, env))) && (!filter || filter(r)))
  let archived = q.hidesArchived ? hits.filter((r) => r.archived) : []
  hits = hits.filter((r) => !q.outByArchive(r))
  let date: string | undefined, month: string | undefined
  if (q.view === "calendar") {
    date = q.date ?? (hits.some((r) => dayOf(get(r, "date"))) ? "date" : "created")
    month = q.month ?? `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
    hits = hits.filter((r) => dayOf(get(r, date!))?.startsWith(`${month}-`))
    archived = archived.filter((r) => dayOf(get(r, date!))?.startsWith(`${month}-`))
  }
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
    if (q.view === "cards" && q.image) {
      const v = get(r, q.image), first = Array.isArray(v) ? v[0] : v
      if (typeof first === "string" && first.trim()) row.image = first.trim()
    }
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
  let allGroups: Result["allGroups"]
  if (date) {
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
    const dir = q.groupDesc ? -1 : 1
    const auto = [...by.keys()].sort((a, b) => (!a || !b ? compare(a, b) : compare(a, b) * dir))
    const order = q.groupOrder
    if (order) {
      const picked = new Set<string>(), listed: NonNullable<Result["allGroups"]> = []
      for (const { name, value } of order) {
        const k = name === null ? "" : auto.find((x) => x && same(x, name)) ?? name
        if (picked.has(k.toLowerCase())) continue
        picked.add(k.toLowerCase())
        const g = by.get(k)
        listed.push({ name: k || null, value: g ? g.value ?? null : value, n: g?.rows.length ?? 0, shown: true })
        if (g) groups.push(g)
        else if (q.view === "board") groups.push({ name: k || null, value, rows: [] })
      }
      const rest = auto.filter((k) => !picked.has(k.toLowerCase())).map((k) => by.get(k)!)
      allGroups = [...listed, ...rest.map((g) => ({ name: g.name, value: g.value ?? null, n: g.rows.length, shown: false }))]
    } else {
      if (q.view === "board" && !by.has("")) auto.push("")
      for (const k of auto) groups.push(by.get(k) ?? { name: null, value: null, rows: [] })
      allGroups = groups.map((g) => ({ name: g.name, value: g.value ?? null, n: g.rows.length }))
    }
  } else groups.push({ name: null, rows })

  let summaries: Summary[] | undefined
  const so = obj(o.summaries) ?? {}
  const custom = obj(o.summaryFormulas) ?? {}
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
        fns.set(s.name, (vals) => { try { return evaluate(n, null, env, { values: vals }) } catch (e) { note(`Summary ${s.name}: ${(e instanceof Error ? e.message : String(e))}`); return null } })
      } catch (e) {
        fns.set(s.name, null)
        note(`Summary ${s.name} isn't worked out: ${(e instanceof Error ? e.message : String(e))}`)
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

  const props = obj(o.properties) ?? {}
  const labels = new Map<string, string>()
  for (const [k, v] of Object.entries(props)) {
    const d = obj(v)?.displayName
    if (typeof d === "string" && d.trim()) labels.set(keyOf(k), d.trim())
  }
  let allKeys: string[] | undefined
  if (o.allKeys) {
    const n = new Map<string, number>()
    for (const r of hits) for (const k of Object.keys(r.fm)) n.set(k, (n.get(k) ?? 0) + 1)
    allKeys = [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 300).map(([k]) => k)
  }
  return {
    title: q.title, view: q.view, columns: cols.map((k) => ({ key: k, label: labels.get(k) ?? label(k) })), groups, total: hits.length, shown: groups.reduce((n, g) => n + g.rows.length, 0), ...(q.offset ? { offset: q.offset } : {}), sort,
    ...(q.group ? { group: q.group } : {}), ...(allGroups ? { allGroups } : {}), ...(date ? { date, month } : {}), ...(summaries ? { summaries } : {}),
    ...(map ? { coordinates: q.coordinates, unplaced } : {}), ...(q.view === "cards" && q.cards ? { cards: q.cards } : {}), ...(notes.length ? { notes } : {}), ...(archived.length ? { archivedHidden: archived.length } : {}), ...(Object.keys(types).length ? { types } : {}),
    ...(allKeys ? { keys: allKeys } : {}),
  }
}

function filterOf(f: unknown, env: Env, note: (s: string) => void, depth = 0): ((r: Rec) => boolean) | null {
  if (depth > 32) { note("The filters nest too deeply"); return null }
  if (typeof f === "string" || typeof f === "number" || typeof f === "boolean") {
    const src = String(f)
    let n: ReturnType<typeof parseExpr>
    try { n = parseExpr(src) } catch (e) { note(`Filter ${src} is left out: ${(e instanceof Error ? e.message : String(e))}`); return null }
    return (r) => {
      try { return truthy(evaluate(n, r, env)) } catch (e) {
        if (!(e instanceof ExprError)) throw e
        note(`Filter ${src}: ${e.message}`)
        return false
      }
    }
  }
  const o = obj(f)
  if (o) {
    const kind = ["and", "or", "not"].find((k) => k in o)
    if (!kind) { note(`A filter group is and, or or not, not ${Object.keys(o).join(", ") || "empty"}`); return null }
    const given = o[kind], items: unknown[] = Array.isArray(given) ? given : given === undefined || given === null ? [] : [given]
    const tests = items.flatMap((x) => { const t = filterOf(x, env, note, depth + 1); return t ? [t] : [] })
    if (!tests.length) return null
    if (kind === "and") return (r) => tests.every((t) => t(r))
    if (kind === "or") return (r) => tests.some((t) => t(r))
    return (r) => !tests.some((t) => t(r))
  }
  if (Array.isArray(f)) return filterOf({ and: f }, env, note, depth + 1)
  note("A filter is an expression or a group (and, or, not)")
  return null
}

export function text(v: unknown): string {
  if (blank(v)) return ""
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(", ")
  if (typeof v === "boolean") return v ? "yes" : "no"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

const cell = (s: string) => s.replaceAll("|", "\\|").replace(/\s*\n\s*/g, " ")

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
export const monthName = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`

export function summaryText(v: unknown): string {
  if (typeof v === "number") return String(Math.round(v * 100) / 100)
  return text(v)
}

export function rowsOf(res: Result, links = false): string[][] {
  const name = (r: Row) => (links ? `[[${r.title}]]` : r.title)
  return [res.columns.map((c) => c.label), ...res.groups.flatMap((g) => g.rows.map((r) => res.columns.map((c) => (c.key === "file" ? name(r) : text(r.values[c.key])))))]
}

export const csvText = (rows: string[][]) => rows.map((r) => r.map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(",")).join("\r\n") + "\r\n"

export const markdownRows = (rows: string[][]) =>
  [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n")

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
