// Desktop: the main area, groups of tabs in a tree of splits. Every group is drawn at its place in one
// flat list, so splitting or closing a pane never remounts the others (an editor keeps its cursor, a terminal its screen).
import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import type { Store } from "@/core/data"
import { confirmDialog } from "@/components/ConfirmDialog"
import type { ViewDef } from "@/core/define"
import { closeTab, focusGroup, replaceTabTarget, selectTab, setCloseGuard, setOpenElsewhere, setPageTest, setTabCloser, setTabKeeper, useWorkspace } from "@/core/workspace"
import { dropAt, dropOn, PANES, type Drop } from "@/core/drop"
import { evenOut, resize } from "@/core/splits"
import { layout, shownTab, tabPath, type Divider as DividerAt, type Group, type Rect } from "@/core/layout"
import { PaneContext } from "@/core/pane"
import { VaultLoading } from "@/components/VaultLoading"
import { isPage } from "@/core/pages"
import { fillsPane, names, openElsewhere, usePluginsVersion, viewFor } from "@/core/plugins"
import { getPrefs, usePrefs } from "@/core/prefs"
import { FileView } from "@/components/FileView"
import { Drawn, Guard } from "@/components/Guard"
import { DragGhost, TabBar, tabMenuOf, useTabInfo, type TabInfo } from "@/components/Tabs"
import { menuFor } from "@/components/ContextMenu"
import { NewTab } from "@/components/NewTab"
import { useDropHit, useDropTarget } from "@/core/drag"
import { Resizer } from "@/components/Resizer"
import { ViewBar } from "@/components/ViewBar"
import { keepScroll, restoreScroll, scrollOf } from "@/core/viewstate"
import { cn } from "@/lib/utils"

setTabCloser((to) => { const v = viewFor(to, getPrefs().disabled); if (v?.on) v.def.onClose?.(v.arg) })
setOpenElsewhere((to) => openElsewhere(to, getPrefs().disabled))
setTabKeeper((to) => !!viewFor(to, getPrefs().disabled)?.def.keepsTab)
setPageTest((path) => isPage(path))
// Views that ask before their tabs close (a terminal running something): one question per view, in turn.
setCloseGuard(async (tos) => {
  const byView = new Map<ViewDef, string[]>()
  for (const to of tos) {
    const v = viewFor(to, getPrefs().disabled)
    if (v?.on && v.def.confirmClose) byView.set(v.def, [...(byView.get(v.def) ?? []), v.arg])
  }
  for (const [def, args] of byView) {
    const ask = await def.confirmClose!(args)
    if (ask && !(await confirmDialog(ask))) return false
  }
  return true
})

/** A core page a tab can show (Plugins, Settings). */
export type PageTab = { label: string; render?: (store: Store) => ReactNode }
type Props = {
  store: Store | null; error: string | null
  /** Where it starts: the sidebar's width (a CSS length: px open, spacing units as the rail). */
  left: string
  /** Where it ends: the right sidebar's width ("0px" without one). */
  right?: string
  page: (to: string) => PageTab | null
  pageInfo: (id: string) => TabInfo | null
}

const pct = (n: number) => `${n * 100}%`
const place = (r: Rect) => ({ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) })

export function Workspace(props: Props) {
  const { root, focus } = useWorkspace()
  const info = useTabInfo(props.store, props.pageInfo)
  const box = useRef<HTMLDivElement>(null)
  const { panes, dividers } = layout(root)
  const alone = panes.length === 1
  // Tabs, and files or pages from the sidebar, dropped on a tab bar or a pane.
  useDropTarget<Drop>(PANES, dropAt, dropOn)
  return (
    <div ref={box} className="fixed inset-y-0 z-10 transition-[left,right] duration-200 ease-out" style={{ left: props.left, right: props.right ?? 0 }}>
      {panes.map(({ group: g, rect }) => (
        // A pane not at the workspace's left or top edge draws the line to its neighbour;
        // data-top/corner/right-corner place the desktop title bar and the right sidebar's toggle (index.css).
        <section key={g.id} aria-label="Pane" data-group={g.id} data-top={rect.y < 1e-6 || undefined} data-corner={(rect.y < 1e-6 && rect.x < 1e-6) || undefined}
          data-right-corner={(rect.y < 1e-6 && rect.x + rect.w > 1 - 1e-6) || undefined}
          onPointerDownCapture={() => focusGroup(g.id)} style={place(rect)}
          className={cn("absolute flex min-h-0 min-w-0 flex-col border-border", rect.x > 1e-6 && "border-l", rect.y > 1e-6 && "border-t")}>
          <TabBar group={g} focused={g.id === focus} info={info} alone={alone} />
          {g.stacked ? <Stacked group={g} focused={g.id === focus} info={info} {...props} /> : <Pane group={g} focused={g.id === focus} {...props} />}
        </section>
      ))}
      {dividers.map((d) => <Divider key={`${d.split.id}:${d.i}`} at={d} box={box} />)}
      <DragGhost info={info} />
    </div>
  )
}

