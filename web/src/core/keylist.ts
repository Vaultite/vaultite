// Keyboard lists (`data-keylist` of `data-keyrow` rows; a sidebar is one list): arrows, tree folding from
// aria-expanded, Enter clicks. All commands, so hotkeys.json rebinds them and Vim's j/k/h/l call the same functions.
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, CornerDownLeft, FolderClosed, FolderOpen, LogOut, Menu, PanelLeft, PanelRight, SquareArrowOutUpRight, SquareMousePointer, StepBack, StepForward } from "lucide-react"
import { registerCommands, typingIn } from "@/core/commands"
import { leaves } from "@/core/layout"
import { byTab, focusPane } from "@/core/focus"
import { isMac } from "@/core/platform"
import { getPrefs, setPrefs } from "@/core/prefs"
import { focusGroup, getWorkspace, isDesktop } from "@/core/workspace"
import { focusSide, hasNeighbour } from "@/core/splits"
import { sidebars } from "@/core/plugins"
import { asKeys, getSelection } from "@/core/select"

const ROW = "[data-keyrow]"

/** The row that has the keyboard, or null. */
export function currentRow(): HTMLElement | null {
  const a = document.activeElement
  return a instanceof HTMLElement ? a.closest<HTMLElement>(ROW) : null
}
/** The keyboard is on a row of a list. */
export const inKeyList = () => !!currentRow()

/** What a row moves among: its sidebar (every panel), else its list, else the page. */
const scopeOf = (row: HTMLElement) => row.closest<HTMLElement>("[data-sidebar-body]") ?? row.closest<HTMLElement>("[data-keylist]") ?? document.body
/** The rows in sight in a scope, in order (folded folders and panels draw none; hidden ones are left out). */
const rowsIn = (scope: HTMLElement) => [...scope.querySelectorAll<HTMLElement>(ROW)].filter((r) => r.getClientRects().length > 0 && !(r as HTMLButtonElement).disabled)

function focusRow(r: HTMLElement) {
  r.focus({ preventScroll: true })
  r.scrollIntoView({ block: "nearest" })
}

/** Move the keyboard `delta` rows (1 down, -1 up), or to the first or last row. False when it isn't on a row. */
export function moveInList(delta: number | "first" | "last") {
  const row = currentRow()
  if (!row) return false
  const rows = rowsIn(scopeOf(row))
  if (!rows.length) return true
  const i = rows.indexOf(row)
  const j = delta === "first" ? 0 : delta === "last" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, (i < 0 ? 0 : i) + delta))
  focusRow(rows[j])
  return true
}

/** A row's tree item (the file tree's `li`), else the element around it. */
const itemOf = (row: HTMLElement) => row.closest<HTMLElement>("[role=treeitem]") ?? row.parentElement
/** What opens or closes a row's children, and whether they're shown: the row itself (a folder, a group's heading), or
 *  a toggle beside it (a tag's chevron, a search result's lines). Null: it has none. */
function toggleOf(row: HTMLElement): { el: HTMLElement; open: boolean } | null {
  if (row.hasAttribute("aria-expanded")) return { el: row, open: row.getAttribute("aria-expanded") === "true" }
  const item = itemOf(row)
  if (!item) return null
  if (item.getAttribute("role") === "treeitem" && item.hasAttribute("aria-expanded")) return { el: row, open: item.getAttribute("aria-expanded") === "true" }
  const t = item.querySelector<HTMLElement>(":scope > [aria-expanded]")
  return t && t !== row ? { el: t, open: t.getAttribute("aria-expanded") === "true" } : null
}

/** Open (true) or close the row's children, or step into the first child / out to the parent, tree-style; `activate`
 *  opens a leaf on → (Vim's l). False when the keyboard isn't on a row. */
export function foldInList(open: boolean, activate = false) {
  const row = currentRow()
  if (!row) return false
  const t = toggleOf(row)
  if (open) {
    if (t && !t.open) t.el.click()
    else if (t?.open) moveInList(1)
    else if (activate) row.click()
    return true
  }
  if (t?.open) { t.el.click(); return true }
  const parent = itemOf(row)?.parentElement?.closest<HTMLElement>("[role=treeitem]")
  const up = parent?.querySelector<HTMLElement>(ROW)
  if (up) focusRow(up)
  return true
}

