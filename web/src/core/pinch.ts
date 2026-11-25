import { wheelPx, wheelScale, type Pt } from "@/core/panzoom"
import { isNumber } from "../../../core/values.ts"

type Gesture = Event & { scale: number; clientX: number; clientY: number }
const isGesture = (e: Event): e is Gesture => "scale" in e && isNumber(e.scale) && "clientX" in e && "clientY" in e
const gapOf = ([a, b]: Touch[]) => Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY))
const midOf = ([a, b]: Touch[]): Pt => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 })

export type Pinched = { zoom: (factor: number, at: Pt) => void; when?: (e: Event) => boolean; touches?: boolean; first?: boolean }

export const zoomWheel = (e: WheelEvent) => e.ctrlKey || e.metaKey

export function onPinch(el: HTMLElement, { zoom, when = () => true, touches = false, first = false }: Pinched) {
  const quit = new AbortController(), live = { signal: quit.signal, passive: false, capture: first }
  const take = (e: Event) => { if (e.cancelable) e.preventDefault(); if (first) e.stopPropagation() }
  el.addEventListener("wheel", (e) => {
    if (!zoomWheel(e) || !when(e)) return
    take(e)
    const by = wheelPx(e, innerHeight)
    zoom(wheelScale(by.y || by.x), { x: e.clientX, y: e.clientY })
  }, live)
  let from = 1
  const gesture = (e: Event) => {
    if (!isGesture(e) || !when(e)) return
    take(e)
    if (e.type === "gesturechange") zoom(e.scale / from, { x: e.clientX, y: e.clientY })
    from = e.type === "gesturechange" ? e.scale : 1
  }
  // Safari on a Mac sends a pinch as its own events; on iOS they only echo the touches.
  if (!navigator.maxTouchPoints) for (const g of ["gesturestart", "gesturechange"]) el.addEventListener(g, gesture, live)
  let gap = 0
  const finger = (e: TouchEvent) => {
    const two = e.touches.length === 2 && when(e) ? [...e.touches] : null
    if (!two) { gap = 0; return }
    take(e)
    if (gap && e.type === "touchmove") zoom(gapOf(two) / gap, midOf(two))
    gap = gapOf(two)
  }
  if (touches) for (const t of ["touchstart", "touchmove", "touchend"] as const) el.addEventListener(t, finger, live)
  return () => quit.abort()
}
