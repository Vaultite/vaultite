// Desktop: the window's tab bar over the shown tab's panes. Every pane is drawn in one flat list, the last few tabs' kept
// hidden, so switching tabs, splitting or moving a pane between tabs never remounts the others (an editor keeps its cursor).
import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Minimize2, PictureInPicture2 } from "lucide-react"
import type { Store } from "@/core/data"
import { confirmDialog } from "@/components/ConfirmDialog"
import type { ViewDef } from "@/core/define"
import { useHeldHeight } from "@/core/heights"
import { closePane, paneById, quietly, replaceTabTarget, setArchivable, setCloseGuard, setFocusedPane, setOpenElsewhere, setOpener, setOwnHistory, setPageTest, setPathView, setTabCloser, setTabKeeper, setWorkspaceOf, useTabList } from "@/core/workspace"
import { dropAt, dropOn, PANES, springOver, type Drop } from "@/core/drop"
import { dockPane, evenOut, placeFloat, resize, zoomPane } from "@/core/splits"
import { paneBoxes, paneGap, usePaneMotion } from "@/core/panemotion"
import { useCommandKeys } from "@/core/commands"
import { setGroupNamer } from "@/core/tabgroups"
import { layout, panesOf, shownTab, tabOfPane, tabPath, type Divider as DividerAt, type Pane, type Rect, type Tab, type TabList } from "../../../core/layout.ts"
import { PaneContext } from "@/core/pane"
import { VaultLoading } from "@/components/VaultLoading"
import { isPage } from "@/core/pages"
import { currentWorkspace } from "@/core/scope"
import { fillsPane, offText, openElsewhere, switchedOn, usePluginsVersion, viewFor } from "@/core/plugins"
import { getPrefs, usePrefs } from "@/core/prefs"
import { FileView } from "@/components/FileView"
import { Drawn, Guard } from "@/components/Guard"
import { DragGhost, PaneBar, springTabAt, tabBarOn, TabStrip, tabLabel, useTabInfo, type TabInfo } from "@/components/Tabs"
import { NewTab, useNewTabPage } from "@/components/NewTab"
import { useDrag, useDropTarget, type DragItem } from "@/core/drag"
import { Resizer } from "@/components/Resizer"
import { ViewBar } from "@/components/ViewBar"
import { keepScroll, restoreScroll, scrollOf } from "@/core/viewstate"
import { cn } from "@/lib/utils"
import { unsavedIn } from "@/core/unsaved"

setTabCloser((to, pane, last, moved) => {
  const v = viewFor(to, getPrefs().disabled)
  if (!v?.on) return false
  v.def.onTabClose?.(v.arg, pane, moved)
  if (last) v.def.onClose?.(v.arg)
  return !!v.def.onTabClose
})
setOpenElsewhere((to) => openElsewhere(to, getPrefs().disabled))
// (what closes is the workspace's, as its tabs are: ⌘⇧T reopens there)
setWorkspaceOf(() => currentWorkspace()?.n ?? 0)
setTabKeeper((to) => !!viewFor(to, getPrefs().disabled)?.def.keepsTab)
setPathView((to) => !!viewFor(to, getPrefs().disabled)?.def.pathArg)
setGroupNamer((to) => { const v = viewFor(to, getPrefs().disabled); return (v?.on && v.def.groupName?.(v.arg)) || null })
setOpener((to) => { const v = viewFor(to, getPrefs().disabled); return (v?.on && v.def.opensBeside?.(v.arg)) || null })
setOwnHistory((p, dir) => { const v = viewFor(p.to, getPrefs().disabled); return (v?.on && v.def.history?.(v.arg, p.id, dir)) || null })
setPageTest((path) => isPage(path))
setArchivable((p) => {
  if (p.to.startsWith("file:")) return !unsavedIn(p.to.slice(5))
  if (!p.to.startsWith("view:")) return true
  const v = viewFor(p.to, getPrefs().disabled), a = v?.def.archives
  if (!v?.on) return false
  try { return typeof a === "function" ? a(v.arg, p.id) : a ?? !(v.def.keepsTab || v.def.onClose || v.def.confirmClose) } catch { return false }
})
// Views that ask before their panes close (a terminal running something): one question per view, in turn.
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

