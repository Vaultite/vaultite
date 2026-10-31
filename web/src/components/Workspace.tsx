// Desktop: the main area, groups of tabs in a tree of splits. Every group is drawn at its place in one
// flat list, so splitting or closing a pane never remounts the others (an editor keeps its cursor, a terminal its screen).
import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Minimize2, PictureInPicture2, X } from "lucide-react"
import type { Store } from "@/core/data"
import { confirmDialog } from "@/components/ConfirmDialog"
import type { ViewDef } from "@/core/define"
import { useHeldHeight } from "@/core/heights"
import { closeTab, focusGroup, groups, quietly, replaceTabTarget, selectTab, setArchivable, setCloseGuard, setOpenElsewhere, setOpener, setOwnHistory, setPageTest, setTabCloser, setTabKeeper, useWorkspace } from "@/core/workspace"
import { dropAt, dropOn, PANES, type Drop } from "@/core/drop"
import { dockPane, evenOut, placeFloat, resize, zoomPane } from "@/core/splits"
import { paneBoxes, usePaneMotion } from "@/core/panemotion"
import { useCommandKeys } from "@/core/commands"
import { setGroupNamer } from "@/core/tabsets"
import { layout, leaves, shownTab, tabPath, type Divider as DividerAt, type Group, type Rect } from "../../../core/layout.ts"
import { PaneContext } from "@/core/pane"
import { VaultLoading } from "@/components/VaultLoading"
import { isPage } from "@/core/pages"
import { fillsPane, names, openElsewhere, usePluginsVersion, viewFor } from "@/core/plugins"
import { getPrefs, usePrefs } from "@/core/prefs"
import { FileView } from "@/components/FileView"
import { Drawn, Guard } from "@/components/Guard"
import { DragGhost, TabBar, tabMenuOf, useTabInfo, type TabInfo } from "@/components/Tabs"
import { menuFor } from "@/components/ContextMenu"
import { NewTab, useNewTabPage } from "@/components/NewTab"
import { useDrag, useDropTarget } from "@/core/drag"
import { Resizer } from "@/components/Resizer"
import { ViewBar } from "@/components/ViewBar"
import { keepScroll, restoreScroll, scrollOf } from "@/core/viewstate"
import { cn } from "@/lib/utils"
import { watchSliding } from "@/core/sliding"
import { unsavedIn } from "@/core/unsaved"

setTabCloser((to, tab, last, moved) => {
  const v = viewFor(to, getPrefs().disabled)
  if (!v?.on) return false
  v.def.onTabClose?.(v.arg, tab, moved)
  if (last) v.def.onClose?.(v.arg)
  return !!v.def.onTabClose
})
setOpenElsewhere((to) => openElsewhere(to, getPrefs().disabled))
setTabKeeper((to) => !!viewFor(to, getPrefs().disabled)?.def.keepsTab)
setGroupNamer((to) => { const v = viewFor(to, getPrefs().disabled); return (v?.on && v.def.groupName?.(v.arg)) || null })
setOpener((to) => { const v = viewFor(to, getPrefs().disabled); return (v?.on && v.def.opensBeside?.(v.arg)) || null })
setOwnHistory((t, dir) => { const v = viewFor(t.to, getPrefs().disabled); return (v?.on && v.def.history?.(v.arg, t.id, dir)) || null })
setPageTest((path) => isPage(path))
setArchivable((t) => {
  if (t.to.startsWith("file:")) return !unsavedIn(t.to.slice(5))
  if (!t.to.startsWith("view:")) return true
  const v = viewFor(t.to, getPrefs().disabled), a = v?.def.archives
  if (!v?.on) return false
  try { return typeof a === "function" ? a(v.arg, t.id) : a ?? !(v.def.keepsTab || v.def.onClose || v.def.confirmClose) } catch { return false }
})
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

/** A core page a tab can show (Setup, Settings), drawn for its address `to` in `tab`. `full`: it lays out and scrolls
 *  itself under the tab's bar (RailLayout), and is kept drawn while hidden, as other pages are. */
