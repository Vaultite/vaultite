// A card floating in a corner of the room between the sidebars, like picture in picture (the mini player, agents'
// pages): where each corner is, and dragging it to another.
import { useLayoutEffect, useRef, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react"

export type Corner = "tl" | "tr" | "bl" | "br"
// Top corners sit under the pane's tab bar and file bar (back, forward), bottom ones over the status bar.
export const CORNERS: Record<Corner, string> = {
  tl: "top-22 left-[calc(var(--left-sidebar,0px)+1rem)]",
  tr: "top-22 right-[calc(var(--right-sidebar,0px)+1rem)]",
  bl: "bottom-10 left-[calc(var(--left-sidebar,0px)+1rem)]",
  br: "bottom-10 right-[calc(var(--right-sidebar,0px)+1rem)]",
}

/** Dragging a corner card anywhere (a click still clicks), and where it lands: the corner it was thrown towards, as
 *  iOS's and browsers' picture in picture do. */
export function useCornerDrag(corner: Corner, setCorner: (c: Corner) => void) {
  const card = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)
  const from = useRef<{ x: number; y: number } | null>(null)
  // Glides from where it was let go to its corner (drawn there already, so the corner's own place is measured).
  const settle = (el: HTMLElement, at: { x: number; y: number }) => {
    const r = el.getBoundingClientRect()
    if (typeof el.animate !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) return
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
        try { el.setPointerCapture(id) } catch { /* not a live pointer */ }
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
      // Where it would coast to: a flick throws it to the far corner of the room between the sidebars.
      const root = getComputedStyle(document.documentElement)
      const left = parseFloat(root.getPropertyValue("--left-sidebar")) || 0, right = parseFloat(root.getPropertyValue("--right-sidebar")) || 0
      const still = u.timeStamp - last.t > 80
      const cx = r.left + r.width / 2 + (still ? 0 : v.x * 180), cy = r.top + r.height / 2 + (still ? 0 : v.y * 180)
      const next = `${cy < innerHeight / 2 ? "t" : "b"}${cx < (left + innerWidth - right) / 2 ? "l" : "r"}` as Corner
      if (next === corner) settle(el, { x: r.left, y: r.top })
      else { from.current = { x: r.left, y: r.top }; setCorner(next) }
    }
    addEventListener("pointermove", move)
    addEventListener("pointerup", up)
    addEventListener("pointercancel", up)
  }
  // A drag isn't a click on what it started on (the note, a button).
  const onClickCapture = (e: MouseEvent) => { if (dragged.current) { dragged.current = false; e.stopPropagation(); e.preventDefault() } }
  return { ref: card, onPointerDown, onClickCapture }
}

