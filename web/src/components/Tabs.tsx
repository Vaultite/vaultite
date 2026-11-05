// Tabs (desktop): one bar of the window's tabs above its panes, a split tab one chip of its panes; drag a tab to
// reorder, onto a pane (an edge splits, the middle replaces it), or let go outside the window. A pane drags by its bar.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import {
  AppWindow, Blocks, Columns2, Columns3, Files, Globe, Group as GroupIcon, Heading1, LayoutList, Maximize2, Minimize2, MousePointerClick, GripVertical, PictureInPicture2, Folder,
  ArrowLeftRight, PanelTop, PanelBottom, FileText, Layers, Pin, PinOff, Plus, Rows2, SquareArrowOutUpRight, SquareDashed, Undo2, UnfoldHorizontal, Ungroup, X, type LucideIcon, PencilLine,
} from "lucide-react"
import type { Store } from "@/core/data"
import { edgeScroller, getDrag, laidOut, onDrag, onDragEnd, startDrag, useDrag, useDragItem, useDropHit, type Drag, type DragItem } from "@/core/drag"
import { slideFrom, timing } from "@/core/animation"
import { landFrom } from "@/core/panemotion"
import { snapshot } from "@/core/snapshot"
import { stem } from "@/core/files"
import { activePane, askRename, barsHidden, closePane, closeTab, closeTabIds, closeTabs, closeWholePane, here, isPopout, onWorkspaceChange, paneById, paneTab, popOut, selectPane, selectTab, set, showActiveUnder, tabById, togglePinTab, useTabList, keepsTab } from "@/core/workspace"
import { canFloat, canJoin, canPaneToTab, canTabIntoPane, canZoom, dockPane, floatPane, keepShown, moveToSplit, paneIntoPane, paneToTab, replaceWithTab, splitOut, splitPane, zoomPane } from "@/core/splits"
import { hasMainWindow, moveToMain } from "@/core/windows"
import { floatGhost } from "@/core/desktop"
import { focusedPane, isBlankTab, layout, panesOf, paneWith, placesIn, placesOf, shownTab, tabWith, vaultPath, type Group, type Pane, type Rect, type Tab } from "../../../core/layout.ts"
import { COLOR_NAMES, colorVar } from "../../../core/colors.ts"
import { openNewTab } from "@/core/launcher"
import { addToGroup, allGroups, closeGroup, colorGroup, groupById, leaveGroup, makeGroup, newTabInGroup, renameGroup, ungroup } from "@/core/tabgroups"
import { foldGroupMoving, useGrowIn, useGroupIn, useReflow, useShrinkOut } from "@/core/tabfold"
import { stir, useGroupLines } from "@/core/tabline"
import { canRenameTab, renameTab } from "@/core/tabnames"
import { dotIcon } from "@/components/ColorDot"
import { PANES, previewIn, previewOrder, groupsAsDrawn, sprangOpen, springing, type Drop } from "@/core/drop"
import { INCOMING, reorder, useSlide } from "@/core/slide"
import { usePane, usePaneHasTopBar } from "@/core/pane"
import { useUiMarks } from "@/core/uimarks"
import { tabButtons, tabsInSidebar, useViewsVersion, viewFor, viewMenuItems } from "@/core/plugins"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { commandItems, menuFor, openMenu, type MenuItem } from "@/components/ContextMenu"
import { useCommandKeys } from "@/core/commands"
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
  /** The colour it's marked with, active or not (a view's `tabColor`: a web page's container): a line along the tab's
   *  top in the bar, which stands in for the icon's own (`data-container-line`). */
  color?: string
  /** A small button at its end (a view's `tabMark`: a page playing sound, its speaker). */
  mark?: TabMark }

/** `it`, with `other` (its variant: moving instead of copying) in its submenu, or alone when that can't be done now. */
const withVariant = (it: MenuItem, other: MenuItem): MenuItem => (other.disabled ? it : { ...it, split: true, items: [it, other] })
/** `items` with a line before the first. */
const after = (items: MenuItem[]) => items.map((it, i) => (i ? it : { ...it, sep: true }))

/** Whether the window's tabs are drawn in a bar above its panes: the tab bar on (appearance `tabBar`), or a pop-out's
 *  when they'd be in a sidebar, which it hasn't got; never in a pop-out with its bars hidden. */
export const tabBarOn = (prefs = getPrefs()) => (prefs.tabBar || (isPopout() && tabsInSidebar(prefs))) && !barsHidden()

/** Right-click on a tab: the tab's own (closing, splits, where it shows), then what its focused pane shows. */
function tabMenu(tab: Tab): MenuItem[] {
  const l = here(), i = l.tabs.findIndex((t) => t.id === tab.id), ps = panesOf(tab)
  const shown = tab.id === l.active, split = ps.length > 1, blank = isBlankTab(tab), only = ps.length === 1 ? ps[0] : null
  return [
    { label: "Close", icon: X, run: () => closeTab(tab.id) },
    { label: "Close others", run: () => closeTabs("others", tab.id), disabled: l.tabs.length < 2 },
    { label: "Close tabs to the right", run: () => closeTabs("right", tab.id), disabled: i === l.tabs.length - 1 },
    { label: "Close all", run: () => closeTabs("all", tab.id) },
    // ("Pin tab", as its command: the file's own Pin, under More file actions, pins it to the sidebar)
    tab.pinned ? { label: "Unpin tab", icon: PinOff, sep: true, run: () => togglePinTab(tab.id) } : { label: "Pin tab", icon: Pin, sep: true, run: () => togglePinTab(tab.id) },
    // (a file's Rename is with its own items, below)
    ...(!(only && vaultPath(only.to)) && canRenameTab(tab) ? [{ label: "Rename tab…", icon: PencilLine, run: () => renameTab(tab.id) }] : []),
    ...groupItems([tab.id]),
    // On screen, its focused pane splits; another tab joins it, beside its focused pane.
    ...(shown ? [
      { label: "Split right", icon: Columns2, sep: true, run: () => splitPane("right", tab.focus) },
      { label: "Split down", icon: Rows2, run: () => splitPane("bottom", tab.focus) },
    ] : [
      { label: "Open in split right", icon: Columns2, sep: true, run: () => moveToSplit("right", tab.id), disabled: !canJoin(tab.id) },
      { label: "Open in split down", icon: Rows2, run: () => moveToSplit("bottom", tab.id), disabled: !canJoin(tab.id) },
    ]),
    ...(split ? [{ label: "Separate panes", icon: UnfoldHorizontal, run: () => separatePanes(tab.id) }] : []),
    ...(isPopout() ? [{ label: "Move to main window", icon: AppWindow, run: () => moveToMain([tab.id]), disabled: !hasMainWindow() }] : []),
    withVariant({ label: "Move to new window", icon: AppWindow, run: () => popOut(tab.id, true), disabled: blank },
      { label: "Open in new window", icon: AppWindow, run: () => popOut(tab.id), disabled: blank }),
    ...placeItems(focusedPane(tab)),
  ]
}

/** A split tab's panes each a tab of its own, and their own tabs too, in their order; the focused pane keeps the tab
 *  (shown, if it was). */
export function separatePanes(id: string) {
  const tab = tabById(id), l = here(), at = l.tabs.findIndex((t) => t.id === id)
  if (!tab || panesOf(tab).length < 2) return
  const tabs = placesIn(tab).map((p): Tab => (p.id === tab.focus ? { ...tab, root: tabWith(p).root, focus: p.id, zoom: undefined } : { ...tabWith(p), ...(tab.group ? { group: tab.group } : {}) }))
  set({ ...l, tabs: [...l.tabs.slice(0, at), ...tabs, ...l.tabs.slice(at + 1)] })
  showActiveUnder()
}

/** Right-click on a pane's bar: splitting it, taking it out of its tab, floating, zooming, closing; then what it
 *  shows. */
function paneMenu(id: string): MenuItem[] {
  const p = paneById(id), t = paneTab(id)
  if (!p || !t) return []
  const zoomed = t.zoom === id, several = panesOf(t).length > 1
  return [
    { label: "Split right", icon: Columns2, run: () => splitPane("right", id) },
    { label: "Split down", icon: Rows2, run: () => splitPane("bottom", id) },
    ...(canPaneToTab(id) ? [{ label: "Move to new tab", icon: SquareArrowOutUpRight, run: () => paneToTab(id) }] : []),
    ...(p.float ? [{ label: "Dock pane", icon: PictureInPicture2, run: () => dockPane(id) }]
      : canFloat(id) ? [{ label: "Float pane", icon: PictureInPicture2, run: () => floatPane(id) }] : []),
    ...(zoomed || (canZoom(id) && !p.float) ? [{ label: zoomed ? "Unzoom pane" : "Zoom pane", icon: zoomed ? Minimize2 : Maximize2, run: () => zoomPane(id) }] : []),
    // (a pane with tabs of its own: its X closes the one it shows, as a tab's would)
    ...(stackOf(id) > 1 ? [{ label: "Close tab", icon: X, sep: true, run: () => closePane(id) }, { label: "Close pane", run: () => closeWholePane(id) }]
      : [several ? { label: "Close pane", icon: X, sep: true, run: () => closePane(id) } : { label: "Close tab", icon: X, sep: true, run: () => closeTab(t.id) }]),
    ...placeItems(p),
  ]
}
/** How many tabs of its own pane `id`'s pane has (Pane.stack; 1: just what it shows). */
const stackOf = (id: string) => { const t = paneTab(id), p = t && paneWith(t.root, id); return p ? placesOf(p).length : 0 }

