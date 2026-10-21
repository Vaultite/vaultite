// The editor's settings (editor.json) and their defaults, one list for the app (web/src/core/editorPrefs.ts) and the
// server (core/bundles.ts: a bundle setting one to its default removes the key). No Node: both use it.
export type PropertiesShown = "visible" | "hidden" | "source"
export type EditorSettings = {
  /** The browser's spelling check in notes. */
  spellcheck: boolean
  /** Tab indents with a tab; off, with `tabSize` spaces. */
  useTab: boolean
  /** How wide a tab draws, and how many spaces an indent is without tabs. */
  tabSize: number
  /** ( [ { and quotes typed close themselves; over a selection, wrap it. */
  autoPairBrackets: boolean
  /** * _ ~ = ` typed over a selection wrap it; a ` typed closes itself. */
  autoPairMarkdown: boolean
  /** A note's lines stop at a readable width (--line-width) instead of the pane's. */
  readableLineLength: boolean
  /** Properties above the text (reading and editing), not at all, or as the frontmatter's text (editing). */
  propertiesInDocument: PropertiesShown
  /** The file's name as a title at the top of the page; off, it's only in the tab and the path bar. */
  showInlineTitle: boolean
}

export const EDITOR: EditorSettings = {
  spellcheck: true, useTab: true, tabSize: 4, autoPairBrackets: true, autoPairMarkdown: true, readableLineLength: true,
  propertiesInDocument: "visible", showInlineTitle: true,
}
export const EDITOR_KEYS = Object.keys(EDITOR) as (keyof EditorSettings)[]
