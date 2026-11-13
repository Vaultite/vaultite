import { Archive, ArchiveRestore, FolderArchive } from "lucide-react"
import { ARCHIVE_DIR, confirmDialog, currentFile, definePlugin, type FileMenuItem, getStore, inArchive, isFolder, isHidden, notify, notifyError, op, plural, reload } from "@vaultite"

type Moved = { from: string; path: string }

const archived = (path: string) => inArchive(path) || !!getStore()?.files.files.find((f) => f.path === path)?.archived
const name = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "")
const can = (path: string) => {
  const s = getStore()
  return !!s && !!path && !isHidden(path) && [...s.files.files, ...s.files.others].some((f) => f.path === path)
}
const canFolder = (path: string) => {
  const s = getStore()
  return !!s && !!path && !isHidden(path) && path.split("/").pop() !== ARCHIVE_DIR && isFolder(s.files, path)
}

export async function setArchived(path: string, on: boolean) {
  try {
    const r = await op<Moved>(on ? "archive.add" : "archive.restore", { path })
    await reload()
    notify(`${on ? "Archived" : "Unarchived"} ${name(path)}`, { action: { label: "Undo", run: () => void setArchived(r.path, !on) } })
  } catch (e) { notifyError(e, on ? "Couldn't archive" : "Couldn't unarchive") }
}

async function setManyArchived(paths: string[], on: boolean) {
  const moved: string[] = []
  for (const path of paths.filter((p) => archived(p) !== on)) {
    try { moved.push((await op<Moved>(on ? "archive.add" : "archive.restore", { path })).path) } catch (e) { notifyError(e, on ? "Couldn't archive" : "Couldn't unarchive") }
  }
  await reload()
  if (moved.length) notify(`${on ? "Archived" : "Unarchived"} ${plural(moved.length, "item")}`, { action: { label: "Undo", run: () => void setManyArchived(moved, !on) } })
}

async function tidy() {
  try {
    const { files } = await op<{ files: string[] }>("archive.tidy", { dry: true })
    if (!files.length) return notify("Every archived file is in an archive folder")
    const ok = await confirmDialog({
      title: `Move ${plural(files.length, "archived file")}?`,
      body: "Each goes into an .archive folder inside its own folder. Links to them are updated.", confirm: "Move",
    })
    if (!ok) return
    const r = await op<{ moved: Moved[]; failed: unknown[] }>("archive.tidy")
    await reload()
    notify(`Moved ${plural(r.moved.length, "archived file")}${r.failed.length ? `; ${r.failed.length} couldn't move` : ""}`)
  } catch (e) { notifyError(e, "Couldn't move the archived files") }
}

const item = (path: string, on: boolean): FileMenuItem[] => [{ label: on ? "Unarchive" : "Archive", icon: on ? ArchiveRestore : Archive, section: "away",
  run: () => void setArchived(path, !on), many: (paths) => void setManyArchived(paths, !on) }]

export default definePlugin({
  fileMenu: (path) => (can(path) ? item(path, archived(path)) : []),
  folderMenu: (path) => (canFolder(path) ? item(path, inArchive(path)) : []),
  commands: [
    { id: "archive:archive", name: "Archive the current file", when: () => can(currentFile()) && !archived(currentFile()), run: () => void setArchived(currentFile(), true) },
    { id: "archive:unarchive", name: "Unarchive the current file", when: () => can(currentFile()) && archived(currentFile()), run: () => void setArchived(currentFile(), false), icon: ArchiveRestore },
    { id: "archive:tidy", name: "Move archived files into archive folders", run: () => void tidy(), icon: FolderArchive },
  ],
})
