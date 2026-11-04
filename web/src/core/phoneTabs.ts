// Phones' tabs, the helpers the bar (components/PhoneBar.tsx) and the tab list (components/TabSwitcher.tsx) share,
// and the swipe between a split's panes or the tabs, side by side.
import { flushSync } from "react-dom"
import { folderOf } from "@/core/files"
import { activePane, activeTab, here, onWorkspaceChange, panes, selectPane, selectTab } from "@/core/workspace"
import { onAway } from "@/core/away"
import { haptic } from "@/core/haptics"
import { fingerHolding } from "@/core/drag"
import { openNewTab, opensSwitcher } from "@/core/launcher"
import { zoomIn, zoomNew, zoomOut } from "@/core/motion"
import { fling, glide, shownAt, stopFor, within } from "@/core/pager"
import { scrollOf } from "@/core/viewstate"
import { afterSheets, closeDetail, replaceHash, route } from "@/core/nav"
import { isPage } from "@/core/pages"
import { focusedPane, foldedAway, panesOf, type Pane, type Tab } from "../../../core/layout.ts"
import { cell } from "@/core/signal"
import { share } from "@/core/share"
import { shootTab, shotOf } from "@/core/tabShots"

/** Open the tab list without a history entry of its own (closing tabs in it would leave one pointing at a gone tab):
 *  it replaces the address, and closing replaces it back with whatever tab is active then. */
export async function openSwitcher(from?: { page: DOMRect; reset: () => void }) {
  // A picture of the tab for its card (the iPhone app: core/tabShots.ts, started as the bar was pressed), then the page
  // shrinks into it (core/motion.ts). From a finger dragging the bar up: the page shrinks on from where it left it.
  if (!from) await shootTab()
  zoomOut(() => {
    replaceHash(`${route().tab}/tabs`, { sheet: 0 })
  }, () => cardOf(activeTab()), from?.page, from?.reset)
}

/** What a tab's page zooms out to and back from: its card, or a split's the picture of the pane on screen in it (in a
 *  tab group's card, the tab's). */
const cardOf = (t: Tab) => (panesOf(t).length > 1 && !t.group ? t.focus : t.id)

/** Close the tab list (its Done): the tab on screen grows back out of its card. */
export function closeSwitcher() {
  if (route().detail !== "tabs") return closeDetail()
  zoomIn(cardOf(activeTab()), closeDetail)
}

/** Show a tab picked in the tab list: its card grows into the page. */
export function pickTab(id: string) {
  zoomIn(id, () => afterSheets(() => selectTab(id)))
}
/** Show a split's pane picked in the tab list (its picture on the split's card, or its card on the split's page). */
export function pickPane(id: string) {
  zoomIn(id, () => afterSheets(() => selectPane(id)))
}

/** A new tab (the bar's +, the tab list's: in tab group `group` when one is open), grown out of the button pressed. */
export async function newPhoneTab(button: Element | null, group?: string) {
  // (the switcher picks what it shows: nothing to grow till then)
  if (opensSwitcher()) return afterSheets(() => openNewTab({ group }))
  await shootTab()
  const p = activePane()
  zoomNew(button, () => afterSheets(() => openNewTab({ group })), shotOf(p.id, p.to))
}

/** The line under a tab's name in the switcher: where the file is, or what kind of tab it is. */
export function tabMeta(to: string) {
  if (to === "new") return "Empty"
  if (to.startsWith("file:/")) return "Outside the vault"
  if (to.startsWith("file:")) {
    const p = to.slice(5)
    return isPage(p) ? "Page" : folderOf(p).split("/").filter(Boolean).join(" / ") || (share?.folder ?? "Vault")
  }
  if (to.startsWith("view:")) return "Plugin view"
  return "App"
}

// ---------- side by side: a split's panes (the page swiped), the tabs (the bottom bar swiped, Safari's) ----------

/** The strips along the screen's edges a swipe never starts in (px): the drawers' and the browser's. */
const EDGE = 24
/** The gap between a page and the one beside it (px; index.css's [data-beside]), and how far a finger goes before its
 *  way (sideways or a scroll) is decided. */
