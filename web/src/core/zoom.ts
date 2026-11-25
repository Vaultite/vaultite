import { useEffect, useRef, type RefObject } from "react"
import { Maximize, Scan, ZoomIn, ZoomOut } from "lucide-react"
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

export type ZoomTarget = { zoom: Zoom; fit?: () => void; keyboardIn?: boolean }
const targets = new Map<HTMLElement, ZoomTarget>()

/** ⌘+ ⌘- ⌘0 zoom what `ref` draws while the keyboard is in it or (but for one part of a page: `keyboardIn`) it's in the
 *  focused pane (null: they don't). `fit`: what Zoom to fit does there. */
export function useZoomTarget(ref: RefObject<HTMLElement | null>, zoom: Zoom | null, { fit, keyboardIn }: { fit?: () => void; keyboardIn?: boolean } = {}) {
  const live = useRef({ zoom, fit })
  useEffect(() => { live.current = { zoom, fit } })
  const on = !!zoom, fits = !!fit
  useEffect(() => {
    const el = ref.current
    if (!el || !on) return
    const t: ZoomTarget = { zoom: (step) => live.current.zoom?.(step) ?? null, fit: fits ? () => live.current.fit?.() : undefined, keyboardIn }
    targets.set(el, t)
    return () => { if (targets.get(el) === t) targets.delete(el) }
  }, [ref, on, fits, keyboardIn])
}

export function keyboardAt() {
  // A web page in a pane holding the keyboard leaves document.hasFocus() false.
  const a = document.hasFocus() ? document.activeElement : null
  return a?.closest("[data-palette]") || a === document.body ? null : a
}

export function zoomTarget(): ZoomTarget | null {
  const a = keyboardAt()
  for (let n = a; n; n = n.parentElement) { const z = n instanceof HTMLElement && targets.get(n); if (z) return z }
  if (a?.closest("dialog[open], [role=dialog]")) return null
  const id = activePane()?.id
  const pane = id ? document.querySelector(`[data-pane="${CSS.escape(id)}"]`) : null
  if (!pane) return null
  let best: HTMLElement | null = null
  for (const [el, t] of targets) if (!t.keyboardIn && pane.contains(el) && (!best || el.compareDocumentPosition(best) & Node.DOCUMENT_POSITION_FOLLOWING)) best = el
  return best ? targets.get(best)! : null
}

const ui = desktop?.interfaceSize
export const INTERFACE_MIN = 0.5, INTERFACE_MAX = 3
const size = cell(1)
if (ui) {
  void ui.get().then(size.set, () => {})
  ui.on(size.set)
}
export const useInterfaceSize = () => { const z = size.use(); return ui ? z : null }
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

async function zoomWith(zoom: Zoom, step: ZoomStep) {
  const shown = await zoom(step)
  if (!shown) return
  notify(shown.text, { id: "zoom", duration: 2000, action: shown.actual ? undefined : { label: "Reset", run: () => zoomWith(zoom, 0) } })
}

const canZoom = () => !!ui || (isDesktop() && !!zoomTarget())
const zoomFocused = (step: ZoomStep) => () => zoomWith(zoomTarget()?.zoom ?? interfaceZoom, step)
const WORDS = "zoom bigger smaller font text size"

export function zoomCommands(): Command[] {
  return [
    { id: "zoom:in", name: "Zoom in", keys: ["Mod+=", "Mod+Shift+="], when: canZoom, run: zoomFocused(1), icon: ZoomIn, words: WORDS },
    { id: "zoom:out", name: "Zoom out", keys: ["Mod+-"], when: canZoom, run: zoomFocused(-1), icon: ZoomOut, words: WORDS },
    { id: "zoom:fit", name: "Zoom to fit", when: () => !!zoomTarget()?.fit, run: () => zoomTarget()?.fit?.(), icon: Maximize, words: WORDS },
    { id: "zoom:reset", name: "Reset zoom", keys: ["Mod+0"], when: canZoom, run: zoomFocused(0), icon: Scan, words: `${WORDS} actual` },
    ...(ui ? [
      { id: "interface-size:increase", name: "Increase interface size", keys: ["Mod+Alt+=", "Mod+Alt+Shift+="], run: () => zoomWith(interfaceZoom, 1), icon: ZoomIn, words: `${WORDS} app window` },
      { id: "interface-size:decrease", name: "Decrease interface size", keys: ["Mod+Alt+-"], run: () => zoomWith(interfaceZoom, -1), icon: ZoomOut, words: `${WORDS} app window` },
      { id: "interface-size:reset", name: "Reset interface size", keys: ["Mod+Alt+0"], when: () => Math.abs(size.get() - 1) > 0.001, run: () => zoomWith(interfaceZoom, 0), icon: Scan, words: `${WORDS} app window actual` },
    ] satisfies Command[] : []),
  ]
}