/** A core page a pane can show (Setup, Settings), drawn for its address `to` in `pane`. `full`: it lays out and scrolls
 *  itself under the pane's bar (RailLayout), and is kept drawn while hidden, as other pages are. */
type PageTab = { label: string; full?: boolean; render?: (store: Store, to: string, pane: Pane | null) => ReactNode }
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
// Tiled panes leave --pane-gap around and between them (appearance `paneCards`, index.css; 0 otherwise): shares of what's
// left once one gap is taken, each pane then a gap in from its share's start.
const G = "var(--pane-gap)"
const along = (at: number) => `calc(${at} * (100% - ${G}) + ${G})`
const span = (n: number) => `calc(${n} * (100% - ${G}) - ${G})`
const tile = (r: Rect) => ({ left: along(r.x), top: along(r.y), width: span(r.w), height: span(r.h) })

/** How many tabs stay drawn (their panes hidden), so going back to one is instant and exactly as left. A view that
 *  fills its pane (a terminal, a canvas) is drawn only while shown. */
const KEEP = 5

/** The panes drawn (`slots`, in draw order) and the tabs shown, latest first. A pane coming or going never reorders the
 *  others: an element that moves reloads what's in it (an iframe). */
type Kept = { slots: string[]; recent: string[] }
function keepPanes(k: Kept, l: TabList, shown: string): Kept {
  const has = new Map(l.tabs.map((t) => [t.id, t]))
  const recent = [shown, ...k.recent.filter((id) => id !== shown && has.has(id))].slice(0, KEEP)
  const want = new Set(recent.flatMap((id) => panesOf(has.get(id)!).map((p) => p.id)))
  const slots = [...k.slots.filter((id) => want.has(id)), ...[...want].filter((id) => !k.slots.includes(id))]
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
  return same(slots, k.slots) && same(recent, k.recent) ? k : { slots, recent }
}

/** A dragged pane or tab held on a tab's chip or row opens that tab after a moment (drop.ts), the row holding still:
 *  told here, the one target that hears every move, so the bar and the Tabs panel never undo each other's. */
function springAt(item: DragItem, x: number, y: number) {
  const t = springTabAt(item, x, y)
  springOver(t, item, x, y)
  return t
}

