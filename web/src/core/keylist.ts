import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, ArrowUpToLine, CornerDownLeft, FolderClosed, FolderOpen, LogOut, Menu, PanelLeft, PanelRight, SquareArrowOutUpRight, SquareMousePointer, StepBack, StepForward } from "lucide-react"
import { registerCommands, typingIn } from "@/core/commands"
import { byTab, focusPane } from "@/core/focus"
import { isMac, isDesktop } from "@/core/platform"
import { getPrefs, setPrefs } from "@/core/prefs"
import { activePane, panes, setFocusedPane } from "@/core/workspace"
import { focusSide, hasNeighbour } from "@/core/splits"
import { sidebars } from "@/core/plugins"
import { asKeys, getSelection, OWN } from "@/core/select"

const ROW = "[data-keyrow]"

/** The row that has the keyboard, or null. */
export function currentRow(): HTMLElement | null {
  const a = document.activeElement
  return a instanceof HTMLElement ? a.closest<HTMLElement>(ROW) : null
}
/** The keyboard is on a row of a list. */
export const inKeyList = () => !!currentRow()

const scopeOf = (row: HTMLElement) => row.closest<HTMLElement>("[data-sidebar-body]") ?? row.closest<HTMLElement>("[data-keylist]") ?? document.body
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

function toggleOf(row: HTMLElement): { el: HTMLElement; open: boolean } | null {
  if (row.hasAttribute("aria-expanded")) return { el: row, open: row.getAttribute("aria-expanded") === "true" }
  const item = row.parentElement
  if (!item) return null
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
  const up = treeParent(row)
  if (up) focusRow(up)
  return true
}

function treeParent(row: HTMLElement) {
  const level = Number(row.getAttribute("aria-level"))
  const tree = row.getAttribute("role") === "treeitem" ? row.closest("[role=tree]") : null
  if (!tree || !(level > 1)) return null
  const items = [...tree.querySelectorAll<HTMLElement>("[role=treeitem]")]
  for (let i = items.indexOf(row) - 1; i >= 0; i--) if (Number(items[i].getAttribute("aria-level")) < level) return items[i].matches(ROW) ? items[i] : null
  return null
}

/** Do what a click on the row does (`newTab`: as a ⌘-click, opening a file in a new tab). */
export function openInList(newTab = false) {
  const row = currentRow()
  if (!row) return false
  asKeys(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, metaKey: newTab, ctrlKey: newTab && !isMac })))
  return true
}

type Side = "left" | "right"
function sidebarOfFocus(): Side | null {
  const a = document.activeElement
  const body = a instanceof HTMLElement ? a.closest<HTMLElement>("[data-sidebar-body]") : null
  const s = body?.dataset.sidebarBody
  return s === "left" || s === "right" ? s : null
}
const bodyOf = (side: Side) => document.querySelector<HTMLElement>(`[data-sidebar-body="${side}"]`)
const last: Record<Side, HTMLElement | null> = { left: null, right: null }
if (typeof window !== "undefined") {
  addEventListener("focusin", (e) => {
    const r = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(ROW) : null
    const s = r?.closest<HTMLElement>("[data-sidebar-body]")?.dataset.sidebarBody
    if (r && (s === "left" || s === "right")) last[s] = r
  })
}

const isOpen = (side: Side) => (side === "left" ? getPrefs().sidebar : getPrefs().rightSidebar)
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
function activeFileRow(body: HTMLElement) {
  const sel = body.querySelector<HTMLElement>("[role=treeitem][aria-current=page]")
  return sel && sel.getClientRects().length ? sel : null
}

/** Give the keyboard back to the focused pane: its editor or terminal, else nothing (so the page's keys work). */
export function leaveList() {
  if (focusPane(activePane().id)) return
  const a = document.activeElement
  if (a instanceof HTMLElement) a.blur()
}

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

const FOCUSABLE = "a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex], [contenteditable=true]"
const runOf = (row: HTMLElement) => row.closest<HTMLElement>("[data-keylist]") ?? row.closest<HTMLElement>("[data-panel]")
const ofRow = (el: HTMLElement) => !!el.closest(ROW) || !!el.parentElement?.querySelector(`:scope > ${ROW}`)
const tabbable = (root: Element) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
  .filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest("[inert], [data-kept]"))

