import { useEffect, useId, useRef, useState } from "react"
import { AppWindow, Archive, ChevronDown, Ellipsis, Layers2, MonitorSmartphone, Pin, Plus, X } from "lucide-react"
import {
  activePane, Badged, beforeStart, edgeScroller, canDropTab, closePane, closeTab, cn, coarse, colorVar, commandItems, definePlugin, DEVICE, dragTab, dropTab, fmtAgo, foldGroupMoving, groupMenu, groupName, GroupLabel,
  groupsAsDrawn, HeadingButton, IconAction, isPopout, menuFor, openNewTab, isViewOpen, notifyError, openView, paneById, paneMenuOf, panesOf, placeMenuOf, placesIn, placesOf, reorder, rightClickBelow, useArchivedTabs, useMenuShowing, pastEnd, put, rowMenu, RowKeys, selectClick,
  selectedAttr, selectPane, selectTab, SidebarHeading, SidebarRow, springing, springTabAt, startDrag, tabButtons, tabListDrop, tabMenuOf, tabPreview, tabPreviewOrder, TABS, tabSlot, tabSlotBeside, tabsMenu, useDrag, useDropHit,
  useDropTarget, useGroupIn, useGroupLines, useGrowIn, useReflow, useShrinkOut, useSelectable, useSelected, useSlide, useTabLabels, useTabList, useUiMarks,
  INCOMING, laidOut,
  type DragItem, type Pane, type SidebarCtx, type Store, type Tab, type TabDrop, type TabGroup, type TabInfo, type TabList,
} from "@vaultite"
import type { Device, DeviceTab } from "./types"
import { archivedAnswer, ArchivedView, archivedSearch, Archiver, followMove } from "./archived"
import { settings } from "./settings"
import { closeOn, deviceItems, deviceName, DeviceNameField, DevicesPanel, inPanel, KIND_ICON, LiveDot, openHere, tabItems, useDevices, useLeaving } from "./devices"

// The window's open tabs as a list in the sidebar, so the tab bar can be off (`tabBar`): a split tab one row of its
// panes side by side (Arc's); under them the other devices' tabs (plugin.ts), to open here.

/** Other devices' tabs on or off, from a right-click on the heading or a device (the setting's sheet has it too). */
const othersItem = (shown: boolean) => ({
  label: "Other devices' tabs", checked: shown, run: () => { settings.set({ other_devices: !shown }).catch((e) => notifyError(e, "Couldn't change it")) },
})

/** What other plugins mark a row with (the companion's eye on what it follows): a button each, a click away. */
function Marks({ id }: { id: string }) {
  const marks = useUiMarks(id)
  return <>{marks.map((m, k) => (
    <HeadingButton key={k} icon={m.icon} label={m.label} data-no-drag className="text-primary" style={m.tint ? { color: m.tint } : undefined}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); m.run(e) }} />
  ))}</>
}

const isBlankTab = (t: Tab) => { const ps = panesOf(t); return ps.length === 1 && ps[0].to === "new" }

type Part = Tab["root"]
type Split = Extract<Part, { kids: Part[] }>
const isSplit = (n: Part): n is Split => "kids" in n
/** A split's parts laid out in it (its floating panes aren't: they're drawn after the map). */
const tiledKids = (n: Split) => n.kids.flatMap((k, i) => (!isSplit(k) && k.float ? [] : [{ k, size: n.sizes[i] ?? 1 }]))
/** How many lines a part takes stacked as it is. */
const linesOf = (n: Part): number => !isSplit(n) ? 1 : n.dir === "col" ? tiledKids(n).reduce((a, { k }) => a + linesOf(k), 0) : Math.max(1, ...tiledKids(n).map(({ k }) => linesOf(k)))
/** At most this many lines: a column taller than what's left is drawn side by side instead. */
const MAX_LINES = 3
/** How many lines a split tab's row takes in the panel. */
const stacks = (n: Part, room = MAX_LINES): number => !isSplit(n) ? 1
  : n.dir === "col" && linesOf(n) <= room ? linesOf(n) : Math.max(1, ...tiledKids(n).map(({ k }) => stacks(k, room)))

/** A split tab's panes in the shape of its split, a mini-map (a narrow one just its icon; floating ones after it, as
 *  icons). Click focuses one, a press drags it (onto another: they swap), X closes it, right-click is its pane's menu. */
