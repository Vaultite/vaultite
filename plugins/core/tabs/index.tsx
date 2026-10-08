import { useEffect, useRef } from "react"
import { Globe, Layers2, Monitor, Pin, Plus, Smartphone, X } from "lucide-react"
import {
  closeTab, cn, definePlugin, del, dragTab, fmtAgo, isPopout, menuFor, newTab, notifyError, openFile, openView, panelMenu, panesOf, put, rowMenu, selectClick,
  selectedAttr, selectTab, SidebarHeading, SidebarRow, TABS, tabsMenu, useDrag, useSelectable, useSelected, useTabLabels, useTabLayout, tabMenuOf,
  type SidebarCtx, type Store, type Tab, type TabGroup, type TabInfo,
} from "@vaultite"
import type { Device, DeviceTab } from "./types"

// The open tabs as a list in the sidebar, pane by pane, so the tab bar can be off (`tabBar`); under them the other
// devices' tabs (plugin.ts), to open here.

const button = "grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"

function Row({ t, g, i, only, panel }: { t: Tab; g: TabGroup; i: TabInfo; only: boolean; panel?: string }) {
  const d = useDrag()
  const picked = useSelected(TABS, t.id)
  return (
    // Dragged like a tab in its bar: onto a pane (its edge splits), another bar, or Pinned; selected with others, they all go.
    <div onPointerDown={(e) => dragTab(e, t)} className={cn((d?.item.tab === t.id || (picked && d?.item.tabs)) && "opacity-50")}
      onContextMenu={menuFor(rowMenu(TABS, t.id, () => [...tabMenuOf(t.id), ...(panel ? panelMenu(panel).map((it, n) => (n ? it : { ...it, sep: true })) : [])]))}>
      <SidebarRow data-open-tab={t.id} data-select-key={t.id} {...selectedAttr(picked)} icon={i.icon} iconClassName={i.iconClassName} tint={i.tint} badge={i.badge} label={i.label} open active={t.id === g.active}
        swipe={() => (t.pinned || only ? [] : [{ label: "Close", icon: X, danger: true, run: () => closeTab(t.id), removes: true }])}
        onClick={(e) => { if (e.button === 1) { if (!t.pinned && !only) closeTab(t.id) } else if (!selectClick(e, TABS, t.id, g.active)) selectTab(t.id) }}>
        {t.pinned ? (
          <span className="grid size-5 shrink-0 place-items-center text-muted-foreground" aria-label="Pinned"><Pin className="size-3.5" strokeWidth={2} /></span>
        ) : !only && (
          <button type="button" className={`${button} hidden group-hover/row:grid`} aria-label={`Close ${i.label}`} data-tip="Close tab" data-no-drag
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); closeTab(t.id) }}><X className="size-3.5" strokeWidth={2.25} /></button>
        )}
      </SidebarRow>
    </div>
  )
}

/** Every pane's tabs, in the panes' order; with more than one pane, each under its number (the focused one's in full). */
function TabRows({ store, panel }: { store: Store; panel?: string }) {
  const ws = useTabLayout()
  const info = useTabLabels(store)
  const panes = panesOf(ws.root)
  useSelectable(TABS, { menu: (ids) => tabsMenu(ids), noun: ["tab", "tabs"] })
  return (
    <div className="flex flex-col gap-px" data-keylist data-open-tabs data-select-list={TABS}>
      {panes.map((g, n) => (
        <div key={g.id} className="flex flex-col gap-px" data-tabs-pane={g.id}>
          {panes.length > 1 && (
            <div className={cn("flex h-6 items-end px-1.5 pb-0.5 text-[11px] font-medium max-md:h-8 max-md:text-[13px]", n && "mt-1",
              g.id === ws.focus ? "text-muted-foreground" : "text-tertiary")}>Pane {n + 1}</div>
          )}
          {g.tabs.map((t) => <Row key={t.id} t={t} g={g} i={info(t)} only={panes.length === 1 && g.tabs.length === 1 && t.to === "new"} panel={panel} />)}
        </div>
      ))}
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
  const list = (store.tabDevices ?? []).filter((d) => d.id !== DEVICE && d.tabs.length)
  if (!list.length) return null
  return (
    <div className="mt-2 flex flex-col gap-px" data-keylist data-device-tabs>
      {list.map((d: Device) => {
        const Icon = KIND_ICON[d.kind]
        return (
          <div key={d.id} className="flex flex-col gap-px" data-device={d.id}>
            <div className="mt-1 flex h-6 items-end gap-1.5 px-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground max-md:h-8 max-md:text-[13px]"
              onContextMenu={menuFor(() => [{ label: "Forget this device", icon: X, run: () => { del(`tabs/devices/${d.id}`).catch((e) => notifyError(e, "Couldn't forget it")) } }])}>
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

function TabsPanel({ store, open, panel }: SidebarCtx) {
  if (!open) return null
  return (
    <div className="flex shrink-0 flex-col" data-tabs-panel>
      <SidebarHeading title="Tabs" open={open}>
        <button type="button" className={button} aria-label="New tab" data-tip="New tab" onClick={() => newTab()}><Plus className="size-3.5" strokeWidth={2.25} /></button>
      </SidebarHeading>
      <TabRows store={store} panel={panel} />
      <OtherDevices store={store} />
    </div>
  )
}

export default definePlugin({
  icon: Layers2,
  background: ({ store }) => (isPopout() ? null : <Report store={store} />),
  sidebar: {
    tabs: {
      title: "Tabs", names: ["tabs", "open tabs", "tab list", "vertical tabs"], heading: false, sort: 5, hidden: true,
      view: "tabs", flyout: { icon: Layers2 }, render: (ctx) => <TabsPanel {...ctx} />,
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
