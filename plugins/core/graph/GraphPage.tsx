// The graph view's tab (view:graph, view:graph/<path>, view:local-graph), apart from GraphView.tsx (the sidebar panel and
// block draw at launch): it loads with its first tab.
import { Suspense, useEffect, useMemo, useState } from "react"
import { ChevronRight, Filter, Maximize, Search, X } from "lucide-react"
import { cn, menuFor, useFocusedFile, type MenuItem } from "@vaultite"
import { BODY, filterGraph, grouping, linkTypes, localGraph, nameOf, PALETTE, tokenOf, withoutLinks, withTags, type ColorBy, type ColorGroup, type LegendRow } from "./graph"
import { colourItems, GraphPanel, Swatch } from "./GraphPanel"
import { dirOf, GraphCanvas, graphSettings, Loading, lookOf, openNode, trimmed, useGraph, useGroups, useLinkStyle, type Settings } from "./GraphView"

/** A link type as the legend names it. */
const typeLabel = (t: string) => (t === BODY ? "In the text" : t)

/** A query that finds a folder's or a type's files, for a legend row coloured by hand (none for "Top level"). */
const queryOf = (by: ColorBy, g: string) => (!g ? null : `${by}:${/[\s()"]/.test(g) ? `"${g}"` : g}`)

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
      {error ? <p className="p-6 text-[15px] text-muted-foreground">{error}</p>
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

/** The Local graph tab (view:local-graph): the whole-pane graph around the file focused last, following it, as the
 *  sidebar's panel does (drag the panel's heading onto a pane, or its button). */
export function FollowingGraph() {
  const { path } = useFocusedFile()
  if (!path) return <p className="p-6 text-[15px] text-muted-foreground">Open a file to see its local graph here: it follows the file you're on.</p>
  return <GraphView key={path} arg={path} />
}
