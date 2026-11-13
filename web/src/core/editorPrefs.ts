import { getStore, type Store } from "@/core/data"
import { vaultEditor } from "@/core/conventions"
import { notify } from "@/core/notify"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { EDITOR, type EditingMode, type EditorSettings, type NoteView, type PropertiesShown } from "../../../core/editor.ts"
import { isNumber } from "../../../core/values.ts"

export type { EditingMode, EditorSettings, NoteView, PropertiesShown }

type Reader<T> = (v: unknown) => T | undefined
const bool: Reader<boolean> = (v) => (v === true || v === false ? v : undefined)
const READ: { [K in keyof EditorSettings]: Reader<EditorSettings[K]> } = {
  spellcheck: bool, useTab: bool,
  tabSize: (v) => (isNumber(v) && Number.isInteger(v) && v >= 1 && v <= 8 ? v : undefined),
  autoPairBrackets: bool, autoPairMarkdown: bool, readableLineLength: bool,
  propertiesInDocument: (v) => (v === "visible" || v === "hidden" || v === "source" ? v : undefined),
  showInlineTitle: bool,
  defaultView: (v) => (v === "editing" || v === "reading" ? v : undefined),
  editingMode: (v) => (v === "live" || v === "source" ? v : undefined),
}

function read(own: Record<string, unknown>, other: Partial<EditorSettings>): EditorSettings {
  const at = <K extends keyof EditorSettings>(k: K): EditorSettings[K] => READ[k](own[k]) ?? READ[k](other[k]) ?? EDITOR[k]
  return {
    spellcheck: at("spellcheck"), useTab: at("useTab"), tabSize: at("tabSize"), autoPairBrackets: at("autoPairBrackets"),
    autoPairMarkdown: at("autoPairMarkdown"), readableLineLength: at("readableLineLength"),
    propertiesInDocument: at("propertiesInDocument"), showInlineTitle: at("showInlineTitle"), defaultView: at("defaultView"),
    editingMode: at("editingMode"),
  }
}

let last: { own: unknown; other: unknown; value: EditorSettings } | null = null
export function editorSettings(s: Store | null = getStore()): EditorSettings {
  const own = getPrefs().editor, other = vaultEditor(s)
  if (last && last.own === own && JSON.stringify(last.other) === JSON.stringify(other)) return last.value
  last = { own, other, value: read(own, other) }
  return last.value
}

export const editorSet = (key: keyof EditorSettings) => READ[key](getPrefs().editor[key]) !== undefined

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
