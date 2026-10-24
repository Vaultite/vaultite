// The vault as a graph (files as nodes, links as edges), shared by the server and the app's filters. No Node.

/** A file as the graph sees it: what it links to (targets as written: `links` in its text, `props` [key, target] in its
 *  frontmatter); its type is the core's (core/fileprops.ts: its kind's, else its frontmatter's). */
export type GraphFile = { path: string; title: string; type: string | null; tags: string[]; links: string[]; props?: [string, string][]; archived?: boolean; excluded?: boolean }
/** `tag`: a tag drawn as a dot (path "#name"), linked to the files that have it (withTags). */
export type GraphNode = { path: string; title: string; type: string | null; folder: string; tags: string[]; degree: number; archived?: boolean; excluded?: boolean; tag?: true }
/** A link from one file to another (paths); a pair linked both ways is one edge, `both`. `types`: the frontmatter keys
 *  it's written under, and BODY when it's in the text too; left out when it's only in the text. */
export type GraphEdge = { from: string; to: string; both?: true; types?: string[] }
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] }

/** A file's top folder ("" at the top of the vault): what the graph colours it by. */
export const topFolder = (path: string) => (path.includes("/") ? path.slice(0, path.indexOf("/")) : "")

/** A file's name without its folder and without .md. */
export const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "")

/** A link's type when it's in a file's text, not its frontmatter (the legend's "In the text"). */
export const BODY = "body"
/** An edge's link types (BODY alone when it has none listed). */
export const typesOf = (e: GraphEdge) => e.types ?? [BODY]

/** A graph as built, with what updating it needs: each file's links as resolved, and each linked pair's edge (by its
 *  files' numbers). */
export type Built = { graph: Graph; files: GraphFile[]; links: [string, string | null][][]; index: Map<string, number>; pairs: Map<number, GraphEdge>; degree: Uint32Array }

const nodeOf = (f: GraphFile, degree: number): GraphNode => Object.freeze({ path: f.path, title: f.title, type: f.type, folder: topFolder(f.path), tags: f.tags, degree,
  ...(f.archived ? { archived: true } : {}), ...(f.excluded ? { excluded: true } : {}) })

/** The edge between files a and b (a before b), from their links, or null when neither links to the other: from the
 *  first that links to the other; `types` those of a's links to b, then b's to a. */
function edgeOf(files: GraphFile[], links: [string, string | null][][], a: number, b: number): GraphEdge | null {
  const pa = files[a].path, pb = files[b].path
  const ta = links[a].filter(([, to]) => to === pb).map(([t]) => t), tb = links[b].filter(([, to]) => to === pa).map(([t]) => t)
  if (!ta.length && !tb.length) return null
  const types = [...new Set([...ta, ...tb])]
  return Object.freeze({ from: ta.length ? pa : pb, to: ta.length ? pb : pa, ...(ta.length && tb.length ? { both: true as const } : {}),
    ...(types.length > 1 || types[0] !== BODY ? { types } : {}) })
}

/** The graph of these files, their links as `linksOf` resolves them ([BODY or a frontmatter key, path or null]), but to
 *  itself or out of `files`. With `was` (the last build), only files whose links changed are; unchanged parts stay. */
export function buildGraph(files: GraphFile[], linksOf: (f: GraphFile) => [string, string | null][], was?: Built): Built {
  const n = files.length
  const links = files.map(linksOf)
  const same = was && was.files.length === n && files.every((f, i) => f.path === was.files[i].path)
  const changed = same ? links.flatMap((l, i) => (l !== was.links[i] ? [i] : [])) : []
  if (!same || changed.length > n / 8) return buildAll(files, links)
  // (files by number: a pair's key is a number, not a string made per link)
  const { index, pairs } = was, degree = was.degree.slice()
  const key = (i: number, j: number) => (i < j ? i * n + j : j * n + i)
  const touched = new Set<number>()
  for (const i of changed) for (const l of [was.links[i], links[i]]) for (const [, to] of l) { const j = to === null ? undefined : index.get(to); if (j !== undefined && j !== i) touched.add(key(i, j)) }
  const swapped = new Map<GraphEdge, GraphEdge | null>(), added: GraphEdge[] = []
  for (const k of touched) {
    const a = Math.floor(k / n), b = k % n, old = pairs.get(k) ?? null, e = edgeOf(files, links, a, b)
    if (old && e && old.from === e.from && old.both === e.both && old.types?.join("\0") === e.types?.join("\0")) continue
    if (old) { swapped.set(old, e); degree[a]--; degree[b]-- } else if (e) added.push(e)
    if (e) { pairs.set(k, e); degree[a]++; degree[b]++ } else pairs.delete(k)
  }
  const edges = swapped.size ? was.graph.edges.flatMap((e) => { const x = swapped.get(e); return x === undefined ? [e] : x ? [x] : [] }) : [...was.graph.edges]
  edges.push(...added)
  const nodes = files.map((f, i) => (f === was.files[i] && degree[i] === was.degree[i] ? was.graph.nodes[i] : nodeOf(f, degree[i])))
  return { graph: { nodes, edges }, files, links, index, pairs, degree }
}

