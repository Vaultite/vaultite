import { getStore, type Store } from "@/core/data"
import { vaultEditor } from "@/core/conventions"
import { notify } from "@/core/notify"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { EDITOR, EDITOR_KEYS, type EditingMode, type EditorSettings, type NoteView, type PropertiesShown } from "../../../core/editor.ts"

export type { EditingMode, EditorSettings, NoteView, PropertiesShown }

function editorValue<K extends keyof EditorSettings>(key: K, v: unknown): EditorSettings[K] | undefined {
  const d = EDITOR[key]
  if (key === "propertiesInDocument") return (v === "visible" || v === "hidden" || v === "source" ? v : undefined) as EditorSettings[K] | undefined
  if (key === "defaultView") return (v === "editing" || v === "reading" ? v : undefined) as EditorSettings[K] | undefined
  if (key === "editingMode") return (v === "live" || v === "source" ? v : undefined) as EditorSettings[K] | undefined
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
export function editorSettings(s: Store | null = getStore()): EditorSettings {
  const own = getPrefs().editor, other = vaultEditor(s)
  if (last && last.own === own && JSON.stringify(last.other) === JSON.stringify(other)) return last.value
  last = { own, other, value: read(own, other) }
  return last.value
}

export const editorSet = (key: keyof EditorSettings) => editorValue(key, getPrefs().editor[key]) !== undefined

export function setEditor(changes: { [K in keyof EditorSettings]?: EditorSettings[K] | null }) {
  const next = { ...getPrefs().editor }
  for (const [k, v] of Object.entries(changes)) if (v === null) delete next[k]; else next[k] = v
  return setPrefs({ editor: next })
}

export const PROPERTIES_SHOWN: { value: PropertiesShown; label: string }[] = [
  { value: "visible", label: "Visible" }, { value: "hidden", label: "Hidden" }, { value: "source", label: "As text" },
]

export const NOTE_VIEWS: { value: NoteView; label: string }[] = [{ value: "editing", label: "Editing" }, { value: "reading", label: "Reading" }]
export const EDITING_MODES: { value: EditingMode; label: string }[] = [{ value: "live", label: "Live preview" }, { value: "source", label: "Source mode" }]

export function showPropertiesAs(v: PropertiesShown) {
  if (v === editorSettings().propertiesInDocument) return
  const was = editorSet("propertiesInDocument") ? editorSettings().propertiesInDocument : null
  void setEditor({ propertiesInDocument: v })
  if (v === "hidden") notify("Properties hidden in every note", { id: "properties-shown", action: { label: "Undo", run: () => void setEditor({ propertiesInDocument: was }) } })
}

export function useEditorSettings(store?: Store | null): EditorSettings {
  usePrefs()
  return editorSettings(store ?? getStore())
}
