import { useEffect, useRef } from "react"
import { ChevronDown, ChevronRight, Globe, Layers2, Monitor, Pin, Plus, Smartphone, X } from "lucide-react"
import {
  canDropTab, closeTab, cn, colorVar, commandItems, definePlugin, del, dotIcon, dragTab, dropTab, fmtAgo, foldSet, HeadingButton, isPopout, menuFor, newTab,
  notifyError, openFile, openView, panesOf, pluginSettings, put, rowMenu, selectClick, selectedAttr, selectTab, setMenu, setName, SetNameField, SidebarHeading,
  SidebarRow, startDrag, tabMenuOf, TABS, tabSlot, tabsMenu, useDrag, useDropHit, useDropTarget, useRenaming, useSelectable, useSelected, useTabLabels, useTabLayout,
  type DragItem, type SidebarCtx, type Store, type Tab, type TabDrop, type TabGroup, type TabInfo, type TabSet,
} from "@vaultite"
import type { Device, DeviceTab } from "./types"

// The open tabs as a list in the sidebar, pane by pane, so the tab bar can be off (`tabBar`); under them the other
// devices' tabs (plugin.ts), to open here.

const settings = pluginSettings<{ other_devices?: boolean }>("tabs")
/** Other devices' tabs on or off, from a right-click on the heading or a device (the setting's sheet has it too). */
const othersItem = (shown: boolean) => ({
  label: "Other devices' tabs", checked: shown, run: () => { settings.set({ other_devices: !shown }).catch((e) => notifyError(e, "Couldn't change it")) },
})


function Row({ t, g, i, only, inSet }: { t: Tab; g: TabGroup; i: TabInfo; only: boolean; inSet?: boolean }) {
  const d = useDrag()
  const picked = useSelected(TABS, t.id)
  return (
    // Dragged like a tab in its bar: along the list (in or out of a group), onto a pane (its edge splits), another bar,
    // or Pinned; selected with others, they all go.
    <div onPointerDown={(e) => dragTab(e, t)} className={cn((d?.item.tab === t.id || (picked && d?.item.tabs) || (!!t.set && d?.item.tabset === t.set)) && "opacity-50")}
      onContextMenu={menuFor(rowMenu(TABS, t.id, () => tabMenuOf(t.id)))}>
      <SidebarRow data-open-tab={t.id} data-select-key={t.id} {...selectedAttr(picked)} icon={i.icon} iconClassName={i.iconClassName} tint={i.tint} badge={i.badge} iconAction={i.action} label={i.label} open active={t.id === g.active} more
        className={inSet ? "pl-5" : undefined}
        swipe={() => (t.pinned || only ? [] : [{ label: "Close", icon: X, danger: true, run: () => closeTab(t.id), removes: true }])}
        onClick={(e) => { if (e.button === 1) { if (!t.pinned && !only) closeTab(t.id) } else if (!selectClick(e, TABS, t.id, g.active)) selectTab(t.id) }}>
        {t.pinned ? (
          <span className="grid size-5 shrink-0 place-items-center text-muted-foreground" aria-label="Pinned"><Pin className="size-3.5" strokeWidth={2} /></span>
        ) : !only && (
          <HeadingButton icon={X} label={`Close ${i.label}`} tip="Close tab" className="hidden group-hover/row:grid" data-no-drag
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); closeTab(t.id) }} />
        )}
      </SidebarRow>
    </div>
  )
}

/** A tab group's row, its tabs indented under it: a click folds it, right-click has its menu, dragging it moves the
 *  whole group. */
