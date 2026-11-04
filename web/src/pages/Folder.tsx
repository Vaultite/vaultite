// A folder's page (view:folder/<path>, the Files plugin's): a grid, a list, columns or a gallery (files.json
// `folderView`, every folder the same; a phone has the first two), as Finder. Folders open in its tab, files beside.
import { Fragment, useEffect, useId, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent } from "react"
import { ArrowUpDown, Columns3, Ellipsis, FileInput, FilePlus, FolderInput, FolderOpen, FolderPlus, GalleryHorizontalEnd, Group, LayoutGrid, List, RotateCcw, Trash2 } from "lucide-react"
import { dateText, getStore, reload, useStore, vaultName, type Store } from "@/core/data"
import { createFolder, folderTarget, freeName, inArchive, inTrash, openFile, openingSoon, restoreFile } from "@/core/files"
import { edgeScroller, startDrag, useDropHit, useDropTarget, type DragItem } from "@/core/drag"
import { desktop, dropInto, hasFiles } from "@/core/desktop"
import { kindOf, type FileKind } from "@/core/filekinds"
import { notifyError } from "@/core/notify"
import { usePane } from "@/core/pane"
import { isDesktop, isMac, useDesktop } from "@/core/platform"
import { getPrefs, setPrefs, usePrefs, type FolderGroup, type FolderView } from "@/core/prefs"
import { rowMenu, selectClick, selectedAttr, selectionFor, useSelectable, useSelected } from "@/core/select"
import { openInSplit } from "@/core/splits"
import { useVirtual } from "@/core/virtual"
import { useFocusedFile } from "@/core/workspace"
import { menuBelow, menuFor, type MenuItem } from "@/components/ContextMenu"
import { copyPathItem, fileMenu, filesMenu, folderMenu, grouped, openFolderHereItem, openItem, remove } from "@/components/FileActions"
import { askMove, canMoveInto, fixed, folderItems, moveManyInto, newNote, SORTS, treeShownItems, type FolderItem } from "@/components/FileTree"
import { ROW, SidebarRow } from "@/components/Sidebar"
import type { SwipeAction } from "@/components/SwipeRow"
import { PageHeader } from "@/components/kit"
import { cn } from "@/lib/utils"
import { drawnRows, hrefOf, iconFor, metaOf, NameField, naming, SELECT, Tile, useEnter, useKept, usePreviews, type Kids } from "@/pages/FolderParts"
import { Columns } from "@/pages/FolderColumns"
import { Gallery } from "@/pages/FolderGallery"

/** A folder's name as its tab says it; the vault's own for its top. */
export const folderName = (path: string) => (path ? path.slice(path.lastIndexOf("/") + 1) : vaultName(getStore()))

// ---------- how it shows: Show as, Sort by, Group by ----------

type ViewOption = { value: FolderView; label: string; icon: typeof List }
/** Finder's four, in its order; a phone has room for the first two (the Files app's). */
const VIEWS: ViewOption[] = [
  { value: "grid", label: "Grid", icon: LayoutGrid }, { value: "list", label: "List", icon: List },
  { value: "columns", label: "Columns", icon: Columns3 }, { value: "gallery", label: "Gallery", icon: GalleryHorizontalEnd },
]
const viewsFor = (desk: boolean) => (desk ? VIEWS : VIEWS.slice(0, 2))
const viewOf = (v: unknown): FolderView => VIEWS.find((o) => o.value === v)?.value ?? "list"
/** The view drawn: on a phone, columns are a list and a gallery a grid (each the nearest it has room for). */
const shownView = (v: unknown, desk: boolean): FolderView => {
  const view = viewOf(v)
  return desk ? view : view === "columns" ? "list" : view === "gallery" ? "grid" : view
}
const setView = (v: FolderView) => void setPrefs({ folderView: v })

const GROUPS: { value: FolderGroup; label: string }[] = [{ value: "none", label: "None" }, { value: "kind", label: "Kind" }, { value: "modified", label: "Date modified" }]
const groupOf = (v: unknown): FolderGroup => GROUPS.find((o) => o.value === v)?.value ?? "none"

