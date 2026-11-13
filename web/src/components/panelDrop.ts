import { vaultPath } from "../../../core/layout.ts"
import { filePanelKey, filePanelPath } from "../../../core/sidebars.ts"
import { laidOut, type DragItem } from "@/core/drag"
import { closestOf } from "@/core/dom"
import { panelOfView, sideOf, type Side } from "@/core/plugins"
import { closePane, closeTab } from "@/core/workspace"

const filePanelOf = (to: string | undefined) => { const p = to ? vaultPath(to) : null; return p ? filePanelKey(p) : null }
const singleFileTab = (item: DragItem) => (item.path ? filePanelKey(item.path) : null)

export function draggedPanels(item: DragItem): string[] {
  if (item.from === "panel") return item.panel ? [item.panel] : []
  if (item.from === "tab" || item.from === "pane") {
    const key = panelOfView(item.to) ?? (item.from === "pane" ? filePanelOf(item.to) : singleFileTab(item))
    return key ? [key] : []
  }
  const tos = item.tos ?? (item.to ? [item.to] : item.path && !item.folder ? [`file:${item.path}`] : [])
  return [...new Set(tos.flatMap((to) => filePanelOf(to) ?? []))]
}

export const movesIn = (item: DragItem) => item.from === "tab" || item.from === "pane"

export const bringsFiles = (item: DragItem, keys: string[]) => item.from !== "panel" && keys.some((k) => filePanelPath(k) !== null)

const onHandle = (row: HTMLElement, y: number) => {
  const handle = row.querySelector("[data-panel-handle]"), r = handle && laidOut(handle)
  return !!r && y >= r.top && y <= r.bottom
}
export function betweenPanels(rows: HTMLElement[], y: number) {
  return rows.every((row) => { const r = laidOut(row); return y < r.top || y > r.bottom || onHandle(row, y) })
}

export function closeMovedIn(item: DragItem) {
  if (item.from === "tab" && item.tab) closeTab(item.tab)
  else if (item.from === "pane" && item.pane) closePane(item.pane)
}

export function intoHint(item: DragItem, side: Side) {
  const keys = draggedPanels(item)
  if (movesIn(item)) return `To the ${side} sidebar`
  if (keys.every((k) => sideOf(k) === side)) return undefined
  return item.from === "panel" || keys.some((k) => sideOf(k)) ? `To the ${side} sidebar` : "Show in the sidebar"
}

let pressedPanel: Element | null = null
if (typeof window !== "undefined") addEventListener("pointerdown", (e) => { pressedPanel = closestOf(e.target, "[data-panel]") }, true)

const pinnedPageUnpinsHere = (item: DragItem, sidebar: Element) => item.from === "pin" && !!pressedPanel && sidebar.contains(pressedPanel)
const overItsOwnPanel = (el: Element | null) => !!el && !!pressedPanel && el.closest("[data-panel]") === pressedPanel

export function stillHome(item: DragItem, sidebar: Element, el: Element | null) {
  if (!pressedPanel?.isConnected || item.from === "panel") return false
  return pinnedPageUnpinsHere(item, sidebar) || overItsOwnPanel(el)
}
