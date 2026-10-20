// Settings > Editor: how notes are written and laid out (.vaultite/editor.json; core/editorPrefs.ts), Obsidian's settings
// of the same names. A setting the file doesn't have follows the vault's .obsidian/app.json, else Obsidian's default.
import type { Store } from "@/core/data"
import { editorSet, PROPERTIES_SHOWN, setEditor, useEditorSettings, type EditorSettings, type PropertiesShown } from "@/core/editorPrefs"
import { coreSwitch } from "@/core/switches"
import { Panel, ResetButton, Segmented, SettingRow } from "@/components/kit"
import { SwitchRow } from "@/components/SwitchRow"
import { PluginSwitches } from "@/components/PluginSwitches"

/** A switch, with its way back to what the vault or Obsidian says (core/switches.ts). */
const FlagRow = ({ row }: { row: string }) => <SwitchRow s={coreSwitch(`setting:${row}`)} />

type Indent = "tab" | "2" | "4"
const indentOf = (e: EditorSettings): Indent => (e.useTab ? "tab" : (String(e.tabSize) as Indent))

export function EditorPanel({ store }: { store: Store }) {
  const e = useEditorSettings(store)
  return (
    <Panel>
      <div className="hairline">
        <FlagRow row="readable-line-length" />
        <FlagRow row="show-inline-title" />
        <SettingRow stack label="Properties in document" sub="As text: their YAML at the top of the note while editing" data-settings-row="properties-in-document">
          <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto sm:shrink-0">
            <ResetButton on={editorSet("propertiesInDocument")} onClick={() => setEditor({ propertiesInDocument: null })} label="Reset properties in document" />
            <Segmented<PropertiesShown> label="Properties in document" value={e.propertiesInDocument} onChange={(v) => setEditor({ propertiesInDocument: v })}
              className="min-w-0 flex-1 sm:w-[240px] sm:flex-none"
              options={PROPERTIES_SHOWN} />
          </div>
        </SettingRow>
        <FlagRow row="spellcheck" />
        <SettingRow stack label="Indent" sub="What Tab puts in a note not indented yet; one that is keeps its own" data-settings-row="indent">
          <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto sm:shrink-0">
            <ResetButton on={editorSet("useTab") || editorSet("tabSize")} label="Reset indent"
              onClick={() => setEditor({ useTab: null, tabSize: null })} />
            <Segmented<Indent> label="Indent" value={indentOf(e)} className="min-w-0 flex-1 sm:w-[240px] sm:flex-none"
              onChange={(v) => setEditor(v === "tab" ? { useTab: true } : { useTab: false, tabSize: Number(v) })}
              options={[{ value: "tab", label: "Tab" }, { value: "2", label: "2 spaces" }, { value: "4", label: "4 spaces" }]} />
          </div>
        </SettingRow>
        <FlagRow row="auto-pair-brackets" />
        <FlagRow row="auto-pair-markdown" />
        <PluginSwitches section="editor" />
      </div>
    </Panel>
  )
}