function sortItems(): MenuItem[] {
  const { fileSort } = getPrefs()
  return SORTS.flatMap((g, k) => g.map((o, i) => ({ label: o.label, checked: fileSort === o.value, sep: k > 0 && i === 0, run: () => void setPrefs({ fileSort: o.value }) })))
}
function groupItems(): MenuItem[] {
  const by = groupOf(getPrefs().folderGroup)
  return GROUPS.map((o) => ({ label: o.label, checked: by === o.value, run: () => void setPrefs({ folderGroup: o.value }) }))
}
/** Show as ▸, Sort by ▸, Group by ▸: how every folder's page shows (its tab's menu, its empty space's). */
function viewMenuItems(): MenuItem[] {
  const v = shownView(getPrefs().folderView, isDesktop())
  const icon = VIEWS.find((o) => o.value === v)!.icon
  return [
    { label: "Show as", icon, run: () => {}, items: viewsFor(isDesktop()).map((o) => ({ label: o.label, icon: o.icon, checked: v === o.value, run: () => setView(o.value) })) },
    { label: "Sort by", icon: ArrowUpDown, run: () => {}, items: sortItems() },
    { label: "Group by", icon: Group, run: () => {}, items: groupItems() },
  ]
}
/** The page's Sort button: the order, then the headings (Finder's Group by). */
const arrangeItems = (): MenuItem[] => [
  { label: "Sort by", caption: true, run: () => {} }, ...sortItems(),
  { label: "Group by", caption: true, sep: true, run: () => {} }, ...groupItems(),
]

/** Its tab's menu: how it shows, then the folder's own, short (as a file's tab has it: the rest in More folder
 *  actions ▸). */
export function folderTabMenu(path: string): MenuItem[] {
  const own = path ? folderMenu(path, { inside: true, short: true, newFolder: () => void newFolderIn(path) }) : rootItems()
  return grouped([viewMenuItems(), own])
}

/** A folder made here, its name ready to type. */
async function newFolderIn(folder: string) {
  const s = getStore()
  if (!s) return
  try { naming.set({ path: await createFolder(folder, freeName(s.files, folder, "New folder", "")), fresh: true }) } catch (e) { notifyError(e, "Couldn't make the folder") }
}
const newItems = (path: string): MenuItem[] => [{ label: "New note", icon: FilePlus, run: () => void newNote(path) }, { label: "New folder", icon: FolderPlus, run: () => void newFolderIn(path) }]
/** The vault's top has no menu of its own: what can be made in it. */
const rootItems = () => newItems("")

/** The page's … button: the folder's menu, then what the files show. */
function pageMenu(path: string): MenuItem[] {
  const shown = treeShownItems({ reveal: false })
  if (!path) return grouped([rootItems(), shown])
  return grouped([folderMenu(path, { open: false, inside: true, newFolder: () => void newFolderIn(path) }), shown])
}
/** A right-click on its empty space, as Finder's: make something, how it shows, where it is. */
function spaceMenu(path: string): MenuItem[] {
  const locked = !!path && (fixed(path) || inTrash(path))
  return grouped([locked ? [] : newItems(path), viewMenuItems(), path ? [copyPathItem(path, { folder: true }), ...openFolderHereItem(path)] : [], treeShownItems({ reveal: false })])
}

/** The desktop bar's crumbs: the vault, then each folder down to this one (its buttons are on the page, which shows
 *  where the bar is faded away). */
export const folderBar = (path: string) => ({ title: <Crumbs path={path} /> })

function Crumbs({ path }: { path: string }) {
  useStore()
  const enter = useEnter()
  const parts = path ? path.split("/") : []
  const crumbs = [{ at: "", name: folderName("") }, ...parts.map((name, i) => ({ at: parts.slice(0, i + 1).join("/"), name }))]
  const crumb = "h-6 min-w-0 truncate rounded-[4px] px-1 leading-6"
  return (
    <nav aria-label="Folder path" className="flex min-w-0 items-center">
      {crumbs.map((c, i) => i === crumbs.length - 1
        ? <span key={c.at} aria-current="page" onContextMenu={menuFor(() => pageMenu(c.at))} className={cn(crumb, "shrink-0 font-medium")}>{c.name}</span>
        : (
          <Fragment key={c.at}>
            <button type="button" onClick={() => enter(c.at, -1)} onContextMenu={c.at ? menuFor(() => folderMenu(c.at)) : undefined} data-tip-cut={c.name}
              className={cn(crumb, "shrink-[1000] cursor-pointer text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground", c.name.length > 2 && "min-w-[2.5em]")}>{c.name}</button>
            <span aria-hidden className="shrink-0 px-px text-tertiary">/</span>
          </Fragment>
        ))}
    </nav>
  )
}

