// The editors on screen, so a command acts on the one the user means: the one with the keyboard, else the sheet's,
// else the focused pane's. Types only from CodeMirror: the editor is its own chunk.
import type { EditorState } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"

export type OpenEditor = {
  view: EditorView
  /** A note (Markdown: live preview, reading or source), a code file, or other text (JSON, HTML, CSV). */
  kind: "markdown" | "code" | "text"
  /** Its file, when it's one: a Markdown file's editor holds its whole text, frontmatter included, in every mode, so
   *  positions in it are the file's. */
  path?: string
  /** Source mode: the frontmatter shown as text, not as Properties. */
  source?: boolean
  /** Where the text shown starts: after the frontmatter it hides (0 in source mode, or without one). */
  start?: (state: EditorState) => number
  /** Its history's ⌘Z and ⇧⌘Z, for the app's Undo while the keyboard is elsewhere (a property just removed): false
   *  when there's nothing to undo. */
  undo?: () => boolean
  redo?: () => boolean
}

const open: OpenEditor[] = []

/** An editor came on screen: registered until it goes (the returned function). */
export function registerEditor(e: OpenEditor) {
  open.push(e)
  return () => { const i = open.indexOf(e); if (i >= 0) open.splice(i, 1) }
}

/** The editor drawn by this view, if it's one of the app's. */
export const editorOf = (view: EditorView) => open.find((e) => e.view === view) ?? null

/** The editor the user means now, or null (the focused tab isn't a text file: a dashboard's grid, a terminal). */
export function currentEditor(): OpenEditor | null {
  const shown = open.filter((e) => e.view.dom.isConnected && e.view.dom.getClientRects().length > 0)
  if (!shown.length) return null
  const at = document.activeElement
  const own = at && shown.find((e) => e.view.dom.contains(at))
  if (own) return own
  // A sheet (a <dialog>) open on top of the panes: its file.
  const sheets = [...document.querySelectorAll("dialog[open]")]
  for (const d of sheets.reverse()) {
    const hit = shown.find((e) => d.contains(e.view.dom))
    if (hit) return hit
  }
  if (sheets.length) return null
  return shown.find((e) => e.view.dom.closest("#main-scroll .file-view")) ?? null
}

/** The text selected in an editor (the one the user means by default): its selections, or in reading view the page's
 *  selection inside it; "" for none. */
export function selectedText(ed: Pick<OpenEditor, "view"> | null = currentEditor()): string {
  if (!ed) return ""
  const { state, contentDOM } = ed.view
  if (contentDOM.contentEditable === "true") return state.selection.ranges.map((r) => state.sliceDoc(r.from, r.to)).filter(Boolean).join("\n")
  const sel = getSelection()
  return sel && !sel.isCollapsed && sel.anchorNode && contentDOM.contains(sel.anchorNode) ? sel.toString() : ""
}
