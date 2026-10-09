// Graph view's server side: /api/graph (the whole vault or a local graph) and its settings. Nodes include linked
// attachments and files plugins read links from; links resolve like the app's. Nothing is stored.
import fs from "node:fs"
import { frontmatterTargets, HTTPError, type LinkFile, linkResolver, LOADED, OpError, Plugin, wikiTargets } from "../../../core/plugins.ts"
import { type Entry, type Item, readText, splitTags, stemOf, type Vault } from "../../../core/vault.ts"
import { buildGraph, filterGraph, type Graph, type GraphFile, localGraph, localMarkdown } from "./graph.ts"

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

let cached: { vault: Vault; version: string; plugins: unknown[]; graph: Graph } | null = null

// A file's link targets, once per read of it (an Entry is new each time its file is read): a change to one file
// doesn't read every other file's links again.
const targetsOf = new WeakMap<Entry, string[]>()
function linksIn(e: Entry) {
  let t = targetsOf.get(e)
  if (!t) targetsOf.set(e, t = [...wikiTargets(e.body), ...frontmatterTargets(e.fm)])
  return t
}

// Other files' links, kept until the file or its reader changes: a big drawing is read once, not on every change.
const otherLinks = new WeakMap<Vault, Map<string, { ns: bigint; read: unknown; links: string[] }>>()

/** The whole vault's graph, built again only when the vault's files changed or the plugins that are off did (their
 *  services name links); the same object meanwhile, frozen (so the server serializes it once). */
export function vaultGraph(vault: Vault): Graph {
  const version = `${vault.version}:${[...vault.switchedOff()].join(",")}`
  if (cached?.vault === vault && cached.version === version && cached.plugins.length === LOADED.length &&
    LOADED.every((p, i) => p === cached!.plugins[i])) return cached.graph

  const off = vault.switchedOff()
  const namers = LOADED.filter((p) => !off.has(p.id) && Object.hasOwn(p.services, "link-names"))
    .map((p) => p.services["link-names"] as (path: string, fm: Item) => { names?: string[]; weak?: string[] } | null)
  const files: GraphFile[] = []
  const targets: LinkFile[] = []
  for (const [rel, e] of vault.entries) {
    const title = e.fm.title || e.fm.name || stemOf(rel)
    const aliases = e.fm.aliases
    const t: LinkFile = { path: rel, title: typeof title === "string" ? title : String(title), aliases: (Array.isArray(aliases) ? aliases : aliases ? [aliases] : []).map(String), names: [], weak: [], archived: e.archived }
    for (const named of namers) {
      try { const n = named(rel, e.fm); t.names!.push(...(n?.names ?? [])); t.weak!.push(...(n?.weak ?? [])) } catch { /* a plugin's names failing must not break the rest */ }
    }
    targets.push(t)
    files.push({
      path: rel, title: t.title!, type: e.type, tags: splitTags(e.fm.tags), links: linksIn(e), ...(e.archived ? { archived: true } : {}),
    })
  }
  // Other files: those a plugin reads links out of, and the ones something links to (attachments).
  const others: GraphFile[] = []
  let known = otherLinks.get(vault)
  if (!known) otherLinks.set(vault, known = new Map())
  for (const rel of known.keys()) if (!vault.others.has(rel)) known.delete(rel)
  for (const [rel, st] of vault.others) {
    const read = linkReader(vault, rel)
    let links: string[] = []
    const had = known.get(rel)
    if (read && had?.ns === st.ns && had.read === read) links = had.links
    else if (read) {
      try {
        links = read(readText(vault.abs(rel)))
        known.set(rel, { ns: st.ns, read, links })
      } catch { /* half-written: no links this time */ }
    }
    others.push({ path: rel, title: rel.slice(rel.lastIndexOf("/") + 1), type: null, tags: [], links })
    targets.push({ path: rel })
  }
  const resolve = linkResolver(targets)
  const linked = new Set<string>()
  for (const f of [...files, ...others]) for (const t of f.links) { const p = resolve(t); if (p) linked.add(p) }
  const graph = buildGraph([...files, ...others.filter((o) => o.links.length || linked.has(o.path))], resolve)
  cached = { vault, version, plugins: [...LOADED], graph: Object.freeze(graph) }
  return graph
}