function tabPastList(back: boolean) {
  const row = currentRow()
  const run = row && runOf(row)
  const rows = run ? rowsIn(run) : []
  if (!rows.length) return false
  tabPast(row!, rows, (el) => run!.contains(el) && ofRow(el), back)
  return true
}
function tabPast(from: HTMLElement, items: HTMLElement[], inRun: (el: HTMLElement) => boolean, back: boolean) {
  const all = tabbable(from.closest("dialog[open], [aria-modal=true]") ?? document.body)
  const edge = back ? items[0] : items[items.length - 1]
  const out = all.filter((el) => !inRun(el))
  const pos = (el: HTMLElement) => edge.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
  const to = back ? out.filter((el) => !pos(el)).at(-1) ?? out.at(-1) : out.find(pos) ?? out[0]
  to?.focus()
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
    if ((e.relatedTarget instanceof Node && run.contains(e.relatedTarget)) || !byTab(e) || el!.matches("input, textarea")) return
    const back = was?.isConnected && was.getClientRects().length ? was : run.querySelector<HTMLElement>(`[aria-selected=true] ${ROW}, ${ROW}[aria-selected=true], ${ROW}[aria-current]:not([aria-current=false])`) ?? r!
    if (back !== el) focusRow(back)
  })
}

const RADIO = "[role=radiogroup] [role=radio]"
const currentRadio = () => { const a = document.activeElement; return a instanceof HTMLElement && a.matches(RADIO) ? a : null }
const groupOf = (r: HTMLElement) => r.closest<HTMLElement>("[role=radiogroup]")!
const radiosIn = (g: HTMLElement) => [...g.querySelectorAll<HTMLElement>("[role=radio]")]
  .filter((r) => groupOf(r) === g && r.getClientRects().length > 0 && !(r as HTMLButtonElement).disabled && !r.closest("[inert]"))

function moveInRadios(by: 1 | -1) {
  const r = currentRadio()
  const all = r ? radiosIn(groupOf(r)) : []
  if (!all.length) return
  all[(all.indexOf(r!) + by + all.length) % all.length].focus()
}
function tabPastRadios(back: boolean) {
  const r = currentRadio()
  const all = r ? radiosIn(groupOf(r)) : []
  if (all.length) tabPast(r!, all, (el) => all.includes(el), back)
}
if (typeof window !== "undefined") {
  addEventListener("focusin", (e) => {
    const el = e.target instanceof HTMLElement && e.target.matches(RADIO) ? e.target : null
    if (!el || !byTab(e)) return
    const g = groupOf(el)
    if (e.relatedTarget instanceof Node && g.contains(e.relatedTarget)) return
    const checked = radiosIn(g).find((r) => r.getAttribute("aria-checked") === "true")
    if (checked && checked !== el) checked.focus()
  })
}

const TAB = "[role=tablist] :is([role=tab], [data-group-chip])"
const currentTab = () => { const a = document.activeElement; return a instanceof HTMLElement && a.matches(TAB) ? a : null }
const barOf = (t: HTMLElement) => t.closest<HTMLElement>("[role=tablist]")!
const tabsIn = (bar: HTMLElement) => [...bar.querySelectorAll<HTMLElement>("[role=tab], [data-group-chip]")].filter((t) => barOf(t) === bar && t.getClientRects().length > 0 && !t.closest("[inert]"))
const ofTabs = (bar: HTMLElement) => (el: HTMLElement) => el.matches("[role=tab], [data-group-chip]") && barOf(el) === bar

function moveInTabs(by: 1 | -1 | "first" | "last") {
  const t = currentTab()
  const all = t ? tabsIn(barOf(t)) : []
  if (!all.length) return
  const i = by === "first" ? 0 : by === "last" ? all.length - 1 : (all.indexOf(t!) + by + all.length) % all.length
  all[i].focus()
}
function tabPastTabs(back: boolean) {
  const t = currentTab()
  if (t) tabPast(t, tabsIn(barOf(t)), ofTabs(barOf(t)), back)
}
if (typeof window !== "undefined") {
  addEventListener("focusin", (e) => {
    const el = e.target instanceof HTMLElement ? e.target : null, bar = el?.closest<HTMLElement>("[role=tablist]")
    if (!el || !bar || !ofTabs(bar)(el) || !byTab(e)) return
    if (e.relatedTarget instanceof HTMLElement && ofTabs(bar)(e.relatedTarget)) return
    const shown = tabsIn(bar).find((t) => t.getAttribute("aria-selected") === "true")
    if (shown && shown !== el) shown.focus()
  })
}

