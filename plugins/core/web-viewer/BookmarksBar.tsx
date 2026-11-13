import { useId, useLayoutEffect, useRef, useState } from "react"
import { ChevronsRight, ExternalLink, Folder, FolderPlus, Link, Pencil, BookOpen, Star, Trash2 } from "lucide-react"
import { cn, commandKeys, copyText, getStore, menuBelow, menuFor, op, reorder, slotAt, startDrag, useDrag, useDropHit, useDropTarget, useSlide, useStore, type MenuItem } from "@vaultite"
import { hostOf } from "./address"
import type { Bookmark } from "./bookmarks"
import { splitArg } from "./containers"
import { siteIcon } from "./icons"
import { barItems } from "./pagebar"
import { moveBookmark, newFolder, openBookmark, openBookmarksNote, removeBookmark, removeFolder, renameFolder } from "./Star"

type Open = (url: string, place: "here" | "front" | "back") => void
const NONE: Bookmark[] = [], NO: string[] = []
const parentOf = (f: string) => f.split("/").slice(0, -1).join("/")
const nameOf = (f: string) => f.split("/").pop() ?? f
const labelOf = (b: Bookmark) => b.title || hostOf(b.url)

function foldersIn(parent: string, folders: string[], marks: Bookmark[]) {
  const all = [...new Set([...folders, ...marks.map((b) => b.folder).filter(Boolean)])]
  return all.filter((f) => parentOf(f) === parent)
}

function folderItems(folder: string, open: Open): MenuItem[] {
  const marks = getStore()?.bookmarks ?? NONE, folders = getStore()?.bookmarkFolders ?? NO
  const links = marks.filter((b) => b.folder === folder)
  const items: MenuItem[] = [
    ...links.map((b): MenuItem => ({ label: labelOf(b), icon: siteIcon(b.url), run: () => open(b.url, "here") })),
    ...foldersIn(folder, folders, marks).map((f, i): MenuItem => ({ label: nameOf(f), icon: Folder, sep: i === 0 && links.length > 0, run: () => {}, items: folderItems(f, open) })),
  ]
  if (!items.length) return [{ label: "Empty", disabled: true, run: () => {} }]
  if (links.length > 1) items.push({ label: `Open all (${links.length})`, icon: ExternalLink, sep: true, run: () => openAll(folder, open) })
  return items
}
const openAll = (folder: string, open: Open) => { for (const b of (getStore()?.bookmarks ?? NONE).filter((x) => x.folder === folder)) open(b.url, "back") }

type Hit = { into: string } | { order: string[]; before: string; add?: { url: string; title: string } }