/** How many of a pane's tabs stay drawn (hidden), so going back to one is instant and exactly as left. A view that
 *  fills the pane (a terminal, a canvas) is drawn only while shown. */
const KEEP = 5

/** The tabs a pane keeps drawn (`slots`, in draw order) and the tabs shown, latest first. A tab coming or going never
 *  reorders the others: an element that moves reloads what's in it (an iframe). */
type Kept = { slots: string[]; recent: string[] }
function keepTabs(k: Kept, ids: string[], shown: string | null): Kept {
  const has = new Set(ids)
  const recent = [...(shown ? [shown] : []), ...k.recent.filter((id) => id !== shown && has.has(id))]
  const keep = new Set(recent.slice(0, KEEP))
  const slots = [...k.slots.filter((id) => keep.has(id)), ...[...keep].filter((id) => !k.slots.includes(id))]
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
  return same(slots, k.slots) && same(recent, k.recent) ? k : { slots, recent }
}

function Pane({ group, focused, ...p }: Props & { group: Group; focused: boolean }) {
  const hit = useDropHit<Drop>(PANES)
  const tab = shownTab(group) ?? group.tabs[0]
  // (worked out while drawing, from what was kept the last time: React's state from earlier renders)
  const [was, setKept] = useState<Kept>({ slots: [], recent: [] })
  const kept = keepTabs(was, group.tabs.map((t) => t.id), tab?.id ?? null)
  if (kept !== was) setKept(kept)
  // While a tab (or a file) is dragged over this pane: where it would go (an edge: that half, a new split; the middle: the pane).
  const zone = hit?.kind === "pane" && hit.group === group.id ? hit.zone : null
  return (
    <div data-pane-body={group.id} className="relative min-h-0 flex-1">
      {kept.slots.map((id) => {
        const t = group.tabs.find((x) => x.id === id)!
        return <TabBody key={id} group={group.id} tab={t} shown={t.id === tab?.id} focused={focused} {...p} />
      })}
      {!tab && <TabBody group={group.id} tab={null} shown focused={focused} {...p} />}
      {zone && <DropZone zone={zone} />}
    </div>
  )
}

type Tab = Group["tabs"][number]

/** Where a dragged tab would land in a pane: its middle, or a half for a new split. */
function DropZone({ zone }: { zone: string }) {
  return (
    <div aria-hidden data-drop-zone={zone} className={cn("pointer-events-none absolute z-20 rounded-[6px] border-2 border-primary/50 bg-primary/15 transition-[inset] duration-100",
      zone === "center" ? "inset-1" : zone === "left" ? "inset-y-1 left-1 right-1/2" : zone === "right" ? "inset-y-1 left-1/2 right-1"
        : zone === "top" ? "inset-x-1 top-1 bottom-1/2" : "inset-x-1 top-1/2 bottom-1")} />
  )
}

/** A spine's width (a stacked tab's title, on its left edge), in px. */
const SPINE = 36

/** A pane's tabs stacked: side by side, each sticking by its spine as the next slides over. The active
 *  one is the pane's (#main-scroll) and scrolls into view when it changes; a click on a tab or spine activates it. */
