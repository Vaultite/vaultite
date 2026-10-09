// The editor's settings (.vaultite/editor.json, key by key): a key the file doesn't set is what the vault's other app
// says (`conventions.editor`: .obsidian/app.json), else Obsidian's default. Defaults are never written.
import { getStore, type Store } from "@/core/data"
import { vaultEditor } from "@/core/conventions"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"

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
}

export const EDITOR_DEFAULTS: EditorSettings = {
  spellcheck: true, useTab: true, tabSize: 4, autoPairBrackets: true, autoPairMarkdown: true, readableLineLength: true,
  propertiesInDocument: "visible",
}

/** A value of the right shape for `key`, or undefined (a hand-edited file's `"tabSize": "big"` is ignored). */
export function editorValue<K extends keyof EditorSettings>(key: K, v: unknown): EditorSettings[K] | undefined {
  const d = EDITOR_DEFAULTS[key]
  if (key === "propertiesInDocument") return (v === "visible" || v === "hidden" || v === "source" ? v : undefined) as EditorSettings[K] | undefined
  if (key === "tabSize") return (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 8 ? v : undefined) as EditorSettings[K] | undefined
  return (typeof v === typeof d ? v : undefined) as EditorSettings[K] | undefined
}

function read(own: Record<string, unknown>, other: Partial<EditorSettings>): EditorSettings {
  const out = { ...EDITOR_DEFAULTS } as Record<string, unknown>
  for (const k of Object.keys(EDITOR_DEFAULTS) as (keyof EditorSettings)[]) {
    out[k] = editorValue(k, own[k]) ?? editorValue(k, other[k]) ?? EDITOR_DEFAULTS[k]
  }
  return out as EditorSettings
}

let last: { own: unknown; other: unknown; value: EditorSettings } | null = null
/** The settings now (the same object until they change). */
export function editorSettings(s: Store | null = getStore()): EditorSettings {
  const own = getPrefs().editor, other = vaultEditor(s)
  if (last && last.own === own && JSON.stringify(last.other) === JSON.stringify(other)) return last.value
  last = { own, other, value: read(own, other) }
  return last.value
}

/** Whether a key is set in editor.json (Settings shows a reset for it). */
export const editorSet = (key: keyof EditorSettings) => editorValue(key, getPrefs().editor[key]) !== undefined

/** Change settings; null takes one out of editor.json (back to the vault's other app's, or the default). */
export function setEditor(changes: { [K in keyof EditorSettings]?: EditorSettings[K] | null }) {
  const next = { ...getPrefs().editor }
  for (const [k, v] of Object.entries(changes)) if (v === null) delete next[k]; else next[k] = v
  return setPrefs({ editor: next })
}

/** The settings, redrawn when they change (editor.json, or the vault's other app's). */
export function useEditorSettings(store?: Store | null): EditorSettings {
  usePrefs()
  return editorSettings(store ?? getStore())
}