/** Do what a click on the row does (`newTab`: as a ⌘-click, opening a file in a new tab). */
export function openInList(newTab = false) {
  const row = currentRow()
  if (!row) return false
  asKeys(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, metaKey: newTab, ctrlKey: newTab && !isMac })))
  return true
}

// ---------- the sidebars ----------
type Side = "left" | "right"
/** The sidebar the keyboard is in, if it is. */
function sidebarOfFocus(): Side | null {
  const a = document.activeElement
  const body = a instanceof HTMLElement ? a.closest<HTMLElement>("[data-sidebar-body]") : null
  const s = body?.dataset.sidebarBody
  return s === "left" || s === "right" ? s : null
}
const bodyOf = (side: Side) => document.querySelector<HTMLElement>(`[data-sidebar-body="${side}"]`)
// The row each sidebar's keyboard was on last.
const last: Record<Side, HTMLElement | null> = { left: null, right: null }
if (typeof window !== "undefined") {
  addEventListener("focusin", (e) => {
    const r = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(ROW) : null
    const s = r?.closest<HTMLElement>("[data-sidebar-body]")?.dataset.sidebarBody
    if (r && (s === "left" || s === "right")) last[s] = r
  })
}

const isOpen = (side: Side) => (side === "left" ? getPrefs().sidebar : getPrefs().rightSidebar)
/** Whether a sidebar has panels to go to (open or folded to its rail). */
const hasSidebar = (side: Side) => sidebars()[side].length > 0

/** Put the keyboard in a sidebar (opening it): on the row it was on last there, else the open file's row in the tree,
 *  else its first row. */
export function focusSidebar(side: Side) {
  if (!isDesktop()) return
  if (!isOpen(side)) setPrefs(side === "left" ? { sidebar: true } : { rightSidebar: true })
  const go = (tries: number) => {
    const body = bodyOf(side)
    const rows = body ? rowsIn(body) : []
    if (!rows.length) { if (tries) requestAnimationFrame(() => go(tries - 1)); return }
    const was = last[side]
    const to = activeFileRow(body!)
    focusRow(was && was.isConnected && rows.includes(was) ? was : to ?? rows[0])
  }
  go(30)
}
/** The tree row of the file in the focused tab, when it's in sight. */
function activeFileRow(body: HTMLElement) {
  const sel = body.querySelector<HTMLElement>("[role=treeitem][aria-selected=true] [data-keyrow]")
  return sel && sel.getClientRects().length ? sel : null
}

/** Give the keyboard back to the focused pane: its editor or terminal, else nothing (so the page's keys work). */
export function leaveList() {
  if (focusPane(getWorkspace().focus)) return
  const a = document.activeElement
  if (a instanceof HTMLElement) a.blur()
}

/** Moving between panes from the keyboard (Focus on the pane to the left...): out of a sidebar back to the pane, past
 *  the last pane on a side into that side's sidebar, else to the pane on that side. Whether it can go that way now. */
export function canGoSide(side: "left" | "right" | "top" | "bottom") {
  const inSide = sidebarOfFocus()
  if (inSide) return (inSide === "left" && side === "right") || (inSide === "right" && side === "left")
  if (hasNeighbour(side)) return true
  return (side === "left" || side === "right") && hasSidebar(side)
}
export function goSide(side: "left" | "right" | "top" | "bottom") {
  const inSide = sidebarOfFocus()
  if (inSide) { if ((inSide === "left" && side === "right") || (inSide === "right" && side === "left")) leaveList(); return }
  if (hasNeighbour(side)) return focusSide(side)
  if (side === "left" || side === "right") focusSidebar(side)
}