function SplitMap({ t, active, info, folded }: { t: Tab; active: boolean; info: (x: Tab | Pane) => TabInfo
  /** Its panes' own tabs aren't listed under it: each cell says how many more it has. */
  folded: boolean }) {
  const floats = panesOf(t).filter((p) => p.float)
  // (the pane a dragged one would swap with)
  const into = useDrag((d) => {
    const h = d?.hit, at = h?.data as TabDrop | undefined
    return h && h.target.startsWith(LIST) && at?.kind === "pane" ? at.pane : null
  })
  // (its frame and the lines between its cells, one weight: panes in a window)
  const line = active ? "border-foreground/20 ring-foreground/20" : "border-foreground/15 ring-foreground/15"
  const menu = (p: Pane) => menuFor(() => [...paneMenuOf(p.id), { label: "Tab", icon: AppWindow, sep: true, run: () => {}, items: tabMenuOf(t.id) }])
  const cell = (p: Pane, size: number, icon = false) => {
    const pi = info(p), on = active && p.id === t.focus
    const mark = <Badged on={pi.badge}><pi.icon className={cn("size-4 shrink-0", pi.tint ? undefined : on ? "text-primary" : "text-muted-foreground", pi.iconClassName)} strokeWidth={2} style={pi.tint ? { color: pi.tint } : undefined} /></Badged>
    // (lit as a dragged pane's swap target, else under the pointer: the pane a press would grab)
    const lit = into === p.id ? "bg-primary/15" : !into && "hover:bg-foreground/[0.06]", more = folded ? placesOf(p).length - 1 : 0
    // (its mark, as a tab's row has it: a page playing in it, its speaker a click from muting it)
    const sign = pi.mark && <IconAction action={pi.mark} className={icon ? undefined : "-ml-1 @max-[52px]:ml-0"}><pi.mark.icon className={cn("size-3.5 shrink-0", !pi.mark.tint && "text-muted-foreground")} strokeWidth={2.25} style={pi.mark.tint ? { color: pi.mark.tint } : undefined} /></IconAction>
    if (icon) return <span key={p.id} data-pane-half={p.id} data-ui={`pane:${p.id}`} onContextMenu={menu(p)} className={cn("flex h-5.5 shrink-0 items-center gap-1 rounded-[5px] px-1 ring-1 ring-inset transition-colors", line, lit)}>{mark}
      {sign}</span>
    // (too narrow for its name: its icon alone, in the middle; its X over its end, where its name fades)
    return (
      <span key={p.id} data-pane-half={p.id} data-ui={`pane:${p.id}`} onContextMenu={menu(p)} style={{ flex: `${size} 1 0` }} className={cn("group/cell @container relative flex h-5.5 min-w-0 transition-colors", lit)}>
        <span className="flex w-full min-w-0 items-center gap-2 px-1 @max-[52px]:justify-center @max-[52px]:gap-1">
          {mark}
          {sign}
          <span className={cn("min-w-0 flex-1 overflow-hidden fade-end @max-[52px]:hidden", active && !on && "font-normal text-muted-foreground")}>{pi.label}</span>
          {/* (its count of the pane's other tabs gives its place to the X, as the name fades under it) */}
          {more > 0 && <span data-cell-more className="shrink-0 pr-0.5 text-[11px] font-normal text-tertiary tabular-nums transition-opacity group-hover/cell:opacity-0 group-focus-within/cell:opacity-0 @max-[72px]:hidden">+{more}</span>}
        </span>
        <button type="button" data-cell-close={p.id} data-no-drag aria-label={`Close ${pi.label}`} data-tip="Close pane"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); closePane(p.id) }}
          className="absolute inset-y-0 right-0.5 my-auto grid size-4.5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground opacity-0 transition-opacity group-hover/cell:opacity-100 hover:bg-foreground/[0.08] hover:text-foreground focus-visible:opacity-100 @max-[40px]:hidden">
          <X className="size-3" strokeWidth={2.25} />
        </button>
      </span>
    )
  }
  const draw = (n: Part, size: number, room: number): React.ReactNode => {
    if (!isSplit(n)) return cell(n, size)
    const stacked = n.dir === "col" && linesOf(n) <= room
    return (
      <span key={n.id} style={{ flex: `${size} 1 0` }} className={cn("flex min-w-0", stacked ? "flex-col" : "items-stretch")}>
        {tiledKids(n).map(({ k, size: s }, j) => (
          <span key={k.id} style={stacked ? undefined : { flex: `${s} 1 0` }}
            className={cn("flex min-w-0 items-center", j && (stacked ? "border-t" : "border-l"), j && line)}>
            {draw(k, 1, stacked ? linesOf(k) : room)}
          </span>
        ))}
      </span>
    )
  }
  return (
    // (framed as a small window, its icons in line with the other rows')
    <span data-split-map className="-ml-1 flex w-full min-w-0 items-center gap-1">
      <span className={cn("flex min-w-0 flex-1 overflow-hidden rounded-[5px] ring-1 ring-inset", line)}>{draw(t.root, 1, MAX_LINES)}</span>
      {floats.map((p) => cell(p, 0, true))}
    </span>
  )
}

