import { dragElsewhere, getDrag, onDrag, pastEdge, setCovered, setOutsideDrop, type DragItem } from "@/core/drag"
import { PANES, placeAt, type Drop } from "@/core/drop"
import { raiseWindow } from "@/core/desktop"
import { clean, focusedPane, panesOf, type Tab } from "../../../core/layout.ts"
import { isDesktop } from "@/core/platform"
import { paneToTab, takeTabs } from "@/core/splits"
import { trackSoon } from "@/core/unsaved"
import { here, isPopout, openedWindows, paneById, paneTab, popOut, tabById, tabCount, takeOut } from "@/core/workspace"

const MESSAGE = "vaultite:tabs"
type Handoff = { type: typeof MESSAGE; tabs: Tab[]; active: string; at?: { x: number; y: number } }
const HOVER = "vaultite:tabs-over"
type Hover = { type: typeof HOVER; at: { x: number; y: number } | null; item?: DragItem }
const RAISE_MS = 350

declare global { interface Window { vaultiteWindows?: () => [string, Window][] } }

function mainWindow(): Window | null {
  let w = window.opener as Window | null
  try {
    while (w && !w.closed && new URLSearchParams(w.location.search).has("popout")) w = w.opener as Window | null
    return w && !w.closed ? w : null
  } catch { return null }
}
export const hasMainWindow = () => isPopout() && !!mainWindow()

type Peer = { w: Window; pid: string | null }
function peers(): Peer[] {
  const main = isPopout() ? mainWindow() : window
  if (!main) return []
  const all: Peer[] = [{ w: main, pid: null }], seen = new Set<Window>([main])
  for (let i = 0; i < all.length; i++) {
    let more: [string, Window][] = []
    try { more = all[i].w.vaultiteWindows?.() ?? [] } catch { /* closing */ }
    for (const [pid, w] of more) if (!seen.has(w) && !w.closed) { seen.add(w); all.push({ w, pid }) }
  }
  return all.filter((p) => p.w !== window && !p.w.closed)
}

const over = (w: Window, at: { x: number; y: number }, margin = 0) =>
  at.x >= w.screenX - margin && at.x < w.screenX + w.outerWidth + margin && at.y >= w.screenY - margin && at.y < w.screenY + w.outerHeight + margin
const toPage = (at: { x: number; y: number }) => ({ x: at.x - screenX, y: at.y - screenY - (outerHeight - innerHeight) })

// A page sees where windows are, not their stacking order: the smallest is taken as on top.
function peerAt(at: { x: number; y: number }, front: Window): Peer | null {
  const under = peers().filter((p) => over(p.w, at))
  return under.find((p) => p.w === front) ?? under.sort((a, b) => a.w.outerWidth * a.w.outerHeight - b.w.outerWidth * b.w.outerHeight)[0] ?? null
}

const tabsOf = (item: DragItem) => item.group ? here().tabs.filter((t) => t.group === item.group).map((t) => t.id)
  : item.tabs?.length ? item.tabs : item.tab ? [item.tab] : item.pane && paneTab(item.pane) ? [paneTab(item.pane)!.id] : []
function lone(item: DragItem) {
  const t = item.pane ? paneTab(item.pane) : undefined
  if (t && panesOf(t).length > 1) { paneToTab(item.pane!); return [paneTab(item.pane!)!.id] }
  return tabsOf(item)
}
function tearOff(ids: string[], at: { x: number; y: number }) {
  if (over(window, at, 24) || (isPopout() && ids.length >= tabCount())) return false
  popOut(ids, true, at)
  return true
}

