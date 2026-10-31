// Desktop motion (appearance `animation`, the CSS tokens in index.css): one timing for Web Animations and CSS alike.
import { getPrefs } from "@/core/prefs"

export type Pace = "fast" | "base" | "spring"

/** Whether things move: animations are on, the system doesn't ask for less motion, and Web Animations are there. */
export function moves() {
  if (typeof document === "undefined" || typeof document.documentElement.animate !== "function") return false
  return getPrefs().animation !== "off" && !matchMedia("(prefers-reduced-motion: reduce)").matches
}

const SPRING = "linear(0, 0.0155, 0.056, 0.1138, 0.1826, 0.2575, 0.3347, 0.4113, 0.4852, 0.5549, 0.6195, 0.6783, 0.7312, 0.7782, 0.8193, 0.855, 0.8856, 0.9115, 0.9331, 0.9511, 0.9657, 0.9774, 0.9867, 0.9938, 0.9992, 1.0031, 1.0059, 1.0076, 1.0086, 1.0089, 1.0088, 1.0084, 1.0077, 1.0069, 1.0059, 1.0049, 1.0038, 1.0028, 1.0018, 1.0009, 1)"
const OUT = "cubic-bezier(0.2, 0, 0, 1)"
const PACES = {
  natural: { fast: [140, OUT], base: [220, OUT], spring: [295, SPRING] },
  snappy: { fast: [90, OUT], base: [150, OUT], spring: [200, OUT] },
} as const

/** A Web Animation's duration and easing for `pace` (duration 0 when nothing moves). */
export function timing(pace: Pace = "base"): { duration: number; easing: string } {
  if (!moves()) return { duration: 0, easing: "linear" }
  const [duration, easing] = PACES[getPrefs().animation === "snappy" ? "snappy" : "natural"][pace]
  return { duration, easing }
}

/** FLIP: `el` was at `from` and is now laid out where it goes; it moves (and scales) from there to its place. */
export function slideFrom(el: HTMLElement, from: DOMRect, pace: Pace = "spring", scale = false) {
  const t = timing(pace)
  if (!t.duration) return null
  const to = el.getBoundingClientRect()
  const dx = from.left - to.left, dy = from.top - to.top
  const sx = scale && to.width ? from.width / to.width : 1, sy = scale && to.height ? from.height / to.height : 1
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) return null
  return el.animate([{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: "0 0", transform: "none" }], t)
}
