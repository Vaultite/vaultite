import { HTTPError } from "./plugins.ts"
import { highlighter, lineFinder, matches, type Node, parse, type SearchDoc, SearchError } from "./searchquery.ts"
import { type Entry, type Item, ms, sortBy, stemOf, type Vault } from "./vault.ts"
import { chars, context, DISK, type Indexed, indexes, refresh, textsOf } from "./files.ts"

export const SORTS: Record<string, [key: (r: Item) => unknown, reverse: boolean]> = {
  relevance: [(r) => [-r.score, -r.mtime], false],
  name: [(r) => [String(r.title).toLowerCase(), r.path], false],
  "name-desc": [(r) => [String(r.title).toLowerCase(), r.path], true],
  modified: [(r) => r.mtime, true],
  "modified-old": [(r) => r.mtime, false],
  created: [(r) => r.created, true],
  "created-old": [(r) => r.created, false],
}

type SearchOpts = { lines?: number; folder?: string; path?: string; only?: Set<string>; matchCase?: boolean; sort?: string; context?: number; offset?: number; total?: "files" | "lines" }
type Found = { item: Item; body?: string; from: number }
type Cand = { rel: string; name: string; low: string; mtime: number; created: number; archived: boolean; doc?: SearchDoc; from: number; f?: Indexed }
type Shower = ReturnType<typeof shower>

function queryOf(q: string, matchCase?: boolean): Node {
  try { return parse(q, { matchCase }) } catch (e) {
    if (e instanceof SearchError) throw new HTTPError(400, e.message)
    throw e
  }
}

function lineAt(text: string, n: number) {
  let at = 0
  for (let i = 0; i < n; i++) { const nl = text.indexOf("\n", at); if (nl < 0) return ""; at = nl + 1 }
  const end = text.indexOf("\n", at)
  return text.slice(at, end < 0 ? text.length : end)
}

function shower(node: Node, opts: SearchOpts) {
  const marks = highlighter(node, "text"), finder = lineFinder(node)
  const around = Math.min(opts.context ?? 0, 5)
  return {
    count: finder.count,
    show(item: Item, body: string, from: number) {
      const hits = finder.lines(body)
      if (!opts.lines) { item.context ||= hits.length ? context(lineAt(body, hits[0]), marks) : ""; return }
      const lines = body.split("\n")
      item.count = (item.count ?? 0) + hits.length
      const hit = new Set(hits), shown = new Set<number>()
      const matched: { line: number; text: string; ctx?: true }[] = []
      for (const i of hits.slice(0, opts.lines)) {
        for (let k = Math.max(0, i - around); k <= Math.min(lines.length - 1, i + around); k++) {
          if (shown.has(k)) continue
          shown.add(k)
          matched.push({ line: from + k + 1, text: chars(lines[k].trim(), 300), ...(hit.has(k) ? {} : { ctx: true as const }) })
        }
      }
      if (!item.matches?.length) item.context = context(hits.length ? lines[hits[0]] : "", marks)
      item.matches = [...item.matches ?? [], ...matched.sort((x, y) => x.line - y.line)]
    },
  }
}

const docOf = (rel: string, e: Entry): SearchDoc =>
  ({ name: stemOf(rel), file: rel.slice(rel.lastIndexOf("/") + 1), path: rel, text: e.body, tags: e.tags, props: e.fm, get type() { return e.type } })

function namesOf(order: Cand[]) {
  if (order.some((c) => c.name.includes("\n"))) return { names: null, lows: "", starts: [] }
  const starts: number[] = []
  let at = 0
  for (const c of order) { starts.push(at); at += c.low.length + 1 }
  return { names: order.map((c) => c.name).join("\n"), lows: order.map((c) => c.low).join("\n"), starts }
}
function linesWith(lows: string, starts: number[], s: string): number[] {
  const out: number[] = []
  for (let at = lows.indexOf(s), line = 0; at >= 0; at = lows.indexOf(s, at + 1)) {
    while (line + 1 < starts.length && starts[line + 1] <= at) line++
    if (out[out.length - 1] !== line) out.push(line)
  }
  return out
}
function skipper(vault: Vault, opts: SearchOpts) {
  const folder = (opts.folder ?? "").replace(/^\/+|\/+$/g, "")
  const excluded = folder && vault.excluded(`${folder}/`) ? () => false : (rel: string) => vault.excluded(rel)
  return (rel: string) => (folder && !rel.startsWith(`${folder}/`)) || (opts.only && !opts.only.has(rel)) || (opts.path ? rel !== opts.path : excluded(rel))
}
type Order = { key: string; order: Cand[]; names: string | null; lows: string; starts: number[] }
const orders = new WeakMap<Vault, Order>()
function orderOf(vault: Vault, opts: SearchOpts, version: string): Order {
  const key = JSON.stringify([opts.folder, opts.path, opts.only && [...opts.only], opts.sort, version])
  const had = orders.get(vault)
  if (had?.key === key) return had
  const skip = skipper(vault, opts), out: Cand[] = []
  for (const [rel, e] of vault.entries) {
    if (!skip(rel)) out.push({ rel, name: stemOf(rel), low: stemOf(rel).toLowerCase(), mtime: ms(e.stat.ns), created: e.stat.born, archived: !!e.archived, doc: docOf(rel, e), from: e.bodyLine })
  }
  for (const [rel, f] of indexes.get(vault)!.files) {
    const st = vault.others.get(rel)
    if (st && !skip(rel)) out.push({ rel, name: rel.slice(rel.lastIndexOf("/") + 1), low: rel.slice(rel.lastIndexOf("/") + 1).toLowerCase(), mtime: ms(st.ns), created: st.born, archived: false, from: 0, f })
  }
  const [by, reverse] = !opts.sort || opts.sort === "relevance" ? SORTS.modified : SORTS[opts.sort]
  const sorted = sortBy(out, (c) => by({ title: c.name, path: c.rel, mtime: c.mtime, created: c.created }), reverse)
  const order = [...sorted.filter((c) => !c.archived), ...sorted.filter((c) => c.archived)]
  const made = { key, order, ...namesOf(order) }
  if (!opts.path) orders.set(vault, made)
  return made
}