export function Workspace(props: Props) {
  const l = useTabList()
  const tab = shownTab(l) ?? l.tabs[0]
  const prefs = usePrefs(), bar = tabBarOn(prefs)
  const info = useTabInfo(props.store, props.pageInfo)
  const box = useRef<HTMLDivElement>(null)
  const { dividers } = layout(tab.root)
  const shown = panesOf(tab)
  const drawn = paneBoxes(tab)
  usePaneMotion(box, tab.id, drawn, tab.focus, [props.left, props.right ?? "0px"])
  // (a pane dragged by its bar recedes where it was, its card in hand: Tabs' DragGhost)
  const lifted = useDrag((d) => d?.item.pane ?? null)
  // Tabs, panes, and files or pages from the sidebar, dropped on the tab bar or a pane.
  useDropTarget<Drop>(PANES, (item, x, y, el) => dropAt(item, x, y, el, springAt(item, x, y)), dropOn,
    { stay: (d) => d.kind === "list" && !!d.home, end: () => springOver(null, null) })
  // (worked out while drawing, from what was kept the last time: React's state from earlier renders)
  const [was, setKept] = useState<Kept>({ slots: [], recent: [] })
  const kept = keepPanes(was, l, tab.id)
  if (kept !== was) setKept(kept)
  // (the window's only pane: nothing to close it into)
  const only = l.tabs.length === 1 && shown.length === 1
  // (each pane's bar: with the tab bar, a tab of one pane needs none, its chip is its handle)
  const bars = !bar || shown.length > 1
  const z0 = new Map(drawn.map((b) => [b.id, b]))
  // (what sits in the window's corners keeps to the tab bar, not a pane: index.css)
  useLayoutEffect(() => { document.documentElement.toggleAttribute("data-top-tabs", bar) }, [bar])
  return (
    // With the tab bar, it's the window's title row: at the top, in both corners (index.css).
    <main data-top={bar || undefined} data-corner={bar || undefined} data-right-corner={bar || undefined} className="fixed inset-y-0 z-10 flex flex-col" style={{ left: props.left, right: props.right ?? 0 }}>
      {bar && <TabStrip info={info} />}
      <div ref={box} data-pane-area data-split={shown.length > 1 ? "" : undefined} className="relative min-h-0 flex-1">
        {kept.slots.map((id) => {
          const t = tabOfPane(l, id), p = t && panesOf(t).find((x) => x.id === id)
          if (!t || !p) return null
          const b = t.id === tab.id ? z0.get(id) : undefined
          if (!b) return <Fragment key={id}>{null}<Frame pane={p} tab={t} {...props} info={info} />{null}</Fragment>
          const { rect, layer } = b, float = !!p.float, zoomed = id === tab.zoom, focused = id === tab.focus
          // (under a zoomed pane: out of the keyboard's reach, and no part of the window's drag strip)
          const under = !!tab.zoom && !zoomed && !float
          const top = !bar && !under && !float && rect.y < 1e-6
          const z = float ? 20 + 3 * (layer - 2) : zoomed ? 11 : undefined
          const at = float ? place(rect) : tile(rect)
          return (
            <Fragment key={id}>
              {/* Under the pane: its colour while it moves (core/panemotion.ts), a zoomed or floating pane's card. */}
              <div aria-hidden data-plate={id} style={{ ...at, zIndex: z }}
                className={cn("pointer-events-none absolute bg-background", !layer && "invisible", float && "rounded-[10px] shadow-[0_12px_40px_-8px_rgb(0_0_0/0.35),0_2px_8px_-2px_rgb(0_0_0/0.2)] ring-[0.5px] ring-border")} />
              <Frame pane={p} tab={t} {...props} info={info} on={{ at, z, rect, float, zoomed, focused, under, top, lifted: lifted === id, bar: bars, only, box }} />
              {float ? <CardEdges id={id} rect={rect} box={box} z={z! + 1} /> : null}
            </Fragment>
          )
        })}
        {!tab.zoom && dividers.map((d) => <Divider key={`${d.split.id}:${d.i}`} at={d} box={box} />)}
      </div>
      <DragGhost info={info} />
    </main>
  )
}

/** Where a pane on screen is drawn and how. */
type On = { at: Record<string, string>; z?: number; rect: Rect; float: boolean; zoomed: boolean; focused: boolean; under: boolean; top: boolean; lifted: boolean
  /** It has a bar of its own (else its tab's chip is its handle). */
  bar: boolean
  /** The window's only pane, blank. */
  only: boolean; box: React.RefObject<HTMLElement | null> }

/** A pane: its bar and what it shows, on screen (`on`) at its place, else kept hidden (`data-away`) till its tab shows.
 *  data-top/corner/right-corner place the title bar and the right sidebar's toggle (index.css) without a tab bar. */
