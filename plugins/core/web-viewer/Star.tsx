// The address bar's star, as Chrome's: outline when the page isn't bookmarked, filled when it is. A click (or ⌘D)
// bookmarks it and opens its card (name, folder, Remove); a bookmarked page's opens it to edit. Format: bookmarks.ts.
import { useEffect } from "react"
import { BookOpen, Check, Folder, Star, Trash2 } from "lucide-react"
import { cn, commandKeys, getStore, menuShowing, op, openFile, openMenu, optimistic, useMenuShowing, useStore, type MenuItem } from "@vaultite"
import type { Bookmark } from "./bookmarks"

const NONE: Bookmark[] = []
const marks = () => getStore()?.bookmarks ?? NONE
const markOf = (url: string) => marks().find((b) => b.url === url)
const folderName = (f: string) => (f ? f.split("/").join(" / ") : "Bookmarks")

// (writes in order: an edit made while the add is on its way waits for it)
let queue: Promise<unknown> = Promise.resolve()
const write = (change: (l: Bookmark[]) => Bookmark[], run: () => Promise<unknown>, failed: string) => {
  const next = queue.then(() => run())
  queue = next.catch(() => {})
  return optimistic((s) => ({ ...s, bookmarks: change(s.bookmarks ?? []) }), () => next, failed)
}
const edit = (url: string, change: Partial<Bookmark>) =>
  write((l) => l.map((b) => (b.url === url ? { ...b, ...change } : b)), () => op("bookmarks.edit", { url, ...change }), "Couldn't change the bookmark")

/** The name typed in the open card, saved as it closes (each keystroke would be a vault write). */
let naming: { url: string; title: string } | null = null
function saveName() {
  const n = naming
  naming = null
  const was = n && markOf(n.url)
  if (n && was && n.title.trim() && n.title.trim() !== was.title) void edit(n.url, { title: n.title.trim() })
}

/** Bookmark `url` if it isn't yet, and open its card under `at` (the star's rect). */
export function openBookmark(url: string, title: string, at: DOMRect) {
  if (!/^https?:\/\//i.test(url)) return
  saveName()
  const added = !markOf(url)
  if (added) void write((l) => [...l, { url, title, folder: "" }], () => op("bookmarks.add", { url, title }), "Couldn't bookmark the page")
  naming = { url, title: markOf(url)?.title ?? title }
  const items = (): MenuItem[] => {
    const b = markOf(url)
    if (!b) return []
    const folders = [...new Set(["", ...marks().map((x) => x.folder)])]
    return [
      { caption: true, label: added ? "Bookmark added" : "Edit bookmark", run: () => {} },
      { label: "Name", field: { value: naming?.url === url ? naming.title : b.title, placeholder: "Name", set: (v) => { naming = { url, title: v } } }, run: () => {} },
      { label: "Folder", icon: Folder, hint: folderName(b.folder), run: () => {},
        items: folders.map((f) => ({ label: folderName(f), checked: f === b.folder, run: () => { if (f !== markOf(url)?.folder) void edit(url, { folder: f }) } })) },
      ...(getStore()?.bookmarksNote ? [{ label: "Open bookmarks", icon: BookOpen, sep: true, run: () => { const n = getStore()?.bookmarksNote; if (n) openFile(n) } }] : []),
      { label: "Remove", icon: Trash2, danger: true, sep: !getStore()?.bookmarksNote, run: () => {
        naming = null
        void write((l) => l.filter((x) => x.url !== url), () => op("bookmarks.remove", { url }), "Couldn't remove the bookmark")
      } },
      { label: "Done", icon: Check, run: () => {} },
    ]
  }
  openMenu({ x: at.left, y: at.bottom + 4, flip: at.top - 4 }, items(), false, items)
}

/** Page `id`'s star in its bar, if it shows one. */
export const starOf = (id: number) => (id ? document.querySelector<HTMLElement>(`[data-web-page="${id}"] [data-web-star]`) : null)

export function StarButton({ url, title }: { url: string; title: string }) {
  const on = useStore().store?.bookmarks?.some((b) => b.url === url) ?? false
  // The card closed (Enter, Esc, Done, a click away): its name is saved.
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
