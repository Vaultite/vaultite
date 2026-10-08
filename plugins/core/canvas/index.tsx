// Canvas (JSON Canvas): an infinite board of cards in groups, joined by arrows, saved and merged like
// any file; embeds show a picture. As text for AIs: its cards and connections.
import { lazy, Suspense, type ReactNode } from "react"
import { LayoutDashboard, Scan, ZoomIn, ZoomOut } from "lucide-react"
import { besideActive, definePlugin, freeName, getStore, openNew, post, reload, type FileFormat } from "@vaultite"
import { parseCanvas } from "./codec"
import { focusedBoard, panStep } from "./keys"

const Board = lazy(() => import("./Board"))

const EMPTY = JSON.stringify({ nodes: [], edges: [] }, null, "\t") + "\n"

/** Where a new canvas goes: next to the note being written (not a page: a dashboard), else Canvases/. */
const whereNew = () => besideActive("Canvases")

async function newCanvas(folder = whereNew()) {
  const s = getStore()
  const name = s ? freeName(s.files, folder, "Canvas", ".canvas") : "Canvas"
  const f = await post<{ path: string }>("file", { path: `${folder ? `${folder}/` : ""}${name}.canvas`, text: EMPTY, unique: true })
  await reload()
  return f.path
}

const box = (node: ReactNode) => <Suspense fallback={<div className="absolute inset-0" aria-busy />}>{node}</Suspense>

const format: FileFormat = {
  exts: ["canvas"], icon: LayoutDashboard, tint: "var(--teal)", json: true, layout: "pane",
  // (its words would be the JSON's)
  status: (text) => { try { const n = parseCanvas(text).nodes.filter((x) => x.type !== "group").length; return `${n} ${n === 1 ? "card" : "cards"}` } catch { return null } },
  render: (ctx) => box(<Board {...ctx} />),
  embed: (ctx) => box(<Board {...ctx} editable={false} place="embed" />),
}

// A made-up canvas for the Plugins sheet.
const SAMPLE = JSON.stringify({
  nodes: [
    { id: "g", type: "group", label: "Lighthouse", x: -40, y: -60, width: 620, height: 260, color: "5" },
    { id: "a", type: "text", text: "## Launch plan\nShip the beta to **Alice Park** and **Bob Lee**.", x: 0, y: 0, width: 240, height: 120, color: "4" },
    { id: "b", type: "text", text: "Collect feedback", x: 320, y: 30, width: 200, height: 60 },
    { id: "c", type: "link", url: "https://example.com", x: 320, y: 260, width: 240, height: 100 },
  ],
  edges: [{ id: "e1", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left", label: "then" }, { id: "e2", fromNode: "b", fromSide: "bottom", toNode: "c", toSide: "top", color: "2" }],
})

export default definePlugin({
  icon: LayoutDashboard,
  formats: { canvas: format },
  newFiles: [{ label: "New canvas", icon: LayoutDashboard, make: newCanvas }],
  commands: [
    { id: "canvas:new", name: "New canvas", run: () => void newCanvas().then((p) => openNew(p)) },
    // While a board has the keyboard: the arrows pan it (with nothing selected: selected cards move instead), + and -
    // zoom. Vim's h/j/k/l pan too (the Vim vault plugin's lists.ts).
    ...([["left", "ArrowLeft", -1, 0], ["right", "ArrowRight", 1, 0], ["up", "ArrowUp", 0, -1], ["down", "ArrowDown", 0, 1]] as const).map(([dir, key, x, y]) => ({
      id: `canvas:pan-${dir}`, name: `Pan the canvas ${dir}`, keys: [key],
      when: () => { const b = focusedBoard(); return !!b && !b.selected() }, run: () => { const b = focusedBoard(); if (b) b.pan(x * panStep(b), y * panStep(b)) },
    })),
    { id: "canvas:zoom-in", name: "Zoom in on the canvas", keys: ["Shift+=", "="], when: () => !!focusedBoard(), run: () => focusedBoard()?.zoom(1.25), icon: ZoomIn },
    { id: "canvas:zoom-out", name: "Zoom out of the canvas", keys: ["-"], when: () => !!focusedBoard(), run: () => focusedBoard()?.zoom(0.8), icon: ZoomOut },
    { id: "canvas:fit", name: "Zoom the canvas to fit", when: () => !!focusedBoard(), run: () => focusedBoard()?.fit(), icon: Scan },
  ],
  slash: () => [{
    id: "canvas:new", title: "Canvas", section: "Canvas", keywords: "canvas board cards whiteboard json", detail: "New canvas",
    line: true,
    run: async (put) => { const p = await newCanvas(); put(`![[${p}]]\n`) },
  }],
  preview: (mock) => <div className="relative h-[240px] overflow-hidden rounded-[12px]">{box(<Board text={SAMPLE} editable={false} place="embed" path="Lighthouse.canvas" onChange={() => {}} store={mock} />)}</div>,
})
