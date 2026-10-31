import { useEffect, useId, useRef, useState } from "react"
import { Archive, ChevronDown, Layers2, MonitorSmartphone, Pin, Plus, X } from "lucide-react"
import {
  edgeScroller, canDropTab, closeTab, closeTabMoving, cn, colorVar, commandItems, definePlugin, DEVICE, dragTab, dropTab, fmtAgo, foldSetMoving, HeadingButton, isPopout, menuFor, openNewTab,
  isViewOpen, notifyError, openView, panesOf, useArchivedTabs, pastEnd, put, rowMenu, RowKeys, selectClick, selectedAttr, selectTab, setMenu, setName, SetLabel, SidebarHeading,
  SidebarRow, startDrag, tabMenuOf, tabPreview, tabPreviewOrder, TABS, tabSlot, tabsMenu, useDrag, useDropHit, useDropTarget, useGrowIn, useSelectable, useSelected, useSlide, useTabLabels, useTabLayout,
  INCOMING, setsAsDrawn,
  type DragItem, type SidebarCtx, type Store, type Tab, type TabDrop, type TabGroup, type TabInfo, type TabSet,
} from "@vaultite"
import type { Device, DeviceTab } from "./types"
import { archivedAnswer, ArchivedView, archivedSearch, Archiver, followMove } from "./archived"
import { settings } from "./settings"
import { closeOn, deviceItems, deviceName, DeviceNameField, DevicesPanel, inPanel, KIND_ICON, LiveDot, openHere, tabItems, useDevices, useLeaving } from "./devices"

// The open tabs as a list in the sidebar, pane by pane, so the tab bar can be off (`tabBar`); under them the other
// devices' tabs (plugin.ts), to open here.

/** Other devices' tabs on or off, from a right-click on the heading or a device (the setting's sheet has it too). */
const othersItem = (shown: boolean) => ({
  label: "Other devices' tabs", checked: shown, run: () => { settings.set({ other_devices: !shown }).catch((e) => notifyError(e, "Couldn't change it")) },
})


/** A tab group's line down the panel's left, in its colour: from under its chip, past its tabs (set in from it), ending
 *  rounded by its last. Each row draws its piece (a drag's preview redraws them). */
type Rail = { color: string; last?: boolean }
function RailPiece({ rail, from }: { rail: Rail
  /** The group's row: where its chip ends, down from the row's middle. */
  from?: number }) {
  return <span aria-hidden className={cn("pointer-events-none absolute left-[9px] w-[2px] transition-colors duration-200", from !== undefined ? "-bottom-px" : "-top-px",
    from === undefined && (rail.last ? "bottom-2 rounded-b-full" : "-bottom-px"))} style={{ background: rail.color, ...(from !== undefined ? { top: `calc(50% + ${from}px)` } : {}) }} />
}

function Row({ t, g, i, only, rail }: { t: Tab; g: TabGroup; i: TabInfo; only: boolean; rail?: Rail }) {
  const item = useDrag((d) => d?.item)
  const picked = useSelected(TABS, t.id)
  const box = useRef<HTMLDivElement>(null)
  useGrowIn(box, t)
  const close = () => closeTabMoving(t.id, box.current)
  return (
    // Dragged like a tab in its bar: along the list (in or out of a group), onto a pane (its edge splits), another bar,
    // or Pinned; selected with others, they all go.
    <div ref={box} data-slide={t.id} data-in-set={t.set} onPointerDown={(e) => dragTab(e, t)} className={cn("relative", (item?.tab === t.id || (picked && item?.tabs) || (!!t.set && item?.tabset === t.set)) && "opacity-50")}
      onContextMenu={menuFor(rowMenu(TABS, t.id, () => tabMenuOf(t.id)))}>
      <SidebarRow data-open-tab={t.id} data-select-key={t.id} {...selectedAttr(picked)} icon={i.icon} iconClassName={i.iconClassName} tint={i.tint} badge={i.badge} mark={i.mark} label={i.label} open active={t.id === g.active} more
        className={rail ? "ml-3.5" : undefined}
        swipe={() => (t.pinned || only ? [] : [{ label: "Close", icon: X, danger: true, run: () => closeTab(t.id), removes: true }])}
        onClick={(e) => { if (e.button === 1) { if (!t.pinned && !only) close() } else if (!selectClick(e, TABS, t.id, g.active)) selectTab(t.id) }}>
        {t.pinned ? (
          <span className="grid size-5 shrink-0 place-items-center text-muted-foreground" aria-label="Pinned"><Pin className="size-3.5" strokeWidth={2} /></span>
        ) : !only && (
          <HeadingButton icon={X} label={`Close ${i.label}`} tip="Close tab" className="hidden group-hover/row:grid" data-no-drag
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); close() }} />
        )}
      </SidebarRow>
      {rail && <RailPiece rail={rail} />}
    </div>
  )
}