/** How a path is written as a [[link]]: its name, or its path when another file has the same name. */
function linkNameFor(vault: Vault) {
  const count = new Map<string, number>()
  const nm = (p: string) => stemOf(p).toLowerCase()
  for (const p of [...vault.entries.keys(), ...vault.others.keys()]) count.set(nm(p), (count.get(nm(p)) ?? 0) + 1)
  return (p: string) => ((count.get(nm(p)) ?? 0) > 1 ? p.replace(/\.md$/i, "") : stemOf(p))
}

const depthOf = (v: unknown) => Math.max(1, Math.min(3, Math.trunc(Number(v) || 1)))

/** The graph without archived files (but `keep`, the file a local graph is of), unless the settings or the request
 *  (`all`) ask for them. The same object for the same graph, so the whole vault's is still serialized once. */
const shownCache = new WeakMap<Graph, Graph>()
function shown(g: Graph, all: boolean, keep = "") {
  if (all || plugin.settings().archived === true || !g.nodes.some((n) => n.archived && n.path !== keep)) return g
  if (keep) return filterGraph(g, (n) => !n.archived || n.path === keep)
  let hit = shownCache.get(g)
  if (!hit) shownCache.set(g, hit = Object.freeze(filterGraph(g, (n) => !n.archived)))
  return hit
}

plugin.route("GET", "graph", (req) => {
  const path = String(req.query.path ?? "")
  const g = shown(vaultGraph(plugin.vault), req.query.archived === "true", path)
  if (!path) return g
  if (!plugin.vault.entries.has(path) && !plugin.vault.others.has(path)) {
    if (!fs.existsSync(plugin.vault.abs(path))) throw new HTTPError(404, `no file '${path}'`)
  }
  const local = localGraph(g, path, depthOf(req.query.depth))
  return { nodes: local.nodes.map((n) => ({ ...n, dist: local.dist.get(n.path) })), edges: local.edges }
})

// ```block-graph: the file's neighbours in the graph, as links.
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
  help: `Links resolve like the app's ([[name]], an alias, a person's first name; embeds and a canvas's cards count). Archived
files are left out unless asked for. depth 2 or 3 adds what's that many links away (the local graph).

  vau graph.links "Alice Park"
  vau graph.links Notes/Idea.md --depth 2`,
  kind: "read",
  params: {
    path: { type: "string", format: "path", required: true, description: "the file (Notes/Idea.md, or its name: Alice Park)" },
    depth: { type: "integer", minimum: 1, maximum: 3, default: 1, description: "how many links out (2 or 3: the files beyond its neighbours too)" },
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
      in: sorted(g.edges.filter((e) => e.to === path && e.from !== path).map((e) => e.from)),
      out: sorted(g.edges.filter((e) => e.from === path && e.to !== path).map((e) => e.to)),
      further: depth > 1 ? [...local.dist].filter(([, d]) => d > 1).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([p, d]) => ({ path: p, dist: d })) : [],
    }
  },
  text: (r) => [`Links to ${r.path} (${r.in.length}):`, ...(r.in.length ? r.in.map((x: string) => `- ${x}`) : ["- none"]),
    "", `Links from it (${r.out.length}):`, ...(r.out.length ? r.out.map((x: string) => `- ${x}`) : ["- none"]),
    ...(r.further.length ? ["", "Further out:", ...r.further.map((x: { path: string; dist: number }) => `- ${x.path} (${x.dist} links away)`)] : [])].join("\n"),
})

const SETTINGS = new Set(["colorBy", "orphans", "hidden", "depth", "archived"])

plugin.route("GET", "graph/settings", () => plugin.settings())
plugin.route("PUT", "graph/settings", (req) => {
  const cur = plugin.readSettings() ?? {}
  const next = { ...cur }
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (!SETTINGS.has(k)) throw new HTTPError(400, `no setting '${k}'`)
    if (v === null) delete next[k]; else next[k] = v
  }
  if (JSON.stringify(next) !== JSON.stringify(cur)) plugin.saveSettings(next)
  return next
})
