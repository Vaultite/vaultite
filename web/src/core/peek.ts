// A sidebar hidden without its rail (appearance `rails` off) slides in over the page while the pointer is at its edge of
// the window, as Zen's compact mode does, and slides out once the pointer has left it.
import { useEffect, useState, type CSSProperties } from "react"
import { getDrag } from "@/core/drag"
import { hasLights, showLights } from "@/core/desktop"
import { space } from "@/lib/utils"

export type Peek = "left" | "right" | null
type Side = "left" | "right"

/** Slid in, the sidebar floats this far (spacing units) from the window's edges; slid out, this far (px) past its edge,
 *  its shadow too. What rides on it from outside (its toggle, the Mac's traffic lights) moves by as much. */
const INSET = 1.5
// Its edge, an outline drawn inside: a border would move what's in it (a whole pixel on a 1x screen).
const LINE = 0.5
const OUT = 24

/** The floating sidebar's place: `shown` slid in. */
export const peekPanel = (side: Side, shown: boolean): CSSProperties => ({
  top: space(INSET), bottom: space(INSET), [side]: space(INSET), outline: `${LINE}px solid var(--border)`, outlineOffset: -LINE,
  translate: shown ? undefined : `calc(${side === "left" ? -1 : 1} * (100% + ${OUT}px))`,
})

/** How far what rides on a floating sidebar `width` px wide moves from where it sits beside a pinned one. */
export const peekRider = (side: Side, shown: boolean, width: number): CSSProperties => {
  const x = shown ? space(INSET) : `calc(${space(INSET)} - ${width + OUT}px)`
  return { translate: `calc(${side === "left" ? 1 : -1} * ${x}) ${space(INSET)}` }
}

/** Where the traffic lights go (CSS px): `x` the left sidebar's edge from the window's, `mid` the centre line of
 *  its top row, where the toggle and its header's items are; a pop-out's top bar is as tall (10 spacing units). */
function lightsAt(aside: Element | null) {
  if (!aside) {
    const html = document.documentElement, unit = getComputedStyle(html).getPropertyValue("--spacing")
    return { x: 0, mid: 5 * parseFloat(unit) * (unit.endsWith("rem") ? parseFloat(getComputedStyle(html).fontSize) : 1) }
  }
  const a = aside.getBoundingClientRect(), row = aside.querySelector("[data-titlebar]")!.getBoundingClientRect()
  return a.right > 0 ? { x: a.left, mid: row.top + row.height / 2 } : null
}

/** The traffic lights, centred on the left sidebar's top row in any density or zoom: hidden with it, and carried by it
 *  a frame at a time as it slides (they're the window's, drawn by the Mac: no transition moves them). */
export function usePeekLights(hidden: boolean, peek: Peek) {
  const shown = peek === "left"
  useEffect(() => {
    if (!hasLights) return
    const aside = document.querySelector("aside[data-side=left]")
    if (hidden && !aside) return showLights(null)
    let frame = 0, said = ""
    const follow = () => {
      cancelAnimationFrame(frame)
      const at = lightsAt(aside)
      const now = JSON.stringify(at)
      if (now !== said) { said = now; showLights(at) }
      if (aside?.getAnimations().length) frame = requestAnimationFrame(follow)
    }
    follow()
    const sized = new ResizeObserver(() => follow())
    const row = aside?.querySelector("[data-titlebar]")
    if (row) sized.observe(row)
    addEventListener("resize", follow)
    return () => { cancelAnimationFrame(frame); sized.disconnect(); removeEventListener("resize", follow) }
  }, [hidden, shown])
}

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
