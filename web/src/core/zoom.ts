// ⌘+ ⌘- ⌘0 zoom what you're looking at, as its own app would: a note's or a terminal's text (core/textsize.ts), a site,
// a canvas; else the desktop app's interface size (its own keys too: ⌥⌘+ ⌥⌘- ⌥⌘0), or in a browser the browser's zoom.
import { useEffect, useRef, type RefObject } from "react"
import { Scan, ZoomIn, ZoomOut } from "lucide-react"
import type { Command } from "@/core/commands"
import { desktop } from "@/core/desktop"
import { notify } from "@/core/notify"
import { isDesktop } from "@/core/platform"
import { cell } from "@/core/signal"
import { activePane } from "@/core/workspace"

export type ZoomStep = -1 | 0 | 1
/** What a zoom came to, for the line that says so ("Note text 120%"); `actual`: at its own size, so no Reset. Null:
 *  nothing to say (a canvas shows its zoom itself). */
export type Zoomed = { text: string; actual: boolean } | null
/** A step in (1), out (-1) or back to actual size (0) of what an element draws. */
export type Zoom = (step: ZoomStep) => Zoomed | Promise<Zoomed>

const targets = new Map<HTMLElement, Zoom>()

/** ⌘+ ⌘- ⌘0 zoom what `ref` draws while the keyboard is in it or it's in the focused pane (null: they don't). */
export function useZoomTarget(ref: RefObject<HTMLElement | null>, zoom: Zoom | null) {
  const live = useRef(zoom)
  useEffect(() => { live.current = zoom })
  const on = !!zoom
  useEffect(() => {
    const el = ref.current
    if (!el || !on) return
    const z: Zoom = (step) => live.current?.(step) ?? null
    targets.set(el, z)
    return () => { if (targets.get(el) === z) targets.delete(el) }
  }, [ref, on])
}

/** What the keys zoom now: the target the keyboard is in, else the focused pane's (its outermost: a note, not a view in
 *  it); none while the keyboard is in a sheet or a dialog, which covers the pane. */
export function zoomTarget(): Zoom | null {
  // (a web page holding the keyboard leaves the window's page unfocused, its pane the focused one)
  const a = document.hasFocus() ? document.activeElement : null
  for (let n = a; n; n = n.parentElement) { const z = n instanceof HTMLElement && targets.get(n); if (z) return z }
  if (a?.closest("dialog[open], [role=dialog]")) return null
  const id = activePane()?.id
  const pane = id ? document.querySelector(`[data-pane="${CSS.escape(id)}"]`) : null
  if (!pane) return null
  let best: HTMLElement | null = null
  for (const el of targets.keys()) if (pane.contains(el) && (!best || el.compareDocumentPosition(best) & Node.DOCUMENT_POSITION_FOLLOWING)) best = el
  return best ? targets.get(best)! : null
}

// ---------- the interface size: the desktop app's whole-window zoom, every window's, this computer's ----------

const ui = desktop?.interfaceSize
/** Its ends (electron/main.ts ZOOMS'). */
export const INTERFACE_MIN = 0.5, INTERFACE_MAX = 3
const size = cell(1)
if (ui) {
  void ui.get().then(size.set, () => {})
  ui.on(size.set)
}
/** The interface size (1: actual size), redrawn as it changes; null outside the desktop app. */
export const useInterfaceSize = () => { const z = size.use(); return ui ? z : null }
/** The interface size a step bigger, smaller or back to actual size; answers it (null: no desktop app). */
export async function stepInterfaceSize(step: ZoomStep) {
  if (!ui) return null
  const z = await ui.step(step)
  size.set(z)
  return z
}
const percent = (z: number) => `${Math.round(z * 100)}%`
const interfaceZoom: Zoom = async (step) => {
  const z = await stepInterfaceSize(step)
  return z === null ? null : { text: `Interface ${percent(z)}`, actual: Math.abs(z - 1) < 0.001 }
}

/** Zoom `zoom` and say where it's at, Chrome's bubble as a toast (one at a time), with Reset back to actual size. */
async function zoomWith(zoom: Zoom, step: ZoomStep) {
  const shown = await zoom(step)
  if (!shown) return
  notify(shown.text, { id: "zoom", duration: 2000, action: shown.actual ? undefined : { label: "Reset", run: () => zoomWith(zoom, 0) } })
}

// (a key in the desktop app always zooms something; a browser's zoom is its own unless a target takes it, and a phone's
// is pinches)
const canZoom = () => !!ui || (isDesktop() && !!zoomTarget())
const zoomFocused = (step: ZoomStep) => () => zoomWith(zoomTarget() ?? interfaceZoom, step)
const WORDS = "zoom bigger smaller font text size"

/** ⌘+ ⌘- ⌘0, and the interface size's commands in the desktop app. */
export function zoomCommands(): Command[] {
  return [
    { id: "zoom:in", name: "Zoom in", keys: ["Mod+=", "Mod+Shift+="], when: canZoom, run: zoomFocused(1), icon: ZoomIn, words: WORDS },
    { id: "zoom:out", name: "Zoom out", keys: ["Mod+-"], when: canZoom, run: zoomFocused(-1), icon: ZoomOut, words: WORDS },
    { id: "zoom:reset", name: "Reset zoom", keys: ["Mod+0"], when: canZoom, run: zoomFocused(0), icon: Scan, words: `${WORDS} actual` },
    // (⌥⌘, Safari's other zoom: ⌃⌘= evens out panes; in an editor ⌥⌘0 removes a heading, the more particular)
    ...(ui ? [
      { id: "interface-size:increase", name: "Increase interface size", keys: ["Mod+Alt+=", "Mod+Alt+Shift+="], run: () => zoomWith(interfaceZoom, 1), icon: ZoomIn, words: `${WORDS} app window` },
      { id: "interface-size:decrease", name: "Decrease interface size", keys: ["Mod+Alt+-"], run: () => zoomWith(interfaceZoom, -1), icon: ZoomOut, words: `${WORDS} app window` },
      { id: "interface-size:reset", name: "Reset interface size", keys: ["Mod+Alt+0"], when: () => Math.abs(size.get() - 1) > 0.001, run: () => zoomWith(interfaceZoom, 0), icon: Scan, words: `${WORDS} app window actual` },
    ] satisfies Command[] : []),
  ]
}