/** Finder's toolbar, on the page: the four views side by side, Sort (and group), More. One for every folder, Settings'
 *  Files too. */
function Toolbar({ path, view }: { path: string; view: FolderView }) {
  const tool = "grid h-[26px] w-8 cursor-pointer place-items-center rounded-[7px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
  const grouped = groupOf(usePrefs().folderGroup) !== "none"
  return (
    <div className="mb-1 flex shrink-0 items-center gap-1.5">
      <div role="radiogroup" aria-label="Show as" className="flex rounded-[7px] bg-foreground/[0.05] p-px">
        {VIEWS.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={view === o.value} aria-label={o.label} data-tip={o.label} data-folder-view={o.value} onClick={() => setView(o.value)}
            className={cn("grid h-6 w-7 cursor-pointer place-items-center rounded-[6px] transition-colors",
              view === o.value ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.12)] dark:bg-[var(--segment-on)]" : "text-muted-foreground hover:text-foreground")}>
            <o.icon className="size-[15px]" strokeWidth={2} />
          </button>
        ))}
      </div>
      <button type="button" aria-label="Sort and group" data-tip="Sort and group" data-folder-arrange onClick={(e) => menuBelow(e, arrangeItems())} className={cn(tool, grouped && "text-primary hover:text-primary")}>
        <ArrowUpDown className="size-[15px]" strokeWidth={2} />
      </button>
      <button type="button" aria-label="More" data-tip="More" data-folder-more onClick={(e) => menuBelow(e, pageMenu(path))} className={tool}>
        <Ellipsis className="size-4" strokeWidth={2} />
      </button>
    </div>
  )
}

// ---------- headings (Group by) ----------

