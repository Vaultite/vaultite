import { moves } from "@/core/animation"
import { spring } from "@/core/motion"
import { getPrefs } from "@/core/prefs"

const FLICK = 0.3

export const band = (over: number, w: number) => Math.sign(over) * (1 - 1 / ((Math.abs(over) * 0.55) / w + 1)) * w
export const within = (x: number, lo: number, hi: number, w: number) => (x < lo ? lo + band(x - lo, w) : x > hi ? hi + band(x - hi, w) : x)

export function fling(moves: [number, number][], now: number) {
  const recent = moves.filter(([t]) => now - t < 100)
  if (recent.length < 2) return 0
  const [t0, x0] = recent[0], [t1, x1] = recent.at(-1)!
  return now - t1 < 50 && t1 > t0 ? (x1 - x0) / (t1 - t0) : 0
}

export function stopFor(stops: number[], at: number, v: number) {
  const s = [...stops].sort((a, b) => a - b)
  if (Math.abs(v) >= FLICK) return v < 0 ? s.filter((x) => x < at - 1).at(-1) ?? s[0] : s.find((x) => x > at + 1) ?? s.at(-1)!
  return s.reduce((a, x) => (Math.abs(x - at) < Math.abs(a - at) ? x : a))
}

export const shownAt = (el: HTMLElement) => new DOMMatrix(getComputedStyle(el).transform).m41

export function glide(el: HTMLElement, from: number, to: number, v = 0, frame?: (x: number) => void): Animation | null {
  el.style.transform = to ? `translateX(${to}px)` : ""
  if (!moves() || Math.abs(to - from) < 0.5) { frame?.(to); return null }
  const response = getPrefs().animation === "snappy" ? 0.24 : 0.34
  const s = spring(response, 1, Math.max(-20, Math.min((2 * Math.PI) / response, (v * 1000) / (to - from))))
  const a = el.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration: s.ms, easing: s.easing })
  const tick = () => {
    if (a.playState !== "running") return
    frame!(from + (to - from) * s.at((Number(a.currentTime) || 0) / 1000))
    requestAnimationFrame(tick)
  }
  if (frame) requestAnimationFrame(tick)
  return a
}
