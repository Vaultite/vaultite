// Every list reordered by dragging makes way, as a browser's tabs do (no drop lines): slotAt finds the place, reorder
// what it leaves, useSlide slides the items there. Only transforms, so hits keep being worked out on the layout.
import { useLayoutEffect, type RefObject } from "react"

/** Along a row, down a column, or in rows that wrap (tiles, a dock of icons). */
export type Axis = "x" | "y" | "wrap"
/** The key of what comes in from elsewhere: a gap where it would land, drawn by its list (its `[data-slide]` element,
 *  absolutely placed or last in the list; sized like the list's own unless `data-slide-fixed`). */
export const INCOMING = "incoming"

/** The pointer in `box`'s own px, as its children's offsets are (scrolled, maybe zoomed). */
function local(box: HTMLElement, x: number, y: number) {
  const r = box.getBoundingClientRect(), k = box.offsetWidth / r.width || 1
  return { x: (x - r.left) * k - box.clientLeft + box.scrollLeft, y: (y - r.top) * k - box.clientTop + box.scrollTop }
}

/** Where a drag at (x, y) lands among `items` (in order, `box` their offset parent) as laid out, not as slid: before
 *  which (its index; `items.length`, the end). Past one's middle is after it; in rows that wrap, in the pointer's row. */
export function slotAt(box: HTMLElement, items: HTMLElement[], x: number, y: number, axis: Axis) {
  const p = local(box, x, y)
  const past = (e: HTMLElement) => (axis === "y" ? e.offsetTop + e.offsetHeight / 2 < p.y : e.offsetLeft + e.offsetWidth / 2 < p.x)
  if (axis !== "wrap") return items.filter(past).length
  const first = items.findIndex((e) => p.y < e.offsetTop + e.offsetHeight)
  if (first < 0) return items.length
  const top = items[first].offsetTop
  return first + items.slice(first).filter((e) => Math.abs(e.offsetTop - top) < 1 && past(e)).length
}

/** What a drop at slot `index` of `keys` (slotAt) leaves: their `order`, with `moving` there (those not among them come
 *  in as one INCOMING), the key it goes `before` (null: the end), and whether that's how they are already (`same`). */
export function reorder(keys: string[], moving: string[], index: number) {
  const mine = new Set(moving.filter((k) => keys.includes(k)))
  const rest = keys.filter((k) => !mine.has(k))
  const at = index - keys.slice(0, index).filter((k) => mine.has(k)).length
  const come = [...keys.filter((k) => mine.has(k)), ...(mine.size < moving.length ? [INCOMING] : [])]
  const order = [...rest.slice(0, at), ...come, ...rest.slice(at)]
  return { order, before: rest[at] ?? null, same: order.join("\n") === keys.join("\n") }
}

/** Slide `box`'s `[data-slide]` items (its children, `box` positioned) into `order`, their keys; those left out fade.
 *  Null: all back in place. */
export function useSlide(box: RefObject<HTMLElement | null>, order: string[] | null, axis: Axis) {
  const key = order?.join("\n") ?? null
  useLayoutEffect(() => {
    const root = box.current
    if (!root) return
    const els = [...root.children].filter((e): e is HTMLElement => e instanceof HTMLElement && !!e.dataset.slide)
    // (marked while it does, for what styles or checks it: `[data-drop-preview]`)
    root.toggleAttribute("data-drop-preview", key !== null)
    if (key === null) {
      for (const e of els) { e.style.transform = ""; e.style.opacity = "" }
      return
    }
    const css = getComputedStyle(root)
    const colGap = parseFloat(css.columnGap) || 0, rowGap = parseFloat(css.rowGap) || 0
    const flow = els.filter((e) => getComputedStyle(e).position !== "absolute")
    const own = flow.filter((e) => !e.dataset.slide!.startsWith("set:") && e.dataset.slide !== INCOMING && e.dataset.slideFixed === undefined)
    const avg = (f: (e: HTMLElement) => number) => (own.length ? own.reduce((n, e) => n + f(e), 0) / own.length : 0)
    const unit = { w: avg((e) => e.offsetWidth), h: avg((e) => e.offsetHeight) }
    const byKey = new Map(els.map((e) => [e.dataset.slide!, e]))
    const start = flow.find((e) => e.dataset.slide !== INCOMING) ?? flow[0]
    const x0 = start?.offsetLeft ?? 0, y0 = start?.offsetTop ?? 0
    const right = root.clientWidth - parseFloat(css.paddingRight)
    let x = x0, y = y0, line = 0
    for (const k of key.split("\n")) {
      const e = byKey.get(k)
      // (one not drawn now, as a status bar item left out for room: it takes none)
      if (!e || !e.offsetParent) continue
      // What comes in takes the room of one of the list's own (an absolutely placed one: across the list too).
      const come = k === INCOMING || !flow.includes(e)
      if (come && e.dataset.slideFixed === undefined) {
        if (axis !== "y" && unit.w) e.style.width = `${unit.w}px`
        if (axis !== "x" && unit.h) e.style.height = `${unit.h}px`
      }
      const w = e.offsetWidth, h = e.offsetHeight
      if (axis === "wrap" && x > x0 && x + w > right + 0.5) { x = x0; y += line + rowGap; line = 0 }
      // (one that just came in starts where it goes, not sliding in from the list's start or end)
      if (come && !e.style.transform) e.style.transition = "none"
      e.style.transform = axis === "x" ? `translateX(${x - e.offsetLeft}px)` : axis === "y" ? `translateY(${y - e.offsetTop}px)`
        : `translate(${x - e.offsetLeft}px, ${y - e.offsetTop}px)`
      e.style.opacity = ""
      if (come) { void e.offsetWidth; e.style.transition = "" }
      if (axis === "y") y += h + rowGap
      else { x += w + colGap; line = Math.max(line, h) }
    }
    const shown = new Set(key.split("\n"))
    for (const e of els) if (!shown.has(e.dataset.slide!)) { e.style.transform = ""; e.style.opacity = "0" }
  }, [box, key, axis])
}