type Section = { title: string; items: FolderItem[] }
const KIND_HEADS: Record<FileKind, string> = {
  markdown: "Notes", image: "Images", video: "Videos", audio: "Audio", pdf: "PDFs", code: "Code", json: "Code", notebook: "Code", binary: "Other", other: "Other",
}
const KIND_ORDER = ["Folders", "Notes", "Images", "Videos", "Audio", "PDFs", "Web pages", "Code", "Other"]
const kindHead = (path: string) => (/\.html?$/i.test(path) ? "Web pages" : KIND_HEADS[kindOf(path)])
const DAY = 86400_000
/** A file's heading by when it changed, Finder's way, and its place (newest first). */
function dateHead(ms: number, today: number, year: number): [number, string] {
  const d = new Date(ms), days = Math.floor((today - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / DAY)
  if (days <= 0) return [0, "Today"]
  if (days === 1) return [1, "Yesterday"]
  if (days < 7) return [2, "Previous 7 days"]
  if (days < 30) return [3, "Previous 30 days"]
  if (d.getFullYear() === year) return [100 - d.getMonth(), dateText(d, { month: "long" })]
  return [1000 + year - d.getFullYear(), String(d.getFullYear())]
}
/** Its things under headings, in the sort's order within each (folders first, under their own); null: no headings. */
function sectionsOf(items: FolderItem[], by: FolderGroup): Section[] | null {
  if (by === "none") return null
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const out = new Map<string, { at: number; items: FolderItem[] }>()
  for (const n of items) {
    const [at, title] = n.folder ? [-1, "Folders"] : by === "kind" ? [KIND_ORDER.indexOf(kindHead(n.path)), kindHead(n.path)] : dateHead(n.mtime, today, now.getFullYear())
    const s = out.get(title) ?? out.set(title, { at, items: [] }).get(title)!
    s.items.push(n)
  }
  return [...out].sort((a, b) => a[1].at - b[1].at).map(([title, s]) => ({ title, items: s.items }))
}

function Heading({ title, count, index, k, first }: { title: string; count: number; index: number; k: string; first: boolean }) {
  return (
    <div data-vi={index} data-vk={k} data-folder-heading={title} className={cn("flex items-baseline gap-1.5 px-1.5 pb-1.5 text-[12px] font-semibold text-muted-foreground", first ? "pt-0" : "pt-4")}>
      {title}<span className="font-normal text-tertiary tabular-nums">{count}</span>
    </div>
  )
}

// ---------- the page ----------

/** A folder's page: its header, then what it holds in its view, or a calm line when it's empty or gone. */
export function FolderPage({ store, path }: { store: Store; path: string }) {
  const { fileSort, showArchived, folderView, folderGroup } = usePrefs()
  const desk = useDesktop()
  const view = shownView(folderView, desk)
  const got = useMemo(() => folderItems(store.files, path, fileSort, showArchived), [store.files, path, fileSort, showArchived])
  // Files open beside it: in the pane of the file focused last when that's another pane (as the Files tab opens them).
  const { pane: own } = usePane()
  const focused = useFocusedFile()
  const pane = focused.pane && focused.pane !== own ? focused.pane : undefined
  const enter = useEnter()
  const renaming = naming.use((r) => r?.path ?? null)
  const root = useRef<HTMLDivElement>(null)

  /** Open it: a folder in this tab, a file beside (⌘ or the middle button: in a new tab). */
  const openIt = (n: FolderItem, newTab = false) => {
    if (n.folder) enter(n.path, 1, newTab)
    else openFile(n.path, { newTab, pane })
  }
  const open = (n: FolderItem, e: MouseEvent) => {
    if (selectClick(e, SELECT, n.path)) return
    openIt(n, e.metaKey || e.ctrlKey || e.button === 1)
  }
  const menuOf = (n: FolderItem) => rowMenu(SELECT, n.path, (): MenuItem[] => {
    if (inTrash(n.path)) return filesMenu([n.path])
    const rename = () => naming.set({ path: n.path, fresh: false })
    if (n.folder) return folderMenu(n.path, { pane, rename, newFolder: () => void newFolderIn(n.path) })
    return fileMenu(n.path, { rename, top: [[openItem(() => openFile(n.path, { newTab: true, pane }), desk ? () => openInSplit(`file:${n.path}`, "right") : undefined)]] })
  })
  useSelectable(SELECT, { menu: (keys) => filesMenu(keys, { newTab: (p) => openFile(p, { newTab: true, pane }) }), noun: ["item", "items"] })
  // Phones: a row swiped sideways shows Move and Delete (in the trash, Restore and Delete for good), as the tree's do.
  const swipe = (n: FolderItem): SwipeAction[] => {
    if (fixed(n.path) && !inTrash(n.path)) return []
    if (inTrash(n.path)) return [{ label: "Restore", icon: RotateCcw, run: () => void restoreFile(n.path).catch((e) => notifyError(e, "Couldn't restore")), removes: true }, { label: "Delete", icon: Trash2, run: () => remove(n.path), danger: true }]
    return [{ label: "Move", icon: n.folder ? FolderInput : FileInput, run: () => askMove(n.path) }, { label: "Delete", icon: Trash2, run: () => remove(n.path), danger: true, removes: true }]
  }
  // Held, a row is dragged (a finger holds it first): onto a pane or a tab bar it opens there, onto a folder it moves in.
  const press = (e: PointerEvent<HTMLElement>, n: FolderItem) => {
    if (renaming === n.path || fixed(n.path)) return
    if (!n.folder) openingSoon(n.path, true)
    const keys = selectionFor(SELECT, n.path, false)?.filter((p) => !fixed(p))
    const item: DragItem = keys && keys.length > 1 ? { from: "tree", path: n.path, paths: keys, folder: n.folder || undefined, to: n.folder ? undefined : `file:${n.path}`, label: `${keys.length} items` }
      : { from: "tree", path: n.path, folder: n.folder || undefined, to: n.folder ? folderTarget(n.path) : `file:${n.path}` }
    startDrag(e, item, { touch: true })
  }

  // Dropped on one of its folders (`data-folder-drop`, which panes leave to it: `data-drops`), what's dragged moves in.
  const target = `folder:${useId()}`
  const dropOn = useDropHit<string>(target)
  const [edge] = useState(() => edgeScroller())
  useDropTarget<string>(target, (item, x, y, el) => {
    const box = root.current
    if (!box || !el || !box.contains(el) || item.from !== "tree" || !item.path) { edge.stop(); return null }
    edge.over(box, x, y)
    const into = el.closest<HTMLElement>("[data-folder-drop]")?.dataset.folderDrop
    const all = item.paths ?? [item.path]
    return into !== undefined && all.some((p) => canMoveInto(p, into)) && all.every((p) => into !== p && !into.startsWith(`${p}/`)) ? into : null
  }, (item, folder) => void moveManyInto(item.paths ?? [item.path!], folder, { reveal: false }), { end: edge.stop })
  // Files from the computer: copied into the folder under the pointer, or this one (⌥, ⇧ off a Mac: moved).
  const [fromComputer, setFromComputer] = useState<string | null>(null)
  const at = (t: EventTarget | null) => (t as Element | null)?.closest?.<HTMLElement>("[data-folder-drop]")?.dataset.folderDrop ?? path
  const moving = (e: DragEvent) => !!desktop && (isMac ? e.altKey : e.shiftKey)
  const computer = {
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer) || fixed(at(e.target))) return
      e.preventDefault()
      e.dataTransfer.dropEffect = moving(e) ? "move" : "copy"
      setFromComputer(at(e.target))
    },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFromComputer(null) },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return
      e.preventDefault()
      setFromComputer(null)
      const into = at(e.target)
      if (!fixed(into)) void dropInto(e.dataTransfer, into, moving(e)).then(() => reload(), (err) => notifyError(err, "Couldn't add the files"))
    },
  }
  const lit = dropOn ?? (fromComputer !== null && fromComputer !== path ? fromComputer : null)

  if (!got) return <p data-folder-gone className="mt-2 text-[15px] text-muted-foreground">This folder isn't in the vault any more.</p>
  const { items, counts } = got
  const kids: Kids = { items, counts, open, menuOf, swipe, press, renaming, lit, desk }
  const sections = view === "list" || view === "grid" ? sectionsOf(items, groupOf(folderGroup)) : null
  const body = view === "columns" ? <Columns {...kids} files={store.files} folder={path} openIt={openIt} />
    : !items.length ? <Empty path={path} desk={desk} />
    : view === "gallery" ? <Gallery {...kids} folder={path} openIt={openIt} />
    : view === "grid" ? <Grid {...kids} sections={sections} folder={path} /> : <Rows {...kids} sections={sections} />
  return (
    <div ref={root} data-folder-page={path} data-folder-shown={view} data-file-drop {...computer}
      onContextMenu={(e) => { if (!(e.target as Element).closest("[data-folder-item]")) menuFor(() => spaceMenu(path))(e) }}
      className={cn("min-h-[60vh] rounded-[10px] transition-colors", fromComputer === path && "bg-primary/[0.06]")}>
      {desk ? <PageHeader title={folderName(path)} className={view === "columns" || view === "gallery" ? "mb-3" : undefined}><Toolbar path={path} view={view} /></PageHeader>
        : <PhoneHead path={path} view={view} />}
      {body}
    </div>
  )
}

