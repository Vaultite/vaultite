// The pinned pages (sidebar, drawer, view:pages): drag to reorder, onto a pane to open, elsewhere in the sidebar to
// unpin; drop a file to pin it. The list is the sidebar's (types.ts): the current workspace's with Workspaces on.
import { Fragment, useEffect, useId, useRef } from "react"
import { ChevronRight, Folder, Hash, Heading, PinOff, Plus, Search } from "lucide-react"
import {
  checklist, cn, currentWorkspace, fileMenu, FileTree, folderMenu, getStore, HeadingButton, iconAt, isFolder, isPage, menuFor, offPlugin, openAt, openFile, openingSoon, openInSplit,
  pinnedFoldersOpen, pluginSettings, showInTree,
  openItem, openView, pastEnd, PIN_SEARCH, placePin, resolveView, rowMenu, selectClick, selectedAttr, selectionFor, SidebarRow, SidebarTile, startDrag, stem, useDrag, useDropHit,
  useDropTarget, useEnabled, useSelectable, useSelectedKeys, useViewsVersion, useWorkspaceVersion, viewInfo, viewSurfaces, type CheckItem, type DragItem, type MenuItem, type SidebarCtx,
} from "@vaultite"
import { SquareArrowOutUpRight } from "lucide-react"
import { currentPins, isPinned, pin, pinMany, pinManyNoted, pinnable, pinNoted, shownEntries, viewPin, type PinEntry } from "./types"

const PINS = "pins"
/** A file or folder dragged here can be pinned: not one from outside the vault, not a hidden one (or one of the list's
 *  own, a heading or a search, moved within it); or a view's tab that can be (a web page, a coding agent's terminal). */
const canPin = (item: DragItem) => (item.from === "pin" ? !!item.path : pinsOf(item).length > 0)
/** What a drop would pin: the dragged file or folder, the ones among several selected in the tree, or a view's pin (a
 *  web page, a terminal's conversation, a search). */
const pinsOf = (item: DragItem) => (item.from === "pin" ? item.paths ?? [item.path!]
  : item.paths ? item.paths.filter((p) => pinnable(p) && inVault(p))
  : item.to?.startsWith("view:") ? [viewPin(item.to)?.key ?? ""].filter(Boolean)
  : (item.folder || item.to?.startsWith("file:")) && item.path && pinnable(item.path) ? [item.path] : [])
/** A file or folder of the vault. */
const inVault = (p: string) => {
  const t = getStore()?.files
  return !!t && (t.files.some((f) => f.path === p) || t.others.some((f) => f.path === p) || isFolder(t, p))
}
/** The pinned pages' selection (core/select.ts), by entry key. */
const SELECT = "pins"
/** Where a pinned entry opens, as a tab's target (a heading: its note; a conversation: the terminal running it, if one
 *  does). */
const targetOf = (e: PinEntry) => (e.kind === "search" ? `view:search/${e.query}` : e.kind === "view" ? resolveView(e.target)
  : e.kind === "folder" ? undefined : `file:${e.kind === "file" ? e.path : e.file.path}`)
/** Open a pinned entry: a page, a note at its heading, a search, a view (a conversation, resumed unless it's running).
 *  A folder opens in place instead (its row's click). */
function openEntry(e: PinEntry, opts: { newTab?: boolean; pane?: string }) {
  if (e.kind === "folder") return
  if (e.kind === "file") return openFile(e.key, opts)
  if (e.kind === "heading") return openAt(e.file.path, e.heading, opts)
  if (e.kind === "view") return openView(e.target, { newTab: opts.newTab })
  openView(`search/${e.query}`, { newTab: opts.newTab })
}
/** Where a drop lands: before a page (null: the end; `known`: already pinned, so only its place changes), its line
 *  across the list at `y` (tiles: down the grid at `x`, `h` tall), or `out` of the list, elsewhere in the sidebar. */
type PinDrop = { before: string | null; y: number; x?: number; h?: number; known: boolean } | { out: true }

/** The plugin's settings: `show`, how the open sidebar draws the list (manifest.json). */
const settings = pluginSettings<{ show?: "list" | "tiles" }>("pages")

/** Where a drop at (x, y) lands among tiles, as offsets in `nav`: before the first tile of the pointer's row whose
 *  middle is right of it, its line in the gap left of it; past a row's last tile, the line is right of that one. */