/** A split tab's handle past its map (all panes): a click opens the tab's menu under it, a press drags the whole tab.
 *  Where a tab's row has its …, its slot kept so the map never moves; shown on hover, focus, its menu open or dragged. */
function SplitMore({ label, held }: { label: string; held: boolean }) {
  const showing = useMenuShowing(), [menued, setMenued] = useState(false)
  useEffect(() => { if (!showing) setMenued(false) }, [showing])
  return (
    <HeadingButton icon={Ellipsis} label={`More for ${label}`} tip="More" data-split-more data-on={held || menued || undefined}
      onClick={(e) => { setMenued(true); rightClickBelow(e) }}
      // (a finger has no hover: always there)
      className={cn("-ml-1 shrink-0 transition-opacity duration-(--motion-fast) focus-visible:opacity-100 data-on:opacity-100 data-on:text-foreground",
        !coarse && "opacity-0 group-hover/row:opacity-100")} />
  )
}

/** A split's map: no fade at its end (it would cut its frame; nothing is drawn over it, its … has a slot of its own). */
const MAP_LABEL = "[mask-image:none]"

/** A tab's row. A split tab's shows each pane, side by side: a click on one focuses it, and a pane dragged out of it
 *  becomes a tab of its own where it's let go (or goes into another tab, held on its row a moment: Rex's). */
function Row({ t, l, info, only, line, hit }: { t: Tab; l: TabList; info: (x: Tab | Pane) => TabInfo; only: boolean
  /** The tab group whose line runs down by it (core/tabline.ts): its own, or the one a drag's preview puts it in. */
  line?: string
  /** Where what's dragged over the list would land (a split's panes' lists make way in theirs). */
  hit: TabDrop | null }) {
  const item = useDrag((d) => d?.item)
  const picked = useSelected(TABS, t.id)
  // (a dragged pane or tab held on it: lit, about to open)
  const lit = useDrag((d) => !!d && springing() === t.id)
  const box = useRef<HTMLDivElement>(null)
  useGrowIn(box, t)
  useShrinkOut(box, { tab: t.id })
  const active = t.id === l.active, ps = panesOf(t), split = ps.length > 1, i = info(t)
  // (its row shrinks away once it's closed, after its view says yes if it asks: useShrinkOut)
  const close = () => closeTab(t.id)
  const halfOf = (e: { target: EventTarget }) => (e.target as Element).closest<HTMLElement>("[data-pane-half]")?.dataset.paneHalf
  const click = (e: React.MouseEvent) => {
    if (e.button === 1) { if (!t.pinned && !only) close(); return }
    // ⌥-click: it takes the focused pane's place (what was there goes back to the list as a tab of its own).
    const into: TabDrop = { kind: "pane", pane: activePane().id, zone: "center" }, it: DragItem = { from: "tab", tab: t.id }
    if (e.altKey && !active && canDropTab(it, into)) return dropTab(it, into)
    if (selectClick(e, TABS, t.id, l.active)) return
    const half = split ? halfOf(e) : undefined
    if (half) selectPane(half); else selectTab(t.id)
  }
  const press = (e: React.PointerEvent<HTMLElement>) => {
    const half = split ? halfOf(e) : undefined, p = half ? paneById(half) : undefined
    if (p) startDrag(e, { from: "pane", pane: p.id, to: p.to, label: info(p).label }); else dragTab(e, t)
  }
  // (on screen, a split whose panes have tabs of their own lists them under its row, a list a pane)
  const lists = split && active && placesIn(t).length > ps.length
  const map = split ? <SplitMap t={t} active={active} info={info} folded={!lists} /> : null
  const buttons = split || item ? [] : tabButtons(ps[0].to)
  const dragging = item?.tab === t.id || (picked && item?.tabs) || (!!t.group && item?.group === t.group)
  return (
    // Dragged like a tab in the bar: along the list (in or out of a group), onto a pane (its edge splits, its middle
    // replaces it), or Pinned; selected with others, they all go.
    <div ref={box} data-slide={t.id} data-ui={`tab:${t.id}`} data-spring-tab={t.id} data-in-group={t.group} data-line-of={line} onPointerDown={press}
      className={cn("relative", dragging && "opacity-50")}
      onContextMenu={menuFor(rowMenu(TABS, t.id, () => tabMenuOf(t.id)))}>
      <SidebarRow data-open-tab={t.id} data-select-key={t.id} data-split={split ? "" : undefined} {...selectedAttr(picked)} icon={split ? undefined : i.icon} iconClassName={i.iconClassName} tint={i.tint}
        badge={split ? undefined : i.badge} mark={split ? undefined : i.mark} label={map ?? i.label} labelClassName={map ? MAP_LABEL : undefined} tip={split ? ps.map((p) => info(p).label).join(" | ") : undefined} open active={active} more={!split}
        className={cn(line && "ml-3.5", lit && !active && "bg-foreground/[0.08]", map && stacks(t.root) > 1 && "h-auto min-h-7 py-[3px]")}
        swipe={() => (t.pinned || only ? [] : [{ label: "Close", icon: X, danger: true, run: () => closeTab(t.id), removes: true }])}
        actions={[...buttons.map((b) => <HeadingButton key={b.label} icon={b.icon} label={b.label} data-no-drag onClick={(e) => { e.preventDefault(); e.stopPropagation(); b.run(e) }} />),
          ...(!t.pinned && !only && !split ? [<HeadingButton key="close" icon={X} label={`Close ${i.label}`} tip="Close tab" data-no-drag
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); close() }} />] : [])]}
        onClick={click}>
        <Marks id={`tab:${t.id}`} />
        {t.pinned && <span className="grid size-5 shrink-0 place-items-center text-muted-foreground" aria-label="Pinned"><Pin className="size-3.5" strokeWidth={2} /></span>}
        {split && <SplitMore label={ps.map((p) => info(p).label).join(" | ")} held={!!dragging} />}
      </SidebarRow>
      {lists && <div data-pane-lists className={cn("flex flex-col gap-1 pt-px pb-1", line && "ml-3.5")}>{ps.map((p) => <PaneList key={p.id} t={t} p={p} info={info} hit={hit} />)}</div>}
    </div>
  )
}