function Frame({ pane, tab, on, info, ...p }: Props & { pane: Pane; tab: Tab; on?: On; info: (t: Tab | Pane) => TabInfo }) {
  const id = pane.id, r = on?.rect
  return (
    // (named by what it shows, so a screen reader moving between panes hears which is which)
    <section aria-label={info(pane).label} data-pane-frame={id} data-ui={`pane:${id}`} data-away={on ? undefined : ""}
      data-top={on?.top || undefined} data-corner={(on?.top && r!.x < 1e-6) || undefined} data-right-corner={(on?.top && r!.x + r!.w > 1 - 1e-6) || undefined}
      data-floating={on?.float || undefined} data-zoomed={on?.zoomed || undefined} data-focused={on?.focused || undefined}
      data-overlay={on?.float || undefined} inert={!on || on.under || undefined} data-lifted={on?.lifted || undefined}
      onPointerDownCapture={on ? () => setFocusedPane(id) : undefined} onPointerDown={on?.float ? (e) => moveCard(e, id, on.box) : undefined}
      style={on ? { ...on.at, zIndex: on.z && on.z + 2 } : { display: "none" }}
      className={cn("absolute flex min-h-0 min-w-0 flex-col border-border", on?.float ? "overflow-hidden rounded-[10px]" : on && !on.zoomed && cn(r!.x > 1e-6 && "border-l", r!.y > 1e-6 && "border-t"))}>
      {on?.bar ? <PaneBar pane={pane} tab={tab} focused={on.focused} info={info} only={on.only} extra={<PaneState id={id} float={on.float} zoomed={on.zoomed} />} /> : null}
      <PaneBody pane={pane} tab={tab} shown={!!on} focused={!!on?.focused} {...p} />
    </section>
  )
}

/** At a bar's end, accent-tinted as Rex's: a zoomed pane's unzoom, a floating pane's dock (each a click away). */
function PaneState({ id, float, zoomed }: { id: string; float: boolean; zoomed: boolean }) {
  const zoomKeys = useCommandKeys("pane:zoom", true), floatKeys = useCommandKeys("pane:float", true)
  if (!zoomed && !float) return null
  const Icon = zoomed ? Minimize2 : PictureInPicture2, label = zoomed ? "Unzoom pane" : "Dock pane"
  return (
    <button type="button" {...{ [zoomed ? "data-pane-unzoom" : "data-pane-dock"]: id }} aria-label={label} data-tip={`${label}${zoomed ? zoomKeys : floatKeys}`}
      onClick={() => (zoomed ? zoomPane(id) : dockPane(id))}
      className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-full bg-primary/15 text-primary hover:bg-primary/25">
      <Icon className="size-3.5" strokeWidth={2.25} />
    </button>
  )
}

/** The smallest a floating pane is resized to, in px. */
const CARD_MIN = { w: 280, h: 160 }

/** A floating pane's place as `px` moved: kept inside the workspace (`b`), at least CARD_MIN, as shares of it. */
function cardRect(px: { x: number; y: number; w: number; h: number }, b: DOMRect): Rect {
  const w = Math.min(b.width, Math.max(CARD_MIN.w, px.w)), h = Math.min(b.height, Math.max(CARD_MIN.h, px.h))
  const x = Math.min(b.width - w, Math.max(0, px.x)), y = Math.min(b.height - h, Math.max(0, px.y))
  return { x: x / b.width, y: y / b.height, w: w / b.width, h: h / b.height }
}

/** Follow the pointer from `e` until it's let go (`done`; Escape: back where it began, `undo`); the cursor stays `cursor`. */
function track(e: React.PointerEvent<HTMLElement>, cursor: string, move: (dx: number, dy: number) => void, undo: () => void, done?: () => void) {
  const el = e.currentTarget, id = e.pointerId, x = e.clientX, y = e.clientY
  e.preventDefault()
  el.setPointerCapture(id)
  document.body.dataset.resizing = cursor
  const onMove = (m: PointerEvent) => { if (m.pointerId === id) move(m.clientX - x, m.clientY - y) }
  const end = () => {
    el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerup", end); el.removeEventListener("lostpointercapture", end)
    removeEventListener("keydown", esc, true)
    delete document.body.dataset.resizing
    done?.()
  }
  const esc = (k: KeyboardEvent) => {
    if (k.key !== "Escape") return
    k.preventDefault(); k.stopPropagation()
    undo(); end()
    try { el.releasePointerCapture(id) } catch { /* already gone */ }
  }
  el.addEventListener("pointermove", onMove); el.addEventListener("pointerup", end); el.addEventListener("lostpointercapture", end)
  addEventListener("keydown", esc, true)
}