function Stacked({ group, focused, info, ...p }: Props & { group: Group; focused: boolean; info: (t: Tab) => TabInfo }) {
  const row = useRef<HTMLDivElement>(null)
  const hit = useDropHit<Drop>(PANES)
  const zone = hit?.kind === "pane" && hit.group === group.id ? hit.zone : null
  const n = group.tabs.length
  const at = group.tabs.findIndex((t) => t.id === group.active)
  useLayoutEffect(() => {
    const r = row.current
    const col = r?.children[at] as HTMLElement | undefined
    if (!r || !col) return
    // In full view between the spines stuck at the left and those waiting at the right.
    const w = col.offsetWidth
    const lo = (at + 1) * w - r.clientWidth + (n - 1 - at) * SPINE, hi = at * (w - SPINE)
    const to = Math.min(Math.max(r.scrollLeft, lo), hi)
    if (Math.abs(to - r.scrollLeft) > 1) r.scrollTo({ left: to, behavior: "smooth" })
  }, [at, n])
  return (
    <div data-pane-body={group.id} className="relative min-h-0 flex-1">
      <div ref={row} data-stack={group.id} className="flex h-full overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:thin]">
        {group.tabs.map((t, i) => {
          const active = t.id === group.active
          const ti = info(t)
          return (
            <div key={t.id} data-stacked-tab={t.id} onPointerDownCapture={() => { if (!active) selectTab(t.id) }}
              style={{ left: i * SPINE, right: `calc(${(n - i) * SPINE}px - min(700px, 100%))` }}
              className="sticky flex h-full w-[min(700px,100%)] shrink-0 border-l-[0.5px] border-border bg-background shadow-[-6px_0_12px_-8px_rgb(0_0_0/0.25)] first:border-l-0">
              <div className="group/spine relative flex w-9 shrink-0 cursor-pointer flex-col items-center gap-2 border-r-[0.5px] border-border py-2 hover:bg-foreground/[0.04]"
                onClick={() => selectTab(t.id)} onContextMenu={menuFor(() => tabMenuOf(t.id))} role="button" tabIndex={0} aria-label={ti.label} data-stack-spine={t.id}>
                <ti.icon className={cn("size-3.5 shrink-0", !ti.tint && "text-muted-foreground", ti.iconClassName)} strokeWidth={2.25} style={ti.tint ? { color: ti.tint } : undefined} />
                <span className={cn("min-h-0 truncate text-[13px] [writing-mode:vertical-rl]", active ? "font-medium text-foreground" : "text-muted-foreground")}>{ti.label}</span>
                {!t.pinned && (
                  <button type="button" data-no-drag aria-label={`Close ${ti.label}`} onClick={(e) => { e.stopPropagation(); closeTab(t.id) }}
                    className="mt-auto grid size-5 shrink-0 cursor-pointer place-items-center rounded-[4px] text-muted-foreground opacity-0 group-hover/spine:opacity-100 focus-visible:opacity-100 hover:bg-foreground/[0.08] hover:text-foreground">
                    <X className="size-3.5" strokeWidth={2} />
                  </button>
                )}
              </div>
              <div className="relative h-full min-w-0 flex-1">
                <TabBody group={group.id} tab={t} shown active={active} focused={focused} {...p} />
              </div>
            </div>
          )
        })}
      </div>
      {zone && <DropZone zone={zone} />}
    </div>
  )
}

/** One tab of a pane, in its own scroller: shown, or kept drawn but hidden (display: none, out of the keyboard's and
 *  the commands' reach: its PaneContext isn't focused). Stacked, every tab is shown and one is `active` (the pane's). */
function TabBody({ group, tab, shown, active = shown, focused: paneFocused, ...p }: Props & { group: string; tab: Tab | null; shown: boolean; active?: boolean; focused: boolean }) {
  const { disabled } = usePrefs()
  usePluginsVersion() // (a plugin taking a file: it may fill the pane now)
  const focused = paneFocused && active
  const to = tab?.to ?? "new"
  const view = to.startsWith("view:") ? viewFor(to, disabled) : null
  // The whole pane, no padding or scrolling of the tab's own: a view that says so (`full`), or a file whose format does
  // (`layout: "pane"`: a canvas), which then lays out its bar and drawing itself (FileView's PaneFile).
  const file = tabPath(to)
  const full = view ? !!view.on && !!view.def.full : !!file && fillsPane(file, disabled)
  // Each place comes back scrolled to where it was left (core/viewstate.ts). What the box scrolls while the next file
  // comes in (the browser clamping to a shorter page) isn't kept as anyone's place.
  const box = useRef<HTMLDivElement>(null)
  const place = useRef(to)
  const restoring = useRef(false)
  // (Once the vault is loaded: where places were left is kept per vault, and there's nothing to scroll before.)
  const loaded = !!p.store
  useLayoutEffect(() => {
    place.current = to
    if (!box.current || full || !loaded) return
    restoring.current = true
    return restoreScroll(box.current, scrollOf(to), () => { restoring.current = false }, to)
  }, [to, full, loaded])
  const wasShown = useRef(shown)
  useLayoutEffect(() => {
    if (shown && !wasShown.current && box.current && !full) box.current.scrollTop = scrollOf(place.current)
    // (hidden, what plays in it stops, as it did when a tab left was drawn no more)
    if (!shown && wasShown.current) for (const m of box.current?.querySelectorAll("audio, video") ?? []) (m as HTMLMediaElement).pause()
    wasShown.current = shown
  }, [shown, full])
  const pane = useMemo(() => ({ group, focused, hidden: !shown, tab: tab?.id }), [group, focused, shown, tab?.id])
  // (a stacked tab that isn't the active one: data-stacked, so what looks for the pane's scroller finds the active one)
  const back = shown && !active
  // A view that fills the pane isn't kept: drawn only while it's shown.
  if (!shown && full) return null
  // The focused pane's shown scroller is #main-scroll (scrollPage scrolls it).
  const scroller = cn("h-full min-h-0", full ? "relative overflow-hidden" : "overflow-y-auto overscroll-contain [scrollbar-gutter:stable]")
  return (
    <PaneContext.Provider value={pane}>
      {/* (a kept tab is data-kept, not data-pane: what looks for the pane's scroller finds the one shown) */}
      <div ref={box} id={focused ? "main-scroll" : undefined} data-pane={active ? group : undefined} data-kept={shown ? undefined : group} data-stacked={back ? group : undefined}
        className={scroller} style={shown ? undefined : { display: "none" }}
        onScroll={(e) => { if (!restoring.current && shown) keepScroll(place.current, e.currentTarget.scrollTop, e.currentTarget) }}>
        <TabContent {...p} tab={tab} to={to} view={view} file={file} full={full} focused={focused} shown={shown} />
      </div>
    </PaneContext.Provider>
  )
}