/** Right-click on one of a split's pane's own tabs (the Tabs panel's list under the split, a pane's strip): closing it or
 *  the pane's others, taking it out of the pane (a tab of its own, or a pane beside it); then what it shows. */
export function placeMenuOf(id: string): MenuItem[] {
  const p = paneById(id), t = paneTab(id), own = t && paneWith(t.root, id)
  if (!p || !t || !own) return []
  const others = placesOf(own).filter((x) => x.id !== id)
  return [
    { label: "Close tab", icon: X, run: () => closePane(id) },
    { label: "Close other tabs in pane", run: () => { for (const x of others) closePane(x.id) }, disabled: !others.length },
    { label: "Move to new tab", icon: SquareArrowOutUpRight, sep: true, run: () => paneToTab(id) },
    { label: "Split right", icon: Columns2, run: () => splitOut(id, "right"), disabled: !others.length },
    { label: "Split down", icon: Rows2, run: () => splitOut(id, "bottom"), disabled: !others.length },
    ...placeItems(p),
  ]
}

/** Right-click on a pane's bar (or the view's top bar that's its title row): a split's pane's own menu; a tab's only
 *  pane's is the tab's, as its chip has it (with the tab bar off, nothing else is the tab's). Then how they show. */
function barMenuOf(id: string): MenuItem[] {
  const t = paneTab(id), p = paneById(id)
  if (!t || panesOf(t).length > 1) return [...paneMenu(id), ...shownItems(p)]
  return [...tabMenu(t),
    ...after([{ label: "New tab", icon: Plus, run: () => openNewTab({ at: "end" }) }, ...commandItems("tab:reopen", "tab:search")]), ...shownItems(p)]
}

/** How the view in a pane shows (its `paneMenu`: the Browser's Hide page bar), with the rest of how things show. */
function viewPaneItems(p: Pane): MenuItem[] {
  const v = p.to.startsWith("view:") ? viewFor(p.to, getPrefs().disabled) : null
  if (!v?.on || !v.def.paneMenu) return []
  try { return v.def.paneMenu(v.arg, p.id) } catch { return [] }
}

/** How the tabs and panes show, outside in: in the sidebar or on top, the tab bar, pane titles, then how pane `p`'s
 *  view shows (the Browser's page bar), the same group in every menu that has it. */
function shownItems(p?: Pane): MenuItem[] {
  const { paneTitles } = getPrefs(), tabBar = tabBarOn()
  // With the tabs in the sidebar, the way back is to put them on top (the tab bar on, the list gone). (A pop-out's
  // bar is drawn for want of a sidebar: nothing to switch there.)
  const vertical = tabsInSidebar()
  return after([
    ...commandItems("tab:sidebar"),
    ...(vertical ? [] : [{ label: tabBar ? "Hide tab bar" : "Show tab bar", icon: PanelTop, run: () => setPrefs({ tabBar: !tabBar }) }]),
    { label: paneTitles ? "Hide pane titles" : "Show pane titles", icon: Heading1, run: () => setPrefs({ paneTitles: !paneTitles }) },
    ...(p ? viewPaneItems(p).map((it) => ({ ...it, sep: false })) : []),
    // (a pop-out: all of them at once, the window only what it shows)
    ...commandItems("window:bars"),
  ])
}

/** Right-click on the tab bar's empty space: then how things show, the tab on screen's view too. */
function barMenu(): MenuItem[] {
  return [
    { label: "New tab", icon: Plus, run: () => openNewTab({ at: "end" }) },
    ...commandItems("tab:reopen", "tab:search"),
    ...(hasMainWindow() ? [{ label: "Move all to main window", icon: AppWindow, run: () => moveToMain(here().tabs.map((t) => t.id)) }] : []),
    ...commandItems("window:on-top"),
    ...shownItems(activePane()),
  ]
}

/** The tabs' selection (core/select.ts): by tab id, the bar's, the Tabs panel's and the phone's cards alike. */
export const TABS = "tabs"

// ---------- tab groups (core/tabgroups.ts) ----------

/** What a tab group is called: its name, or its colour's ("Blue group"). */
export const groupName = (g: Group) => g.name || `${COLOR_NAMES[g.color]} group`

/** A tab menu's tab group rows, for one tab or several selected, as a browser's: into a new group (its editor opening
 *  on it), or with other groups to join, Add to group ▸ with New group first; then out of theirs. */
export function groupItems(ids: string[]): MenuItem[] {
  const tabs = here().tabs.filter((t) => ids.includes(t.id))
  if (!tabs.length) return []
  const n = tabs.length, own = new Set(tabs.map((t) => t.group)), what = n === 1 ? "tab" : `${n} tabs`
  const others = allGroups().filter((g) => !(own.size === 1 && own.has(g.id)))
  const fresh = () => { const id = makeGroup(ids); if (id) editGroup(id) }
  return [
    others.length
      ? { label: `Add ${what} to group`, icon: GroupIcon, sep: true, run: () => {}, items: [{ label: "New group", icon: Plus, run: fresh },
        ...others.map((g, i) => ({ label: groupName(g), icon: dotIcon(colorVar(g.color)), sep: i === 0, run: () => addToGroup(ids, g.id) }))] }
      : { label: `Add ${what} to new group`, icon: GroupIcon, sep: true, run: fresh },
    ...(tabs.some((t) => t.group) ? [{ label: "Remove from group", icon: Ungroup, run: () => leaveGroup(ids) }] : []),
  ]
}

/** A tab group's menu, its editor as a browser's: its name and colour right there (each change shows at once), then
 *  what it does. Right-click its chip, its row in the Tabs panel or its … there, or hold its card on a phone. */
export function groupMenu(id: string, at: "bar" | "panel" | "phone"): MenuItem[] {
  const g = groupById(id)
  if (!g) return []
  return [
    { label: "Group name", field: { value: g.name, placeholder: "Name this group", set: (v) => renameGroup(id, v) }, run: () => {} },
    { label: "Group colour", colors: { value: g.color, pick: (c) => colorGroup(id, c) }, run: () => {} },
    ...(at === "phone" ? [] : [{ label: "New tab in group", icon: Plus, sep: true, run: () => newTabInGroup(id) }]),
    { label: "Ungroup", icon: Ungroup, sep: at === "phone", run: () => ungroup(id) },
    { label: "Close group", icon: X, danger: true, run: () => closeGroup(id) },
  ]
}

/** Open a tab group's editor under its chip (the tab bar) or its row (the Tabs panel), as a new group's opens: once
 *  it's drawn, within a few frames. */
export function editGroup(id: string) {
  let tries = 12
  const look = () => {
    const el = [...document.querySelectorAll<HTMLElement>(`[data-group-chip="${id}"], [data-group-row="${id}"]`)].find((e) => e.offsetParent !== null)
    if (!el) { if (--tries > 0) requestAnimationFrame(look); return }
    const r = el.getBoundingClientRect(), at = el.dataset.groupChip ? "bar" : "panel"
    openMenu({ x: r.left, y: r.bottom + 4 }, groupMenu(id, at), false, () => groupMenu(id, at))
  }
  requestAnimationFrame(look)
}

/** A tab group's chip in the tab bar, before its tabs: a click (Enter, Space) folds it, right-click (the menu key,
 *  ⇧F10) has its editor, dragging it moves the whole group. The arrows reach it as they do the tabs (core/keylist.ts). */
function GroupChip({ g, n, target }: { g: Group; n: number
  /** A tab dragged onto it (folded) would join it. */
  target: boolean }) {
  const item = useDragItem()
  const c = colorVar(g.color)
  const el = useRef<HTMLButtonElement>(null)
  useGroupIn(el, g.id)
  useShrinkOut(el, { group: g.id })
  return (
    <button type="button" ref={el} tabIndex={-1} data-group-chip={g.id} data-ui={`group:${g.id}`} data-slide={`group:${g.id}`} data-line-head={g.id} style={{ ["--line" as string]: c }} aria-expanded={!g.collapsed}
      onContextMenu={menuFor(() => groupMenu(g.id, "bar"))}
      onPointerDown={(e) => startDrag(e, { from: "group", group: g.id, label: groupName(g) })}
      onClick={() => foldGroupMoving(g.id)}
      data-tip={item ? undefined : g.collapsed ? `Expand ${groupName(g)}` : `Collapse ${groupName(g)}`}
      className={cn("relative flex h-7 shrink-0 cursor-pointer items-center", item?.group === g.id && "opacity-50")}>
      {/* (as tall as a tab, the chip inside: the line under it then lines up with the tabs') */}
      {/* (a long name cut off, as a browser's chip: the tabs keep their room; the tip says it whole) */}
      {/* (the line under the group's tabs starts under it: core/tabline.ts) */}
      <GroupLabel g={g} n={n} target={target} className="max-w-40" />
      <GroupMarks id={g.id} />
    </button>
  )
}

/** What other plugins mark a tab group with (a page playing in it, folded): a small button each after its chip. */
function GroupMarks({ id }: { id: string }) {
  const marks = useUiMarks(`group:${id}`)
  return <>{marks.map((m, k) => (
    <IconAction key={k} action={m} className="ml-1"><m.icon className="size-3.5 shrink-0 text-primary" strokeWidth={2.25} style={m.tint ? { color: m.tint } : undefined} /></IconAction>
  ))}</>
}

/** A tab group's name in a solid chip of its colour (the tab bar's, the Tabs panel's), its text white or dark by it; no
 *  name, a small square. Folded, its count `n` shows: drawn always, to open out as the click folds it (index.css). */