/** A floating pane dragged by its bar's empty part (its buttons do their own). */
function moveCard(e: React.PointerEvent<HTMLElement>, id: string, box: React.RefObject<HTMLElement | null>) {
  const t = e.target as Element, b = box.current?.getBoundingClientRect(), was = paneById(id)?.float
  if (e.button !== 0 || !b || !was || !t.closest("[data-pane-bar]") || t.closest("button, a, input, [role=separator]")) return
  const r = { x: was.x * b.width, y: was.y * b.height, w: was.w * b.width, h: was.h * b.height }
  // (lifted while it's dragged: a bigger shadow, index.css)
  const plate = box.current?.querySelector<HTMLElement>(`:scope > [data-plate="${CSS.escape(id)}"]`)
  if (plate) plate.dataset.dragging = ""
  track(e, "move", (dx, dy) => placeFloat(id, cardRect({ ...r, x: r.x + dx, y: r.y + dy }, b)), () => placeFloat(id, was), () => { if (plate) delete plate.dataset.dragging })
}

/** A floating pane's edges and corners, just outside it: drag to resize. */
const EDGES = [["n", "inset-x-2 -top-1 h-2", "ns"], ["s", "inset-x-2 -bottom-1 h-2", "ns"], ["w", "inset-y-2 -left-1 w-2", "ew"], ["e", "inset-y-2 -right-1 w-2", "ew"],
  ["nw", "-top-1 -left-1 size-3", "nwse"], ["se", "-right-1 -bottom-1 size-3", "nwse"], ["ne", "-top-1 -right-1 size-3", "nesw"], ["sw", "-bottom-1 -left-1 size-3", "nesw"]] as const
function CardEdges({ id, rect, box, z }: { id: string; rect: Rect; box: React.RefObject<HTMLElement | null>; z: number }) {
  const down = (e: React.PointerEvent<HTMLElement>, edge: string, cursor: string) => {
    const b = box.current?.getBoundingClientRect()
    if (e.button !== 0 || !b) return
    const r = { x: rect.x * b.width, y: rect.y * b.height, w: rect.w * b.width, h: rect.h * b.height }
    track(e, cursor, (dx, dy) => {
      // (an edge stops at the workspace's, and short of the smallest size, the opposite one staying put)
      let l = r.x, rt = r.x + r.w, t = r.y, bm = r.y + r.h
      if (edge.includes("w")) l = Math.min(rt - CARD_MIN.w, Math.max(0, l + dx))
      if (edge.includes("e")) rt = Math.max(l + CARD_MIN.w, Math.min(b.width, rt + dx))
      if (edge.includes("n")) t = Math.min(bm - CARD_MIN.h, Math.max(0, t + dy))
      if (edge.includes("s")) bm = Math.max(t + CARD_MIN.h, Math.min(b.height, bm + dy))
      placeFloat(id, cardRect({ x: l, y: t, w: rt - l, h: bm - t }, b))
    }, () => placeFloat(id, rect))
  }
  return (
    <div aria-hidden data-card-edges={id} className="pointer-events-none absolute" style={{ ...place(rect), zIndex: z }}>
      {EDGES.map(([edge, at, cursor]) => (
        <div key={edge} data-card-edge={edge} onPointerDown={(e) => down(e, edge, cursor)} className={cn("pointer-events-auto absolute", at)} style={{ cursor: `${cursor}-resize` }} />
      ))}
    </div>
  )
}

/** Where a dragged tab, pane or file would land in this pane (an edge: that half, a new split; the middle: the pane),
 *  or null: drawn again only when that changes. */
const useZone = (pane: string) => useDrag((d) => {
  const h = d?.hit?.target === PANES ? (d.hit.data as Drop) : null
  return h?.kind === "pane" && h.pane === pane ? h.zone : null
})

