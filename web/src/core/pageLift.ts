// Phones: the bottom bar dragged up (Safari's): the page shrinks after the finger, and let go far or fast enough it
// goes on into its card in the tab list (core/motion.ts carries it on from where it is), else it springs back.
import { onAway } from "@/core/away"
import { haptic } from "@/core/haptics"
import { LIFT_RADIUS, pageRect } from "@/core/motion"
import { openSwitcher } from "@/core/phoneTabs"
import { shootTab } from "@/core/tabShots"

/** How far up (px) or how fast (px/ms) a let-go opens the tab list. */
const FAR = 90, FAST = 0.45

/** Where the page (between the header and the bar) shows at `s` scale, moved by `tx`, `ty`. */
function shown(s: number, tx: number, ty: number) {
  const r = pageRect()
  return new DOMRect(innerWidth / 2 + (r.left - innerWidth / 2) * s + tx, innerHeight + (r.top - innerHeight) * s + ty, r.width * s, r.height * s)
}
/** The card at a drag of `dx`, `dy`: its bottom edge nearly keeps up with the finger, then holds back; it shrinks less and
 *  less as it goes, and leans a little after the finger sideways. */
function pose(dx: number, dy: number) {
  const up = dy < 240 ? dy : 240 + (dy - 240) * 0.35
  return { s: 1 - 0.4 * (1 - Math.exp(-up / 210)), tx: dx * 0.25, ty: -up * 0.72 }
}

/** What moves with the finger, as one card: the header (fixed), the page under it cut to the screen (what's scrolled
 *  past would show above the header and below the bar), and the card's shadow, by one transform about the screen's bottom. */