/** Where pane `id` sits in tree `n`, named as a person would (Left, Top right, Middle); a floating one, Floating. */
function whereIn(n: Part, id: string) {
  let at: { x: number; y: number; w: number; h: number } | null = null
  const walk = (x: Part, r: { x: number; y: number; w: number; h: number }) => {
    if (!isSplit(x)) { if (x.id === id && !x.float) at = r; return }
    const kids = tiledKids(x), total = kids.reduce((a, k) => a + k.size, 0) || 1
    let off = 0
    for (const { k, size } of kids) {
      const s = size / total
      walk(k, x.dir === "row" ? { ...r, x: r.x + off * r.w, w: s * r.w } : { ...r, y: r.y + off * r.h, h: s * r.h })
      off += s
    }
  }
  walk(n, { x: 0, y: 0, w: 1, h: 1 })
  const r = at as { x: number; y: number; w: number; h: number } | null
  if (!r) return "Floating"
  const third = (c: number, lo: string, hi: string) => (c < 1 / 3 ? lo : c > 2 / 3 ? hi : "middle")
  const across = r.w > 0.99 ? "" : third(r.x + r.w / 2, "left", "right"), down = r.h > 0.99 ? "" : third(r.y + r.h / 2, "top", "bottom")
  const name = down && across && !(down === "middle" && across === "middle") ? `${down} ${across}` : down || across || "middle"
  return name[0].toUpperCase() + name.slice(1)
}

/** The split's shape, tiny, pane `id`'s part lit (the accent while it's focused). */
function PaneGlyph({ n, id, on }: { n: Part; id: string; on: boolean }) {
  const draw = (x: Part, size: number): React.ReactNode => !isSplit(x)
    ? <span key={x.id} style={{ flex: `${size} 1 0` }} className={cn("min-h-0 min-w-0 rounded-[1px]", x.id === id ? (on ? "bg-primary" : "bg-muted-foreground") : "bg-foreground/15")} />
    : <span key={x.id} style={{ flex: `${size} 1 0` }} className={cn("flex min-h-0 min-w-0 gap-px", x.dir === "col" && "flex-col")}>{tiledKids(x).map(({ k, size: s }) => draw(k, s))}</span>
  return <span aria-hidden className="flex h-2.5 w-3.5 shrink-0">{draw(n, 1)}</span>
}

