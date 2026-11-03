// A folder's page (view:folder/<path>, the Files plugin's): what it holds as a list or a grid (files.json `folderView`,
// one for every folder), as Finder shows a folder and a phone's Files app. Its folders open in its tab, its files beside.
import { Fragment, useEffect, useId, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react"
import { ArrowUpNarrowWide, Ellipsis, FileInput, FilePlus, FolderInput, FolderOpen, FolderPlus, LayoutGrid, List, RotateCcw, Trash2 } from "lucide-react"
import { dateText, fmtDay, getStore, iso, reload, useStore, vaultName, type Store } from "@/core/data"
import { cleanName, createFolder, folderOf, folderTarget, freeName, inArchive, inTrash, joinPath, moveFile, nameable, openFile, openingSoon, restoreFile, stem } from "@/core/files"
import { edgeScroller, startDrag, useDropHit, useDropTarget, type DragItem } from "@/core/drag"
import { desktop, dropInto, hasFiles } from "@/core/desktop"
import { get } from "@/core/http"
import { kindOf } from "@/core/filekinds"
import { snippet } from "@/core/plaintext"
import { step } from "@/core/motion"
import { notifyError } from "@/core/notify"
import { usePane } from "@/core/pane"
import { isMac, useDesktop } from "@/core/platform"
import { getPrefs, setPrefs, usePrefs, type FolderView } from "@/core/prefs"
import { listOrders, rowMenu, selectClick, selectedAttr, selectionFor, useSelectable, useSelected } from "@/core/select"
import { cell } from "@/core/signal"
import { openInSplit } from "@/core/splits"
import { useVirtual } from "@/core/virtual"
import { focusGroup, go, useFocusedFile } from "@/core/workspace"
import { menuBelow, menuFor, type MenuItem } from "@/components/ContextMenu"
import { fileMenu, filesMenu, folderMenu, grouped, openItem, remove } from "@/components/FileActions"
import { rawUrl } from "@/components/FileViewers"
import { askMove, canMoveInto, fixed, folderIcon, folderItems, iconAt, moveManyInto, newNote, SORTS, treeShownItems, type FolderItem } from "@/components/FileTree"
import { ROW, SidebarRow } from "@/components/Sidebar"
import type { SwipeAction } from "@/components/SwipeRow"
import { barButton } from "@/components/ViewBar"
import { PageHeader } from "@/components/kit"
import { cn, plural } from "@/lib/utils"

/** The page's selection (core/select.ts), by path. */
const SELECT = "folder"
/** What's being named in place, in whichever folder page shows it (`fresh`: a folder just made, no Undo for it). */
const naming = cell<{ path: string; fresh: boolean } | null>(null)

/** A folder's name as its tab says it; the vault's own for its top. */
export const folderName = (path: string) => (path ? path.slice(path.lastIndexOf("/") + 1) : vaultName(getStore()))

const VIEWS: { value: FolderView; label: string; icon: typeof List }[] = [{ value: "list", label: "List", icon: List }, { value: "grid", label: "Grid", icon: LayoutGrid }]
const viewOf = (v: unknown): FolderView => (v === "grid" ? "grid" : "list")
const setView = (v: FolderView) => void setPrefs({ folderView: v })

/** Show as ▸ List, Grid (every folder's page the same) and Sort by ▸ (the file tree's order): its tab's menu. */
export function folderTabMenu(): MenuItem[] {
  const v = viewOf(getPrefs().folderView)
  return [
    { label: "Show as", icon: v === "grid" ? LayoutGrid : List, run: () => {}, items: VIEWS.map((o) => ({ label: o.label, icon: o.icon, checked: v === o.value, run: () => setView(o.value) })) },
    { label: "Sort by", icon: ArrowUpNarrowWide, run: () => {}, items: sortItems() },
  ]
}
function sortItems(): MenuItem[] {
  const { fileSort } = getPrefs()
  return SORTS.flatMap((g, k) => g.map((o, i) => ({ label: o.label, checked: fileSort === o.value, sep: k > 0 && i === 0, run: () => void setPrefs({ fileSort: o.value }) })))
}

/** A folder made here, its name ready to type. */
async function newFolderIn(folder: string) {
  const s = getStore()
  if (!s) return
  try { naming.set({ path: await createFolder(folder, freeName(s.files, folder, "New folder", "")), fresh: true }) } catch (e) { notifyError(e, "Couldn't make the folder") }
}

/** The page's own menu (its bar's …, its empty space): a note or folder in it, the folder's menu, what the files show. */
function pageMenu(path: string): MenuItem[] {
  const shown = treeShownItems({ reveal: false })
  if (!path) return grouped([[{ label: "New note", icon: FilePlus, run: () => void newNote("") }, { label: "New folder", icon: FolderPlus, run: () => void newFolderIn("") }], shown])
  return grouped([folderMenu(path, { open: false, newFolder: () => void newFolderIn(path) }), shown])
}

/** Go to another folder in this tab: a step in its history (on a phone the page moves as Back or Forward, `dir`). */
function useEnter() {
  const { group } = usePane()
  const desk = useDesktop()
  return (folder: string, dir: -1 | 1, newTab = false) => {
    const change = () => { if (group) focusGroup(group); go(folderTarget(folder), newTab) }
    if (desk || newTab) change(); else step(dir, change)
  }
}

/** The desktop bar's crumbs (the vault, then each folder down to this one) and its buttons: Show as, Sort, More. */
export const folderBar = (path: string) => ({ title: <Crumbs path={path} />, right: <BarButtons path={path} /> })

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

function BarButtons({ path }: { path: string }) {
  const view = viewOf(usePrefs().folderView)
  return (
    <div className="flex shrink-0 items-center gap-1">
      <div role="radiogroup" aria-label="Show as" className="flex rounded-[6px] bg-foreground/[0.05] p-px">
        {VIEWS.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={view === o.value} aria-label={o.label} data-tip={o.label} data-folder-view={o.value} onClick={() => setView(o.value)}
            className={cn("grid h-6 w-7 cursor-pointer place-items-center rounded-[5px] transition-colors",
              view === o.value ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.12)] dark:bg-[var(--segment-on)]" : "text-muted-foreground hover:text-foreground")}>
            <o.icon className="size-[15px]" strokeWidth={2} />
          </button>
        ))}
      </div>
      <button type="button" aria-label="Sort by" data-tip="Sort by" onClick={(e) => menuBelow(e, sortItems())} className={barButton}><ArrowUpNarrowWide className="size-4" strokeWidth={2} /></button>
      <button type="button" aria-label="More" data-tip="More" onClick={(e) => menuBelow(e, pageMenu(path))} className={barButton}><Ellipsis className="size-4" strokeWidth={2} /></button>
    </div>
  )
}