function SetRow({ s, n }: { s: TabSet; n: number }) {
  const renaming = useRenaming()
  const editing = renaming?.id === s.id && renaming.at === "panel"
  const d = useDrag()
  const Chevron = s.collapsed ? ChevronRight : ChevronDown
  return (
    <div onPointerDown={(e) => { if (!editing) startDrag(e, { from: "tabset", tabset: s.id, label: setName(s) }) }} className={cn(d?.item.tabset === s.id && "opacity-50")}
      onContextMenu={menuFor(() => setMenu(s.id, "panel"))}>
      <SidebarRow data-set-row={s.id} aria-expanded={!s.collapsed} icon={dotIcon(colorVar(s.color))} open tip={null} onClick={() => { if (!editing) foldSet(s.id) }}
        label={editing ? <SetNameField s={s} className="h-5.5 text-[13px]" /> : <span className={cn("font-medium", !s.name && "text-muted-foreground")}>{setName(s)}</span>}>
        <span className="shrink-0 text-[12px] text-tertiary tabular-nums">{n}</span>
        {/* (open, its chevron shows on hover, as a panel heading's does) */}
        <Chevron aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground", !s.collapsed && "opacity-0 group-hover/row:opacity-100")} strokeWidth={2.25} />
      </SidebarRow>
    </div>
  )
}

/** What a drop among a pane's rows does, and where its line goes (from the pane's top). */
type ListHit = { d: Extract<TabDrop, { kind: "bar" }>; y: number }
const LIST = "tabs:list"

/** Every pane's tabs, in the panes' order, each tab group a row with its tabs under it; with more than one pane, each
 *  under its number (the focused one's in full). Dragged along the list, a tab moves, joining or leaving a group. */
function TabRows({ store }: { store: Store }) {
  const ws = useTabLayout()
  const info = useTabLabels(store)
  const panes = panesOf(ws.root)
  useSelectable(TABS, { menu: (ids) => tabsMenu(ids), noun: ["tab", "tabs"] })
  useDropTarget<ListHit>(LIST, (item: DragItem, _x, y, el) => {
    const box = el?.closest<HTMLElement>("[data-tabs-pane]")
    const g = box && panesOf(ws.root).find((x) => x.id === box.dataset.tabsPane)
    if (!box || !g || !(item.tab || item.tabset || item.to || item.group)) return null
    const own = item.tab ? g.tabs.find((t) => t.id === item.tab)?.set : undefined
    const slots = [...box.querySelectorAll<HTMLElement>("[data-open-tab], [data-set-row]")].map((e) => ({ el: e, tab: e.dataset.openTab, set: e.dataset.setRow }))
    const at = tabSlot(g, slots, y, "y", own)
    const d: ListHit["d"] = { kind: "bar", group: g.id, index: at.index, x: 0, set: item.tabset ? null : at.set }
    return canDropTab(item, d) ? { d, y: (slots.length ? at.edge : box.getBoundingClientRect().top) - box.getBoundingClientRect().top } : null
  }, (item, h) => dropTab(item, h.d))
  const hit = useDropHit<ListHit>(LIST)
  return (
    <div className="flex flex-col gap-px" data-keylist data-open-tabs data-select-list={TABS}>
      {panes.map((g, n) => {
        const only = (t: Tab) => panes.length === 1 && g.tabs.length === 1 && t.to === "new"
        const line = hit?.d.group === g.id ? hit : null
        const lineSet = line?.d.set ? g.sets?.find((x) => x.id === line.d.set) : undefined
        return (
          <div key={g.id} className="relative flex flex-col gap-px" data-tabs-pane={g.id}>
            {panes.length > 1 && (
              <div className={cn("flex h-6 items-end px-1.5 pb-0.5 text-[11px] font-medium max-md:h-8 max-md:text-[13px]", n && "mt-1",
                g.id === ws.focus ? "text-muted-foreground" : "text-tertiary")}>Pane {n + 1}</div>
            )}
            {g.tabs.map((t, i) => {
              const s = t.set ? g.sets?.find((x) => x.id === t.set) : undefined
              if (!s) return <Row key={t.id} t={t} g={g} i={info(t)} only={only(t)} />
              if (g.tabs[i - 1]?.set === s.id) return null
              const run = g.tabs.filter((x) => x.set === s.id)
              return (
                <div key={`set:${s.id}`} className="relative flex flex-col gap-px">
                  <SetRow s={s} n={run.length} />
                  {/* (a line in the group's colour down its tabs, from under its dot) */}
                  {!s.collapsed && <span aria-hidden className="pointer-events-none absolute top-7.5 bottom-0.5 left-[13px] w-[2px] rounded-full"
                    style={{ background: `color-mix(in srgb, ${colorVar(s.color)} 55%, transparent)` }} />}
                  {!s.collapsed && run.map((x) => <Row key={x.id} t={x} g={g} i={info(x)} only={only(x)} inSet />)}
                </div>
              )
            })}
            {line && <div aria-hidden data-drop-line className={cn("pointer-events-none absolute right-1 left-1 h-[2px] -translate-y-1/2 rounded-full", !lineSet && "bg-primary")}
              style={{ top: line.y, ...(lineSet ? { background: colorVar(lineSet.color) } : {}) }} />}
          </div>
        )
      })}
    </div>
  )
}

