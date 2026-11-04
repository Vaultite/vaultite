// Phones' tabs, the helpers the bar (components/PhoneBar.tsx) and the tab list (components/TabSwitcher.tsx) share,
// and a split tab's panes swiped between, side by side.
import { flushSync } from "react-dom"
import { folderOf } from "@/core/files"
import { activePane, activeTab, onWorkspaceChange, panes, selectPane, selectTab } from "@/core/workspace"
import { onAway } from "@/core/away"
import { haptic } from "@/core/haptics"
import { fingerHolding } from "@/core/drag"
import { openNewTab, opensSwitcher } from "@/core/launcher"
import { zoomIn, zoomNew, zoomOut } from "@/core/motion"
import { fling, glide, shownAt, stopFor, within } from "@/core/pager"
import { scrollOf } from "@/core/viewstate"
import { afterSheets, closeDetail, replaceHash, route } from "@/core/nav"
import { isPage } from "@/core/pages"
import { panesOf, type Tab } from "../../../core/layout.ts"
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

// ---------- a split tab's panes, side by side ----------

/** The strips along the screen's edges a pane swipe never starts in (px): the drawers' and the browser's. */
const EDGE = 24
/** The gap between a page and the one beside it (px). */
export const PANE_GAP = 20
/** How far a finger goes before its way (sideways or a scroll) is decided. */
const SLOP = 7
const page = () => document.querySelector<HTMLElement>("#main-scroll > main")

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

/** Phones: a split's panes side by side (PhoneFiles.tsx draws the neighbours off the edges), carried 1:1 by a sideways
 *  finger, settling as core/pager.ts says; past the ends they give, and a finger down mid-settle catches them. */
export function swipePanes() {
  type G = { id: number; x: number; y: number; from: number; axis: "x" | "y" | null; lock: number; moves: [number, number][]; quit?: () => void }
  let g: G | null = null
  /** The page's offset (px; negative: the next pane coming in), and the settle on its way there. */
  let pos = 0
  let flight: Animation | null = null
  let m: HTMLElement | null = null
  const ps = () => { const all = panes(); return { all, i: all.findIndex((p) => p.id === activeTab().focus) } }
  const step = () => (m?.offsetWidth || innerWidth) + PANE_GAP
  const put = (x: number) => { pos = x; if (m) m.style.transform = x ? `translateX(${x}px)` : "" }
  /** The panes beside put where they'll show once they're the page: their scroll, at the window's top. */
  const lay = () => {
    if (!m || m.dataset.swiping !== undefined) return
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
    if (!m) return
    put(0)
    delete m.dataset.swiping
    m.style.willChange = ""
  }
  const halt = () => {
    const f = flight
    flight = null
    if (!f || !m) return
    put(shownAt(m))
    f.cancel()
  }
  /** The neighbour `k` (1: the next) is the page now: focused, the window at its place, all in one frame. */
  const land = (k: 1 | -1) => {
    const { all, i } = ps(), next = all[i + k]
    if (next) flushSync(() => { selectPane(next.id) })
    rest()
  }
  /** Settle at `to` (px) from where it is, starting at `v` px/ms; at a neighbour, it's the page then. */
  const settle = (to: number, v = 0) => {
    halt()
    if (!m) return
    const k = to < 0 ? 1 : to > 0 ? -1 : 0
    const a = glide(m, pos, to, v)
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
  }

  const start = (e: TouchEvent) => {
    if (g) return drop()
    if (e.touches.length !== 1 || panes().length < 2 || route().detail || !m) return
    const t = e.touches[0]
    // Caught mid-settle: it stops where it shows, and goes on under the finger.
    if (flight) {
      halt()
      g = { id: t.identifier, x: t.clientX, y: t.clientY, from: pos, axis: "x", lock: t.clientX, moves: [[e.timeStamp, t.clientX]] }
      g.quit = onAway(drop)
      return
    }
    if (t.clientX < EDGE || t.clientX > innerWidth - EDGE) return
    // (a selection being made or adjusted keeps the finger)
    const sel = getSelection()
    if (sel && !sel.isCollapsed && m.contains(sel.anchorNode)) return
    g = { id: t.identifier, x: t.clientX, y: t.clientY, from: pos, axis: null, lock: t.clientX, moves: [[e.timeStamp, t.clientX]] }
  }
  const move = (e: TouchEvent) => {
    const d = g
    if (!d || !m) return
    const t = [...e.changedTouches].find((x) => x.identifier === d.id)
    if (!t) return
    // Held: picked up to be moved (core/drag.ts), not swiped.
    if (fingerHolding()) return drop()
    const mx = t.clientX - d.x, my = t.clientY - d.y
    if (!d.axis) {
      if (Math.hypot(mx, my) < SLOP) return
      if (Math.abs(mx) <= Math.abs(my) * 1.15 || ownsSideways(e.target as Element, m, mx)) { g = null; return }
      d.axis = "x"
      d.lock = t.clientX
      d.quit = onAway(drop)
      lay()
    }
    // Ours now: the page doesn't scroll (iOS can start one in a scroller inside it, whatever touch-action says).
    if (e.cancelable) e.preventDefault()
    d.moves.push([e.timeStamp, t.clientX])
    if (d.moves.length > 8) d.moves.shift()
    const { all, i } = ps(), w = step()
    // (the way decided, the page catches up the slop over the next 48px rather than jumping it)
    const x = d.from + t.clientX - d.x - (d.lock - d.x) * Math.max(0, 1 - Math.abs(t.clientX - d.lock) / 48)
    put(within(x, i < all.length - 1 ? -w : 0, i > 0 ? w : 0, w))
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
    const { all, i } = ps(), w = step()
    const to = stopFor([...(i < all.length - 1 ? [-w] : []), 0, ...(i > 0 ? [w] : [])], pos, v)
    if (to) haptic("selection")
    settle(to, v)
  }

  // Listened to on the page while the tab shown is a split (the page's touchmove waits for this one, so only then).
  const opts = { passive: true }
  const detach = () => {
    if (!m) return
    halt(); g = null; rest()
    m.style.touchAction = ""
    m.removeEventListener("touchstart", start)
    m.removeEventListener("touchmove", move)
    m.removeEventListener("touchend", end)
    m.removeEventListener("touchcancel", end)
    m = null
  }
  const claim = () => {
    const el = page(), on = !!el && panes().length > 1
    if (m && (m !== el || !on)) detach()
    // (the tab or its focus changed under a swipe: it starts again from the page now shown)
    else if (m && !g && !flight && pos) rest()
    if (!on || m) return
    m = el
    // (pans only up and down, so a sideways finger stays ours; pinches still zoom)
    m.style.touchAction = "pan-y pinch-zoom"
    m.addEventListener("touchstart", start, opts)
    m.addEventListener("touchmove", move, { passive: false })
    m.addEventListener("touchend", end, opts)
    m.addEventListener("touchcancel", end, opts)
  }
  const unwatch = onWorkspaceChange(claim)
  claim()
  return () => { unwatch(); detach() }
}