// ---------- the page ----------

const TIME = { hour: "numeric", minute: "2-digit" } as const
/** When a file changed, Finder's way: a time today, else its day. */
function whenText(ms: number) {
  if (!ms) return ""
  const d = new Date(ms)
  return iso(d) === iso(new Date()) ? dateText(d, TIME) : fmtDay(iso(d))
}
const metaOf = (n: FolderItem, counts: Map<string, number>) => (n.folder ? (counts.get(n.path) ? plural(counts.get(n.path)!, "item") : "Empty") : whenText(n.mtime))

/** A row's or card's name typed in place, back to the name on Escape. */
function NameField({ n, className }: { n: FolderItem; className?: string }) {
  const done = useRef(false)
  const finish = (typed: string | null) => {
    if (done.current) return
    done.current = true
    const was = naming.get()
    naming.set(null)
    if (typed !== null) void renameTo(n, typed, !!was?.fresh && was.path === n.path)
  }
  return (
    <input autoFocus defaultValue={n.name} aria-label="New name" spellCheck={false} onFocus={(e) => e.target.select()}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") finish(null) }}
      className={cn("min-w-0 rounded-[4px] bg-card px-1 outline-none ring-1 ring-primary/60", className)} />
  )
}
async function renameTo(n: FolderItem, typed: string, fresh: boolean) {
  if (!nameable(typed)) return
  const name = cleanName(typed)
  if (!name || name === n.name) return
  const ext = n.folder || n.other ? "" : n.path.slice(n.path.lastIndexOf("."))
  try { await moveFile(n.path, joinPath(folderOf(n.path), name + ext), { undo: !fresh }) } catch (e) { notifyError(e, "Couldn't rename") }
}

