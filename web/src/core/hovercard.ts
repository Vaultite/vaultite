import { useEffect, useId, type FocusEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import { cell } from "@/core/signal"
import { trackSoon } from "@/core/unsaved"
import { nodeOf } from "@/core/dom"

export type HoverShown = { id: string; part: string | null; cold: boolean; preferAbove: boolean; glideFromLast: boolean }

const DELAY = 350, WARM = 500, LINGER = 120, AIM = 400
const open = cell<HoverShown | null>(null)
let warmUntil = 0, opening = 0, closing = 0, aiming = 0
const due = new Set<number>()
const after = (ms: number, run: () => void) => { const t = window.setTimeout(() => { due.delete(t); run() }, ms); due.add(t); return t }
const cancel = (t: number) => { clearTimeout(t); due.delete(t) }
trackSoon("hover card", () => due.size > 0 || Date.now() < warmUntil)
let pending: Omit<HoverShown, "cold" | "glideFromLast"> | null = null
let shushedTillMoved = false, pressedTillLeft: string | null = null
let pressed = 0, lastY = 0
let leftAt: { x: number; y: number; t: number } | null = null
let over: string | null = null
if (typeof window !== "undefined") {
  addEventListener("pointerdown", () => { pressed = Date.now() }, true)
  addEventListener("pointermove", (e) => { lastY = e.clientY; if (e.movementX || e.movementY) shushedTillMoved = false })
}

const side = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
const inTriangle = (p: number[], a: number[], b: number[], c: number[]) => {
  const d1 = side(p, a, b), d2 = side(p, b, c), d3 = side(p, c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}
function headingToCard(p: [number, number]) {
  const el = document.querySelector("[data-hover-card] .preview-card")
  if (!leftAt || Date.now() - leftAt.t > AIM || !el) return false
  const r = el.getBoundingClientRect(), from = [leftAt.x, leftAt.y]
  const corners = [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]]
  return corners.some((a, i) => corners.slice(i + 1).some((b) => inTriangle(p, from, a, b)))
}

const focusedByKeyboard = (e: FocusEvent) => e.target instanceof Element && e.target.matches(":focus-visible") && Date.now() - pressed > 600
const dragOrResize = () => "dragging" in document.documentElement.dataset || "resizing" in document.body.dataset
function want(id: string, part: string | null, preferAbove: boolean, byPointer = true, at?: [number, number]) {
  if ((byPointer && (shushedTillMoved || pressedTillLeft === id)) || dragOrResize() || !matchMedia("(any-hover: hover)").matches) return
  cancel(aiming)
  const cur = open.get()
  if (cur && cur.id !== id && at && headingToCard(at)) {
    cancel(closing)
    aiming = after(120, () => { leftAt = null; if (over === id) want(id, part, preferAbove, byPointer); else closeHoverCard() })
    return
  }
  cancel(closing); cancel(opening)
  if (cur?.id === id) return cur.part !== part && open.set({ ...cur, part })
  if (cur || Date.now() < warmUntil) return open.set({ id, part, preferAbove, cold: false, glideFromLast: !!cur })
  pending = { id, part, preferAbove }
  opening = after(DELAY, () => { if (pending) open.set({ ...pending, cold: true, glideFromLast: false }); pending = null })
}

export function closeHoverCard() {
  cancel(closing); cancel(opening); pending = null
  if (open.get()) warmUntil = Date.now() + WARM
  open.set(null)
}
export function shushHoverCard() { shushedTillMoved = true; closeHoverCard() }
export const keepHoverCard = () => { cancel(closing); cancel(aiming); leftAt = null }
export const leaveHoverCard = () => { cancel(closing); closing = after(LINGER, closeHoverCard) }

export function useHoverCard(anchor: RefObject<HTMLElement | null>, { off = false, part, pressable = false }: { off?: boolean; part?: (t: EventTarget | null) => string | null
  pressable?: boolean } = {}) {
  const id = useId()
  const shown = open.use((o) => (o?.id === id ? o : null))
  useEffect(() => () => { if (open.get()?.id === id || pending?.id === id) closeHoverCard() }, [id])
  useEffect(() => { if (off && (open.get()?.id === id || pending?.id === id)) closeHoverCard() }, [id, off])
  const partOf = (t: EventTarget | null) => part?.(t) ?? null
  const mouse = (e: ReactPointerEvent) => e.pointerType === "mouse" && !e.buttons
  const comingDown = (e: ReactPointerEvent) => e.clientY >= lastY
  const props = {
    "data-hover-open": shown ? "" : undefined,
    onPointerEnter: (e: ReactPointerEvent) => { over = id; if (mouse(e) && !off) want(id, partOf(e.target), comingDown(e), true, [e.clientX, e.clientY]) },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!mouse(e) || off) return
      const p = partOf(e.target)
      if (!shown && pending?.id !== id) want(id, p, comingDown(e), true, [e.clientX, e.clientY])
      else if (shown && shown.part !== p) open.set({ ...shown, part: p })
      else if (pending?.id === id) pending.part = p
    },
    onPointerLeave: (e: ReactPointerEvent) => {
      if (e.pointerType !== "mouse") return
      if (over === id) over = null
      if (pressedTillLeft === id) pressedTillLeft = null
      if (pending?.id === id) { cancel(opening); pending = null }
      if (shown) leftAt = { x: e.clientX, y: e.clientY, t: Date.now() }
      else if (leftAt && headingToCard([e.clientX, e.clientY])) return
      leaveHoverCard()
    },
    onPointerDownCapture: () => { if (pressable) return; pressedTillLeft = id; if (shown || pending?.id === id) closeHoverCard() },
    onFocus: (e: FocusEvent) => { if (!off && focusedByKeyboard(e)) want(id, partOf(e.target), true, false) },
    onBlur: (e: FocusEvent) => { if (!anchor.current?.contains(nodeOf(e.relatedTarget)) && (shown || pending?.id === id)) closeHoverCard() },
  }
  return { shown, props }
}

