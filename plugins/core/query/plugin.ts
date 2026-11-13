import { HTTPError, Plugin, frontmatterTargets, noteLinks, source, type PropTypes, typedValue, typeOf } from "../../../core/plugins.ts"
import { type Entry, type Item, loadFm, readText, type Vault } from "../../../core/vault.ts"
import { baseOptions } from "./bases.ts"
import { markdown, type Opts, QueryError, type Rec, type Result, run, type RunCtx } from "./query.ts"

export const plugin = new Plugin(import.meta.url)

type Stat = Vault["others"] extends Map<string, infer S> ? S : never

function templatesFolder() {
  const f = plugin.peer("templates")?.seeded().folder
  if (typeof f === "string" && f.trim()) return f.trim().replace(/^\/+|\/+$/g, "")
  return "Templates"
}

const linkCache = new WeakMap<Entry, { body: string; fm: Item; links: string[]; embeds: string[] }>()
function linksOf(e: Entry) {
  let c = linkCache.get(e)
  if (!c || c.body !== e.body || c.fm !== e.fm) {
    const body = [...noteLinks(e.body)]
    c = { body: e.body, fm: e.fm, links: [...body.map((l) => l.target), ...frontmatterTargets(e.fm)], embeds: body.filter((l) => l.embed).map((l) => l.target) }
    linkCache.set(e, c)
  }
  return c
}

const recOf = (rel: string, e: Entry): Rec => ({
  path: rel, fm: e.fm, mtime: Number(e.stat.ns / 1000000n), ...(e.tags.length ? { tags: e.tags } : {}), created: () => e.stat.born,
  type: e.type, archived: e.archived, size: e.stat.size, links: () => linksOf(e).links, embeds: () => linksOf(e).embeds,
})
const otherRec = (rel: string, st: Stat, props?: FileProps | null): Rec => ({
  path: rel, fm: props?.of(rel) ?? {}, mtime: Number(st.ns / 1000000n), created: () => st.born, type: null, archived: false, size: st.size,
})

type FileProps = { version: string | number; of: (rel: string) => Item }
const fileProps = () => (plugin.service("file-props")?.() ?? null) as FileProps | null

