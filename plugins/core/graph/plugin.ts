import fs from "node:fs"
import { frontmatterLinks, HTTPError, type LinkFile, linkResolver, LOADED, OpError, parseSearch, Plugin, type SearchDoc, SearchError, searchMatches, linkTargets } from "../../../core/plugins.ts"
import { type Entry, readText, stemOf, type Vault } from "../../../core/vault.ts"
import { BODY, buildGraph, type Built, filterGraph, type Graph, type GraphFile, type GraphNode, localGraph, localMarkdown, MAX_DEPTH } from "./graph.ts"

export const plugin = new Plugin(import.meta.url)

const extOf = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1).split(".").slice(1).join(".").toLowerCase()

/** The service a plugin that's on offers for reading links out of files with this extension (Canvas: `links:canvas`). */
function linkReader(vault: Vault, rel: string): ((text: string) => string[]) | null {
  const off = vault.switchedOff()
  const parts = extOf(rel).split(".")
  for (let i = 0; i < parts.length; i++) {
    const name = `links:${parts.slice(i).join(".")}`
    const p = LOADED.find((x) => !off.has(x.id) && Object.hasOwn(x.services, name))
    if (p) return p.services[name] as (text: string) => string[]
  }
  return null
}

type Seen = { settings: number; excluded: boolean; file: GraphFile; target: LinkFile; key: string }
const seenOf = new WeakMap<Entry, Seen>()
function seen(vault: Vault, rel: string, e: Entry): Seen {
  let s = seenOf.get(e)
  if (s?.settings === vault.settingsVersion) return s
  const excluded = vault.excluded(rel)
  if (s?.excluded !== excluded) {
    const title = e.fm.title || e.fm.name || stemOf(rel), aliases = e.fm.aliases
    const target = { path: rel, aliases: (Array.isArray(aliases) ? aliases : aliases ? [aliases] : []).map(String), archived: e.archived }
    s = { settings: 0, excluded, target, key: `${rel}\u0001${target.aliases.join("\u0001")}${e.archived ? "\u0002" : ""}`,
      file: { path: rel, title: typeof title === "string" ? title : String(title), type: e.type, tags: e.tags, links: s?.file.links ?? linkTargets(e.body),
        props: s?.file.props ?? frontmatterLinks(e.fm), ...(e.archived ? { archived: true } : {}), ...(excluded ? { excluded: true } : {}) } }
  }
  s.settings = vault.settingsVersion
  seenOf.set(e, s)
  return s
}

const NO_LINKS: string[] = []

const otherLinks = new WeakMap<Vault, Map<string, { ns: bigint; read: unknown; links: string[]; file?: GraphFile }>>()

type Kept = { vault: Vault; version: string; plugins: unknown[]; graph: Graph; built: Built; entries: Entry[]; seen: Seen[]; others: GraphFile[]
  resolve: (t: string, from?: string) => string | null; links: [string, string | null][][]; inbound: Map<string, number> }
let cached: Kept | null = null

const resolveAll = (f: GraphFile, resolve: Kept["resolve"]): [string, string | null][] =>
  [...f.links.map((t): [string, string | null] => [BODY, resolve(t, f.path)]), ...(f.props ?? []).map(([k, t]): [string, string | null] => [k, resolve(t, f.path)])]
const count = (inbound: Map<string, number>, links: [string, string | null][], by: number) => {
  for (const [, p] of links) if (p) inbound.set(p, (inbound.get(p) ?? 0) + by)
}

