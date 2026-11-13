import { useEffect, useRef, useState, type CSSProperties } from "react"
import { getDrag } from "@/core/drag"
import { hasLights, lightsFrame, showLights, webPages, type LightsFrame } from "@/core/desktop"
import { lightsCard } from "@/core/pane"
import { resizing } from "@/core/resizing"
import { space } from "@/lib/utils"
import { elementOf, nodeOf } from "@/core/dom"

export type Peek = "left" | "right" | null
type Side = "left" | "right"

const INSET = 1.5
const LINE = 0.5
const OUT = 24

export const peekPanel = (side: Side, shown: boolean): CSSProperties => ({
  top: space(INSET), bottom: space(INSET), [side]: space(INSET), outline: `${LINE}px solid var(--border)`, outlineOffset: -LINE,
  translate: shown ? undefined : `calc(${side === "left" ? -1 : 1} * (100% + ${OUT}px))`,
})

export const peekRider = (side: Side, shown: boolean, width: number): CSSProperties => {
  const x = shown ? space(INSET) : `calc(${space(INSET)} - ${width + OUT}px)`
  return { translate: `calc(${side === "left" ? 1 : -1} * ${x}) ${space(INSET)}` }
}

export function useSideMotion(hidden: boolean, shown: boolean): "in" | "out" | undefined {
  const was = useRef<{ hidden: boolean; shown: boolean; motion?: "in" | "out" }>({ hidden, shown })
  const p = was.current
  if (p.hidden !== hidden || p.shown !== shown) {
    // The Mac draws its traffic lights a frame or two late, so "out" holds till they're gone.
    const motion = !hidden ? (p.hidden && !p.shown ? "in" : undefined) : !p.hidden || (p.motion === "out" && !shown) ? "out" : undefined
    was.current = { hidden, shown, motion }
  }
  return was.current.motion
}

function spacingPx(units: number) {
  const html = document.documentElement, unit = getComputedStyle(html).getPropertyValue("--spacing")
  return units * parseFloat(unit) * (unit.endsWith("rem") ? parseFloat(getComputedStyle(html).fontSize) : 1)
}

function lightsAt(aside: Element | null) {
  const card = !aside || "leftRail" in document.documentElement.dataset ? lightsCard() : null
  if (card) return { x: card.x, mid: card.y + spacingPx(5) }
  if (!aside) return { x: 0, mid: spacingPx(5) }
  const a = aside.getBoundingClientRect(), row = aside.querySelector("[data-titlebar]")!.getBoundingClientRect()
  return a.right > 0 ? { x: a.left, mid: row.top + row.height / 2 } : null
}

function fitGhost(aside: HTMLElement, ghost: HTMLElement, f: LightsFrame) {
  const row = aside.querySelector("[data-titlebar]")
  if (!row) return
  const left = parseFloat(getComputedStyle(aside).left) || 0, top = aside.getBoundingClientRect().top
  const r = row.getBoundingClientRect(), z = f.zoom
  const x = Math.round(f.inset + left * z) + (f.width - f.size) / 2
  const y = Math.round((r.top + r.height / 2) * z - f.height / 2) + (f.height - f.size) / 2
  ghost.style.left = `${x / z - left}px`
  ghost.style.top = `${y / z - top}px`
  ghost.style.setProperty("--light-size", `${f.size / z}px`)
  ghost.style.setProperty("--light-pitch", `${f.pitch / z}px`)
}

const MOVES = new Set(["translate", "top", "left"])

