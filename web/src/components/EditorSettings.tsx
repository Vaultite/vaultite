// Settings > Editor: how notes are written and laid out (.vaultite/editor.json; core/editorPrefs.ts), Obsidian's settings
// of the same names. A setting the file doesn't have follows the vault's .obsidian/app.json, else Obsidian's default.
import type { Store } from "@/core/data"
import { EDITING_MODES, editorSet, NOTE_VIEWS, PROPERTIES_SHOWN, setEditor, useEditorSettings, type EditingMode, type NoteView, type PropertiesShown } from "@/core/editorPrefs"
import { useDesktop } from "@/core/platform"
import { coreSwitch } from "@/core/switches"
import { indentOf, INDENTS, type Indent } from "@/core/choices"
import { Group, ResetButton, Section, Segmented, SettingRow } from "@/components/kit"
import { SwitchRow } from "@/components/SwitchRow"
import { PluginSwitches } from "@/components/PluginSwitches"
import { propertiesPreview } from "@/components/SettingPictures"

/** A switch, with its way back to what the vault or Obsidian says (core/switches.ts). */
const FlagRow = ({ row }: { row: string }) => <SwitchRow s={coreSwitch(`setting:${row}`)} />


export function EditorPanel({ store }: { store: Store }) {
  const e = useEditorSettings(store)
  const desktop = useDesktop()
  return (
    <div className="flex flex-col gap-6">
      <Section title="Views">
        <Group>
          <SettingRow stack label="Default view for new tabs" sub="Each tab keeps the view picked in it" data-settings-row="default-view">
            <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto sm:shrink-0">
              <ResetButton on={editorSet("defaultView")} onClick={() => setEditor({ defaultView: null })} label="Reset default view for new tabs" />
              <Segmented<NoteView> label="Default view for new tabs" value={e.defaultView ?? (desktop ? "editing" : "reading")} onChange={(v) => setEditor({ defaultView: v })}
                className="min-w-0 flex-1 sm:w-[240px] sm:flex-none" options={NOTE_VIEWS} />
            </div>
          </SettingRow>
          <SettingRow stack label="Default editing mode" sub="How a new tab edits, and what leaving reading goes back to" data-settings-row="editing-mode">
            <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto sm:shrink-0">
              <ResetButton on={editorSet("editingMode")} onClick={() => setEditor({ editingMode: null })} label="Reset default editing mode" />
              <Segmented<EditingMode> label="Default editing mode" value={e.editingMode} onChange={(v) => setEditor({ editingMode: v })}
                className="min-w-0 flex-1 sm:w-[240px] sm:flex-none" options={EDITING_MODES} />
            </div>
          </SettingRow>
        </Group>
      </Section>
      <Section title="Page">
        <Group>
          <FlagRow row="readable-line-length" />
          <FlagRow row="show-inline-title" />
          <SettingRow stack label="Properties in document" sub="As text: their YAML at the top of the note while editing" data-settings-row="properties-in-document"
            preview={propertiesPreview(e.propertiesInDocument)}>
            <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto sm:shrink-0">
              <ResetButton on={editorSet("propertiesInDocument")} onClick={() => setEditor({ propertiesInDocument: null })} label="Reset properties in document" />
              <Segmented<PropertiesShown> label="Properties in document" value={e.propertiesInDocument} onChange={(v) => setEditor({ propertiesInDocument: v })}
                className="min-w-0 flex-1 sm:w-[240px] sm:flex-none"
                options={PROPERTIES_SHOWN} />
            </div>
          </SettingRow>
        </Group>
      </Section>
      <Section title="Typing">
        <Group>
          <FlagRow row="spellcheck" />
          <SettingRow stack label="Indent" data-settings-row="indent">
            <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto sm:shrink-0">
              <ResetButton on={editorSet("useTab") || editorSet("tabSize")} label="Reset indent"
                onClick={() => setEditor({ useTab: null, tabSize: null })} />
              <Segmented<Indent> label="Indent" value={indentOf(e)} className="min-w-0 flex-1 sm:w-[240px] sm:flex-none"
                onChange={(v) => setEditor(v === "tab" ? { useTab: true } : { useTab: false, tabSize: Number(v) })}
                options={INDENTS} />
            </div>
          </SettingRow>
          <FlagRow row="auto-pair-brackets" />
          <FlagRow row="auto-pair-markdown" />
          <PluginSwitches section="editor" />
        </Group>
      </Section>
    </div>
  )
}