/** A split's pane's own tabs (Pane.stack), under the split's row: headed by where the pane sits (lit while focused), its
 *  places in their order. Dragged over, they make way for what would land among them. */
function PaneList({ t, p, info, hit }: { t: Tab; p: Pane; info: (x: Tab | Pane) => TabInfo; hit: TabDrop | null }) {
  const item = useDrag((d) => d?.item)
  const box = useRef<HTMLDivElement>(null)
  const places = placesOf(p), focused = t.focus === p.id
  const moving = item?.pane ?? item?.tab ?? item?.to
  const order = moving && hit?.kind === "places" && hit.pane === p.id ? reorder(places.map((x) => x.id), [moving], hit.index).order : null
  useSlide(box, order, "y")
  return (
    <div ref={box} data-pane-places={p.id} className="relative flex flex-col gap-px pl-3.5">
      <div data-pane-heading={p.id} className={cn("flex h-5 items-center gap-1.5 px-1.5 text-[11px] font-medium", focused ? "text-muted-foreground" : "text-tertiary")}>
        <PaneGlyph n={t.root} id={p.id} on={focused} />{whereIn(t.root, p.id)}
      </div>
      {places.map((x) => <PlaceRow key={x.id} p={x} shown={x.id === p.id} focused={focused} info={info} />)}
      {order?.includes(INCOMING) && <div aria-hidden data-slide={INCOMING} className="pointer-events-none absolute right-0 top-0 left-3.5 h-7 rounded-[5px] bg-foreground/[0.06]" />}
    </div>
  )
}

/** One of a pane's own tabs: a click shows it in its pane, its X closes it (the pane's last: the pane), a press drags it
 *  (along its pane's list, into another's, out to the list as a tab of its own, or onto a pane: its edge splits). */
function PlaceRow({ p, shown, focused, info }: { p: Pane; shown: boolean; focused: boolean; info: (x: Tab | Pane) => TabInfo }) {
  const item = useDrag((d) => d?.item)
  const i = info(p), on = shown && focused
  return (
    <div data-slide={p.id} data-place={p.id} data-ui={`pane:${p.id}`} className={cn("relative", item?.pane === p.id && item.place && "opacity-50")}
      onPointerDown={(e) => { e.stopPropagation(); startDrag(e, { from: "pane", pane: p.id, to: p.to, label: i.label, place: true }) }}
      onContextMenu={menuFor(() => placeMenuOf(p.id))}>
      <SidebarRow data-place-row={p.id} data-shown={shown || undefined} icon={i.icon} iconClassName={i.iconClassName} tint={i.tint} badge={i.badge} mark={i.mark} label={i.label} open active={on}
        className={cn(shown && !on && "bg-foreground/[0.04]")}
        swipe={() => [{ label: "Close", icon: X, danger: true, run: () => closePane(p.id), removes: true }]}
        actions={[<HeadingButton key="close" icon={X} label={`Close ${i.label}`} tip="Close tab" data-no-drag
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); closePane(p.id) }} />]}
        onClick={(e) => { if (e.button === 1) closePane(p.id); else selectPane(p.id) }} />
    </div>
  )
}

/** A tab group's row: its chip, its line hanging from it (core/tabline.ts). A click folds it, its … or a right-click
 *  opens its editor, dragging moves the whole group; `target`: a tab dragged onto it (folded) would join it. */
function GroupRow({ g, n, target }: { g: TabGroup; n: number; target: boolean }) {
  const item = useDrag((d) => d?.item)
  const box = useRef<HTMLDivElement>(null)
  useGroupIn(box, g.id)
  useShrinkOut(box, { group: g.id })
  return (
    <div ref={box} data-slide={`group:${g.id}`} data-ui={`group:${g.id}`} data-line-head={g.id} style={{ ["--line" as string]: colorVar(g.color) }}
      onPointerDown={(e) => startDrag(e, { from: "group", group: g.id, label: groupName(g) })} className={cn("relative", item?.group === g.id && "opacity-50")}
      onContextMenu={menuFor(() => groupMenu(g.id, "panel"))}>
      <SidebarRow data-group-row={g.id} aria-expanded={!g.collapsed} open tip={null} more onClick={() => foldGroupMoving(g.id)}
        label={<span className="flex"><GroupLabel g={g} n={n} target={target} /></span>}>
        <Marks id={`group:${g.id}`} />
        {/* (its chevron shows on hover, as a panel heading's does, turning as it folds) */}
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-[rotate,opacity] duration-200 group-hover/row:opacity-100 group-aria-[expanded=false]/row:-rotate-90" strokeWidth={2.25} />
      </SidebarRow>
    </div>
  )
}

