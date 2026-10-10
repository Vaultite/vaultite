// Recent files, one source for every list of them: opened lately in the workspace, and changed lately on disk.
import type { Store } from "@/core/data"
import { inPagesDir, openFile, stem, type VaultFile } from "@/core/files"
import { usePrefs } from "@/core/prefs"
import { useRecentFiles } from "@/core/scope"
import { isRecentable } from "@/core/search"
import { fileIcon } from "@/components/FileTree"
import { SidebarRow } from "@/components/Sidebar"
import { filesMenu } from "@/components/FileActions"
import { menuFor } from "@/components/ContextMenu"
import { rowMenu, selectClick, selectedAttr, useSelectable, useSelectedKeys } from "@/core/select"

/** The recent files' selection (core/select.ts), by path: open several, move, pin or delete them together. */
const SELECT = "recent"

export type RecentKind = "opened" | "changed"

/** The files opened lately in this workspace that are still there (not archived), newest first, at most `n`; not the
 *  plugins' built-in pages (the app opens them itself, as a device's first tab; Pinned has them). */
export function useOpenedFiles(store: Store, n: number): string[] {
  const exists = new Set(store.files.files.filter((f) => !f.archived && !inPagesDir(f.path)).map((f) => f.path))
  return useRecentFiles().filter((p) => exists.has(p)).slice(0, n)
}

// The store's files
// by when they changed, newest first: sorted once per list (the store keeps a list's object while it's unchanged).
let sortedFor: VaultFile[] | null = null
let sorted: VaultFile[] = []
function byChange(files: VaultFile[]) {
  if (files !== sortedFor) {
    sortedFor = files
    sorted = files.filter((f) => isRecentable(f.path) && !f.archived).sort((a, b) => b.mtime - a.mtime)
  }
  return sorted
}

/** The vault's recently changed files, newest first, at most `n`, without those in `skip`. */
export function changedFiles(store: Store, n: number, skip: string[] = []): string[] {
  const out: string[] = []
  for (const f of byChange(store.files.files)) {
    if (out.length >= n) break
    if (!skip.includes(f.path)) out.push(f.path)
  }
  return out
}

/** A file's icon as the file tree draws it (its own, a dashboard's or a person's, in its colour), by path. */
export function useFileIcon(store: Store) {
  const { disabled } = usePrefs()
  return (p: string) => { const f = store.files.files.find((x) => x.path === p); return fileIcon(p, f?.type ?? null, disabled, f) }
}

/** The files as a blank tab lists them: the sidebar's rows (a page draws them a size up: `data-size-up`), each with
 *  the icon it has in the file tree and on its tab (a person's, a dashboard's own), its folder at the right. */
export function RecentList({ store, files }: { store: Store; files: string[]
  /** Unused: the page's size-up sizes it for phones. */
  phone?: boolean }) {
  const { fileIcons } = usePrefs()
  const iconOf = useFileIcon(store)
  const picks = useSelectedKeys(SELECT)
  useSelectable(SELECT, { menu: (keys) => filesMenu(keys), noun: ["file", "files"] })
  return (
    <div className="flex flex-col gap-px pb-1" data-keylist data-select-list={SELECT}>
      {files.map((p) => {
        const { icon, tint } = iconOf(p)
        const folder = p.split("/").slice(0, -1).join(" / ")
        return (
          // A middle-click (⌘↵ from the keyboard): a new tab here, as everywhere in the app (never the browser's); ⌘- and
          // ⇧-click select.
          <SidebarRow key={p} data-recent={p} data-select-key={p} {...selectedAttr(picks.has(p))} href={`#file/${encodeURIComponent(p)}`} icon={fileIcons ? icon : undefined} tint={tint} label={stem(p)} open
            className="active:bg-foreground/[0.06]" onContextMenu={menuFor(rowMenu(SELECT, p, () => []))}
            onClick={(e) => { if (!selectClick(e, SELECT, p)) openFile(p, { newTab: e.metaKey || e.ctrlKey || e.button === 1 }) }}>
            {folder && <span className="mr-1 max-w-[40%] truncate text-[11px] text-tertiary">{folder}</span>}
          </SidebarRow>
        )
      })}
    </div>
  )
}