type Search = { key: string; walk: Iterator<Cand>; scores: Map<Cand, number>; found: Found[]; lines?: number }
type Searched = { results: Item[]; files?: number; lines?: number }
const lastSearch = new WeakMap<Vault, Search>()

function scoresOf({ order, names, lows, starts }: Order, node: Node, whole: string): Map<Cand, number> {
  const marks = highlighter(node, "name"), out = new Map<Cand, number>()
  const near = names === null ? order.keys() : [...new Set([...lineFinder(node, "name").lines(names), ...linesWith(lows, starts, whole)])].sort((a, b) => a - b)
  for (const i of near) {
    const c = order[i], score = marks(c.name).length * 3 + (c.low.includes(whole) ? 5 : 0)
    if (score) out.set(c, score)
  }
  return out
}

function* bestFirst(order: Cand[], scores: Map<Cand, number>): Generator<Cand> {
  if (!scores.size) { yield* order; return }
  const top = [...scores.keys()].sort((a, b) => scores.get(b)! - scores.get(a)!)
  for (const archived of [false, true]) {
    for (const c of top) if (c.archived === archived) yield c
    for (const c of order) if (c.archived === archived && !scores.has(c)) yield c
  }
}

function searchOf(vault: Vault, q: string, node: Node, opts: SearchOpts): Search {
  const version = `${vault.version}:${indexes.get(vault)!.version}`
  const key = JSON.stringify([q, opts.folder, opts.path, opts.only && [...opts.only], opts.matchCase, opts.sort, opts.lines, opts.context, version])
  const had = lastSearch.get(vault)
  if (had?.key === key) return had
  const base = orderOf(vault, opts, version), scores = scoresOf(base, node, q.trim().toLowerCase())
  const walk = !opts.sort || opts.sort === "relevance" ? bestFirst(base.order, scores) : base.order.values()
  const search: Search = { key, walk, scores, found: [] }
  if (!opts.path) lastSearch.set(vault, search)
  return search
}

const itemOf = (c: Cand, score = 0): Item =>
  ({ path: c.rel, title: c.name, context: "", mtime: c.mtime, created: c.created, score, ...(c.archived ? { archived: true } : {}) })

async function fromDisk(vault: Vault, c: Cand, score: number | undefined, node: Node, shown: Shower, opts: SearchOpts): Promise<Found | null> {
  let got: Item | null = null, from = 0
  for await (const text of textsOf(vault, c.rel, c.f!)) {
    if (matches(node, { name: c.name, file: c.name, path: c.rel, text })) {
      got ??= itemOf(c, score)
      shown.show(got, text, from)
      if (!opts.lines) break
    }
    from += (text.match(/\n/g)?.length ?? 0) + 1
  }
  return got && { item: got, from: 0 }
}

function found(vault: Vault, c: Cand, score: number | undefined, node: Node, shown: Shower, opts: SearchOpts): Found | null | Promise<Found | null> {
  if (c.doc) return matches(node, c.doc) ? { item: itemOf(c, score), body: c.doc.text, from: c.from } : null
  const text = c.f!.text
  if (text === null) return null
  if (text === DISK || c.f!.reader) return fromDisk(vault, c, score, node, shown, opts)
  return matches(node, { name: c.name, file: c.name, path: c.rel, text }) ? { item: itemOf(c, score), body: text, from: 0 } : null
}

async function scanTo(vault: Vault, s: Search, n: number, node: Node, shown: Shower, opts: SearchOpts) {
  for (let next = s.found.length < n ? s.walk.next() : null; next && !next.done; next = s.found.length < n ? s.walk.next() : null) {
    const c = next.value, got = found(vault, c, s.scores.get(c), node, shown, opts)
    const f = got instanceof Promise ? await got : got
    if (f) s.found.push(f)
  }
}

export async function searchAll(vault: Vault, q: string, limit = 60, opts: SearchOpts = {}): Promise<Searched> {
  if (!q.trim()) return { results: [], files: 0, lines: 0 }
  const node = queryOf(q, opts.matchCase)
  if (node.t === "all") return { results: [], files: 0, lines: 0 }
  await refresh(vault)
  const shown = shower(node, opts), s = searchOf(vault, q, node, opts), at = opts.offset ?? 0
  await scanTo(vault, s, opts.total ? Infinity : at + limit, node, shown, opts)
  const results = s.found.slice(at, at + limit).map((x) => {
    const item = { ...x.item }
    if (x.body !== undefined) shown.show(item, x.body, x.from)
    return item
  })
  if (opts.total !== "lines") return opts.total ? { results, files: s.found.length } : { results }
  if (opts.lines) s.lines ??= s.found.reduce((n, x) => n + (x.body === undefined ? x.item.count ?? 0 : shown.count(x.body)), 0)
  return { results, files: s.found.length, lines: opts.lines ? s.lines : 0 }
}

