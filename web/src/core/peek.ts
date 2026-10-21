// A sidebar hidden without its rail (appearance `rails` off) slides in over the page while the pointer is at its edge of
// the window, as Zen's compact mode does, and slides out once the pointer has left it.
import { useEffect, useState } from "react"
import { getDrag } from "@/core/drag"

export type Peek = "left" | "right" | null

/** How close to the edge (px) and how long there (ms) opens it: the right edge waits longer, panes' scrollbars are there. */
const EDGE = { left: { px: 6, ms: 90 }, right: { px: 3, ms: 220 } }
const LINGER = 280

/** Kept open while something of it is in use: a menu it opened, a drag, typing in its fields. */
function held(aside: Element | null) {
  if (getDrag() || document.querySelector("[role=menu]")) return true
  const a = document.activeElement
  return !!aside && !!a && aside.contains(a) && a.matches("input, textarea, [contenteditable=true]")
}

/** Which hidden sidebar is slid in: `left` / `right` say which sidebars are hidden now. */
export function usePeek(left: boolean, right: boolean): Peek {
  const [peek, setPeek] = useState<Peek>(null)
  useEffect(() => { if ((peek === "left" && !left) || (peek === "right" && !right)) setPeek(null) }, [left, right, peek])
  useEffect(() => {
    if (!left && !right) return
    let opening: { side: "left" | "right"; t: ReturnType<typeof setTimeout> } | null = null
    let closing: ReturnType<typeof setTimeout> | null = null
    const stopOpening = () => { if (opening) clearTimeout(opening.t); opening = null }
    const stopClosing = () => { if (closing) clearTimeout(closing); closing = null }
    const aside = () => (peek ? document.querySelector(`aside[data-side=${peek}]`) : null)
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return
      const side = left && e.clientX <= EDGE.left.px ? "left" : right && e.clientX >= innerWidth - 1 - EDGE.right.px ? "right" : null
      if (peek) {
        const box = aside()?.getBoundingClientRect()
        const inside = !!box && e.clientX >= box.left - 8 && e.clientX <= box.right + 8
        if (inside || side === peek) { stopClosing(); return }
        if (!closing) closing = setTimeout(() => { closing = null; if (!held(aside())) setPeek(null) }, LINGER)
        return
      }
      if (side && opening?.side !== side) { stopOpening(); opening = { side, t: setTimeout(() => { opening = null; setPeek(side) }, EDGE[side].ms) } }
      else if (!side) stopOpening()
    }
    // A click on the page puts it away at once; Escape too, unless it's the editor's or a menu's.
    const down = (e: PointerEvent) => { if (peek && !aside()?.contains(e.target as Node) && !(e.target as Element).closest?.("[role=menu], [data-sidebar-toggle]")) setPeek(null) }
    const key = (e: KeyboardEvent) => { if (peek && e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=menu]")) setPeek(null) }
    addEventListener("pointermove", move, { passive: true })
    addEventListener("pointerdown", down, true)
    addEventListener("keydown", key)
    return () => {
      stopOpening(); stopClosing()
      removeEventListener("pointermove", move)
      removeEventListener("pointerdown", down, true)
      removeEventListener("keydown", key)
    }
  }, [left, right, peek])
  return peek
}
