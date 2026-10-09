// Something heavy (a map: a WebGL context) is made once it comes near the screen, so a long dashboard or a hidden tab
// doesn't make every one. Once made, it stays.
import { useEffect, useRef, useState, type RefObject } from "react"

/** Whether `ref`'s element has come within `margin` of the screen (of what scrolls it); stays true after. */
export function useNearScreen(ref: RefObject<Element | null>, margin = "600px"): boolean {
  // (without IntersectionObserver: at once)
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined")
  useEffect(() => {
    const el = ref.current
    if (near || !el) return
    const o = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); o.disconnect() } }, { rootMargin: margin })
    o.observe(el)
    return () => o.disconnect()
  }, [ref, near, margin])
  return near
}

/** What scrolls `el` up and down: its nearest ancestor that does (one that only scrolls sideways doesn't), else the
 *  window (null). */
function scroller(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY)) return p
  }
  return null
}

/** How many of `total` rows to draw: a first `step`, then `step` more whenever the mark (`ref` it: an element after
 *  the last row drawn) comes within a few screens of what scrolls it. A long list stays smooth; every row is reached. */
export function useRowsNear(total: number, step = 100): [number, (el: Element | null) => void] {
  const [n, setN] = useState(step)
  const [mark, setMark] = useState<Element | null>(null)
  const shown = Math.min(n, total)
  useEffect(() => {
    if (!mark || shown >= total) return
    const o = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setN((x) => x + step) }, { root: scroller(mark), rootMargin: "2000px 0px" })
    o.observe(mark)
    return () => o.disconnect()
  }, [mark, shown, total, step])
  return [typeof IntersectionObserver === "undefined" ? total : shown, setMark]
}

/** A list's end that loads more: `onNear` each time `ref`'s element comes within `margin` of what scrolls it, looked
 *  at again when `shown` changes (how many are shown: what's drawn since may have moved it away). */
export function useNearEnd(ref: RefObject<Element | null>, onNear: () => void, shown: unknown, margin = "600px") {
  const near = useRef(onNear)
  near.current = onNear
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") return
    // (the pane that scrolls it, so the margin reaches below what it clips)
    const o = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) near.current() }, { root: scroller(el), rootMargin: margin })
    o.observe(el)
    return () => o.disconnect()
  }, [ref, margin, shown])
}