/** What a tab shows. Hidden, it's drawn once as hidden and then left as it is until it's shown again: kept tabs cost
 *  nothing while the vault changes (what subscribes for itself, an open file's text, still follows). */
const TabContent = memo(function TabContent({ tab, to, view, file, full, focused, ...p }: Props & {
  tab: Tab | null; to: string; view: ReturnType<typeof viewFor>; file: string | null; full: boolean; focused: boolean; shown: boolean
}) {
  const padded = (wide: boolean, bar: ReactNode, body: ReactNode) => (
    <main className={cn("mx-auto px-8 pb-6", wide ? "max-w-none" : "max-w-[912px]")}>{bar}{body}</main>
  )
  let body: ReactNode = null
  if (!p.store) body = padded(false, null, p.error ? <p className="mt-10 text-muted-foreground">Couldn't reach the server: {p.error}</p> : <VaultLoading />)
  else if (file) body = full ? <div className="absolute inset-0"><FileView store={p.store} path={file} pane /></div> : padded(true, null, <FileView store={p.store} path={file} pane />)
  else if (view && tab) {
    const title = view.def.title(view.arg)
    const name = to.slice(5).split("/")[0]
    const ctx = { store: p.store, arg: view.arg, focused, close: () => closeTab(tab.id, true), setArg: (arg: string) => replaceTabTarget(tab.id, `view:${name}${arg ? `/${arg}` : ""}`) }
    if (!view.on) body = padded(false, <ViewBar>{title}</ViewBar>, <p className="mt-6 text-[15px] text-muted-foreground">{names([view.plugin.id])} is off. Turn it on in Plugins to open this tab.</p>)
    else if (full) body = <div className="absolute inset-0"><Drawn draw={() => view.def.render(ctx)} /></div>
    else body = padded(false, <ViewBar>{title}</ViewBar>, <Drawn draw={() => view.def.render(ctx)} />)
  } else if (to.startsWith("view:")) body = padded(false, <ViewBar>{to.slice(5)}</ViewBar>, <p className="mt-6 text-[15px] text-muted-foreground">No plugin draws this tab.</p>)
  else if (to === "new") body = padded(false, <ViewBar>New tab</ViewBar>, <NewTab store={p.store} />)
  else {
    const page = p.page(to)
    if (page?.render) body = padded(false, <ViewBar>{page.label}</ViewBar>, <Drawn draw={() => page.render!(p.store!)} />)
  }
  // A view whose arg is its own state (a search's query) stays mounted while it changes. One that fails to draw fails
  // alone, in its tab, which can close (else the app stops, and a reload opens it again).
  return (
    <Fragment key={view?.def.argState ? to.split("/")[0] : to}>
      <Guard what="This tab" size="tab" reset={to} close={tab ? () => closeTab(tab.id) : undefined}>{body}</Guard>
    </Fragment>
  )
}, (was, now) => !was.shown && !now.shown)

/** Between two parts of a split: drag to resize, double-click to make the split's parts equal again. */
function Divider({ at: d, box }: { at: DividerAt; box: React.RefObject<HTMLDivElement | null> }) {
  const row = d.split.dir === "row"
  const r = d.rect
  const move = (x: number, y: number) => {
    const b = box.current?.getBoundingClientRect()
    if (!b) return
    // Where the pointer is, as a share of the split's own box; no part narrower than 200px (lower than 120px).
    const at = row ? ((x - b.left) / b.width - r.x) / r.w : ((y - b.top) / b.height - r.y) / r.h
    resize(d.split.id, d.i, at, row ? 200 / (b.width * r.w) : 120 / (b.height * r.h))
  }
  const style = row
    ? { left: `calc(${pct(r.x + d.at * r.w)} - 3px)`, top: pct(r.y), height: pct(r.h), width: 7 }
    : { top: `calc(${pct(r.y + d.at * r.h)} - 3px)`, left: pct(r.x), width: pct(r.w), height: 7 }
  return <Resizer label="Resize the split" horizontal={!row} onDrag={move} onReset={() => evenOut(d.split.id)} resetTip="even it out"
    style={style} className="absolute" />
}