export function GroupLabel({ g, n, target, className }: { g: Group; n?: number; target?: boolean; className?: string }) {
  const c = colorVar(g.color), name = n !== undefined && g.collapsed ? `${groupName(g)}, ${n} ${n === 1 ? "tab" : "tabs"}` : groupName(g)
  return (
    <span data-group-name data-bare={g.name ? undefined : ""} {...(g.name ? {} : { role: "img", "aria-label": name })}
      className={cn("on-tint inline-flex max-w-full shrink-0 items-center justify-center text-[12px] leading-none font-semibold transition-[background-color,color,box-shadow] duration-(--motion)",
        g.name && "h-5 rounded-[6px] px-1.5", className)}
      style={{ ["--tint" as string]: c, background: c, ...(target ? { boxShadow: `0 0 0 2px var(--background), 0 0 0 4px ${c}` } : {}) }}>
      {g.name && <span className="min-w-0 truncate">{g.name}</span>}
      {n !== undefined && <span data-group-count aria-hidden={!g.collapsed || undefined}><span><span className={cn("block font-medium tabular-nums opacity-80", g.name && "pl-1")}>{n}</span></span></span>}
    </span>
  )
}

/** What tabs selected together can do: close them (or the others), pin them, group them, move them to a window. */
export function tabsMenu(ids: string[], phone = false): MenuItem[] {
  const all = here().tabs
  const tabs = all.filter((t) => ids.includes(t.id))
  if (!tabs.length) return []
  const n = tabs.length, pinned = tabs.every((t) => t.pinned)
  const files = tabs.flatMap(panesOf).map((p) => vaultPath(p.to)).filter((p): p is string => !!p)
  return [
    { label: n === 1 ? "Close tab" : `Close ${n} tabs`, icon: X, run: () => closeTabIds(ids) },
    { label: "Close other tabs", run: () => closeTabIds(ids, { keep: true }), disabled: tabs.length === all.length },
    ...(phone ? [] : [
      { label: `${pinned ? "Unpin" : "Pin"} ${n === 1 ? "tab" : `${n} tabs`}`, icon: pinned ? PinOff : Pin, sep: true, run: () => tabs.forEach((t) => { if (!!t.pinned === pinned) togglePinTab(t.id) }) },
      ...groupItems(ids),
      ...(isPopout() && hasMainWindow() ? [{ label: "Move to main window", icon: AppWindow, sep: true, run: () => moveToMain(ids) }] : []),
      { label: "Move to new window", icon: AppWindow, sep: !(isPopout() && hasMainWindow()), run: () => popOut(ids, true), disabled: tabs.every(isBlankTab) },
    ]),
    ...(files.length ? [{ label: files.length === 1 ? "Copy path" : "Copy paths", icon: FileText, sep: true, run: () => void copyText(files.join("\n")) }] : []),
  ]
}

/** What a pane shows offers: a view's own items, or a file's as in the tree. `phone` leaves out what a phone hasn't got
 *  (reveal in tree; renaming is the title). */
function placeItems(p: Pane, phone = false): MenuItem[] {
  const out: MenuItem[] = []
  const file = vaultPath(p.to)
  const v = p.to.startsWith("view:") ? viewFor(p.to, getPrefs().disabled) : null
  if (v?.on && v.def.tabMenu) out.push(...after(v.def.tabMenu(v.arg, p.id)))
  if (v?.on) out.push(...after(viewMenuItems(p.to)))
  if (p.to.startsWith("file:/")) out.push({ ...copyToVaultItem(p.to.slice(5), () => selectPane(p.id)), sep: true }, ...revealItem(p.to.slice(5)))
  if (file) out.push(...after(fileMenu(file, { phone, short: !phone, rename: () => { selectPane(p.id); askRename(file) } })))
  return out
}

/** The phone's … menu (its header, components/PhoneHeader.tsx) for the tab on screen: what its focused pane shows, then
 *  Close (a split's pane on its own too). */
export function phoneTabMenu(tab: Tab): MenuItem[] {
  const items = placeItems(focusedPane(tab), true).map((it, i) => (i === 0 ? { ...it, sep: false } : it))
  const split = panesOf(tab).length > 1
  return [...items, ...(split ? [
    { label: "Move to new tab", icon: SquareArrowOutUpRight, sep: items.length > 0, run: () => paneToTab(tab.focus) },
    { label: "Separate panes", icon: UnfoldHorizontal, run: () => separatePanes(tab.id) },
    { label: "Close pane", icon: X, sep: true, run: () => closePane(tab.focus) },
  ] : []),
  { label: "Close tab", icon: X, sep: !split && items.length > 0, run: () => closeTab(tab.id) }]
}

/** A tab card's menu in the phone's tab list (held, or right-clicked): closing, its panes (`panes` shows them), joining
 *  the tab on screen, then what it shows. */
export function tabCardMenu(tab: Tab, count: number, groups: MenuItem[] = [], panes?: () => void): MenuItem[] {
  const n = panesOf(tab).length, shown = here().active
  return [
    { label: "Close tab", icon: X, run: () => closeTab(tab.id) },
    { label: "Close other tabs", run: () => closeTabs("others", tab.id), disabled: count < 2 },
    { label: "Close all tabs", danger: true, run: () => closeTabs("all", tab.id) },
    ...groups,
    ...(n > 1 ? [
      ...(panes ? [{ label: "Show panes", icon: Columns2, sep: true, run: panes }] : []),
      ...(n === 2 ? [{ label: "Swap panes", icon: ArrowLeftRight, sep: !panes, run: () => { const [a, b] = panesOf(tab); paneIntoPane(a.id, b.id, "center"); keepShown(shown) } }] : []),
      { label: "Separate panes", icon: UnfoldHorizontal, sep: !panes && n !== 2, run: () => separatePanes(tab.id) },
    ] : []),
    // (another tab joins the one on screen, beside its focused pane: the computer's Open in split right)
    ...(tab.id !== shown ? [{ label: "Open in split", icon: Columns2, sep: n < 2, run: () => moveToSplit("right", tab.id), disabled: !canJoin(tab.id) }] : []),
    ...placeItems(focusedPane(tab), true),
  ]
}

/** A pane's card in a split tab's page of the phone's tab list: taking it out, closing it, then what it shows. */
export function paneCardMenu(p: Pane): MenuItem[] {
  const t = paneTab(p.id)
  if (!t) return []
  const shown = here().active
  return [
    { label: "Move to new tab", icon: SquareArrowOutUpRight, run: () => { paneToTab(p.id); keepShown(shown) } },
    { label: "Close pane", icon: X, run: () => closePane(p.id) },
    ...placeItems(p, true),
  ]
}

// ---------- dragging tabs and panes (and files from the sidebar: the same drops) ----------

/** One pane of a tab's picture on its card: where it sits (shares of the card) and, drawn somewhere (on screen, or kept
 *  hidden), its page and the size it has. */
type Mini = { pane: Pane; rect: Rect; page?: { el: HTMLElement; w: number; h: number } }
/** How the dragged thing is drawn: a tab lifted out of its bar (its own look, held where it was grabbed), a pane as a
 *  small card of itself, or a label by the pointer (a file, a panel). It lifts `from` a place, goes back `home`. */
type Look = { kind: "tab" | "pane" | "pill"; grab: { x: number; y: number }; w: number; h: number; from?: DOMRect; home?: DOMRect; k?: number; section?: HTMLElement
  /** A tab's layout in miniature (Rex's card: every pane of it), and its height for the card's width. */
  minis?: Mini[]; thumb?: number }
/** A pane's card at most this big (px); held where it would become a pane (a pane's edge), anything is a small page. */
const CARD = { w: 340, h: 230 }, PAGE = { w: 216, h: 136 }
/** A tab pulled off the bar: a card this wide, its title over a picture of its panes (at most this tall). */
const TAB_CARD = { w: 240, h: 170 }
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
/** A pane's section on screen (not one kept drawn for a tab that isn't). */
const frameOf = (id: string) => document.querySelector<HTMLElement>(`section[data-pane-frame="${CSS.escape(id)}"]:not([data-away])`)

/** Tab `t`'s panes in miniature: each where it is in its layout (floating ones over the tiled), with its page if it's
 *  drawn (a page too big to copy at once, a long note read whole, is a sketch of one). */
function minisOf(t: Tab, area: DOMRect | undefined): Mini[] {
  const { panes, floats } = layout(t.root)
  const tiles = t.zoom ? panes.filter((p) => p.pane.id === t.zoom).map((p) => ({ ...p, rect: { x: 0, y: 0, w: 1, h: 1 } })) : panes
  return [...tiles, ...floats].map(({ pane, rect }) => {
    const el = document.querySelector<HTMLElement>(`[data-tab-body="${CSS.escape(pane.id)}"]`)
    const w = (area?.width ?? 0) * rect.w, h = (area?.height ?? 0) * rect.h
    return { pane, rect, ...(el && w && h && el.getElementsByTagName("*").length < 6000 ? { page: { el, w, h } } : {}) }
  })
}

