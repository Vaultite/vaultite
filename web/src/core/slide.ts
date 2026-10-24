// Every list reordered by dragging makes way, as a browser's tabs do (no drop lines): slotAt finds the place, reorder
// what it leaves, useSlide slides the items there. Only transforms, so hits keep being worked out on the layout.
import { useLayoutEffect, type RefObject } from "react"
import { rehit } from "@/core/drag"

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
    // (marked while it does, for what styles or checks it: `[data-drop-preview]`)
    root.toggleAttribute("data-drop-preview", key !== null)
    if (key === null) {
      for (const e of slid(root)) { e.style.transform = ""; e.style.opacity = "" }
      return
    }
    place(root, key.split("\n"), axis)
    // Its width changing meanwhile (a scrollbar coming, a tile fewer to a row): placed again, and the drop asked again.
    let width = root.clientWidth
    const ro = new ResizeObserver(() => {
      if (root.clientWidth === width) return
      width = root.clientWidth
      place(root, key.split("\n"), axis)
      rehit()
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [box, key, axis])
}

const slid = (root: HTMLElement) => [...root.children].filter((e): e is HTMLElement => e instanceof HTMLElement && !!e.dataset.slide)

/** Where `e` is laid out in `root` (its px, as offsetLeft counts), without the slide it has now: to the fraction, as
 *  offsetLeft isn't (a grid's 51.4px columns drifted a pixel a tile). */
function laid(root: HTMLElement, o: DOMRect, k: number, e: HTMLElement) {
  const r = e.getBoundingClientRect(), t = new DOMMatrixReadOnly(getComputedStyle(e).transform)
  return { x: (r.left - o.left) * k - root.clientLeft + root.scrollLeft - t.m41, y: (r.top - o.top) * k - root.clientTop + root.scrollTop - t.m42, w: r.width * k, h: r.height * k }
}

function place(root: HTMLElement, keys: string[], axis: Axis) {
  const els = slid(root)
  const css = getComputedStyle(root)
  const colGap = parseFloat(css.columnGap) || 0, rowGap = parseFloat(css.rowGap) || 0
  const flow = els.filter((e) => getComputedStyle(e).position !== "absolute")
  const own = flow.filter((e) => !e.dataset.slide!.startsWith("set:") && e.dataset.slide !== INCOMING && e.dataset.slideFixed === undefined)
  const byKey = new Map(els.map((e) => [e.dataset.slide!, e]))
  // What comes in takes the room of one of the list's own (an absolutely placed one: across the list too).
  const comes = (e: HTMLElement) => e.dataset.slide === INCOMING || !flow.includes(e)
  const scale = (o: DOMRect) => root.offsetWidth / o.width || 1
  let o = root.getBoundingClientRect()
  const sizes = own.map((e) => laid(root, o, scale(o), e))
  const avg = (f: (b: { w: number; h: number }) => number) => (sizes.length ? sizes.reduce((n, b) => n + f(b), 0) / sizes.length : 0)
  const unit = { w: avg((b) => b.w), h: avg((b) => b.h) }
  for (const id of keys) {
    const e = byKey.get(id)
    if (!e || !comes(e) || e.dataset.slideFixed !== undefined) continue
    if (axis !== "y" && unit.w) e.style.width = `${unit.w}px`
    if (axis !== "x" && unit.h) e.style.height = `${unit.h}px`
  }
  // All read, then all moved: one layout, not one per item.
  o = root.getBoundingClientRect()
  const at = new Map(els.filter((e) => e.offsetParent).map((e) => [e, laid(root, o, scale(o), e)]))
  const start = flow.find((e) => e.dataset.slide !== INCOMING) ?? flow[0]
  const x0 = (start && at.get(start)?.x) ?? 0, y0 = (start && at.get(start)?.y) ?? 0
  const right = root.clientWidth - parseFloat(css.paddingRight)
  let x = x0, y = y0, line = 0
  for (const id of keys) {
    const e = byKey.get(id), b = e && at.get(e)
    // (one not drawn now, as a status bar item left out for room: it takes none)
    if (!e || !b) continue
    const come = comes(e)
    if (axis === "wrap" && x > x0 && x + b.w > right + 0.5) { x = x0; y += line + rowGap; line = 0 }
    // (one that just came in starts where it goes, not sliding in from the list's start or end)
    if (come && !e.style.transform) e.style.transition = "none"
    e.style.transform = axis === "x" ? `translateX(${x - b.x}px)` : axis === "y" ? `translateY(${y - b.y}px)` : `translate(${x - b.x}px, ${y - b.y}px)`
    e.style.opacity = ""
    if (axis === "y") y += b.h + rowGap
    else { x += b.w + colGap; line = Math.max(line, b.h) }
  }
  // (then what came in transitions again, from where it starts)
  if (els.some((e) => e.style.transition === "none")) { void root.offsetWidth; for (const e of els) if (e.style.transition === "none") e.style.transition = "" }
  const shown = new Set(keys)
  for (const e of els) if (!shown.has(e.dataset.slide!)) { e.style.transform = ""; e.style.opacity = "0" }
}
