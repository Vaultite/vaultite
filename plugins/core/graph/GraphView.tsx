// The graph's places in the app (tabs, block, panel); data from /api/graph, asked again when files change, drawn by
// GraphCanvas (its own chunk).
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronRight, Filter, Maximize, Search, SquareArrowOutUpRight, Waypoints, X } from "lucide-react"
import { cn, HeadingButton, isViewOpen, menuFor, openFile, openTag, openView, pluginSettings, SidebarHeading, useFocusedFile, useLive, useVaultChange, type MenuItem, type SidebarCtx } from "@vaultite"
import { BODY, filterGraph, grouping, isAttachment, linkColour, linkTypes, localGraph, nameOf, PALETTE, tokenOf, withoutLinks, withTags, type ColorBy, type ColorGroup, type Direction, type Graph, type GraphEdge, type LegendRow } from "./graph"
import { colourItems, GraphPanel, Swatch } from "./GraphPanel"
import type { Look } from "./GraphCanvas"

const GraphCanvas = lazy(() => import("./GraphCanvas"))

/** The display and force settings, multipliers on the defaults (GraphCanvas). */
const lookOf = (s: Settings): Look => ({ nodeSize: s.nodeSize, lineWidth: s.lineWidth, textFade: s.textFade, repel: s.repel, linkDistance: s.linkDistance, center: s.center })

/** archived: show archived files (the server leaves them out otherwise). search: the whole graph's filter (a search
 *  query); tags: tags as dots; attachments: files that aren't notes. */
export type Settings = { colorBy?: ColorBy; orphans?: boolean; hidden?: string[]; depth?: number; archived?: boolean
  search?: string; tags?: boolean; attachments?: boolean; groups?: ColorGroup[]
  /** Link types (frontmatter keys, "body" for the text's) left out, and coloured: {"project": "orange"}. */
  hiddenLinks?: string[]; linkColors?: Record<string, string>
  /** A local graph's directions (graph.ts Direction), and arrows on links. */
  incoming?: boolean; outgoing?: boolean; neighbors?: boolean; arrows?: boolean } & Look

/** A local graph's directions, from the settings. */
const dirOf = (s: Settings): Direction => ({ incoming: s.incoming !== false, outgoing: s.outgoing !== false, neighbors: s.neighbors !== false })
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
  return useLive<Graph>(q, v || undefined)
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
function trimmed(g: Graph, s: Settings, keep = "") {
  const attachments = s.attachments !== false
  return attachments && (s.archived || !g.nodes.some((n) => n.archived)) ? g : filterGraph(g, (n) => n.path === keep || ((attachments || !isAttachment(n)) && (!n.archived || !!s.archived)))
}

const openNode = (p: string, newTab: boolean) => (p.startsWith("#") && !p.includes(".") ? openTag(p.slice(1)) : openFile(p, { newTab }))

/** The graph view's settings (.vaultite/plugins/graph/data.json): changed here at once, saved in the vault. */
const graphSettings = pluginSettings<Settings>("graph")

/** The user's groups (the `groups` setting), only well-formed ones. */
const groupsOf = (s: Settings): ColorGroup[] => (Array.isArray(s.groups) ? s.groups.filter((g) => g && typeof g.query === "string") : [])

/** The files each of the user's groups has: one request with the search box's query (`first`), whose answer is first. */
function useGroups(s: Settings, first: string[] = []) {
  const groups = useMemo(() => groupsOf(s), [s.groups]) // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMatches([...first, ...groups.map((g) => g.query)])
  return useMemo(() => ({ groups, first: all.slice(0, first.length), found: all.slice(first.length) }), [all, groups, first.length])
}

/** The link types the settings hide and colour, and each link's colour. */
function useLinkStyle(s: Settings) {
  return useMemo(() => {
    const hidden = new Set(Array.isArray(s.hiddenLinks) ? s.hiddenLinks.map(String) : [])
    const colors = s.linkColors && typeof s.linkColors === "object" ? s.linkColors : {}
    return { hidden, colors, edgeColor: (e: GraphEdge) => linkColour(e, colors, hidden) }
  }, [s.hiddenLinks, s.linkColors])
}

/** A link type as the legend names it. */
const typeLabel = (t: string) => (t === BODY ? "In the text" : t)