function lookOf(item: DragItem | null, d: Drag | null): Look {
  const o = d?.origin
  if (!item || !o || d.finger || item.drawn) return { kind: "pill", grab: { x: -10, y: -10 }, w: 0, h: 0 }
  const section = item.pane ? frameOf(item.pane) : null
  const r = section?.getBoundingClientRect()
  if (section && r?.width && r.height) {
    const k = Math.min(1, CARD.w / r.width, CARD.h / r.height)
    return { kind: "pane", grab: { x: (o.x - r.left) * k, y: (o.y - r.top) * k }, w: r.width * k, h: r.height * k, from: r, home: r, k, section }
  }
  if (item.from === "tab") {
    const w = Math.min(o.rect.width, 240)
    const t = item.tab && !item.tabs ? tabById(item.tab) : undefined
    const area = document.querySelector("[data-pane-area]")?.getBoundingClientRect()
    const minis = t ? minisOf(t, area) : undefined
    const thumb = area?.width && area.height ? Math.min(TAB_CARD.h, (TAB_CARD.w * area.height) / area.width) : PAGE.h - 28
    return { kind: "tab", grab: { x: clamp(o.x - o.rect.left, 0, w), y: clamp(o.y - o.rect.top, 0, o.rect.height) }, w, h: o.rect.height, from: o.rect, home: o.rect, minis, thumb }
  }
  return { kind: "pill", grab: { x: -10, y: -10 }, w: 0, h: 0, home: o.rect }
}

/** A dropped tab slides into its slot in `list` (the tab bar's, the Tabs panel's) from where its picture was let go
 *  (`from`), once it's drawn there. */
function landTab(list: Element, id: string, from: DOMRect) {
  requestAnimationFrame(() => {
    const t = [...list.querySelectorAll<HTMLElement>(`[data-slide="${CSS.escape(id)}"]`)].find((e) => e.offsetParent)
    if (t && slideFrom(t, from, "spring")) stir(t)
  })
}
/** The list of tabs making way for a drop of tab `id` (useSlide marks it): where it lands, let go there. */
const listShowing = (id: string) => [...document.querySelectorAll("[data-drop-preview]")].find((e) => e.querySelector(`[data-slide="${CSS.escape(id)}"]`)) ?? null
/** Tab `id` drawn in a list now (the tab bar's chip, the Tabs panel's row): the one nearest `near`, where it was. */
function tabDrawn(id: string, near?: DOMRect) {
  const q = CSS.escape(id), at = (e: Element) => e.getBoundingClientRect()
  const all = [...document.querySelectorAll<HTMLElement>(`[data-tab-bar] [data-tab-id="${q}"], [data-open-tabs] > [data-slide="${q}"]`)].filter((e) => e.offsetParent)
  const far = (e: Element) => (near ? Math.hypot(at(e).left - near.left, at(e).top - near.top) : 0)
  return all.sort((a, b) => far(a) - far(b))[0] ?? null
}

/** A sketch of a page: a few lines, for a pane whose page isn't drawn. */
const Sketch = () => (
  <div className="space-y-1.5 p-2"><div className="h-1.5 w-3/4 rounded-full bg-foreground/[0.08]" /><div className="h-1.5 w-11/12 rounded-full bg-foreground/[0.08]" /><div className="h-1.5 w-1/2 rounded-full bg-foreground/[0.08]" /></div>
)

/** The dragged tab, pane or file, following the pointer (drawn above the sidebar): drawn again when what it shows
 *  changes, moved without React on every move. Let go somewhere it can't go, it springs back where it came from. */
export function DragGhost({ info }: { info: (t: Tab | Pane) => TabInfo }) {
  const live = useDragItem()
  // (after the drag, still drawn while it goes back where it came from)
  const [back, setBack] = useState<{ item: DragItem } | null>(null)
  const item = live ?? back?.item ?? null
  const hint = useDrag((d) => d?.hit?.hint), hit = useDrag((d) => !!d?.hit), finger = useDrag((d) => !!d?.finger)
  const over = useDrag((d) => (d?.hit?.target === PANES ? (d.hit.data as Drop).kind : null)), overPanes = !!over
  const zone = useDrag((d) => (d?.hit?.target === PANES && (d.hit.data as Drop).kind === "pane" ? (d.hit.data as Drop & { kind: "pane" }).zone : null))
  const { fileIcons } = usePrefs()
  const el = useRef<HTMLDivElement>(null), card = useRef<HTMLDivElement>(null), shot = useRef<HTMLDivElement>(null)
  // (where the pointer holds the card, as it follows: past the window's edge, where it's held over the screen)
  const held = useRef({ x: 0, y: 0 })
  // (measured once a drag, as it lifts)
  const look = useMemo(() => lookOf(item, getDrag()), [item]), lookRef = useRef(look)
  useEffect(() => { lookRef.current = look }, [look])
  // A tab pulled off the bar (over a pane, or nothing) is a card of its panes; anything else held where it would
  // become a pane (a pane's edge) is a small page.
  const shape = finger || back ? null : look.kind === "tab" ? (!hit || zone ? "card" : null) : look.kind === "pill" && zone && zone !== "center" ? "page" : null
  const size = shape === "card" ? { w: TAB_CARD.w, h: 28 + (look.thumb ?? 0) } : shape === "page" ? PAGE : null
  // (what it was over as it was let go: what drop.ts answered last)
  const last = useRef<{ over: Drop["kind"] | null; split: boolean }>({ over: null, split: false })
  useEffect(() => { if (live) last.current = { over, split: !!zone && zone !== "center" } }, [live, over, zone])
  // Over an open sheet (a modal <dialog>) it's placed inside it.
  const sheet = item ? [...document.querySelectorAll<HTMLElement>("dialog[open]")].pop() ?? null : null
  useLayoutEffect(() => {
    const g = el.current
    if (!g || !live) return
    // A label goes by the pointer: near the window's right edge left of it, a finger's above it (a finger covers
    // what's under). A tab or a pane stays held where it was grabbed. (moved by a transform: no layout a move)
    const follow = () => {
      const d = getDrag()
      if (!d) return
      const o = sheet?.getBoundingClientRect() ?? { left: 0, top: 0 }
      let x = look.kind !== "pill" ? d.x - look.grab.x : d.finger ? Math.max(8, Math.min(d.x - 32, innerWidth - 268)) : d.x > innerWidth - 280 ? d.x - 10 - g.offsetWidth : d.x + 10
      let y = look.kind !== "pill" ? d.y - look.grab.y : d.finger ? d.y - 64 : d.y + 10
      held.current = { x: d.x - x, y: d.y - y }
      // (a card kept in the window, as big as it's becoming)
      if (look.kind !== "pill" || size) {
        x = clamp(x, 4, innerWidth - (size ?? look).w - 4)
        y = clamp(y, 4, innerHeight - (size ?? look).h - 4)
      }
      g.style.transform = `translate(${x - o.left}px, ${y - o.top}px)`
    }
    follow()
    return onDrag(follow)
  }, [live, look, sheet, finger, hint, size?.w, size?.h, overPanes])
  // Past the window's edge, where a tab goes on in another window, its card goes on over the screen (the desktop app's:
  // electron/dragghost.ts), a picture of it as it is then, and leaves the page; back in, it's the page's again.
  useLayoutEffect(() => {
    const g = el.current, c = card.current, float = floatGhost
    if (!g || !c || !live || !float || !(live.tab || live.tabs?.length || live.group || live.pane)) return
    let state: "in" | "asking" | "out" | "failed" = "in"
    const restore = () => { g.style.removeProperty("visibility"); g.style.removeProperty("opacity"); g.style.removeProperty("transition") }
    const check = () => {
      const d = getDrag()
      if (!d) return // (ended: the cleanup's)
      const out = !d.finger && (d.x < 0 || d.y < 0 || d.x >= innerWidth || d.y >= innerHeight)
      if (!out && state !== "in") { if (state !== "failed") void float(null); state = "in"; restore() }
      if (!out || state !== "in") return
      state = "asking"
      // (its picture whole, not faded as it is over nothing)
      g.style.transition = "none"; g.style.opacity = "1"
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (state !== "asking") return
        const r = c.getBoundingClientRect(), radius = parseFloat(getComputedStyle(c).borderTopLeftRadius) || 0
        void float({ x: r.left, y: r.top, width: r.width, height: r.height, grab: held.current, radius }).then((ok) => {
          if (state !== "asking") return
          state = ok ? "out" : "failed"
          if (ok) g.style.visibility = "hidden"
          else restore()
        })
      }))
    }
    check()
    const off = onDrag(check)
    return () => { off(); if (state === "asking" || state === "out") void float(null); restore() }
  }, [live, look])
  // Lifted: a pane shrinks from its place into its card (a copy of it), a tab rises out of its bar with its panes'
  // pictures.
  useLayoutEffect(() => {
    const c = card.current
    if (!live || !c) return
    setBack(null)
    if (look.section && shot.current) {
      const s = snapshot(look.section, { light: "[data-pane-bar]" })
      shot.current.replaceChildren(s.host)
      s.settle()
    }
    for (const m of look.minis ?? []) {
      const at = m.page && c.querySelector<HTMLElement>(`[data-mini-shot="${CSS.escape(m.pane.id)}"]`)
      if (!at || !m.page) continue
      const s = snapshot(m.page.el)
      at.replaceChildren(s.host)
      s.settle()
    }
    if (look.from) slideFrom(c, look.from, "spring", true)
  }, [live, look])
  // Let go (told just before the drop is done): on a pane, the pane (a tab's focused one) grows from its card into its
  // place; into the tab bar, a tab slides into its slot; nowhere, back it goes.
  useEffect(() => onDragEnd((e) => {
    const c = card.current, { item: it } = e
    if (!c || !e.origin || it.drawn || e.away) return
    if (!e.dropped) { setBack({ item: it }); return }
    const from = c.getBoundingClientRect(), { over } = last.current
    // (into a list of tabs: the bar, or the Tabs panel, which makes way as the bar does)
    const list = over !== "pane" && it.tab ? listShowing(it.tab) : null
    if (!over && !list) return
    // (back to itself before it moves: what's drawn of it on the way isn't faded)
    lookRef.current.section?.removeAttribute("data-lifted")
    const t = it.tab ? tabById(it.tab) : undefined
    if (over === "pane") { if (it.pane) landFrom(it.pane, from); else if (t) landFrom(t.focus, from) }
    else if (list) landTab(list, it.tab!, from)
  }), [])
  useLayoutEffect(() => {
    if (!back) return
    const { item: it } = back, c = card.current, t = timing("spring")
    const tab = look.kind === "tab" && it.tab ? tabDrawn(it.tab, look.home) : null
    const home = tab?.getBoundingClientRect() ?? (look.kind === "pane" ? look.section?.getBoundingClientRect() : look.home)
    if (!c || !home || !t.duration) { setBack(null); return }
    // (back home whole, a label just fading there)
    const now = c.getBoundingClientRect(), scale = look.kind !== "pill"
    const to = `translate(${home.left - now.left}px, ${home.top - now.top}px) scale(${scale ? home.width / now.width : 1}, ${scale ? home.height / now.height : 1})`
    const a = c.animate([{ transformOrigin: "0 0", transform: "none", opacity: 1 }, { transformOrigin: "0 0", transform: to, opacity: scale ? 1 : 0 }], { ...t, fill: "forwards" })
    a.finished.then(() => setBack(null), () => {})
    return () => a.cancel()
  }, [back, look])
  // (a sidebar panel draws its own card, but over the panes it shows as the tab it would open)
  if (!item || item.elsewhere || (item.drawn && !(item.to && overPanes))) return null
  const dragged = item.tab ? tabById(item.tab) : undefined, pane = item.pane ? paneById(item.pane) : undefined
  const i: TabInfo = item.paths || item.tabs ? { label: item.label ?? "", icon: item.tabs ? Layers : Files }
    : item.folder ? { label: item.path!.split("/").pop()!, icon: Folder }
    : item.newtab ? { label: item.label ?? item.newtab.key, icon: item.newtab.list === "actions" ? MousePointerClick : LayoutList }
    : item.status ? { label: item.label ?? item.status, icon: PanelBottom }
    : item.block ? { label: item.label ?? item.block, icon: Blocks }
    : item.column ? { label: item.label ?? item.column.key, icon: Columns3 }
    : item.site ? { label: item.label ?? item.site.site, icon: Globe }
    : item.panel && !(item.to && overPanes) ? { label: item.label ?? item.panel, icon: PanelTop }
    : pane ? info(pane)
    : item.group ? { label: item.label ?? "", icon: dotIcon(colorVar(groupById(item.group)?.color ?? "gray")) }
    : dragged ? info(dragged)
    : item.from === "row" && !item.to ? { label: item.label ?? item.path?.split("/").pop()?.replace(/\.md$/i, "") ?? "", icon: FileText }
    : info({ id: "", to: item.to ?? "new" })
  return createPortal(
    <div ref={el} aria-hidden data-drag-ghost data-drag-look={look.kind} data-drag-shape={shape ?? undefined}
      className={cn("pointer-events-none fixed top-0 left-0 transition-opacity duration-(--motion-fast) will-change-transform", finger ? "z-[70]" : "z-50", !hit && (!back || look.kind === "pill") && "opacity-60")}>
      {look.kind === "pane" ? (
        <div ref={card} className="relative overflow-hidden rounded-[10px] bg-background shadow-2xl ring-[0.5px] ring-border" style={{ width: look.w, height: look.h }}>
          {/* The pane as it looks, scaled down into its card. */}
          <div ref={shot} className="absolute top-0 left-0 origin-top-left" style={{ width: look.from!.width, height: look.from!.height, transform: `scale(${look.k})` }} />
          <span className="sr-only">{i.label}</span>
          {/* What a drop there does that isn't seen in a pane ("Move pane to workspace 3"), on the card. */}
          {hint && <span className="absolute inset-x-2 bottom-2 mx-auto w-fit max-w-full truncate rounded-[6px] bg-card px-2 py-1 text-[12px] font-medium shadow-md ring-[0.5px] ring-border">{hint}</span>}
        </div>
      ) : (
        <div ref={card} data-drag-card className={cn("flex max-w-[260px] flex-col overflow-hidden bg-card shadow-lg ring-[0.5px] ring-border",
          finger ? "h-10 rounded-[10px] text-[15px]" : "h-7 rounded-[6px] text-[13px]", size && "rounded-[10px] shadow-xl")}
          style={{ width: size?.w ?? (look.kind === "tab" ? look.w : undefined), height: size?.h, scale: look.kind === "tab" && !size && !back ? "1.03" : undefined }}>
          <div className={cn("flex shrink-0 items-center gap-1.5", finger ? "h-10 px-3" : "h-7 px-2")}>
            {fileIcons && <i.icon className={cn(finger ? "size-[18px] shrink-0" : "size-3.5 shrink-0", !i.tint && "text-muted-foreground", i.iconClassName)} strokeWidth={2.25} style={i.tint ? { color: i.tint } : undefined} />}
            <span className="min-w-0 truncate font-medium">{i.label}</span>
            {hint && <span className="shrink-0 text-muted-foreground">{hint}</span>}
          </div>
          {/* Under its title, the tab's whole layout in miniature (Rex's): each pane's page scaled down into its place, or a
              sketch of one. */}
          <div aria-hidden className="relative flex-1 overflow-hidden border-t-[0.5px] border-border bg-background">
            {look.minis?.length ? look.minis.map((m) => (
              <div key={m.pane.id} data-mini={m.pane.id} className={cn("absolute overflow-hidden bg-background", m.pane.float ? "rounded-[4px] shadow-md ring-[0.5px] ring-border" : "ring-[0.5px] ring-border")}
                style={{ left: `${m.rect.x * 100}%`, top: `${m.rect.y * 100}%`, width: `${m.rect.w * 100}%`, height: `${m.rect.h * 100}%` }}>
                {m.page ? <div data-mini-shot={m.pane.id} className="absolute top-0 left-0 origin-top-left" style={{ width: m.page.w, height: m.page.h, transform: `scale(${(TAB_CARD.w * m.rect.w) / m.page.w})` }} />
                  : <MiniSketch info={info(m.pane)} icons={fileIcons} />}
              </div>
            )) : <Sketch />}
          </div>
        </div>
      )}
    </div>,
    sheet ?? document.body,
  )
}

