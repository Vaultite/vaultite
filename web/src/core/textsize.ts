// Text sizes per kind of content (notes, terminals, plugins' `textSizes`) apart from the interface size, like VS Code's
// editor and terminal font sizes; ⌘+ ⌘- ⌘0 step the focused one (core/zoom.ts). Per device: a phone and a laptop differ.
import { AArrowDown, AArrowUp, ALargeSmall } from "lucide-react"
import { useEffect, type RefObject } from "react"
import { devicePref, getPrefs, usePrefs } from "@/core/prefs"
import { keyHint } from "@/core/commands"
import { active } from "@/core/plugins"
import { nextTextSize, STEPS } from "@/core/textsteps"
import { useZoomTarget } from "@/core/zoom"

/** A kind of content with a text size of its own. `label` names it in sentence case ("Terminal"). `points`: its text's
 *  size at 100%, for one that steps a point at a time and says its size in points, as terminals do. */
export type TextSizeKind = { label: string; sub?: string; points?: number }

/** The core's own kind: notes. */
const CORE: Record<string, TextSizeKind> = { note: { label: "Note", sub: "Notes' text, title and properties" } }

/** The kinds there are now: the core's, then the plugins' that are on, by id. */
export function textSizeKinds(disabled: string[]): [string, TextSizeKind][] {
  return [...Object.entries(CORE), ...active(disabled).flatMap((p) => Object.entries(p.textSizes ?? {}))]
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

const kindOf = (kind: string) => textSizeKinds(getPrefs().disabled).find(([k]) => k === kind)?.[1]

/** One step bigger (1), smaller (-1), or back to 100% (0). */
export function stepTextSize(kind: string, step: -1 | 0 | 1) {
  if (step === 0) return setTextSize(kind, 100)
  const next = nextTextSize(textSize(kind), step, kindOf(kind)?.points)
  if (next !== undefined) setTextSize(kind, next)
}

/** A kind's size as said: "14 pt" for one in points, else "120%". */
export function textSizeText(kind: string, percent = textSize(kind)) {
  const points = kindOf(kind)?.points
  return points ? `${Math.round(points * percent / 100)} pt` : `${percent}%`
}

const WORDS = "font zoom bigger smaller"

/** What Pinch to resize text (`quickTextSize`, a switch: core/switches.ts) does, under its name. */
export const quickTextSizeSub = () => `Or ${keyHint("Mod")} and scroll, over a note or terminal`

/** Each kind's three commands, for the palette (no keys by default). */
export function textSizeCommands(disabled: string[]) {
  return [
    ...textSizeKinds(disabled).flatMap(([kind, k]) => {
      const name = k.label.toLowerCase()
      return [
        { id: `text-size:${kind}:increase`, name: `Increase ${name} text size`, run: () => stepTextSize(kind, 1), icon: AArrowUp, words: WORDS },
        { id: `text-size:${kind}:decrease`, name: `Decrease ${name} text size`, run: () => stepTextSize(kind, -1), icon: AArrowDown, words: WORDS },
        { id: `text-size:${kind}:reset`, name: `Reset ${name} text size`, when: () => textSize(kind) !== 100, run: () => stepTextSize(kind, 0), icon: ALargeSmall, words: WORDS },
      ]
    }),
  ]
}

/** How far the wheel goes for one step: a mouse's notch is one; a trackpad's pinch or scroll sends many small deltas,
 *  added up. */
const NOTCH = 50
let acc = 0, accKind = "", accAt = 0

/** ⌘+ ⌘- ⌘0 while it's focused (core/zoom.ts), and ⌘/⌃ + wheel or a pinch over `ref` while Pinch to resize text is on (off as in
 *  Obsidian: pinches set it off by accident), step `kind`'s size. Children's wheels come first unless `first` (a terminal). */
export function useTextSizeWheel(ref: RefObject<HTMLElement | null>, kind: string | null, first = false) {
  useZoomTarget(ref, kind ? (step) => {
    stepTextSize(kind, step)
    return { text: `${kindOf(kind)?.label ?? "Text"} text ${textSizeText(kind)}`, actual: textSize(kind) === 100 }
  } : null)
  useEffect(() => {
    const el = ref.current
    if (!el || !kind) return
    const on = (e: WheelEvent) => {
      if (!getPrefs().quickTextSize || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || (!first && e.defaultPrevented)) return
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
