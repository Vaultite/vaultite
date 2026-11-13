import { useEffect, useId, useRef, useState } from "react"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Folder, Hash, Heading, LayoutGrid, List, PinOff, Plus, Search } from "lucide-react"
import {
  coarse, edgeScroller, checklist, cn, currentWorkspace, fileMenu, FileTree, folderMenu, folderTarget, getStore, HeadingButton, iconAt, isFolder, isListedPage, menuFor, notifyError, offPlugin, openAt, openFile, openFolder,
  openingSoon, openInSplit, pinnedFoldersOpen, pluginSettings,
  INCOMING, openItem, openView, pastEnd, PIN_SEARCH, reorder, resolveView, rowMenu, selectClick, selectedAttr, selectionFor, SidebarRow, SidebarTile, slotAt, startDrag, stem, useDrag,
  useDropHit, useDropTarget, useEnabled, useRewrap, useSelectable, useSelectedKeys, useSlide, useViewsVersion, useWorkspaceVersion, viewInfo, viewSurfaces, type CheckItem, type DragItem, type MenuItem,
  type SidebarCtx,
} from "@vaultite"
import { SquareArrowOutUpRight } from "lucide-react"
import { currentPins, isPinned, pin, pinMany, pinManyNoted, pinnable, pinNoted, shownEntries, viewPin, type PinEntry } from "./types"

const PINS = "pins"
const canPin = (item: DragItem) => (item.from === "pin" ? !!item.path : pinsOf(item).length > 0)
const pinsOf = (item: DragItem) => (item.from === "pin" ? item.paths ?? [item.path!]
  : item.paths ? item.paths.filter((p) => pinnable(p) && inVault(p))
  : item.to?.startsWith("view:") ? [viewPin(item.to)?.key ?? ""].filter(Boolean)
  : (item.folder || item.to?.startsWith("file:")) && item.path && pinnable(item.path) ? [item.path] : [])
const inVault = (p: string) => {
  const t = getStore()?.files
  return !!t && (t.files.some((f) => f.path === p) || t.others.some((f) => f.path === p) || isFolder(t, p))
}
const SELECT = "pins"
const targetOf = (e: PinEntry) => (e.kind === "search" ? `view:search/${e.query}` : e.kind === "view" ? resolveView(e.target)
  : e.kind === "folder" ? folderTarget(e.path) : `file:${e.kind === "file" ? e.path : e.file.path}`)
function openEntry(e: PinEntry, opts: { newTab?: boolean; pane?: string }) {
  if (e.kind === "folder") return
  if (e.kind === "file") return openFile(e.key, opts)
  if (e.kind === "heading") return openAt(e.file.path, e.heading, opts)
  if (e.kind === "view") return openView(e.target, { newTab: opts.newTab })
  openView(`search/${e.query}`, { newTab: opts.newTab })
}
const openTile = (folder: string, newTab: boolean) => openFolder(folder, { newTab })
type PinDrop = ({ before: string | null; known: boolean } | { out: true }) & { order: string[] }

const settings = pluginSettings<{ show?: "list" | "tiles" }>("pages")

