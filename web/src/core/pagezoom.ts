import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react"
import { keepZoom, keptZoom } from "@/core/keptzoom"
import { steppedScale, type Pt } from "@/core/panzoom"
import { onPinch } from "@/core/pinch"
import { useZoomTarget } from "@/core/zoom"
import { scrollingBox } from "@/lib/utils"

const LEAST = 0.5, MOST = 5, NEAR = 0.03

function scrolledAbout(el: HTMLElement, at: Pt | undefined, by: number, draw: () => void) {
  const r = el.getBoundingClientRect(), p = at ?? { x: r.left + r.width / 2, y: innerHeight / 2 }
  const from = { x: p.x - r.left, y: Math.max(0, p.y - r.top) }, left = el.scrollLeft
  const own = el.scrollHeight > el.clientHeight + 1 ? el.scrollTop : null, pages = scrollingBox(el), top = pages?.scrollTop ?? scrollY
  draw()
  el.scrollLeft = (left + from.x) * by - from.x
  if (own !== null) { el.scrollTop = (own + from.y) * by - from.y; return }
  const down = top + from.y * (by - 1)
  if (pages) pages.scrollTop = down; else scrollTo(0, down)
}

export function usePageZoom(ref: RefObject<HTMLElement | null>, apply: (zoom: number) => void, { path, embed }: { path?: string; embed?: boolean } = {}) {
  const now = useRef<number | null>(null), raw = useRef(1), draw = useRef(apply)
  const zoomNow = useCallback(() => (now.current ??= raw.current = path ? keptZoom(path) : 1), [path])
  useLayoutEffect(() => { draw.current = apply })
  const set = useCallback((to: number, at?: Pt) => {
    const el = ref.current, was = zoomNow()
    raw.current = Math.min(MOST, Math.max(LEAST, to))
    const next = Math.abs(raw.current - 1) < NEAR ? 1 : raw.current
    if (!el || next === was) return
    now.current = next
    if (path) keepZoom(path, next)
    scrolledAbout(el, at, next / was, () => draw.current(next))
  }, [ref, path, zoomNow])
  const zoomBy = useCallback((by: number, at?: Pt) => { zoomNow(); set(raw.current * by, at) }, [set, zoomNow])
  useZoomTarget(ref, (step) => {
    set(step ? steppedScale(zoomNow(), step) : 1)
    return { text: `Page ${Math.round(zoomNow() * 100)}%`, actual: zoomNow() === 1 }
  }, { keyboardIn: embed })
  useEffect(() => { const el = ref.current; return el ? onPinch(el, { zoom: zoomBy, touches: true }) : undefined }, [ref, zoomBy])
  return zoomBy
}