/** Phones: under the title (the page's header draws it), the folders above as crumbs, the other view, and New note, as
 *  Files has. */
function PhoneHead({ path, view }: { path: string; view: FolderView }) {
  const enter = useEnter()
  const parts = path ? path.split("/").slice(0, -1) : []
  const above = path ? [{ at: "", name: folderName("") }, ...parts.map((name, i) => ({ at: parts.slice(0, i + 1).join("/"), name }))] : []
  const next = VIEWS.find((o) => o.value === (view === "grid" ? "list" : "grid"))!
  return (
    <div data-folder-head className="-mt-2 mb-3 flex items-end justify-between gap-3">
      <p className="min-w-0 pb-2 text-[15px] text-muted-foreground">
        {above.map((c, i) => (
          <Fragment key={c.at}>
            {i > 0 && <span aria-hidden className="px-1 text-tertiary">/</span>}
            <button type="button" onClick={() => enter(c.at, -1)} className="cursor-pointer text-primary active:opacity-60">{c.name}</button>
          </Fragment>
        ))}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" aria-label={`Show as ${next.label.toLowerCase()}`} data-folder-view={next.value} onClick={() => setView(next.value)}
          className="relative mb-1 grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-muted text-primary after:absolute after:-inset-1 active:opacity-60">
          <next.icon className="size-[18px]" strokeWidth={2.25} />
        </button>
        <button type="button" onClick={() => void newNote(path)} aria-label="New note"
          className="mb-1 flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-muted px-3.5 text-[15px] font-medium text-primary active:opacity-60">
          <FilePlus className="size-[18px]" strokeWidth={2.25} />New note
        </button>
      </div>
    </div>
  )
}