// ---------- other devices ----------

/** This device, as the server knows it: an id kept in this browser (each browser, and each address of the server, is
 *  a device of its own, as its tabs are). */
const DEVICE = (() => {
  const key = "vaultite.device"
  try {
    const had = localStorage.getItem(key)
    if (had && /^[a-z0-9]{8,32}$/.test(had)) return had
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join("")
    localStorage.setItem(key, id)
    return id
  } catch { return "" }
})()

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

const KIND_ICON = { desktop: Monitor, phone: Smartphone, web: Globe }
const opened = (t: DeviceTab) => (t.to.startsWith("file:") ? openFile(t.to.slice(5), { newTab: true }) : openView(t.to, { newTab: true }))

/** The tabs the other devices have open, a device each (the latest first): a click opens one here. */
function OtherDevices({ store }: { store: Store }) {
  const info = useTabLabels(store)
  const shown = settings.use().other_devices !== false
  const list = (store.tabDevices ?? []).filter((d) => d.id !== DEVICE && d.tabs.length)
  if (!shown || !list.length) return null
  return (
    <div className="mt-2 flex flex-col gap-px" data-keylist data-device-tabs>
      {list.map((d: Device) => {
        const Icon = KIND_ICON[d.kind]
        return (
          <div key={d.id} className="flex flex-col gap-px" data-device={d.id}>
            <div className="mt-1 flex h-6 items-end gap-1.5 px-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground max-md:h-8 max-md:text-[13px]"
              onContextMenu={menuFor(() => [
                { label: "Forget this device", icon: X, run: () => { del(`tabs/devices/${d.id}`).catch((e) => notifyError(e, "Couldn't forget it")) } },
                othersItem(true),
              ])}>
              <Icon className="mb-px size-3 shrink-0" strokeWidth={2} />
              <span className="min-w-0 truncate">{d.name}</span>
              <span className="shrink-0 font-normal text-tertiary">{fmtAgo(d.at)}</span>
            </div>
            {d.tabs.map((t) => {
              const i = info({ id: `${d.id}:${t.to}`, to: t.to })
              return <SidebarRow key={t.to} icon={i.icon} iconClassName={i.iconClassName} tint={i.tint} label={t.to.startsWith("file:") ? i.label : t.label || i.label} open
                onClick={(e) => { e.preventDefault(); opened(t) }} />
            })}
          </div>
        )
      })}
    </div>
  )
}

function TabsPanel({ store, open }: SidebarCtx) {
  if (!open) return null
  return (
    // (a right-click anywhere but a tab, a group or a device has the panel's menu: `menu`)
    <div className="flex shrink-0 flex-col" data-tabs-panel>
      <SidebarHeading title="Tabs" open={open}>
        <HeadingButton icon={Plus} label="New tab" onClick={() => newTab()} />
      </SidebarHeading>
      <TabRows store={store} />
      <OtherDevices store={store} />
    </div>
  )
}

export default definePlugin({
  background: ({ store }) => (isPopout() ? null : <Report store={store} />),
  sidebar: {
    tabs: {
      title: "Tabs", names: ["tabs", "open tabs", "tab list", "vertical tabs"], heading: false, sort: 5, hidden: true, tabList: true,
      view: "tabs", flyout: { icon: Layers2 }, render: (ctx) => <TabsPanel {...ctx} />,
      // (Show tabs on top, the way back to the tab bar, and other devices' tabs on or off)
      menu: () => [...commandItems("tab:sidebar"), othersItem(settings.get().other_devices !== false)],
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
  },
})
