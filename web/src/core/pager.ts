// What a sideways pager shares (a split's panes, core/phoneTabs.ts; the tab list's workspaces): the give past its ends,
// a let-go's speed, the page it settles on, and the spring that takes it there at the finger's speed.
import { moves } from "@/core/animation"
import { spring } from "@/core/motion"
import { getPrefs } from "@/core/prefs"

/** How fast (px/ms) a let-go goes on that way; slower, it settles on the page most on screen. */
const FLICK = 0.3

/** Past the first or last page, `over` px of finger move it less and less (UIScrollView's rubber band). */
export const band = (over: number, w: number) => Math.sign(over) * (1 - 1 / ((Math.abs(over) * 0.55) / w + 1)) * w
/** Where a finger puts the track at `x` (px) with its pages between `lo` and `hi`, giving past them (`w`: a page). */
export const within = (x: number, lo: number, hi: number, w: number) => (x < lo ? lo + band(x - lo, w) : x > hi ? hi + band(x - hi, w) : x)

/** A let-go's speed (px/ms) from the finger's moves ([time, x], oldest first) at `now`: over their last 100 ms, none if
 *  it had stopped. */
export function fling(moves: [number, number][], now: number) {
  const recent = moves.filter(([t]) => now - t < 100)
  if (recent.length < 2) return 0
  const [t0, x0] = recent[0], [t1, x1] = recent.at(-1)!
  return now - t1 < 50 && t1 > t0 ? (x1 - x0) / (t1 - t0) : 0
}

/** Where a track let go at `at` (px) going `v` px/ms settles, of `stops`: on that way when flicked, else the nearest. */
export function stopFor(stops: number[], at: number, v: number) {
  const s = [...stops].sort((a, b) => a - b)
  if (Math.abs(v) >= FLICK) return v < 0 ? s.filter((x) => x < at - 1).at(-1) ?? s[0] : s.find((x) => x > at + 1) ?? s.at(-1)!
  return s.reduce((a, x) => (Math.abs(x - at) < Math.abs(a - at) ? x : a))
}

/** Where a track shows now (px), mid-glide too. */
export const shownAt = (el: HTMLElement) => new DOMMatrix(getComputedStyle(el).transform).m41

/** Track `el` from `from` to `to` (px, its translateX) on a spring starting at `v` px/ms, the Appearance pace (Snappy
 *  quicker); left at `to`. Null when nothing moves: it's there at once. */
export function glide(el: HTMLElement, from: number, to: number, v = 0): Animation | null {
  el.style.transform = to ? `translateX(${to}px)` : ""
  if (!moves() || Math.abs(to - from) < 0.5) return null
  const response = getPrefs().animation === "snappy" ? 0.24 : 0.34
  // (its start speed as whole distances a second, no faster than settles without overshooting)
  const s = spring(response, 1, Math.max(-20, Math.min((2 * Math.PI) / response, (v * 1000) / (to - from))))
  return el.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration: s.ms, easing: s.easing })
}