// The Mac draws the traffic lights a beat behind the page, so while the sidebar slides, stand-ins take their place.
export function usePeekLights(hidden: boolean, peek: Peek) {
  const shown = peek === "left"
  const [drawn, setDrawn] = useState(shown)
  if (drawn !== shown && (shown || !hidden || !hasLights)) setDrawn(shown)
  const lights = useRef({ said: "", away: true })
  useEffect(() => {
    if (!hasLights) return
    const aside = document.querySelector<HTMLElement>("aside[data-side=left]")
    if (hidden && !aside) { void showLights(null); return }
    const ghost = aside?.querySelector<HTMLElement>("[data-lights-ghost]") ?? null
    const fit = () => { const f = lightsFrame(); if (aside && ghost && f) fitGhost(aside, ghost, f) }
    const stand = (on: boolean) => { lights.current.away = on; ghost?.toggleAttribute("data-shown", on) }
    let live = true
    fit()
    stand(lights.current.away)
    const say = (at: ReturnType<typeof lightsAt>) => {
      // The zoom too: the same place in CSS px is another in points.
      const now = JSON.stringify([at, devicePixelRatio])
      if (now === lights.current.said) return Promise.resolve()
      lights.current.said = now
      if (!at) stand(true)
      return showLights(at).then(() => {
        fit()
        if (at) setTimeout(() => { if (lights.current.said === now) stand(false) }, 40)
      })
    }
    const place = () => {
      const sliding = aside?.getAnimations().filter((a) => a instanceof CSSTransition && MOVES.has(a.transitionProperty)) ?? []
      if (sliding.length) {
        void say(null)
        void Promise.allSettled(sliding.map((a) => a.finished)).then(() => { if (live) place() })
      } else if (hidden && drawn && !shown) void say(null).then(() => requestAnimationFrame(() => { if (live) setDrawn(false) }))
      else void say(lightsAt(aside))
    }
    place()
    const sized = new ResizeObserver(() => place())
    const row = aside?.querySelector("[data-titlebar]")
    if (row) sized.observe(row)
    const looks = new MutationObserver(() => place())
    looks.observe(document.documentElement, { attributeFilter: ["data-pane-cards", "data-top-tabs", "data-left-rail"] })
    addEventListener("resize", place)
    return () => { live = false; sized.disconnect(); looks.disconnect(); removeEventListener("resize", place) }
  }, [hidden, shown, drawn])
  return drawn
}

const EDGE = { left: { px: 6, ms: 90 }, right: { px: 3, ms: 220 } }
const LINGER = 280

function held(aside: Element | null) {
  if (getDrag() || document.querySelector("[role=menu]")) return true
  const a = document.activeElement
  return !!aside && !!a && aside.contains(a) && a.matches("input, textarea, [contenteditable=true]")
}

const summons = new Set<(side: Side) => boolean>()

export const peekSidebar = (side: Side) => [...summons].some((f) => f(side))

const FRAME = "iframe, embed, object"

export function usePeek(left: boolean, right: boolean): Peek {
  const [peek, setPeek] = useState<Peek>(null)
  const summoned = useRef(false)
  if ((peek === "left" && !left) || (peek === "right" && !right)) setPeek(null)
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
      if (resizing()) { stopOpening(); return }
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
    // Over a frame (an HTML file, a PDF) the window hears no pointer moves, so edges of our own catch it meanwhile.
    const root = document.documentElement.dataset
    const over = (e: PointerEvent) => {
      const t = elementOf(e.target)
      if (t?.closest("[data-peek-edge]")) return
      if (e.pointerType === "touch" || !t?.matches(FRAME)) { delete root.inFrame; return }
      root.inFrame = ""
      if (peek && !aside()?.contains(t)) closeSoon()
    }
    const down = (e: PointerEvent) => { if (peek && !aside()?.contains(nodeOf(e.target)) && !elementOf(e.target)?.closest("[role=menu], [data-sidebar-toggle]")) setPeek(null) }
    const key = (e: KeyboardEvent) => { if (peek && e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=menu]")) setPeek(null) }
    addEventListener("pointermove", move, { passive: true })
    addEventListener("pointerover", over, { passive: true })
    addEventListener("pointerdown", down, true)
    addEventListener("keydown", key)
    // A browser tab's page is drawn over the window, which hears nothing there: the desktop app sends the moves.
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
