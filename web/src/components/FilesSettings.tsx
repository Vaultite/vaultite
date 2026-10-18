// The File explorer's settings, kept in files.json (not a data.json) because the server reads showHidden: hidden
// folders are out of reach while it's off, and the attachment folder and excluded files.
import { useStore } from "@/core/data"
import { patch } from "@/core/http"
import { notifyError } from "@/core/notify"
import { setPrefs, usePrefs, type FileSort } from "@/core/prefs"
import { coreSwitch } from "@/core/switches"
import { SwitchRow } from "@/components/SwitchRow"
import { Group } from "@/components/kit"
import { SORTS } from "@/components/FileTree"
import { Field } from "@/components/PluginSettings"
import type { SettingDecl } from "../../../core/blocks.ts"

const sorts = SORTS.flat()
// (its switches are core/switches.ts', which Settings' search finds by themselves; read late: that module imports this)
const switchOf = (row: string) => coreSwitch(`setting:${row}`)
const DECLS: Record<"fileSort" | "folderLimit" | "attachmentFolder" | "excluded" | "samples", SettingDecl> = {
  fileSort: { type: "enum", default: "name", label: "Sort order", values: sorts.map((s) => s.value),
    labels: Object.fromEntries(sorts.map((s) => [s.value, s.label])), description: "folders stay first, by name" },
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

/** A files.json key the server reads (another app's value when unset: `seed`): its default again removes it, and a
 *  list emptied over a seed stays, empty. */
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
  const at = { ...DECLS.attachmentFolder, default: seeds.attachmentFolder ?? DECLS.attachmentFolder.default } as SettingDecl
  const ex = { ...DECLS.excluded, default: seeds.excluded ?? [] } as SettingDecl
  const own = (v: unknown, d: unknown) => (JSON.stringify(v) === JSON.stringify(d) ? undefined : v)
  return (
    <Group>
      <SwitchRow s={switchOf("show-hidden")} />
      <SwitchRow s={switchOf("show-archived")} />
      <Field k="fileSort" d={DECLS.fileSort} value={prefs.fileSort} set={(v) => void setPrefs({ fileSort: (v ?? "name") as FileSort })} />
      <Field k="folderLimit" d={DECLS.folderLimit} value={prefs.folderLimit}
        set={(v) => void setPrefs({ folderLimit: typeof v === "number" && v >= 0 ? Math.floor(v) : 0 })} />
      <SwitchRow s={switchOf("auto-reveal")} />
      {filing && <Field k="attachmentFolder" d={at} value={own(filing.attachments, at.default)} set={(v) => saveFiles("attachmentFolder", v, seeds.attachmentFolder)} />}
      {/* (the list as it applies, another app's included, so it's edited rather than typed again) */}
      {filing && <Field k="excluded" d={ex} value={filing.excluded} set={(v) => saveFiles("excluded", v, seeds.excluded)} />}
      {filing && <Field k="samples" d={DECLS.samples} value={filing.samples ?? []} set={(v) => saveFiles("samples", v, undefined)} />}
    </Group>
  )
}
