// The graph's block and sidebar panel; data from /api/graph, asked again when files change, drawn by GraphCanvas (its
// own chunk). Its tabs are GraphPage.tsx.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { SquareArrowOutUpRight, Waypoints } from "lucide-react"
import { cn, HeadingButton, isViewOpen, openFile, openTag, openView, pluginSettings, SidebarHeading, useFocusedFile, useLive, usePatched, useVaultChange, type SidebarCtx } from "@vaultite"
import { filterGraph, grouping, isAttachment, linkColour, localGraph, withoutLinks, withTags, type ColorBy, type ColorGroup, type Direction, type Graph, type GraphEdge } from "./graph"
import type { Look } from "./GraphCanvas"

export const GraphCanvas = lazy(() => import("./GraphCanvas"))

/** The display and force settings, multipliers on the defaults (GraphCanvas). */
export const lookOf = (s: Settings): Look => ({ nodeSize: s.nodeSize, lineWidth: s.lineWidth, textFade: s.textFade, repel: s.repel, linkDistance: s.linkDistance, center: s.center })

/** archived: show archived files (the server leaves them out otherwise). search: the whole graph's filter (a search
 *  query); tags: tags as dots; attachments: files that aren't notes. */
export type Settings = { colorBy?: ColorBy; orphans?: boolean; hidden?: string[]; depth?: number; archived?: boolean
  search?: string; tags?: boolean; attachments?: boolean; groups?: ColorGroup[]
  /** Link types (frontmatter keys, "body" for the text's) left out, and coloured: {"project": "orange"}. */
  hiddenLinks?: string[]; linkColors?: Record<string, string>
  /** A local graph's directions (graph.ts Direction), and arrows on links. */
  incoming?: boolean; outgoing?: boolean; neighbors?: boolean; arrows?: boolean } & Look

/** A local graph's directions, from the settings. */
export const dirOf = (s: Settings): Direction => ({ incoming: s.incoming !== false, outgoing: s.outgoing !== false, neighbors: s.neighbors !== false })
export type Save = (p: Partial<Record<keyof Settings, unknown>>) => void

/** The graph (or a file's local graph), asked again a moment after files change; `archived`: with archived files. */
export function useGraph(path?: string, depth = 1, archived = false) {
  const [v, setV] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useVaultChange((paths) => {
    if (paths && paths.every((p) => p.startsWith("."))) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setV(Date.now()), 800)
  })
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const q = (path ? `graph?path=${encodeURIComponent(path)}&depth=${depth}` : "graph") + (archived ? `${path ? "&" : "?"}archived=true` : "")
  // (the whole vault's comes as a patch of the one drawn: in a big vault that's megabytes less after each change)
  const local = useLive<Graph>(path ? q : null, v || undefined), whole = usePatched<Graph>(path ? null : q, v || undefined)
  return path ? local : whole
}

type Match = { paths?: string[]; error?: string }
/** The files each search query matches (the server reads them: text, properties, tags), asked again as files change;
 *  null for an empty query. The last answer stays while the next comes. */