/** A query that finds a folder's or a type's files, for a legend row coloured by hand (none for "Top level"). */
const queryOf = (by: ColorBy, g: string) => (!g ? null : `${by}:${/[\s()"]/.test(g) ? `"${g}"` : g}`)

const Loading = () => <div className="absolute inset-0 grid place-items-center text-[13px] text-muted-foreground" aria-busy>Drawing the graph…</div>
const tool = "grid size-8 shrink-0 cursor-pointer place-items-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:size-10"

/** The whole vault (arg ""), or a file's local graph (arg: its path), filling the pane. */
export function GraphView({ arg }: { arg: string }) {
  const saved = graphSettings.use()
  // (a slider shows what it does while it's dragged, and is saved once let go)
  const [trying, setTrying] = useState<Partial<Settings>>({})
  const settings = useMemo(() => ({ ...saved, ...trying }), [saved, trying])
  const save = (p: Partial<Record<keyof Settings, unknown>>) => void graphSettings.set(p as Settings).catch(() => {})
  const by = settings.colorBy ?? "folder"
  const depth = settings.depth ?? 1
  // (A file's own graph asks for archived files too: that file may be one.)
  const { data, error } = useGraph(undefined, 1, !!settings.archived || !!arg)
  // The search box filters: the whole graph's is its `search` setting (saved a moment after typing), a local graph's
  // only while it's open.
  const [q, setQ] = useState(() => (arg ? "" : settings.search ?? ""))
  const [asked, setAsked] = useState(q)
  useEffect(() => {
    const t = setTimeout(() => {
      setAsked(q)
      if (!arg && q.trim() !== (graphSettings.get().search ?? "")) save({ search: q.trim() || null })
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, arg])
  // (set elsewhere: by an agent, another device)
  useEffect(() => { if (!arg && (settings.search ?? "") !== asked.trim()) { setQ(settings.search ?? ""); setAsked(settings.search ?? "") } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.search])
  const { groups, first: [found], found: inGroups } = useGroups(settings, [asked])
  const [panel, setPanel] = useState(false)
  const [refit, setRefit] = useState(0)
  // The colours' list, open on computers and folded on phones (it would cover the graph).
  const [legend, setLegend] = useState(() => !matchMedia("(max-width: 767px)").matches)
  const hidden = useMemo(() => new Set(settings.hidden ?? []), [settings.hidden])
  const sets = useMemo(() => inGroups.map((m) => m.paths), [inGroups])
  const { rows, colorOf, hides } = useMemo(() => grouping(data, by, groups, sets, hidden), [data, by, groups, sets, hidden])
  const links = useLinkStyle(settings)
  // (the legend lists link types once some link is in a property)
  const types = useMemo(() => { const t = linkTypes(data); return t.some(([x]) => x !== BODY) ? t : [] }, [data])
  const shown = useMemo(() => {
    if (!data) return null
    let g = withoutLinks(trimmed(data, settings, arg), links.hidden)
    if (arg) g = localGraph(g, arg, depth, dirOf(settings))
    const match = found.paths
    g = filterGraph(g, (n) => n.path === arg || (!hides(n) && (!match || match.has(n.path))))
    if (settings.tags) g = withTags(g)
    if (!arg && settings.orphans === false) {
      const linked = new Set(g.edges.flatMap((e) => [e.from, e.to]))
      g = filterGraph(g, (n) => linked.has(n.path))
    }
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, arg, depth, hides, found, links, settings.orphans, settings.archived, settings.attachments, settings.tags, settings.incoming, settings.outgoing, settings.neighbors])

  const setGroups = (next: ColorGroup[]) => save({ groups: next.length ? next : null })
  const toggle = (r: LegendRow) => {
    if (r.group !== undefined) return setGroups(groups.map((g, i) => (i === r.group ? { ...g, hidden: g.hidden ? undefined : true } : g)))
    const next = new Set(hidden)
    if (next.has(r.key)) next.delete(r.key); else next.add(r.key)
    save({ hidden: next.size ? [...next] : null })
  }
  // A row's menu: its colour (a folder or type coloured by hand becomes a group), hiding it, removing a group.
  const rowMenu = (r: LegendRow): MenuItem[] => {
    const q = r.auto !== undefined ? queryOf(by, r.auto) : null
    const colour = r.group !== undefined ? groups[r.group].color : null
    const items: MenuItem[] = []
    if (r.group !== undefined || q) items.push({ label: "Colour", items: colourItems(colour, (c) => r.group !== undefined
      ? setGroups(groups.map((g, i) => (i === r.group ? { ...g, color: c } : g)))
      : setGroups([...groups, { query: q!, color: c }])), run: () => {} })
    items.push({ label: r.hidden ? "Show these" : "Hide these", run: () => toggle(r) })
    if (r.group !== undefined) items.push({ label: "Remove group", danger: true, sep: true, run: () => setGroups(groups.filter((_, i) => i !== r.group)) })
    return items
  }
  const toggleLink = (t: string) => {
    const next = new Set(links.hidden)
    if (next.has(t)) next.delete(t); else next.add(t)
    save({ hiddenLinks: next.size ? [...next] : null })
  }
  const colourLink = (t: string, c: string | null) => {
    const next = { ...links.colors }
    if (c) next[t] = c; else delete next[t]
    save({ linkColors: Object.keys(next).length ? next : null })
  }
  const linkMenu = (t: string): MenuItem[] => [
    { label: "Colour", run: () => {}, items: [...colourItems(links.colors[t] ?? null, (c) => colourLink(t, c)), { label: "No colour", checked: !links.colors[t], sep: true, run: () => colourLink(t, null) }] },
    { label: links.hidden.has(t) ? "Show these links" : "Hide these links", run: () => toggleLink(t) },
  ]

  return (
    <div className="absolute inset-0 overflow-hidden bg-background" data-graph-view={arg || "vault"}>
      {error ? <p className="p-6 text-[15px] text-muted-foreground">The graph couldn't be read: {error}</p>
        : !shown ? <Loading /> : (
          <Suspense fallback={<Loading />}>
            <GraphCanvas graph={shown} colorOf={colorOf} edgeColor={links.edgeColor} arrows={!!settings.arrows} look={lookOf(settings)} focus={arg || undefined} search={asked} onOpen={openNode} scope={arg ? "local" : "view"} refit={refit} />
          </Suspense>
        )}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start gap-2 max-md:inset-x-2 max-md:top-2">
        <div className="glass pointer-events-auto flex h-10 min-w-0 flex-1 items-center gap-1 rounded-[12px] pr-1 pl-2.5 md:max-w-[340px] max-md:h-11">
          <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={2.25} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={arg ? `Around ${nameOf(arg)}` : "Filter the graph"} aria-label="Filter the graph"
            onKeyDown={(e) => { if (e.key === "Escape") setQ("") }} data-graph-search aria-invalid={!!found.error || undefined} spellCheck={false} autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground max-md:text-[16px]" />
          {q && <button type="button" className={tool} onClick={() => setQ("")} aria-label="Clear"><X className="size-4" strokeWidth={2.25} /></button>}
        </div>
        <div className="glass pointer-events-auto flex h-10 shrink-0 items-center gap-0.5 rounded-[12px] px-1 max-md:h-11">
          <button type="button" className={cn(tool, panel && "bg-foreground/[0.08] text-foreground")} onClick={() => setPanel(!panel)} aria-label="Filters" aria-expanded={panel}
            data-tip={panel ? undefined : "Filters, groups and forces"} data-graph-filters><Filter className="size-4" strokeWidth={2.25} /></button>
          <button type="button" className={tool} onClick={() => setRefit((n) => n + 1)} aria-label="Fit the graph" data-tip="Fit"><Maximize className="size-4" strokeWidth={2.25} /></button>
        </div>
      </div>
      {(found.error || panel) && (
        <div className="pointer-events-none absolute inset-x-3 top-15 bottom-3 flex items-start gap-2 max-md:inset-x-2 max-md:top-15">
          <div className="min-w-0 flex-1">
            {found.error && <p className="glass pointer-events-auto inline-block max-w-full rounded-[10px] px-2.5 py-1.5 text-[13px] text-muted-foreground md:max-w-[340px]" data-graph-search-error>{found.error}</p>}
          </div>
          {panel && <div className="flex max-h-full min-h-0 max-md:absolute max-md:inset-x-0 max-md:top-0 max-md:max-h-[70%]">
            <GraphPanel settings={settings} save={save} try={(p) => setTrying((t) => ({ ...t, ...p }))} tried={() => setTrying({})} local={!!arg} groups={groups} found={inGroups} counts={rows.filter((r) => r.group !== undefined).map((r) => r.count)} setGroups={setGroups} />
          </div>}
        </div>
      )}
      {shown && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-24px)] flex-col items-start gap-2 max-md:bottom-2 max-md:left-2">
          {legend && <div className="glass pointer-events-auto flex max-h-[40vh] max-w-full flex-col overflow-y-auto rounded-[12px] p-1.5 text-[12px]" data-graph-legend>
            {rows.slice(0, groups.length + PALETTE.length + 3).map((r) => (
              <button key={r.key} type="button" onClick={() => toggle(r)} onContextMenu={menuFor(() => rowMenu(r))} aria-pressed={!r.hidden}
                data-graph-group={r.auto ?? r.label} data-graph-own={r.group !== undefined || undefined}
                className={cn("flex h-6 min-w-0 cursor-pointer items-center gap-2 rounded-[6px] px-1.5 text-left hover:bg-foreground/[0.05] max-md:h-8", r.hidden && "opacity-45")}
                data-tip={r.hidden ? "Show these\nRight-click for its colour" : "Hide these\nRight-click for its colour"}>
                <Swatch tok={r.tok} />
                <span className={cn("min-w-0 flex-1 truncate", r.group !== undefined && "font-medium", r.hidden && "line-through")}>{r.label}</span>
                <span className="text-tertiary tabular-nums">{r.count}</span>
              </button>
            ))}
            {types.length > 0 && <div className="mt-1 border-t-[0.5px] border-border px-1.5 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground">Links</div>}
            {types.map(([t, n]) => {
              const off = links.hidden.has(t), c = links.colors[t]
              return (
                <button key={`link:${t}`} type="button" onClick={() => toggleLink(t)} onContextMenu={menuFor(() => linkMenu(t))} aria-pressed={!off} data-graph-link-type={t}
                  className={cn("flex h-6 min-w-0 cursor-pointer items-center gap-2 rounded-[6px] px-1.5 text-left hover:bg-foreground/[0.05] max-md:h-8", off && "opacity-45")}
                  data-tip={off ? "Show these links\nRight-click for their colour" : "Hide these links\nRight-click for their colour"}>
                  <span className="h-[3px] w-2.5 shrink-0 rounded-full" style={{ background: `var(${c ? tokenOf(c) : "--muted-foreground"})` }} aria-hidden />
                  <span className={cn("min-w-0 flex-1 truncate", off && "line-through")}>{typeLabel(t)}</span>
                  <span className="text-tertiary tabular-nums">{n}</span>
                </button>
              )
            })}
          </div>}
          <button type="button" onClick={() => setLegend(!legend)} aria-expanded={legend} data-tip={legend ? "Hide the colours" : "Show the colours"}
            className="glass pointer-events-auto flex cursor-pointer items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] text-muted-foreground tabular-nums hover:text-foreground max-md:py-2" data-graph-count>
            <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", legend && "-rotate-90")} strokeWidth={2.5} />
            {shown.nodes.filter((n) => !n.tag).length} files · {shown.edges.length} links
          </button>
        </div>
      )}
    </div>
  )
}

/** A file's neighbours as a small graph (a block, the sidebar panel), with a button that opens it as a tab. */
export function LocalGraph({ path, depth: asked, height = 260, compact = true, empty }: { path: string
  /** Else the settings' Local graph depth. */
  depth?: number; height?: number | string; compact?: boolean; empty?: ReactNode }) {
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
        : lone ? <div className="grid h-full place-items-center px-4 text-center text-[13px] text-muted-foreground">{empty ?? "No links to or from this file yet."}</div>
        : (
          <Suspense fallback={<Loading />}>
            <GraphCanvas graph={data} colorOf={colorOf} edgeColor={links.edgeColor} arrows={!!settings.arrows} look={lookOf(settings)} focus={path} onOpen={openNode} scope={`local:${path}`} compact={compact} />
          </Suspense>
        )}
    </div>
  )
}

/** The Local graph tab (view:local-graph): the whole-pane graph around the file focused last, following it, as the
 *  sidebar's panel does (drag the panel's heading onto a pane, or its button). */
export function FollowingGraph() {
  const { path } = useFocusedFile()
  if (!path) return <p className="p-6 text-[15px] text-muted-foreground">Open a file to see its local graph here: it follows the file you're on.</p>
  return <GraphView key={path} arg={path} />
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