type Part = { el: HTMLElement; top: number }
function lift(): Part[] {
  const header = document.querySelector<HTMLElement>("[data-phone-header]"), main = document.querySelector<HTMLElement>("#main-scroll > main")
  const bottom = pageRect().bottom, R = LIFT_RADIUS
  document.documentElement.dataset.pageLift = ""
  const ps: Part[] = []
  const shadow = document.createElement("div")
  shadow.dataset.liftShadow = ""
  Object.assign(shadow.style, { position: "fixed", left: "0", top: "0", width: "100%", height: `${bottom}px`, borderRadius: `${R}px`, pointerEvents: "none" })
  document.body.append(shadow)
  ps.push({ el: shadow, top: 0 })
  if (header) {
    header.style.clipPath = `inset(0 round ${R}px ${R}px 0 0)`
    ps.push({ el: header, top: header.getBoundingClientRect().top })
  }
  if (main) {
    const r = main.getBoundingClientRect()
    main.style.clipPath = `inset(${Math.max(0, -r.top)}px 0 ${Math.max(0, r.bottom - bottom)}px 0 round ${R}px)`
    ps.push({ el: main, top: r.top })
  }
  return ps
}
function place(ps: Part[], s: number, tx: number, ty: number, ms = 0) {
  for (const { el, top } of ps) {
    el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2, 0, 0, 1)` : "none"
    el.style.transformOrigin = `50% ${innerHeight - top}px`
    el.style.transform = s === 1 && !tx && !ty ? "" : `translate(${tx}px, ${ty}px) scale(${s})`
  }
}
function clear(ps: Part[]) {
  for (const { el } of ps) {
    if (el.dataset.liftShadow !== undefined) { el.remove(); continue }
    el.style.transition = el.style.transform = el.style.transformOrigin = el.style.clipPath = ""
  }
  delete document.documentElement.dataset.pageLift
}
/** The let-go of a drag isn't a tap on the button under it: the click that may follow is eaten. */
function eatClick() {
  const eat = (c: Event) => { c.stopPropagation(); c.preventDefault() }
  addEventListener("click", eat, { capture: true, once: true })
  setTimeout(() => removeEventListener("click", eat, { capture: true }), 400)
}

/** Watch `bar` (touch-action: none) for an upward drag, unless `off()`. The page lifts only while held: its end is
 *  heard on the window, and an end that never came (the app went away mid-drag) or the next press puts it back. */
export function liftFrom(bar: HTMLElement, off: () => boolean) {
  let g: { id: number; x: number; y: number; on: boolean; ready: boolean; dx: number; dy: number; t: number; v: number; els: Part[] } | null = null
  const to = (p: { s: number; tx: number; ty: number }, els: Part[], ms = 0) => place(els, p.s, p.tx, p.ty, ms)
  const down = (e: PointerEvent) => {
    if (g && e.pointerId !== g.id) up(null)
    if (e.button || g || !bar.contains(e.target as Node) || off() || document.querySelector("dialog[open]")) return
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, ready: false, dx: 0, dy: 0, t: e.timeStamp, v: 0, els: [] }
    // The page's picture, for a drag or for what the press is about to do (the tab list, a new tab, Back): started now,
    // it's usually there by the tap's end.
    void shootTab()
  }
  const move = (e: PointerEvent) => {
    if (!g || e.pointerId !== g.id) return
    const dy = Math.max(0, g.y - e.clientY), dx = Math.abs(e.clientX - g.x)
    if (!g.on) {
      if (dx > 12 && dx > dy) { g = null; return }
      if (dy < 10) return
      g.on = true
      try { bar.setPointerCapture(e.pointerId) } catch { /* not a live pointer */ }
      // The card's picture is of the page as it is, so it's taken before the page moves.
      const me = g
      void shootTab().then(() => { if (g !== me) return; me.ready = true; me.els = lift(); to(pose(me.dx, me.dy), me.els) })
    }
    const dt = Math.max(1, e.timeStamp - g.t)
    g.v = (dy - g.dy) / dt
    g.t = e.timeStamp
    if ((dy > FAR) !== (g.dy > FAR)) haptic("selection")
    g.dy = dy
    g.dx = e.clientX - g.x
    if (g.ready) to(pose(g.dx, dy), g.els)
  }
  /** The finger let go (pointerup), was taken (pointercancel), or is gone without a word (null): the page goes on into
   *  the tab list or back to its place. */
  const up = (e: PointerEvent | null) => {
    if (!g || (e && e.pointerId !== g.id)) return
    const was = g
    g = null
    if (!was.on) return
    if (e) eatClick()
    const go = e?.type === "pointerup" && (was.dy > FAR || (was.v > FAST && was.dy > 24))
    if (go) {
      haptic()
      const p = pose(was.dx, was.dy)
      // The card's picture flies on from here: its shadow goes rather than stay behind.
      for (const { el } of was.els) if (el.dataset.liftShadow !== undefined) Object.assign(el.style, { transition: "opacity 120ms", opacity: "0" })
      void openSwitcher({ page: was.ready ? shown(p.s, p.tx, p.ty) : shown(1, 0, 0), reset: () => clear(was.els) })
      // The tab list's change puts the page back; should that change never run, it's put back anyway.
      setTimeout(() => { if (!g?.on) clear(was.els) }, 1000)
      return
    }
    if (document.hidden) { clear(was.els); return }
    place(was.els, 1, 0, 0, 240)
    setTimeout(() => { if (!g?.on) clear(was.els) }, 260)
  }
  const end = (e: PointerEvent) => up(e)
  // The touch that carried it ended or was taken, and its pointer's end (which comes first) didn't: it's lost.
  const lost = (e: TouchEvent) => { const was = g; if (was && !e.touches.length) setTimeout(() => { if (g === was) up(null) }) }
  const quit = onAway(() => up(null))
  addEventListener("pointerdown", down, true)
  addEventListener("pointermove", move, true)
  addEventListener("pointerup", end, true)
  addEventListener("pointercancel", end, true)
  addEventListener("touchend", lost, true)
  addEventListener("touchcancel", lost, true)
  return () => {
    quit()
    removeEventListener("touchend", lost, true); removeEventListener("touchcancel", lost, true)
    removeEventListener("pointerdown", down, true); removeEventListener("pointermove", move, true)
    removeEventListener("pointerup", end, true); removeEventListener("pointercancel", end, true)
  }
}
