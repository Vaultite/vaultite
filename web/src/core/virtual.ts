// A long list drawn only where it can be seen: the rows in and near what scrolls it, the ones asked to stay (the open
// file's, the keyboard's), and spaces as tall as the rest. A folder of 20k files costs what a screenful does.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"
import { scrollerOf } from "@/core/near"

/** A row drawn, and the space before it (rows not drawn since the last one). */
export type Slot = { index: number; gap: number }
export type Virtual = {
  slots: Slot[]
  /** The space after the last row drawn. */
  rest: number
  /** Where row `i` starts, from the list's top (estimated until it's drawn). */
  top: (i: number) => number
  /** Its height (estimated until drawn). */
  height: (i: number) => number
}

const EMPTY: [number, number] = [0, 0]

/** Which of `keys` (a row each) `list` draws: each drawn row gets `data-vi={index}` (measured), `keep` are drawn wherever
 *  they are, `estimate` is a row's height until one is measured, `overscan` how far past the screen to draw (px). */
export function useVirtual(list: RefObject<HTMLElement | null>, keys: readonly string[], { estimate, keep = [], overscan = 800 }: {
  estimate: number; keep?: readonly (string | null | undefined)[]; overscan?: number
}): Virtual {
  const heights = useRef(new Map<string, number>())
  // A measured row's height stands in for unmeasured ones (density, a phone's rows).
  const [typical, setTypical] = useState(0)
  const [measured, setMeasured] = useState(0)
  const [range, setRange] = useState<[number, number]>(EMPTY)
  const guess = typical || estimate
  const offsets = useMemo(() => {
    const o = new Float64Array(keys.length + 1)
    const h = heights.current
    for (let i = 0; i < keys.length; i++) o[i + 1] = o[i] + (h.get(keys[i]) ?? guess)
    return o
    // (measured: heights changed)
  }, [keys, guess, measured])
  const at = useMemo(() => new Map(keys.map((k, i) => [k, i])), [keys])

  // What's in sight, from what scrolls the list (found once, then the one a scroll comes from) and the list's place.
  const state = useRef({ offsets, scroller: undefined as HTMLElement | null | undefined, frame: 0, soon: () => {} })
  state.current.offsets = offsets
  // (after the commit: a list's own element gets its ref after its rows' layout effects)
  useEffect(() => {
    const el = list.current
    if (!el) return
    const s = state.current
    const look = () => {
      s.frame = 0
      if (!el.isConnected || !el.getClientRects().length) return // hidden (a kept tab): as it was
      if (s.scroller === undefined || (s.scroller && !s.scroller.contains(el))) s.scroller = scrollerOf(el, true)
      const sc = s.scroller
      // (a list that scrolls itself: its rows start above its box by what it has scrolled)
      const top = sc === el ? el.getBoundingClientRect().top - el.scrollTop : el.getBoundingClientRect().top
      const view = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight }
      const from = Math.max(0, view.top) - top - overscan, to = Math.min(innerHeight, view.bottom) - top + overscan
      const o = s.offsets, n = o.length - 1
      const start = Math.max(0, lowest(o, from) - 1), end = Math.min(n, lowest(o, to) + 1)
      setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]))
    }
    const soon = s.soon = () => { if (!s.frame) s.frame = requestAnimationFrame(look) }
    const onScroll = (e: Event) => {
      const t = e.target
      if (t === document) { if (s.scroller) return; soon(); return }
      if (t instanceof HTMLElement && t.contains(el)) { s.scroller = t; soon() }
    }
    // (any scroll: the list may be deep in a sidebar that only some scroll events are from)
    document.addEventListener("scroll", onScroll, { capture: true, passive: true })
    addEventListener("resize", soon)
    const ro = new ResizeObserver(() => { s.scroller = undefined; soon() })
    ro.observe(el)
    look()
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true }); removeEventListener("resize", soon); ro.disconnect()
      cancelAnimationFrame(s.frame); s.frame = 0; s.soon = () => {}
    }
  }, [list, overscan])
  // Other rows (a folder opened) move what's in sight: looked at again once they're drawn.
  useLayoutEffect(() => { state.current.soon() }, [offsets])

  // Rows drawn are measured; a height that differs from what was assumed redraws the spaces.
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    let changed = false, first = 0
    for (const row of el.querySelectorAll<HTMLElement>(":scope > [data-vi]")) {
      const i = Number(row.dataset.vi), k = keys[i]
      const h = row.getBoundingClientRect().height
      if (k === undefined || !h) continue
      first ||= h
      if (heights.current.get(k) !== h) { heights.current.set(k, h); changed = true }
    }
    if (first && !typical) setTypical(first)
    if (changed) setMeasured((m) => m + 1)
  })

  const n = keys.length
  const [start, end] = range[1] > 0 || !n ? range : [0, Math.min(n, Math.ceil(2000 / guess))]
  const drawn = new Set<number>()
  for (let i = start; i < Math.min(end, n); i++) drawn.add(i)
  for (const k of keep) { const i = k == null ? undefined : at.get(k); if (i !== undefined) drawn.add(i) }
  const order = [...drawn].sort((a, b) => a - b)
  const slots: Slot[] = []
  let last = 0
  for (const i of order) { slots.push({ index: i, gap: offsets[i] - last }); last = offsets[i + 1] }
  return { slots, rest: offsets[n] - last, top: (i) => offsets[i], height: (i) => offsets[i + 1] - offsets[i] }
}

/** The first index whose offset is past `y` (offsets ascending). */
function lowest(o: Float64Array, y: number) {
  let lo = 0, hi = o.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (o[mid + 1] <= y) lo = mid + 1; else hi = mid }
  return lo
}