const HIDDEN = /(^|\/)\./
function* records(vault: Vault, o: Opts, self?: string, base = false): Generator<Rec> {
  const skip = `${templatesFolder()}/`.toLowerCase()
  const from = (Array.isArray(o?.from) ? o.from : [o?.from]).map((f) => String(f ?? "").replace(/^\/+/, "").toLowerCase())
  const keep = base || from.some((f) => f && (f.startsWith(skip) || `${f}/` === skip))
  const hidden = (rel: string) => base && HIDDEN.test(o.archiveFolders ? rel.replace(/(^|\/)\.archive\//g, "$1") : rel)
  const here = self ? vault.sampleOf(self) : null, samples = vault.samples().filter((d) => d !== here).map((d) => `${d}/`)
  const sample = (rel: string) => samples.length > 0 && samples.some((d) => rel.startsWith(d))
  for (const [rel, e] of vault.entries) {
    if (rel === self || (!keep && rel.toLowerCase().startsWith(skip)) || hidden(rel) || sample(rel)) continue
    yield recOf(rel, e)
  }
  if (!base) return
  const props = fileProps()
  for (const [rel, st] of vault.others) if (rel !== self && !hidden(rel) && !sample(rel)) yield otherRec(rel, st, props)
}

function thisRec(vault: Vault, path?: string): Rec | null {
  if (!path) return null
  const e = vault.entries.get(path)
  if (e) return recOf(path, e)
  const st = vault.others.get(path)
  return st ? otherRec(path, st, fileProps()) : null
}

function optionsOf(q: unknown): Opts {
  if (q && typeof q === "object" && !Array.isArray(q)) return q as Opts
  const s = String(q ?? "").trim()
  if (!s) return {}
  try {
    return JSON.parse(s)
  } catch {
    try {
      return loadFm(s)
    } catch (e) {
      throw new HTTPError(400, `the query isn't JSON or YAML: ${(e as Error).message.split("\n")[0]}`)
    }
  }
}

function baseConfig(src: unknown): Record<string, unknown> {
  if (src && typeof src === "object" && !Array.isArray(src)) return src as Record<string, unknown>
  const text = String(src ?? "")
  if (!text.trim()) return {}
  try { return loadFm(text) } catch (e) { throw new QueryError(`the base isn't valid YAML: ${(e as Error).message.split("\n")[0]}`) }
}

const typesCtx = (types: PropTypes): RunCtx["types"] => ({ of: (k) => typeOf(types, k), value: typedValue })

function runOpts(vault: Vault, o: Opts, self?: string, thisPath?: string, now = new Date(), types = plugin.propertyTypes()): Result {
  const ctx: RunCtx = { self: thisRec(vault, thisPath ?? self), types: typesCtx(types) }
  if (o.base === undefined) return run(o, records(vault, o, self), now, ctx)
  let b: ReturnType<typeof baseOptions>
  try { b = baseOptions(baseConfig(o.base), typeof o.show === "string" ? o.show : null) } catch (e) { throw new QueryError((e as Error).message) }
  if (typeof o.month === "string" && b.opts.view === "calendar") b.opts.month = o.month
  const res = run(b.opts, records(vault, b.opts, self, true), now, ctx)
  const notes = [...b.notes, ...(res.notes ?? [])]
  return { ...res, views: b.views, current: b.index, ...(notes.length ? { notes } : {}) }
}

const answers = new WeakMap<Vault, { when: string; byQuery: Map<string, Readonly<Result>> }>()

export function query(vault: Vault, o: Opts, self?: string, thisPath?: string) {
  const types = plugin.propertyTypes()
  const when = `${vault.version} ${templatesFolder()} ${vault.samples().join("|")} ${new Date().toDateString()} ${fileProps()?.version ?? ""} ${JSON.stringify(types)}`, q = JSON.stringify([o, self ?? null, thisPath ?? null])
  let kept = answers.get(vault)
  if (kept?.when !== when) answers.set(vault, kept = { when, byQuery: new Map() })
  const hit = kept.byQuery.get(q)
  if (hit) return hit
  try {
    const out = Object.freeze(runOpts(vault, o, self, thisPath, new Date(), types))
    if (kept.byQuery.size < 100) kept.byQuery.set(q, out)
    return out
  } catch (e) {
    if (e instanceof QueryError) throw new HTTPError(400, e.message)
    throw e
  }
}

function baseText(vault: Vault, path: string) {
  if (!/\.base$/i.test(path) || !vault.others.has(path)) throw new HTTPError(404, `no base '${path}'`)
  return readText(vault.abs(path))
}

const selfOf = (v: unknown) => (typeof v === "string" && v ? v : undefined)
plugin.route("GET", "query", (req) => {
  const base = selfOf(req.query.base)
  if (base) {
    const o = { base: baseText(plugin.vault, base), ...(selfOf(req.query.view) ? { show: req.query.view } : {}), ...(selfOf(req.query.month) ? { month: req.query.month } : {}) }
    return query(plugin.vault, o, base, selfOf(req.query.this) ?? base)
  }
  return query(plugin.vault, optionsOf(req.query.q), selfOf(req.query.self), selfOf(req.query.this))
})
plugin.route("POST", "query", (req) => query(plugin.vault, optionsOf((req.body as Item)?.options ?? req.body)))

function baseMarkdown(vault: Vault, text: string, at: { path?: string; view?: string; this?: string; level?: number } = {}) {
  let cfg: Record<string, unknown>, names: string[]
  try {
    cfg = baseConfig(text)
    names = at.view ? [at.view] : baseOptions(cfg).views.map((v) => v.name)
  } catch (e) { return `_(base: ${(e as Error).message})_` }
  return names.map((name) => {
    try {
      const res = runOpts(vault, { base: cfg, show: name }, at.path, at.this ?? at.path)
      source(res.groups.map((g) => g.rows.map((r) => r.path)))
      return markdown(res, at.level ?? 2)
    } catch (e) {
      if (e instanceof QueryError) return `_(base: ${e.message})_`
      throw e
    }
  }).join("\n\n")
}

plugin.provide("text:base", (text: string, rel: string, at?: { sub?: string; host?: string }) =>
  baseMarkdown(plugin.vault, text, { path: rel, view: at?.sub || undefined, this: at?.host ?? rel, level: at?.host ? 3 : 2 }))
plugin.provide("fence:base", (ctx: { path: string; text: string; host?: string }) => baseMarkdown(plugin.vault, ctx.text, { path: ctx.path, this: ctx.host ?? ctx.path, level: 3 }))

const CELL = 200
const cell = (v: unknown, cut?: { n: number }) => {
  const s = (v === null || v === undefined ? "" : Array.isArray(v) ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ")
    : typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/\s*\n\s*/g, " ")
  if (s.length > CELL && cut) cut.n++
  return (s.length > CELL ? `${s.slice(0, CELL)}…` : s).replace(/\|/g, "\\|")
}

const LIST = (description: string) => ({ type: "array" as const, items: { type: "string" as const }, description })

plugin.op({
  id: "query.run",
  cli: "query",
  mcp: "query",
  summary: "Query the vault like a database: the files that match, as a table of their properties (a database view).",
  help: `The engine bases run on (vau docs query): from (folders), type (person, note, log, book, project...),
tags, where ("relation = friend and every_days <= 30", "area = workouts and date >= 2026-09-01"), columns, sort ("-date"),
group, limit and offset (a page: 50 rows at a time unless limit says). The answer as JSON has every row's values
whole; as text it's a Markdown table (one per group), a long cell cut with "…".

  vau query --type log --where "area = sleep" --columns file,date,duration_min --sort=-date --limit 7
  vau query --type person --columns file,relation --group relation
  vau query --where "file.links contains this" --this Lighthouse      what links to Lighthouse (not itself)`,
  kind: "read",
  params: {
    from: LIST("folders to look in (path prefixes)"),
    type: LIST("the files' type: person, note, log, book, project, routine, day..."),
    tags: LIST("tags the files must all have"),
    where: { type: "string", description: "conditions on properties: = != < <= > >= contains, and / or / not, has <key>" },
    columns: LIST("properties to show (and file, folder, path, created, updated)"),
    sort: LIST("keys to sort by; a leading - is descending"),
    group: { type: "string", description: "a property to group the rows by" },
    limit: { type: "integer", minimum: 1, default: 50, description: "at most this many rows" },
    offset: { type: "integer", minimum: 0, description: "skip this many rows first (the next page: what the last answer says)" },
    archived: { type: "boolean", description: "include archived files" },
    this: { type: "string", format: "path", description: "the note `this` is in the where (file.links contains this: what links to it)" },
  },
  run: (p) => {
    const options: Item = {}
    for (const k of ["from", "type", "tags", "where", "columns", "sort", "group", "limit", "offset", "archived"] as const) if (p[k] !== undefined && p[k] !== "") options[k] = p[k]
    const here = typeof p.this === "string" && p.this ? plugin.vault.relocated(p.this) : undefined
    if (here && !plugin.vault.entries.has(here) && !plugin.vault.others.has(here)) throw new HTTPError(404, `this: no file '${p.this}'`)
    return query(plugin.vault, options as Opts, here, here)
  },
  text: (r) => {
    const cut = { n: 0 }
    const cols = ((r.columns ?? []) as Item[]).map((c) => (typeof c === "string" ? { key: c, label: c } : { key: c.key ?? c.id ?? c.name, label: c.label ?? c.name ?? c.key }))
    const table = (rows: Item[]) => {
      if (!rows.length) return "_None._"
      const head = `| ${cols.map((c) => cell(c.label)).join(" | ")} |\n|${cols.map(() => " --- ").join("|")}|`
      return [head, ...rows.map((row) => `| ${cols.map((c, i) => cell(Array.isArray(row.values) ? row.values[i] : row.values?.[c.key] ?? (c.key === "file" ? row.title : ""), cut)).join(" | ")} |`)].join("\n")
    }
    const groups = (r.groups ?? []) as Item[]
    const body = groups.length === 1 && (groups[0].name === null || groups[0].name === undefined || groups[0].name === "")
      ? table(groups[0].rows ?? [])
      : groups.map((g) => `### ${g.name ?? "No value"} (${(g.rows ?? []).length})\n\n${table(g.rows ?? [])}`).join("\n\n")
    const notes = ((r.notes ?? []) as string[]).map((n) => `_${n}_`)
    if (cut.n) notes.push(`_A cell ending in … is cut at ${CELL} characters: read its file (or ask for JSON) for the whole value._`)
    const from = r.offset ?? 0, end = from + (r.shown ?? 0)
    const count = r.shown === r.total ? `${r.total} files.` : `Rows ${r.shown ? `${from + 1}-${end}` : "none"} of ${r.total} files${end < r.total ? `; more: offset ${end}` : ""}.`
    return [count, body || "_None._", notes.join("\n")].filter(Boolean).join("\n\n")
  },
})
