// Tabs between windows, as a browser's: let go clear of a window, a new one (workspace.ts popOut); a pop-out's go back to
// the main window (a tab's menu, or let go over it, which draws where they'd land: drag.ts' dragElsewhere) by postMessage.
import { dragElsewhere, getDrag, onDrag, setOutsideDrop, type DragItem } from "@/core/drag"
import { PANES, placeAt, type Drop } from "@/core/drop"
import { clean, focusedPane, panesOf, type Tab } from "../../../core/layout.ts"
import { isDesktop } from "@/core/platform"
import { paneToTab, takeTabs } from "@/core/splits"
import { here, isPopout, paneById, paneTab, popOut, tabById, tabCount, takeOut } from "@/core/workspace"

const MESSAGE = "vaultite:tabs"
type Handoff = { type: typeof MESSAGE; tabs: Tab[]; active: string; at?: { x: number; y: number } }
/** A pop-out's drag held over the main window, at a screen point (null: it left, or ended), as what its tabs open. */
const HOVER = "vaultite:tabs-over"
type Hover = { type: typeof HOVER; at: { x: number; y: number } | null; item?: DragItem }

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
/** Screen point `at` in this page (below its title bar and toolbars, if it has them). */
const toPage = (at: { x: number; y: number }) => ({ x: at.x - screenX, y: at.y - screenY - (outerHeight - innerHeight) })

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

/** What the main window is shown of a drag held over it: what it carries opens there (a pane, its own; a tab, its
 *  focused pane's), so its tab list and panes answer it as they would a file. */
function standIn(item: DragItem): DragItem | null {
  const pane = item.pane ? paneById(item.pane) : undefined
  const tos = pane ? [pane.to] : tabsOf(item).map(tabById).filter((t): t is Tab => !!t).map((t) => focusedPane(t).to)
  return tos.length ? { from: "tab", to: tos[0], ...(tos.length > 1 ? { tos } : {}), elsewhere: true } : null
}

/** Where tabs land in the main window: the place its tab list or a pane answered the drag held over it last. */
const placeOf = (d: Drop) => d.kind === "list" ? { index: d.index, group: d.group } : { pane: d.pane, zone: d.kind === "pane" ? d.zone : "center" as const }
/** The workspace's panes and bar, and the Tabs panel's list (plugins/core/tabs: `tabs:list:<id>`): where tabs land. */
const takesTabs = (target: string) => target === PANES || target.startsWith("tabs:list:")

if (typeof window !== "undefined") {
  setOutsideDrop((item, at) => {
    if (!isDesktop() || !tabsOf(item).length) return false
    const main = isPopout() ? mainWindow() : null
    if (main && over(main, at) && moveToMain(lone(item), at)) return true
    if (over(window, at, 24)) return false
    const ids = lone(item)
    return ids.length > 0 && tearOff(ids, at)
  })
  if (isPopout()) {
    // Held past this window's edge over the main window, the main window is told where, each move. (The pointer's
    // screen point as its events say, as a drop's is: before drag.ts hears the move.)
    let told = false, pointer = { x: 0, y: 0 }
    addEventListener("pointermove", (e) => { pointer = { x: e.screenX, y: e.screenY } }, true)
    onDrag(() => {
      const d = getDrag(), main = mainWindow()
      const out = d && !d.finger && (d.x < 0 || d.y < 0 || d.x >= innerWidth || d.y >= innerHeight)
      const at = out ? pointer : null
      const item = at && main && isDesktop() && over(main, at) ? standIn(d!.item) : null
      if (!item && !told) return
      told = !!item
      const msg: Hover = { type: HOVER, at: item ? at : null, ...(item ? { item } : {}) }
      main?.postMessage(msg, location.origin)
    })
  } else {
    // (where the drag held over it would have landed, as it ends: the tabs it hands over, just after, go there)
    let landing: { drop: Drop | null; when: number } | null = null
    addEventListener("message", (e: MessageEvent<Handoff | Hover>) => {
      if (e.origin !== location.origin) return
      if (e.data?.type === HOVER) {
        const { at, item } = e.data
        if (!at || !item) { const hit = dragElsewhere(null); landing = { drop: (hit?.data as Drop | undefined) ?? null, when: Date.now() }; return }
        const p = toPage(at)
        dragElsewhere({ ...item, elsewhere: true }, p.x, p.y, takesTabs)
        landing = null
        return
      }
      if (e.data?.type !== MESSAGE || !Array.isArray(e.data.tabs)) return
      const tabs = clean({ tabs: e.data.tabs, active: e.data.active })?.tabs ?? []
      const at = e.data.at, held = at && landing && Date.now() - landing.when < 2000 ? landing : null
      landing = null
      // (dropped without having been held over it: a browser that moved no pointer past the edge)
      const p = held ? held.drop : at ? (({ x, y }) => placeAt(x, y, document.elementFromPoint(x, y)))(toPage(at)) : null
      takeTabs(tabs, e.data.active, p ? placeOf(p) : undefined)
    })
  }
}