function buildAll(files: GraphFile[], links: [string, string | null][][]): Built {
  const index = new Map<string, number>()
  files.forEach((f, i) => index.set(f.path, i))
  const n = files.length
  const seen = new Map<number, { e: GraphEdge; type: string; types?: Set<string> }>()
  const edges: GraphEdge[] = []
  const degree = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    for (const [type, to] of links[i]) {
      const j = to === null ? undefined : index.get(to)
      if (j === undefined || j === i) continue
      const key = i < j ? i * n + j : j * n + i
      const had = seen.get(key)
      if (had) {
        if (type !== had.type) (had.types ??= new Set([had.type])).add(type)
        if (had.e.from !== files[i].path) had.e.both = true
        continue
      }
      const e: GraphEdge = { from: files[i].path, to: to! }
      seen.set(key, { e, type })
      edges.push(e)
      degree[i]++
      degree[j]++
    }
  }
  const pairs = new Map<number, GraphEdge>()
  for (const [k, { e, type, types }] of seen) {
    if (types || type !== BODY) e.types = types ? [...types] : [type]
    pairs.set(k, Object.freeze(e))
  }
  return { graph: { nodes: files.map((f, i) => nodeOf(f, degree[i])), edges }, files, links, index, pairs, degree }
}

/** Adjacency: each path's neighbours (linked either way). */
export function adjacency(g: Graph) {
  const adj = new Map<string, Set<string>>()
  for (const n of g.nodes) adj.set(n.path, new Set())
  for (const e of g.edges) { adj.get(e.from)?.add(e.to); adj.get(e.to)?.add(e.from) }
  return adj
}

/** How far out a local graph goes at most, as in Obsidian. */
export const MAX_DEPTH = 5

/** Which links a local graph follows out from a file: those to it (`incoming`), from it (`outgoing`), and whether it
 *  shows the links between files the same distance out (`neighbors`). Left out: true. */
export type Direction = { incoming?: boolean; outgoing?: boolean; neighbors?: boolean }

/** Whether a link can be followed out from `p`, in the directions asked for. */
const follows = (e: GraphEdge, p: string, dir: Direction) =>
  (dir.outgoing !== false && (e.from === p || (!!e.both && e.to === p))) || (dir.incoming !== false && (e.to === p || (!!e.both && e.from === p)))

/** The local graph around `path`: it, what's within `depth` links of it (either way, or as `dir` says), and the edges
 *  between them. Each node's `dist` is how many links away it is. */
export function localGraph(g: Graph, path: string, depth = 1, dir: Direction = {}): Graph & { dist: Map<string, number> } {
  const dist = new Map<string, number>()
  if (!g.nodes.some((n) => n.path === path)) return { nodes: [], edges: [], dist }
  const all = dir.incoming !== false && dir.outgoing !== false
  dist.set(path, 0)
  // (a pass over the edges a ring: cheaper than an index of them, made again for each graph)
  for (let d = 1, grew = true; grew && d <= Math.max(1, Math.min(MAX_DEPTH, depth)); d++) {
    grew = false
    for (const e of g.edges) {
      const a = dist.get(e.from), b = dist.get(e.to)
      if (a === d - 1 && b === undefined && (all || follows(e, e.from, dir))) { dist.set(e.to, d); grew = true }
      else if (b === d - 1 && a === undefined && (all || follows(e, e.to, dir))) { dist.set(e.from, d); grew = true }
    }
  }
  // (without neighbour links, only the links that lead out from the file, one step at a time)
  const outward = (e: GraphEdge) => {
    const a = dist.get(e.from)!, b = dist.get(e.to)!
    return Math.abs(a - b) === 1 && (all || follows(e, a < b ? e.from : e.to, dir))
  }
  return {
    nodes: g.nodes.filter((n) => dist.has(n.path)),
    edges: g.edges.filter((e) => dist.has(e.from) && dist.has(e.to) && (dir.neighbors !== false || outward(e))),
    dist,
  }
}

/** A file that isn't a note (an image, a PDF, a drawing): what the Attachments switch leaves out. */
export const isAttachment = (n: GraphNode) => !n.tag && !/\.md$/i.test(n.path)

