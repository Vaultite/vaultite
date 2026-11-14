import { useEffect, useLayoutEffect, useState, type RefObject } from "react"
import type { Live } from "./live"
import type { Term } from "./vt/term"

export function useHeldGrid(host: RefObject<HTMLDivElement | null>, live: RefObject<Live | null>, phone: boolean, full: boolean, area: { top: number; height: number } | null) {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const el = host.current
    if (!el || !phone || full) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [host, phone, full])
  const held = full ? height : 0
  useLayoutEffect(() => {
    const el = host.current, t = live.current?.t
    if (!el || !t || !held) return
    const box = el.parentElement!, room = box.clientHeight - el.offsetTop - (parseFloat(getComputedStyle(box).paddingBottom) || 0)
    let at = -1
    const place = () => {
      const shift = slideFor(t, held, room)
      if (shift !== at) { at = shift; slide(el, shift) }
    }
    place()
    const off = t.onRender(place)
    return () => { off.dispose(); slide(el, 0) }
  }, [host, live, held, area?.top, area?.height])
  return held
}

const slide = (el: HTMLElement, px: number) => { el.style.transform = px ? `translateY(${-px}px)` : "" }

function slideFor(t: Term, height: number, room: number) {
  const h = t.m.cssH, most = Math.max(0, height - room), cur = t.cursor()
  if (!most || !cur) return most
  const last = lastWritten(t, cur.y)
  return Math.min(cur.y * h, Math.max(0, Math.min(most, (last + 1) * h - room)))
}

function lastWritten(t: Term, from: number) {
  let y = t.rows - 1
  while (y > from && !t.rowText(y, t.cols).trim()) y--
  return y
}