function PaneBody({ pane, tab, shown, focused, ...p }: Props & { pane: Pane; tab: Tab; shown: boolean; focused: boolean }) {
  const zone = useZone(pane.id)
  return (
    <div data-pane-body={pane.id} className="relative min-h-0 flex-1">
      <PlaceBody pane={pane} tab={tab} shown={shown} focused={focused} {...p} />
      {zone && <DropZone zone={zone} />}
    </div>
  )
}

/** Where something dragged would land in a pane, as it would be after the drop: its middle (a tab or file takes its
 *  place, a pane swaps with it), or a half for a new split. Springs from one to the next (index.css). */
function DropZone({ zone }: { zone: string }) {
  const whole = { top: 4, right: 4, bottom: 4, left: 4 }, half = (side: string) => ({ ...whole, [side]: "calc(50% + 2px)" })
  const other = { left: "right", right: "left", top: "bottom", bottom: "top" } as Record<string, string>
  return (
    <>
      <div aria-hidden data-drop-rest className="drop-zone pointer-events-none absolute z-20 rounded-[8px] bg-foreground/[0.04] ring-1 ring-foreground/15 ring-inset"
        style={zone === "center" ? { ...whole, opacity: 0 } : half(zone)} />
      <div aria-hidden data-drop-zone={zone} className="drop-zone pointer-events-none absolute z-20 rounded-[8px] border-2 border-primary/55 bg-primary/15"
        style={zone === "center" ? whole : half(other[zone])} />
    </>
  )
}

/** What a pane shows, in its own scroller: on screen, or kept drawn but hidden (display: none, out of the keyboard's
 *  and the commands' reach: its PaneContext is hidden, never focused). */
function PlaceBody({ pane, tab, shown, focused, ...p }: Props & { pane: Pane; tab: Tab; shown: boolean; focused: boolean }) {
  const { disabled } = usePrefs()
  usePluginsVersion() // (a plugin taking a file: it may fill the pane now)
  const to = pane.to, id = pane.id
  const view = to.startsWith("view:") ? viewFor(to, disabled) : null
  // The whole pane, no padding or scrolling of its own: a view that says so (`full`), or a file whose format does
  // (`layout: "pane"`: a canvas), which then lays out its bar and drawing itself (FileView's PaneFile).
  const file = tabPath(to)
  const fullPage = !view && !file && !!p.page(to)?.full
  const full = view ? !!view.on && !!view.def.full : file ? fillsPane(file, disabled) : fullPage
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
    // (hidden, what plays in it stops, as it did when a tab left was drawn no more; a player that carries on says so)
    if (!shown && wasShown.current) for (const m of box.current?.querySelectorAll("audio:not([data-keeps-playing]), video:not([data-keeps-playing])") ?? []) (m as HTMLMediaElement).pause()
    wasShown.current = shown
  }, [shown, full])
  const ctx = useMemo(() => ({ pane: id, tab: tab.id, focused, hidden: !shown }), [id, tab.id, focused, shown])
  // A view that fills the pane isn't kept: drawn only while it's shown (a page is).
  if (!shown && full && !fullPage) return null
  // The focused pane's scroller is #main-scroll (scrollPage scrolls it).
  const scroller = cn("h-full min-h-0", full ? "relative overflow-hidden" : "overflow-y-auto overscroll-contain [scrollbar-gutter:stable]")
  return (
    <PaneContext.Provider value={ctx}>
      {/* (a kept pane is data-kept, not data-pane: what looks for a pane's scroller finds the ones shown; data-tab-body:
          whose it is, for a dragged tab's picture of itself) */}
      <div ref={box} id={focused ? "main-scroll" : undefined} data-pane={shown ? id : undefined} data-kept={shown ? undefined : id} data-tab-body={id}
        className={scroller} style={shown ? undefined : { display: "none" }}
        onScroll={(e) => { if (!restoring.current && shown) keepScroll(place.current, e.currentTarget.scrollTop, e.currentTarget) }}>
        <PlaceContent {...p} pane={pane} to={to} view={view} file={file} full={full} focused={focused} shown={shown} />
        {!file && <PageHeading label={tabLabel(pane, p.store).label} />}
      </div>
      {/* What floats over the pane's page, staying put while it scrolls and hidden with it (a note's find bar) */}
      {!full && <div data-tab-overlay={id} className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0" style={shown ? undefined : { display: "none" }} />}
    </PaneContext.Provider>
  )
}

