// Tabs (desktop): a bar per group; drag a tab to reorder, onto another bar, or onto a pane (an edge
// splits). Drops that would change nothing aren't offered; a whole pane drags by the handle at its bar's end.
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AppWindow, Blocks, Columns2, Columns3, Files, Group as GroupIcon, Heading1, LayoutList, MousePointerClick, GripVertical, Folder, PanelTop, PanelBottom, FileText, Layers, Pencil, Pin, PinOff, Plus, Rows2, SquareDashed, Ungroup, X, type LucideIcon } from "lucide-react"
import type { Store } from "@/core/data"
import { startDrag, useDrag, useDropHit, type DragItem } from "@/core/drag"
import { stem } from "@/core/files"
import { askRename, closeTab, closeTabIds, closeTabs, getWorkspace, groupOfTab, isPopout, newTab, selectTab, togglePinTab, toggleStacked, popOut } from "@/core/workspace"
import { moveTabsTo, hasSiblings, moveToSplit, splitTab } from "@/core/splits"
import { hasMainWindow, moveToMain } from "@/core/windows"
import { leaves, vaultPath, type Group, type Tab, type TabSet } from "@/core/layout"
import { COLOR_NAMES, colorVar } from "../../../core/colors.ts"
import { addToSet, allSets, askRenameSet, closeSet, colorSet, doneRenaming, foldSet, leaveSet, makeSet, newTabInSet, renameSet, setById, ungroupSet, useRenaming } from "@/core/tabsets"
import { colorItems, dotIcon } from "@/components/ColorDot"
import { PANES, previewIn, previewOrder, setsAsDrawn, type Drop } from "@/core/drop"
import { INCOMING, useSlide } from "@/core/slide"
import { usePaneHasTopBar } from "@/core/pane"
import { tabsInSidebar, useViewsVersion, viewFor, viewMenuItems } from "@/core/plugins"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { commandItems, menuFor, type MenuItem } from "@/components/ContextMenu"
import { fileIcon } from "@/components/FileTree"
import { copyText, copyToVaultItem, fileMenu, revealItem } from "@/components/FileActions"
import { Badged, IconAction, type Dot } from "@/components/kit"
import type { TabMark } from "@/core/define"
import { cn } from "@/lib/utils"
import { rowMenu, selectClick, selectedAttr, selectionFor, useSelectable, useSelected } from "@/core/select"

/** `iconClassName`: a status on the icon (a view's `iconClass`: a Claude Code session working or waiting). */
export type TabInfo = { label: string; icon: LucideIcon; tint?: string; iconClassName?: string
  /** A dot on the icon (a view's `iconBadge`: a coding agent at work, waiting for you). */
  badge?: Dot
  /** The colour the tab takes lightly while it's the active one, with appearance `tabTint` (a view's `tabTint`). */
  wash?: string
  /** A small button at its end (a view's `tabMark`: a page playing sound, its speaker). */
  mark?: TabMark }


/** `it`, with `other` (its variant: moving instead of copying) in its submenu, or alone when that can't be done now. */
const withVariant = (it: MenuItem, other: MenuItem): MenuItem => (other.disabled ? it : { ...it, split: true, items: [it, other] })

/** Right-click on a tab: the tab's own (closing, where it shows), then what it shows. What a bar does (stack, hide)
 *  is its empty space's, but stacked (to undo it where it shows) and where there's none to click (the bar hidden): `bar`. */