/** A pane in a dragged tab's picture whose page isn't drawn: its icon and name over a sketch. */
function MiniSketch({ info: i, icons }: { info: TabInfo; icons: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-4 shrink-0 items-center gap-1 px-1.5 text-[9px] text-muted-foreground">
        {icons && <i.icon className="size-2.5 shrink-0" strokeWidth={2.25} style={i.tint ? { color: i.tint } : undefined} />}
        <span className="min-w-0 truncate">{i.label}</span>
      </div>
      <Sketch />
    </div>
  )
}

/** The tab whose chip or row (`data-spring-tab`) a dragged pane or tab is held on the middle of: there it holds still
 *  (drop.ts' slotBeside) and opens after a moment (springOver); its edges reorder. Not its own, nor the one on screen. */
export function springTabAt(item: DragItem, x: number, y: number): string | null {
  if (!item.pane && !item.tab) return null
  const own = item.pane ? paneTab(item.pane)?.id : item.tab, shown = here().active
  for (const e of document.querySelectorAll<HTMLElement>("[data-spring-tab]")) {
    const id = e.dataset.springTab!
    // (one this drag opened by holding on it goes on holding still: nothing moves when it opens)
    if (id === own || item.tabs?.includes(id) || (id === shown && !sprangOpen(item, id)) || !e.offsetParent) continue
    const r = laidOut(e), across = !!e.closest("[data-tab-strip]")
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
    const at = across ? (x - r.left) / r.width : (y - r.top) / r.height
    return at > 0.25 && at < 0.75 ? id : null
  }
  return null
}

/** Press on a tab: it drags (all its panes), or (one of several selected) they all do. */
export function dragTab(e: React.PointerEvent<HTMLElement>, tab: Tab, opts?: { touch?: boolean; drawn?: boolean }) {
  const ids = selectionFor(TABS, tab.id, false)
  const to = focusedPane(tab).to
  const item: DragItem = { from: "tab", tab: tab.id, to, path: panesOf(tab).length === 1 ? vaultPath(to) ?? undefined : undefined, drawn: opts?.drawn }
  startDrag(e, ids && ids.length > 1 ? { ...item, tabs: ids, label: `${ids.length} tabs` } : item, { touch: opts?.touch })
}
/** Press on a pane's bar, or a half of a split tab's row: the pane drags (out of its tab, into another's, or to a tab of
 *  its own in the list). */
export function dragPane(e: React.PointerEvent<HTMLElement>, id: string, label?: string) {
  const p = paneById(id)
  if (p) startDrag(e, { from: "pane", pane: id, to: p.to, label })
}

/** A tab's place in the tab bar: its icon and name, a split tab its panes' side by side (each half its own, a click
 *  there focuses it). */
