// The graph's places in the app (tabs, block, panel); data from /api/graph, asked again when files change, drawn by
// GraphCanvas (its own chunk).
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { ChevronRight, Filter, Maximize, Search, SquareArrowOutUpRight, Waypoints, X } from "lucide-react"
import {
  cn, isViewOpen, menuBelow, openFile, openView, put, SidebarHeading, useFocusedFile, useLive, useVaultChange, type MenuItem, type SidebarCtx,
} from "@vaultite"
import { filterGraph, localGraph, nameOf, type Graph, type GraphNode } from "./graph"

const GraphCanvas = lazy(() => import("./GraphCanvas"))

/** The colours groups get, most files first; the rest are grey. */
const PALETTE = ["--blue", "--green", "--orange", "--purple", "--pink", "--teal", "--yellow", "--indigo", "--red"]

/** archived: show archived files (the server leaves them out otherwise). */
export type Settings = { colorBy?: "folder" | "type"; orphans?: boolean; hidden?: string[]; depth?: number; archived?: boolean }

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

/** The graph view's settings (.vaultite/plugins/graph/data.json): changed here at once, saved in the vault. */
function useSettings(): [Settings, (patch: Settings) => void] {
  const { data } = useLive<Settings>("graph/settings")
  const [mine, setMine] = useState<Settings>({})
  const s = { ...data, ...mine }
  return [s, (patch) => { setMine((m) => ({ ...m, ...patch })); put("graph/settings", patch).catch(() => {}) }]
}

const groupOf = (by: "folder" | "type", n: GraphNode) => (by === "type" ? n.type ?? "" : n.folder)
const groupLabel = (by: "folder" | "type", g: string) => g || (by === "type" ? "No type" : "Top level")

/** Each group's colour token, the biggest groups first. */
function colours(g: Graph | null, by: "folder" | "type") {
  const count = new Map<string, number>()
  for (const n of g?.nodes ?? []) { const k = groupOf(by, n); count.set(k, (count.get(k) ?? 0) + 1) }
  const order = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const tok = new Map(order.map(([k], i) => [k, PALETTE[i] ?? "--gray"]))
  return { order, tok, colorOf: (n: GraphNode) => tok.get(groupOf(by, n)) ?? "--gray" }
}

const open = (p: string, newTab: boolean) => openFile(p, { newTab })
const Loading = () => <div className="absolute inset-0 grid place-items-center text-[13px] text-muted-foreground" aria-busy>Drawing the graph…</div>
const tool = "grid size-8 shrink-0 cursor-pointer place-items-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:size-10"