function tabMenu(tab: Tab, last: boolean, count: number, group: Group, bar = false): MenuItem[] {
  const siblings = hasSiblings(tab.id), blank = tab.to === "new"
  return [
    { label: "Close", icon: X, run: () => closeTab(tab.id) },
    { label: "Close others", run: () => closeTabs("others", tab.id), disabled: count < 2 },
    { label: "Close tabs to the right", run: () => closeTabs("right", tab.id), disabled: last },
    { label: "Close all", run: () => closeTabs("all", tab.id) },
    // ("Pin tab", as its command: the file's own Pin, under More file actions, pins it to the sidebar)
    tab.pinned ? { label: "Unpin tab", icon: PinOff, sep: true, run: () => togglePinTab(tab.id) } : { label: "Pin tab", icon: Pin, sep: true, run: () => togglePinTab(tab.id) },
    ...setItems([tab.id]),
    withVariant({ label: "Split right", icon: Columns2, run: () => splitTab("right", tab.id) },
      { label: "Move to new split right", icon: Columns2, run: () => moveToSplit("right", tab.id), disabled: !siblings }),
    withVariant({ label: "Split down", icon: Rows2, run: () => splitTab("bottom", tab.id) },
      { label: "Move to new split down", icon: Rows2, run: () => moveToSplit("bottom", tab.id), disabled: !siblings }),
    ...(isPopout() ? [{ label: "Move to main window", icon: AppWindow, run: () => moveToMain([tab.id]), disabled: !hasMainWindow() }] : []),
    withVariant({ label: "Move to new window", icon: AppWindow, run: () => popOut(tab.id, true), disabled: blank },
      { label: "Open in new window", icon: AppWindow, run: () => popOut(tab.id), disabled: blank }),
    ...tabItems(tab),
    ...(bar || group.stacked ? barItems(group) : []),
  ]
}

/** The tabs' selection (core/select.ts): by tab id, the bars', the Tabs panel's and the phone's cards alike. */
export const TABS = "tabs"

// ---------- tab groups (core/tabsets.ts) ----------

/** What a tab group is called: its name, or its colour's ("Blue group"). */
export const setName = (s: TabSet) => s.name || `${COLOR_NAMES[s.color]} group`
/** Where a new group's name is typed: its chip in the tab bar, else its row in the Tabs panel. */
const nameHere = () => (getPrefs().tabBar ? "bar" : "panel")

/** A tab menu's tab group rows, for one tab or several selected: into a new group (named in place), into another
 *  group, out of theirs. */
export function setItems(ids: string[]): MenuItem[] {
  const tabs = leaves(getWorkspace().root).flatMap((g) => g.tabs).filter((t) => ids.includes(t.id))
  if (!tabs.length) return []
  const n = tabs.length, own = new Set(tabs.map((t) => t.set))
  const others = allSets().filter((s) => !(own.size === 1 && own.has(s.id)))
  return [
    { label: n === 1 ? "Add tab to new group" : `Add ${n} tabs to new group`, icon: GroupIcon, sep: true, run: () => {
      const id = makeSet(ids)
      if (id) askRenameSet(id, nameHere())
    } },
    ...(others.length ? [{ label: "Add to group", icon: Layers, run: () => {}, items: others.map((s) => ({ label: setName(s), icon: dotIcon(colorVar(s.color)), run: () => addToSet(ids, s.id) })) }] : []),
    ...(tabs.some((t) => t.set) ? [{ label: "Remove from group", icon: Ungroup, run: () => leaveSet(ids) }] : []),
  ]
}

/** A tab group's menu (right-click its name: in the bar, the Tabs panel or the phone's tab list). */
export function setMenu(id: string, at: "bar" | "panel" | "phone"): MenuItem[] {
  const s = setById(id)?.s
  if (!s) return []
  return [
    ...(at === "phone" ? [] : [{ label: "Rename group", icon: Pencil, run: () => askRenameSet(id, at) }]),
    { label: "Colour", icon: dotIcon(colorVar(s.color)), run: () => {}, items: colorItems(s.color, (c) => colorSet(id, c)) },
    ...(at === "phone" ? [] : [{ label: "New tab in group", icon: Plus, run: () => newTabInSet(id) }]),
    { label: "Ungroup", icon: Ungroup, sep: true, run: () => ungroupSet(id) },
    { label: "Close group", icon: X, run: () => closeSet(id) },
  ]
}

