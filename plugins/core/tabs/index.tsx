import { useEffect, useId, useRef, useState } from "react"
import { Archive, ChevronDown, Layers2, MonitorSmartphone, Pin, Plus, X } from "lucide-react"
import {
  activePane, Badged, edgeScroller, canDropTab, closeTab, cn, colorVar, commandItems, definePlugin, DEVICE, dragTab, dropTab, fmtAgo, foldGroupMoving, groupMenu, groupName, GroupLabel,
  groupsAsDrawn, HeadingButton, isPopout, menuFor, openNewTab, isViewOpen, notifyError, openView, paneById, panesOf, useArchivedTabs, pastEnd, put, rowMenu, RowKeys, selectClick,
  selectedAttr, selectPane, selectTab, SidebarHeading, SidebarRow, springing, springTabAt, startDrag, tabMenuOf, tabPreview, tabPreviewOrder, TABS, tabSlot, tabsMenu, useDrag, useDropHit,
  useDropTarget, useGroupIn, useGroupLines, useGrowIn, useReflow, useShrinkOut, useSelectable, useSelected, useSlide, useTabLabels, useTabList, useUiMarks,
  INCOMING,
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
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); m.run() }} />
  ))}</>
}

const isBlankTab = (t: Tab) => { const ps = panesOf(t); return ps.length === 1 && ps[0].to === "new" }

/** A tab's row. A split tab's shows each pane, side by side: a click on one focuses it, and a pane dragged out of it
 *  becomes a tab of its own where it's let go (or goes into another tab, held on its row a moment: Rex's). */
function Row({ t, l, info, only, line }: { t: Tab; l: TabList; info: (x: Tab | Pane) => TabInfo; only: boolean
  /** The tab group whose line runs down by it (core/tabline.ts): its own, or the one a drag's preview puts it in. */
  line?: string }) {
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
  const label = split ? (
    <span className="flex min-w-0 items-center">
      {ps.map((p, k) => {
        const pi = info(p), on = active && p.id === t.focus
        return (
          <span key={p.id} data-pane-half={p.id} data-ui={`pane:${p.id}`} className={cn("flex min-w-0 flex-1 basis-0 items-center gap-2", k && "ml-2 border-l-[0.5px] border-border pl-2")}>
            <Badged on={pi.badge}><pi.icon className={cn("size-4 shrink-0", pi.tint ? undefined : on ? "text-primary" : "text-muted-foreground", pi.iconClassName)} strokeWidth={2} style={pi.tint ? { color: pi.tint } : undefined} /></Badged>
            <span className={cn("min-w-0 flex-1 overflow-hidden fade-end", active && !on && "font-normal text-muted-foreground")}>{pi.label}</span>
          </span>
        )
      })}
    </span>
  ) : i.label
  const dragging = item?.tab === t.id || (picked && item?.tabs) || (!!t.group && item?.group === t.group)
  return (
    // Dragged like a tab in the bar: along the list (in or out of a group), onto a pane (its edge splits, its middle
    // replaces it), or Pinned; selected with others, they all go.
    <div ref={box} data-slide={t.id} data-ui={`tab:${t.id}`} data-spring-tab={t.id} data-in-group={t.group} data-line-of={line} onPointerDown={press}
      className={cn("relative", dragging && "opacity-50")}
      onContextMenu={menuFor(rowMenu(TABS, t.id, () => tabMenuOf(t.id)))}>
      <SidebarRow data-open-tab={t.id} data-select-key={t.id} data-split={split ? "" : undefined} {...selectedAttr(picked)} icon={split ? undefined : i.icon} iconClassName={i.iconClassName} tint={i.tint}
        badge={split ? undefined : i.badge} mark={split ? undefined : i.mark} label={label} tip={split ? ps.map((p) => info(p).label).join(" | ") : undefined} open active={active} more
        className={cn(line && "ml-3.5", lit && !active && "bg-foreground/[0.08]")}
        swipe={() => (t.pinned || only ? [] : [{ label: "Close", icon: X, danger: true, run: () => closeTab(t.id), removes: true }])}
        onClick={click}>
        <Marks id={`tab:${t.id}`} />
        {t.pinned ? (
          <span className="grid size-5 shrink-0 place-items-center text-muted-foreground" aria-label="Pinned"><Pin className="size-3.5" strokeWidth={2} /></span>
        ) : !only && (
          <HeadingButton icon={X} label={`Close ${i.label}`} tip="Close tab" className={cn("hidden group-hover/row:grid", lit && "grid")} data-no-drag
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); close() }} />
        )}
      </SidebarRow>
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
/** Whether (x, y) is just under the last row or on the New tab row, which a drop puts at the list's end. */
function atEnd(root: HTMLElement, x: number, y: number, el: Element | null) {
  const row = [...root.querySelectorAll("[data-open-tab], [data-group-row]")].at(-1)
  return !!row && (!!el?.closest("[data-new-tab-row]") || pastEnd(root, row, x, y, el))
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
    // (a pane or tab held on a row's middle opens its tab after a moment: no place made there)
    if ((!(el && root.contains(el)) && !atEnd(root, x, y, el)) || springTabAt(item, x, y)) return null
    const slots = [...root.querySelectorAll<HTMLElement>("[data-open-tab], [data-group-row]")].map((e) => ({ el: e, tab: e.dataset.openTab, group: e.dataset.groupRow }))
    const at = tabSlot(l, slots, y, "y")
    const d: TabDrop = { kind: "list", index: at.index, group: item.group ? null : at.group }
    return canDropTab(item, d) ? d : null
  }, (item, d) => dropTab(item, d), { end: edge.stop })
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
        const row = g?.collapsed ? null : <Row key={t.id} t={t} l={l} info={info} only={only(t)} line={lineOf(t.id)} />
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
      const tabs: DeviceTab[] = l.tabs.flatMap((t) => panesOf(t).filter((p) => p.to !== "new")
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
                  onClick={(e) => { e.preventDefault(); openHere(t) }}>
                  {d.live && <HeadingButton icon={X} label={`Close on ${deviceName(d)}`} tip={`Close on ${deviceName(d)}`} className="hidden group-hover/row:grid" data-no-drag
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void closeOn(d, [t]) }} />}
                </SidebarRow>
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
      // (Search tabs, Show tabs on top, the way back to the tab bar, and other devices' tabs on or off)
      menu: () => [...commandItems("tab:search", "tab:sidebar"), othersItem(settings.get().other_devices !== false),
        { label: "Show all devices", icon: MonitorSmartphone, run: () => openView("devices", { newTab: true }) },
        { label: "Show archived tabs", icon: Archive, run: () => openView("archived-tabs", { newTab: true }) }],
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
