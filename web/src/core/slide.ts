// A list's live preview while something is dragged over it: its items slide to where a drop would leave them, as a
// browser's tabs make way. Only transforms, so the layout stays put and hits keep being worked out on it (drop.ts' laidOut).
import { useLayoutEffect, type RefObject } from "react"

/** Slide `box`'s `[data-slide]` items (its children, `box` positioned) into `order`, their keys; those left out fade. An
 *  absolutely placed item (what comes in from elsewhere) is sized like the list's own. Null: all back in place. */
export function useSlide(box: RefObject<HTMLElement | null>, order: string[] | null, axis: "x" | "y") {
  const key = order?.join("\n") ?? null
  useLayoutEffect(() => {
    const root = box.current
    if (!root) return
    const els = [...root.children].filter((e): e is HTMLElement => e instanceof HTMLElement && !!e.dataset.slide)
    if (key === null) {
      for (const e of els) { e.style.transform = ""; e.style.opacity = "" }
      return
    }
    const at = (e: HTMLElement) => (axis === "x" ? e.offsetLeft : e.offsetTop)
    const len = (e: HTMLElement) => (axis === "x" ? e.offsetWidth : e.offsetHeight)
    const css = getComputedStyle(root), gap = parseFloat(axis === "x" ? css.columnGap : css.rowGap) || 0
    const flow = els.filter((e) => getComputedStyle(e).position !== "absolute")
    const own = flow.filter((e) => !e.dataset.slide!.startsWith("set:") && e.dataset.slideFixed === undefined)
    const unit = own.length ? own.reduce((n, e) => n + len(e), 0) / own.length : 0
    const byKey = new Map(els.map((e) => [e.dataset.slide!, e]))
    let pos = flow.length ? at(flow[0]) : 0
    for (const k of key.split("\n")) {
      const e = byKey.get(k)
      if (!e) continue
      const placed = !flow.includes(e)
      if (placed && unit) e.style[axis === "x" ? "width" : "height"] = `${unit}px`
      // (one that just came in starts where it goes, not sliding in from the list's start)
      if (placed && !e.style.transform) e.style.transition = "none"
      e.style.transform = axis === "x" ? `translateX(${pos - at(e)}px)` : `translateY(${pos - at(e)}px)`
      e.style.opacity = ""
      if (placed) { void e.offsetWidth; e.style.transition = "" }
      pos += len(e) + gap
    }
    const shown = new Set(key.split("\n"))
    for (const e of els) if (!shown.has(e.dataset.slide!)) { e.style.transform = ""; e.style.opacity = "0" }
  }, [box, key, axis])
}