/** The graph with each of its files' tags as a dot ("#name", its degree how many files have it), linked to them. */
export function withTags(g: Graph): Graph {
  const tags = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  for (const n of g.nodes) {
    if (n.tag) continue
    for (const t of new Set(n.tags.map((x) => x.toLowerCase()))) {
      let node = tags.get(t)
      if (!node) tags.set(t, node = { path: `#${n.tags.find((x) => x.toLowerCase() === t)}`, title: "", type: null, folder: "", tags: [], degree: 0, tag: true })
      node.degree++
      edges.push({ from: n.path, to: node.path })
    }
  }
  for (const n of tags.values()) n.title = n.path
  return tags.size ? { nodes: [...g.nodes, ...tags.values()], edges: [...g.edges, ...edges] } : g
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
  const outOf = new Set(g.edges.filter((e) => e.from === path || (e.both && e.to === path)).map((e) => (e.from === path ? e.to : e.from)))
  const inTo = new Set(g.edges.filter((e) => e.to === path || (e.both && e.from === path)).map((e) => (e.to === path ? e.from : e.to)))
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

// ---------- groups: what colours a dot, and what the legend lists

/** A group of the user's (the `groups` setting): the files a search query matches, in a colour (a token's name, "blue"),
 *  `hidden` left out. The first group a file is in colours it; files in none are coloured by folder or type. */
export type ColorGroup = { query: string; color: string; hidden?: boolean }
export type ColorBy = "folder" | "type" | "none"
/** A legend row: one of the user's groups (`group`: its index) or a folder or type (`auto`: its name, "" for none). */
export type LegendRow = { key: string; label: string; tok: string; count: number; hidden: boolean; group?: number; auto?: string }

/** The colours folders and types get, most files first; the rest are grey. */
export const PALETTE = ["--blue", "--green", "--orange", "--purple", "--pink", "--teal", "--yellow", "--indigo", "--red"]
/** Tags drawn as dots: a colour of their own, out of the groups. */
export const TAG_TOKEN = "--muted-foreground"
/** A colour's name as its token ("blue": --blue); anything else is grey. */
export const tokenOf = (color: unknown) => (typeof color === "string" && /^[a-z][a-z0-9-]*$/.test(color) ? `--${color}` : "--gray")
export const autoOf = (by: ColorBy, n: GraphNode) => (by === "type" ? n.type ?? "" : n.folder)
export const autoLabel = (by: ColorBy, g: string) => g || (by === "type" ? "No type" : "Top level")

/** Each file's group and colour, and the legend: the user's groups in their order, then folders or types, biggest first.
 *  `sets[i]`: the files groups[i]'s query matches (null: none yet); `hidden`: folders and types left out ("folder:Logs"). */
export function grouping(g: Graph | null, by: ColorBy, groups: ColorGroup[], sets: (Set<string> | null)[], hidden: Set<string>) {
  const at = new Map<string, number>()
  const count = new Map<string, number>()
  const mine = groups.map(() => 0)
  for (const n of g?.nodes ?? []) {
    if (n.tag) continue
    const i = groups.findIndex((_, j) => !!sets[j]?.has(n.path))
    if (i >= 0) { at.set(n.path, i); mine[i]++; continue }
    if (by === "none") continue
    const k = autoOf(by, n)
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  const order = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  // (the colours the user's groups have are left to them)
  const free = PALETTE.filter((t) => !groups.some((x) => tokenOf(x.color) === t))
  const tok = new Map(order.map(([k], i) => [k, free[i] ?? "--gray"]))
  const rows: LegendRow[] = [
    ...groups.map((x, i): LegendRow => ({ key: `group:${i}`, label: x.query, tok: tokenOf(x.color), count: mine[i], hidden: !!x.hidden, group: i })),
    ...order.map(([k, c]): LegendRow => ({ key: `${by}:${k}`, label: autoLabel(by, k), tok: tok.get(k)!, count: c, hidden: hidden.has(`${by}:${k}`), auto: k })),
  ]
  return {
    rows,
    colorOf: (n: GraphNode) => {
      if (n.tag) return TAG_TOKEN
      const i = at.get(n.path)
      return i !== undefined ? tokenOf(groups[i].color) : by === "none" ? "--gray" : tok.get(autoOf(by, n)) ?? "--gray"
    },
    /** Whether its group is hidden. */
    hides: (n: GraphNode) => {
      if (n.tag) return false
      const i = at.get(n.path)
      return i !== undefined ? !!groups[i].hidden : by !== "none" && hidden.has(`${by}:${autoOf(by, n)}`)
    },
  }
}

// ---------- link types: the frontmatter keys links are written under

/** Each link type the graph has and how many links have it: the text's first, then the most used. */
export function linkTypes(g: Graph | null): [string, number][] {
  const count = new Map<string, number>()
  for (const e of g?.edges ?? []) for (const t of typesOf(e)) count.set(t, (count.get(t) ?? 0) + 1)
  return [...count].sort((a, b) => (a[0] === BODY ? -1 : b[0] === BODY ? 1 : b[1] - a[1] || a[0].localeCompare(b[0])))
}

/** A link's colour token: its first type, of those not hidden, that has a colour (`colors`: type -> colour name). */
export const linkColour = (e: GraphEdge, colors: Record<string, string>, hidden: Set<string>) => {
  const t = typesOf(e).find((x) => !hidden.has(x) && colors[x])
  return t ? tokenOf(colors[t]) : null
}

/** Without the links whose every type is hidden. */
export function withoutLinks(g: Graph, hidden: Set<string>): Graph {
  return hidden.size ? { nodes: g.nodes, edges: g.edges.filter((e) => typesOf(e).some((t) => !hidden.has(t))) } : g
}
