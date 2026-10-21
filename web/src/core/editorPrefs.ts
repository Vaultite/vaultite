// The editor's settings (.vaultite/editor.json, key by key): a key the file doesn't set is what the vault's other app
// says (`conventions.editor`: .obsidian/app.json), else Obsidian's default. Defaults are never written.
import { getStore, type Store } from "@/core/data"
import { vaultEditor } from "@/core/conventions"
import { notify } from "@/core/notify"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { EDITOR, EDITOR_KEYS, type EditorSettings, type PropertiesShown } from "../../../core/editor.ts"

export type { EditorSettings, PropertiesShown }

/** A value of the right shape for `key`, or undefined (a hand-edited file's `"tabSize": "big"` is ignored). */
function editorValue<K extends keyof EditorSettings>(key: K, v: unknown): EditorSettings[K] | undefined {
  const d = EDITOR[key]
  if (key === "propertiesInDocument") return (v === "visible" || v === "hidden" || v === "source" ? v : undefined) as EditorSettings[K] | undefined
  if (key === "tabSize") return (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 8 ? v : undefined) as EditorSettings[K] | undefined
  return (typeof v === typeof d ? v : undefined) as EditorSettings[K] | undefined
}

function read(own: Record<string, unknown>, other: Partial<EditorSettings>): EditorSettings {
  const out = { ...EDITOR } as Record<string, unknown>
  for (const k of EDITOR_KEYS) {
    out[k] = editorValue(k, own[k]) ?? editorValue(k, other[k]) ?? EDITOR[k]
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

/** "Properties in document" as Settings, the palette and the Properties menu name its choices. */
export const PROPERTIES_SHOWN: { value: PropertiesShown; label: string }[] = [
  { value: "visible", label: "Visible" }, { value: "hidden", label: "Hidden" }, { value: "source", label: "As text" },
]

/** Set "Properties in document"; hiding them takes away the panel it was chosen from, so it offers Undo. */
export function showPropertiesAs(v: PropertiesShown) {
  if (v === editorSettings().propertiesInDocument) return
  // (Undo puts back editor.json's own value, or none: a default is never written)
  const was = editorSet("propertiesInDocument") ? editorSettings().propertiesInDocument : null
  void setEditor({ propertiesInDocument: v })
  if (v === "hidden") notify("Properties hidden in every note", { id: "properties-shown", action: { label: "Undo", run: () => void setEditor({ propertiesInDocument: was }) } })
}

/** The settings, redrawn when they change (editor.json, or the vault's other app's). */
export function useEditorSettings(store?: Store | null): EditorSettings {
  usePrefs()
  return editorSettings(store ?? getStore())
}
