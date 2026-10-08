// Slides: "Start presentation" shows the note being read or edited as slides (split at
// `---` lines), one at a time over the whole app (Presentation.tsx). Also in a note's menu.
import { useSyncExternalStore } from "react"
import { Presentation as PresentationIcon } from "lucide-react"
import { activeFile, currentFile, definePlugin, notify, Panel } from "@vaultite"
import { Presentation } from "./Presentation"

let shown: string | null = null
const subs = new Set<() => void>()
const show = (path: string | null) => { shown = path; subs.forEach((f) => f()) }
const isNote = (p: string) => /\.md$/i.test(p) && !p.startsWith(".")
/** The note in the focused tab (being read or edited). */
const here = () => { const f = currentFile() || activeFile()?.path || ""; return isNote(f) ? f : "" }

export function present(path = here()) {
  if (!path) { notify("Open a note to present it."); return }
  show(path)
}

function Shown() {
  const path = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => shown)
  return path ? <Presentation key={path} path={path} onClose={() => show(null)} /> : null
}

export default definePlugin({
  icon: PresentationIcon,
  commands: [{ id: "slides:start", name: "Start presentation", when: () => !!here() && !shown, run: () => present() }],
  fileMenu: (path) => (isNote(path) ? [{ label: "Start presentation", icon: PresentationIcon, section: "more", run: () => present(path) }] : []),
  background: () => <Shown />,
  preview: () => (
    <Panel title="Slides" icon={PresentationIcon} tint="var(--orange)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Present a note as slides: lines of three dashes (---) split it, and each slide is drawn as the note reads, with its
        images, embeds, math and code, scaled to the screen. Start presentation from the command palette or the note's menu;
        arrow keys, a click or a swipe go through the slides, Escape ends it.
      </p>
    </Panel>
  ),
})