export function vaultGraph(vault: Vault): Graph {
  const version = `${vault.version}:${vault.settingsVersion}:${[...vault.switchedOff()].join(",")}`
  const same = cached?.vault === vault && cached.plugins.length === LOADED.length && LOADED.every((p, i) => p === cached!.plugins[i])
  if (same && cached!.version === version) return cached!.graph
  const was = same ? cached : null

  const entries: Entry[] = [], seens: Seen[] = []
  let at = 0, changed: number[] | null = was ? [] : null
  for (const [rel, e] of vault.entries) {
    const s = was?.entries[at] === e && was.seen[at].settings === vault.settingsVersion ? was.seen[at] : seen(vault, rel, e)
    if (changed && s !== was!.seen[at] && changed.push(at) > 1000) changed = null
    entries.push(e); seens.push(s); at++
  }
  const others: GraphFile[] = []
  let known = otherLinks.get(vault)
  if (!known) otherLinks.set(vault, known = new Map())
  for (const rel of known.keys()) if (!vault.others.has(rel)) known.delete(rel)
  for (const [rel, st] of vault.others) {
    const read = linkReader(vault, rel)
    let had = known.get(rel)
    if (had?.ns !== st.ns || had.read !== read) {
      let links = NO_LINKS
      try { if (read) links = read(readText(vault.abs(rel))) } catch {}
      known.set(rel, had = { ns: st.ns, read, links })
    }
    const excluded = vault.excluded(rel)
    if (!had.file || !!had.file.excluded !== excluded) had.file = { path: rel, title: rel.slice(rel.lastIndexOf("/") + 1), type: null, tags: [], links: had.links, ...(excluded ? { excluded: true } : {}) }
    others.push(had.file)
  }
  const n = seens.length, all = [...seens.map((s) => s.file), ...others]
  if (changed && was && (was.seen.length !== n || was.others.length !== others.length || others.some((o, i) => o !== was.others[i]) ||
    changed.some((i) => seens[i].key !== was.seen[i].key))) changed = null
  let resolve: Kept["resolve"], links: [string, string | null][][], inbound: Map<string, number>
  if (changed && was) {
    ({ resolve } = was)
    links = was.links.slice(); inbound = new Map(was.inbound)
    for (const i of changed) {
      if (seens[i].file === was.seen[i].file) continue
      count(inbound, links[i], -1)
      count(inbound, links[i] = resolveAll(seens[i].file, resolve), 1)
    }
  } else {
    resolve = linkResolver([...seens.map((s) => s.target), ...others.map((o) => ({ path: o.path }))])
    links = all.map((f) => resolveAll(f, resolve)); inbound = new Map()
    for (const l of links) count(inbound, l, 1)
  }
  const files = all.slice(0, n), kept = links.slice(0, n)
  for (let i = n; i < all.length; i++) if (all[i].links.length || inbound.get(all[i].path)) { files.push(all[i]); kept.push(links[i]) }
  const built = buildGraph(files, kept, was?.built)
  cached = { vault, version, plugins: [...LOADED], graph: Object.freeze(built.graph), built, entries, seen: seens, others, resolve, links, inbound }
  return built.graph
}

function linkNameFor(vault: Vault) {
  const count = new Map<string, number>()
  const nm = (p: string) => stemOf(p).toLowerCase()
  for (const p of [...vault.entries.keys(), ...vault.others.keys()]) count.set(nm(p), (count.get(nm(p)) ?? 0) + 1)
  return (p: string) => ((count.get(nm(p)) ?? 0) > 1 ? p.replace(/\.md$/i, "") : stemOf(p))
}

const depthOf = (v: unknown) => Math.max(1, Math.min(MAX_DEPTH, Math.trunc(Number(v) || 1)))

const shownCache = new WeakMap<Graph, Map<boolean, Graph>>()
function shown(g: Graph, all: boolean, keep = "") {
  const archived = all || plugin.settings().archived === true
  const hide = (n: GraphNode) => n.path !== keep && (!!n.excluded || (!archived && !!n.archived))
  if (!g.nodes.some(hide)) return g
  if (keep) return filterGraph(g, (n) => !hide(n))
  let byAll = shownCache.get(g)
  if (!byAll) shownCache.set(g, byAll = new Map())
  let hit = byAll.get(archived)
  if (!hit) byAll.set(archived, hit = Object.freeze(filterGraph(g, (n) => !hide(n))))
  return hit
}

plugin.route("GET", "graph", (req) => {
  const path = String(req.query.path ?? "")
  const all = vaultGraph(plugin.vault), archived = req.query.archived === "true"
  let g = shown(all, archived)
  if (path && g !== all && !g.nodes.some((n) => n.path === path)) g = shown(all, archived, path)
  if (!path) return g
  if (!plugin.vault.entries.has(path) && !plugin.vault.others.has(path)) {
    if (!fs.existsSync(plugin.vault.abs(path))) throw new HTTPError(404, `no file '${path}'`)
  }
  const local = localGraph(g, path, depthOf(req.query.depth))
  return { nodes: local.nodes.map((n) => ({ ...n, dist: local.dist.get(n.path) })), edges: local.edges }
})