/** A tab group's row: its chip, its line hanging from it. A click folds it, its … or a right-click opens its editor,
 *  dragging moves the whole group; `target`: a tab dragged onto it (folded) would join it. */
function SetRow({ s, n, rail, target }: { s: TabSet; n: number; rail?: Rail; target: boolean }) {
  const item = useDrag((d) => d?.item)
  return (
    <div data-slide={`set:${s.id}`} onPointerDown={(e) => startDrag(e, { from: "tabset", tabset: s.id, label: setName(s) })} className={cn("relative", item?.tabset === s.id && "opacity-50")}
      onContextMenu={menuFor(() => setMenu(s.id, "panel"))}>
      <SidebarRow data-set-row={s.id} aria-expanded={!s.collapsed} open tip={null} more onClick={() => foldSetMoving(s.id)} label={<SetLabel s={s} n={n} target={target} />}>
        {/* (its chevron shows on hover, as a panel heading's does, turning as it folds) */}
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-[rotate,opacity] duration-200 group-hover/row:opacity-100 group-aria-[expanded=false]/row:-rotate-90" strokeWidth={2.25} />
      </SidebarRow>
      {rail && <RailPiece rail={rail} from={s.name ? 10 : 7} />}
    </div>
  )
}

const LIST = "tabs:list"
/** The last pane's box when (x, y) is just under its tabs or on the New tab row, which a drop puts at its end. */
function endOf(root: HTMLElement, x: number, y: number, el: Element | null) {
  const last = root.querySelector<HTMLElement>("[data-tabs-pane]:last-child")
  const row = last && [...last.querySelectorAll("[data-open-tab], [data-set-row]")].at(-1)
  return row && (el?.closest("[data-new-tab-row]") || pastEnd(root, row, x, y, el)) ? last : null
}

/** Every pane's tabs, in the panes' order, each tab group a row with its tabs under it; with more than one pane, each
 *  under its number (the focused one's in full). Dragged along the list, a tab moves, joining or leaving a group. */
function TabRows({ store }: { store: Store }) {
  const ws = useTabLayout()
  const info = useTabLabels(store)
  const panes = panesOf(ws.root)
  useSelectable(TABS, { menu: (ids) => tabsMenu(ids), noun: ["tab", "tabs"] })
  const list = useRef<HTMLDivElement>(null)
  const target = `${LIST}:${useId()}`
  const [edge] = useState(() => edgeScroller())
  useDropTarget<TabDrop>(target, (item: DragItem, x, y, el) => {
    const root = list.current
    if (!root) return null
    // (held near the top or bottom of what scrolls the list, it scrolls: more tabs than the panel shows)
    if (item.tab || item.tabset || item.to || item.group) edge.over(root, x, y)
    const box = el?.closest<HTMLElement>("[data-tabs-pane]") ?? endOf(root, x, y, el)
    const g = box && root.contains(box) && panesOf(ws.root).find((p) => p.id === box.dataset.tabsPane)
    if (!box || !g || !(item.tab || item.tabset || item.to || item.group)) return null
    const slots = [...box.querySelectorAll<HTMLElement>("[data-open-tab], [data-set-row]")].map((e) => ({ el: e, tab: e.dataset.openTab, set: e.dataset.setRow }))
    const at = tabSlot(g, slots, y, "y")
    const d: TabDrop = { kind: "bar", group: g.id, index: at.index, set: item.tabset ? null : at.set }
    return canDropTab(item, d) ? d : null
  }, (item, d) => dropTab(item, d), { end: edge.stop })
  const hit = useDropHit<TabDrop>(target)
  return (
    <div ref={list} className="flex flex-col gap-px" data-keylist data-open-tabs data-select-list={TABS}>
      {panes.map((g, n) => <PaneRows key={g.id} g={g} n={n} panes={panes.length} focused={g.id === ws.focus} info={info} hit={hit} />)}
    </div>
  )
}

