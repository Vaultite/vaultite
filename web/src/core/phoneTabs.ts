// Phones' tabs, the helpers the bar (components/PhoneBar.tsx) and the tab list (components/TabSwitcher.tsx) share,
// and a split tab's panes swiped between (one shown at a time).
import { flushSync } from "react-dom"
import { folderOf } from "@/core/files"
import { activePane, activeTab, onWorkspaceChange, panes, selectPane, selectTab } from "@/core/workspace"
import { onAway } from "@/core/away"
import { moves } from "@/core/animation"
import { haptic } from "@/core/haptics"
import { fingerHolding } from "@/core/drag"
import { openNewTab, opensSwitcher } from "@/core/launcher"
import { spring, zoomIn, zoomNew, zoomOut } from "@/core/motion"
import { afterSheets, closeDetail, replaceHash, route } from "@/core/nav"
import { isPage } from "@/core/pages"
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
  }, () => activeTab().id, from?.page, from?.reset)
}

/** Close the tab list (its Done): the tab on screen grows back out of its card. */
export function closeSwitcher() {
  if (route().detail !== "tabs") return closeDetail()
  zoomIn(activeTab().id, closeDetail)
}

/** Show a tab picked in the tab list: its card grows into the page. */
export function pickTab(id: string) {
  zoomIn(id, () => afterSheets(() => selectTab(id)))
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

// ---------- a split tab's panes, one at a time ----------

/** The strips along the screen's edges a pane swipe never starts in (px): the drawers' and the browser's. */
const EDGE = 24
/** How far (of the page's width) or how fast (px/ms) a let-go shows the next pane. */
const FAR = 0.3, FAST = 0.5
/** The page settling back, or the next one coming in: no overshoot. */
const SETTLE = spring(0.3, 1)
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

/** Phones: a sideways swipe across the page of a split tab shows its next (or previous) pane, focused, the page
 *  following the finger; past its last (or first) it gives a little and springs back. Returns the unsubscribe. */
export function swipePanes() {
  let g: { id: number; x: number; y: number; axis: "x" | "y" | null; dx: number; t: number; v: number; quit?: () => void } | null = null
  // The page pans only up and down while a split tab is shown, so a sideways finger stays ours.
  const claim = () => { const m = page(); if (m) m.style.touchAction = panes().length > 1 ? "pan-y pinch-zoom" : "" }
  const unwatch = onWorkspaceChange(claim)
  claim()
  const put = (dx: number, ms = 0, fade = 1) => {
    const m = page()
    if (!m) return
    m.style.transition = ms ? `transform ${ms}ms ${SETTLE.easing}, opacity ${ms}ms ${SETTLE.easing}` : "none"
    m.style.transform = dx ? `translateX(${dx}px)` : ""
    m.style.opacity = fade === 1 ? "" : String(fade)
  }
  const drop = () => {
    const d = g
    g = null
    d?.quit?.()
    if (d?.axis === "x") put(0, SETTLE.ms)
  }
  const down = (e: PointerEvent) => {
    if (g && e.pointerId !== g.id) drop()
    if (g || e.pointerType === "mouse" || e.button || !e.isPrimary || panes().length < 2 || route().detail) return
    if (e.clientX < EDGE || e.clientX > innerWidth - EDGE || !page()?.contains(e.target as Node)) return
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null, dx: 0, t: e.timeStamp, v: 0 }
  }
  const move = (e: PointerEvent) => {
    const d = g, m = page()
    if (!d || e.pointerId !== d.id || !m) return
    // Held: picked up to be moved (core/drag.ts), not swiped.
    if (fingerHolding()) return drop()
    const mx = e.clientX - d.x, my = e.clientY - d.y
    if (!d.axis) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.2) {
        if (ownsSideways(e.target as Element, m, mx)) { g = null; return }
        d.axis = "x"
        d.quit = onAway(drop)
      } else if (Math.abs(my) > 10) { g = null; return }
      if (d.axis !== "x") return
    }
    const ps = panes(), i = ps.findIndex((p) => p.id === activeTab().focus)
    // Nothing that way: it gives a little, like a scroller's end.
    const none = (mx < 0 && i >= ps.length - 1) || (mx > 0 && i <= 0)
    const dx = none ? mx / 3 : mx, w = m.offsetWidth || innerWidth
    if (!none && (Math.abs(dx) > w * FAR) !== (Math.abs(d.dx) > w * FAR)) haptic()
    d.v = 0.6 * ((dx - d.dx) / Math.max(1, e.timeStamp - d.t)) + 0.4 * d.v
    d.t = e.timeStamp
    d.dx = dx
    put(dx, 0, 1 - Math.min(0.5, Math.abs(dx) / w / 2))
  }
  const up = (e: PointerEvent) => {
    const d = g, m = page()
    if (!d || e.pointerId !== d.id) return
    g = null
    d.quit?.()
    if (d.axis !== "x" || !m) return
    // A swipe isn't a tap on what it began on.
    const eat = (c: Event) => { c.stopPropagation(); c.preventDefault() }
    addEventListener("click", eat, { capture: true, once: true })
    setTimeout(() => removeEventListener("click", eat, { capture: true }), 400)
    const ps = panes(), i = ps.findIndex((p) => p.id === activeTab().focus)
    const dir = d.dx < 0 ? 1 : -1, next = ps[i + dir], w = m.offsetWidth || innerWidth
    const v = e.timeStamp - d.t > 80 ? 0 : d.v
    const far = Math.abs(d.dx) > w * FAR || (Math.abs(v) > FAST && Math.sign(v) === -dir && Math.abs(d.dx) > 16)
    if (e.type !== "pointerup" || !far || !next) return put(0, SETTLE.ms)
    haptic("selection")
    if (!moves()) { put(0); selectPane(next.id); return }
    // The page goes on off its side, the next pane's comes in from the other, as Back and Forward's do.
    const out = Math.max(90, Math.min(200, (w - Math.abs(d.dx)) / Math.max(0.8, Math.abs(v))))
    put(-dir * w, out, 0.4)
    setTimeout(() => {
      flushSync(() => { selectPane(next.id) })
      put(dir * w * 0.3, 0, 0.4)
      void m.offsetWidth
      put(0, SETTLE.ms)
    }, out)
  }
  addEventListener("pointerdown", down, { capture: true, passive: true })
  addEventListener("pointermove", move, { capture: true, passive: true })
  addEventListener("pointerup", up, { capture: true, passive: true })
  addEventListener("pointercancel", up, { capture: true, passive: true })
  return () => {
    unwatch()
    drop()
    const m = page()
    if (m) { m.style.touchAction = ""; put(0) }
    removeEventListener("pointerdown", down, { capture: true })
    removeEventListener("pointermove", move, { capture: true })
    removeEventListener("pointerup", up, { capture: true })
    removeEventListener("pointercancel", up, { capture: true })
  }
}