function TabChip({ tab, info, active, icons, menu, width, settling, close, line, hole, only }: { tab: Tab; info: (t: Tab | Pane) => TabInfo; active: boolean; icons: boolean
  menu: () => MenuItem[]
  /** The tab group whose line runs under it (core/tabline.ts): its own, or the one a drag's preview puts it in. */
  line?: string
  /** Held at this width after a close (TabStrip). */
  width?: number; settling: boolean; close: (e: React.MouseEvent<HTMLElement>) => void
  /** Dragged over the bar: lifted out, it leaves its slot empty where it would land. */
  hole: boolean
  /** The window's only tab, blank: nothing to close. */
  only: boolean }) {
  const item = useDragItem()
  const picked = useSelected(TABS, tab.id)
  // (a dragged pane or tab held on it: lit, about to open it, as Rex's rows)
  const lit = useDrag((d) => !!d && springing() === tab.id)
  const el = useRef<HTMLDivElement>(null)
  useGrowIn(el, tab)
  useShrinkOut(el, { tab: tab.id })
  const ps = panesOf(tab), split = ps.length > 1, own = info(tab)
  const dragging = item?.tab === tab.id || (picked && !!item?.tabs) || (!!tab.group && item?.group === tab.group)
  // (away from the bar, the tab held shows where it goes back to)
  const away = dragging && !hole && (item?.tab === tab.id || picked)
  const tip = split ? ps.map((p) => info(p).label).join(" | ") : own.label
  const buttons = split || dragging ? [] : tabButtons(ps[0].to)
  const click = (e: React.MouseEvent<HTMLElement>) => {
    // ⌥-click: it takes the focused pane's place, what was there going back to the list as a tab.
    if (e.altKey && !active && canTabIntoPane(tab.id, activePane().id, "center")) { e.preventDefault(); return replaceWithTab(tab.id) }
    if (selectClick(e, TABS, tab.id, active ? null : here().active)) return
    const half = (e.target as Element).closest<HTMLElement>("[data-pane-half]")?.dataset.paneHalf
    if (half) selectPane(half); else selectTab(tab.id)
  }
  return (
    <div ref={el} data-tab-id={tab.id} data-ui={`tab:${tab.id}`} data-spring-tab={tab.id} data-in-group={tab.group} data-line-of={line} data-slide={tab.id} data-select-key={tab.id} data-split={split || undefined}
      {...selectedAttr(picked)} role="presentation" onContextMenu={menuFor(rowMenu(TABS, tab.id, menu))}
      onPointerDown={(e) => dragTab(e, tab)} onClick={click}
      className={cn("group/tab @container/tab relative flex h-7 min-w-12 flex-1 basis-0 items-center rounded-[6px] transition-colors",
        split ? "max-w-[320px]" : "max-w-[220px]", active ? "bg-card shadow-sm ring-[0.5px] ring-border" : lit ? "bg-foreground/[0.08] ring-[0.5px] ring-border" : "hover:bg-foreground/[0.05]",
        dragging && (hole ? "bg-foreground/[0.06] shadow-none ring-[0.5px] ring-border [&>button]:invisible" : away ? "[&>[data-tab-close]]:invisible [&>[data-tab-pin]]:invisible [&>[role=tab]]:opacity-40" : "opacity-40"))}
      style={{ ...(width ? { flex: `0 0 ${width}px` } : settling ? { transition: "flex var(--motion) var(--ease-out)" } : {}), ...(buttons.length ? { "--tab-buttons": `${buttons.length * 22}px` } : {}) } as React.CSSProperties}>
      <button type="button" role="tab" aria-selected={active} aria-label={split ? tip : undefined}
        onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); if (!tab.pinned) close(e) } }}
        data-tip={item ? undefined : tip} data-tip-trunc className={cn("flex h-full min-w-0 flex-1 cursor-pointer items-center rounded-[inherit] pr-6 pl-2 text-left text-[13px]", own.color && !split && "[&_[data-container-line]]:hidden")}>
        {split && !(tab.name && own.label === tab.name) ? ps.map((p, k) => (
          <span key={p.id} data-pane-half={p.id} data-ui={`pane:${p.id}`} className={cn("flex h-full min-w-0 flex-1 basis-0 items-center gap-1.5", k && "ml-1.5 border-l-[0.5px] border-border pl-1.5")}>
            <ChipLabel i={info(p)} icons={icons} strong={active && p.id === tab.focus} muted={!active || p.id !== tab.focus} />
          </span>
        )) : (
          <span className="flex h-full min-w-0 flex-1 items-center gap-1.5">
            {split && icons && ps.map((p) => <PaneIcon key={p.id} i={info(p)} />)}
            <ChipLabel i={own} icons={icons && !split} strong={active} muted={!active} mark reserve={buttons.length > 0} />
          </span>
        )}
      </button>
      {/* A pinned tab's pin, where the X goes: a click unpins it. Both are the mouse's: a tablist holds only tabs, so the
          keyboard closes the tab with Delete (tab:close-focused) and unpins it from its menu. */}
      {tab.pinned ? (
        <button type="button" data-tab-pin data-no-drag tabIndex={-1} aria-hidden aria-label={`Unpin ${own.label}`} data-tip="Unpin tab" onClick={(e) => { e.stopPropagation(); togglePinTab(tab.id) }}
          className="absolute right-1 grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground">
          <Pin className="size-3.5" strokeWidth={2} />
        </button>
      ) : !only && (
        <button type="button" data-tab-close data-no-drag tabIndex={-1} aria-hidden aria-label={`Close ${own.label}`} onClick={(e) => { e.stopPropagation(); close(e) }}
          className={cn("absolute right-1 grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground",
            active || lit ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100")}>
          <X className="size-3.5" strokeWidth={2} />
        </button>
      )}
      {/* (what plugins put on it, on hover, before its X: the label fades under them, so nothing moves) */}
      {buttons.length > 0 && (
        <span data-tab-buttons className={cn("invisible absolute flex gap-0.5 group-hover/tab:visible @max-[140px]/tab:hidden", tab.pinned || !only ? "right-6.5" : "right-1")}>
          {buttons.map((b) => (
            <button key={b.label} type="button" data-no-drag tabIndex={-1} aria-label={b.label} data-tip={b.label} onClick={(e) => { e.stopPropagation(); b.run(e) }}
              className="grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground">
              <b.icon className="size-3.5" strokeWidth={2} />
            </button>
          ))}
        </span>
      )}
      {away && <Undo2 aria-hidden data-tab-return className="pointer-events-none absolute right-1.5 size-3.5 text-muted-foreground" strokeWidth={2} />}
      {/* (along the top: a tab group's line runs under) */}
      {own.color && !split && !(dragging && hole) && <span aria-hidden data-tab-color className="pointer-events-none absolute inset-x-2 top-0 h-[2px] rounded-b-full transition-colors duration-(--motion)" style={{ background: own.color }} />}
    </div>
  )
}

/** A pane's icon, as a tab shows it. */
function PaneIcon({ i, className }: { i: TabInfo; className?: string }) {
  return (
    <Badged on={i.badge}>
      <i.icon className={cn("size-3.5 shrink-0", !i.tint && "text-muted-foreground", i.iconClassName, className)} strokeWidth={2.25} style={i.tint ? { color: i.tint } : undefined} />
    </Badged>
  )
}

/** A tab's (or a split's half's) icon, name and mark. */
function ChipLabel({ i, icons, strong, muted, mark = true, reserve }: { i: TabInfo; icons: boolean; strong: boolean; muted: boolean; mark?: boolean
  /** Its tab has buttons on hover (tabButtons): the label fades before them. */
  reserve?: boolean }) {
  return (
    <>
      {/* (too narrow for both, the mark stands in for the icon: a browser's speaker does) */}
      {icons && <PaneIcon i={i} className={cn(i.mark && mark && "@max-[80px]/tab:hidden")} />}
      {/* Too narrow for more than a letter or two: only the icon (the tooltip has the name). */}
      <span className={cn("min-w-0 flex-1 fade-end", reserve && "group-hover/tab:[--fade-reserve:var(--tab-buttons)]", icons && "@max-[80px]/tab:hidden", strong ? "font-medium text-foreground" : muted ? "text-muted-foreground" : "font-medium text-muted-foreground")}>{i.label}</span>
      {mark && i.mark && <IconAction action={i.mark} className="ml-auto @max-[80px]/tab:ml-0"><i.mark.icon className={cn("size-3.5 shrink-0", !i.mark.tint && "text-muted-foreground")} strokeWidth={2.25} style={i.mark.tint ? { color: i.mark.tint } : undefined} /></IconAction>}
    </>
  )
}

// ---------- what tabs and panes show ----------

const isTab = (x: Tab | Pane): x is Tab => "root" in x

/** What a tab or pane shows: its label and icon, drawn again when a view's plugin says so (viewsChanged). A tab's is its
 *  focused pane's, named as it was named (Rename tab); a split's without a name, its panes' names together. */
export function useTabInfo(store: Store | null, pageInfo: (id: string) => TabInfo | null) {
  const { disabled } = usePrefs()
  useViewsVersion()
  return (t: Tab | Pane): TabInfo => infoOf(t, store, disabled, pageInfo)
}
function infoOf(x: Tab | Pane, store: Store | null, disabled: string[], pageInfo: (id: string) => TabInfo | null): TabInfo {
  if (!isTab(x)) return placeInfo(x, store, disabled, pageInfo)
  const ps = panesOf(x), own = placeInfo(focusedPane(x), store, disabled, pageInfo)
  if (x.name && (ps.length > 1 || !namesItself(ps[0].to, disabled))) return { ...own, label: x.name }
  return ps.length > 1 ? { ...own, label: ps.map((p) => placeInfo(p, store, disabled, pageInfo).label).join(" · ") } : own
}
/** What a place names itself, so a name the tab was given doesn't show: a vault file, a view with a name of its own (a
 *  terminal's session). */
