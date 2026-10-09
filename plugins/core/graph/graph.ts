// The vault as a graph (files as nodes, links as edges), shared by the server and the app's filters. No Node.

/** A file as the graph sees it: where it is, what it's called and what it links to (the targets as written); its type
 *  is the core's (core/fileprops.ts: its kind's, else its frontmatter's). */
export type GraphFile = { path: string; title: string; type: string | null; tags: string[]; links: string[]; archived?: boolean }
export type GraphNode = { path: string; title: string; type: string | null; folder: string; tags: string[]; degree: number; archived?: boolean }
/** A link from one file to another (paths); a pair linked both ways is one edge. */
export type GraphEdge = { from: string; to: string }
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] }

/** A file's top folder ("" at the top of the vault): what the graph colours it by. */
export const topFolder = (path: string) => (path.includes("/") ? path.slice(0, path.indexOf("/")) : "")

/** A file's name without its folder and without .md. */
export const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "")

/** The graph of these files, their links resolved with `resolve` (a target written in a file to a path, or null). Links
 *  to files that aren't in `files` and links to itself are left out. */
export function buildGraph(files: GraphFile[], resolve: (target: string, from: string) => string | null): Graph {
  const known = new Set(files.map((f) => f.path))
  const seen = new Set<string>()
  const edges: GraphEdge[] = []
  const degree = new Map<string, number>()
  for (const f of files) {
    for (const t of f.links) {
      const to = resolve(t, f.path)
      if (!to || to === f.path || !known.has(to)) continue
      const key = f.path < to ? `${f.path}\0${to}` : `${to}\0${f.path}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from: f.path, to })
      degree.set(f.path, (degree.get(f.path) ?? 0) + 1)
      degree.set(to, (degree.get(to) ?? 0) + 1)
    }
  }
  const nodes = files.map((f): GraphNode => ({ path: f.path, title: f.title, type: f.type, folder: topFolder(f.path), tags: f.tags, degree: degree.get(f.path) ?? 0, ...(f.archived ? { archived: true } : {}) }))
  return { nodes, edges }
}

/** Adjacency: each path's neighbours (linked either way). */
export function adjacency(g: Graph) {
  const adj = new Map<string, Set<string>>()
  for (const n of g.nodes) adj.set(n.path, new Set())
  for (const e of g.edges) { adj.get(e.from)?.add(e.to); adj.get(e.to)?.add(e.from) }
  return adj
}

/** The local graph around `path`: it, what's within `depth` links of it (either way), and the edges between them.
 *  Each node's `dist` is how many links away it is. */
export function localGraph(g: Graph, path: string, depth = 1): Graph & { dist: Map<string, number> } {
  const adj = adjacency(g)
  const dist = new Map<string, number>()
  if (!adj.has(path)) return { nodes: [], edges: [], dist }
  dist.set(path, 0)
  let ring = [path]
  for (let d = 1; d <= Math.max(1, Math.min(3, depth)); d++) {
    const next: string[] = []
    for (const p of ring) for (const q of adj.get(p) ?? []) if (!dist.has(q)) { dist.set(q, d); next.push(q) }
    ring = next
  }
  return {
    nodes: g.nodes.filter((n) => dist.has(n.path)),
    edges: g.edges.filter((e) => dist.has(e.from) && dist.has(e.to)),
    dist,
  }
}

/** Keeps only the nodes `keep` says yes to, and the edges between them. */
export function filterGraph(g: Graph, keep: (n: GraphNode) => boolean): Graph {
  const nodes = g.nodes.filter(keep)
  const on = new Set(nodes.map((n) => n.path))
  return { nodes, edges: g.edges.filter((e) => on.has(e.from) && on.has(e.to)) }
}

/** The local graph as Markdown, for AIs (/api/render): its neighbours as [[links]], nearest first. */
export function localMarkdown(g: Graph, path: string, depth = 1, linkName: (path: string) => string = nameOf) {
  const local = localGraph(g, path, depth)
  if (!local.nodes.length) return "_Not in the graph._"
  const adj = adjacency(g)
  const outOf = new Set(g.edges.filter((e) => e.from === path).map((e) => e.to))
  const inTo = new Set(g.edges.filter((e) => e.to === path).map((e) => e.from))
  const link = (p: string) => `[[${linkName(p)}]]`
  const byName = (a: string, b: string) => nameOf(a).localeCompare(nameOf(b))
  const first = [...(adj.get(path) ?? [])].sort(byName)
  if (!first.length) return "_No links to or from this file._"
  const parts = [`**Linked with ${first.length} file${first.length === 1 ? "" : "s"}**`,
    first.map((p) => `- ${link(p)}${outOf.has(p) && inTo.has(p) ? " (both ways)" : outOf.has(p) ? " (links to it)" : " (links here)"}`).join("\n")]
  if (depth >= 2) {
    const second = local.nodes.filter((n) => local.dist.get(n.path) === 2).map((n) => n.path).sort(byName)
    const MAX = 60
    if (second.length) {
      const more = second.length > MAX ? `\n- …and ${second.length - MAX} more` : ""
      parts.push(`**Two links away (${second.length})**`, second.slice(0, MAX).map((p) => `- ${link(p)}`).join("\n") + more)
    }
  }
  return parts.join("\n\n")
}