type PageTab = { label: string; full?: boolean; render?: (store: Store, to: string, tab: Tab | null) => ReactNode }
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
  const ws = useWorkspace(), { root, focus, zoom } = ws
  const info = useTabInfo(props.store, props.pageInfo)
  const box = useRef<HTMLDivElement>(null)
  const { dividers } = layout(root)
  const all = leaves(root)
  const alone = all.length === 1
  const drawn = paneBoxes(ws)
  usePaneMotion(box, drawn, focus)
  // (a pane dragged by its handle recedes where it was, its card in hand: Tabs' DragGhost)
  const lifted = useDrag((d) => d?.item.group ?? null)
  // Tabs, and files or pages from the sidebar, dropped on a tab bar or a pane.
  useDropTarget<Drop>(PANES, dropAt, dropOn)
  // (its edges follow the sidebars', with their spring: a terminal waits for them to stop, core/sliding.ts)
  useLayoutEffect(() => (box.current ? watchSliding(box.current) : undefined), [])
  return (
    <div ref={box} className="fixed inset-y-0 z-10 transition-[left,right] duration-(--motion-spring) ease-(--spring)" style={{ left: props.left, right: props.right ?? 0 }}>
      {drawn.map(({ id, rect, layer }) => {
        const g = all.find((x) => x.id === id)!, float = !!g.float, zoomed = id === zoom
        // (under a zoomed pane: out of the keyboard's reach, and no part of the window's drag strip)
        const under = !!zoom && !zoomed && !float
        const top = !under && !float && rect.y < 1e-6
        const z = float ? 20 + 3 * (layer - 2) : zoomed ? 11 : undefined
        return (
          <Fragment key={id}>
            {/* Under the pane: its colour while it moves (core/panemotion.ts), a zoomed or floating pane's card. */}
            <div aria-hidden data-plate={id} style={{ ...place(rect), zIndex: z }}
              className={cn("pointer-events-none absolute bg-background", !layer && "invisible", float && "rounded-[10px] shadow-[0_12px_40px_-8px_rgb(0_0_0/0.35),0_2px_8px_-2px_rgb(0_0_0/0.2)] ring-[0.5px] ring-border")} />
            {/* A pane not at the workspace's left or top edge draws the line to its neighbour;
                data-top/corner/right-corner place the desktop title bar and the right sidebar's toggle (index.css). */}
            <section aria-label="Pane" data-group={id} data-top={top || undefined} data-corner={(top && rect.x < 1e-6) || undefined}
              data-right-corner={(top && rect.x + rect.w > 1 - 1e-6) || undefined} data-floating={float || undefined} data-zoomed={zoomed || undefined} data-focused={id === focus || undefined}
              data-overlay={float || undefined} inert={under || undefined} data-lifted={lifted === id || undefined}
              onPointerDownCapture={() => focusGroup(id)} onPointerDown={float ? (e) => moveCard(e, id, box) : undefined} style={{ ...place(rect), zIndex: z && z + 2 }}
              className={cn("absolute flex min-h-0 min-w-0 flex-col border-border", float ? "overflow-hidden rounded-[10px]" : !zoomed && cn(rect.x > 1e-6 && "border-l", rect.y > 1e-6 && "border-t"))}>
              <TabBar group={g} focused={id === focus} info={info} alone={alone} extra={<PaneState id={id} float={float} zoomed={zoomed} />} />
              {g.stacked ? <Stacked group={g} focused={id === focus} info={info} {...props} /> : <Pane group={g} focused={id === focus} {...props} />}
            </section>
            {float && <CardEdges id={id} rect={rect} box={box} z={z! + 1} />}
          </Fragment>
        )
      })}
      {!zoom && dividers.map((d) => <Divider key={`${d.split.id}:${d.i}`} at={d} box={box} />)}
      <DragGhost info={info} />
    </div>
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

/** A floating pane dragged by its bar's empty part (its tabs and buttons do their own). */
function moveCard(e: React.PointerEvent<HTMLElement>, id: string, box: React.RefObject<HTMLDivElement | null>) {
  const t = e.target as Element, b = box.current?.getBoundingClientRect(), was = groups().find((g) => g.id === id)?.float
  if (e.button !== 0 || !b || !was || !t.closest("[data-tab-bar]") || t.closest("button, a, input, [data-tab-id], [data-set-chip], [role=separator]")) return
  const r = { x: was.x * b.width, y: was.y * b.height, w: was.w * b.width, h: was.h * b.height }
  // (lifted while it's dragged: a bigger shadow, index.css)
  const plate = box.current?.querySelector<HTMLElement>(`:scope > [data-plate="${CSS.escape(id)}"]`)
  if (plate) plate.dataset.dragging = ""
  track(e, "move", (dx, dy) => placeFloat(id, cardRect({ ...r, x: r.x + dx, y: r.y + dy }, b)), () => placeFloat(id, was), () => { if (plate) delete plate.dataset.dragging })
}

/** A floating pane's edges and corners, just outside it: drag to resize. */
const EDGES = [["n", "inset-x-2 -top-1 h-2", "ns"], ["s", "inset-x-2 -bottom-1 h-2", "ns"], ["w", "inset-y-2 -left-1 w-2", "ew"], ["e", "inset-y-2 -right-1 w-2", "ew"],
  ["nw", "-top-1 -left-1 size-3", "nwse"], ["se", "-right-1 -bottom-1 size-3", "nwse"], ["ne", "-top-1 -right-1 size-3", "nesw"], ["sw", "-bottom-1 -left-1 size-3", "nesw"]] as const
function CardEdges({ id, rect, box, z }: { id: string; rect: Rect; box: React.RefObject<HTMLDivElement | null>; z: number }) {
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

/** Where a dragged tab or file would land in this pane (an edge: that half, a new split; the middle: the pane), or null:
 *  drawn again only when that changes. */
const useZone = (group: string) => useDrag((d) => {
  const h = d?.hit?.target === PANES ? (d.hit.data as Drop) : null
  return h?.kind === "pane" && h.group === group ? h.zone : null
})

function Pane({ group, focused, ...p }: Props & { group: Group; focused: boolean }) {
  const zone = useZone(group.id)
  const tab = shownTab(group) ?? group.tabs[0]
  // (worked out while drawing, from what was kept the last time: React's state from earlier renders)
  const [was, setKept] = useState<Kept>({ slots: [], recent: [] })
  const kept = keepTabs(was, group.tabs.map((t) => t.id), tab?.id ?? null)
  if (kept !== was) setKept(kept)
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

/** Where a dragged tab would land in a pane, as the pane would be after the drop: its middle (it joins the pane), or a
 *  half for a new split, the pane's outline moved to the other half. Springs from one to the next (index.css). */
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

/** A spine's width (a stacked tab's title, on its left edge), in px. */
const SPINE = 36

/** A pane's tabs stacked: side by side, each sticking by its spine as the next slides over. The active
 *  one is the pane's (#main-scroll) and scrolls into view when it changes; a click on a tab or spine activates it. */
function Stacked({ group, focused, info, ...p }: Props & { group: Group; focused: boolean; info: (t: Tab) => TabInfo }) {
  const row = useRef<HTMLDivElement>(null)
  const zone = useZone(group.id)
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
  const pane = useMemo(() => ({ group, focused, hidden: !shown, tab: tab?.id }), [group, focused, shown, tab?.id])
  // (a stacked tab that isn't the active one: data-stacked, so what looks for the pane's scroller finds the active one)
  const back = shown && !active
  // A view that fills the pane isn't kept: drawn only while it's shown (a page is).
  if (!shown && full && !fullPage) return null
  // The focused pane's shown scroller is #main-scroll (scrollPage scrolls it).
  const scroller = cn("h-full min-h-0", full ? "relative overflow-hidden" : "overflow-y-auto overscroll-contain [scrollbar-gutter:stable]")
  return (
    <PaneContext.Provider value={pane}>
      {/* (a kept tab is data-kept, not data-pane: what looks for the pane's scroller finds the one shown; data-tab-body:
          whose it is, for a dragged tab's picture of itself) */}
      <div ref={box} id={focused ? "main-scroll" : undefined} data-pane={active ? group : undefined} data-kept={shown ? undefined : group} data-stacked={back ? group : undefined} data-tab-body={tab?.id}
        className={scroller} style={shown ? undefined : { display: "none" }}
        onScroll={(e) => { if (!restoring.current && shown) keepScroll(place.current, e.currentTarget.scrollTop, e.currentTarget) }}>
        <TabContent {...p} tab={tab} to={to} view={view} file={file} full={full} focused={focused} shown={shown} />
      </div>
    </PaneContext.Provider>
  )
}

/** A plugin's view in tab `tab` (`to`: view:<name>/<arg>): its title and what it draws, or the note saying why it can't
 *  (no plugin draws it, or its plugin is off). The desktop's panes and the phone's tabs. */
export function viewBody(store: Store, tab: Tab, to: string, view: ReturnType<typeof viewFor>, focused: boolean) {
  if (!view) return { title: to.slice(5), drawn: null, note: "No plugin draws this tab." }
  const title = view.def.title(view.arg)
  if (!view.on) return { title, drawn: null, note: `${names([view.plugin.id])} is off. Turn it on in Plugins to open this tab.` }
  const name = to.slice(5).split("/")[0]
  const ctx = { store, arg: view.arg, focused, close: () => closeTab(tab.id, true), setArg: (arg: string) => replaceTabTarget(tab.id, `view:${name}${arg ? `/${arg}` : ""}`) }
  return { title, drawn: <Drawn draw={() => view.def.render(ctx)} />, note: null }
}

/** A view tab's page, held at the height it had last time until nothing in it is loading: what can't draw its room
 *  while its data comes (a part whose size isn't known) doesn't push the page when it does. */
export function HeldView({ to, view, children }: { to: string; view: ReturnType<typeof viewFor>; children: ReactNode }) {
  const ref = useHeldHeight<HTMLDivElement>(`view:${view?.def.argState ? to.split("/")[0] : to}`, true)
  return <div ref={ref}>{children}</div>
}

/** What a tab shows. Hidden, it's drawn once as hidden and then left as it is until it's shown again: kept tabs cost
 *  nothing while the vault changes (what subscribes for itself, an open file's text, still follows). */
const TabContent = memo(function TabContent({ tab, to, view, file, full, focused, ...p }: Props & {
  tab: Tab | null; to: string; view: ReturnType<typeof viewFor>; file: string | null; full: boolean; focused: boolean; shown: boolean
}) {
  const padded = (wide: boolean, bar: ReactNode, body: ReactNode) => (
    <main className={cn("mx-auto px-8 pb-6", wide ? "max-w-none" : "max-w-[912px]")}>{bar}{body}</main>
  )
  const startPage = useNewTabPage(to === "new" ? p.store : null)
  let body: ReactNode = null
  if (!p.store) body = padded(false, null, p.error ? <p className="mt-10 text-muted-foreground">{p.error}</p> : <VaultLoading />)
  else if (file) body = full ? <div className="absolute inset-0"><FileView store={p.store} path={file} pane /></div> : padded(true, null, <FileView store={p.store} path={file} pane />)
  else if (tab && to.startsWith("view:")) {
    const v = viewBody(p.store, tab, to, view, focused)
    body = v.drawn && full ? <div className="absolute inset-0">{v.drawn}</div>
      : padded(false, <ViewBar>{v.title}</ViewBar>, v.drawn ? <HeldView to={to} view={view}>{v.drawn}</HeldView> : <p className="mt-6 text-[15px] text-muted-foreground">{v.note}</p>)
  } else if (to === "new") body = startPage ? padded(true, null, <FileView store={p.store} path={startPage} pane />) : padded(false, <ViewBar>New tab</ViewBar>, <NewTab store={p.store} />)
  else {
    const page = p.page(to)
    if (page?.render && full) body = (
      <main className="absolute inset-0 flex flex-col">
        <div className="shrink-0 px-8"><ViewBar>{page.label}</ViewBar></div>
        {/* (a grid stretches the page's root to the box, so what it scrolls is the box's height, not its own) */}
        <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]"><Drawn draw={() => page.render!(p.store!, to, tab)} /></div>
      </main>
    )
    else if (page?.render) body = padded(false, <ViewBar>{page.label}</ViewBar>, <Drawn draw={() => page.render!(p.store!, to, tab)} />)
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
    // (dragged, it follows the pointer at once; a key's step moves there as the layout's changes do)
    const go = () => resize(d.split.id, d.i, at, row ? 200 / (b.width * r.w) : 120 / (b.height * r.h))
    if ("resizing" in document.body.dataset) quietly(go); else go()
  }
  const style = row
    ? { left: `calc(${pct(r.x + d.at * r.w)} - 3px)`, top: pct(r.y), height: pct(r.h), width: 7 }
    : { top: `calc(${pct(r.y + d.at * r.h)} - 3px)`, left: pct(r.x), width: pct(r.w), height: 7 }
  // (Escape puts it back where it was when the drag began)
  const was = useRef(d.at)
  return <Resizer label="Resize the split" horizontal={!row} onStart={() => { was.current = d.at }} onDrag={move}
    onCancel={() => quietly(() => resize(d.split.id, d.i, was.current, 0))} onReset={() => evenOut(d.split.id)} resetTip="even it out"
    style={style} className="absolute" />
}
