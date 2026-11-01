// The bars above files fade (appearance `fileBarFade`). "typing": two keys in a file (not a shortcut's), back once the
// pointer moves or at Escape. "always": out of sight, shown while the pointer is over a bar or just under it.
import { useEffect } from "react"
import type { FileBarFade } from "@/core/prefs"

/** How far (px) the pointer moves, and how long (ms) after a key, before it counts: a palm brushing the trackpad mid-sentence isn't a reach for the bar. */
const MOVE = 16, AFTER_KEY = 500
/** How far (px) under a hidden bar the pointer shows it: reaching for it shows it before it's there. */
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
      if (!(e.target as Element).closest?.("[data-pane] :is([contenteditable=true], textarea)")) return
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

/** "always": every bar hidden but the one the pointer is at (`data-shown`), found by where the pointer is rather than
 *  by :hover, which a window's drag strip (a bar without the tab bar) doesn't get. */
function always(root: DOMStringMap) {
  root.barFade = "always"
  let shown: HTMLElement | null = null
  const show = (bar: HTMLElement | null) => {
    if (bar === shown) return
    shown?.removeAttribute("data-shown")
    shown = bar
    bar?.setAttribute("data-shown", "")
  }
  /** The bar of the pane at (x, y), when the point is on it or just under it. */
  const barAt = (target: EventTarget | null, x: number, y: number) => {
    const pane = target instanceof Element ? target.closest<HTMLElement>("[data-pane]") : null
    const bar = pane && [...pane.querySelectorAll<HTMLElement>("[data-view-bar]")].find((b) => b.getClientRects().length)
    if (!bar) return null
    const r = bar.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom + NEAR ? bar : null
  }
  let frame = 0, last: PointerEvent | null = null
  const decide = () => {
    frame = 0
    const e = last!
    const t = e.target instanceof Element ? e.target : null
    // (over a menu, a tooltip or a sheet, from the bar or not: as it was)
    if (t && !t.closest("[data-pane]") && t.closest("dialog, [role=menu], [role=tooltip]")) return
    show(barAt(t, e.clientX, e.clientY))
  }
  const move = (e: PointerEvent) => {
    if (e.pointerType === "touch") return
    last = e
    frame ||= requestAnimationFrame(decide)
  }
  // Off into the window's drag strip or out of it: the bar it left by stays, when it left from one.
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