/** A tab group's name being typed in place (Enter or leaving it keeps it, Escape doesn't). */
export function SetNameField({ s, className }: { s: TabSet; className?: string }) {
  const [v, setV] = useState(s.name)
  const done = useRef(false)
  const commit = (keep: boolean) => { if (done.current) return; done.current = true; if (keep && v.trim() !== s.name) renameSet(s.id, v); doneRenaming() }
  return (
    <input autoFocus value={v} placeholder="Name" spellCheck={false} aria-label="Group name" data-no-drag
      onFocus={(e) => e.currentTarget.select()} onChange={(e) => setV(e.target.value)} onBlur={() => commit(true)}
      // (inside a row that's a link in the Tabs panel: a click here mustn't follow it)
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); e.preventDefault() }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter") { e.preventDefault(); commit(true) }
        if (e.key === "Escape") { e.preventDefault(); commit(false) }
      }}
      style={{ width: `${Math.max(5, v.length + 1)}ch` }}
      className={cn("min-w-0 max-w-[160px] rounded-[4px] bg-card px-1 text-foreground outline-none placeholder:text-tertiary", className)} />
  )
}

/** A tab group's chip in the tab bar, before its tabs: a click folds it (folded, its count shows), right-click has its
 *  menu, dragging it moves the whole group. */
