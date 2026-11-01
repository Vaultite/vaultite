// Slides: "Start presentation" shows the note being read or edited as slides (slides.ts reads
// the deck), one at a time over the whole app (Presentation.tsx). Also in a note's menu.
import { lazy, Suspense } from "react"
import { FileDown, Presentation as PresentationIcon } from "lucide-react"
import { activeFile, cell, currentFile, definePlugin, notify, Panel } from "@vaultite"
import { exportAsked } from "./asked"

const Presentation = lazy(() => import("./Presentation").then((m) => ({ default: m.Presentation })))

const shown = cell<string | null>(null)
const show = shown.set
const isNote = (p: string) => /\.md$/i.test(p) && !p.startsWith(".")
/** The note in the focused tab (being read or edited). */
const here = () => { const f = currentFile() || activeFile()?.path || ""; return isNote(f) ? f : "" }

export function present(path = here()) {
  if (!path) { notify("Open a note to present it."); return }
  show(path)
}

/** Present the note and save it as one HTML file that presents itself anywhere. */
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
  preview: () => (
    <Panel title="Slides" icon={PresentationIcon} tint="var(--orange)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Present a note as slides: lines of three dashes (---) split it, and each slide is drawn as the note reads, with its
        images, embeds, math and code, scaled to the screen. Advanced Slides decks present as they do in Obsidian, with their
        speaker notes, fragments and backgrounds; S opens the presenter view, a window with the notes, the next slide and a
        timer. Start presentation from the command palette or the note's menu; arrow keys, a click or a swipe go through the
        slides, Escape ends it.
      </p>
    </Panel>
  ),
})
