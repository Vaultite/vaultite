// Comments and suggestions as threads: where they show (the setting `comments`), a note's in its order, and the
// Conversations panel brought into sight for one.
import { dockAtEnd, offerPanel, panelSide, pluginSettings, revealPanel } from "@vaultite"
import { type Note, pick, viewOf } from "./live"
import { nearest } from "./text"

const settings = pluginSettings<{ comments?: string }>("companion")
/** Where comments and suggestions show: cards in the margin (the default), or the Conversations panel, a dot by each
 *  one's line. */
export const inMargin = () => settings.get().comments !== "sidebar"
export const useInMargin = () => settings.use().comments !== "sidebar"

/** The Conversations panel's key. */
export const PANEL = "companion:conversations"

/** A thread shown in the panel, picked (its line lit): the user asked, so a closed sidebar opens (a phone's drawer). */
export function showThread(id: string) {
  pick(id)
  if (!revealPanel(PANEL)) dockAtEnd(PANEL, "right")
}

const PLACED = "vaultite.companion.panel"
/** Threads came (a note with some opened, an agent commenting): the panel unfolded in its sidebar, without opening a
 *  closed one (its rail icon says so). Put in the right sidebar once per device; one the user hid stays hidden. */
export function offerThreads() {
  if (inMargin()) return
  if (!panelSide(PANEL)) {
    try { if (localStorage.getItem(PLACED)) return; localStorage.setItem(PLACED, "1") } catch { return }
  }
  offerPanel(PANEL, "right")
}

/** A note's threads, in the note's order (where they are in its editor, else by line). */
export function threadsOf(notes: Note[], path: string): Note[] {
  const mine = notes.filter((n) => n.path === path && (n.kind === "comment" || n.kind === "suggestion"))
  const v = viewOf(path), doc = v?.state.doc, text = doc?.toString()
  const at = (n: Note) => {
    const i = text && n.find ? nearest(text, n.find, n.line) : -1
    if (i >= 0) return i
    return doc && n.line ? doc.line(Math.max(1, Math.min(n.line, doc.lines))).from : (n.line ?? 0) * 1e4
  }
  return mine.map((n) => ({ n, at: at(n) })).sort((a, b) => a.at - b.at || a.n.t - b.n.t).map((x) => x.n)
}