const LIST = "tabs:list"
/** Whether (x, y) is just under the last row or on the New tab row, which a drop puts at the list's end, or just over
 *  the first (the panel's heading), which puts it first. */
function atEnds(root: HTMLElement, x: number, y: number, el: Element | null) {
  const rows = root.querySelectorAll("[data-open-tab], [data-group-row]"), last = rows[rows.length - 1]
  return !!last && (!!el?.closest("[data-new-tab-row]") || pastEnd(root, last, x, y, el) || beforeStart(root, rows[0], x, y, el))
}

/** The window's tabs, each tab group a row with its tabs under it. Dragged along the list, a tab moves, joining or
 *  leaving a group; a pane let go here (a half of a split's row, or from its bar) becomes a tab of its own. */
function TabRows({ store }: { store: Store }) {
  const l = useTabList()
  const info = useTabLabels(store)
  useSelectable(TABS, { menu: (ids) => tabsMenu(ids), noun: ["tab", "tabs"] })
  const list = useRef<HTMLDivElement>(null)
  const target = `${LIST}:${useId()}`
  const [edge] = useState(() => edgeScroller())
  useDropTarget<TabDrop>(target, (item: DragItem, x, y, el) => {
    const root = list.current
    const takes = !!(item.tab || item.group || item.to || item.pane)
    if (!root || !takes) return null
    // (held near the top or bottom of what scrolls the list, it scrolls: more tabs than the panel shows)
    edge.over(root, x, y)
    if (!(el && root.contains(el)) && !atEnds(root, x, y, el)) return null
    // Over a split's pane's own tabs: among them, before the row it's above the middle of.
    const among = el?.closest<HTMLElement>("[data-pane-places]")
    if (among && root.contains(among)) {
      const index = [...among.querySelectorAll<HTMLElement>("[data-place]")].filter((r) => { const b = laidOut(r); return (b.top + b.bottom) / 2 < y }).length
      const d: TabDrop = { kind: "places", pane: among.dataset.panePlaces!, index }
      return canDropTab(item, d) ? d : null
    }
    // A split's pane over its own row: on another of its panes the two swap, on itself it stays (as laid out, not as
    // a preview slides it: the row holds still meanwhile).
    const own = item.pane ? l.tabs.find((x) => panesOf(x).some((p) => p.id === item.pane)) : undefined
    const cells = own && panesOf(own).length > 1 ? [...root.querySelectorAll<HTMLElement>(`[data-open-tab="${CSS.escape(own.id)}"] [data-pane-half]`)] : []
    const cell = cells.find((c) => { const r = laidOut(c); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom })?.dataset.paneHalf
    if (cell) {
      const d: TabDrop = { kind: "pane", pane: cell, zone: "center" }
      return cell !== item.pane && canDropTab(item, d) ? d : null
    }
    // (a pane or tab held on a row's middle opens its tab after a moment: that row holds still meanwhile)
    const held = springTabAt(item, x, y)
    const slots = [...root.querySelectorAll<HTMLElement>("[data-open-tab], [data-group-row]")].map((e) => ({ el: e, tab: e.dataset.openTab, group: e.dataset.groupRow }))
    const at = held ? tabSlotBeside(l, item, held) : tabSlot(l, slots, y, "y")
    return tabListDrop(item, { kind: "list", index: at.index, group: item.group ? null : at.group })
  }, (item, d) => dropTab(item, d), { stay: (d) => d.kind === "list" && !!d.home, end: edge.stop })
  const hit = useDropHit<TabDrop>(target)
  const item = useDrag((d) => d?.item)
  // Dragged over, the rows make way for what's dragged, in the tab group it would join (its line by it).
  const preview = item ? tabPreview(l, item, hit) : null
  useSlide(list, preview && tabPreviewOrder(l, preview), "y")
  // (after useSlide: a drop's preview is taken off first, so they slide from where it drew them)
  useReflow(list, l)
  useGroupLines(list, "y")
  const shown = preview?.tabs ?? l.tabs
  const drawn = groupsAsDrawn(shown)
  const lineOf = (id: string) => {
    const g = drawn.get(id)
    return g && !l.groups?.find((x) => x.id === g)?.collapsed ? g : undefined
  }
  const only = (t: Tab) => l.tabs.length === 1 && isBlankTab(t)
  const incoming = shown.some((t) => t.id === INCOMING)
  return (
    <div ref={list} className="relative flex flex-col gap-px" data-keylist data-open-tabs data-select-list={TABS}>
      {l.tabs.flatMap((t, i) => {
        const g = t.group ? l.groups?.find((x) => x.id === t.group) : undefined
        const head = g && l.tabs[i - 1]?.group !== g.id
          ? <GroupRow key={`group:${g.id}`} g={g} n={shown.filter((x) => x.group === g.id).length} target={preview?.into === g.id} />
          : null
        const row = g?.collapsed ? null : <Row key={t.id} t={t} l={l} info={info} only={only(t)} line={lineOf(t.id)} hit={hit} />
        return [head, row].filter(Boolean)
      })}
      {/* Where something from elsewhere would open. */}
      {incoming && (
        <div aria-hidden data-slide={INCOMING} data-line-of={lineOf(INCOMING)} className={cn("pointer-events-none absolute right-0 top-0 h-7 rounded-[5px] bg-foreground/[0.06]", lineOf(INCOMING) ? "left-3.5" : "left-0")} />
      )}
    </div>
  )
}

