// Tabs (desktop): a bar per group; drag a tab to reorder, onto another bar, or onto a pane (an edge
// splits). Drops that would change nothing aren't offered; a whole pane drags by the handle at its bar's end.
import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { AppWindow, Columns2, Files, LayoutList, MousePointerClick, GripVertical, Folder, PanelTop, FileText, Layers, Pin, PinOff, Plus, Rows2, SquareDashed, X, type LucideIcon } from "lucide-react"
import type { Store } from "@/core/data"
import { startDrag, useDrag, useDropHit, type DragItem } from "@/core/drag"
import { stem } from "@/core/files"
import { askRename, closeTab, closeTabIds, closeTabs, getWorkspace, groupOfTab, isPopout, newTab, selectTab, togglePinTab, toggleStacked, popOut } from "@/core/workspace"
import { moveTabsTo, hasSiblings, moveToSplit, splitTab } from "@/core/splits"
import { hasMainWindow, moveToMain } from "@/core/windows"
import { leaves, vaultPath, type Group, type Tab } from "@/core/layout"
import { PANES, type Drop } from "@/core/drop"
import { useViewsVersion, viewFor } from "@/core/plugins"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { commandItems, menuFor, type MenuItem } from "@/components/ContextMenu"
import { fileIcon } from "@/components/FileTree"
import { copyText, copyToVaultItem, fileMenu, revealItem } from "@/components/FileActions"
import { Badged } from "@/components/kit"
import { cn } from "@/lib/utils"
import { rowMenu, selectClick, selectedAttr, selectionFor, useSelectable, useSelected } from "@/core/select"

/** `iconClassName`: a status on the icon (a view's `iconClass`: a Claude Code session working or waiting). */
export type TabInfo = { label: string; icon: LucideIcon; tint?: string; iconClassName?: string
  /** A dot on the icon (a view's `iconBadge`: a coding agent waiting for you). */
  badge?: boolean }


/** Right-click on a tab. */
function tabMenu(tab: Tab, last: boolean, count: number, group: Group): MenuItem[] {
  const out: MenuItem[] = [
    tab.pinned ? { label: "Unpin", icon: PinOff, run: () => togglePinTab(tab.id) } : { label: "Pin", icon: Pin, run: () => togglePinTab(tab.id) },
    { label: "Close", icon: X, sep: true, run: () => closeTab(tab.id) },
    { label: "Close others", run: () => closeTabs("others", tab.id), disabled: count < 2 },
    { label: "Close tabs to the right", run: () => closeTabs("right", tab.id), disabled: last },
    { label: "Close all", run: () => closeTabs("all", tab.id) },
    { label: "Split right", icon: Columns2, sep: true, run: () => splitTab("right", tab.id) },
    { label: "Split down", icon: Rows2, run: () => splitTab("bottom", tab.id) },
    { label: "Move to new split right", run: () => moveToSplit("right", tab.id), disabled: !hasSiblings(tab.id) },
    { label: "Move to new split down", run: () => moveToSplit("bottom", tab.id), disabled: !hasSiblings(tab.id) },
    ...(isPopout() ? [{ label: "Move to main window", icon: AppWindow, sep: true, run: () => moveToMain([tab.id]), disabled: !hasMainWindow() }] : []),
    { label: "Move to new window", icon: isPopout() ? undefined : AppWindow, sep: !isPopout(), run: () => popOut(tab.id, true), disabled: tab.to === "new" },
    { label: "Open in new window", run: () => popOut(tab.id), disabled: tab.to === "new" },
    ...barItems(group),
  ]
  out.push(...tabItems(tab))
  return out
}

/** The tabs' selection (core/select.ts): by tab id, the bars', the Tabs panel's and the phone's cards alike. */
export const TABS = "tabs"