// ---------- Tab past a list ----------
// A list is one stop for Tab, as a tree or grid is: Tab and ⇧Tab leave its rows (and a row's own buttons, which its menu
// has), and coming back in lands on the row it was on.
const FOCUSABLE = "a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex], [contenteditable=true]"
/** The rows Tab passes over together: a list's, else a sidebar panel's. */
const runOf = (row: HTMLElement) => row.closest<HTMLElement>("[data-keylist]") ?? row.closest<HTMLElement>("[data-panel]")
/** A row, or a button beside one (the tree's More). */
const ofRow = (el: HTMLElement) => !!el.closest(ROW) || !!el.parentElement?.querySelector(`:scope > ${ROW}`)
const tabbable = (root: Element) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
  .filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest("[inert], [data-kept]"))

/** Move the keyboard past the rows of its list (`back`: before them). False when it isn't on a row of one. */
export function tabPastList(back: boolean) {
  const row = currentRow()
  const run = row && runOf(row)
  const rows = run ? rowsIn(run) : []
  if (!rows.length) return false
  const all = tabbable(row!.closest("dialog[open], [aria-modal=true]") ?? document.body)
  const edge = back ? rows[0] : rows[rows.length - 1]
  const out = all.filter((el) => !(run!.contains(el) && ofRow(el)))
  const pos = (el: HTMLElement) => edge.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
  const to = back ? out.filter((el) => !pos(el)).at(-1) ?? out.at(-1) : out.find(pos) ?? out[0]
  to?.focus()
  return true
}

const lastIn = new WeakMap<HTMLElement, HTMLElement>()
if (typeof window !== "undefined") {
  addEventListener("focusin", (e) => {
    const el = e.target instanceof HTMLElement ? e.target : null
    const r = el?.closest<HTMLElement>(ROW) ?? el?.parentElement?.querySelector<HTMLElement>(`:scope > ${ROW}`)
    const run = r && runOf(r)
    if (!run) return
    const was = lastIn.get(run)
    if (el!.closest(ROW)) lastIn.set(run, r!)
    // Tabbed in from outside: back to its row, else the one that's chosen (the open file's).
    if ((e.relatedTarget instanceof Node && run.contains(e.relatedTarget)) || !byTab(e)) return
    const back = was?.isConnected && was.getClientRects().length ? was : run.querySelector<HTMLElement>(`[aria-selected=true] ${ROW}, ${ROW}[aria-selected=true], ${ROW}[aria-current]:not([aria-current=false])`) ?? r!
    if (back !== el) focusRow(back)
  })
}

// ---------- what has the keyboard ----------
/** What has the keyboard, unless that's nothing. */
const focused = () => { const a = document.activeElement; return a instanceof HTMLElement && a !== document.body ? a : null }

/** Open the menu of what has the keyboard (its right-click), beside it; in an editor, at the cursor. */
export function openFocusedMenu() {
  const el = focused()
  if (!el) return false
  const sel = window.getSelection()
  const caret = el.isContentEditable && sel?.rangeCount ? sel.getRangeAt(0).getClientRects()[0] : null
  const r = caret ?? el.getBoundingClientRect()
  const target = caret && sel?.focusNode ? (sel.focusNode instanceof Element ? sel.focusNode : sel.focusNode.parentElement) ?? el : el
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window, button: 2, clientX: r.left + Math.min(r.width, 16), clientY: r.bottom }))
  return true
}

/** An element drawn as a button or link that isn't one (no Enter of its own). */
const madeButton = () => { const el = focused(); return el && !el.matches("button, a[href], input, select, textarea, summary") && el.matches("[role=button], [role=link], [role=tab], [role=menuitem]") && !el.closest(ROW) ? el : null }

