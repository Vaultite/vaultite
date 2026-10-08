import { Archive, ArchiveRestore, FolderArchive } from "lucide-react"
import { confirmDialog, currentFile, definePlugin, getStore, inArchive, isHidden, notify, notifyError, op, reload } from "@vaultite"

// Archive and Unarchive in a file's menu and the palette (the moving is plugin.ts'), and the one-time tidy.

type Moved = { from: string; path: string }

const archived = (path: string) => inArchive(path) || !!getStore()?.files.files.find((f) => f.path === path)?.archived
const name = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "")
/** A vault file (not a folder, not hidden: the trash, .vaultite). */
const can = (path: string) => {
  const s = getStore()
  return !!s && !!path && !isHidden(path) && [...s.files.files, ...s.files.others].some((f) => f.path === path)
}

/** Archive or unarchive a file; the toast's Undo does the other, wherever it went. */
export async function setArchived(path: string, on: boolean) {
  try {
    const r = await op<Moved>(on ? "archive.add" : "archive.restore", { path })
    await reload()
    notify(`${on ? "Archived" : "Unarchived"} ${name(path)}`, { action: { label: "Undo", run: () => void setArchived(r.path, !on) } })
  } catch (e) { notifyError(e, on ? "Couldn't archive" : "Couldn't unarchive") }
}

/** Archive or unarchive several (selected together): one toast, its Undo for all of them. */
async function setManyArchived(paths: string[], on: boolean) {
  const moved: string[] = []
  for (const path of paths.filter((p) => archived(p) !== on)) {
    try { moved.push((await op<Moved>(on ? "archive.add" : "archive.restore", { path })).path) } catch (e) { notifyError(e, on ? "Couldn't archive" : "Couldn't unarchive") }
  }
  await reload()
  if (moved.length) notify(`${on ? "Archived" : "Unarchived"} ${moved.length} file${moved.length === 1 ? "" : "s"}`, { action: { label: "Undo", run: () => void setManyArchived(moved, !on) } })
}

/** Move the files marked archived by hand (or from before this plugin) into their folders' .archive, after asking. */
async function tidy() {
  try {
    const { files } = await op<{ files: string[] }>("archive.tidy", { dry: true })
    if (!files.length) return notify("Every archived file is in an archive folder")
    const ok = await confirmDialog({
      title: `Move ${files.length} archived file${files.length === 1 ? "" : "s"}?`,
      body: "Each goes into an .archive folder inside its own folder. Links to them are updated.", confirm: "Move",
    })
    if (!ok) return
    const r = await op<{ moved: Moved[]; failed: unknown[] }>("archive.tidy")
    await reload()
    notify(`Moved ${r.moved.length} archived file${r.moved.length === 1 ? "" : "s"}${r.failed.length ? `; ${r.failed.length} couldn't move` : ""}`)
  } catch (e) { notifyError(e, "Couldn't move the archived files") }
}

export default definePlugin({
  fileMenu: (path) => {
    if (!can(path)) return []
    const on = archived(path)
    return [{ label: on ? "Unarchive" : "Archive", icon: on ? ArchiveRestore : Archive, section: "navigate", run: () => void setArchived(path, !on),
      many: (paths) => void setManyArchived(paths, !on) }]
  },
  commands: [
    { id: "archive:archive", name: "Archive the current file", when: () => can(currentFile()) && !archived(currentFile()), run: () => void setArchived(currentFile(), true) },
    { id: "archive:unarchive", name: "Unarchive the current file", when: () => can(currentFile()) && archived(currentFile()), run: () => void setArchived(currentFile(), false), icon: ArchiveRestore },
    { id: "archive:tidy", name: "Move archived files into archive folders", run: () => void tidy(), icon: FolderArchive },
  ],
})
