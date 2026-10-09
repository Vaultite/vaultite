// The File explorer's settings, kept in files.json (not a data.json) because the server reads showHidden: hidden
// folders are out of reach while it's off, and the attachment folder and excluded files.
import { reload, useStore } from "@/core/data"
import { patch } from "@/core/http"
import { notifyError } from "@/core/notify"
import { getPrefs, setPrefs, usePrefs, type FileSort } from "@/core/prefs"
import { Group } from "@/components/kit"
import { SORTS } from "@/components/FileTree"
import { Field } from "@/components/PluginSettings"
import type { SettingDecl } from "../../../core/blocks.ts"

const sorts = SORTS.flat()
const DECLS: Record<"showHidden" | "showArchived" | "fileSort" | "folderLimit" | "autoReveal" | "attachmentFolder" | "excluded", SettingDecl> = {
  showHidden: { type: "boolean", default: false, label: "Show hidden files",
    description: "adds .vaultite (the app's settings, as files) and .trash (deleted files, which you can restore) to the file list" },
  showArchived: { type: "boolean", default: false, label: "Show archived files",
    description: "adds the .archive folders archived files move into, dimmed (hidden files or not); without it, an archived file shows only while it's open" },
  fileSort: { type: "enum", default: "name", label: "Sort order", values: sorts.map((s) => s.value),
    labels: Object.fromEntries(sorts.map((s) => [s.value, s.label])), description: "folders stay first, by name" },
  folderLimit: { type: "number", default: 0, min: 0, label: "Files per folder",
    description: "how many of a folder's files show before a Show more row (in the sort order; its folders always show); 0 shows them all" },
  autoReveal: { type: "boolean", default: false, label: "Reveal the open file", description: "opens its folders in the tree and scrolls to it" },
  attachmentFolder: { type: "string", default: "Attachments", label: "Attachment folder",
    description: "where pasted and dropped files go: a folder, / for the top, ./ beside the note, ./name in a folder beside it" },
  excluded: { type: "list", default: [], label: "Excluded files",
    description: "paths they start with (Archive/) or /regular expressions/: out of search, the graph and unlinked mentions, last in the quick switcher" },
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
      <Field k="showHidden" d={DECLS.showHidden} value={prefs.showHidden}
        set={(v) => { if (v !== getPrefs().showHidden) void setPrefs({ showHidden: v === true }).then(reload) }} />
      <Field k="showArchived" d={DECLS.showArchived} value={prefs.showArchived} set={(v) => void setPrefs({ showArchived: v === true })} />
      <Field k="fileSort" d={DECLS.fileSort} value={prefs.fileSort} set={(v) => void setPrefs({ fileSort: (v ?? "name") as FileSort })} />
      <Field k="folderLimit" d={DECLS.folderLimit} value={prefs.folderLimit}
        set={(v) => void setPrefs({ folderLimit: typeof v === "number" && v >= 0 ? Math.floor(v) : 0 })} />
      <Field k="autoReveal" d={DECLS.autoReveal} value={prefs.autoReveal} set={(v) => void setPrefs({ autoReveal: v === true })} />
      {filing && <Field k="attachmentFolder" d={at} value={own(filing.attachments, at.default)} set={(v) => saveFiles("attachmentFolder", v, seeds.attachmentFolder)} />}
      {/* (the list as it applies, another app's included, so it's edited rather than typed again) */}
      {filing && <Field k="excluded" d={ex} value={filing.excluded} set={(v) => saveFiles("excluded", v, seeds.excluded)} />}
    </Group>
  )
}
