import { useEffect } from "react"
import type { FileBarFade } from "@/core/prefs"
import { elementOf } from "@/core/dom"

const MOVE = 16, AFTER_KEY = 500
const NEAR = 12

export function useBarFade(mode: FileBarFade | false) {
  useEffect(() => {
    const root = document.documentElement.dataset
    if (mode !== "typing" && mode !== "always") return
    if (mode === "always") return always(root)
    let keys = 0, last = 0, moved = 0
    const show = () => { keys = 0; moved = 0; delete root.typing }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return show()
      if (e.metaKey || e.ctrlKey || e.altKey || !(e.key.length === 1 || e.key === "Backspace" || e.key === "Enter")) return
      if (!elementOf(e.target)?.closest("[data-pane] :is([contenteditable=true], textarea)")) return
      last = e.timeStamp; moved = 0
      if (++keys >= 2) root.typing = ""
    }
    const move = (e: PointerEvent) => {
      if (!("typing" in root) || e.pointerType === "touch" || e.timeStamp - last < AFTER_KEY) return
      moved += Math.abs(e.movementX) + Math.abs(e.movementY)
      if (moved > MOVE) show()
    }
    addEventListener("keydown", key, true)
    addEventListener("pointermove", move, { passive: true })
    addEventListener("blur", show)
    return () => { show(); removeEventListener("keydown", key, true); removeEventListener("pointermove", move); removeEventListener("blur", show) }
  }, [mode])
}

// Found by where the pointer is, not :hover: a window's drag strip gets no hover.
function always(root: DOMStringMap) {
  root.barFade = "always"
  let shown: HTMLElement | null = null
  const show = (bar: HTMLElement | null) => {
    if (bar === shown) return
    shown?.removeAttribute("data-shown")
    shown = bar
    bar?.setAttribute("data-shown", "")
  }
  const barAt = (target: EventTarget | null, x: number, y: number) => {
    const el = target instanceof Element ? target : null
    if (!el || el.closest("[data-place-strip]")) return null
    const gap = el.closest<HTMLElement>("[data-pane-gap]")?.dataset.paneGap
    const frame = gap ? document.querySelector(`section[data-pane-frame="${CSS.escape(gap)}"]:not([data-away])`) : el.closest("section[data-pane-frame]")
    const pane = frame?.querySelector<HTMLElement>("[data-pane]") ?? el.closest<HTMLElement>("[data-pane]")
    const bar = pane && [...pane.querySelectorAll<HTMLElement>("[data-view-bar]")].find((b) => b.getClientRects().length)
    if (!bar) return null
    const p = pane.getBoundingClientRect(), r = bar.getBoundingClientRect()
    return x >= p.left && x <= p.right && y <= r.bottom + NEAR ? bar : null
  }
  let frame = 0, last: PointerEvent | null = null
  const decide = () => {
    frame = 0
    const e = last!
    const t = e.target instanceof Element ? e.target : null
    if (t && !t.closest("[data-pane]") && t.closest("dialog, [role=menu], [role=tooltip]")) return
    show(barAt(t, e.clientX, e.clientY))
  }
  const move = (e: PointerEvent) => {
    if (e.pointerType === "touch") return
    last = e
    frame ||= requestAnimationFrame(decide)
  }
  const out = (e: PointerEvent) => { if (!e.relatedTarget && e.pointerType !== "touch") show(barAt(e.target, e.clientX, e.clientY) ?? shown) }
  const blur = () => show(null)
  addEventListener("pointermove", move, { passive: true })
  document.addEventListener("pointerout", out, { passive: true })
  addEventListener("blur", blur)
  return () => {
    cancelAnimationFrame(frame); show(null); delete root.barFade
    removeEventListener("pointermove", move); document.removeEventListener("pointerout", out); removeEventListener("blur", blur)
  }
}
