// Settings > Editor: how notes are written and laid out (.vaultite/editor.json; core/editorPrefs.ts), Obsidian's settings
// of the same names. A setting the file doesn't have follows the vault's .obsidian/app.json, else Obsidian's default.
import type { Store } from "@/core/data"
import { editorSet, setEditor, useEditorSettings, type EditorSettings, type PropertiesShown } from "@/core/editorPrefs"
import { Panel, ResetButton, Segmented, SettingRow, Switch } from "@/components/kit"

type Flag = "readableLineLength" | "spellcheck" | "autoPairBrackets" | "autoPairMarkdown"

/** A switch, with its way back to what the vault or Obsidian says. */
function FlagRow({ k, label, sub, row, value }: { k: Flag; label: string; sub?: string; row: string; value: boolean }) {
  return (
    <SettingRow label={label} sub={sub} data-settings-row={row}>
      <ResetButton on={editorSet(k)} onClick={() => setEditor({ [k]: null })} label={`Reset ${label.toLowerCase()}`} />
      <Switch on={value} onChange={(on) => setEditor({ [k]: on })} label={label} />
    </SettingRow>
  )
}

type Indent = "tab" | "2" | "4"
const indentOf = (e: EditorSettings): Indent => (e.useTab ? "tab" : (String(e.tabSize) as Indent))

export function EditorPanel({ store }: { store: Store }) {
  const e = useEditorSettings(store)
  return (
    <Panel title="Editor">
      <div className="hairline">
        <FlagRow k="readableLineLength" label="Readable line length" sub="Lines stop at a comfortable width" row="readable-line-length" value={e.readableLineLength} />
        <SettingRow stack label="Properties in document" data-settings-row="properties-in-document">
          <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto sm:shrink-0">
            <ResetButton on={editorSet("propertiesInDocument")} onClick={() => setEditor({ propertiesInDocument: null })} label="Reset properties in document" />
            <Segmented<PropertiesShown> label="Properties in document" value={e.propertiesInDocument} onChange={(v) => setEditor({ propertiesInDocument: v })}
              className="min-w-0 flex-1 sm:w-[240px] sm:flex-none"
              options={[{ value: "visible", label: "Visible" }, { value: "hidden", label: "Hidden" }, { value: "source", label: "Source" }]} />
          </div>
        </SettingRow>
        <FlagRow k="spellcheck" label="Spellcheck" row="spellcheck" value={e.spellcheck} />
        <SettingRow stack label="Indent" sub="What Tab puts in a note not indented yet; one that is keeps its own" data-settings-row="indent">
          <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto sm:shrink-0">
            <ResetButton on={editorSet("useTab") || editorSet("tabSize")} label="Reset indent"
              onClick={() => setEditor({ useTab: null, tabSize: null })} />
            <Segmented<Indent> label="Indent" value={indentOf(e)} className="min-w-0 flex-1 sm:w-[240px] sm:flex-none"
              onChange={(v) => setEditor(v === "tab" ? { useTab: true } : { useTab: false, tabSize: Number(v) })}
              options={[{ value: "tab", label: "Tab" }, { value: "2", label: "2 spaces" }, { value: "4", label: "4 spaces" }]} />
          </div>
        </SettingRow>
        <FlagRow k="autoPairBrackets" label="Auto-pair brackets" sub="Brackets and quotes close themselves" row="auto-pair-brackets" value={e.autoPairBrackets} />
        <FlagRow k="autoPairMarkdown" label="Auto-pair Markdown" sub="Typing * _ ~ = or ` over a selection wraps it" row="auto-pair-markdown" value={e.autoPairMarkdown} />
      </div>
    </Panel>
  )
}
