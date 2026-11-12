import { MOD_ALT, MOD_CTRL, MOD_SHIFT, MOD_SUPER } from "./screen.ts"
import type { Term } from "./term.ts"

const mods = (e: MouseEvent) => (e.shiftKey ? MOD_SHIFT : 0) | (e.ctrlKey ? MOD_CTRL : 0) | (e.altKey ? MOD_ALT : 0) | (e.metaKey ? MOD_SUPER : 0)
/** DOM button to Ghostty's: left, middle, right. */
const BUTTON = [1, 3, 2]

export function wirePointer(t: Term) {
  const el = t.element
  let down: { button: number; x: number; y: number; reported: boolean; moved: boolean; link: ReturnType<Term["linkAt"]> } | null = null
  let held = 0, scrollTimer = 0, last: PointerEvent | null = null
  const px = (e: MouseEvent) => { const c = t.cellAt(e.clientX, e.clientY); return { c, at: { x: c.px * t.m.dpr, y: c.py * t.m.dpr } } }
  const report = (action: "press" | "release" | "motion", e: MouseEvent, button: number) => {
    const { at } = px(e)
    t.emit(t.s.mouse(action, button, mods(e), at, t.surface(), held > 0))
  }
  const reporting = (e: MouseEvent) => t.s.mouseTracking && !e.shiftKey
  const geo = () => ({ cols: t.cols, cellWidth: t.m.w, height: t.rows * t.m.h })
  const hover = (e: MouseEvent) => {
    const { c } = px(e)
    const at = c.inside && !reporting(e) ? t.linkAt(c.x, c.y) : null
    const same = at && t.hovered && at.link.text === t.hovered.link.text && at.link.range.start.x === t.hovered.link.range.start.x && at.link.range.start.y === t.hovered.link.range.start.y
    if (same) return
    if (t.hovered) { t.hovered.link.leave?.(e, t.hovered.link.text); el.removeAttribute("data-term-link") }
    t.hovered = at
    if (at) { at.link.hover?.(e, at.link.text); el.setAttribute("data-term-link", "") }
    el.style.cursor = at ? "pointer" : reporting(e) ? "default" : "text"
    t.requestRender(true)
  }

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "touch") return
    if (e.button > 2) return
    const { c, at } = px(e)
    if (!c.inside && e.button === 0 && c.px > t.cols * t.m.cssW) return scrollbarDrag(e)
    t.focus()
    // (the field keeps the keyboard, no browser selection; a right-click's menu still comes)
    if (e.button !== 2) e.preventDefault()
    held++
    down = { button: e.button, x: e.clientX, y: e.clientY, reported: false, moved: false, link: null }
    try { el.setPointerCapture(e.pointerId) } catch { /* (a pointer the page doesn't hold: no capture, the drag still works inside) */ }
    if (reporting(e)) { down.reported = true; report("press", e, BUTTON[e.button]); return }
    if (e.button !== 0) return
    down.link = t.hovered
    t.s.gestureEvent("press", c, at, geo(), performance.now())
    t.requestRender(true)
  }
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return
    last = e
    if (!down) {
      hover(e)
      // (motion with no button, for a program that asked for all of it: 1003)
      if (reporting(e) && t.s.mode(1003)) report("motion", e, 0)
      return
    }
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 3) down.moved = true
    if (down.reported) { if (t.s.mode(1002) || t.s.mode(1003)) report("motion", e, BUTTON[down.button]); return }
    if (down.button !== 0 || !down.moved) return
    drag(e)
  }
  const drag = (e: PointerEvent) => {
    const { c, at } = px(e)
    t.s.gestureEvent("drag", c, at, geo(), performance.now(), e.altKey)
    t.requestRender(true)
    clearInterval(scrollTimer)
    const r = t.screenEl.getBoundingClientRect()
    const dir = e.clientY < r.top ? -1 : e.clientY > r.top + t.rows * t.m.cssH ? 1 : 0
    if (dir) scrollTimer = window.setInterval(() => { if (!down || !last) return clearInterval(scrollTimer); t.scrollLines(dir); const p = px(last); t.s.gestureEvent("drag", p.c, p.at, geo(), performance.now()); t.requestRender(true) }, 60)
  }
  const onUp = (e: PointerEvent) => {
    if (e.pointerType === "touch" || !down) return
    clearInterval(scrollTimer)
    held = Math.max(0, held - 1)
    const d = down
    down = null
    if (d.reported) { report("release", e, BUTTON[d.button]); return }
    if (d.button !== 0) return
    const { c, at } = px(e)
    t.s.gestureEvent("release", c, at, geo(), performance.now())
    if (!d.moved && d.link && t.hovered?.link === d.link.link) { t.s.clearSelection(); d.link.link.activate(e, d.link.link.text) }
    t.requestRender(true)
  }
  const onLeave = (e: PointerEvent) => { if (!down && t.hovered) { t.hovered.link.leave?.(e, t.hovered.link.text); t.hovered = null; el.removeAttribute("data-term-link"); t.requestRender(true) } }
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey || e.defaultPrevented) return
    e.preventDefault()
    const { c } = px(e)
    t.wheel(e.deltaY, { x: c.px, y: c.py }, e.deltaMode === 1 ? "lines" : "px", e.shiftKey)
    if (e.deltaMode === 2) t.wheel(e.deltaY * t.rows, null, "lines")
  }
  const scrollbarDrag = (e: PointerEvent) => {
    e.preventDefault()
    const r = t.screenEl.getBoundingClientRect(), H = t.rows * t.m.cssH
    const to = (y: number) => { const v = t.viewport; t.scrollToRow(Math.round(Math.max(0, Math.min(1, (y - r.top) / H)) * v.length - t.rows / 2)); t.showScrollbar() }
    to(e.clientY)
    const move = (m: PointerEvent) => to(m.clientY)
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up) }
    addEventListener("pointermove", move); addEventListener("pointerup", up)
  }
  el.addEventListener("pointerdown", onDown)
  el.addEventListener("pointermove", onMove)
  el.addEventListener("pointerup", onUp)
  el.addEventListener("pointercancel", onUp)
  el.addEventListener("pointerleave", onLeave)
  el.addEventListener("wheel", onWheel, { passive: false })
  return () => {
    clearInterval(scrollTimer)
    el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerup", onUp)
    el.removeEventListener("pointercancel", onUp); el.removeEventListener("pointerleave", onLeave); el.removeEventListener("wheel", onWheel)
  }
}