/** A screen reader's title for a view or page that draws no heading of its own (a file's name is its own h1). */
const PageHeading = memo(function PageHeading({ label }: { label: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    // (its tab's box: the parent's ref isn't set yet when this runs)
    const box = ref.current?.parentElement
    const own = () => {
      const has = !!box?.querySelector("h1:not([data-tab-heading])")
      if (ref.current) ref.current.hidden = has
      if (has) watch.disconnect()
    }
    // (a view drawn once its data comes may bring its own; watched only that long, not a terminal's every line)
    const watch = new MutationObserver(own)
    if (box) watch.observe(box, { childList: true, subtree: true })
    own()
    const stop = setTimeout(() => watch.disconnect(), 3000)
    return () => { watch.disconnect(); clearTimeout(stop) }
  }, [])
  return <h1 ref={ref} data-tab-heading className="sr-only">{label}</h1>
})

/** A plugin's view in pane `pane` (`to`: view:<name>/<arg>): its title and what it draws, or the note saying why it
 *  can't (no plugin draws it, or its plugin is off). The desktop's panes and the phone's tabs. */
export function viewBody(store: Store, pane: Pane, to: string, view: ReturnType<typeof viewFor>, focused: boolean):
  { title: string; drawn: ReactNode; note: string | null; bar?: { title?: ReactNode; right?: ReactNode } } {
  if (!view) return { title: to.slice(5), drawn: null, note: "No plugin draws this tab." }
  const title = view.def.title(view.arg)
  if (!view.on) return { title, drawn: null, note: `${offText(view.plugin)}.${switchedOn(view.plugin) ? "" : " Turn it on in Plugins to open this tab."}` }
  const name = to.slice(5).split("/")[0]
  const ctx = { store, arg: view.arg, focused, close: () => closePane(pane.id, true), setArg: (arg: string) => replaceTabTarget(pane.id, `view:${name}${arg ? `/${arg}` : ""}`) }
  return { title, drawn: <Drawn draw={() => view.def.render(ctx)} />, note: null, bar: view.def.bar?.(ctx) }
}

/** A view's page, held at the height it had last time until nothing in it is loading: what can't draw its room
 *  while its data comes (a part whose size isn't known) doesn't push the page when it does. */
export function HeldView({ to, view, children }: { to: string; view: ReturnType<typeof viewFor>; children: ReactNode }) {
  const ref = useHeldHeight<HTMLDivElement>(`view:${view?.def.argState ? to.split("/")[0] : to}`, true)
  return <div ref={ref}>{children}</div>
}

/** What a pane shows. Hidden, it's drawn once as hidden and then left as it is until it's shown again: kept panes cost
 *  nothing while the vault changes (what subscribes for itself, an open file's text, still follows). */