const focused = () => { const a = document.activeElement; return a instanceof HTMLElement && a !== document.body ? a : null }

function openFocusedMenu(tries = 3) {
  const el = focused()
  if (!el) return
  const sel = window.getSelection(), at = el.isContentEditable && sel?.focusNode && el.contains(sel.focusNode) ? sel.focusNode : null
  // CodeMirror given the keyboard back puts its caret back a frame later.
  if (el.isContentEditable && (!at || at === el) && tries > 0) return void requestAnimationFrame(() => openFocusedMenu(tries - 1))
  const target = at ? (at instanceof Element ? at : at.parentElement) ?? el : el
  let caret: DOMRect | undefined
  if (at) { const r = document.createRange(); r.setStart(at, sel!.focusOffset); caret = r.getClientRects()[0] ?? target.getBoundingClientRect() }
  const r = caret ?? el.getBoundingClientRect()
  // Just inside the caret's line: a right-click moves the caret to where it lands.
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window, button: 2,
    clientX: caret ? r.left : r.left + Math.min(r.width, 16), clientY: caret ? r.bottom - 1 : r.bottom }))
}

const madeButton = () => { const el = focused(); return el && !el.matches("button, a[href], input, select, textarea, summary") && el.matches("[role=button], [role=link], [role=tab], [role=menuitem]") && !el.closest(ROW) ? el : null }

type Area = Side | string
function areas(): Area[] {
  const shown = panes().map((p) => p.id).filter((id) => document.querySelector(`[data-pane="${CSS.escape(id)}"]`))
  return [...(isOpen("left") && hasSidebar("left") ? ["left" as const] : []), ...shown, ...(isOpen("right") && hasSidebar("right") ? ["right" as const] : [])]
}
function areaOfFocus(): Area {
  return sidebarOfFocus() ?? document.activeElement?.closest<HTMLElement>("[data-pane]")?.dataset.pane ?? activePane().id
}
function nextArea(by: 1 | -1) {
  const all = areas()
  if (!all.length) return
  const i = all.indexOf(areaOfFocus())
  const to = all[i < 0 ? (by > 0 ? 0 : all.length - 1) : (i + by + all.length) % all.length]
  if (to === "left" || to === "right") return focusSidebar(to)
  focusArea(to)
}
export function focusArea(id = activePane().id) {
  setFocusedPane(id)
  if (focusPane(id)) return
  const pane = document.querySelector<HTMLElement>(`[data-pane="${CSS.escape(id)}"]`)
  ;(pane && tabbable(pane)[0])?.focus()
}

