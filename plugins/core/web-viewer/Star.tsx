import { useEffect } from "react"
import { BookOpen, Check, Folder, FolderPlus, Star, Trash2 } from "lucide-react"
import { askText, cn, commandKeys, confirmDialog, getStore, menuShowing, op, openFile, openMenu, optimistic, plural, useMenuShowing, useStore, type MenuItem } from "@vaultite"
import type { Bookmark } from "./bookmarks"

const NONE: Bookmark[] = []
const marks = () => getStore()?.bookmarks ?? NONE
const markOf = (url: string) => marks().find((b) => b.url === url)
const folderName = (f: string) => (f ? f.split("/").join(" / ") : "Bookmarks")
const allFolders = () => [...new Set(["", ...(getStore()?.bookmarkFolders ?? []), ...marks().map((x) => x.folder)])]
const join = (parent: string, name: string) => (parent ? `${parent}/${name}` : name)
const tidy = (name: string) => name.replace(/\//g, "-").replace(/\s+/g, " ").trim()

let queue: Promise<unknown> = Promise.resolve()
const queued = (run: () => Promise<unknown>) => {
  const next = queue.then(() => run())
  queue = next.catch(() => {})
  return next
}
const write = (change: (l: Bookmark[]) => Bookmark[], run: () => Promise<unknown>, failed: string) =>
  optimistic((s) => ({ ...s, bookmarks: change(s.bookmarks ?? []) }), () => queued(run), failed)
const folders = (change: (f: string[]) => string[]) => (s: NonNullable<ReturnType<typeof getStore>>) => ({ ...s, bookmarkFolders: change(s.bookmarkFolders ?? []) })
export const editBookmark = (url: string, change: Partial<Bookmark>) =>
  write((l) => l.map((b) => (b.url === url ? { ...b, ...change } : b)), () => op("bookmarks.edit", { url, ...change }), "Couldn't change the bookmark")
const edit = editBookmark
export const removeBookmark = (url: string) =>
  write((l) => l.filter((x) => x.url !== url), () => op("bookmarks.remove", { url }), "Couldn't remove the bookmark")

export function moveBookmark(url: string, folder: string, before: string) {
  return write((l) => {
    const b = l.find((x) => x.url === url)
    if (!b) return l
    const rest = l.filter((x) => x.url !== url), moved = { ...b, folder }
    let at = before ? rest.findIndex((x) => x.url === before && x.folder === folder) : -1
    if (at < 0) { at = rest.length; for (let i = rest.length - 1; i >= 0; i--) if (rest[i].folder === folder) { at = i + 1; break } }
    return [...rest.slice(0, at), moved, ...rest.slice(at)]
  }, () => op("bookmarks.edit", { url, folder, before }), "Couldn't move the bookmark")
}

export function newFolder(parent: string, then?: (folder: string) => void) {
  askText({ title: "New folder", placeholder: "Name", hint: parent ? `Type a name for a folder in ${folderName(parent)}.` : "Type a name for a bookmarks folder.",
    label: (t) => `New folder “${tidy(t)}”`, onText: (t) => {
      const f = join(parent, tidy(t))
      if (!tidy(t)) return
      if (then) return then(f)
      void optimistic((s) => folders((l) => (l.includes(f) ? l : [...l, f]))(s), () => queued(() => op("bookmarks.folder", { folder: f })), "Couldn't make the folder")
    } })
}

export function renameFolder(folder: string) {
  const name = folder.split("/").pop()!, parent = folder.split("/").slice(0, -1).join("/")
  askText({ title: `Rename ${name}`, placeholder: name, typed: name, hint: "Type the folder's new name.", label: (t) => `Rename to “${tidy(t)}”`, onText: (t) => {
    const to = join(parent, tidy(t))
    if (!tidy(t) || to === folder) return
    const re = (f: string) => (f === folder ? to : f.startsWith(`${folder}/`) ? to + f.slice(folder.length) : f)
    void optimistic((s) => ({ ...folders((l) => l.map(re))(s), bookmarks: (s.bookmarks ?? []).map((b) => ({ ...b, folder: re(b.folder) })) }),
      () => queued(() => op("bookmarks.folder", { folder, rename: tidy(t) })), "Couldn't rename the folder")
  } })
}

export async function removeFolder(folder: string) {
  const inside = (f: string) => f === folder || f.startsWith(`${folder}/`)
  const n = marks().filter((b) => inside(b.folder)).length
  if (n && !await confirmDialog({ title: `Delete ${folder.split("/").pop()}?`, body: `Its ${plural(n, "bookmark")} go with it, from your bookmarks note.`, confirm: "Delete", danger: true })) return
  void optimistic((s) => ({ ...folders((l) => l.filter((f) => !inside(f)))(s), bookmarks: (s.bookmarks ?? []).filter((b) => !inside(b.folder)) }),
    () => queued(() => op("bookmarks.folder", { folder, remove: true })), "Couldn't delete the folder")
}

export const openBookmarksNote = () => { const n = getStore()?.bookmarksNote; if (n) openFile(n) }

let naming: { url: string; title: string } | null = null
function saveName() {
  const n = naming
  naming = null
  const was = n && markOf(n.url)
  if (n && was && n.title.trim() && n.title.trim() !== was.title) void edit(n.url, { title: n.title.trim() })
}

export function openBookmark(url: string, title: string, at: DOMRect) {
  if (!/^https?:\/\//i.test(url)) return
  saveName()
  const added = !markOf(url)
  if (added) void write((l) => [...l, { url, title, folder: "" }], () => op("bookmarks.add", { url, title }), "Couldn't bookmark the page")
  naming = { url, title: markOf(url)?.title ?? title }
  const items = (): MenuItem[] => {
    const b = markOf(url)
    if (!b) return []
    return [
      { caption: true, label: added ? "Bookmark added" : "Edit bookmark", run: () => {} },
      { label: "Name", field: { value: naming?.url === url ? naming.title : b.title, placeholder: "Name", set: (v) => { naming = { url, title: v } } }, run: () => {} },
      { label: "Folder", icon: Folder, hint: folderName(b.folder), run: () => {},
        items: [
          ...allFolders().map((f) => ({ label: folderName(f), checked: f === b.folder, run: () => { if (f !== markOf(url)?.folder) void edit(url, { folder: f }) } })),
          { label: "New folder…", icon: FolderPlus, sep: true, run: () => { saveName(); newFolder("", (f) => void edit(url, { folder: f })) } },
        ] },
      ...(getStore()?.bookmarksNote ? [{ label: "Open bookmarks", icon: BookOpen, sep: true, run: openBookmarksNote }] : []),
      { label: "Remove", icon: Trash2, danger: true, sep: !getStore()?.bookmarksNote, run: () => { naming = null; void removeBookmark(url) } },
      { label: "Done", icon: Check, run: () => {} },
    ]
  }
  openMenu({ x: at.left, y: at.bottom + 4, flip: at.top - 4 }, items(), false, items)
}

export const starOf = (id: number) => (id ? document.querySelector<HTMLElement>(`[data-web-page="${id}"] [data-web-star]`) : null)

export function StarButton({ url, title }: { url: string; title: string }) {
  const on = useStore().store?.bookmarks?.some((b) => b.url === url) ?? false
  const showing = useMenuShowing()
  useEffect(() => { if (!showing) saveName() }, [showing])
  const keys = commandKeys("web:bookmark")
  const label = on ? "Edit bookmark" : "Bookmark this page"
  return (
    <button type="button" aria-label={label} aria-pressed={on} aria-haspopup="menu" data-tip={keys ? `${label} (${keys})` : label} data-web-star={on ? "on" : "off"}
      onClick={(e) => { if (!menuShowing()) openBookmark(url, title, e.currentTarget.getBoundingClientRect()) }}
      className={cn("flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[5px] hover:bg-foreground/[0.07]",
        on ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
      <Star className={cn("size-3.5", on && "fill-current")} strokeWidth={2} />
    </button>
  )
}
