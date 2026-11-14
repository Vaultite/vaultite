import { lazy, Suspense } from "react"
import { FileDown, Presentation as PresentationIcon } from "lucide-react"
import { activeFile, cell, currentFile, definePlugin, notify } from "@vaultite"
import { exportAsked } from "./asked"

const Presentation = lazy(() => import("./Presentation").then((m) => ({ default: m.Presentation })))

const shown = cell<string | null>(null)
const show = shown.set
const isNote = (p: string) => /\.md$/i.test(p) && !p.startsWith(".")
const here = () => { const f = currentFile() || activeFile()?.path || ""; return isNote(f) ? f : "" }

export function present(path = here()) {
  if (!path) { notify("Open a note to present it."); return }
  show(path)
}

export function exportHtml(path = shown.get() ?? here()) {
  if (!path) { notify("Open a note to export it as slides."); return }
  show(path)
  exportAsked.set(path)
}

function Shown() {
  const path = shown.use()
  return path ? <Suspense fallback={null}><Presentation key={path} path={path} onClose={() => show(null)} /></Suspense> : null
}

export default definePlugin({
  commands: [
    { id: "slides:start", name: "Start presentation", when: () => !!here() && !shown.get(), run: () => present() },
    { id: "slides:export-html", name: "Export slides as HTML", when: () => !!(shown.get() || here()), run: () => exportHtml() },
  ],
  fileMenu: (path) => (isNote(path) ? [
    { label: "Start presentation", icon: PresentationIcon, section: "more", run: () => present(path) },
    { label: "Export slides as HTML", icon: FileDown, section: "more", run: () => exportHtml(path) },
  ] : []),
  background: () => <Shown />,
})