export function pinChecklist(file: string | undefined): MenuItem[] {
  const store = getStore()
  if (!store) return []
  const on = shownEntries(store)
  const pages = store.files.files.filter((f) => isListedPage(f.path, store) && !f.archived && !offPlugin(f) && !isPinned(f.path))
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

export function showAsMenu(): MenuItem[] {
  const show = settings.get().show ?? "list"
  const set = (v: "list" | "tiles") => void settings.set({ show: v === "list" ? null : v }).catch((e) => notifyError(e, "Couldn't change it"))
  return [{ label: "Show as", icon: show === "tiles" ? LayoutGrid : List, run: () => {}, items: [
    { label: "List", icon: List, checked: show === "list", run: () => set("list") },
    { label: "Tiles", icon: LayoutGrid, checked: show === "tiles", run: () => set("tiles") },
  ] }]
}

const named = (name: string | null, menu: () => MenuItem[]) => (): MenuItem[] => {
  const items = menu()
  return name ? [{ label: name, caption: true, run: () => {} }, ...items.map((it, i) => (i ? it : { ...it, sep: true }))] : items
}

export function PinCurrent({ file }: { file: string }) {
  useWorkspaceVersion()
  if (!file || !pinnable(file) || isPinned(file)) return null
  return (
    <HeadingButton icon={Plus} label="Pin current file" onClick={() => pinNoted(file, true)} />
  )
}

export function PinnedPages({ store, open, file, tab, panel, pane, flyout, tiles: asTiles }: SidebarCtx & {
  pane?: string
  tiles?: boolean }) {
  useEnabled()
  useWorkspaceVersion()
  useViewsVersion()
  const desk = currentWorkspace()
  const pages = shownEntries(store)
  const shownAs = settings.use().show
  const tiles = !!asTiles || (shownAs === "tiles" && open && !!panel && !flyout)
  const list = useRef<HTMLElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const item = useDrag((d) => d?.item ?? null)
  const dragging = !!item && canPin(item)
  const target = `${PINS}:${useId()}`
  const hit = useDropHit<PinDrop>(target)
  const [edge] = useState(() => edgeScroller())
  useDropTarget<PinDrop>(target, (item, x, y, el) => {
    const nav = list.current, inner = box.current
    if (!el || !nav || !inner || !canPin(item)) return null
    edge.over(nav, x, y)
    const rows = [...inner.children].filter((r): r is HTMLElement => r instanceof HTMLElement && !!r.dataset.slide && r.dataset.slide !== INCOMING)
    const keys = rows.map((r) => r.dataset.slide!), moving = pinsOf(item)
    const last = rows[rows.length - 1]
    if (!nav.contains(el) && !(last && pastEnd(nav, last, x, y, el))) {
      return item.from === "pin" && el.closest("aside") && el.closest("aside") === nav.closest("aside") ? { out: true, order: keys.filter((k) => !moving.includes(k)) } : null
    }
    if (item.from === "tree" && el.closest("[data-pin-tree]")) return null
    const { order, before, same } = reorder(keys, moving, slotAt(inner, rows, x, y, tiles ? "wrap" : "y"))
    if (same) return null
    const all = currentPins(store)
    return { before, order, known: moving.every((k) => all.includes(k)) }
  }, (item, h) => {
    const keys = pinsOf(item)
    if (keys.length === 1) void pin(keys[0], !("out" in h), "out" in h ? undefined : h.before, item.from !== "pin" && item.to?.startsWith("view:") ? viewPin(item.to)?.label : undefined)
    else if ("out" in h) void pinManyNoted(keys, false)
    else void pinMany(keys, true, h.before)
  }, {
    hint: (h) => ("out" in h ? "Unpin" : h.known ? undefined : desk ? `Pin in ${desk.label}` : "Pin"),
    weak: (h) => "out" in h,
    end: edge.stop,
  })
  const order = dragging && hit ? hit.order : null
  useSlide(box, order, tiles ? "wrap" : "y")
  useRewrap(box, tiles)
  const picks = useSelectedKeys(SELECT)
  useSelectable(SELECT, { noun: ["page", "pages"], menu: (keys) => {
    const shown = shownEntries(store).filter((e) => keys.includes(e.key) && e.kind !== "folder")
    return [
      ...(shown.length ? [{ label: shown.length === 1 ? "Open in new tab" : `Open ${shown.length} in new tabs`, icon: SquareArrowOutUpRight, run: () => shown.forEach((e) => openEntry(e, { newTab: true, pane })) }] : []),
      { label: "Unpin", icon: PinOff, run: () => void pinManyNoted(keys, false) },
    ]
  } })
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
  const moveItems = (id: string): MenuItem[] => {
    const keys = pages.map((e) => e.key), i = keys.indexOf(id)
    return [
      { label: tiles ? "Move left" : "Move up", icon: tiles ? ArrowLeft : ArrowUp, sep: true, disabled: i <= 0, run: () => void pin(id, true, keys[i - 1]) },
      { label: tiles ? "Move right" : "Move down", icon: tiles ? ArrowRight : ArrowDown, disabled: i < 0 || i >= keys.length - 1, run: () => void pin(id, true, keys[i + 2] ?? null) },
    ]
  }
  const current = file
  if (!open && !pages.length) return null
  const row = (entry: PinEntry) => {
    const id = entry.key, to = targetOf(entry)
    const picked = picks.has(id)
    const file = entry.kind === "file" ? entry.path : entry.kind === "heading" ? entry.file.path : null
    const view = entry.kind === "view" ? viewInfo(entry.target) : null
    const folder = entry.kind === "folder" ? entry : null
    const inPlace = open && !tiles
    const unfold = !!folder && inPlace && unfolded.has(id)
    const shown = entry.kind === "file" ? iconAt(entry.path) : null
    const icon = view ? view.icon : folder ? (inPlace ? ChevronRight : Folder) : entry.kind === "search" ? Search : entry.kind === "heading" ? (entry.heading.startsWith("^") ? Hash : Heading) : shown!.icon
    const active = entry.kind === "file" ? id === current : entry.kind === "view" && !!tab && (tab === entry.target || tab === to)
    const label = folder?.parent ? <><span className="text-muted-foreground">{folder.parent.split("/").join(" / ")} / </span>{folder.label}</> : entry.label
    const href = folder ? undefined : `#${file ? `file/${encodeURIComponent(file)}` : `view/${encodeURIComponent(to!.slice(5))}`}`
    const click = (e: React.MouseEvent) => {
      if (selectClick(e, SELECT, id, entry.kind === "file" && id === current ? id : null)) return
      if (folder) return inPlace ? pinnedFoldersOpen.toggle(id) : openTile(id, e.metaKey || e.ctrlKey || e.button === 1)
      openEntry(entry, { newTab: e.metaKey || e.ctrlKey || e.button === 1, pane })
    }
    return (
      <div key={id} data-slide={id} className={cn(unfold && "flex flex-col gap-px")}>
      <div onPointerDown={(e) => {
        if (file) openingSoon(file, true)
        const keys = selectionFor(SELECT, id, false)
        const tos = keys && keys.length > 1 ? pages.filter((x) => keys.includes(x.key)).map(targetOf) : undefined
        startDrag(e, keys && tos ? { from: "pin", to, path: id, paths: keys, tos, label: `${keys.length} pages` } : { from: "pin", to, path: id, folder: !!folder || undefined }, { touch: true })
      }}
        onPointerEnter={() => file && openingSoon(file)} onPointerLeave={() => openingSoon(null)}
        onContextMenu={menuFor(named(tiles && coarse ? (folder ? id : entry.label) : null, rowMenu(SELECT, id, () => [
          ...(folder ? folderMenu(id, { skip: "pages" }) : [openItem(() => openEntry(entry, { newTab: true, pane }), () => openInSplit(to!, "right"))]),
          ...(entry.kind === "file" ? fileMenu(id).filter((it) => it.label !== "Unpin").map((it, i) => (i ? it : { ...it, sep: true })) : []),
          ...(pages.length > 1 ? moveItems(id) : []),
          { label: "Unpin", icon: PinOff, sep: !(pages.length > 1), run: () => pinNoted(id, false) },
        ])))}
        className={cn(item?.from === "pin" && (item.path === id || (picked && item.paths)) && "opacity-50")}>
        {tiles ? <SidebarTile data-pin={id} data-select-key={id} data-pin-folder={folder ? "" : undefined} {...selectedAttr(picked)} href={href} icon={icon}
          tint={view?.tint ?? shown?.tint} iconClassName={view?.iconClassName} badge={view?.badge} label={folder ? id : entry.label} active={active} onClick={click} />
        : <SidebarRow data-pin={id} data-select-key={id} data-pin-folder={folder ? "" : undefined} aria-expanded={folder && open ? unfold : undefined} {...selectedAttr(picked)}
          href={href} icon={icon}
          tint={view?.tint ?? shown?.tint} iconClassName={folder && open ? cn("transition-transform duration-150", unfold && "rotate-90") : view?.iconClassName} badge={view?.badge}
          label={label} tip={folder ? id : undefined} open={open} more active={active} swipe={() => [{ label: "Unpin", icon: PinOff, run: () => pinNoted(id, false), removes: true }]}
          onClick={click} />}
      </div>
      {unfold && <FileTree store={store} folder={id} header={false} active={current} pane={pane} />}
      </div>
    )
  }
  return (
    <nav ref={list} aria-label="Pages" onContextMenu={panel ? undefined : menuFor(() => pinChecklist(file))}
      data-pin-tiles={tiles ? "" : undefined}
      className={cn("relative shrink-0", dragging && !pages.length && "min-h-8 rounded-[6px] border border-dashed border-border")}>
      <div ref={box} className={cn("relative", tiles ? "grid grid-cols-[repeat(auto-fill,minmax(--spacing(11),1fr))] gap-1.5" : "flex flex-col gap-px")}
        data-select-list={SELECT}>
        {pages.map(row)}
        {!pages.length && open && panel && !dragging && <p className="col-span-full h-7 truncate pl-1.5 text-[13px] leading-7 text-tertiary">Pin a page to keep it here.</p>}
        {order?.includes(INCOMING) && <div aria-hidden data-slide={INCOMING} className="h-7" />}
      </div>
    </nav>
  )
}
