import { dockAtEnd, offerPanel, panelSide, pluginSettings, revealPanel } from "@vaultite"
import { type Note, pick, viewOf } from "./live"
import { nearest } from "./text"

const settings = pluginSettings<{ comments?: string }>("companion")
export const inMargin = () => settings.get().comments !== "sidebar"
export const useInMargin = () => settings.use().comments !== "sidebar"

export const PANEL = "companion:conversations"

export function showThread(id: string) {
  pick(id)
  if (!revealPanel(PANEL)) dockAtEnd(PANEL, "right")
}

const PLACED = "vaultite.companion.panel"
export function offerThreads() {
  if (inMargin()) return
  if (!panelSide(PANEL)) {
    try { if (localStorage.getItem(PLACED)) return; localStorage.setItem(PLACED, "1") } catch { return }
  }
  offerPanel(PANEL, "right")
}

export function threadsOf(notes: Note[], path: string): Note[] {
  const mine = notes.filter((n) => n.path === path && (n.kind === "comment" || n.kind === "suggestion" || n.kind === "proposal"))
  const v = viewOf(path), doc = v?.state.doc, text = doc?.toString()
  const at = (n: Note) => {
    const i = text && n.find ? nearest(text, n.find, n.line) : -1
    if (i >= 0) return i
    return doc && n.line ? doc.line(Math.max(1, Math.min(n.line, doc.lines))).from : (n.line ?? 0) * 1e4
  }
  return mine.map((n) => ({ n, at: at(n) })).sort((a, b) => a.at - b.at || a.n.t - b.n.t).map((x) => x.n)
}
