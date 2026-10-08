// Text sizes per kind of content (notes, terminals, plugins' `textSizes`) apart from the app's zoom, like VS Code's
// editor and terminal font sizes. Per device: a phone and a laptop want different sizes.
import { AArrowDown, AArrowUp, ALargeSmall } from "lucide-react"
import { useEffect, type RefObject } from "react"
import { devicePref, usePrefs } from "@/core/prefs"
import { active } from "@/core/plugins"

/** A kind of content with a text size of its own. `label` names it in sentence case ("Terminal"). */
export type TextSizeKind = { label: string; sub?: string }

/** The core's own kind: notes. */
const CORE: Record<string, TextSizeKind> = { note: { label: "Note", sub: "Notes' text, title and properties" } }

/** The sizes, in percent: 10% apart near 100%, wider further out. */
export const STEPS = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 170, 200, 250, 300]

/** The kinds there are now: the core's, then the plugins' that are on, by id. */
export function textSizeKinds(disabled: string[], order: string[]): [string, TextSizeKind][] {
  return [...Object.entries(CORE), ...active(disabled, order).flatMap((p) => Object.entries(p.textSizes ?? {}))]
}

const pref = (kind: string) => devicePref<number>(`textSize:${kind}`, 100)
const valid = (v: unknown) => (typeof v === "number" && v >= STEPS[0] && v <= STEPS[STEPS.length - 1] ? v : 100)

/** A kind's size now, in percent (100: as the app draws it). */
export const textSize = (kind: string) => valid(pref(kind).get())

/** A kind's size, redrawn when it changes (any pref change redraws; it's cheap). */
export function useTextSize(kind: string) {
  usePrefs()
  return textSize(kind)
}

/** Set a kind's size, in percent (kept within STEPS' range). */
export function setTextSize(kind: string, percent: number) {
  pref(kind).set(Math.min(STEPS[STEPS.length - 1], Math.max(STEPS[0], Math.round(percent))))
}

/** One step bigger (1), smaller (-1), or back to 100% (0). */
export function stepTextSize(kind: string, step: -1 | 0 | 1) {
  if (step === 0) return setTextSize(kind, 100)
  const now = textSize(kind)
  const next = step > 0 ? STEPS.find((s) => s > now) : [...STEPS].reverse().find((s) => s < now)
  if (next !== undefined) setTextSize(kind, next)
}

/** Each kind's three commands, for the palette (no keys by default). */
export function textSizeCommands(disabled: string[], order: string[]) {
  return textSizeKinds(disabled, order).flatMap(([kind, k]) => {
    const name = k.label.toLowerCase()
    return [
      { id: `text-size:${kind}:increase`, name: `Increase ${name} text size`, run: () => stepTextSize(kind, 1), icon: AArrowUp },
      { id: `text-size:${kind}:decrease`, name: `Decrease ${name} text size`, run: () => stepTextSize(kind, -1), icon: AArrowDown },
      { id: `text-size:${kind}:reset`, name: `Reset ${name} text size`, when: () => textSize(kind) !== 100, run: () => stepTextSize(kind, 0), icon: ALargeSmall },
    ]
  })
}

/** How far the wheel goes for one step: a mouse's notch is one; a trackpad's pinch or scroll sends many small deltas,
 *  added up. */
const NOTCH = 50
let acc = 0, accKind = "", accAt = 0

/** ⌘/⌃ + wheel (or a pinch) over `ref` steps `kind`'s size instead of zooming the page. Children using the wheel
 *  keep it (preventDefault) unless `first`, which takes it before them (a terminal scrolls on every wheel event). */
export function useTextSizeWheel(ref: RefObject<HTMLElement | null>, kind: string | null, first = false) {
  useEffect(() => {
    const el = ref.current
    if (!el || !kind) return
    const on = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || (!first && e.defaultPrevented)) return
      e.preventDefault()
      if (first) e.stopPropagation()
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
      // A pinch's deltas are small (and ⌃ comes with them): weigh them up so a pinch changes the size at a useful pace.
      const d = e.ctrlKey && !e.metaKey && Math.abs(px) < 10 ? px * 5 : px
      if (kind !== accKind || e.timeStamp - accAt > 400) acc = 0
      accKind = kind; accAt = e.timeStamp
      acc += Math.abs(px) >= NOTCH ? Math.sign(d) * NOTCH : d
      if (Math.abs(acc) < NOTCH) return
      stepTextSize(kind, acc < 0 ? 1 : -1)
      acc = 0
    }
    el.addEventListener("wheel", on, { passive: false, capture: first })
    return () => el.removeEventListener("wheel", on, { capture: first })
  }, [ref, kind, first])
}
