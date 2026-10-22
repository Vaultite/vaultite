// A sidebar hidden without its rail (appearance `rails` off) slides in over the page while the pointer is at its edge of
// the window, as Zen's compact mode does, and slides out once the pointer has left it.
import { useEffect, useRef, useState, type CSSProperties } from "react"
import { getDrag } from "@/core/drag"
import { hasLights, showLights, webPages } from "@/core/desktop"
import { space } from "@/lib/utils"

export type Peek = "left" | "right" | null
type Side = "left" | "right"

/** Slid in, the sidebar floats this far (spacing units) from the window's edges; slid out, this far (px) past its edge,
 *  its shadow too. What rides on it from outside (its toggle) moves by as much. */
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

/** The traffic lights, on the left sidebar's top row, hidden with it. The Mac draws them: moved a frame at a time they
 *  lagged its slide and flashed at their default place, so they go as it slides out and come once it has slid in. */
export function usePeekLights(hidden: boolean, peek: Peek) {
  const shown = peek === "left"
  useEffect(() => {
    if (!hasLights) return
    const aside = document.querySelector("aside[data-side=left]")
    if (hidden && !aside) return showLights(null)
    let said = "", live = true
    const say = (at: ReturnType<typeof lightsAt>) => { const now = JSON.stringify(at); if (now !== said) { said = now; showLights(at) } }
    const place = () => {
      // (only its sliding moves them: a rail folding changes its width, not where they sit)
      const sliding = aside?.getAnimations().filter((a) => (a as CSSTransition).transitionProperty === "translate") ?? []
      if (!sliding.length) return say(lightsAt(aside))
      say(null)
      void Promise.allSettled(sliding.map((a) => a.finished)).then(() => { if (live) place() })
    }
    place()
    const sized = new ResizeObserver(() => place())
    const row = aside?.querySelector("[data-titlebar]")
    if (row) sized.observe(row)
    addEventListener("resize", place)
    return () => { live = false; sized.disconnect(); removeEventListener("resize", place) }
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

const summons = new Set<(side: Side) => boolean>()

/** Slide a hidden sidebar in for what asked to show something in it (a reveal in the tree, a panel opened), instead of
 *  pinning it open. False: that sidebar isn't hidden this way (it has a rail, or it's open). */
export const peekSidebar = (side: Side) => [...summons].some((f) => f(side))

/** What the window never hears the pointer over: it's in the frame's own page. */
const FRAME = "iframe, embed, object"

/** Which hidden sidebar is slid in: `left` / `right` say which sidebars are hidden now. */
export function usePeek(left: boolean, right: boolean): Peek {
  const [peek, setPeek] = useState<Peek>(null)
  // Summoned, it stays until the pointer has been in it and left (it wasn't brought by the pointer), a click or Escape.
  const summoned = useRef(false)
  useEffect(() => { if ((peek === "left" && !left) || (peek === "right" && !right)) setPeek(null) }, [left, right, peek])
  useEffect(() => { if (!peek) summoned.current = false }, [peek])
  useEffect(() => {
    const summon = (side: Side) => {
      if (!(side === "left" ? left : right)) return false
      summoned.current = true
      setPeek(side)
      return true
    }
    summons.add(summon)
    return () => { summons.delete(summon) }
  }, [left, right])
  useEffect(() => {
    if (!left && !right) return
    let opening: { side: "left" | "right"; t: ReturnType<typeof setTimeout> } | null = null
    let closing: ReturnType<typeof setTimeout> | null = null
    const stopOpening = () => { if (opening) clearTimeout(opening.t); opening = null }
    const stopClosing = () => { if (closing) clearTimeout(closing); closing = null }
    const aside = () => (peek ? document.querySelector(`aside[data-side=${peek}]`) : null)
    const closeSoon = () => {
      if (!summoned.current && !closing) closing = setTimeout(() => { closing = null; if (!held(aside())) setPeek(null) }, LINGER)
    }
    const at = (x: number) => {
      const side = left && x <= EDGE.left.px ? "left" : right && x >= innerWidth - 1 - EDGE.right.px ? "right" : null
      if (peek) {
        const box = aside()?.getBoundingClientRect()
        const inside = !!box && x >= box.left - 8 && x <= box.right + 8
        if (inside || side === peek) { summoned.current = false; stopClosing(); return }
        closeSoon()
        return
      }
      if (side && opening?.side !== side) { stopOpening(); opening = { side, t: setTimeout(() => { opening = null; setPeek(side) }, EDGE[side].ms) } }
      else if (!side) stopOpening()
    }
    const move = (e: PointerEvent) => { if (e.pointerType !== "touch") at(e.clientX) }
    // Over a frame (an HTML file, a PDF) the window hears nothing more: the edges catch the pointer meanwhile
    // (App's data-peek-edge), and a sidebar slid in goes once the pointer has left it for one.
    const root = document.documentElement.dataset
    const over = (e: PointerEvent) => {
      const t = e.target as Element
      if (t.closest?.("[data-peek-edge]")) return
      if (e.pointerType === "touch" || !t.matches?.(FRAME)) { delete root.inFrame; return }
      root.inFrame = ""
      if (peek && !aside()?.contains(t)) closeSoon()
    }
    // A click on the page puts it away at once; Escape too, unless it's the editor's or a menu's.
    const down = (e: PointerEvent) => { if (peek && !aside()?.contains(e.target as Node) && !(e.target as Element).closest?.("[role=menu], [data-sidebar-toggle]")) setPeek(null) }
    const key = (e: KeyboardEvent) => { if (peek && e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=menu]")) setPeek(null) }
    addEventListener("pointermove", move, { passive: true })
    addEventListener("pointerover", over, { passive: true })
    addEventListener("pointerdown", down, true)
    addEventListener("keydown", key)
    // A browser tab's page is drawn over the window, which hears nothing there: the desktop app tells the moves near its
    // edges (electron/web.ts).
    const off = webPages?.on((m) => { if (m.type === "pointer") at(m.x) })
    return () => {
      stopOpening(); stopClosing(); off?.()
      removeEventListener("pointermove", move)
      removeEventListener("pointerover", over)
      removeEventListener("pointerdown", down, true)
      removeEventListener("keydown", key)
    }
  }, [left, right, peek])
  return peek
}