// ---------- other devices ----------

/** Sends this device's tabs soon after the places open change (not which one is in front), and as the page opens. A
 *  view's label goes with it (another device can't tell a terminal's name); a file's is found where it's shown. */
function Report({ store }: { store: Store }) {
  const l = useTabList()
  const info = useTabLabels(store)
  const sent = useRef("")
  const infoRef = useRef(info)
  useEffect(() => { infoRef.current = info })
  useEffect(() => {
    if (!DEVICE) return
    const id = window.setTimeout(() => {
      const tabs: DeviceTab[] = l.tabs.flatMap((t) => placesIn(t).filter((p) => p.to !== "new")
        .map((p) => ({ to: p.to, ...(p.to.startsWith("view:") ? { label: infoRef.current(p).label } : {}), ...(t.pinned ? { pinned: true } : {}) })))
      const key = JSON.stringify(tabs.map((t) => [t.to, !!t.pinned]))
      if (key === sent.current) return
      sent.current = key
      put(`tabs/devices/${DEVICE}`, { tabs }).catch(() => { sent.current = "" })
    }, 500)
    return () => clearTimeout(id)
  }, [l])
  return null
}

/** A device's heading: open now (a dot) or when it was used; right-click for its menu, its name as a field to rename. */
function DeviceHeading({ d }: { d: Device }) {
  const [renaming, setRenaming] = useState(false)
  const Icon = KIND_ICON[d.kind]
  return (
    <div className="mt-1 flex h-6 items-end gap-1.5 px-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground max-md:h-8 max-md:text-[13px]"
      onContextMenu={menuFor(() => [...deviceItems(d, () => setRenaming(true), { manage: true }), othersItem(true)])}>
      <Icon className="mb-px size-3 shrink-0" strokeWidth={2} />
      {renaming ? <DeviceNameField d={d} done={() => setRenaming(false)} className="min-w-0 flex-1 rounded-[4px] bg-card px-1 font-normal text-foreground outline-none" />
        : <span className="min-w-0 truncate">{deviceName(d)}</span>}
      {!renaming && (d.live ? <span className="mb-[5px] max-md:mb-[7px]"><LiveDot d={d} /></span> : <span className="shrink-0 font-normal text-tertiary">{fmtAgo(d.at)}</span>)}
    </div>
  )
}

/** The tabs the other devices have open, a device each (open ones first, then the latest): a click opens one here; on
 *  a device that's open now, a tab can be moved here or closed there. */