export type CardPlace = { side: "right" | "left" | "above" | "below"; left: number; top: number; growFromX: number; growFromY: number }
export type PlaceCard = (anchor: HTMLElement, width: number, height: number, shown: HoverShown) => CardPlace

const EDGE = 8
export const CARD_GAP = 6
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi))

export const placeBelow: PlaceCard = (anchor, w) => {
  const a = anchor.getBoundingClientRect()
  const left = clamp(a.left, EDGE, innerWidth - EDGE - w)
  return { side: "below", left, top: a.bottom, growFromX: clamp(a.left + a.width / 2 - left, 0, w), growFromY: 0 }
}

export function placeBesideColumn(columnOf: (anchor: HTMLElement) => Element | null): PlaceCard {
  return (anchor, w, h) => {
    const a = anchor.getBoundingClientRect(), c = columnOf(anchor)?.getBoundingClientRect() ?? a
    const top = clamp(a.top + a.height / 2 - h / 2, EDGE, innerHeight - EDGE - h), y = a.top + a.height / 2 - top
    if (innerWidth - EDGE - c.right >= w + CARD_GAP) return { side: "right", left: c.right, top, growFromX: 0, growFromY: y }
    if (c.left - EDGE >= w + CARD_GAP) return { side: "left", left: c.left - w - CARD_GAP, top, growFromX: w, growFromY: y }
    const left = clamp(a.left, EDGE, innerWidth - EDGE - w), x = clamp(a.left + a.width / 2 - left, 0, w)
    return a.bottom + h + CARD_GAP + EDGE <= innerHeight ? { side: "below", left, top: a.bottom, growFromX: x, growFromY: 0 }
      : { side: "above", left, top: a.top - h - CARD_GAP, growFromX: x, growFromY: h }
  }
}