function moveTo(to: Peer, ids: string[], at?: { x: number; y: number }) {
  if (to.w.closed || (at && !over(to.w, at))) return false
  const tabs = ids.map(tabById).filter((t): t is Tab => !!t).map(({ group: _, ...t }) => t)
  if (!tabs.length) return false
  const msg: Handoff = { type: MESSAGE, tabs, active: ids.includes(here().active) ? here().active : tabs.at(-1)!.id, at }
  to.w.postMessage(msg, location.origin)
  if (raiseWindow) void raiseWindow(to.pid, true)
  else to.w.focus()
  takeOut(tabs.map((t) => t.id))
  return true
}

export function moveToMain(ids: string[], at?: { x: number; y: number }) {
  const main = isPopout() ? mainWindow() : null
  return !!main && moveTo({ w: main, pid: null }, ids, at)
}

function standIn(item: DragItem): DragItem | null {
  const pane = item.pane ? paneById(item.pane) : undefined
  const tos = pane ? [pane.to] : tabsOf(item).map(tabById).filter((t): t is Tab => !!t).map((t) => focusedPane(t).to)
  return tos.length ? { from: "tab", to: tos[0], ...(tos.length > 1 ? { tos } : {}), elsewhere: true } : null
}

const placeOf = (d: Drop) => d.kind === "list" ? { index: d.index, group: d.group } : { pane: d.pane, zone: d.kind === "pane" ? d.zone : "center" as const }
const takesTabs = (target: string) => target === PANES || target.startsWith("tabs:list:")

if (typeof window !== "undefined") {
  window.vaultiteWindows = openedWindows
  const self: Peer = { w: window, pid: new URLSearchParams(location.search).get("popout") }
  const held: { over: Peer | null; front: Window; want: Window | null; timer: number } = { over: null, front: window, want: null, timer: 0 }
  trackSoon("a window coming forward", () => held.want !== null)
  const raiseSoon = (p: Peer | null) => {
    if (p && p.w === held.want) return
    clearTimeout(held.timer)
    held.want = p && p.w !== held.front ? p.w : null
    if (!held.want || !raiseWindow) return
    held.timer = window.setTimeout(() => {
      if (!getDrag() || held.want !== p!.w) return
      held.front = p!.w
      held.want = null
      void raiseWindow!(p!.pid, false)
    }, RAISE_MS)
  }

  setOutsideDrop((item, at) => {
    if (!isDesktop() || !tabsOf(item).length) return false
    const to = peerAt(at, held.front)
    if (to && moveTo(to, lone(item), at)) return true
    if (over(window, at, 24)) return false
    const ids = lone(item)
    return ids.length > 0 && tearOff(ids, at)
  })

  setCovered((x, y) => held.front !== window && !held.front.closed && over(held.front, { x: x + screenX, y: y + screenY + outerHeight - innerHeight }))

  let pointer = { x: 0, y: 0 }
  addEventListener("pointermove", (e) => { pointer = { x: e.screenX, y: e.screenY } }, true)
  const tell = (p: Peer, msg: Hover) => { try { p.w.postMessage(msg, location.origin) } catch { /* closed */ } }
  onDrag(() => {
    const d = getDrag()
    if (d?.item.elsewhere) return
    const out = !!d && pastEdge(d.x, d.y, d.finger)
    const peer = out && isDesktop() ? peerAt(pointer, held.front) : null
    const item = peer ? standIn(d!.item) : null
    if (held.over && held.over.w !== (item ? peer!.w : null)) tell(held.over, { type: HOVER, at: null })
    held.over = item ? peer : null
    if (item) tell(peer!, { type: HOVER, at: pointer, item })
    if (!d) { clearTimeout(held.timer); held.want = null; setTimeout(() => { if (!getDrag()) held.front = window }); return }
    raiseSoon(item ? peer : !out ? self : null)
  })

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
    const at = e.data.at, was = at && landing && Date.now() - landing.when < 2000 ? landing : null
    landing = null
    const p = was ? was.drop : at ? (({ x, y }) => placeAt(x, y, document.elementFromPoint(x, y)))(toPage(at)) : null
    takeTabs(tabs, e.data.active, p ? placeOf(p) : undefined)
  })
}