/** What tabs selected together can do: close them (or the others), pin them, move them into a split of their own. */
export function tabsMenu(ids: string[], phone = false): MenuItem[] {
  const all = leaves(getWorkspace().root).flatMap((g) => g.tabs)
  const tabs = all.filter((t) => ids.includes(t.id))
  if (!tabs.length) return []
  const n = tabs.length, pinned = tabs.every((t) => t.pinned)
  const files = tabs.map((t) => vaultPath(t.to)).filter((p): p is string => !!p)
  const first = tabs[0].id, own = groupOfTab(first)
  // Into a new split: only if that changes something (other tabs stay behind in their pane).
  const splits = !phone && !!own && own.tabs.some((t) => !ids.includes(t.id))
  return [
    { label: n === 1 ? "Close tab" : `Close ${n} tabs`, icon: X, run: () => closeTabIds(ids) },
    { label: "Close other tabs", run: () => closeTabIds(ids, { keep: true }), disabled: tabs.length === all.length },
    ...(phone ? [] : [
      { label: pinned ? "Unpin" : "Pin", icon: pinned ? PinOff : Pin, sep: true, run: () => tabs.forEach((t) => { if (!!t.pinned === pinned) togglePinTab(t.id) }) },
      { label: "Move to new split right", icon: Columns2, run: () => moveTabsTo(ids, first, own!.id, "right"), disabled: !splits },
      { label: "Move to new split down", icon: Rows2, run: () => moveTabsTo(ids, first, own!.id, "bottom"), disabled: !splits },
      ...(isPopout() && hasMainWindow() ? [{ label: "Move to main window", icon: AppWindow, run: () => moveToMain(ids) }] : []),
    ]),
    ...(files.length ? [{ label: files.length === 1 ? "Copy path" : "Copy paths", icon: FileText, sep: true, run: () => void copyText(files.join("\n")) }] : []),
  ]
}

/** How a pane shows its tabs: stacked or in a row, and the tab bar on or off (appearance `tabBar`). Also the menu of
 *  the bar's empty space. */
function barItems(group: Group): MenuItem[] {
  const { tabBar } = getPrefs()
  return [
    { label: group.stacked ? "Unstack tabs" : "Stack tabs", icon: Layers, sep: true, run: () => toggleStacked(group.id) },
    { label: tabBar ? "Hide tab bar" : "Show tab bar", icon: PanelTop, run: () => setPrefs({ tabBar: !tabBar }) },
  ]
}

/** Right-click on a tab bar's empty space. */
function barMenu(group: Group): MenuItem[] {
  return [
    { label: "New tab", icon: Plus, run: () => newTab(group.id) },
    ...commandItems("tab:reopen"),
    ...(hasMainWindow() ? [{ label: "Move all to main window", icon: AppWindow, run: () => moveToMain(group.tabs.map((t) => t.id)) }] : []),
    ...barItems(group),
  ]
}

/** A tab's menu: a view's own items, or a file's as in the tree. `phone` leaves out what a phone hasn't got (reveal in
 *  tree; renaming is the title). */
function tabItems(tab: Tab, phone = false): MenuItem[] {
  const out: MenuItem[] = []
  const file = vaultPath(tab.to)
  const v = tab.to.startsWith("view:") ? viewFor(tab.to, getPrefs().disabled) : null
  if (v?.on && v.def.tabMenu) out.push(...v.def.tabMenu(v.arg).map((it, i) => ({ ...it, sep: i === 0 })))
  if (tab.to.startsWith("file:/")) out.push({ ...copyToVaultItem(tab.to.slice(5), () => selectTab(tab.id)), sep: true }, ...revealItem(tab.to.slice(5)))
  if (file) {
    const items = fileMenu(file, { phone, rename: () => { selectTab(tab.id); askRename(file) } })
    if (items.length) items[0] = { ...items[0], sep: true }
    out.push(...items)
  }
  return out
}

/** The phone's … menu (its header, components/PhoneHeader.tsx) for the tab on screen: what it shows, then Close. */
export function phoneTabMenu(tab: Tab): MenuItem[] {
  const items = tabItems(tab, true).map((it, i) => (i === 0 ? { ...it, sep: false } : it))
  return [...items, { label: "Close tab", icon: X, sep: items.length > 0, run: () => closeTab(tab.id) }]
}

/** A tab card's menu in the phone's tab list (held, or right-clicked): closing, then what it shows. */
export function tabCardMenu(tab: Tab, count: number, groups: MenuItem[] = []): MenuItem[] {
  return [
    { label: "Close tab", icon: X, run: () => closeTab(tab.id) },
    { label: "Close other tabs", run: () => closeTabs("others", tab.id), disabled: count < 2 },
    { label: "Close all tabs", danger: true, run: () => closeTabs("all", tab.id) },
    ...groups,
    ...tabItems(tab, true),
  ]
}

// ---------- dragging tabs (and files from the sidebar: the same drops) ----------