function SetChip({ s, n, target }: { s: TabSet; n: number
  /** A tab dragged onto it (folded) would join it. */
  target: boolean }) {
  const renaming = useRenaming()
  const editing = renaming?.id === s.id && renaming.at === "bar"
  const d = useDrag()
  const c = colorVar(s.color)
  return (
    <div data-set-chip={s.id} data-slide={`set:${s.id}`} role="presentation" aria-expanded={!s.collapsed} onContextMenu={menuFor(() => setMenu(s.id, "bar"))}
      onPointerDown={(e) => { if (!editing) startDrag(e, { from: "tabset", tabset: s.id, label: setName(s) }) }}
      onClick={() => { if (!editing) foldSet(s.id) }}
      data-tip={d || editing ? undefined : s.collapsed ? `Expand ${setName(s)}` : `Collapse ${setName(s)}`}
      className={cn("relative flex h-7 shrink-0 cursor-pointer items-center", d?.item.tabset === s.id && "opacity-50")}>
      {/* (as tall as a tab, the pill inside: the line under it then lines up with the tabs') */}
      <span className={cn("flex h-6 items-center gap-1 rounded-[6px] text-[12px] font-semibold transition-colors", s.name || editing ? "px-1.5" : "w-6 justify-center")}
        style={{ color: `color-mix(in srgb, ${c} 72%, var(--foreground))`, background: `color-mix(in srgb, ${c} 16%, transparent)`, ...(target ? { boxShadow: `0 0 0 2px ${c}` } : {}) }}>
        {editing ? <SetNameField s={s} className="h-5 text-[12px] font-medium" />
          : s.name ? <span className="max-w-[140px] truncate">{s.name}</span>
          : <span aria-label={setName(s)} className="size-2 rounded-full" style={{ background: c }} />}
        {s.collapsed && !editing && <span className="font-medium tabular-nums opacity-75">{n}</span>}
      </span>
      {/* The line under the group's tabs starts here (each tab carries it on). */}
      {!s.collapsed && <span aria-hidden className="pointer-events-none absolute -right-1 -bottom-[3px] left-1 h-[2px] rounded-l-full" style={{ background: c }} />}
    </div>
  )
}

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
      { label: `${pinned ? "Unpin" : "Pin"} ${n === 1 ? "tab" : `${n} tabs`}`, icon: pinned ? PinOff : Pin, sep: true, run: () => tabs.forEach((t) => { if (!!t.pinned === pinned) togglePinTab(t.id) }) },
      ...setItems(ids),
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
  const { tabBar, paneTitles } = getPrefs()
  // With the tabs in the sidebar, the way back is to put them on top (the tab bar on, the list gone).
  const vertical = tabsInSidebar()
  return [
    { label: group.stacked ? "Unstack tabs" : "Stack tabs", icon: Layers, sep: true, run: () => toggleStacked(group.id) },
    ...commandItems("tab:sidebar"),
    ...(vertical ? [] : [{ label: tabBar ? "Hide tab bar" : "Show tab bar", icon: PanelTop, run: () => setPrefs({ tabBar: !tabBar }) }]),
    ...(tabBar ? [] : [{ label: paneTitles ? "Hide pane titles" : "Show pane titles", icon: Heading1, run: () => setPrefs({ paneTitles: !paneTitles }) }]),
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
  if (v?.on) out.push(...viewMenuItems(tab.to).map((it, i) => ({ ...it, sep: i === 0 })))
  if (tab.to.startsWith("file:/")) out.push({ ...copyToVaultItem(tab.to.slice(5), () => selectTab(tab.id)), sep: true }, ...revealItem(tab.to.slice(5)))
  if (file) {
    const items = fileMenu(file, { phone, short: !phone, rename: () => { selectTab(tab.id); askRename(file) } })
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
    : d.item.status ? { label: d.item.label ?? d.item.status, icon: PanelBottom }
    : d.item.block ? { label: d.item.label ?? d.item.block, icon: Blocks }
    : d.item.column ? { label: d.item.label ?? d.item.column.key, icon: Columns3 }
    : d.item.panel && !(d.item.to && d.hit?.target === PANES) ? { label: d.item.label ?? d.item.panel, icon: PanelTop }
    : d.item.group ? { label: d.item.label ?? "Pane", icon: AppWindow }
    : d.item.tabset ? { label: d.item.label ?? "", icon: dotIcon(colorVar(setById(d.item.tabset)?.s.color ?? "gray")) }
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

function TabItem({ tab, info, active, focused, only, icons, tint, menu, width, settling, close, line }: { tab: Tab; info: TabInfo; active: boolean; focused: boolean; only: boolean; icons: boolean
  /** Whether the active tab takes its colour (appearance `tabTint`). */
  tint: boolean; menu: () => MenuItem[]
  /** In a tab group: the line under its tabs, in its colour, on to the next one unless it's the `last`. */
  line?: { color: string; last: boolean }
  /** Held at this width after a close (TabBar). */
  width?: number; settling: boolean; close: (e: React.MouseEvent<HTMLElement>) => void }) {
  const d = useDrag()
  const picked = useSelected(TABS, tab.id)
  const dragging = d?.item.tab === tab.id || (picked && !!d?.item.tabs) || (!!tab.set && d?.item.tabset === tab.set)
  // (a light wash of its colour, lighter while its pane isn't the focused one: calm in either theme)
  const wash = active && tint && info.wash
    ? { background: `color-mix(in srgb, ${info.wash} ${focused ? 14 : 8}%, var(--card))`, boxShadow: `0 0 0 0.5px color-mix(in srgb, ${info.wash} 40%, var(--border)), 0 1px 2px rgb(0 0 0 / 0.05)` }
    : undefined
  return (
    <div data-tab-id={tab.id} data-slide={tab.id} data-select-key={tab.id} {...selectedAttr(picked)} role="presentation" onContextMenu={menuFor(rowMenu(TABS, tab.id, menu))}
      onPointerDown={(e) => dragTab(e, tab)}
      onClick={(e) => { if (!selectClick(e, TABS, tab.id, active ? null : groupOfTab(tab.id)?.active)) selectTab(tab.id) }}
      className={cn("group/tab @container/tab relative flex h-7 min-w-12 flex-1 basis-0 items-center rounded-[6px] transition-colors",
        "max-w-[220px]", active ? "bg-card shadow-sm ring-[0.5px] ring-border" : "hover:bg-foreground/[0.05]", dragging && "opacity-50")}
      style={{ ...wash, ...(width ? { flex: `0 0 ${width}px` } : settling ? { transition: "flex 160ms ease-out" } : undefined) }} data-tab-wash={wash ? "" : undefined}>
      <button type="button" role="tab" aria-selected={active}
        onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); if (!tab.pinned) close(e) } }}
        data-tip={d ? undefined : info.label} data-tip-trunc className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 pr-6 pl-2 text-left text-[13px]">
        {/* (too narrow for both, the mark stands in for the icon: a browser's speaker does) */}
        {icons && <Badged on={info.badge}><info.icon className={cn("size-3.5 shrink-0", !info.tint && "text-muted-foreground", info.mark && "@max-[80px]/tab:hidden", info.iconClassName)} strokeWidth={2.25} style={info.tint ? { color: info.tint } : undefined} /></Badged>}
        {/* Too narrow for more than a letter or two: only the icon (the tooltip has the name). */}
        <span className={cn("min-w-0 truncate", icons && "@max-[80px]/tab:hidden", active && focused ? "font-medium text-foreground" : active ? "font-medium text-muted-foreground" : "text-muted-foreground")}>{info.label}</span>
        {info.mark && <IconAction action={info.mark} className="ml-auto @max-[80px]/tab:ml-0"><info.mark.icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.25} /></IconAction>}
      </button>
      {/* A pinned tab's pin, where the X goes: a click unpins it. */}
      {tab.pinned ? (
        <button type="button" data-tab-pin data-no-drag aria-label={`Unpin ${info.label}`} data-tip="Unpin tab" onClick={(e) => { e.stopPropagation(); togglePinTab(tab.id) }}
          className="absolute right-1 grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground">
          <Pin className="size-3.5" strokeWidth={2} />
        </button>
      ) : !only && (
        <button type="button" data-tab-close data-no-drag aria-label={`Close ${info.label}`} onClick={(e) => { e.stopPropagation(); close(e) }}
          className={cn("absolute right-1 grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground",
            active ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100")}>
          <X className="size-3.5" strokeWidth={2} />
        </button>
      )}
      {line && <span aria-hidden className={cn("pointer-events-none absolute -bottom-[3px] left-0 h-[2px]", line.last ? "right-1 rounded-r-full" : "-right-1")} style={{ background: line.color }} />}
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
    if (t.to.startsWith("view:")) return viewInfo(t.to, disabled, t.id)
    return pageInfo(t.to) ?? { label: t.to, icon: FileText }
  }
}