const GAP = 20, SLOP = 7
const page = () => document.querySelector<HTMLElement>("#main-scroll > main")

/** What a swipe goes between. */
export type Swipe = "panes" | "tabs"
const swipe = cell<Swipe | null>(null)
/** The swipe under way: what PhoneFiles.tsx draws either side of the page, and PhoneHeader.tsx names. */
export const useSwipe = swipe.use
/** Whether a finger is carrying the page sideways (the bar's drag up, core/pageLift.ts, leaves it then). */
export const swipingSideways = () => sideways
let sideways = false

/** The panes either side of the one shown (-1, 1) for a swipe of `k`, with their tabs: a split's own, or the focused
 *  panes of the tabs either side (those folded away in a group skipped). */
export function besideOf(k: Swipe | null): { pane: Pane; tab: Tab; side: -1 | 1 }[] {
  const l = here(), t = activeTab()
  if (!t) return []
  const near = <T,>(xs: T[], i: number) => ([[xs[i - 1], -1], [xs[i + 1], 1]] as const).filter((x): x is readonly [T, -1 | 1] => i >= 0 && !!x[0])
  if (k === "tabs") {
    const ts = l.tabs.filter((x) => x.id === t.id || !foldedAway(l, x))
    return near(ts, ts.findIndex((x) => x.id === t.id)).map(([x, side]) => ({ pane: focusedPane(x), tab: x, side }))
  }
  const ps = panesOf(t)
  return near(ps, ps.findIndex((p) => p.id === t.focus)).map(([p, side]) => ({ pane: p, tab: t, side }))
}

/** Whether what's under the finger (`el`, in `top`) takes sideways drags (`dx`) itself: a field, a swipeable row (its
 *  touch-action), `data-keeps-touch`, or a scroller that can still scroll that way. */
function ownsSideways(el: Element, top: Element, dx: number) {
  if (el.closest("input, textarea, select, [contenteditable=true]:focus, [data-keeps-touch]")) return true
  for (let a: Element | null = el; a && a !== top; a = a.parentElement) {
    const cs = getComputedStyle(a), ta = cs.touchAction
    if (ta === "none" || (ta.includes("pan-y") && !ta.includes("pan-x"))) return true
    if (/auto|scroll/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 1) {
      if (dx < 0 ? a.scrollLeft + a.clientWidth < a.scrollWidth - 1 : a.scrollLeft > 0) return true
    }
  }
  return false
}

/** Phones: the page and its neighbours carried 1:1 by a finger on the page (a split's panes) or the bar (the tabs),
 *  settling as core/pager.ts says; the header follows (--swipe-next, --swipe-prev). Mid-settle, a finger catches it. */