/** A folder's page: its header, then what it holds as a list or a grid, or a calm line when it's empty or gone. */
export function FolderPage({ store, path }: { store: Store; path: string }) {
  const { fileSort, showArchived, folderView } = usePrefs()
  const view = viewOf(folderView)
  const desk = useDesktop()
  const got = useMemo(() => folderItems(store.files, path, fileSort, showArchived), [store.files, path, fileSort, showArchived])
  // Files open beside it: in the pane of the file focused last when that's another pane (as the Files tab opens them).
  const { group } = usePane()
  const focused = useFocusedFile()
  const pane = focused.group && focused.group !== group ? focused.group : undefined
  const enter = useEnter()
  const renaming = naming.use((r) => r?.path ?? null)
  const root = useRef<HTMLDivElement>(null)

  const open = (n: FolderItem, e: MouseEvent) => {
    if (selectClick(e, SELECT, n.path)) return
    const newTab = e.metaKey || e.ctrlKey || e.button === 1
    if (n.folder) enter(n.path, 1, newTab)
    else openFile(n.path, { newTab, pane })
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
  const count = items.length ? plural(items.length, "item") : ""
  const kids: Kids = { items, counts, open, menuOf, swipe, press, renaming, lit, desk }
  return (
    <div ref={root} data-folder-page={path} data-file-drop {...computer}
      onContextMenu={(e) => { if (!(e.target as Element).closest("[data-folder-item]")) menuFor(() => pageMenu(path))(e) }}
      className={cn("min-h-[60vh] rounded-[10px] transition-colors", fromComputer === path && "bg-primary/[0.06]")}>
      {desk ? <PageHeader title={folderName(path)} subtitle={count} /> : <PhoneHead path={path} count={count} />}
      {!items.length ? <Empty path={path} desk={desk} />
        : view === "grid" ? <Grid {...kids} folder={path} /> : <Rows {...kids} />}
    </div>
  )
}

type Kids = {
  items: FolderItem[]; counts: Map<string, number>; open: (n: FolderItem, e: MouseEvent) => void; menuOf: (n: FolderItem) => () => MenuItem[]
  swipe: (n: FolderItem) => SwipeAction[]; press: (e: PointerEvent<HTMLElement>, n: FolderItem) => void; renaming: string | null; lit: string | null; desk: boolean
}

/** Phones: under the title (the page's header draws it), the folders above as crumbs, and New note, as Files has. */
function PhoneHead({ path, count }: { path: string; count: string }) {
  const enter = useEnter()
  const parts = path ? path.split("/").slice(0, -1) : []
  const above = path ? [{ at: "", name: folderName("") }, ...parts.map((name, i) => ({ at: parts.slice(0, i + 1).join("/"), name }))] : []
  return (
    <div data-folder-head className="-mt-2 mb-3 flex items-end justify-between gap-3">
      <p className="min-w-0 pb-2 text-[15px] text-muted-foreground">
        {above.map((c, i) => (
          <Fragment key={c.at}>
            {i > 0 && <span aria-hidden className="px-1 text-tertiary">/</span>}
            <button type="button" onClick={() => enter(c.at, -1)} className="cursor-pointer text-primary active:opacity-60">{c.name}</button>
          </Fragment>
        ))}
        {above.length && count ? <span className="whitespace-nowrap"> · {count}</span> : count}
      </p>
      <button type="button" onClick={() => void newNote(path)} aria-label="New note"
        className="mb-1 flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-muted px-3.5 text-[15px] font-medium text-primary active:opacity-60">
        <FilePlus className="size-[18px]" strokeWidth={2.25} />New note
      </button>
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

/** A file's or folder's icon, as the tree draws it. */
const iconFor = (n: FolderItem) => (n.folder ? folderIcon(n.path) : iconAt(n.path))
const hrefOf = (n: FolderItem) => (n.folder ? `#view/${encodeURIComponent(folderTarget(n.path).slice(5))}` : `#file/${encodeURIComponent(n.path)}`)

/** The rows the keyboard needs drawn wherever they're scrolled to: the one it's on and those beside it, the first and
 *  last. Its whole order is the selection's (core/select.ts). */
function useKept(list: React.RefObject<HTMLDivElement | null>, keys: string[], all: string[]) {
  const [focusKey, setFocusKey] = useState<string | null>(null)
  useEffect(() => {
    const el = list.current
    if (!el) return
    listOrders.set(el, () => all)
    return () => { listOrders.delete(el) }
  }, [list, all])
  const i = focusKey === null ? -1 : keys.indexOf(focusKey)
  const keep = [keys[0], keys[keys.length - 1], ...(i < 0 ? [] : [keys[i - 1], keys[i], keys[i + 1]])]
  const onFocus = (e: React.FocusEvent) => setFocusKey((e.target as Element).closest<HTMLElement>("[data-vk]")?.dataset.vk ?? null)
  return { keep, onFocus }
}

/** Spaces for the rows not drawn (core/virtual.ts), around those that are. */
function drawnRows(v: ReturnType<typeof useVirtual>, row: (i: number) => ReactNode) {
  const out: ReactNode[] = []
  for (const { index, gap } of v.slots) {
    if (gap > 0.5) out.push(<div key={`gap:${index}`} aria-hidden style={{ height: gap }} />)
    out.push(row(index))
  }
  if (v.rest > 0.5) out.push(<div key="rest" aria-hidden style={{ height: v.rest }} />)
  return out
}

// ---------- as a list: the sidebar's rows, a size up ----------

function Rows({ items, counts, open, menuOf, swipe, press, renaming, lit, desk }: Kids) {
  const list = useRef<HTMLDivElement>(null)
  const keys = useMemo(() => items.map((n) => n.path), [items])
  const { keep, onFocus } = useKept(list, keys, keys)
  const v = useVirtual(list, keys, { estimate: desk ? 33 : 41, keep: [...keep, renaming] })
  return (
    <div ref={list} data-keylist data-select-list={SELECT} data-folder-list onFocus={onFocus} className="size-up-bleed">
      {drawnRows(v, (i) => {
        const n = items[i]
        return <Row key={n.path} n={n} index={i} meta={metaOf(n, counts)} open={open} menuOf={menuOf} swipe={swipe} press={press} renaming={renaming === n.path} lit={lit === n.path} />
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

/** A note's text without a first heading that is its name: the card's name says it. */
const untitled = (md: string, path: string) => md.replace(/^#{1,6}[ \t]+([^\n]*)\n*/, (all, h: string) => (snippet(h) === stem(path) ? "" : all))
/** The start of each note in the folder (its text, never its Markdown), read once per change of its notes. */
const previews = new Map<string, { sig: string; text: Record<string, string> }>()
function usePreviews(folder: string, items: FolderItem[]) {
  const sig = items.filter((n) => n.file).map((n) => `${n.path}\0${n.mtime}`).join("\n")
  const [text, setText] = useState<Record<string, string>>(() => previews.get(folder)?.text ?? {})
  useEffect(() => {
    const had = previews.get(folder)
    if (had?.sig === sig || !sig) { setText(had?.text ?? {}); return }
    let on = true
    get<{ previews: Record<string, string> }>(`files/previews?folder=${encodeURIComponent(folder)}`).then((r) => {
      const t = Object.fromEntries(Object.entries(r.previews).map(([p, md]) => [p, snippet(untitled(md, p))]))
      previews.delete(folder)
      previews.set(folder, { sig, text: t })
      if (previews.size > 30) previews.delete(previews.keys().next().value!)
      if (on) setText(t)
    }, () => {})
    return () => { on = false }
  }, [folder, sig])
  return text
}

function Grid({ items, counts, open, menuOf, press, renaming, lit, desk, folder }: Kids & { folder: string }) {
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
  const rows = useMemo(() => Array.from({ length: Math.ceil(items.length / cols) }, (_, r) => items.slice(r * cols, r * cols + cols)), [items, cols])
  const keys = useMemo(() => rows.map((r) => `${cols}\0${r[0].path}`), [rows, cols])
  const all = useMemo(() => items.map((n) => n.path), [items])
  const { keep, onFocus } = useKept(list, keys, all)
  const at = renaming ? rows.findIndex((r) => r.some((n) => n.path === renaming)) : -1
  const v = useVirtual(list, keys, { estimate: desk ? 196 : 150, keep: [...keep, at < 0 ? null : keys[at]] })
  const text = usePreviews(folder, items)
  return (
    <div ref={list} data-keylist data-select-list={SELECT} data-folder-grid onFocus={onFocus}>
      {drawnRows(v, (r) => (
        <div key={keys[r]} data-vi={r} data-vk={keys[r]} className="grid pb-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, columnGap: size.gap }}>
          {rows[r].map((n) => <Card key={n.path} n={n} meta={metaOf(n, counts)} text={text[n.path]} open={open} menuOf={menuOf} press={press} renaming={renaming === n.path} lit={lit === n.path} desk={desk} />)}
        </div>
      ))}
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

/** What a card shows of what it is: a folder's icon, an image's picture, a note's first lines, else its kind's icon. */
function Tile({ n, text, desk }: { n: FolderItem; text?: string; desk: boolean }) {
  const { icon: Icon, tint } = iconFor(n)
  const [broken, setBroken] = useState(false)
  const box = "relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-[8px]"
  const paper = "bg-card shadow-[0_1px_3px_rgb(0_0_0/0.08)] ring-[0.5px] ring-border"
  if (n.folder) return <div className={box}><Icon className="size-[70%] fill-primary/15 text-primary" strokeWidth={1} style={tint ? { color: tint } : undefined} /></div>
  if (kindOf(n.path) === "image" && !broken) {
    return <div className={cn(box, paper)}><img src={rawUrl(n.path)} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} className="size-full object-cover" /></div>
  }
  if (text) {
    return (
      <div className={cn(box, paper, "place-items-stretch")}>
        <p className={cn("overflow-hidden text-left text-muted-foreground [mask-image:linear-gradient(to_bottom,black_70%,transparent)]", desk ? "p-2.5 text-[10px] leading-[14px]" : "p-2 text-[8px] leading-[11px]")}>{text}</p>
      </div>
    )
  }
  return <div className={cn(box, paper)}><Icon className={cn("size-[34%]", !tint && "text-muted-foreground")} strokeWidth={1.5} style={tint ? { color: tint } : undefined} /></div>
}