const PlaceContent = memo(function PlaceContent({ pane, to, view, file, full, focused, ...p }: Props & {
  pane: Pane; to: string; view: ReturnType<typeof viewFor>; file: string | null; full: boolean; focused: boolean; shown: boolean
}) {
  const padded = (wide: boolean, bar: ReactNode, body: ReactNode) => (
    <div data-page className={cn("mx-auto px-8 pb-6", wide ? "max-w-none" : "max-w-[912px]")}>{bar}{body}</div>
  )
  const startPage = useNewTabPage(to === "new" ? p.store : null)
  let body: ReactNode = null
  if (!p.store) body = padded(false, null, p.error ? <p className="mt-10 text-muted-foreground select-text">{p.error}</p> : <VaultLoading />)
  else if (file) body = full ? <div className="absolute inset-0"><FileView store={p.store} path={file} pane /></div> : padded(true, null, <FileView store={p.store} path={file} pane />)
  else if (to.startsWith("view:")) {
    const v = viewBody(p.store, pane, to, view, focused)
    body = v.drawn && full ? <div className="absolute inset-0">{v.drawn}</div>
      : padded(false, <ViewBar right={v.bar?.right}>{v.bar?.title ?? v.title}</ViewBar>, v.drawn ? <HeldView to={to} view={view}>{v.drawn}</HeldView> : <p className="mt-6 text-[15px] text-muted-foreground">{v.note}</p>)
  } else if (to === "new") body = startPage ? padded(true, null, <FileView store={p.store} path={startPage} pane />) : padded(false, <ViewBar>New tab</ViewBar>, <NewTab store={p.store} />)
  else {
    const page = p.page(to)
    if (page?.render && full) body = (
      <div data-page className="absolute inset-0 flex flex-col">
        <div className="shrink-0 px-8"><ViewBar>{page.label}</ViewBar></div>
        {/* (a grid stretches the page's root to the box, so what it scrolls is the box's height, not its own) */}
        <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]"><Drawn draw={() => page.render!(p.store!, to, pane)} /></div>
      </div>
    )
    else if (page?.render) body = padded(false, <ViewBar>{page.label}</ViewBar>, <Drawn draw={() => page.render!(p.store!, to, pane)} />)
  }
  // A view whose arg is its own state (a search's query) stays mounted while it changes. One that fails to draw fails
  // alone, in its pane, which can close (else the app stops, and a reload opens it again).
  return (
    <Fragment key={view?.def.argState ? to.split("/")[0] : to}>
      <Guard what="This tab" size="tab" reset={to} close={() => closePane(pane.id)}>{body}</Guard>
    </Fragment>
  )
}, (was, now) => !was.shown && !now.shown)

/** Between two parts of a split: drag to resize, double-click to make the split's parts equal again. */
function Divider({ at: d, box }: { at: DividerAt; box: React.RefObject<HTMLElement | null> }) {
  const row = d.split.dir === "row"
  const r = d.rect
  const move = (x: number, y: number) => {
    const b = box.current?.getBoundingClientRect()
    if (!b) return
    // Where the pointer is, as a share of the split's own box; no part narrower than 200px (lower than 120px).
    // (with gaps between panes, a share is of the workspace less one gap, starting half a gap in: tile() above)
    const g = paneGap(box.current!), half = g / 2
    const at = row ? ((x - b.left - half) / (b.width - g) - r.x) / r.w : ((y - b.top - half) / (b.height - g) - r.y) / r.h
    // (dragged, it follows the pointer at once; a key's step moves there as the layout's changes do)
    const go = () => resize(d.split.id, d.i, at, row ? 200 / (b.width * r.w) : 120 / (b.height * r.h))
    if ("resizing" in document.body.dataset) quietly(go); else go()
  }
  // (in the middle of the gap between the panes, when there's one)
  const mid = (at: number) => `calc(${at} * (100% - ${G}) + ${G} / 2 - 3px)`
  const style = row
    ? { left: mid(r.x + d.at * r.w), top: along(r.y), height: span(r.h), width: 7 }
    : { top: mid(r.y + d.at * r.h), left: along(r.x), width: span(r.w), height: 7 }
  // (Escape puts it back where it was when the drag began)
  const was = useRef(d.at)
  return <Resizer label="Resize the split" horizontal={!row} onStart={() => { was.current = d.at }} onDrag={move}
    onCancel={() => quietly(() => resize(d.split.id, d.i, was.current, 0))} onReset={() => evenOut(d.split.id)} resetTip="even it out"
    style={style} className="absolute" />
}