export const namesItself = (to: string, disabled = getPrefs().disabled) =>
  !!vaultPath(to) || (to.startsWith("view:") && !!viewFor(to, disabled)?.def.rename)
function placeInfo(p: Pane, store: Store | null, disabled: string[], pageInfo: (id: string) => TabInfo | null): TabInfo {
  const { to } = p
  if (to === "new") return { label: "New tab", icon: SquareDashed }
  if (to.startsWith("file:")) {
    const path = to.slice(5)
    const f = store?.files.files.find((x) => x.path === path)
    return { label: stem(path), ...fileIcon(path, f?.type ?? null, disabled, f) }
  }
  if (to.startsWith("view:")) return viewInfo(to, disabled, p.id)
  return pageInfo(to) ?? { label: to, icon: FileText }
}

/** A view as it shows in a tab (`view:terminal/abc`): its label, icon and state, as its tab draws them (a pinned one
 *  too); `pane`: the pane's id, for what's that pane's (its icon's action). */
export function viewInfo(to: string, disabled = getPrefs().disabled, pane?: string): TabInfo {
  const v = viewFor(to, disabled)
  return v ? { label: v.def.title(v.arg), icon: v.def.iconFor?.(v.arg, pane) ?? v.def.icon,
    iconClassName: v.on ? v.def.iconClass?.(v.arg) : undefined, tint: v.on ? v.def.iconTint?.(v.arg) : undefined, badge: v.on ? v.def.iconBadge?.(v.arg) : undefined,
    color: v.on ? v.def.tabColor?.(v.arg) : undefined, mark: v.on && pane ? v.def.tabMark?.(v.arg, pane) ?? undefined : undefined }
    : { label: to.slice(5), icon: SquareDashed }
}

/** The app's own pages' names and icons (App's `pageInfo`), for what draws tabs outside the workspace (the Tabs panel). */
let pageInfoOf: (id: string) => TabInfo | null = () => null
export const setPageInfo = (fn: (id: string) => TabInfo | null) => { pageInfoOf = fn }
/** What each tab or pane shows (its label and icon), as the bar does: for plugins (the Tabs panel). */
export const useTabLabels = (store: Store | null) => useTabInfo(store, (id) => pageInfoOf(id))
/** The same outside a render (what the quick switcher finds). */
export const tabLabel = (t: Tab | Pane, store: Store | null) => infoOf(t, store, getPrefs().disabled, pageInfoOf)
/** Its label without the name it was given: what it shows calls itself (a split, its panes together). */
export const shownLabel = (t: Tab, store: Store | null) => panesOf(t).map((p) => placeInfo(p, store, getPrefs().disabled, pageInfoOf).label).join(" · ")
/** A tab's right-click menu, the one its chip has. */
export function tabMenuOf(id: string): MenuItem[] {
  const t = tabById(id)
  return t ? tabMenu(t) : []
}
/** A pane's right-click menu, the one its bar has (a half of a split tab's row). */
export const paneMenuOf = (id: string): MenuItem[] => paneMenu(id)

// ---------- the bars ----------

/** The window's tab bar, across the top of its panes (appearance `tabBar`): a chip per tab, a split tab's panes in one
 *  chip, tab groups' chips before their tabs, + after the last. It never moves when a tab's page is narrower or wider. */
export function TabStrip({ info }: { info: (t: Tab | Pane) => TabInfo }) {
  const l = useTabList(), { tabs, active } = l
  const { fileIcons } = usePrefs()
  useSelectable(TABS, { menu: (ids) => tabsMenu(ids), noun: ["tab", "tabs"] })
  const hit = useDropHit<Drop>(PANES)
  const item = useDragItem()
  // Dragged over it, the tabs make way for what's dragged, in the tab group it would join (its line under it).
  const preview = item ? previewIn(l, item, hit) : null
  const drawn = groupsAsDrawn(preview?.tabs ?? tabs)
  const lineOf = (id: string) => drawn.get(id)
  const row = useRef<HTMLDivElement>(null)
  useSlide(row, preview && [...previewOrder(l, preview), "new"], "x")
  // (after useSlide: a drop's preview is taken off first, so they slide from where it drew them)
  useReflow(row, l)
  useGroupLines(row, "x")
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
    // The window made narrower (a sidebar opened, a divider dragged) keeps it in view too.
    const ro = new ResizeObserver(reveal)
    ro.observe(r)
    return () => ro.disconnect()
  }, [active, tabs.length])
  // Something dragged near either end of the row while it scrolls: it scrolls that way (faster the closer), like the
  // file tree near its edges, so every place in it can take the drop.
  useEffect(() => {
    const r = row.current
    if (!item || !r) return
    const edge = edgeScroller("x")
    const off = onDrag(() => {
      const d = getDrag(), b = r.getBoundingClientRect()
      if (!d || r.scrollWidth <= r.clientWidth || d.y < b.top - 4 || d.y > b.bottom + 4 || d.x < b.left - 8 || d.x > b.right + 8) edge.stop()
      else edge.near(r, d.x)
    })
    return () => { off(); edge.stop() }
  }, [item])
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
    settle.current = window.setTimeout(() => setSettling(false), timing("base").duration + 20)
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
  return (
    <div data-tab-bar data-title-row data-tab-strip onContextMenu={menuFor(barMenu)}
      onPointerDownCapture={(e) => { pointer.current = e.pointerType }} onPointerLeave={() => { if (held) release() }}
      className="group/bar relative flex h-10 shrink-0 items-center gap-1 border-b-[0.5px] border-border bg-background pr-1.5 pl-2">
      {/* Tabs shrink down to their icon and close button, then the row scrolls (a mouse wheel scrolls it sideways),
          keeping the active tab in view. */}
      <div ref={row} data-tab-row data-select-list={TABS} onWheel={(e) => { if (!e.deltaX && e.currentTarget.scrollWidth > e.currentTarget.clientWidth) e.currentTarget.scrollLeft += e.deltaY }}
        className="edge-fade-x relative flex min-w-0 flex-1 items-start gap-1 self-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Only the tabs are the tablist (New tab is beside them, not one); laid out as if it weren't there. */}
        <div role="tablist" aria-label="Open tabs" className="contents">
        {/* (one flat list, so a chip keeps its element as its group folds and opens: its count and line move) */}
        {tabs.flatMap((t, i) => {
          const g = t.group && t.group !== tabs[i - 1]?.group ? l.groups?.find((x) => x.id === t.group) : undefined
          const own = t.group ? l.groups?.find((x) => x.id === t.group) : undefined
          const chip = g && <GroupChip key={`group:${g.id}`} g={g} n={tabs.filter((x) => x.group === g.id).length} target={preview?.into === g.id} />
          if (own?.collapsed) return chip ? [chip] : []
          const it = <TabChip key={t.id} tab={t} hole={!!preview} info={info} active={t.id === active} icons={fileIcons}
            only={tabs.length === 1 && isBlankTab(t)} menu={() => tabMenu(t)} width={held?.width} settling={settling} close={(e) => closeHeld(t, e)}
            line={lineOf(t.id)} />
          return chip ? [chip, it] : [it]
        })}
        </div>
        {/* Right after the last tab (not pinned to the bar's end); its tab opens there, as in a browser. */}
        <button type="button" onClick={() => openNewTab({ at: "end" })} aria-label="New tab" data-ui="button:tab:new" data-tip="New tab" data-slide="new" data-slide-fixed
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
          <Plus className="size-4" strokeWidth={2} />
        </button>
        {/* Where something from elsewhere would open. */}
        {preview?.tabs.some((t) => t.id === INCOMING) && (
          <div aria-hidden data-slide={INCOMING} data-line-of={lineOf(INCOMING)} className="pointer-events-none absolute left-0 h-7 rounded-[6px] bg-foreground/[0.06] ring-[0.5px] ring-border" />
        )}
      </div>
    </div>
  )
}

/** A zoomed pane's unzoom or a floating pane's dock, accent-tinted as Rex's, each a click away. */
function PaneState({ id, float, zoomed }: { id: string; float: boolean; zoomed: boolean }) {
  const zoomKeys = useCommandKeys("pane:zoom", true), floatKeys = useCommandKeys("pane:float", true)
  if (!zoomed && !float) return null
  const Icon = zoomed ? Minimize2 : PictureInPicture2, label = zoomed ? "Unzoom pane" : "Dock pane"
  return (
    <button type="button" {...{ [zoomed ? "data-pane-unzoom" : "data-pane-dock"]: id }} aria-label={label} data-tip={`${label}${zoomed ? zoomKeys : floatKeys}`}
      onClick={() => (zoomed ? zoomPane(id) : dockPane(id))}
      className="grid size-6 shrink-0 cursor-pointer place-items-center self-center rounded-full bg-primary/15 text-primary hover:bg-primary/25">
      <Icon className="size-3.5" strokeWidth={2.25} />
    </button>
  )
}

/** A pane's own buttons at its bar's end, the same on every kind of pane: its state (zoomed, floating), its X and its
 *  handle, the last two shown while the pointer is on the bar (`group/bar`; a fading file bar shown: `data-shown`). */