function tileDrop(nav: HTMLElement, x: number, y: number) {
  const tiles = [...nav.querySelectorAll<HTMLElement>("[data-pin]")].map((el) => ({ el, b: el.getBoundingClientRect() }))
  const box = nav.getBoundingClientRect()
  const gap = tiles.length > 1 ? Math.max(0, tiles[1].b.left - tiles[0].b.right) : 0
  const first = tiles.find((t) => y < t.b.bottom + gap)
  if (!first) {
    const last = tiles[tiles.length - 1]
    return { before: null, x: last.b.right - box.left + gap / 2, y: last.b.top - box.top, h: last.b.height }
  }
  const row = tiles.filter((t) => Math.abs(t.b.top - first.b.top) < 1)
  const next = row.find((t) => x < t.b.left + t.b.width / 2)
  const end = row[row.length - 1]
  const after = tiles[tiles.indexOf(end) + 1]
  return { before: next ? next.el.dataset.pin! : after?.el.dataset.pin ?? null,
    x: (next ? next.b.left - gap / 2 : end.b.right + gap / 2) - box.left, y: first.b.top - box.top, h: first.b.height }
}

/** The list's menu (Pinned pages ▸): the shown ones ticked, then More ▸ with unpinned pages, the file on screen and the
 *  plugins' main views (Inbox, Graph view); a `checklist`, redrawn after each click. Same-named ones say their folders. */