function OtherDevices({ store }: { store: Store }) {
  const info = useTabLabels(store)
  const shown = settings.use().other_devices !== false
  const list = (useDevices() ?? []).filter(inPanel)
  const leaving = useLeaving()
  if (!shown || !list.length) return null
  return (
    <div className="mt-2 flex flex-col gap-px" data-keylist data-device-tabs>
      {list.map((d: Device) => (
        <div key={d.id} className="flex flex-col gap-px" data-device={d.id} data-live={d.live ? "" : undefined} data-leaving={leaving.device(d)}>
          <DeviceHeading d={d} />
          {d.tabs.map((t) => {
            const i = info({ id: `${d.id}:${t.to}`, to: t.to })
            const label = t.to.startsWith("file:") ? i.label : t.label || i.label
            return (
              <div key={t.to} onContextMenu={menuFor(() => tabItems(d, t))} data-leaving={leaving.tab(d, t)}>
                <SidebarRow icon={i.icon} iconClassName={i.iconClassName} tint={i.tint} label={label} open
                  swipe={d.live ? () => [{ label: "Close there", icon: X, danger: true, run: () => closeOn(d, [t]), removes: true }] : undefined}
                  actions={d.live && <HeadingButton icon={X} label={`Close on ${deviceName(d)}`} tip={`Close on ${deviceName(d)}`} data-no-drag
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void closeOn(d, [t]) }} />}
                  onClick={(e) => { e.preventDefault(); openHere(t) }} />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** The tabs' last row, as a browser's vertical tabs end: a new tab at the list's end, so it takes this row's place (⌘T
 *  opens one beside the active tab). */
function NewTabRow() {
  return (
    <SidebarRow data-new-tab-row icon={Plus} label="New tab" open className="mt-px text-muted-foreground" onClick={() => openNewTab({ at: "end" })}>
      <RowKeys id="tab:new" className="group-hover/row:opacity-100 group-focus-visible/row:opacity-100" />
    </SidebarRow>
  )
}

/** The panel's foot, as Arc's: the archived tabs, how many, when there are any. */
function ArchivedRow() {
  const n = useArchivedTabs().length
  if (!n) return null
  return (
    <SidebarRow data-archived-row icon={Archive} label="Archived tabs" open className="mt-2 text-muted-foreground"
      onClick={() => openView("archived-tabs", { newTab: !isViewOpen("view:archived-tabs") })}>
      <span className="mr-1 shrink-0 text-[12px] text-tertiary tabular-nums">{n}</span>
    </SidebarRow>
  )
}

function TabsPanel({ store, open }: SidebarCtx) {
  if (!open) return null
  return (
    // (a right-click anywhere but a tab, a group or a device has the panel's menu: `menu`)
    <div className="flex shrink-0 flex-col" data-tabs-panel>
      <SidebarHeading title="Tabs" open={open} />
      <TabRows store={store} />
      <NewTabRow />
      <OtherDevices store={store} />
      <ArchivedRow />
    </div>
  )
}

export default definePlugin({
  background: ({ store }) => (isPopout() ? null : <><Report store={store} /><Archiver store={store} /></>),
  searchLive: archivedSearch,
  onMove: followMove,
  answers: { archived: archivedAnswer },
  sidebar: {
    tabs: {
      title: "Tabs", names: ["tabs", "open tabs", "tab list", "vertical tabs"], heading: false, sort: 5, hidden: true, tabList: true,
      view: "tabs", flyout: { icon: Layers2 }, render: (ctx) => <TabsPanel {...ctx} />, emptyDoubleClick: () => openNewTab({ at: "end" }),
      // (Search tabs and the archived ones; other devices' tabs on or off. Show tabs on top, the way back to the tab
      // bar, is with Move to right sidebar: where the list is.)
      menu: () => [...commandItems("tab:search"),
        { label: "Show archived tabs", icon: Archive, run: () => openView("archived-tabs", { newTab: true }) },
        { ...othersItem(settings.get().other_devices !== false), sep: true },
        { label: "Show all devices", icon: MonitorSmartphone, run: () => openView("devices", { newTab: true }) }],
    },
  },
  views: {
    tabs: {
      icon: Layers2, title: () => "Tabs",
      render: ({ store }) => (
        <div className="flex flex-col gap-4 pb-10" data-tabs-view>
          <h1 className="truncate text-[22px] leading-[28px] font-bold max-md:hidden">Tabs</h1>
          <TabRows store={store} />
          <OtherDevices store={store} />
        </div>
      ),
    },
    "archived-tabs": { icon: Archive, title: () => "Archived tabs", render: ({ store }) => <ArchivedView store={store} /> },
    devices: {
      icon: MonitorSmartphone, title: () => "Devices",
      render: () => <div className="pt-2 pb-10" data-devices-view><DevicesPanel /></div>,
    },
  },
  commands: [
    { id: "tabs:devices", name: "Show all devices", run: () => openView("devices", { newTab: true }) },
    { id: "tabs:archived", name: "Show archived tabs", run: () => openView("archived-tabs", { newTab: true }) },
  ],
})