/** The whole vault (arg ""), or a file's local graph (arg: its path), filling the pane. */
export function GraphView({ arg }: { arg: string }) {
  const [settings, save] = useSettings()
  const by = settings.colorBy ?? "folder"
  const depth = settings.depth ?? 2
  // (A file's own graph asks for archived files too: that file may be one.)
  const { data, error } = useGraph(undefined, 1, !!settings.archived || !!arg)
  const [q, setQ] = useState("")
  const [refit, setRefit] = useState(0)
  // The colours' list, open on computers and folded on phones (it would cover the graph).
  const [legend, setLegend] = useState(() => !matchMedia("(max-width: 767px)").matches)
  const hidden = useMemo(() => new Set(settings.hidden ?? []), [settings.hidden])
  const { order, tok, colorOf } = useMemo(() => colours(data, by), [data, by])
  const shown = useMemo(() => {
    if (!data) return null
    let g: Graph = arg ? localGraph(data, arg, depth) : data
    g = filterGraph(g, (n) => ((!hidden.has(`${by}:${groupOf(by, n)}`) && (!n.archived || settings.archived)) || n.path === arg))
    if (!arg && !settings.orphans) {
      const linked = new Set(g.edges.flatMap((e) => [e.from, e.to]))
      g = filterGraph(g, (n) => linked.has(n.path))
    }
    return g
  }, [data, arg, depth, hidden, by, settings.orphans, settings.archived])

  const toggle = (g: string) => {
    const key = `${by}:${g}`
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key); else next.add(key)
    save({ hidden: [...next] })
  }
  const filters = (e: MouseEvent) => {
    const items: MenuItem[] = []
    if (!arg) {
      items.push({ label: "Show files with no links", checked: !!settings.orphans, run: () => save({ orphans: !settings.orphans }) })
      items.push({ label: "Show archived files", checked: !!settings.archived, run: () => save({ archived: !settings.archived }) })
    } else for (const d of [1, 2, 3]) items.push({ label: d === 1 ? "Direct links" : `${d} links away`, checked: depth === d, run: () => save({ depth: d }) })
    items.push({ label: "Colour by folder", checked: by === "folder", sep: true, run: () => save({ colorBy: "folder" }) })
    items.push({ label: "Colour by type", checked: by === "type", run: () => save({ colorBy: "type" }) })
    if (hidden.size) items.push({ label: "Show every group", sep: true, run: () => save({ hidden: [] }) })
    menuBelow(e, items)
  }

  const matches = q.trim() && shown ? shown.nodes.filter((n) => nameOf(n.path).toLowerCase().includes(q.trim().toLowerCase())).length : null
  return (
    <div className="absolute inset-0 overflow-hidden bg-background" data-graph-view={arg || "vault"}>
      {error ? <p className="p-6 text-[15px] text-muted-foreground">The graph couldn't be read: {error}</p>
        : !shown ? <Loading /> : (
          <Suspense fallback={<Loading />}>
            <GraphCanvas graph={shown} colorOf={colorOf} focus={arg || undefined} search={q} onOpen={open} scope={arg ? "local" : "view"} refit={refit} />
          </Suspense>
        )}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start gap-2 max-md:inset-x-2 max-md:top-2">
        <div className="glass pointer-events-auto flex h-10 min-w-0 flex-1 items-center gap-1 rounded-[12px] pr-1 pl-2.5 md:max-w-[340px] max-md:h-11">
          <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={2.25} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={arg ? `Around ${nameOf(arg)}` : "Find in the graph"} aria-label="Find in the graph"
            onKeyDown={(e) => { if (e.key === "Escape") setQ("") }} data-graph-search
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground max-md:text-[16px]" />
          {q && <button type="button" className={tool} onClick={() => setQ("")} aria-label="Clear"><X className="size-4" strokeWidth={2.25} /></button>}
        </div>
        <div className="glass pointer-events-auto flex h-10 shrink-0 items-center gap-0.5 rounded-[12px] px-1 max-md:h-11">
          <button type="button" className={tool} onClick={filters} aria-label="Filters" data-tip="Filters and colours" data-graph-filters><Filter className="size-4" strokeWidth={2.25} /></button>
          <button type="button" className={tool} onClick={() => setRefit((n) => n + 1)} aria-label="Fit the graph" data-tip="Fit"><Maximize className="size-4" strokeWidth={2.25} /></button>
        </div>
      </div>
      {shown && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-24px)] flex-col items-start gap-2 max-md:bottom-2 max-md:left-2">
          {legend && <div className="glass pointer-events-auto flex max-h-[40vh] max-w-full flex-col overflow-y-auto rounded-[12px] p-1.5 text-[12px]" data-graph-legend>
            {order.slice(0, PALETTE.length + 3).map(([g, n]) => {
              const off = hidden.has(`${by}:${g}`)
              return (
                <button key={g || "-"} type="button" onClick={() => toggle(g)} aria-pressed={!off} data-graph-group={g}
                  className={cn("flex h-6 min-w-0 cursor-pointer items-center gap-2 rounded-[6px] px-1.5 text-left hover:bg-foreground/[0.05] max-md:h-8", off && "opacity-45")}
                  data-tip={off ? "Show these" : "Hide these"}>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(${tok.get(g) ?? "--gray"})` }} />
                  <span className={cn("min-w-0 flex-1 truncate", off && "line-through")}>{groupLabel(by, g)}</span>
                  <span className="text-tertiary tabular-nums">{n}</span>
                </button>
              )
            })}
          </div>}
          <button type="button" onClick={() => setLegend(!legend)} aria-expanded={legend} data-tip={legend ? "Hide the colours" : "Show the colours"}
            className="glass pointer-events-auto flex cursor-pointer items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] text-muted-foreground tabular-nums hover:text-foreground max-md:py-2" data-graph-count>
            <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", legend && "-rotate-90")} strokeWidth={2.5} />
            {shown.nodes.length} files · {shown.edges.length} links{matches !== null ? ` · ${matches} found` : ""}
          </button>
        </div>
      )}
    </div>
  )
}

/** A file's neighbours as a small graph (a block, the sidebar panel), with a button that opens it as a tab. */
export function LocalGraph({ path, depth = 1, height = 260, compact = true, empty }: { path: string; depth?: number; height?: number | string; compact?: boolean; empty?: ReactNode }) {
  const [settings] = useSettings()
  const by = settings.colorBy ?? "folder"
  const { data, error } = useGraph(path, depth, !!settings.archived)
  const { colorOf } = useMemo(() => colours(data, by), [data, by])
  const lone = data && data.nodes.length <= 1
  return (
    <div className="relative" style={{ height }} data-local-graph={path}>
      {error ? <p className="p-3 text-[13px] text-muted-foreground">{error}</p>
        : !data ? <Loading />
        : lone ? <div className="grid h-full place-items-center px-4 text-center text-[13px] text-muted-foreground">{empty ?? "No links to or from this file yet."}</div>
        : (
          <Suspense fallback={<Loading />}>
            <GraphCanvas graph={data} colorOf={colorOf} focus={path} onOpen={open} scope={`local:${path}`} compact={compact} />
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

const button = "grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"

/** The sidebar's Local graph panel: the focused file's neighbours, in a square as wide as the sidebar. In the rail it's
 *  an icon that opens it beside the rail (`flyout`, a fixed height it fills); as a tab it's FollowingGraph. */
export function LocalGraphPanel({ open: isOpen, file: focused, bounded }: SidebarCtx) {
  const last = useFocusedFile()
  const file = focused || last.path
  return (
    <div className={cn("flex flex-1 flex-col", bounded && "min-h-0")} data-local-graph-panel>
      <SidebarHeading title="Local graph" open={isOpen}>
        <button type="button" className={button} aria-label="Open local graph in a tab" data-tip="Open in a tab"
          onClick={() => openView("local-graph", { newTab: !isViewOpen("local-graph") })}><SquareArrowOutUpRight className="size-3.5" strokeWidth={2.25} /></button>
        <button type="button" className={button} aria-label="Open graph view" data-tip="Graph view"
          onClick={() => openView("graph", { newTab: !isViewOpen("graph") })}><Waypoints className="size-3.5" strokeWidth={2.25} /></button>
      </SidebarHeading>
      {/* A graph has no height of its own: a square in the sidebar, the box's height in a flyout. */}
      {file ? <div className={cn("overflow-hidden rounded-[8px]", bounded ? "min-h-0 flex-1" : "aspect-square")}><LocalGraph path={file} height="100%" /></div>
        : <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">Open a file to see its graph.</p>}
    </div>
  )
}
