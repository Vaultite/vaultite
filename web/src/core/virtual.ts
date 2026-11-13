import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"
import { flushSync } from "react-dom"
import { scrollerOf } from "@/core/near"

type Slot = { index: number; gap: number }
export type Virtual = {
  slots: Slot[]
  rest: number
  top: (i: number) => number
  height: (i: number) => number
}

const EMPTY: [number, number] = [0, 0]

const lists = new WeakMap<Element, () => Float64Array>()
export const rowOffsets = (list: Element): Float64Array | undefined => lists.get(list)?.()

/** Which of `keys` (a row each) `list` draws: each drawn row gets `data-vi={index}` (measured), `keep` are drawn wherever
 *  they are, `estimate` is a row's height until one is measured, `overscan` how far past the screen to draw (px). */
export function useVirtual(list: RefObject<HTMLElement | null>, keys: readonly string[], { estimate, keep = [], overscan = 800 }: {
  estimate: number; keep?: readonly (string | null | undefined)[]; overscan?: number
}): Virtual {
  const heights = useRef(new Map<string, number>())
  const [typical, setTypical] = useState(0)
  const [measured, setMeasured] = useState(0)
  const [range, setRange] = useState<[number, number]>(EMPTY)
  const guess = typical || estimate
  const offsets = useMemo(() => {
    const o = new Float64Array(keys.length + 1)
    const h = heights.current
    for (let i = 0; i < keys.length; i++) o[i + 1] = o[i] + (h.get(keys[i]) ?? guess)
    return o
  }, [keys, guess, measured])
  const at = useMemo(() => new Map(keys.map((k, i) => [k, i])), [keys])

  const state = useRef<{ offsets: Float64Array; scroller: HTMLElement | null | undefined; frame: number; look: () => void; soon: () => void }>({ offsets, scroller: undefined, frame: 0, look: () => {}, soon: () => {} })
  state.current.offsets = offsets
  // After the commit: React sets the list's ref after its rows' layout effects.
  useEffect(() => {
    const el = list.current
    if (!el) return
    const s = state.current
    let watched: Element | null = null
    const look = s.look = () => {
      cancelAnimationFrame(s.frame); s.frame = 0
      if (!el.isConnected || !el.getClientRects().length) return
      if (s.scroller === undefined || (s.scroller && !s.scroller.contains(el))) s.scroller = scrollerOf(el, true)
      const sc = s.scroller
      if (sc !== watched && sc !== el) { if (watched) ro.unobserve(watched); if (sc) ro.observe(sc); watched = sc }
      const top = sc === el ? el.getBoundingClientRect().top - el.scrollTop : el.getBoundingClientRect().top
      const view = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight }
      const from = Math.max(0, view.top) - top - overscan, to = Math.min(innerHeight, view.bottom) - top + overscan
      const o = s.offsets, n = o.length - 1
      const start = Math.max(0, lowest(o, from) - 1), end = Math.min(n, lowest(o, to) + 1)
      setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]))
    }
    // flushSync in the scroll's frame: a render left to after it shows a frame of empty rows.
    const soon = s.soon = () => { if (!s.frame) s.frame = requestAnimationFrame(() => flushSync(look)) }
    const onScroll = (e: Event) => {
      const t = e.target
      if (t === document) { if (s.scroller) return; soon(); return }
      if (t instanceof HTMLElement && t.contains(el)) { s.scroller = t; soon() }
    }
    // Captured: scroll events don't bubble, and the list may be deep in what scrolls.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true })
    addEventListener("resize", soon)
    const ro = new ResizeObserver(() => { s.scroller = undefined; soon() })
    ro.observe(el)
    lists.set(el, () => s.offsets)
    look()
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true }); removeEventListener("resize", soon); ro.disconnect()
      cancelAnimationFrame(s.frame); s.frame = 0; s.soon = s.look = () => {}
      lists.delete(el)
    }
  }, [list, overscan])
  useLayoutEffect(() => { state.current.look() }, [offsets])

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

function lowest(o: Float64Array, y: number) {
  let lo = 0, hi = o.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (o[mid + 1] <= y) lo = mid + 1; else hi = mid }
  return lo
}
