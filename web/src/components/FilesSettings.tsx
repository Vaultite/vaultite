import { useStore } from "@/core/data"
import { patch } from "@/core/http"
import { notifyError } from "@/core/notify"
import { setPrefs, usePrefs, type FolderGroup, type FolderView } from "@/core/prefs"
import { coreSwitch } from "@/core/switches"
import { SwitchRow } from "@/components/SwitchRow"
import { Group } from "@/components/kit"
import { SORTS } from "@/components/FileTree"
import { Field } from "@/components/PluginSettings"
import type { SettingDecl } from "../../../core/blocks.ts"

const sorts = SORTS.flat()
const FOLDER_VIEWS: FolderView[] = ["grid", "list", "columns", "gallery"]
const FOLDER_GROUPS: FolderGroup[] = ["none", "kind", "modified"]
const switchOf = (row: string) => coreSwitch(`setting:${row}`)
const DECLS: Record<"fileSort" | "folderView" | "folderGroup" | "folderLimit" | "attachmentFolder" | "excluded" | "samples", SettingDecl> = {
  fileSort: { type: "enum", default: "name", label: "Sort order", values: sorts.map((s) => s.value),
    labels: Object.fromEntries(sorts.map((s) => [s.value, s.label])), description: "folders stay first, by name" },
  folderView: { type: "enum", default: "list", label: "Show folders as", values: ["grid", "list", "columns", "gallery"],
    labels: { grid: "Grid", list: "List", columns: "Columns", gallery: "Gallery" },
    description: "how a folder opened as a tab shows what it holds, every folder the same (on a phone, columns show as a list and a gallery as a grid)" },
  folderGroup: { type: "enum", default: "none", label: "Group folders by", values: ["none", "kind", "modified"], labels: { none: "None", kind: "Kind", modified: "Date modified" },
    description: "headings in a folder opened as a tab, as a list or a grid" },
  folderLimit: { type: "number", default: 0, min: 0, label: "Files per folder",
    description: "how many of a folder's files show before a Show more row (in the sort order; its folders always show); 0 shows them all" },
  attachmentFolder: { type: "string", default: "Attachments", label: "Attachment folder",
    description: "where pasted and dropped files go: a folder, / for the top, ./ beside the note, ./name in a folder beside it" },
  excluded: { type: "list", default: [], lines: true, label: "Excluded files",
    description: "paths they start with (Archive/) or /regular expressions/: out of search, the graph and unlinked mentions, last in the quick switcher" },
  samples: { type: "list", default: [], lines: true, label: "Sample folders",
    description: "folders of examples, not your data: out of tasks, Dataview and database views made outside them, and never people, books or logs" },
}

/** What the sheet has, for the Settings page's search (the plugin's `settingsSearch`). */
export const filesSettingsSearch = Object.entries(DECLS).map(([key, d]) => ({ key, label: d.label, description: d.description }))

function saveFiles(key: string, v: unknown, seed: unknown) {
  const unset = v === null || v === undefined || v === ""
  const empty = unset && Array.isArray(seed) && seed.length > 0
  const same = unset || JSON.stringify(v) === JSON.stringify(seed)
  patch("config/files", { [key]: empty ? [] : same ? null : v }).catch((e) => notifyError(e, "Couldn't save it"))
}

export function FilesSettings() {
  const prefs = usePrefs()
  const { store } = useStore()
  const seeds = store?.settingDefaults?.files ?? {}, filing = store?.filing
  const at: SettingDecl = { ...DECLS.attachmentFolder, default: seeds.attachmentFolder ?? DECLS.attachmentFolder.default }
  const ex: SettingDecl = { ...DECLS.excluded, default: seeds.excluded ?? [] }
  const own = (v: unknown, d: unknown) => (JSON.stringify(v) === JSON.stringify(d) ? undefined : v)
  return (
    <Group>
      <SwitchRow s={switchOf("show-hidden")} />
      <SwitchRow s={switchOf("show-archived")} />
      <Field k="fileSort" d={DECLS.fileSort} value={prefs.fileSort} set={(v) => void setPrefs({ fileSort: sorts.find((s) => s.value === v)?.value ?? "name" })} />
      <Field k="folderView" d={DECLS.folderView} value={prefs.folderView} set={(v) => void setPrefs({ folderView: FOLDER_VIEWS.find((x) => x === v) ?? "list" })} />
      <Field k="folderGroup" d={DECLS.folderGroup} value={prefs.folderGroup} set={(v) => void setPrefs({ folderGroup: FOLDER_GROUPS.find((x) => x === v) ?? "none" })} />
      <Field k="folderLimit" d={DECLS.folderLimit} value={prefs.folderLimit}
        set={(v) => void setPrefs({ folderLimit: typeof v === "number" && v >= 0 ? Math.floor(v) : 0 })} />
      <SwitchRow s={switchOf("auto-reveal")} />
      {filing && <Field k="attachmentFolder" d={at} value={own(filing.attachments, at.default)} set={(v) => saveFiles("attachmentFolder", v, seeds.attachmentFolder)} />}
      {filing && <Field k="excluded" d={ex} value={filing.excluded} set={(v) => saveFiles("excluded", v, seeds.excluded)} />}
      {filing && <Field k="samples" d={DECLS.samples} value={filing.samples ?? []} set={(v) => saveFiles("samples", v, undefined)} />}
    </Group>
  )
}