// ---------- the areas: sidebars and panes (F6) ----------
type Area = Side | string
function areas(): Area[] {
  const panes = leaves(getWorkspace().root).map((g) => g.id).filter((id) => document.querySelector(`[data-pane="${CSS.escape(id)}"]`))
  return [...(isOpen("left") && hasSidebar("left") ? ["left" as const] : []), ...panes, ...(isOpen("right") && hasSidebar("right") ? ["right" as const] : [])]
}
function areaOfFocus(): Area {
  return sidebarOfFocus() ?? document.activeElement?.closest<HTMLElement>("[data-pane]")?.dataset.pane ?? getWorkspace().focus
}
/** Move the keyboard to the next area (`by` -1: the one before): the left sidebar, each pane, the right sidebar. */
export function nextArea(by: 1 | -1) {
  const all = areas()
  if (!all.length) return
  const i = all.indexOf(areaOfFocus())
  const to = all[i < 0 ? (by > 0 ? 0 : all.length - 1) : (i + by + all.length) % all.length]
  if (to === "left" || to === "right") return focusSidebar(to)
  focusGroup(to)
  if (focusPane(to)) return
  const pane = document.querySelector<HTMLElement>(`[data-pane="${CSS.escape(to)}"]`)
  ;(pane && tabbable(pane)[0])?.focus()
}

// ---------- the commands ----------
const onRow = () => inKeyList()
const editableRow = () => { const r = currentRow(); return !!r && !/^(BUTTON|A)$/.test(r.tagName) && r.getAttribute("role") !== "button" }
registerCommands([
  { id: "list:down", name: "Move down the list", keys: ["ArrowDown"], when: onRow, run: () => moveInList(1), icon: ArrowDown },
  { id: "list:up", name: "Move up the list", keys: ["ArrowUp"], when: onRow, run: () => moveInList(-1), icon: ArrowUp },
  { id: "list:first", name: "Move to the top of the list", keys: ["Home"], when: onRow, run: () => moveInList("first"), icon: ArrowUpToLine },
  { id: "list:last", name: "Move to the bottom of the list", keys: ["End"], when: onRow, run: () => moveInList("last"), icon: ArrowDownToLine },
  { id: "list:expand", name: "Open the folder in the list", keys: ["ArrowRight"], when: onRow, run: () => foldInList(true), icon: FolderOpen },
  { id: "list:collapse", name: "Close the folder in the list, or go to its parent", keys: ["ArrowLeft"], when: onRow, run: () => foldInList(false), icon: FolderClosed },
  // (Enter on a button or a link clicks it already; a table row needs this.)
  { id: "list:open", name: "Open the row", keys: ["Enter"], when: editableRow, run: () => openInList(false), icon: CornerDownLeft },
  { id: "list:open-tab", name: "Open the row in a new tab", keys: ["Mod+Enter"], when: onRow, run: () => openInList(true), icon: SquareArrowOutUpRight },
  { id: "list:leave", name: "Leave the sidebar", keys: ["Escape"], when: () => onRow() && !!sidebarOfFocus() && !getSelection(), run: leaveList, icon: LogOut },
  { id: "list:tab-out", name: "Move past the list", keys: ["Tab"], when: () => onRow() && !!runOf(currentRow()!), run: () => tabPastList(false), icon: StepForward },
  { id: "list:tab-back", name: "Move before the list", keys: ["Shift+Tab"], when: () => onRow() && !!runOf(currentRow()!), run: () => tabPastList(true), icon: StepBack },
  // (The menu key opens it by itself; Macs have none.)
  { id: "focus:menu", name: "Open the menu of what has the keyboard", keys: ["Shift+F10"], when: () => !!focused(), run: openFocusedMenu, icon: Menu },
  { id: "focus:activate", name: "Press what has the keyboard", keys: ["Enter"], when: () => !!madeButton() && !typingIn(document.activeElement), run: () => madeButton()?.click(), icon: SquareMousePointer },
  { id: "area:next", name: "Focus the next area", keys: ["F6"], desktop: true, run: () => nextArea(1), icon: StepForward },
  { id: "area:previous", name: "Focus the previous area", keys: ["Shift+F6"], desktop: true, run: () => nextArea(-1), icon: StepBack },
  { id: "sidebar:focus-left", name: "Focus the left sidebar", desktop: true, run: () => focusSidebar("left"), icon: PanelLeft },
  { id: "sidebar:focus-right", name: "Focus the right sidebar", desktop: true, when: () => hasSidebar("right"), run: () => focusSidebar("right"), icon: PanelRight },
])
