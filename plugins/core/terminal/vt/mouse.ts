import { linkUnder, reporting as reports, wireHover } from "./hover.ts"
import type { Link } from "./links.ts"
import { MOD_ALT, MOD_CTRL, MOD_SHIFT, MOD_SUPER } from "./screen.ts"
import type { Term } from "./term.ts"

const mods = (e: MouseEvent) => (e.shiftKey ? MOD_SHIFT : 0) | (e.ctrlKey ? MOD_CTRL : 0) | (e.altKey ? MOD_ALT : 0) | (e.metaKey ? MOD_SUPER : 0)
/** DOM button to Ghostty's: left, middle, right. */
const BUTTON = [1, 3, 2]

/** What a press became: its program's, a selection, a link's click (its program's once it's a drag) or a menu's. */
type Down = { press: PointerEvent; as: "program" | "select" | "menu"; moved: boolean; link: Link | null } | { press: PointerEvent; as: "link"; moved: boolean; link: Link }

function pressOf(t: Term, press: PointerEvent, link: Link | null): Down {
  const base = { press, moved: false }
  // (⌃-click on a Mac is the right-click: the link's menu)
  if (link && t.o.mac && press.ctrlKey) return { ...base, as: "menu", link: null }
  if (!reports(t, press)) return { ...base, as: "select", link }
  return link ? { ...base, as: "link", link } : { ...base, as: "program", link: null }
}

export function wirePointer(t: Term) {
  const el = t.element
  let down: Down | null = null
  let held = 0, scrollTimer = 0, last: PointerEvent | null = null
  const px = (e: MouseEvent) => { const c = t.cellAt(e.clientX, e.clientY); return { c, at: { x: c.px * t.m.dpr, y: c.py * t.m.dpr } } }
  const report = (action: "press" | "release" | "motion", e: MouseEvent, button: number) => {
    const { at } = px(e)
    t.emit(t.s.mouse(action, button, mods(e), at, t.surface(), held > 0))
  }
  const reporting = (e: MouseEvent) => reports(t, e)
  const geo = () => ({ cols: t.cols, cellWidth: t.m.w, height: t.rows * t.m.h })
  const hover = wireHover(t, () => !!down)

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "touch") return
    if (e.button > 2) return
    const { c, at } = px(e)
    if (!c.inside && e.button === 0 && c.px > t.cols * t.m.cssW) return scrollbarDrag(e)
    t.focus()
    // (the field keeps the keyboard, no browser selection; a right-click's menu still comes)
    if (e.button !== 2) e.preventDefault()
    held++
    const link = e.button === 0 ? linkUnder(t, e)?.link ?? null : null
    down = pressOf(t, e, link)
    try { el.setPointerCapture(e.pointerId) } catch { /* (a pointer the page doesn't hold: no capture, the drag still works inside) */ }
    if (down.as === "program") return report("press", e, BUTTON[e.button])
    if (down.as !== "select" || e.button !== 0) return
    t.s.gestureEvent("press", c, at, geo(), performance.now())
    t.requestRender(true)
  }
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return
    last = e
    if (!down) {
      hover.move(e)
      // (motion with no button, for a program that asked for all of it: 1003)
      if (reporting(e) && t.s.mode(1003)) report("motion", e, 0)
      return
    }
    if (Math.hypot(e.clientX - down.press.clientX, e.clientY - down.press.clientY) > 3) down.moved = true
    const { press } = down, { button } = press
    if (down.as === "link" && down.moved) { down = { press, as: "program", moved: true, link: null }; report("press", press, BUTTON[button]) }
    if (down.as === "program") { if (t.s.mode(1002) || t.s.mode(1003)) report("motion", e, BUTTON[button]); return }
    if (down.as === "select" && button === 0 && down.moved) drag(e)
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
    if (d.as === "program") return report("release", e, BUTTON[d.press.button])
    if (d.press.button !== 0) return
    if (d.as === "select") {
      const { c, at } = px(e)
      t.s.gestureEvent("release", c, at, geo(), performance.now())
    }
    if (!d.moved && d.link && e.type === "pointerup") { t.s.clearSelection(); d.link.open(e) }
    t.requestRender(true)
  }
  const onLeave = () => { if (!down) hover.leave() }
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
    clearInterval(scrollTimer); hover.dispose()
    el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerup", onUp)
    el.removeEventListener("pointercancel", onUp); el.removeEventListener("pointerleave", onLeave); el.removeEventListener("wheel", onWheel)
  }
}