/** A view's tab as it shows (`view:terminal/abc`): its label, icon and state, as its tab draws them (a pinned one too);
 *  `tab`: the tab's id, for what's that tab's (its icon's action). */
export function viewInfo(to: string, disabled = getPrefs().disabled, tab?: string): TabInfo {
  const v = viewFor(to, disabled)
  return v ? { label: v.def.title(v.arg), icon: v.def.iconFor?.(v.arg, tab) ?? v.def.icon,
    iconClassName: v.on ? v.def.iconClass?.(v.arg) : undefined, tint: v.on ? v.def.iconTint?.(v.arg) : undefined, badge: v.on ? v.def.iconBadge?.(v.arg) : undefined,
    wash: v.on ? v.def.tabTint?.(v.arg) : undefined, mark: v.on && tab ? v.def.tabMark?.(v.arg, tab) ?? undefined : undefined }
    : { label: to.slice(5), icon: SquareDashed }
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
  return tabMenu(g.tabs[i], i === g.tabs.length - 1, g.tabs.length, g, !getPrefs().tabBar)
}

/** On top of its group's pane, so it never moves when a tab's page is narrower or wider than another's. */
export function TabBar({ group, focused, info, alone }: { group: Group; focused: boolean; info: (t: Tab) => TabInfo
  /** The only group (its single blank tab can't be closed). */
  alone: boolean }) {
  const { tabs, active } = group
  const { fileIcons, tabBar, paneTitles, tabTint } = usePrefs()
  // Without tab bar or titles, a pane's top bar (a file's, the Browser's) is its title row (index.css): a right-click on
  // its empty part is the strip's menu.
  const hasTopBar = usePaneHasTopBar(group.id), merged = !tabBar && !paneTitles && hasTopBar
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const section = strip.current?.parentElement
    if (!merged || !section) return
    const menu = (e: globalThis.MouseEvent) => {
      if (!e.defaultPrevented && (e.target as Element).matches?.("[data-view-bar], [data-view-bar-fill], [data-web-bar]")) menuFor(() => barMenu(group))(e as never)
    }
    section.addEventListener("contextmenu", menu)
    return () => section.removeEventListener("contextmenu", menu)
  }, [merged, group])
  useSelectable(TABS, { menu: (ids) => tabsMenu(ids), noun: ["tab", "tabs"] })
  const hit = useDropHit<Drop>(PANES)
  const d = useDrag()
  // Dragged over it, the tabs make way for what's dragged, in the tab group it would join (its line under it).
  const preview = d ? previewIn(group, d.item, hit) : null
  const drawn = setsAsDrawn(preview?.tabs ?? tabs)
  const lineOf = (id: string) => {
    const at = drawn.get(id), s = at?.set ? group.sets?.find((x) => x.id === at.set) : undefined
    return s ? { color: colorVar(s.color), last: at!.last } : undefined
  }
  const shown = tabs.find((t) => t.id === active) ?? tabs[0]
  // What the pane is called while it's dragged: its tab, and how many more go with it.
  const label = tabs.length > 1 ? `${info(shown).label} and ${tabs.length - 1} more` : info(shown).label
  const row = useRef<HTMLDivElement>(null)
  useSlide(row, preview && [...previewOrder(group, preview), "new"], "x")
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
  // Closed with the mouse, the tabs keep their width so the next one's X comes under the pointer, as browsers do; they
  // fill the bar again once it leaves (or a tab opens, or one closes another way).
  const [held, setHeld] = useState<{ width: number; count: number } | null>(null)
  const [settling, setSettling] = useState(false)
  const pointer = useRef("")
  const settle = useRef(0)
  const release = () => {
    setHeld(null)
    setSettling(true)
    clearTimeout(settle.current)
    settle.current = window.setTimeout(() => setSettling(false), 200)
  }
  useEffect(() => { if (held && held.count !== tabs.length) release() }, [held, tabs.length])
  useEffect(() => () => clearTimeout(settle.current), [])
  const closeHeld = (tab: Tab, e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget.closest<HTMLElement>("[data-tab-id]"), r = row.current
    const mouse = e.detail > 0 && pointer.current === "mouse" && !!el && !!r
    let width = 0
    if (mouse) {
      width = el.getBoundingClientRect().width
      // The last one closed: the rest widen to end where it did, so the new last one's X comes under the pointer.
      const n = tabs.length - 1, first = r.querySelector<HTMLElement>("[data-tab-id]")
      if (tab.id === tabs.at(-1)?.id && n > 0 && first && r.scrollWidth <= r.clientWidth) {
        const gap = parseFloat(getComputedStyle(r).columnGap) || 0
        width = Math.min(parseFloat(getComputedStyle(el).maxWidth) || Infinity, (el.getBoundingClientRect().right - first.getBoundingClientRect().left - gap * (n - 1)) / n)
      }
    }
    closeTab(tab.id)
    if (mouse) setHeld({ width, count: tabs.length - 1 })
  }
  const handle = (
    <button type="button" data-pane-handle={group.id} aria-label="Move this pane" data-tip={d ? undefined : "Drag to move this pane"}
      onPointerDown={(e) => startDrag(e, { from: "group", group: group.id, label })}
      className={cn("grid h-7 w-5 shrink-0 cursor-grab place-items-center rounded-[5px] text-muted-foreground transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100",
        d?.item.group === group.id ? "opacity-100" : "opacity-0 group-hover/bar:opacity-100")}>
      <GripVertical className="size-4" strokeWidth={2} />
    </button>
  )
  // Nor pane titles (appearance `paneTitles`): a thin strip keeps the drag strip, the handle (on hover) and the menu.
  if (!tabBar && !paneTitles) {
    return (
      <div ref={strip} role="tablist" aria-label="Open tabs" data-tab-bar={group.id} data-tabs-hidden data-bare data-merged={merged || undefined} onContextMenu={menuFor(() => barMenu(group))}
        className="group/bar relative flex h-2.5 shrink-0 bg-background pr-1.5">
        {/* In flow, so the drag strip (its first child, index.css) keeps out of the corner padding the toggles sit in. */}
        <div className="h-full min-w-0 flex-1" />
        <div className="relative z-10 mt-0.5 self-start">{handle}</div>
      </div>
    )
  }
  // The tab bar turned off (appearance `tabBar`): the same bar (the window's drag strip, the pane's handle, a drop
  // opens in the pane), showing only the tab on screen.
  if (!tabBar) {
    const i = info(shown)
    return (
      <div role="tablist" aria-label="Open tabs" data-tab-bar={group.id} data-tabs-hidden onContextMenu={menuFor(() => barMenu(group))}
        className="group/bar relative flex h-10 shrink-0 items-center gap-1 border-b-[0.5px] border-border bg-background pr-1.5 pl-2">
        <div data-pane-title onContextMenu={menuFor(() => tabMenu(shown, shown === tabs.at(-1), tabs.length, group, true))}
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
      onPointerDownCapture={(e) => { pointer.current = e.pointerType }} onPointerLeave={() => { if (held) release() }}
      className="group/bar relative flex h-10 shrink-0 items-center gap-1 border-b-[0.5px] border-border bg-background pr-1.5 pl-2">
      {/* Tabs shrink down to their icon and close button, then the row scrolls (a mouse wheel scrolls it sideways),
          keeping the active tab in view. */}
      <div ref={row} data-select-list={TABS} onWheel={(e) => { if (!e.deltaX && e.currentTarget.scrollWidth > e.currentTarget.clientWidth) e.currentTarget.scrollLeft += e.deltaY }}
        className={cn("relative -my-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", d?.item.group === group.id && "opacity-50")}>
        {tabs.map((t, i) => {
          const s = t.set && t.set !== tabs[i - 1]?.set ? group.sets?.find((x) => x.id === t.set) : undefined
          const own = t.set ? group.sets?.find((x) => x.id === t.set) : undefined
          const chip = s && <SetChip key={`set:${s.id}`} s={s} n={tabs.filter((x) => x.set === s.id).length} target={preview?.into === s.id} />
          if (own?.collapsed) return chip || null
          const item = <TabItem key={t.id} tab={t} info={info(t)} active={t.id === active} focused={focused} only={tabs.length === 1 && t.to === "new" && alone} icons={fileIcons} tint={tabTint}
            menu={() => tabMenu(t, i === tabs.length - 1, tabs.length, group)} width={held?.width} settling={settling} close={(e) => closeHeld(t, e)}
            line={lineOf(t.id)} />
          return chip ? [chip, item] : item
        })}
        {/* Right after the last tab (not pinned to the bar's end). */}
        <button type="button" onClick={() => newTab(group.id)} aria-label="New tab" data-tip="New tab" data-slide="new" data-slide-fixed
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
          <Plus className="size-4" strokeWidth={2} />
        </button>
        {/* Where something from elsewhere would open. */}
        {preview?.tabs.some((t) => t.id === INCOMING) && (
          <div aria-hidden data-slide={INCOMING} className="pointer-events-none absolute top-1 left-0 h-7 rounded-[6px] bg-foreground/[0.06] ring-[0.5px] ring-border">
            {lineOf(INCOMING) && <span className={cn("absolute -bottom-[3px] left-0 h-[2px]", lineOf(INCOMING)!.last ? "right-1 rounded-r-full" : "-right-1")} style={{ background: lineOf(INCOMING)!.color }} />}
          </div>
        )}
      </div>
      {/* The pane's handle: drag it to move the whole pane (all its tabs). Shown while the pointer is over the bar. */}
      {handle}
    </div>
  )
}