const onRow = () => inKeyList()
const moves = () => onRow() && !document.activeElement?.closest(OWN)
const editableRow = () => { const r = moves() && currentRow(); return !!r && !/^(BUTTON|A)$/.test(r.tagName) && r.getAttribute("role") !== "button" }
registerCommands([
  { id: "list:down", name: "Move down the list", keys: ["ArrowDown"], when: moves, run: () => moveInList(1), icon: ArrowDown },
  { id: "list:up", name: "Move up the list", keys: ["ArrowUp"], when: moves, run: () => moveInList(-1), icon: ArrowUp },
  { id: "list:first", name: "Move to the top of the list", keys: ["Home"], when: moves, run: () => moveInList("first"), icon: ArrowUpToLine },
  { id: "list:last", name: "Move to the bottom of the list", keys: ["End"], when: moves, run: () => moveInList("last"), icon: ArrowDownToLine },
  { id: "list:expand", name: "Open the folder in the list", keys: ["ArrowRight"], when: moves, run: () => foldInList(true), icon: FolderOpen },
  { id: "list:collapse", name: "Close the folder in the list, or go to its parent", keys: ["ArrowLeft"], when: moves, run: () => foldInList(false), icon: FolderClosed },
  { id: "list:open", name: "Open the row", keys: ["Enter"], when: editableRow, run: () => openInList(false), icon: CornerDownLeft },
  { id: "list:open-tab", name: "Open the row in a new tab", keys: ["Mod+Enter"], when: moves, run: () => openInList(true), icon: SquareArrowOutUpRight },
  { id: "list:leave", name: "Leave the sidebar", keys: ["Escape"], when: () => onRow() && !!sidebarOfFocus() && !getSelection(), run: leaveList, icon: LogOut },
  { id: "list:tab-out", name: "Move past the list", keys: ["Tab"], when: () => onRow() && !!runOf(currentRow()!), run: () => tabPastList(false), icon: StepForward },
  { id: "list:tab-back", name: "Move before the list", keys: ["Shift+Tab"], when: () => onRow() && !!runOf(currentRow()!), run: () => tabPastList(true), icon: StepBack },
  { id: "radio:next", name: "Move to the next choice", keys: ["ArrowRight", "ArrowDown"], when: () => !!currentRadio(), run: () => moveInRadios(1), icon: ArrowRight },
  { id: "radio:previous", name: "Move to the previous choice", keys: ["ArrowLeft", "ArrowUp"], when: () => !!currentRadio(), run: () => moveInRadios(-1), icon: ArrowLeft },
  { id: "radio:tab-out", name: "Move past the choices", keys: ["Tab"], when: () => !!currentRadio(), run: () => tabPastRadios(false), icon: StepForward },
  { id: "radio:tab-back", name: "Move before the choices", keys: ["Shift+Tab"], when: () => !!currentRadio(), run: () => tabPastRadios(true), icon: StepBack },
  { id: "tabs:focus-next", name: "Move to the next tab in its bar", keys: ["ArrowRight"], when: () => !!currentTab(), run: () => moveInTabs(1), icon: ArrowRight },
  { id: "tabs:focus-previous", name: "Move to the previous tab in its bar", keys: ["ArrowLeft"], when: () => !!currentTab(), run: () => moveInTabs(-1), icon: ArrowLeft },
  { id: "tabs:focus-first", name: "Move to the first tab in its bar", keys: ["Home"], when: () => !!currentTab(), run: () => moveInTabs("first"), icon: ArrowUpToLine },
  { id: "tabs:focus-last", name: "Move to the last tab in its bar", keys: ["End"], when: () => !!currentTab(), run: () => moveInTabs("last"), icon: ArrowDownToLine },
  { id: "tabs:tab-out", name: "Move past the tabs", keys: ["Tab"], when: () => !!currentTab(), run: () => tabPastTabs(false), icon: StepForward },
  { id: "tabs:tab-back", name: "Move before the tabs", keys: ["Shift+Tab"], when: () => !!currentTab(), run: () => tabPastTabs(true), icon: StepBack },
  // The menu key opens the menu by itself; Macs have none.
  { id: "focus:menu", name: "Open the menu of what has the keyboard", keys: ["Shift+F10"], words: "context menu right-click", when: () => !!focused(),
    keysWhen: () => { const a = document.activeElement; return !typingIn(a) || (a as HTMLElement).isContentEditable },
    run: () => { setTimeout(() => requestAnimationFrame(() => openFocusedMenu())) }, icon: Menu },
  { id: "focus:activate", name: "Press what has the keyboard", keys: ["Enter"], when: () => !!madeButton() && !typingIn(document.activeElement), run: () => madeButton()?.click(), icon: SquareMousePointer },
  { id: "area:next", name: "Focus the next area", keys: ["F6"], desktop: true, run: () => nextArea(1), icon: StepForward },
  { id: "area:previous", name: "Focus the previous area", keys: ["Shift+F6"], desktop: true, run: () => nextArea(-1), icon: StepBack },
  { id: "sidebar:focus-left", name: "Focus the left sidebar", desktop: true, run: () => focusSidebar("left"), icon: PanelLeft },
  { id: "sidebar:focus-right", name: "Focus the right sidebar", desktop: true, when: () => hasSidebar("right"), run: () => focusSidebar("right"), icon: PanelRight },
])
