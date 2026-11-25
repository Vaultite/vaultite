import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react"
import { steppedScale, wheelPx, wheelScale } from "@/core/panzoom"
import { useZoomTarget } from "@/core/zoom"
import { scrollingBox } from "@/lib/utils"

const LEAST = 0.5, MOST = 5
type At = { x: number; y: number }

export function usePageZoom(ref: RefObject<HTMLElement | null>, apply: (zoom: number) => void, keys = true) {
  const now = useRef(1), draw = useRef(apply)
  useLayoutEffect(() => { draw.current = apply })
  const set = useCallback((to: number, at?: At) => {
    const el = ref.current, next = Math.min(MOST, Math.max(LEAST, Math.abs(to - 1) < 0.02 ? 1 : to))
    if (!el || next === now.current) return
    const r = el.getBoundingClientRect(), p = at ?? { x: r.left + r.width / 2, y: innerHeight / 2 }
    const from = { x: p.x - r.left, y: Math.max(0, p.y - r.top) }, by = next / now.current, left = el.scrollLeft
    const own = el.scrollHeight > el.clientHeight + 1 ? el.scrollTop : null, pages = scrollingBox(el), top = pages?.scrollTop ?? scrollY
    now.current = next
    draw.current(next)
    el.scrollLeft = (left + from.x) * by - from.x
    if (own !== null) { el.scrollTop = (own + from.y) * by - from.y; return }
    const down = top + from.y * (by - 1)
    if (pages) pages.scrollTop = down; else scrollTo(0, down)
  }, [ref])
  useZoomTarget(ref, keys ? (step) => {
    set(step ? steppedScale(now.current, step) : 1)
    return { text: `Page ${Math.round(now.current * 100)}%`, actual: now.current === 1 }
  } : null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const quit = new AbortController(), live = { signal: quit.signal, passive: false }
    let pinch: { gap: number; from: number } | null = null
    const gapOf = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    el.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      set(now.current * wheelScale(wheelPx(e, el.clientHeight).y), { x: e.clientX, y: e.clientY })
    }, live)
    el.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { pinch = { gap: gapOf(e.touches), from: now.current }; if (e.cancelable) e.preventDefault() } }, live)
    el.addEventListener("touchmove", (e) => {
      if (!pinch || e.touches.length !== 2) return
      if (e.cancelable) e.preventDefault()
      const [a, b] = [e.touches[0], e.touches[1]]
      set(pinch.from * (gapOf(e.touches) / Math.max(1, pinch.gap)), { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 })
    }, live)
    el.addEventListener("touchend", (e) => { if (e.touches.length < 2) pinch = null }, live)
    return () => quit.abort()
  }, [ref, set])
}