export function BookmarksBar({ open, page }: { open: Open; page: { url: string; title: string } }) {
  const marks = useStore().store?.bookmarks ?? NONE
  const folders = useStore().store?.bookmarkFolders ?? NO
  const links = marks.filter((b) => !b.folder)
  const tops = foldersIn("", folders, marks)
  const box = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(Infinity)

  const count = links.length + tops.length
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const chips = [...el.querySelectorAll<HTMLElement>(":scope > [data-web-mark], :scope > [data-web-mark-folder]")]
      const room = el.clientWidth
      let n = chips.findIndex((c) => c.offsetLeft + c.offsetWidth > room)
      if (n >= 0) { const end = room - 28; n = chips.findIndex((c) => c.offsetLeft + c.offsetWidth > end) }
      setFit(n < 0 ? Infinity : n)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [count, marks, folders])

  const id = `web-viewer:marks:${useId()}`
  const keys = links.map((b) => b.url)
  useDropTarget<Hit>(id, (item, x, y, el) => {
    const bar = box.current
    const url = item.bookmark ?? (item.to?.startsWith("view:web/") ? splitArg(item.to.slice(9)).url : "")
    if (!bar || !/^https?:\/\//i.test(url)) return null
    const b = bar.getBoundingClientRect()
    if (x < b.left || x > b.right || y < b.top - 6 || y > b.bottom + 6) return null
    const had = marks.find((m) => m.url === url)
    if (!item.bookmark && had) return null
    const folder = el?.closest<HTMLElement>("[data-web-mark-folder]")?.dataset.webMarkFolder
    if (folder !== undefined) return had?.folder === folder ? null : { into: folder }
    const chips = [...bar.querySelectorAll<HTMLElement>(":scope > [data-slide]")]
    const r = reorder(keys, [url], slotAt(bar, chips, x, y, "x"))
    if (r.same && had && !had.folder) return null
    return { order: r.order, before: r.before ?? "", add: had ? undefined : { url, title: item.label ?? "" } }
  }, (item, h) => {
    const url = item.bookmark ?? splitArg(item.to!.slice(9)).url
    const add = "order" in h ? h.add : !item.bookmark ? { url, title: item.label ?? "" } : undefined
    const move = () => moveBookmark(url, "into" in h ? h.into : "", "into" in h ? "" : h.before)
    if (add) void op("bookmarks.add", { url: add.url, title: add.title }).then(move)
    else void move()
  }, { hint: (h) => ("into" in h ? `Move to ${nameOf(h.into)}` : undefined) })
  const hit = useDropHit<Hit>(id)
  useSlide(box, hit && "order" in hit ? hit.order : null, "x")
  const lifted = useDrag((d) => d?.item.bookmark ?? null)

  const bookmarkPage = (at: DOMRect) => openBookmark(page.url, page.title, at)
  const barMenu = (): MenuItem[] => [
    ...(/^https?:\/\//i.test(page.url) ? [{ label: marks.some((b) => b.url === page.url) ? "Edit bookmark…" : "Bookmark this page…", icon: Star, hint: commandKeys("web:bookmark") || undefined,
      run: () => bookmarkPage(box.current?.getBoundingClientRect() ?? new DOMRect()) }] : []),
    { label: "New folder…", icon: FolderPlus, run: () => newFolder("") },
    ...(getStore()?.bookmarksNote ? [{ label: "Open bookmarks", icon: BookOpen, run: openBookmarksNote }] : []),
    ...barItems(true),
  ]
  const markMenu = (b: Bookmark, el: HTMLElement): MenuItem[] => [
    { label: "Open in new tab", icon: ExternalLink, run: () => open(b.url, "front") },
    { label: "Edit…", icon: Pencil, sep: true, run: () => openBookmark(b.url, b.title, el.getBoundingClientRect()) },
    { label: "Copy link", icon: Link, run: () => void copyText(b.url) },
    { label: "Delete", icon: Trash2, danger: true, run: () => void removeBookmark(b.url) },
    ...barMenu().map((m, i) => (i ? m : { ...m, sep: true })),
  ]
  const folderMenu = (f: string): MenuItem[] => {
    const n = marks.filter((b) => b.folder === f).length
    return [
      ...(n ? [{ label: `Open all (${n})`, icon: ExternalLink, run: () => openAll(f, open) }] : []),
      { label: "New folder…", icon: FolderPlus, sep: n > 0, run: () => newFolder(f) },
      { label: "Rename…", icon: Pencil, run: () => renameFolder(f) },
      { label: "Delete", icon: Trash2, danger: true, run: () => void removeFolder(f) },
      ...barItems(true),
    ]
  }

  const chip = "flex h-6 max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[5px] px-1.5 text-[12px] text-foreground/85 hover:bg-foreground/[0.07]"
  const over = !!hit && "into" in hit ? hit.into : null
  const hidden = (i: number) => i >= fit
  return (
    <div className="relative flex h-8 shrink-0 items-center border-b-[0.5px] border-border pr-1.5 pl-1" data-web-marks data-own-drops onContextMenu={(e) => {
      if (!(e.target instanceof Element && e.target.closest("[data-web-mark], [data-web-mark-folder], [data-web-marks-more]"))) menuFor(barMenu)(e)
    }}>
      <div ref={box} className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden" data-web-marks-list>
        {!count && <span className="truncate px-1.5 text-[12px] text-tertiary" data-web-marks-empty>
          Bookmark pages{commandKeys("web:bookmark") ? ` with ${commandKeys("web:bookmark")}` : ""} or drag tabs here for quick access
        </span>}
        {links.map((b, i) => {
          const Icon = siteIcon(b.url)
          return (
            <button key={b.url} type="button" data-slide={b.url} data-web-mark={b.url} data-tip={`${labelOf(b)}\n${b.url}`}
              className={cn(chip, hidden(i) && "invisible", lifted === b.url && "opacity-40")}
              onPointerDown={(e) => startDrag(e, { from: "bookmark", bookmark: b.url, to: `view:web/${b.url}`, label: labelOf(b) })}
              onClick={(e) => open(b.url, e.metaKey || e.ctrlKey ? (e.shiftKey ? "front" : "back") : "here")}
              onAuxClick={(e) => { if (e.button === 1) open(b.url, "back") }}
              onContextMenu={(e) => { const el = e.currentTarget; menuFor(() => markMenu(b, el))(e) }}>
              <Icon className="size-3.5 shrink-0" strokeWidth={2} />
              {b.title && <span className="min-w-0 truncate">{b.title}</span>}
            </button>
          )
        })}
        {tops.map((f, j) => (
          <button key={f} type="button" aria-haspopup="menu" data-web-mark-folder={f}
            className={cn(chip, hidden(links.length + j) && "invisible", over === f && "bg-primary/15 text-primary hover:bg-primary/15")}
            onClick={(e) => menuBelow(e, folderItems(f, open))} onContextMenu={menuFor(() => folderMenu(f))}>
            <Folder className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
            <span className="min-w-0 truncate">{nameOf(f)}</span>
          </button>
        ))}
      </div>
      {fit < count && (
        <button type="button" aria-label="More bookmarks" aria-haspopup="menu" data-tip="More bookmarks" data-web-marks-more
          className="absolute right-1.5 flex size-6 cursor-pointer items-center justify-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
          onClick={(e) => menuBelow(e, [
            ...links.slice(fit).map((b): MenuItem => ({ label: labelOf(b), icon: siteIcon(b.url), run: () => open(b.url, "here") })),
            ...tops.filter((_, j) => links.length + j >= fit).map((f): MenuItem => ({ label: nameOf(f), icon: Folder, run: () => {}, items: folderItems(f, open) })),
          ])} onContextMenu={menuFor(barMenu)}>
          <ChevronsRight className="size-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