function Empty({ path, desk }: { path: string; desk: boolean }) {
  return (
    <div data-folder-empty className="flex flex-col items-center gap-2 py-20 text-center">
      <FolderOpen className="size-10 text-tertiary" strokeWidth={1.5} />
      <p className="text-[15px] text-muted-foreground">This folder is empty</p>
      {desk && <button type="button" onClick={() => void newNote(path)} className="cursor-pointer rounded-[6px] px-2 py-1 text-[13px] font-medium text-primary hover:bg-primary/10">New note</button>}
    </div>
  )
}

/** A heading's key among the rows' (paths can't hold a NUL). */
const headKey = (title: string) => `\0${title}`

// ---------- as a list: the sidebar's rows, a size up ----------

type Line = { head: Section } | { n: FolderItem }
function Rows({ items, counts, open, menuOf, swipe, press, renaming, lit, desk, sections }: Kids & { sections: Section[] | null }) {
  const list = useRef<HTMLDivElement>(null)
  const lines = useMemo<Line[]>(() => (sections ? sections.flatMap((s) => [{ head: s }, ...s.items.map((n) => ({ n }))]) : items.map((n) => ({ n }))), [items, sections])
  const keys = useMemo(() => lines.map((l) => ("head" in l ? headKey(l.head.title) : l.n.path)), [lines])
  const all = useMemo(() => lines.flatMap((l) => ("n" in l ? [l.n.path] : [])), [lines])
  const { keep, onFocus } = useKept(list, keys, all)
  const v = useVirtual(list, keys, { estimate: desk ? 33 : 41, keep: [...keep, renaming] })
  return (
    <div ref={list} data-keylist data-select-list={SELECT} data-folder-list onFocus={onFocus} className="size-up-bleed">
      {drawnRows(v, (i) => {
        const l = lines[i]
        if ("head" in l) return <Heading key={keys[i]} k={keys[i]} index={i} title={l.head.title} count={l.head.items.length} first={i === 0} />
        return <Row key={l.n.path} n={l.n} index={i} meta={metaOf(l.n, counts)} open={open} menuOf={menuOf} swipe={swipe} press={press} renaming={renaming === l.n.path} lit={lit === l.n.path} />
      })}
    </div>
  )
}

function Row({ n, index, meta, open, menuOf, swipe, press, renaming, lit }: { n: FolderItem; index: number; meta: string; renaming: boolean; lit: boolean }
  & Pick<Kids, "open" | "menuOf" | "swipe" | "press">) {
  const picked = useSelected(SELECT, n.path)
  const { fileIcons } = usePrefs()
  const { icon: Icon, tint } = iconFor(n)
  const archived = !!n.file?.archived || inArchive(n.path)
  return (
    <div data-vi={index} data-vk={n.path} data-size-up data-folder-item={n.path} data-folder-drop={n.folder ? n.path : undefined} data-drops={n.folder ? "" : undefined}
      onPointerDown={(e) => press(e, n)} onPointerEnter={n.folder ? undefined : () => openingSoon(n.path)} onPointerLeave={n.folder ? undefined : () => openingSoon(null)}
      className={cn("pb-px", archived && "opacity-50")}>
      {renaming ? (
        <div className={cn(ROW, "bg-foreground/[0.06]")}>
          {fileIcons && <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />}
          <NameField n={n} className="h-6 flex-1" />
        </div>
      ) : (
        <SidebarRow icon={fileIcons ? Icon : undefined} tint={tint} label={n.name} open href={hrefOf(n)} more swipe={() => swipe(n)}
          data-select-key={n.path} {...selectedAttr(picked)} className={cn("active:bg-foreground/[0.06]", lit && "bg-primary/10")}
          onClick={(e) => open(n, e)} onContextMenu={menuFor(menuOf(n))}>
          {meta && <span className="mr-1 shrink-0 text-[11px] text-tertiary tabular-nums group-hover/row:hidden">{meta}</span>}
        </SidebarRow>
      )}
    </div>
  )
}

// ---------- as a grid: cards with what's in them ----------

/** A card's narrowest (px) and the room between cards, on a computer and a phone (three across, as the Files app). */
const CARD = { desk: { min: 136, gap: 12 }, phone: { min: 96, gap: 10 } }

