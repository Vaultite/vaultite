import { useLayoutEffect, useRef, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import { moves } from "@/core/animation"
import { cell } from "@/core/signal"

export type Corner = "tl" | "tr" | "bl" | "br"
export const CORNERS: Record<Corner, string> = {
  tl: "vau-room top-22 left-[calc(var(--left-sidebar,0px)+1rem)]",
  tr: "vau-room top-22 right-[calc(var(--right-sidebar,0px)+1rem)]",
  bl: "vau-room bottom-[calc(--spacing(10)+env(safe-area-inset-bottom))] left-[calc(var(--left-sidebar,0px)+1rem)]",
  br: "vau-room bottom-[calc(--spacing(10)+env(safe-area-inset-bottom))] right-[calc(var(--right-sidebar,0px)+1rem)]",
}

/** Dragging a corner card anywhere (a click still clicks), and where it lands: the corner it was thrown towards, as
 *  iOS's and browsers' picture in picture do. */
export function useCornerDrag(corner: Corner, setCorner: (c: Corner) => void) {
  const card = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)
  const from = useRef<{ x: number; y: number } | null>(null)
  const settle = (el: HTMLElement, at: { x: number; y: number }) => {
    const r = el.getBoundingClientRect()
    if (!moves()) return
    el.animate([{ transform: `translate(${at.x - r.left}px, ${at.y - r.top}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.05)" })
  }
  useLayoutEffect(() => {
    if (!from.current || !card.current) return
    settle(card.current, from.current)
    from.current = null
  }, [corner])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const el = e.currentTarget, id = e.pointerId, x0 = e.clientX, y0 = e.clientY
    let moving = false, last = { x: x0, y: y0, t: e.timeStamp }, v = { x: 0, y: 0 }
    dragged.current = false
    const move = (m: PointerEvent) => {
      if (m.pointerId !== id) return
      const dx = m.clientX - x0, dy = m.clientY - y0
      if (!moving) {
        if (Math.hypot(dx, dy) < 4) return
        moving = dragged.current = true
        try { el.setPointerCapture(id) } catch {}
        el.dataset.dragging = ""
        getSelection()?.removeAllRanges()
      }
      const dt = m.timeStamp - last.t
      if (dt > 0) v = { x: 0.6 * v.x + 0.4 * (m.clientX - last.x) / dt, y: 0.6 * v.y + 0.4 * (m.clientY - last.y) / dt }
      last = { x: m.clientX, y: m.clientY, t: m.timeStamp }
      el.style.transform = `translate(${dx}px, ${dy}px)`
    }
    const up = (u: PointerEvent) => {
      if (u.pointerId !== id) return
      removeEventListener("pointermove", move)
      removeEventListener("pointerup", up)
      removeEventListener("pointercancel", up)
      if (!moving) return
      delete el.dataset.dragging
      const r = el.getBoundingClientRect()
      el.style.transform = ""
      const room = (side: string) => document.querySelector(`aside[data-side="${side}"]:not([data-peek])`)?.getBoundingClientRect().width ?? 0
      const left = room("left"), right = room("right")
      const still = u.timeStamp - last.t > 80
      const cx = r.left + r.width / 2 + (still ? 0 : v.x * 180), cy = r.top + r.height / 2 + (still ? 0 : v.y * 180)
      const next: Corner = `${cy < innerHeight / 2 ? "t" : "b"}${cx < (left + innerWidth - right) / 2 ? "l" : "r"}`
      if (next === corner) settle(el, { x: r.left, y: r.top })
      else { from.current = { x: r.left, y: r.top }; setCorner(next) }
    }
    addEventListener("pointermove", move)
    addEventListener("pointerup", up)
    addEventListener("pointercancel", up)
  }
  const onClickCapture = (e: MouseEvent) => { if (dragged.current) { dragged.current = false; e.stopPropagation(); e.preventDefault() } }
  return { ref: card, onPointerDown, onClickCapture, "data-floats": "" }
}

const stacked = cell(new Map<string, { corner: Corner; height: number; rank: number }>())
const GAP = 8
function roomChanged() {
  let px = 0
  for (const c of stacked.get().values()) if (c.corner === "br") px += c.height + GAP
  document.documentElement.style.setProperty("--corner-cards", `${px}px`)
}
stacked.subscribe(roomChanged)

/** Cards in one corner stack, the lower `rank` nearest it (the mini player 0, agents' pages 1, pages playing 2): this
 *  card's place in it, as a margin from its corner (CORNERS' top or bottom stays; the drag's transform is its own). */
export function useCornerStack(id: string, corner: Corner, rank: number, ref: RefObject<HTMLElement | null>): CSSProperties {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const put = () => stacked.update((m) => {
      const was = m.get(id), height = el.offsetHeight
      if (was && was.corner === corner && was.height === height && was.rank === rank) return m
      return new Map(m).set(id, { corner, height, rank })
    })
    put()
    const ro = new ResizeObserver(put)
    ro.observe(el)
    return () => { ro.disconnect(); stacked.update((m) => { const next = new Map(m); next.delete(id); return next }) }
  }, [id, corner, rank, ref])
  const px = stacked.use((m) => {
    let sum = 0
    for (const [other, c] of m) if (other !== id && c.corner === corner && (c.rank < rank || (c.rank === rank && other < id))) sum += c.height + GAP
    return sum
  })
  return px ? (corner[0] === "t" ? { marginTop: px } : { marginBottom: px }) : {}
}
