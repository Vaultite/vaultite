// Tabs between windows, as a browser's: dragged out and let go clear of a window, they go on in a new one (core/workspace.ts
// popOut); a pop-out's go back to the main window (a tab's menu, or let go over it) by postMessage, in the app or a browser.
import { setOutsideDrop, type DragItem } from "@/core/drag"
import { placeAt } from "@/core/drop"
import type { Tab } from "../../../core/layout.ts"
import { isDesktop } from "@/core/platform"
import { takeTabs } from "@/core/splits"
import { groupOfTab, groups, isPopout, popOut, tabCount, takeOut } from "@/core/workspace"

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

/** The tabs a drag carries: a pane's, several selected, or one. */
const tabsOf = (item: DragItem) =>
  item.group ? groups().find((g) => g.id === item.group)?.tabs.map((t) => t.id) ?? [] : item.tabs?.length ? item.tabs : item.tab ? [item.tab] : []
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
  const tabs = ids.map((id) => groupOfTab(id)?.tabs.find((t) => t.id === id)).filter((t): t is Tab => !!t)
    .map(({ id, to, back, fwd, pinned }) => ({ id, to, back, fwd, pinned }))
  if (!tabs.length) return false
  const g = groupOfTab(ids[0])!
  const msg: Handoff = { type: MESSAGE, tabs, active: ids.includes(g.active) ? g.active : tabs.at(-1)!.id, at }
  main.postMessage(msg, location.origin)
  main.focus()
  takeOut(tabs.map((t) => t.id))
  return true
}

if (typeof window !== "undefined") {
  setOutsideDrop((item, at) => {
    const ids = tabsOf(item)
    return isDesktop() && ids.length > 0 && ((isPopout() && moveToMain(ids, at)) || tearOff(ids, at))
  })
  if (!isPopout()) {
    addEventListener("message", (e: MessageEvent<Handoff>) => {
      if (e.origin !== location.origin || e.data?.type !== MESSAGE || !Array.isArray(e.data.tabs)) return
      const tabs = e.data.tabs.filter((t) => typeof t?.id === "string" && typeof t.to === "string")
      // The screen point in this window's page (below its title bar and toolbars, if it has them).
      const at = e.data.at
      const x = at ? at.x - screenX : -1, y = at ? at.y - screenY - (outerHeight - innerHeight) : -1
      const p = at ? placeAt(x, y, document.elementFromPoint(x, y)) : null
      takeTabs(tabs, e.data.active, p?.group, p?.where)
    })
  }
}
