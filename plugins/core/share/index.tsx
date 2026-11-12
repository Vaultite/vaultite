// Sharing's app side: Share… opens a folder's sheet, as shared documents have it: a link for one person, shown once, and
// who has access, to change or remove. The Shared page (view:shared) has every share at once, with the guests' address.
import { lazy, Suspense, useEffect } from "react"
import { Share2 } from "lucide-react"
import { activePane, currentFile, definePlugin, detailPath, fileRowsChanged, getStore, openDetail, openView, share, useStoreWith, type FileRow } from "@vaultite"
import type { SharedFolders } from "./types.ts"

// (the sheet and the page load when one opens: the app starts without them)
const ShareSheet = lazy(() => import("./Sharing").then((m) => ({ default: m.ShareSheet })))
const SharedView = lazy(() => import("./Sharing").then((m) => ({ default: m.SharedView })))
const name = (folder: string) => folder.split("/").pop() ?? folder

/** A folder that can be shared from the app: not hidden, and not in a guest's own app. */
const shareable = (path: string) => !share && !!path && !path.split("/").some((x) => x.startsWith("."))
const openShare = (folder: string) => openDetail(detailPath("share", folder))

/** The folder in sight: a folder's tab, else the open file's. */
function folderHere() {
  const to = activePane()?.to ?? ""
  if (to.startsWith("view:folder/")) return to.slice("view:folder/".length)
  const f = currentFile()
  return f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ""
}

// The tree marks a shared folder after its name, as Finder and Drive do; its tooltip says with whom.
const USERS = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
let marked: { from: SharedFolders | undefined; rows: Record<string, FileRow> } = { from: undefined, rows: {} }
function sharedRows(): Record<string, FileRow> {
  const from = getStore()?.sharedFolders
  if (from === marked.from) return marked.rows
  const rows: Record<string, FileRow> = {}
  for (const [folder, people] of Object.entries(from ?? {})) {
    const live = people.filter((p) => Date.parse(p.expires) > Date.now())
    if (!live.length) continue
    const mark = document.createElement("span")
    mark.className = "ml-1 inline-grid size-[13px] shrink-0 place-items-center text-tertiary [&>svg]:size-full"
    mark.dataset.sharedMark = ""
    mark.dataset.tip = `Shared with ${live.map((p) => p.guest).join(", ")}`
    mark.innerHTML = USERS
    rows[folder] = { after: [mark] }
  }
  marked = { from, rows }
  return rows
}
/** The tree drawn again when what's shared changes. */
function Marks() {
  const from = useStoreWith((s) => s?.sharedFolders)
  useEffect(() => { fileRowsChanged() }, [from])
  return null
}

export default definePlugin({
  details: { share: { title: (_s, [folder]) => `Share ${name(folder ?? "")}`, render: (_s, [folder]) => <Suspense fallback={null}><ShareSheet folder={folder ?? ""} /></Suspense> } },
  folderMenu: (path) => (shareable(path) ? [{ label: "Share…", icon: Share2, section: "share", run: () => openShare(path) }] : []),
  views: { shared: { icon: Share2, title: () => "Shared", render: () => <Suspense fallback={null}><SharedView /></Suspense> } },
  commands: [
    { id: "share:folder", name: "Share folder…", words: "invite link people access guest", icon: Share2, when: () => shareable(folderHere()), run: () => openShare(folderHere()) },
    { id: "share:shared", name: "Open shared folders", words: "sharing guests links people access", icon: Share2, when: () => !share, run: () => openView("shared", { newTab: true }) },
  ],
  fileRows: () => (share ? {} : sharedRows()),
  // (a guest's first tab: the folder shared with them, as a shared folder's link opens)
  home: () => (share ? "view:folder" : null),
  background: () => (share ? null : <Marks />),
})