function PaneButtons({ id, tab, several, only, float, zoomed, label }: { id: string; tab: string; several: boolean; only: boolean; float: boolean; zoomed: boolean; label: () => string }) {
  const tabKeys = useCommandKeys("tab:close", true), paneKeys = useCommandKeys("pane:close", true)
  const item = useDragItem()
  const hover = item?.pane === id ? "opacity-100" : "opacity-0 group-hover/bar:opacity-100 group-data-[shown]/bar:opacity-100"
  // (a pane with tabs of its own closes the one it shows, as ⌘W does)
  const stacked = stackOf(id) > 1, what = several && !stacked ? "Close pane" : "Close tab", closeKeys = stacked ? tabKeys : tabKeys || paneKeys
  return (
    <>
      <PaneState id={id} float={float} zoomed={zoomed} />
      {/* Closes the pane (its tab's last: the tab), pinned too (⌘⇧T brings it back). Not the window's only one. */}
      {!only && (
        <button type="button" data-pane-close={id} aria-label={what} data-tip={item ? undefined : `${what}${closeKeys}`}
          onClick={() => (several ? closePane(id) : closeTab(tab))}
          className={cn("grid h-7 w-5 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100", hover)}>
          <X className="size-4" strokeWidth={2} />
        </button>
      )}
      <button type="button" data-pane-handle={id} aria-label="Move this pane" data-tip={item ? undefined : "Drag to move this pane"}
        onPointerDown={(e) => dragPane(e, id, label())}
        className={cn("grid h-7 w-5 shrink-0 cursor-grab place-items-center rounded-[5px] text-muted-foreground transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100", hover)}>
        <GripVertical className="size-4" strokeWidth={2} />
      </button>
    </>
  )
}

/** How pane `id` is drawn now: in the tab on screen beside others ("split", "zoomed", "float"), else "". */
const splitState = (id: string) => {
  const t = shownTab(here()), ps = t ? panesOf(t) : [], p = ps.find((x) => x.id === id)
  return !t || !p || ps.length < 2 ? "" : t.zoom === id ? "zoomed" : p.float ? "float" : "split"
}

/** A pane's buttons at its view's top bar's end (ViewBar, the Browser's) while that bar is its title row (no tab bar nor
 *  titles: its strip folds away) and the tab on screen is split. In the bar's no-drag children, as the window drags it. */
export function PaneControls() {
  const { pane, tab, hidden } = usePane()
  const prefs = usePrefs(), barred = usePaneHasTopBar(pane)
  const state = useSyncExternalStore(onWorkspaceChange, () => (pane && !hidden ? splitState(pane) : ""))
  if (!state || !barred || tabBarOn(prefs) || prefs.paneTitles) return null
  return (
    <div data-pane-controls={pane} onContextMenu={menuFor(() => barMenuOf(pane))} className="flex shrink-0 items-center">
      <PaneButtons id={pane} tab={tab} several only={false} float={state === "float"} zoomed={state === "zoomed"} label={() => tabLabel(paneById(pane) ?? { id: pane, to: "new" }, null).label} />
    </div>
  )
}

/** A pane's bar: what it shows (appearance `paneTitles`) or a thin strip, its handle, its X and its menu. Without the
 *  tab bar or titles, a view's top bar is its title row (index.css), with the pane's menu and buttons (PaneControls). */
export function PaneBar({ pane, tab, focused, info, only, float, zoomed }: { pane: Pane; tab: Tab; focused: boolean; info: (t: Tab | Pane) => TabInfo
  /** The window's only pane: nothing to close. */
  only: boolean
  /** Its state, a button at the bar's end, before its X. */
  float: boolean; zoomed: boolean }) {
  const prefs = usePrefs(), { fileIcons, paneTitles } = prefs, tabBar = tabBarOn(prefs)
  const hasTopBar = usePaneHasTopBar(pane.id), merged = !tabBar && !paneTitles && hasTopBar
  const strip = useRef<HTMLDivElement>(null)
  const id = pane.id
  useEffect(() => {
    const section = strip.current?.parentElement
    if (!merged || !section) return
    const menu = (e: globalThis.MouseEvent) => {
      if (!e.defaultPrevented && (e.target as Element).matches?.("[data-view-bar], [data-view-bar-fill], [data-web-bar]")) menuFor(() => barMenuOf(id))(e as never)
    }
    section.addEventListener("contextmenu", menu)
    return () => section.removeEventListener("contextmenu", menu)
  }, [merged, id])
  const i = info(pane)
  const buttons = <PaneButtons id={id} tab={tab.id} several={panesOf(tab).length > 1} only={only} float={float} zoomed={zoomed} label={() => i.label} />
  const menu = menuFor(() => barMenuOf(id))
  const own = paneWith(tab.root, id), places = own ? placesOf(own) : [pane]
  // (with the tab bar a pane has a bar only in a split: it always shows its own tabs, one or more, as Obsidian's panes;
  // its + opens one among them, but where ⌘T's would go to the list: a pinned tab's, a terminal's)
  if (tabBar) return <PlaceStrip id={id} places={places} focused={focused} info={info} menu={menu} adds={!tab.pinned && !keepsTab(pane.to)}>{buttons}</PlaceStrip>
  if (!paneTitles) {
    return (
      <div ref={strip} data-pane-bar={id} data-title-row data-bare data-merged={merged || undefined} onContextMenu={menu}
        className="group/bar relative flex h-2.5 shrink-0 bg-background pr-1.5">
        {/* In flow, so the drag strip (its first child, index.css) keeps out of the corner padding the toggles sit in. */}
        <div className="h-full min-w-0 flex-1" />
        {/* (merged, they're the view's bar's: PaneControls) */}
        {!merged && <div className="relative z-10 mt-0.5 flex self-start">{buttons}</div>}
      </div>
    )
  }
  return (
    <div ref={strip} data-pane-bar={id} data-title-row onContextMenu={menu}
      className="group/bar relative flex h-10 shrink-0 items-center gap-1 border-b-[0.5px] border-border bg-background pr-1.5 pl-2">
      <div data-pane-title className="flex min-w-0 flex-1 items-center gap-1.5 pl-2 text-[13px]">
        {fileIcons && <PaneIcon i={i} />}
        <span className={cn("min-w-0 truncate font-medium", focused ? "text-foreground" : "text-muted-foreground")}>{i.label}</span>
      </div>
      {buttons}
    </div>
  )
}

/** With the tab bar on, a split's pane has its own tabs (Pane.stack) in a strip, its tab bar: a click shows one, its X
 *  closes it, a press drags it (along the strip, onto a pane, to the tab bar); dragged over, chips make way. */
function PlaceStrip({ id, places, focused, info, menu, adds, children }: { id: string; places: Pane[]; focused: boolean; info: (t: Tab | Pane) => TabInfo
  menu: (e: React.MouseEvent) => void
  /** Its + (a new tab among them). */
  adds: boolean; children: React.ReactNode }) {
  const item = useDragItem(), hit = useDropHit<Drop>(PANES)
  const row = useRef<HTMLDivElement>(null)
  const moving = item?.pane ?? item?.tab ?? item?.to
  const order = moving && hit?.kind === "places" && hit.pane === id ? reorder(places.map((p) => p.id), [moving], hit.index).order : null
  useSlide(row, order && adds ? [...order, "new"] : order, "x")
  return (
    <div data-pane-bar={id} data-title-row data-place-strip={id} onContextMenu={menu}
      className="group/bar relative flex h-10 shrink-0 items-center gap-1 border-b-[0.5px] border-border bg-background pr-1.5 pl-2">
      <div ref={row} data-place-chips className="relative flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {places.map((p) => <PlaceChip key={p.id} p={p} shown={p.id === id} focused={focused} info={info} />)}
        {/* (right after its last tab, as the tab bar's) */}
        {adds && (
          <button type="button" data-place-new={id} data-no-drag data-slide="new" data-slide-fixed aria-label="New tab" data-tip={item ? undefined : "New tab"}
            onClick={() => { selectPane(id); openNewTab() }}
            className="grid size-7 shrink-0 cursor-pointer place-items-center self-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
            <Plus className="size-4" strokeWidth={2} />
          </button>
        )}
        {order?.includes(INCOMING) && <div aria-hidden data-slide={INCOMING} className="pointer-events-none absolute left-0 h-7 w-28 rounded-[6px] bg-foreground/[0.06] ring-[0.5px] ring-border" />}
      </div>
      {children}
    </div>
  )
}

/** One of a pane's own tabs in its strip. */
function PlaceChip({ p, shown, focused, info }: { p: Pane; shown: boolean; focused: boolean; info: (t: Tab | Pane) => TabInfo }) {
  const item = useDragItem()
  const { fileIcons } = usePrefs()
  const i = info(p)
  return (
    <div data-slide={p.id} data-place={p.id} data-ui={`pane:${p.id}`} role="presentation" onContextMenu={menuFor(() => placeMenuOf(p.id))}
      onPointerDown={(e) => startDrag(e, { from: "pane", pane: p.id, to: p.to, label: i.label, place: true })} onClick={() => selectPane(p.id)}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closePane(p.id) } }} data-tip={item ? undefined : i.label} data-tip-trunc
      className={cn("group/tab @container/tab relative flex h-7 min-w-12 max-w-[200px] flex-1 basis-0 cursor-pointer items-center gap-1.5 rounded-[6px] pr-6 pl-2 text-[13px] transition-colors",
        shown ? "bg-card shadow-sm ring-[0.5px] ring-border" : "hover:bg-foreground/[0.05]", item?.pane === p.id && item.place && "opacity-40")}>
      <ChipLabel i={i} icons={fileIcons} strong={shown && focused} muted={!shown} />
      <button type="button" data-place-close={p.id} data-no-drag tabIndex={-1} aria-label={`Close ${i.label}`} onClick={(e) => { e.stopPropagation(); closePane(p.id) }}
        className={cn("absolute right-1 grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground", shown ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100")}>
        <X className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  )
}