export function pinChecklist(file: string | undefined): MenuItem[] {
  const store = getStore()
  if (!store) return []
  const on = shownEntries(store)
  const pages = store.files.files.filter((f) => isPage(f.path, store) && !f.archived && !offPlugin(f) && !isPinned(f.path))
    .sort((a, b) => stem(a.path).localeCompare(stem(b.path)))
  const here = file && pinnable(file) && !isPinned(file) && !pages.some((f) => f.path === file) ? [file] : []
  const views = viewSurfaces().filter((v) => !isPinned(v.key)).sort((a, b) => a.label.localeCompare(b.label))
  const names = [...on.map((e) => e.label), ...pages.map((f) => stem(f.path)), ...views.map((v) => v.label)]
  const choice = (key: string, label: string): CheckItem => {
    const dir = key.startsWith(PIN_SEARCH) || key.startsWith("view:") ? "" : key.replace(/#.*$/, "").replace(/\/?[^/]*$/, "")
    return { key, label, hint: names.filter((n) => n === label).length > 1 && dir ? dir.split("/").pop() : undefined }
  }
  return checklist("pins", {
    on: on.map((e) => choice(e.key, e.label)),
    off: [pages.map((f) => choice(f.path, stem(f.path))), here.map((p) => choice(p, stem(p))), views.map((v) => choice(v.key, v.label))],
    set: (key, on, before) => void pin(key, on, on ? before : undefined),
  })
}

/** The heading's +: pin the file on screen, when it can be and isn't yet. */
export function PinCurrent({ file }: { file: string }) {
  useWorkspaceVersion()
  if (!file || !pinnable(file) || isPinned(file)) return null
  return (
    <HeadingButton icon={Plus} label="Pin current file" onClick={() => pinNoted(file, true)} />
  )
}

export function PinnedPages({ store, open, file, tab, panel, pane, phone, flyout }: SidebarCtx & {
  /** Open pages in that pane (the Pinned tab opens them beside itself). */
  pane?: string }) {
  useEnabled() // drawn again when a plugin is turned on or off (its pages show or hide)
  useWorkspaceVersion() // and when the workspace, or its pins, change
  useViewsVersion() // and when a pinned view's state does (a conversation running, waiting for an answer)
  const desk = currentWorkspace()
  const pages = shownEntries(store)
  // Tiles only in the open sidebar: the rail, a phone's drawer and the Pinned tab keep the list.
  const tiles = settings.use().show === "tiles" && open && !!panel && !phone && !flyout
  const list = useRef<HTMLElement>(null)
  const d = useDrag()
  const dragging = !!d && canPin(d.item)
  // Each list its own target (the sidebar's, and one in a Pinned tab); only the sidebar's unpins what leaves it.
  const target = `${PINS}:${useId()}`
  const hit = useDropHit<PinDrop>(target)
  const line = hit && "y" in hit ? hit : null
  useDropTarget<PinDrop>(target, (item, x, y, el) => {
    const nav = list.current
    if (!el || !nav || !canPin(item)) return null
    const rows = [...nav.querySelectorAll<HTMLElement>("[data-pin]")]
    const last = rows[rows.length - 1]
    // Just under the list is its end, not out of it: unpinning takes leaving it for good.
    if (!nav.contains(el) && !(last && pastEnd(nav, last, x, y, el))) {
      return item.from === "pin" && el.closest("aside") && el.closest("aside") === nav.closest("aside") ? { out: true } : null
    }
    // (in a pinned folder's files, the tree's own drags move things there: its own target)
    if (item.from === "tree" && el.closest("[data-pin-tree]")) return null
    const top = nav.getBoundingClientRect().top
    const next = rows.find((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2 })
    const grid = nav.hasAttribute("data-pin-tiles") && last ? tileDrop(nav, x, y) : null
    const before = grid ? grid.before : next?.dataset.pin ?? null
    const all = currentPins(store)
    const keys = pinsOf(item)
    const known = keys.every((k) => all.includes(k))
    // Its own place (just before itself, or before the one after it): nothing to do.
    if (known && keys.length === 1 && placePin(all, item.path!, true, before).join("\n") === all.join("\n")) return null
    if (grid) return { ...grid, known }
    const end = last ? last.getBoundingClientRect().bottom - top : 2
    return { before, y: next ? next.getBoundingClientRect().top - top - 1 : end, known }
  }, (item, h) => {
    const keys = pinsOf(item)
    // (a view dropped here keeps its name now: a conversation's, which its tab loses once it ends)
    if (keys.length === 1) void pin(keys[0], !("out" in h), "out" in h ? undefined : h.before, item.from !== "pin" && item.to?.startsWith("view:") ? viewPin(item.to)?.label : undefined)
    else if ("out" in h) void pinManyNoted(keys, false)
    // (Placed before the first one after them that isn't among them.)
    else void pinMany(keys, true, h.before && keys.includes(h.before) ? currentPins(store).slice(currentPins(store).indexOf(h.before)).find((k) => !keys.includes(k)) ?? null : h.before)
  }, {
    // Words only for what changes more than the order: pinning a file, unpinning a page.
    hint: (h) => ("out" in h ? "Unpin" : h.known ? undefined : desk ? `Pin in ${desk.label}` : "Pin"),
    weak: (h) => "out" in h,
  })
  const picks = useSelectedKeys(SELECT)
  useSelectable(SELECT, { noun: ["page", "pages"], menu: (keys) => {
    const shown = shownEntries(store).filter((e) => keys.includes(e.key) && e.kind !== "folder")
    return [
      ...(shown.length ? [{ label: shown.length === 1 ? "Open in new tab" : `Open ${shown.length} in new tabs`, icon: SquareArrowOutUpRight, run: () => shown.forEach((e) => openEntry(e, { newTab: true, pane })) }] : []),
      { label: "Unpin", icon: PinOff, run: () => void pinManyNoted(keys, false) },
    ]
  } })
  // A page just pinned (from a menu, a drop, another device) is scrolled into view: the panel may be shorter than its
  // pages, scrolling in its own box.
  const shownKey = pages.map((x) => x.key).join("\n")
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    const now = new Set(shownKey ? shownKey.split("\n") : [])
    const was = seen.current
    seen.current = now
    if (!was || !open) return
    const added = [...now].find((k) => !was.has(k))
    if (added) list.current?.querySelector<HTMLElement>(`[data-pin="${CSS.escape(added)}"]`)?.scrollIntoView({ block: "nearest" })
  }, [shownKey, open])
  const unfolded = pinnedFoldersOpen.useAll()
  const current = file
  if (!open && !pages.length) return null
  const row = (entry: PinEntry) => {
    const id = entry.key, to = targetOf(entry)
    const picked = picks.has(id)
    const file = entry.kind === "file" ? entry.path : entry.kind === "heading" ? entry.file.path : null
    const view = entry.kind === "view" ? viewInfo(entry.target) : null
    // A folder: open in place, its files under it (the file tree's rows); in the rail and as a tile, only its icon.
    const folder = entry.kind === "folder" ? entry : null
    const inPlace = open && !tiles
    const unfold = !!folder && inPlace && unfolded.has(id)
    const shown = entry.kind === "file" ? iconAt(entry.path) : null
    const icon = view ? view.icon : folder ? (inPlace ? ChevronRight : Folder) : entry.kind === "search" ? Search : entry.kind === "heading" ? (entry.heading.startsWith("^") ? Hash : Heading) : shown!.icon
    const active = entry.kind === "file" ? id === current : entry.kind === "view" && !!tab && (tab === entry.target || tab === to)
    // Breadcrumb style, as the path bar above a file: its folders dimmed, then its name.
    const label = folder?.parent ? <><span className="text-muted-foreground">{folder.parent.split("/").join(" / ")} / </span>{folder.label}</> : entry.label
    const href = folder ? undefined : `#${file ? `file/${encodeURIComponent(file)}` : `view/${encodeURIComponent(to!.slice(5))}`}`
    const click = (e: React.MouseEvent) => {
      if (selectClick(e, SELECT, id, entry.kind === "file" && id === current ? id : null)) return
      // (the rail and a tile have no room to open it in: the file tree shows it)
      if (folder) return inPlace ? pinnedFoldersOpen.toggle(id) : void showInTree(id)
      openEntry(entry, { newTab: e.metaKey || e.ctrlKey || e.button === 1, pane })
    }
    return (
      <Fragment key={id}>
      <div onPointerDown={(e) => {
        if (file) openingSoon(file, true)
        const keys = selectionFor(SELECT, id, false)
        startDrag(e, keys && keys.length > 1 ? { from: "pin", to, path: id, paths: keys, label: `${keys.length} pages` } : { from: "pin", to, path: id }, { touch: true })
      }}
        onPointerEnter={() => file && openingSoon(file)} onPointerLeave={() => openingSoon(null)}
        // Right-clicked (or its …) on a page: opening it, a file's menu as anywhere else (its own Unpin left out), then
        // Unpin last. The panel's own menu is its heading's: Pinned pages ▸, Panels ▸, Hide.
        onContextMenu={menuFor(rowMenu(SELECT, id, () => [
          ...(folder ? folderMenu(id, { skip: "pages" }) : [openItem(() => openEntry(entry, { newTab: true, pane }), () => openInSplit(to!, "right"))]),
          ...(entry.kind === "file" ? fileMenu(id).filter((it) => it.label !== "Unpin").map((it, i) => (i ? it : { ...it, sep: true })) : []),
          { label: "Unpin", icon: PinOff, sep: true, run: () => pinNoted(id, false) },
        ]))}
        className={cn(d?.item.from === "pin" && (d.item.path === id || (picked && d.item.paths)) && "opacity-40")}>
        {tiles ? <SidebarTile data-pin={id} data-select-key={id} data-pin-folder={folder ? "" : undefined} {...selectedAttr(picked)} href={href} icon={icon}
          tint={view?.tint ?? shown?.tint} iconClassName={view?.iconClassName} badge={view?.badge} label={folder ? id : entry.label} active={active} onClick={click} />
        : <SidebarRow data-pin={id} data-select-key={id} data-pin-folder={folder ? "" : undefined} aria-expanded={folder && open ? unfold : undefined} {...selectedAttr(picked)}
          href={href} icon={icon}
          tint={view?.tint ?? shown?.tint} iconClassName={folder && open ? cn("transition-transform duration-150", unfold && "rotate-90") : view?.iconClassName} badge={view?.badge}
          label={label} tip={folder ? id : undefined} open={open} more active={active} swipe={() => [{ label: "Unpin", icon: PinOff, run: () => pinNoted(id, false), removes: true }]}
          onClick={click} />}
      </div>
      {unfold && <FileTree store={store} folder={id} header={false} active={current} pane={pane} />}
      </Fragment>
    )
  }
  return (
    // As a tab, the list's menu is the pages; in the sidebar it's the panel's (index.tsx: its `menu`).
    <nav ref={list} aria-label="Pages" onContextMenu={panel ? undefined : menuFor(() => pinChecklist(file))}
      data-pin-tiles={tiles ? "" : undefined}
      className={cn("relative shrink-0", dragging && !pages.length && "min-h-8 rounded-[6px] border border-dashed border-border")}>
      {/* Tiles: as many to a row as fit at least 11 units wide (four in a sidebar of the default width). */}
      <div className={tiles ? "grid grid-cols-[repeat(auto-fill,minmax(--spacing(11),1fr))] gap-1.5" : "flex flex-col gap-px"} data-select-list={SELECT}>{pages.map(row)}</div>
      {line && (line.x === undefined
        ? <div aria-hidden data-pin-line className="pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary" style={{ top: line.y }} />
        : <div aria-hidden data-pin-line className="pointer-events-none absolute w-0.5 rounded-full bg-primary" style={{ left: line.x - 1, top: line.y, height: line.h }} />)}
    </nav>
  )
}