/** The dragged tab or file, following the pointer (drawn above the sidebar). */
export function DragGhost({ info }: { info: (t: Tab) => TabInfo }) {
  const d = useDrag()
  const { fileIcons } = usePrefs()
  if (!d || d.item.drawn) return null
  const i: TabInfo = d.item.paths || d.item.tabs ? { label: d.item.label ?? "", icon: d.item.tabs ? Layers : Files }
    : d.item.folder ? { label: d.item.path!.split("/").pop()!, icon: Folder }
    : d.item.newtab ? { label: d.item.label ?? d.item.newtab.key, icon: d.item.newtab.list === "actions" ? MousePointerClick : LayoutList }
    : d.item.panel && !(d.item.to && d.hit?.target === PANES) ? { label: d.item.label ?? d.item.panel, icon: PanelTop }
    : d.item.group ? { label: d.item.label ?? "Pane", icon: AppWindow }
    : d.item.from === "row" && !d.item.to ? { label: d.item.label ?? d.item.path?.split("/").pop()?.replace(/\.md$/i, "") ?? "", icon: FileText }
    : info({ id: "", to: d.item.to ?? "new" })
  // Near the window's right edge it goes left of the pointer; a finger's goes above it (a finger covers what's under).
  // Over an open sheet (a modal <dialog>) it's placed inside it.
  const sheet = [...document.querySelectorAll<HTMLElement>("dialog[open]")].pop()
  const o = sheet?.getBoundingClientRect() ?? { left: 0, top: 0, right: innerWidth }
  const at = d.finger ? { left: Math.max(8, Math.min(d.x - 32, innerWidth - 268)) - o.left, top: d.y - 64 - o.top }
    : { ...(d.x > innerWidth - 280 ? { right: o.right - d.x + 10 } : { left: d.x + 10 - o.left }), top: d.y + 10 - o.top }
  return createPortal(
    <div aria-hidden data-drag-ghost style={at}
      className={cn("pointer-events-none fixed flex max-w-[260px] items-center gap-1.5 bg-card shadow-lg ring-[0.5px] ring-border",
        d.finger ? "z-[70] h-10 rounded-[10px] px-3 text-[15px]" : "z-50 h-7 rounded-[6px] px-2 text-[13px]", !d.hit && "opacity-60")}>
      {fileIcons && <i.icon className={cn(d.finger ? "size-[18px] shrink-0" : "size-3.5 shrink-0", !i.tint && "text-muted-foreground", i.iconClassName)} strokeWidth={2.25} style={i.tint ? { color: i.tint } : undefined} />}
      <span className="min-w-0 truncate font-medium">{i.label}</span>
      {d.hit?.hint && <span className="shrink-0 text-muted-foreground">{d.hit.hint}</span>}
    </div>,
    sheet ?? document.body,
  )
}

/** Press on a tab: it drags, or (one of several selected) they all do. */
export function dragTab(e: React.PointerEvent<HTMLElement>, tab: Tab, opts?: { touch?: boolean; drawn?: boolean }) {
  const ids = selectionFor(TABS, tab.id, false)
  const item: DragItem = { from: "tab", tab: tab.id, to: tab.to, path: vaultPath(tab.to) ?? undefined, drawn: opts?.drawn }
  startDrag(e, ids && ids.length > 1 ? { ...item, tabs: ids, label: `${ids.length} tabs` } : item, { touch: opts?.touch })
}

