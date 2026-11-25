import { Maximize, MoveHorizontal, Scan, ZoomIn, ZoomOut } from "lucide-react"
import type { Command } from "@/core/commands"
import type { PanZoom } from "@/core/panzoomer"
import { activePane } from "@/core/workspace"

type Viewer = { box: HTMLElement; zoom: PanZoom }
const viewers = new Set<Viewer>()
export function addViewer(v: Viewer) {
  viewers.add(v)
  return () => { viewers.delete(v) }
}

function viewer(): PanZoom | null {
  const a = document.activeElement
  for (const v of viewers) if (a && v.box.contains(a)) return v.zoom
  if (a && a !== document.body) return null
  const id = activePane()?.id, pane = id ? document.querySelector(`[data-pane="${CSS.escape(id)}"]`) : null
  for (const v of viewers) if (pane?.contains(v.box) && v.box.closest("[data-format-pane]")) return v.zoom
  return null
}

const here = () => !!viewer()
const close = () => !!viewer()?.zoomed
const WORDS = "image picture photo diagram magnify"

export function viewerCommands(): Command[] {
  const pan = (dir: string, x: number, y: number): Command => ({ id: `viewer:pan-${dir}`, name: `Pan the picture ${dir}`, keys: [`Arrow${dir[0].toUpperCase()}${dir.slice(1)}`],
    when: close, run: () => viewer()?.pan(x * 120, y * 120), words: WORDS })
  return [
    { id: "viewer:zoom-in", name: "Zoom in on the picture", keys: ["=", "Shift+="], when: here, run: () => viewer()?.step(1), icon: ZoomIn, words: WORDS },
    { id: "viewer:zoom-out", name: "Zoom out of the picture", keys: ["-"], when: here, run: () => viewer()?.step(-1), icon: ZoomOut, words: WORDS },
    { id: "viewer:fit", name: "Zoom the picture to fit", keys: ["Shift+1"], when: here, run: () => viewer()?.fit(), icon: Maximize, words: WORDS },
    { id: "viewer:fit-width", name: "Zoom the picture to its width", keys: ["Shift+2"], when: here, run: () => viewer()?.fitWidth(), icon: MoveHorizontal, words: WORDS },
    { id: "viewer:actual", name: "Zoom the picture to 100%", keys: ["Shift+0"], when: here, run: () => viewer()?.zoomTo(1), icon: Scan, words: `${WORDS} actual size` },
    pan("left", -1, 0), pan("right", 1, 0), pan("up", 0, -1), pan("down", 0, 1),
  ]
}