const matchCache = new WeakMap<Graph, Map<string, string[] | string>>()
function matching(vault: Vault, q: string): string[] | string {
  const g = vaultGraph(vault)
  let byQ = matchCache.get(g)
  if (!byQ) matchCache.set(g, byQ = new Map())
  const hit = byQ.get(q)
  if (hit) return hit
  let out: string[] | string
  try {
    const node = parseSearch(q)
    out = node.t === "all" ? g.nodes.map((n) => n.path) : g.nodes.filter((n) => {
      const e = vault.entries.get(n.path), file = n.path.slice(n.path.lastIndexOf("/") + 1)
      const doc: SearchDoc = e ? { name: stemOf(n.path), file, path: n.path, text: e.body, tags: e.tags, props: e.fm, type: e.type } : { name: file, file, path: n.path, text: "" }
      return searchMatches(node, doc)
    }).map((n) => n.path)
  } catch (e) {
    if (!(e instanceof SearchError)) throw e
    out = e.message
  }
  if (byQ.size > 50) byQ.clear()
  byQ.set(q, out)
  return out
}

plugin.route("GET", "graph/match", (req) => {
  let qs: unknown
  try { qs = JSON.parse(String(req.query.q ?? "[]")) } catch { throw new HTTPError(400, "q is a JSON list of queries") }
  if (!Array.isArray(qs) || !qs.every((q) => typeof q === "string")) throw new HTTPError(400, "q is a JSON list of queries")
  return { results: (qs as string[]).map((q) => { const r = matching(plugin.vault, q); return typeof r === "string" ? { error: r } : { paths: r } }) }
})

plugin.block("graph", (ctx) => {
  const depth = depthOf(ctx.options.depth)
  const g = shown(vaultGraph(ctx.vault), false, ctx.path)
  ctx.source(localGraph(g, ctx.path, depth).nodes.map((n) => n.path))
  return localMarkdown(g, ctx.path, depth, linkNameFor(ctx.vault))
})

plugin.op({
  id: "graph.links",
  mcp: "links",
  summary: "A file's links: what links to it (its backlinks), what it links to, and with depth, what's further out in the graph.",
  help: `Links resolve like the app's ([[name]], a path, an alias; embeds and a canvas's cards count). Archived
files are left out unless asked for. depth 2 to 5 adds what's that many links away (the local graph).

  vau graph.links "Alice Park"
  vau graph.links Notes/Idea.md --depth 2`,
  kind: "read",
  params: {
    path: { type: "string", format: "path", required: true, description: "the file (Notes/Idea.md, or its name: Alice Park)" },
    depth: { type: "integer", minimum: 1, maximum: 5, default: 1, description: "how many links out (2 to 5: the files beyond its neighbours too)" },
    archived: { type: "boolean", description: "archived files too" },
  },
  args: ["path"],
  run: ({ path, depth, archived }) => {
    const g = shown(vaultGraph(plugin.vault), !!archived, path)
    if (!g.nodes.some((n) => n.path === path)) throw new OpError(`no file '${path}' in the graph`, 404)
    const local = localGraph(g, path, depth)
    const sorted = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b))
    return {
      path,
      in: sorted(g.edges.filter((e) => e.to === path || (e.both && e.from === path)).map((e) => (e.to === path ? e.from : e.to))),
      out: sorted(g.edges.filter((e) => e.from === path || (e.both && e.to === path)).map((e) => (e.from === path ? e.to : e.from))),
      further: depth > 1 ? [...local.dist].filter(([, d]) => d > 1).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([p, d]) => ({ path: p, dist: d })) : [],
    }
  },
  text: (r) => [`Links to ${r.path} (${r.in.length}):`, ...(r.in.length ? r.in.map((x: string) => `- ${x}`) : ["- none"]),
    "", `Links from it (${r.out.length}):`, ...(r.out.length ? r.out.map((x: string) => `- ${x}`) : ["- none"]),
    ...(r.further.length ? ["", "Further out:", ...r.further.map((x: { path: string; dist: number }) => `- ${x.path} (${x.dist} links away)`)] : [])].join("\n"),
})