function TabItem({ tab, info, active, focused, only, icons, menu }: { tab: Tab; info: TabInfo; active: boolean; focused: boolean; only: boolean; icons: boolean; menu: () => MenuItem[] }) {
  const d = useDrag()
  const picked = useSelected(TABS, tab.id)
  const dragging = d?.item.tab === tab.id || (picked && !!d?.item.tabs)
  return (
    <div data-tab-id={tab.id} data-select-key={tab.id} {...selectedAttr(picked)} role="presentation" onContextMenu={menuFor(rowMenu(TABS, tab.id, menu))}
      onPointerDown={(e) => dragTab(e, tab)}
      onClick={(e) => { if (!selectClick(e, TABS, tab.id, active ? null : groupOfTab(tab.id)?.active)) selectTab(tab.id) }}
      className={cn("group/tab @container/tab relative flex h-7 min-w-12 flex-1 basis-0 items-center rounded-[6px] transition-colors",
        "max-w-[220px]", active ? "bg-card shadow-sm ring-[0.5px] ring-border" : "hover:bg-foreground/[0.05]", dragging && "opacity-50")}>
      <button type="button" role="tab" aria-selected={active}
        onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); if (!tab.pinned) closeTab(tab.id) } }}
        data-tip={d ? undefined : info.label} data-tip-trunc className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 pr-6 pl-2 text-left text-[13px]">
        {icons && <Badged on={info.badge}><info.icon className={cn("size-3.5 shrink-0", !info.tint && "text-muted-foreground", info.iconClassName)} strokeWidth={2.25} style={info.tint ? { color: info.tint } : undefined} /></Badged>}
        {/* Too narrow for more than a letter or two: only the icon (the tooltip has the name). */}
        <span className={cn("min-w-0 truncate", icons && "@max-[80px]/tab:hidden", active && focused ? "font-medium text-foreground" : active ? "font-medium text-muted-foreground" : "text-muted-foreground")}>{info.label}</span>
      </button>
      {/* A pinned tab's pin, where the X goes: a click unpins it. */}
      {tab.pinned ? (
        <button type="button" data-tab-pin data-no-drag aria-label={`Unpin ${info.label}`} data-tip="Unpin" onClick={(e) => { e.stopPropagation(); togglePinTab(tab.id) }}
          className="absolute right-1 grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground">
          <Pin className="size-3.5" strokeWidth={2} />
        </button>
      ) : !only && (
        <button type="button" data-tab-close data-no-drag aria-label={`Close ${info.label}`} onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
          className={cn("absolute right-1 grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground",
            active ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100")}>
          <X className="size-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

/** What a tab shows: its label and icon. A view's can follow live data (a terminal's session name): drawn again when
 *  its plugin says so (viewsChanged). */
export function useTabInfo(store: Store | null, pageInfo: (id: string) => TabInfo | null) {
  const { disabled } = usePrefs()
  useViewsVersion()
  return (t: Tab): TabInfo => {
    if (t.to === "new") return { label: "New tab", icon: SquareDashed }
    if (t.to.startsWith("file:")) {
      const path = t.to.slice(5)
      const f = store?.files.files.find((x) => x.path === path)
      return { label: stem(path), ...fileIcon(path, f?.type ?? null, disabled, f) }
    }
    if (t.to.startsWith("view:")) {
      const v = viewFor(t.to, disabled)
      return v ? { label: v.def.title(v.arg), icon: v.def.iconFor?.(v.arg) ?? v.def.icon,
        iconClassName: v.on ? v.def.iconClass?.(v.arg) : undefined, tint: v.on ? v.def.iconTint?.(v.arg) : undefined, badge: v.on && !!v.def.iconBadge?.(v.arg) }
        : { label: t.to.slice(5), icon: SquareDashed }
    }
    return pageInfo(t.to) ?? { label: t.to, icon: FileText }
  }
}

/** The app's own pages' names and icons (App's `pageInfo`), for what draws tabs outside the workspace (the Tabs panel). */
let pageInfoOf: (id: string) => TabInfo | null = () => null
export const setPageInfo = (fn: (id: string) => TabInfo | null) => { pageInfoOf = fn }
/** What each tab shows (its label and icon), as its bar does: for plugins (the Tabs panel). */
export const useTabLabels = (store: Store | null) => useTabInfo(store, (id) => pageInfoOf(id))
/** A tab's right-click menu, the one its bar has. */
export function tabMenuOf(id: string): MenuItem[] {
  const g = leaves(getWorkspace().root).find((x) => x.tabs.some((t) => t.id === id))
  if (!g) return []
  const i = g.tabs.findIndex((t) => t.id === id)
  return tabMenu(g.tabs[i], i === g.tabs.length - 1, g.tabs.length, g)
}

/** On top of its group's pane, so it never moves when a tab's page is narrower or wider than another's. */
export function TabBar({ group, focused, info, alone }: { group: Group; focused: boolean; info: (t: Tab) => TabInfo
  /** The only group (its single blank tab can't be closed). */
  alone: boolean }) {
  const { tabs, active } = group
  const { fileIcons, tabBar } = usePrefs()
  useSelectable(TABS, { menu: (ids) => tabsMenu(ids), noun: ["tab", "tabs"] })
  const hit = useDropHit<Drop>(PANES)
  const d = useDrag()
  const line = hit?.kind === "bar" && hit.group === group.id ? hit.x : null
  const shown = tabs.find((t) => t.id === active) ?? tabs[0]
  // What the pane is called while it's dragged: its tab, and how many more go with it.
  const label = tabs.length > 1 ? `${info(shown).label} and ${tabs.length - 1} more` : info(shown).label
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const r = row.current
    if (!r) return
    const reveal = () => {
      const t = r.querySelector<HTMLElement>(`[data-tab-id="${active}"]`)
      if (!t) return
      if (t.offsetLeft < r.scrollLeft) r.scrollLeft = t.offsetLeft - 8
      else if (t.offsetLeft + t.offsetWidth > r.scrollLeft + r.clientWidth) r.scrollLeft = t.offsetLeft + t.offsetWidth - r.clientWidth + 36
    }
    reveal()
    // A pane made narrower (a split, a divider dragged) keeps it in view too.
    const ro = new ResizeObserver(reveal)
    ro.observe(r)
    return () => ro.disconnect()
  }, [active, tabs.length])
  // Something dragged near either end of a row of tabs that scrolls: it scrolls that way (faster the closer), like
  // the file tree near its edges, so every place in it can take the drop.
  const [dx, dy] = d ? [d.x, d.y] : [null, null]
  useEffect(() => {
    const r = row.current
    if (dx === null || dy === null || !r || r.scrollWidth <= r.clientWidth) return
    const b = r.getBoundingClientRect(), zone = 32
    if (dy < b.top - 4 || dy > b.bottom + 4 || dx < b.left - 8 || dx > b.right + 8) return
    const speed = dx < b.left + zone ? -Math.ceil((b.left + zone - dx) / 4) : dx > b.right - zone ? Math.ceil((dx - b.right + zone) / 4) : 0
    if (!speed) return
    let frame = requestAnimationFrame(function step() { r.scrollLeft += speed; frame = requestAnimationFrame(step) })
    return () => cancelAnimationFrame(frame)
  }, [dx, dy])
  const handle = (
    <button type="button" data-pane-handle={group.id} aria-label="Move this pane" data-tip={d ? undefined : "Drag to move this pane"}
      onPointerDown={(e) => startDrag(e, { from: "group", group: group.id, label })}
      className={cn("grid h-7 w-5 shrink-0 cursor-grab place-items-center rounded-[5px] text-muted-foreground transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100",
        d?.item.group === group.id ? "opacity-100" : "opacity-0 group-hover/bar:opacity-100")}>
      <GripVertical className="size-4" strokeWidth={2} />
    </button>
  )
  // The tab bar turned off (appearance `tabBar`): the same bar (the window's drag strip, the pane's handle, a drop
  // opens in the pane), showing only the tab on screen.
  if (!tabBar) {
    const i = info(shown)
    return (
      <div role="tablist" aria-label="Open tabs" data-tab-bar={group.id} data-tabs-hidden onContextMenu={menuFor(() => barMenu(group))}
        className="group/bar relative flex h-10 shrink-0 items-center gap-1 border-b-[0.5px] border-border bg-background pr-1.5 pl-2">
        <div data-pane-title onContextMenu={menuFor(() => tabMenu(shown, shown === tabs.at(-1), tabs.length, group))}
          className={cn("flex min-w-0 flex-1 items-center gap-1.5 pl-2 text-[13px]", d?.item.group === group.id && "opacity-50")}>
          {fileIcons && <Badged on={i.badge}><i.icon className={cn("size-3.5 shrink-0", !i.tint && "text-muted-foreground", i.iconClassName)} strokeWidth={2.25} style={i.tint ? { color: i.tint } : undefined} /></Badged>}
          <span className={cn("min-w-0 truncate font-medium", focused ? "text-foreground" : "text-muted-foreground")}>{i.label}</span>
          {tabs.length > 1 && <span className="shrink-0 text-tertiary">{tabs.length} tabs</span>}
        </div>
        {handle}
      </div>
    )
  }
  return (
    <div role="tablist" aria-label="Open tabs" data-tab-bar={group.id} onContextMenu={menuFor(() => barMenu(group))}
      className="group/bar relative flex h-10 shrink-0 items-center gap-1 border-b-[0.5px] border-border bg-background pr-1.5 pl-2">
      {/* Tabs shrink down to their icon and close button, then the row scrolls (a mouse wheel scrolls it sideways),
          keeping the active tab in view. */}
      <div ref={row} data-select-list={TABS} onWheel={(e) => { if (!e.deltaX && e.currentTarget.scrollWidth > e.currentTarget.clientWidth) e.currentTarget.scrollLeft += e.deltaY }}
        className={cn("relative -my-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", d?.item.group === group.id && "opacity-50")}>
        {tabs.map((t, i) => <TabItem key={t.id} tab={t} info={info(t)} active={t.id === active} focused={focused} only={tabs.length === 1 && t.to === "new" && alone} icons={fileIcons}
          menu={() => tabMenu(t, i === tabs.length - 1, tabs.length, group)} />)}
        {/* Right after the last tab (not pinned to the bar's end). */}
        <button type="button" onClick={() => newTab(group.id)} aria-label="New tab" data-tip="New tab"
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
          <Plus className="size-4" strokeWidth={2} />
        </button>
      </div>
      {/* The pane's handle: drag it to move the whole pane (all its tabs). Shown while the pointer is over the bar. */}
      {handle}
      {line !== null && <div aria-hidden data-drop-line className="pointer-events-none absolute top-1.5 bottom-1.5 w-[2px] -translate-x-1/2 rounded-full bg-primary" style={{ left: line }} />}
    </div>
  )
}
