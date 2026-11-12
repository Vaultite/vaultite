import type { EditorView } from "@codemirror/view"
import { keyboardUp } from "@/components/KeyBar"
import { currentEditor } from "@/core/editors"
import { scrollingBox } from "@/lib/utils"

const TOP = "sight-top", FOOT = "sight-foot"

let edge: HTMLElement | null = null
// Chrome's client coordinates are the layout viewport's, iOS's the visual viewport's while the keyboard's up: where a
// fixed element at the top is says which.
function visible() {
  const vv = visualViewport
  if (!vv) return { top: 0, bottom: innerHeight }
  if (!edge?.isConnected) {
    edge = document.createElement("div")
    edge.setAttribute("aria-hidden", "true")
    edge.style.cssText = "position: fixed; top: 0; left: 0; width: 0; height: 0; pointer-events: none; visibility: hidden"
    document.body.append(edge)
  }
  const top = edge.getBoundingClientRect().top + vv.offsetTop
  return { top, bottom: top + vv.height }
}

/** Where on screen (client coordinates) what's in `el`'s scroller can be seen. */
export function sightOf(el: Element) {
  let { top, bottom } = visible()
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).overflowY === "visible") continue
    const r = p.getBoundingClientRect()
    top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom)
  }
  const box = el.getBoundingClientRect()
  const layer = el.closest("dialog[open]") ?? document
  const over = (b: DOMRect) => b.height > 0 && b.left < box.right && b.right > box.left
  for (const bar of layer.getElementsByClassName(TOP)) {
    const b = bar.getBoundingClientRect()
    if (over(b) && b.top <= top + 1 && b.bottom > top) top = b.bottom
  }
  for (const bar of layer.getElementsByClassName(FOOT)) {
    const b = bar.getBoundingClientRect()
    if (over(b) && b.bottom >= bottom - 1 && b.top < bottom) bottom = b.top
  }
  return { top, bottom }
}

type View = Pick<EditorView, "dom" | "documentTop" | "contentHeight" | "lineBlockAt" | "lineBlockAtHeight" | "state">

export function lineInSight(v: View) {
  const h = Math.max(0, sightOf(v.dom).top - v.documentTop)
  let b = v.lineBlockAtHeight(h)
  if (b.top < h - 2 && b.to < v.state.doc.length) b = v.lineBlockAt(b.to + 1)
  return b.from
}

export function wholly(v: View, pos: number) {
  const b = v.lineBlockAt(pos), s = sightOf(v.dom)
  return v.documentTop + b.top >= s.top - 1 && v.documentTop + b.bottom <= s.bottom + 1
}

function typingAt(): { el: HTMLElement; top: number; bottom: number } | null {
  const at = document.activeElement
  if (!(at instanceof HTMLElement) || !at.matches("input, textarea, [contenteditable=true]") || at.closest("[data-term]")) return null
  const el = at.closest<HTMLElement>(".cm-editor") ?? at, ed = currentEditor()
  if (ed?.view.contentDOM === at) {
    try {
      const c = ed.view.coordsAtPos(ed.view.state.selection.main.head)
      return c && { el, top: c.top, bottom: c.bottom }
    } catch { return null }
  }
  if (!scrollingBox(el)) for (let p: HTMLElement | null = el; p; p = p.parentElement) if (getComputedStyle(p).position === "fixed") return null
  const r = at.getBoundingClientRect()
  return { el, top: r.top, bottom: Math.min(r.bottom, r.top + 48) }
}

// iOS scrolls to the caret its own way (behind the keys over the keyboard, or to the keyboard's edge): once a tap or
// the keyboard settles, the caret goes back where the finger put it.
export function keepTypingInSight() {
  const vv = visualViewport
  if (!vv) return () => {}
  const scrolled = (el: Element) => { const b = scrollingBox(el); return b ? b.scrollTop : scrollY }
  let timer = 0, until = 0, before: number | null = null, x = 0, y = 0
  const keep = () => {
    const was = before
    until = 0; before = null
    const c = typingAt()
    if (!c) return
    const s = sightOf(c.el), pad = 8, h = c.bottom - c.top
    const back = c.top + (was === null ? 0 : scrolled(c.el) - was)
    const by = c.top - Math.max(s.top + pad, Math.min(s.bottom - pad - h, back))
    if (Math.abs(by) < 1) return
    const b = scrollingBox(c.el)
    if (b) b.scrollTop += by; else scrollBy(0, by)
  }
  const still = () => { clearTimeout(timer); timer = window.setTimeout(keep, 120) }
  const watch = () => { until = performance.now() + 1000; still() }
  let height = vv.height
  const resized = () => { if (Math.abs(vv.height - height) >= 1) { height = vv.height; if (keyboardUp()) watch() } }
  const moved = () => { if (until && performance.now() < until) still() }
  const down = (e: TouchEvent) => {
    until = 0; clearTimeout(timer)
    const t = e.touches[0], el = e.target as Element
    before = e.touches.length === 1 && el.closest?.("input, textarea, [contenteditable=true]") ? scrolled(el) : null
    x = t?.clientX ?? 0; y = t?.clientY ?? 0
  }
  const drag = (e: TouchEvent) => { const t = e.touches[0]; if (t && Math.hypot(t.clientX - x, t.clientY - y) > 10) before = null }
  const up = () => { if (before !== null) watch() }
  vv.addEventListener("resize", resized)
  addEventListener("scroll", moved, { capture: true, passive: true })
  addEventListener("touchstart", down, { capture: true, passive: true })
  addEventListener("touchmove", drag, { capture: true, passive: true })
  addEventListener("touchend", up, { capture: true, passive: true })
  return () => {
    clearTimeout(timer)
    vv.removeEventListener("resize", resized)
    removeEventListener("scroll", moved, { capture: true })
    removeEventListener("touchstart", down, { capture: true }); removeEventListener("touchmove", drag, { capture: true })
    removeEventListener("touchend", up, { capture: true })
  }
}
