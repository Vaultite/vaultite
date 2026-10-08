// Phones: the bottom bar dragged up (Safari's): the page shrinks after the finger, and let go far or fast enough it
// goes on into its card in the tab list (core/motion.ts carries it on from where it is), else it springs back.
import { onAway } from "@/core/away"
import { haptic } from "@/core/haptics"
import { pageRect } from "@/core/motion"
import { openSwitcher } from "@/core/phoneTabs"
import { shootTab } from "@/core/tabShots"

/** What moves with the finger: the header (fixed) and the page under it, by one transform about the screen's bottom. */
const parts = () => [document.querySelector<HTMLElement>("[data-phone-header]"), document.querySelector<HTMLElement>("#main-scroll > main")]
  .filter((e): e is HTMLElement => !!e)
/** How far up (px) or how fast (px/ms) a let-go opens the tab list. */
const FAR = 90, FAST = 0.45

/** Where the page (between the header and the bar) shows at `s` scale, `ty` up. */
function shown(s: number, ty: number) {
  const r = pageRect()
  return new DOMRect(innerWidth / 2 + (r.left - innerWidth / 2) * s, innerHeight + (r.top - innerHeight) * s + ty, r.width * s, r.height * s)
}

type Part = { el: HTMLElement; top: number }
function place(ps: Part[], s: number, ty: number, ms = 0) {
  for (const { el, top } of ps) {
    el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2, 0, 0, 1)` : "none"
    el.style.transformOrigin = `50% ${innerHeight - top}px`
    el.style.transform = s === 1 && !ty ? "" : `translateY(${ty}px) scale(${s})`
  }
}
function clear(ps: Part[]) {
  for (const { el } of ps) el.style.transition = el.style.transform = el.style.transformOrigin = ""
  delete document.documentElement.dataset.pageLift
}
/** The let-go of a drag isn't a tap on the button under it: the click that may follow is eaten. */
function eatClick() {
  const eat = (c: Event) => { c.stopPropagation(); c.preventDefault() }
  addEventListener("click", eat, { capture: true, once: true })
  setTimeout(() => removeEventListener("click", eat, { capture: true }), 400)
}

/** Watch `bar` (touch-action: none) for an upward drag, not while `off()`. The page is lifted only while a finger
 *  holds it: its end is heard on the window (where it arrives even if the bar lost the pointer), and a finger whose end
 *  never came (the app went away mid-drag, or only its touch ended) puts it back, as does any next press. */
export function liftFrom(bar: HTMLElement, off: () => boolean) {
  let g: { id: number; x: number; y: number; on: boolean; ready: boolean; dy: number; t: number; v: number; els: Part[] } | null = null
  const scale = (dy: number) => 1 - 0.42 * Math.min(1, dy / (innerHeight * 0.55))
  const down = (e: PointerEvent) => {
    if (g && e.pointerId !== g.id) up(null)
    if (e.button || g || !bar.contains(e.target as Node) || off() || document.querySelector("dialog[open]")) return
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, ready: false, dy: 0, t: e.timeStamp, v: 0, els: [] }
  }
  const move = (e: PointerEvent) => {
    if (!g || e.pointerId !== g.id) return
    const dy = Math.max(0, g.y - e.clientY), dx = Math.abs(e.clientX - g.x)
    if (!g.on) {
      if (dx > 12 && dx > dy) { g = null; return }
      if (dy < 10) return
      g.on = true
      try { bar.setPointerCapture(e.pointerId) } catch { /* not a live pointer */ }
      g.els = parts().map((el) => ({ el, top: el.getBoundingClientRect().top }))
      // The card's picture is of the page as it is, so it's taken before the page moves.
      const me = g
      void shootTab().then(() => { if (g !== me) return; me.ready = true; document.documentElement.dataset.pageLift = ""; place(me.els, scale(me.dy), -me.dy * 0.5) })
    }
    const dt = Math.max(1, e.timeStamp - g.t)
    g.v = (dy - g.dy) / dt
    g.t = e.timeStamp
    if ((dy > FAR) !== (g.dy > FAR)) haptic("selection")
    g.dy = dy
    if (g.ready) place(g.els, scale(dy), -dy * 0.5)
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
      const s = scale(was.dy), ty = -was.dy * 0.5
      void openSwitcher({ page: was.ready ? shown(s, ty) : shown(1, 0), reset: () => clear(was.els) })
      // The tab list's change puts the page back; should that change never run, it's put back anyway.
      setTimeout(() => { if (!g?.on) clear(was.els) }, 1000)
      return
    }
    if (document.hidden) { clear(was.els); return }
    place(was.els, 1, 0, 240)
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