type Band = { head: Section } | { cards: FolderItem[] }
function Grid({ items, counts, open, menuOf, press, renaming, lit, desk, folder, sections }: Kids & { folder: string; sections: Section[] | null }) {
  const list = useRef<HTMLDivElement>(null)
  const size = desk ? CARD.desk : CARD.phone
  const [cols, setCols] = useState(desk ? 5 : 3)
  useEffect(() => {
    const el = list.current
    if (!el) return
    const fit = () => { const w = el.clientWidth; if (w) setCols(Math.max(2, Math.floor((w + size.gap) / (size.min + size.gap)))) }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [size.gap, size.min])
  const bands = useMemo<Band[]>(() => {
    const rowsOf = (xs: FolderItem[]) => Array.from({ length: Math.ceil(xs.length / cols) }, (_, r) => ({ cards: xs.slice(r * cols, r * cols + cols) }))
    return sections ? sections.flatMap((s) => [{ head: s }, ...rowsOf(s.items)]) : rowsOf(items)
  }, [items, sections, cols])
  const keys = useMemo(() => bands.map((b) => ("head" in b ? headKey(b.head.title) : `${cols}\0${b.cards[0].path}`)), [bands, cols])
  const all = useMemo(() => bands.flatMap((b) => ("cards" in b ? b.cards.map((n) => n.path) : [])), [bands])
  const { keep, onFocus } = useKept(list, keys, all)
  const at = renaming ? bands.findIndex((b) => "cards" in b && b.cards.some((n) => n.path === renaming)) : -1
  const v = useVirtual(list, keys, { estimate: desk ? 196 : 150, keep: [...keep, at < 0 ? null : keys[at]] })
  const text = usePreviews(folder, items)
  return (
    <div ref={list} data-keylist data-select-list={SELECT} data-folder-grid onFocus={onFocus}>
      {drawnRows(v, (r) => {
        const b = bands[r]
        if ("head" in b) return <Heading key={keys[r]} k={keys[r]} index={r} title={b.head.title} count={b.head.items.length} first={r === 0} />
        return (
          <div key={keys[r]} data-vi={r} data-vk={keys[r]} className="grid pb-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, columnGap: size.gap }}>
            {b.cards.map((n) => <Card key={n.path} n={n} meta={metaOf(n, counts)} text={text[n.path]} open={open} menuOf={menuOf} press={press} renaming={renaming === n.path} lit={lit === n.path} desk={desk} />)}
          </div>
        )
      })}
    </div>
  )
}

function Card({ n, meta, text, open, menuOf, press, renaming, lit, desk }: { n: FolderItem; meta: string; text?: string; renaming: boolean; lit: boolean; desk: boolean }
  & Pick<Kids, "open" | "menuOf" | "press">) {
  const picked = useSelected(SELECT, n.path)
  const archived = !!n.file?.archived || inArchive(n.path)
  // (an <a> holds no field: while it's named, the card is a box)
  const Box = renaming ? "div" : "a"
  return (
    <Box href={renaming ? undefined : hrefOf(n)} data-keyrow data-select-key={n.path} {...selectedAttr(picked)} data-folder-item={n.path} data-tip={n.name} data-tip-trunc
      data-folder-drop={n.folder ? n.path : undefined} data-drops={n.folder ? "" : undefined} draggable={false}
      onPointerDown={(e) => press(e, n)} onPointerEnter={n.folder ? undefined : () => openingSoon(n.path)} onPointerLeave={n.folder ? undefined : () => openingSoon(null)}
      onClick={(e) => { e.preventDefault(); open(n, e) }} onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); open(n, e) } }} onContextMenu={menuFor(menuOf(n))}
      className={cn("group flex min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-[10px] p-1.5 text-center transition-colors select-none",
        desk ? "hover:bg-foreground/[0.04]" : "active:bg-foreground/[0.06]", lit && "bg-primary/10", archived && "opacity-50")}>
      <Tile n={n} text={text} desk={desk} />
      {renaming ? <NameField n={n} className={cn("h-6 w-full text-center", desk ? "text-[13px]" : "text-[14px]")} />
        : <span className={cn("line-clamp-2 w-full break-words", desk ? "text-[13px] leading-[17px]" : "text-[14px] leading-[18px]")}>{n.name}</span>}
      {meta && <span className={cn("-mt-1 truncate text-tertiary tabular-nums", desk ? "text-[11px]" : "text-[12px]")}>{meta}</span>}
    </Box>
  )
}
