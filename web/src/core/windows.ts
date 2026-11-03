// Tabs between windows, as a browser's: dragged out and let go clear of a window, they go on in a new one (core/workspace.ts
// popOut); a pop-out's go back to the main window (a tab's menu, or let go over it) by postMessage, in the app or a browser.
import { setOutsideDrop, type DragItem } from "@/core/drag"
import { placeAt } from "@/core/drop"
import { clean, panesOf, type Tab } from "../../../core/layout.ts"
import { isDesktop } from "@/core/platform"
import { paneToTab, takeTabs } from "@/core/splits"
import { here, isPopout, paneTab, popOut, tabById, tabCount, takeOut } from "@/core/workspace"

const MESSAGE = "vaultite:tabs"
type Handoff = { type: typeof MESSAGE; tabs: Tab[]; active: string; at?: { x: number; y: number } }

/** The main window this pop-out came from (through pop-outs opened from pop-outs), while it's open. */
function mainWindow(): Window | null {
  let w = window.opener as Window | null
  try {
    while (w && !w.closed && new URLSearchParams(w.location.search).has("popout")) w = w.opener as Window | null
    return w && !w.closed ? w : null
  } catch { return null } // not ours (another origin)
}
export const hasMainWindow = () => isPopout() && !!mainWindow()

/** Whether screen point `at` is on window `w`, or within `margin` px of it. */
const over = (w: Window, at: { x: number; y: number }, margin = 0) =>
  at.x >= w.screenX - margin && at.x < w.screenX + w.outerWidth + margin && at.y >= w.screenY - margin && at.y < w.screenY + w.outerHeight + margin

/** The tabs a drag carries: a tab group's, several selected, or one; a pane, the tab it's alone in. */
const tabsOf = (item: DragItem) => item.group ? here().tabs.filter((t) => t.group === item.group).map((t) => t.id)
  : item.tabs?.length ? item.tabs : item.tab ? [item.tab] : item.pane && paneTab(item.pane) ? [paneTab(item.pane)!.id] : []
/** A pane of a split let go clear of the window: it becomes a tab of its own first, which then goes. */
function lone(item: DragItem) {
  const t = item.pane ? paneTab(item.pane) : undefined
  if (t && panesOf(t).length > 1) { paneToTab(item.pane!); return [paneTab(item.pane!)!.id] }
  return tabsOf(item)
}
/** Let go clear of the window (not just past its edge, as a slip dragging to the sidebar is): a window of their own
 *  there, unless they're all this pop-out has (that's the window moved, its title bar's job). */
function tearOff(ids: string[], at: { x: number; y: number }) {
  if (over(window, at, 24) || (isPopout() && ids.length >= tabCount())) return false
  popOut(ids, true, at)
  return true
}

/** Move tabs `ids` from this pop-out to the main window, where screen point `at` falls on it (else its focused pane);
 *  not closed, so a terminal's shell goes on. The pop-out closes when it has none left. */
export function moveToMain(ids: string[], at?: { x: number; y: number }) {
  const main = mainWindow()
  if (!main || (at && !over(main, at))) return false
  // (whole, panes and history; out of any tab group, which is this window's)
  const tabs = ids.map(tabById).filter((t): t is Tab => !!t).map(({ group: _, ...t }) => t)
  if (!tabs.length) return false
  const msg: Handoff = { type: MESSAGE, tabs, active: ids.includes(here().active) ? here().active : tabs.at(-1)!.id, at }
  main.postMessage(msg, location.origin)
  main.focus()
  takeOut(tabs.map((t) => t.id))
  return true
}

if (typeof window !== "undefined") {
  setOutsideDrop((item, at) => {
    if (!isDesktop() || !tabsOf(item).length) return false
    if (isPopout() && moveToMain(tabsOf(item), at)) return true
    if (over(window, at, 24)) return false
    const ids = lone(item)
    return ids.length > 0 && tearOff(ids, at)
  })
  if (!isPopout()) {
    addEventListener("message", (e: MessageEvent<Handoff>) => {
      if (e.origin !== location.origin || e.data?.type !== MESSAGE || !Array.isArray(e.data.tabs)) return
      const tabs = clean({ tabs: e.data.tabs, active: e.data.active })?.tabs ?? []
      // The screen point in this window's page (below its title bar and toolbars, if it has them).
      const at = e.data.at
      const x = at ? at.x - screenX : -1, y = at ? at.y - screenY - (outerHeight - innerHeight) : -1
      const p = at ? placeAt(x, y, document.elementFromPoint(x, y)) : null
      takeTabs(tabs, e.data.active, !p ? undefined : p.kind === "list" ? { index: p.index, group: p.group } : { pane: p.pane, zone: p.zone })
    })
  }
}
