import { AArrowDown, AArrowUp, ALargeSmall } from "lucide-react"
import { useEffect, type RefObject } from "react"
import { devicePref, getPrefs, usePrefs } from "@/core/prefs"
import { keyHint } from "@/core/commands"
import { active } from "@/core/plugins"
import { onPinch } from "@/core/pinch"
import { nextTextSize, STEPS } from "@/core/textsteps"
import { useZoomTarget } from "@/core/zoom"

/** A kind of content with a text size of its own. `label` names it in sentence case ("Terminal"). `points`: its text's
 *  size at 100%, for one that steps a point at a time and says its size in points, as terminals do. */
export type TextSizeKind = { label: string; sub?: string; points?: number; quiet?: boolean }

const CORE: Record<string, TextSizeKind> = {
  note: { label: "Note", sub: "Notes' text, title and properties" },
  code: { label: "Code", sub: "Code, text files, JSON and notebooks", quiet: true },
  table: { label: "Table", sub: "CSV files and spreadsheets", quiet: true },
}

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

export function textSizeText(kind: string, percent = textSize(kind)) {
  const points = kindOf(kind)?.points
  return points ? `${Math.round(points * percent / 100)} pt` : `${percent}%`
}

const WORDS = "font zoom bigger smaller"

export const quickTextSizeSub = () => `Or ${keyHint("Mod")} and scroll, over a note, code, a chat or a terminal`

export function textSizeCommands(disabled: string[]) {
  return [
    ...textSizeKinds(disabled).filter(([, k]) => !k.quiet).flatMap(([kind, k]) => {
      const name = k.label.toLowerCase()
      return [
        { id: `text-size:${kind}:increase`, name: `Increase ${name} text size`, run: () => stepTextSize(kind, 1), icon: AArrowUp, words: WORDS },
        { id: `text-size:${kind}:decrease`, name: `Decrease ${name} text size`, run: () => stepTextSize(kind, -1), icon: AArrowDown, words: WORDS },
        { id: `text-size:${kind}:reset`, name: `Reset ${name} text size`, when: () => textSize(kind) !== 100, run: () => stepTextSize(kind, 0), icon: ALargeSmall, words: WORDS },
      ]
    }),
  ]
}

const NOTCH = 0.095
let acc = 0, accKind = "", accAt = 0

/** ⌘+ ⌘- ⌘0 while it's focused (core/zoom.ts), and ⌘/⌃ + wheel or a pinch over `ref` (a note's, a chat's, a terminal's while Pinch
 *  to resize text is on; `always`, as any reader's), step `kind`'s size. Children's wheels come first unless `first` (a terminal). */
export function useTextSizeWheel(ref: RefObject<HTMLElement | null>, kind: string | null, { first = false, always = false }: { first?: boolean; always?: boolean } = {}) {
  useZoomTarget(ref, kind ? (step) => {
    stepTextSize(kind, step)
    return { text: `${kindOf(kind)?.label ?? "Text"} text ${textSizeText(kind)}`, actual: textSize(kind) === 100 }
  } : null)
  const pinches = usePrefs().quickTextSize || always
  useEffect(() => {
    const el = ref.current
    if (!el || !kind || !pinches) return
    return onPinch(el, { first, touches: true, zoom: (by) => pinchTextSize(kind, by), when: (e) => (first || !e.defaultPrevented) && !turned(e) })
  }, [ref, kind, first, pinches])
}
export function useSizedText(ref: RefObject<HTMLElement | null>, kind: string | null, o: { always?: boolean } = {}) {
  useTextSizeWheel(ref, kind, o)
  const percent = useTextSize(kind ?? "note")
  return kind && percent !== 100 ? { zoom: percent / 100 } : undefined
}

const turned = (e: Event) => e instanceof WheelEvent && (e.shiftKey || e.altKey)

export function pinchTextSize(kind: string, by: number) {
  const now = performance.now()
  if (kind !== accKind || now - accAt > 400) acc = 0
  accKind = kind; accAt = now
  acc += Math.log(by)
  if (Math.abs(acc) < NOTCH) return
  stepTextSize(kind, acc > 0 ? 1 : -1)
  acc = 0
}