export function useMatches(queries: string[]) {
  const asked = queries.map((q) => q.trim())
  const some = asked.some(Boolean)
  const { data } = useLive<{ results: Match[] }>(some ? `graph/match?q=${encodeURIComponent(JSON.stringify(asked))}` : null, undefined, true)
  return useMemo(() => asked.map((q, i): { paths: Set<string> | null; error?: string } => {
    const r = q && data?.results.length === asked.length ? data.results[i] : null
    return { paths: r?.paths ? new Set(r.paths) : null, error: r?.error }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, asked.join("\0")])
}

/** What every graph leaves out or adds by the settings, before and after a local graph's walk: attachments, archived
 *  files and hidden groups; then tags as dots. `keep`: the file a local graph is of. */
export function trimmed(g: Graph, s: Settings, keep = "") {
  const attachments = s.attachments !== false
  return attachments && (s.archived || !g.nodes.some((n) => n.archived)) ? g : filterGraph(g, (n) => n.path === keep || ((attachments || !isAttachment(n)) && (!n.archived || !!s.archived)))
}

export const openNode = (p: string, newTab: boolean) => (p.startsWith("#") && !p.includes(".") ? openTag(p.slice(1)) : openFile(p, { newTab }))

/** The graph view's settings (.vaultite/plugins/graph/data.json): changed here at once, saved in the vault. */
export const graphSettings = pluginSettings<Settings>("graph")

/** The user's groups (the `groups` setting), only well-formed ones. */
const groupsOf = (s: Settings): ColorGroup[] => (Array.isArray(s.groups) ? s.groups.filter((g) => g && typeof g.query === "string") : [])

/** The files each of the user's groups has: one request with the search box's query (`first`), whose answer is first. */
export function useGroups(s: Settings, first: string[] = []) {
  const groups = useMemo(() => groupsOf(s), [s.groups]) // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMatches([...first, ...groups.map((g) => g.query)])
  return useMemo(() => ({ groups, first: all.slice(0, first.length), found: all.slice(first.length) }), [all, groups, first.length])
}

/** The link types the settings hide and colour, and each link's colour. */
export function useLinkStyle(s: Settings) {
  return useMemo(() => {
    const hidden = new Set(Array.isArray(s.hiddenLinks) ? s.hiddenLinks.map(String) : [])
    const colors = s.linkColors && typeof s.linkColors === "object" ? s.linkColors : {}
    return { hidden, colors, edgeColor: (e: GraphEdge) => linkColour(e, colors, hidden) }
  }, [s.hiddenLinks, s.linkColors])
}

export const Loading = () => <div className="absolute inset-0 grid place-items-center text-[13px] text-muted-foreground" aria-busy>Drawing the graph…</div>

/** A file's neighbours as a small graph (a block, the sidebar panel), with a button that opens it as a tab. */
export function LocalGraph({ path, depth: asked, height = 260 }: { path: string
  /** Else the settings' Local graph depth. */
  depth?: number; height?: number | string }) {
  const settings = graphSettings.use()
  const depth = asked ?? settings.depth ?? 1
  const by = settings.colorBy ?? "folder"
  const { data: ball, error } = useGraph(path, depth, !!settings.archived)
  const links = useLinkStyle(settings)
  // (the server's walk went through every file: walked again without what the settings leave out)
  const data = useMemo(() => {
    if (!ball) return null
    const g = withoutLinks(trimmed(ball, settings, path), links.hidden)
    const local = localGraph(g, path, depth, dirOf(settings))
    return settings.tags ? withTags(local) : local
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ball, path, depth, links, settings.attachments, settings.archived, settings.tags, settings.incoming, settings.outgoing, settings.neighbors])
  const { groups, found } = useGroups(settings)
  const sets = useMemo(() => found.map((m) => m.paths), [found])
  const { colorOf } = useMemo(() => grouping(data, by, groups, sets, new Set()), [data, by, groups, sets])
  const lone = data && data.nodes.length <= 1
  return (
    <div className="relative" style={{ height }} data-local-graph={path}>
      {error ? <p className="p-3 text-[13px] text-muted-foreground">{error}</p>
        : !data ? <Loading />
        : lone ? <div className="grid h-full place-items-center px-4 text-center text-[13px] text-muted-foreground">No links to or from this file yet.</div>
        : (
          <Suspense fallback={<Loading />}>
            <GraphCanvas graph={data} colorOf={colorOf} edgeColor={links.edgeColor} arrows={!!settings.arrows} look={lookOf(settings)} focus={path} onOpen={openNode} scope={`local:${path}`} compact />
          </Suspense>
        )}
    </div>
  )
}


/** The sidebar's Local graph panel: the focused file's neighbours, in a square as wide as the sidebar. In the rail it's
 *  an icon that opens it beside the rail (`flyout`, a fixed height it fills); as a tab it's FollowingGraph. */
export function LocalGraphPanel({ open: isOpen, file: focused, bounded }: SidebarCtx) {
  const last = useFocusedFile()
  const file = focused || last.path
  return (
    <div className={cn("flex flex-1 flex-col", bounded && "min-h-0")} data-local-graph-panel>
      <SidebarHeading title="Local graph" open={isOpen}>
        <HeadingButton icon={SquareArrowOutUpRight} label="Open local graph in a tab" tip="Open in a tab" onClick={() => openView("local-graph", { newTab: !isViewOpen("local-graph") })} />
        <HeadingButton icon={Waypoints} label="Open graph view" tip="Graph view" onClick={() => openView("graph", { newTab: !isViewOpen("graph") })} />
      </SidebarHeading>
      {/* A graph has no height of its own: a square in the sidebar, the box's height in a flyout. */}
      {file ? <div className={cn("overflow-hidden rounded-[8px]", bounded ? "min-h-0 flex-1" : "aspect-square")}><LocalGraph path={file} height="100%" /></div>
        : <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">Open a file to see its graph.</p>}
    </div>
  )
}