/** One pane's rows: dragged over, they make way for what's dragged, in the tab group it would join (its line by it). */
function PaneRows({ g, n, panes, focused, info, hit }: { g: TabGroup; n: number; panes: number; focused: boolean; info: (t: Tab) => TabInfo; hit: TabDrop | null }) {
  const item = useDrag((d) => d?.item)
  const box = useRef<HTMLDivElement>(null)
  const preview = item ? tabPreview(g, item, hit) : null
  useSlide(box, preview && tabPreviewOrder(g, preview), "y")
  const shown = preview?.tabs ?? g.tabs
  const drawn = setsAsDrawn(shown)
  const railOf = (id: string): Rail | undefined => {
    const at = drawn.get(id), s = at?.set ? g.sets?.find((x) => x.id === at.set) : undefined
    return s && !s.collapsed ? { color: colorVar(s.color), last: at!.last } : undefined
  }
  const only = (t: Tab) => panes === 1 && g.tabs.length === 1 && t.to === "new"
  const incoming = shown.some((t) => t.id === INCOMING)
  return (
    <div ref={box} className="relative flex flex-col gap-px" data-tabs-pane={g.id}>
      {panes > 1 && (
        <div className={cn("flex h-6 items-end px-1.5 pb-0.5 text-[11px] font-medium max-md:h-8 max-md:text-[13px]", n && "mt-1",
          focused ? "text-muted-foreground" : "text-tertiary")}>Pane {n + 1}</div>
      )}
      {g.tabs.flatMap((t, i) => {
        const s = t.set ? g.sets?.find((x) => x.id === t.set) : undefined
        const head = s && g.tabs[i - 1]?.set !== s.id
          ? <SetRow key={`set:${s.id}`} s={s} n={shown.filter((x) => x.set === s.id).length} target={preview?.into === s.id}
            rail={s.collapsed ? undefined : { color: colorVar(s.color) }} />
          : null
        const row = s?.collapsed ? null : <Row key={t.id} t={t} g={g} i={info(t)} only={only(t)} rail={railOf(t.id)} />
        return [head, row].filter(Boolean)
      })}
      {/* Where something from elsewhere would open. */}
      {incoming && (
        <div aria-hidden data-slide={INCOMING} className={cn("pointer-events-none absolute right-0 top-0 h-7 rounded-[5px] bg-foreground/[0.06]", railOf(INCOMING) ? "left-3.5" : "left-0")}>
          {railOf(INCOMING) && <span className="absolute inset-y-0 -left-3.5 w-3.5"><RailPiece rail={railOf(INCOMING)!} /></span>}
        </div>
      )}
    </div>
  )
}

// ---------- other devices ----------

/** Sends this device's tabs when the places open change (not which one is in front), and once as the page opens. A
 *  view's label goes with it (another device can't tell a terminal's name); a file's is found where it's shown. */
function Report({ store }: { store: Store }) {
  const ws = useTabLayout()
  const info = useTabLabels(store)
  const sent = useRef("")
  const infoRef = useRef(info)
  useEffect(() => { infoRef.current = info })
  useEffect(() => {
    if (!DEVICE) return
    const id = window.setTimeout(() => {
      const tabs: DeviceTab[] = panesOf(ws.root).flatMap((g) => g.tabs).filter((t) => t.to !== "new")
        .map((t) => ({ to: t.to, ...(t.to.startsWith("view:") ? { label: infoRef.current(t).label } : {}), ...(t.pinned ? { pinned: true } : {}) }))
      const key = JSON.stringify(tabs.map((t) => [t.to, !!t.pinned]))
      if (key === sent.current) return
      sent.current = key
      put(`tabs/devices/${DEVICE}`, { tabs }).catch(() => { sent.current = "" })
    }, 2000)
    return () => clearTimeout(id)
  }, [ws])
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
  const list = (useDevices(store) ?? []).filter(inPanel)
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

/** The tabs' last row, as a browser's vertical tabs end: a new tab in the focused pane, at its end, so it takes this
 *  row's place (⌘T opens one beside the active tab). */
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
      render: ({ store }) => <div className="pt-2 pb-10" data-devices-view><DevicesPanel store={store} /></div>,
    },
  },
  commands: [
    { id: "tabs:devices", name: "Show all devices", run: () => openView("devices", { newTab: true }) },
    { id: "tabs:archived", name: "Show archived tabs", run: () => openView("archived-tabs", { newTab: true }) },
  ],
})