export function swipeSideways() {
  type G = { id: number; x: number; y: number; from: number; axis: "x" | "y" | null; lock: number; moves: [number, number][]; kind: Swipe; bar: boolean; quit?: () => void }
  let g: G | null = null
  /** The page's offset (px; negative: the next coming in), the settle on its way there, and what it's between. */
  let pos = 0
  let flight: Animation | null = null
  let kind: Swipe = "panes"
  /** The page moved, and the one listened to (a split's, for its panes). */
  let m: HTMLElement | null = null, heard: HTMLElement | null = null
  const step = () => (m?.offsetWidth || innerWidth) + GAP
  const follow = (x: number) => {
    const h = document.querySelector<HTMLElement>("[data-phone-header]"), q = x / step()
    if (!h) return
    h.style.setProperty("--swipe-next", x ? String(Math.min(1, Math.max(0, -q))) : "")
    h.style.setProperty("--swipe-prev", x ? String(Math.min(1, Math.max(0, q))) : "")
  }
  const put = (x: number) => { pos = x; if (m) m.style.transform = x ? `translateX(${x}px)` : ""; follow(x) }
  const ends = () => { const b = besideOf(kind), w = step(); return { lo: b.some((x) => x.side === 1) ? -w : 0, hi: b.some((x) => x.side === -1) ? w : 0 } }
  /** The neighbours drawn (a swipe of tabs draws its own), then put where they'll show once they're the page: their
   *  scroll, at the window's top. */
  const lay = () => {
    if (!m || m.dataset.swiping !== undefined) return
    flushSync(() => swipe.set(kind))
    const r = m.getBoundingClientRect(), cs = getComputedStyle(m), top = parseFloat(cs.paddingTop) || 0, bottom = parseFloat(cs.paddingBottom) || 0
    m.style.setProperty("--beside-top", `${-r.top}px`)
    m.style.setProperty("--beside-h", `${innerHeight}px`)
    for (const b of m.querySelectorAll<HTMLElement>("[data-beside]")) {
      const inner = b.firstElementChild as HTMLElement | null
      const most = Math.max(0, top + (inner?.offsetHeight ?? 0) + bottom - innerHeight)
      b.style.setProperty("--beside-y", `${top - Math.min(most, scrollOf(b.dataset.to ?? ""))}px`)
    }
    m.dataset.swiping = ""
    m.style.willChange = "transform"
  }
  const rest = () => {
    sideways = false
    if (!m) return
    put(0)
    delete m.dataset.swiping
    m.style.willChange = ""
    swipe.set(null)
  }
  const halt = () => {
    const f = flight
    flight = null
    if (!f || !m) return
    put(shownAt(m))
    f.cancel()
  }
  /** The neighbour `k` (1: the next) is the page now: shown, the window at its place, all in one frame. */
  const land = (k: 1 | -1) => {
    const b = besideOf(kind).find((x) => x.side === k)
    if (b) flushSync(() => { if (kind === "tabs") selectTab(b.tab.id); else selectPane(b.pane.id); swipe.set(null) })
    rest()
  }
  /** Settle at `to` (px) from where it is, starting at `v` px/ms; at a neighbour, it's the page then. */
  const settle = (to: number, v = 0) => {
    halt()
    if (!m) return
    const k = to < 0 ? 1 : to > 0 ? -1 : 0
    const a = glide(m, pos, to, v, follow)
    pos = to
    if (!a) return k ? land(k) : rest()
    flight = a
    a.finished.then(() => {
      if (flight !== a) return
      flight = null
      if (k) land(k); else rest()
    }, () => {})
  }
  /** The finger gone without a let-go (the app sent away, a second finger, a hold): the nearest page. */
  const drop = () => {
    const d = g
    g = null
    d?.quit?.()
    if (d?.axis === "x") settle(Math.abs(pos) > step() / 2 ? Math.sign(pos) * step() : 0)
    else sideways = false
  }

  const start = (e: TouchEvent, k: Swipe, bar = k === "tabs") => {
    if (g) return drop()
    const t = e.touches[0]
    if (e.touches.length !== 1 || route().detail || !t) return
    // Caught mid-settle: it stops where it shows, and goes on under the finger (as what it was between).
    if (flight) {
      halt()
      g = { id: t.identifier, x: t.clientX, y: t.clientY, from: pos, axis: "x", lock: t.clientX, moves: [[e.timeStamp, t.clientX]], kind, bar }
      g.quit = onAway(drop)
      sideways = true
      return
    }
    if (!besideOf(k).length || t.clientX < EDGE || t.clientX > innerWidth - EDGE) return
    // (a selection being made or adjusted keeps the finger)
    const sel = getSelection()
    if (k === "panes" && sel && !sel.isCollapsed && heard?.contains(sel.anchorNode)) return
    g = { id: t.identifier, x: t.clientX, y: t.clientY, from: pos, axis: null, lock: t.clientX, moves: [[e.timeStamp, t.clientX]], kind: k, bar }
  }
  const move = (e: TouchEvent, block = true) => {
    const d = g
    if (!d) return
    const t = [...e.changedTouches].find((x) => x.identifier === d.id)
    if (!t) return
    // Held: picked up to be moved (core/drag.ts), not swiped.
    if (fingerHolding()) return drop()
    const mx = t.clientX - d.x, my = t.clientY - d.y
    if (!d.axis) {
      if (Math.hypot(mx, my) < SLOP) return
      // (the bar dragged up is the tab list's, core/pageLift.ts, once it's going)
      const lifting = document.documentElement.dataset.pageLift !== undefined
      if (Math.abs(mx) <= Math.abs(my) * 1.15 || lifting || (d.kind === "panes" && heard && ownsSideways(e.target as Element, heard, mx))) { g = null; return }
      m = page()
      if (!m) { g = null; return }
      d.axis = "x"
      d.lock = t.clientX
      d.quit = onAway(drop)
      kind = d.kind
      sideways = true
      lay()
    }
    // Ours now: the page doesn't scroll (iOS can start one in a scroller inside it, whatever touch-action says).
    if (block && e.cancelable) e.preventDefault()
    d.moves.push([e.timeStamp, t.clientX])
    if (d.moves.length > 8) d.moves.shift()
    const { lo, hi } = ends()
    // (the way decided, the page catches up the slop over the next 48px rather than jumping it)
    const x = d.from + t.clientX - d.x - (d.lock - d.x) * Math.max(0, 1 - Math.abs(t.clientX - d.lock) / 48)
    put(within(x, lo, hi, step()))
  }
  const end = (e: TouchEvent) => {
    const d = g
    if (!d || ![...e.changedTouches].some((x) => x.identifier === d.id)) return
    g = null
    d.quit?.()
    if (d.axis !== "x") return
    // A swipe isn't a tap on what it began on.
    const eat = (c: Event) => { c.stopPropagation(); c.preventDefault() }
    addEventListener("click", eat, { capture: true, once: true })
    setTimeout(() => removeEventListener("click", eat, { capture: true }), 400)
    const v = e.type === "touchend" ? fling(d.moves, e.timeStamp) : 0
    const { lo, hi } = ends()
    const to = stopFor([...(lo ? [lo] : []), 0, ...(hi ? [hi] : [])], pos, v)
    if (to) haptic("selection")
    settle(to, v)
  }

  // The page is listened to while the tab shown is a split (its touchmove waits for this one, so only then).
  const onPage = (e: TouchEvent) => start(e, "panes")
  const onMove = (e: TouchEvent) => move(e)
  const detach = () => {
    if (!heard) return
    if (kind === "panes") { halt(); g = null; rest() }
    heard.style.touchAction = ""
    heard.removeEventListener("touchstart", onPage)
    heard.removeEventListener("touchmove", onMove)
    heard.removeEventListener("touchend", end)
    heard.removeEventListener("touchcancel", end)
    heard = null
  }
  const claim = () => {
    const el = page(), on = !!el && panes().length > 1
    if (heard && (heard !== el || !on)) detach()
    // (the tab or its focus changed under a swipe: it starts again from the page now shown)
    else if (!g && !flight && pos) rest()
    if (!on || heard) return
    heard = el
    // (pans only up and down, so a sideways finger stays ours; pinches still zoom)
    heard.style.touchAction = "pan-y pinch-zoom"
    heard.addEventListener("touchstart", onPage, { passive: true })
    heard.addEventListener("touchmove", onMove, { passive: false })
    heard.addEventListener("touchend", end, { passive: true })
    heard.addEventListener("touchcancel", end, { passive: true })
  }
  // The bar (touch-action none: it never scrolls) is heard on the window; not with its menu or a sheet up.
  const onBar = (e: TouchEvent) => {
    const bar = (e.target as Element | null)?.closest?.("[data-phone-bar]")
    if (bar && (flight || !document.querySelector("dialog[open], #bar-menu"))) start(e, "tabs")
  }
  const barMove = (e: TouchEvent) => { if (g?.bar) move(e, false) }
  const barEnd = (e: TouchEvent) => { if (g?.bar) end(e) }
  addEventListener("touchstart", onBar, { capture: true, passive: true })
  addEventListener("touchmove", barMove, { capture: true, passive: true })
  addEventListener("touchend", barEnd, { capture: true, passive: true })
  addEventListener("touchcancel", barEnd, { capture: true, passive: true })
  const unwatch = onWorkspaceChange(claim)
  claim()
  return () => {
    unwatch(); detach(); halt(); g = null; rest()
    removeEventListener("touchstart", onBar, { capture: true })
    removeEventListener("touchmove", barMove, { capture: true })
    removeEventListener("touchend", barEnd, { capture: true })
    removeEventListener("touchcancel", barEnd, { capture: true })
  }
}
