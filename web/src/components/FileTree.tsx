// The vault's files, the file explorer: menus shared with tabs (FileActions.ts), drag to move (core/drag.ts;
// the sort decides order, so no "between" places), files dropped in from the computer copied in. Phones swipe rows.
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent } from "react"
import {
  Archive,
  ArrowUpNarrowWide, Bot, ChevronRight, ChevronsDownUp, ChevronsUpDown, Ellipsis, FileBraces, FileInput, FilePlus, FileText, Folder,
  FolderInput, FolderOpen, FolderPlus, GalleryVertical, RotateCcw, SquareArrowOutUpRight, SquarePen, Trash2, type LucideIcon,
} from "lucide-react"
import { getStore, reload, type Store } from "@/core/data"
import { edgeScroller, getDrag, startDrag, useDrag, useDropHit, useDropTarget, type DragItem } from "@/core/drag"
import { desktop, dropInto, hasFiles } from "@/core/desktop"
import { isMac } from "@/core/platform"
import { cleanName, createFile, createFolder, folderList, folderOf, freeName, inArchive, inTrash, isDoc, isHidden, isJson, isProtected, joinPath, moveFile, openFile, openingSoon, openNew, openView, restoreFile, shownName, stem, type VaultFile } from "@/core/files"
import { currentFile, getWorkspace, isDesktop, onWorkspaceChange } from "@/core/workspace"
import { leaves, type Workspace } from "@/core/layout"
import { openInSplit } from "@/core/splits"
import { iconOf, namedIcon, tintOf } from "@/core/pages"
import { scopedState, subscribeScoped } from "@/core/scope"
import { notify, notifyError } from "@/core/notify"
import { newNoteFolder } from "@/core/conventions"
import { ARCHIVE_DIR } from "../../../core/fileprops.ts"
import { kindIcon } from "@/core/filekinds"
import type { FileIcon, FileMark, FileRow, FileRowPart, NewFile } from "@/core/define"
import { fileIcons, fileMarks, fileViewFor, formatFor, pluginNewFiles, revealPanel, useFileRows } from "@/core/plugins"
import { getPrefs, setPrefs, usePrefs, type FileSort } from "@/core/prefs"
import { commandItems, menuBelow, menuFor, type MenuItem } from "@/components/ContextMenu"
import { copyPathItem, duplicateItem, filesMenu, grouped, moreItem, openItem, pluginFileGroups, remove, renameItem, revealItem, topmost } from "@/components/FileActions"
import { pickFolder } from "@/components/FolderPicker"
import { SwipeRow, type SwipeAction } from "@/components/SwipeRow"
import { cn, scrollingBox, space } from "@/lib/utils"
import { rowMenu, selectClick, selectedAttr, selectionFor, useSelectable, useSelected } from "@/core/select"
import { SidebarHeading } from "@/components/SidebarHeading"
import { signal } from "@/core/signal"

// ---------- which folders are open (the current workspace's: core/scope.ts) ----------
// Kept per workspace so each desk has its own folders open; Notes until then.
const openState = scopedState<string[]>("files:open", ["Notes"], "workspace")
/** The kept list as a set, made again only when the list changes (what redraws compare). */
let seenList: string[] | null = null
let seenSet = new Set<string>()
const openedNow = () => {
  const l = openState.get()
  if (l !== seenList) { seenList = l; seenSet = new Set(Array.isArray(l) ? l : []) }
  return seenSet
}
function setOpened(next: Set<string>) { openState.set([...next].sort()) }
const useOpened = () => useSyncExternalStore(subscribeScoped, openedNow)
/** Whether this folder is open: its row is drawn again when that changes, not when another folder opens. */
const useIsOpen = (p: string) => useSyncExternalStore(subscribeScoped, () => openedNow().has(p))
const toggle = (p: string) => { const n = new Set(openedNow()); if (n.has(p)) { n.delete(p); setShowingAll(p, false) } else n.add(p); setOpened(n) }

// ---------- long folders: their first files, then "Show N more" (prefs.folderLimit) ----------
/** Cut only when it leaves out more than this many: "Show 2 more" would be a row in place of two. */
const SLACK = 5
/** Folders showing all their files (this session's); closing one shows its first ones again. */
let showingAll = new Set<string>()
/** The last file revealed (revealInTree): shown in its folder past the limit, so it can be scrolled to. */
let revealedPath = ""
const moreSubs = signal()
const subscribeMore = moreSubs.subscribe
function setShowingAll(p: string | null, all = false) {
  if (p === null ? !showingAll.size : showingAll.has(p) === all) return
  const n = new Set(p === null ? [] : showingAll)
  if (p !== null) { if (all) n.add(p); else n.delete(p) }
  showingAll = n
  moreSubs.notify()
}
const useShowsAll = (p: string) => useSyncExternalStore(subscribeMore, () => showingAll.has(p))
/** The revealed file when it's this folder's own, else "" (only that folder is drawn again). */
const useRevealedIn = (p: string) => useSyncExternalStore(subscribeMore, () => (revealedPath && folderOf(revealedPath) === p ? revealedPath : ""))
/** A folder's rows: its folders, its first `limit` files and the ones in `keep` (open, revealed, being renamed);
 *  `hidden`: how many files that leaves out, `long`: whether it has more than the limit shows. */
function capped(children: Node[], limit: number, all: boolean, keep: (string | undefined)[]) {
  const files = children.reduce((k, c) => k + (c.folder ? 0 : 1), 0)
  const long = limit > 0 && files > limit + SLACK
  if (!long || all) return { shown: children, hidden: 0, long }
  let i = 0
  const shown = children.filter((c) => c.folder || i++ < limit || keep.includes(c.path))
  return { shown, hidden: children.length - shown.length, long }
}
/** A file or folder in the file tree, flashed (hidden files turned on first when it's in a dot folder). */
export async function showInTree(path: string) {
  if (path.split("/").some((part) => part.startsWith(".")) && !getPrefs().showHidden) {
    await setPrefs({ showHidden: true })
    await reload()
  }
  revealInTree(path, { scroll: true, flash: true, open: true })
}

/** Open every folder above a file. `scroll`: scroll to it (an open folder to the top); `flash`: pulse its row once;
 *  `open`: a folder opens too. */
export function revealInTree(path: string, opts: { scroll?: boolean; flash?: boolean; open?: boolean } = {}) {
  const parts = path.split("/").slice(0, opts.open ? undefined : -1)
  if (revealedPath !== path) { revealedPath = path; moreSubs.notify() }
  const n = new Set(openedNow())
  let changed = false
  for (let i = 1; i <= parts.length; i++) { const f = parts.slice(0, i).join("/"); if (!n.has(f)) { n.add(f); changed = true } }
  if (changed) setOpened(n)
  if (!opts.scroll && !opts.flash) return
  // Asked for (flash): a tree in sight, wherever the Files panel is (the right sidebar, a sidebar tab, folded, a
  // rail), or, with the panel hidden, the Files tab.
  const shown = [...document.querySelectorAll<HTMLElement>("[role=tree]")].some((t) => t.offsetParent && !t.closest("[data-flyout]"))
  if (opts.flash && !shown && isDesktop() && !revealPanel(FILES_PANEL)) openView("files", { newTab: true })
  // After the folders render (and the sidebar opens).
  const find = () => [...document.querySelectorAll<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`)].find((el) => el.offsetParent)
  const go = (tries: number) => {
    const row = find()
    if (!row) { if (tries) setTimeout(() => go(tries - 1), 60); return }
    const r = row.getBoundingClientRect(), seen = seenArea(row)
    const flash = () => { if (!opts.flash) return; row.classList.remove("reveal-flash"); void row.offsetWidth; row.classList.add("reveal-flash") }
    // In sight already (a folder: with room for some of its files under it): only the pulse.
    const top = opts.open && row.hasAttribute("data-tree-folder")
    const room = top ? Math.min(r.height * 4, (seen.bottom - seen.top) / 2) : 0
    if (r.top >= seen.top && r.bottom + room <= seen.bottom) return flash()
    const box = scrollingBox(row)
    if (!box) return flash()
    const by = top ? r.top - seen.top - r.height / 2 : opts.flash ? r.top + r.height / 2 - (seen.top + seen.bottom) / 2
      : r.top < seen.top ? r.top - seen.top : r.bottom - seen.bottom
    box.scrollBy({ top: by, behavior: opts.flash ? "smooth" : "auto" })
    setTimeout(flash, opts.flash ? 350 : 0)
  }
  requestAnimationFrame(() => go(5))
}

/** Where on screen a row can be seen: the window, cut by every box around it that clips, below the sticky heading of
 *  its panel (rows pass under it). The tree itself is as tall as its rows, so it says nothing about that. */
function seenArea(el: HTMLElement) {
  let top = 0, bottom = innerHeight
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (getComputedStyle(p).overflowY === "visible") continue
    const b = p.getBoundingClientRect()
    top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom)
  }
  const head = el.closest("[data-panel]")?.querySelector<HTMLElement>("[data-panel-handle]")
  if (head && getComputedStyle(head).position === "sticky") top = Math.max(top, head.getBoundingClientRect().bottom)
  return { top, bottom }
}

/** The tree's drop target (core/drag.ts): moving things into a folder. Each tree has its own (the sidebar's, and one
 *  in a Files tab). */
const TREE = "tree"
/** The Files plugin's sidebar panel (plugins/core/files), which Reveal in file tree brings into sight. */
const FILES_PANEL = "files:files"

// ---------- moving ----------
/** Can't be moved by dragging or Move to…, nor take things in: the trash and what's in it, the app's own folders. */
const fixed = (p: string) => p === ".trash" || inTrash(p) || isProtected(p)
/** Whether moving `from` into `folder` ("" = the top level) would do anything: not its own folder, not itself or inside it. */
const canMoveInto = (from: string, folder: string) =>
  folder !== folderOf(from) && folder !== from && !folder.startsWith(`${from}/`) && !(folder && fixed(folder))

/** An archive folder, or in one (People/.archive): hidden in the tree unless archived files are shown. */
const archives = (p: string) => p.split("/").includes(ARCHIVE_DIR)

/** What the tree shows beyond the user's notes, for its panel's, its tab's and its empty space's menus: hidden files, and
 *  archived ones when there are archive folders (the heading's buttons have the rest: sort, reveal, collapse). */
export function treeShownItems(): MenuItem[] {
  const store = getStore()
  const anyArchive = getPrefs().showArchived || (!!store && folderList(store.files).some(archives))
  return commandItems("files:show-hidden", "files:hide-hidden", ...(anyArchive ? ["files:show-archived", "files:hide-archived"] : []))
}

/** Can things from the computer be dropped in this folder? */
const canDropIn = (folder: string) => !(folder && (fixed(folder) || isHidden(folder)))

const moving = (e: DragEvent) => (isMac ? e.altKey : e.shiftKey)
/** Copy (⌥: move; ⇧ off a Mac, where ⌥-drag moves the window) files from the computer into a folder, then show the
 *  first one there. */
async function dropFrom(dt: DataTransfer, folder: string, move: boolean) {
  try {
    const made = await dropInto(dt, folder, move)
    await reload()
    if (made[0]) revealInTree(made[0], { scroll: true, flash: true })
  } catch (e) { notifyError(e, "Couldn't add the files") }
}

/** Move a file or folder into a folder, then show it there (it pulses once). */
async function moveInto(from: string, folder: string) {
  if (!canMoveInto(from, folder)) return
  try {
    const r = await moveFile(from, joinPath(folder, from.split("/").pop()!))
    revealInTree(r.path, { scroll: true, flash: true })
  } catch (e) { notifyError(e, "Couldn't move") }
}

/** The tree's selection (core/select.ts): files and folders by path, one list wherever a tree is drawn. */
const SELECT = "files"

/** Move several files and folders into a folder, then one toast with Undo for all of them. `before` runs before each
 *  moves (if it throws, that one doesn't); `reveal: false` leaves the tree as it is (a drop elsewhere shows where). */
export async function moveManyInto(paths: string[], folder: string, { before, reveal = true }: { before?: (path: string, folder: string) => unknown; reveal?: boolean } = {}) {
  const moved: { from: string; to: string }[] = []
  for (const from of topmost(paths).filter((p) => canMoveInto(p, folder))) {
    try { await before?.(from, folder); const r = await moveFile(from, joinPath(folder, from.split("/").pop()!), { undo: false }); moved.push({ from, to: r.path }) }
    catch (e) { notifyError(e, "Couldn't move") }
  }
  if (!moved.length) return
  if (reveal) revealInTree(moved[0].to, { scroll: true, flash: true })
  notify(`Moved ${moved.length === 1 ? "it" : `${moved.length} items`} to ${folder || "the top of the vault"}`, { action: { label: "Undo", run: async () => {
    for (const m of moved) await moveFile(m.to, m.from, { undo: false })
  } } })
}

/** "Move to…" for several: one folder for them all (one none of them is, nor is inside). `before(path, folder)` runs
 *  before each moves; if it throws, that one doesn't. */
export function askMoveMany(paths: string[], opts: { before?: (path: string, folder: string) => unknown } = {}) {
  const t = getStore()?.files
  const roots = topmost(paths).filter((p) => !fixed(p))
  if (!t || !roots.length) return
  if (roots.length === 1) return askMove(roots[0], { before: opts.before && ((f) => opts.before!(roots[0], f)) })
  const all = folderList(t)
  const hidden = roots.every(isHidden), archived = roots.every(inArchive)
  const folders = ["", ...all].filter((f) => roots.some((p) => canMoveInto(p, f)) && roots.every((p) => f !== p && !f.startsWith(`${p}/`))
    && (!isHidden(f) || hidden) && (!archives(f) || archived))
  pickFolder({ name: `${roots.length} items`, path: roots[0], folders, all, onPick: (f) => void moveManyInto(roots, f, { before: opts.before }) })
}

/** "Move file to…": pick a folder (fuzzy, "/"
 *  the top level), then move it there. `before(folder)` runs first; if it throws, nothing moves. */
export function askMove(path: string, opts: { before?: (folder: string) => unknown } = {}) {
  const t = getStore()?.files
  if (!t || fixed(path)) return
  const all = folderList(t)
  // Hidden folders only for hidden things (.vaultite with hidden files on); archive folders only for archived ones.
  const folders = ["", ...all].filter((f) => canMoveInto(path, f) && (!isHidden(f) || isHidden(path)) && (!archives(f) || inArchive(path)))
  const pick = async (f: string) => {
    if (opts.before && canMoveInto(path, f)) {
      try { await opts.before(f) } catch (e) { return notifyError(e, "Couldn't move") }
    }
    await moveInto(path, f)
  }
  pickFolder({ name: shownName(path), path, folders, all, onPick: (f) => void pick(f) })
}

// ---------- icons (the tree and the tabs) ----------
/** A file's icon: its own `icon`, then a robot for the vault's top-level AGENTS.md and CLAUDE.md, then its plugin's
 *  for its kind, else the core's. */
export function fileIcon(path: string, type: string | null, disabled: string[], file?: VaultFile): { icon: LucideIcon; tint?: string } {
  // Its own icon (a dashboard's `icon: sun`, or the plugin's that brought it), in its colour.
  const own = file && (file.icon || file.plugin) ? iconOf(file) : null
  if (own) return { icon: own, tint: tintOf(file!.tint) }
  const s = getStore(), given = drawn(s ? fileIcons(s, disabled)[path] : undefined)
  if (given) return given
  if (path === "AGENTS.md" || path === "CLAUDE.md") return { icon: Bot }
  if (isJson(path)) return { icon: FileBraces }
  const format = formatFor(path, disabled)?.format
  if (format) return { icon: format.icon, tint: format.tint }
  if (!/\.md$/i.test(path)) return { icon: kindIcon(path) }
  const v = fileViewFor({ path, type }, disabled)?.view
  return v?.icon ? { icon: v.icon, tint: tintOf(file?.tint) ?? v.tint } : { icon: FileText, tint: tintOf(file?.tint) }
}

/** An icon a plugin gives a file or folder (`fileIcons`), drawn; null without one. */
function drawn(g?: FileIcon): { icon: LucideIcon; tint?: string } | null {
  const icon = g && namedIcon(g.icon)
  return icon ? { icon, tint: tintOf(g.tint) } : null
}

/** `other`: not a note, JSON or a page a plugin draws (code, an image...): named with its extension, and not a page. */
type Node = { path: string; name: string; folder: boolean; file?: VaultFile; other?: boolean; mtime: number; ctime: number; children: Node[] }
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

// ---------- sorting (folders stay first, by name) ----------
export const SORTS: { value: FileSort; label: string }[][] = [
  [{ value: "name", label: "File name (A to Z)" }, { value: "name-desc", label: "File name (Z to A)" }],
  [{ value: "modified", label: "Modified time (new to old)" }, { value: "modified-old", label: "Modified time (old to new)" }],
  [{ value: "created", label: "Created time (new to old)" }, { value: "created-old", label: "Created time (old to new)" }],
]
function compare(sort: FileSort) {
  const byName = (a: Node, b: Node) => collator.compare(a.name, b.name)
  const files: (a: Node, b: Node) => number = {
    name: byName,
    "name-desc": (a: Node, b: Node) => byName(b, a),
    modified: (a: Node, b: Node) => b.mtime - a.mtime || byName(a, b),
    "modified-old": (a: Node, b: Node) => a.mtime - b.mtime || byName(a, b),
    created: (a: Node, b: Node) => b.ctime - a.ctime || byName(a, b),
    "created-old": (a: Node, b: Node) => a.ctime - b.ctime || byName(a, b),
  }[sort] ?? byName
  return (a: Node, b: Node) => (a.folder !== b.folder ? (a.folder ? -1 : 1) : a.folder ? (sort === "name-desc" ? byName(b, a) : byName(a, b)) : files(a, b))
}

/** `open`: hidden or archived files open in tabs that the tree doesn't show: shown too, with their folders. */
function build(store: Store, sort: FileSort, open: string[] = [], showArchived = false): Node {
  const root: Node = { path: "", name: "", folder: true, mtime: 0, ctime: 0, children: [] }
  const folders = new Map<string, Node>([["", root]])
  // Archive folders (core/fileprops.ts) are left out unless shown; an archived file open in a tab shows, like a hidden one.
  const wanted = new Set(open)
  const shown = (p: string) => showArchived || !archives(p) || wanted.has(p)
  const listed = new Set([...store.files.files, ...store.files.others].map((f) => f.path))
  const extra = open.filter((p) => !listed.has(p))
  const all = new Set(folderList(store.files).filter((f) => showArchived || !archives(f)))
  for (const p of open) { const parts = p.split("/"); for (let i = 1; i < parts.length; i++) all.add(parts.slice(0, i).join("/")) }
  for (const f of [...all].sort()) {
    const node: Node = { path: f, name: f.split("/").pop()!, folder: true, mtime: 0, ctime: 0, children: [] }
    folders.set(f, node)
  }
  for (const [p, node] of folders) if (p) folders.get(folderOf(p))?.children.push(node)
  for (const f of store.files.files) {
    if (shown(f.path)) folders.get(folderOf(f.path))?.children.push({ path: f.path, name: stem(f.path), folder: false, file: f, mtime: f.mtime, ctime: f.ctime ?? f.mtime, children: [] })
  }
  for (const o of store.files.others) {
    // Hidden .md files (in the trash) aren't in the index, so they come as others; they still open in the editor.
    if (shown(o.path)) folders.get(folderOf(o.path))?.children.push({ path: o.path, name: shownName(o.path), folder: false, other: !isDoc(o.path), mtime: o.mtime, ctime: o.ctime ?? o.mtime, children: [] })
  }
  for (const p of extra) folders.get(folderOf(p))?.children.push({ path: p, name: shownName(p), folder: false, other: !isDoc(p), mtime: 0, ctime: 0, children: [] })
  const cmp = compare(sort)
  const order = (n: Node) => { n.children.sort(cmp); n.children.forEach(order) }
  order(root)
  return root
}

/** The new tree with the last one's nodes wherever nothing a row shows changed (the same objects): every change in the
 *  vault brings a new file list, and only the rows that changed are drawn again (TreeRow). */
function keepSame(prev: Node | null, next: Node): Node {
  if (!prev) return next
  const old = new Map(prev.children.map((c) => [c.path, c]))
  const children = next.children.map((c) => { const o = old.get(c.path); return o ? keepSame(o, c) : c })
  const same = prev.name === next.name && prev.folder === next.folder && prev.other === next.other && looks(prev.file) === looks(next.file)
    && children.length === prev.children.length && children.every((c, i) => c === prev.children[i])
  return same ? prev : { ...next, children }
}
/** What a file's row shows of it besides its name (its icon comes from these). */
const looks = (f?: VaultFile) => (f ? `${f.type}\0${f.kind}\0${f.icon ?? ""}\0${f.tint ?? ""}\0${f.plugin ?? ""}\0${f.archived ? 1 : 0}` : "")

// ---------- the tree ----------
/** Hidden files open in tabs (they show in the tree while they're open, with hidden files off), one per line. Archived
 *  ones aren't: one shows only while it's the open file (`active`). */
const openHiddenIn = (ws: Workspace, hidden: boolean) => hidden ? "" : [...new Set(leaves(ws.root).flatMap((g) => g.tabs.map((t) => t.to))
  .filter((to) => to.startsWith("file:") && isHidden(to.slice(5)) && !archives(to.slice(5))).map((to) => to.slice(5)))].sort().join("\n")

export const FileTree = memo(function FileTree({ store, active, compact = true, header = true, title = "Files", pane, scroll = false, revealScroll = true, className }: {
  store: Store
  /** The file open in the current tab (highlighted). */
  active?: string
  /** The header's name ("Files" in the sidebar). */
  title?: string
  /** Open files in that pane (a tab group's id), not the focused one: the Files tab opens them beside itself. */
  pane?: string
  /** Desktop sidebar rows (26px in compact density); phones get 44px rows. */
  compact?: boolean
  header?: boolean
  /** Rows scroll in their own box (a flyout of fixed height); left out, it's as tall as its rows. Never
   *  a scroller where nothing bounds it: it couldn't scroll and would stop the wheel scrolling what's around it. */
  scroll?: boolean
  /** Auto-reveal scrolls to the open file; false only opens its folders (a phone's drawer: one scroller, drawn afresh
   *  each time it's out, would jump past the panels above it). */
  revealScroll?: boolean
  className?: string
}) {
  const prefs = usePrefs(), { disabled, fileIcons, fileSort, folderLimit, autoReveal, showHidden } = prefs
  // Archive folders are their own switch, not hidden files': they stay out of the tree with hidden files shown.
  const showArchived = prefs.showArchived
  // Hidden files open in tabs (hidden files off): they show while they're open. (Only that: the tree isn't drawn again
  // for every other change of the tabs.)
  const openHidden = useSyncExternalStore(onWorkspaceChange, () => openHiddenIn(getWorkspace(), showHidden))
  // An archived file shows while it's the open file (just archived, or opened from search), and goes when you move on.
  const openArchived = !showArchived && active && archives(active) ? active : ""
  const last = useRef<Node | null>(null)
  const root = useMemo(() => (last.current = keepSame(last.current, build(store, fileSort, [...(openHidden ? openHidden.split("\n") : []), ...(openArchived ? [openArchived] : [])], showArchived))),
    [store, fileSort, openHidden, openArchived, showArchived])
  const open = useOpened()
  const allFolders = useMemo(() => folderList(store.files), [store])
  const anyArchive = allFolders.some(archives)
  const anyOpen = allFolders.some((f) => open.has(f))
  // Auto-reveal: the open file's folders open and the tree scrolls to it, whenever it changes (desktop sidebar).
  useEffect(() => { if (header && autoReveal && active) revealInTree(active, { scroll: revealScroll }) }, [header, autoReveal, active, revealScroll])
  const [renaming, setRenaming] = useState<string | null>(null)
  // A folder just made: naming it isn't a rename to undo (no toast), like a new note's title.
  const fresh = useRef<string | null>(null)
  // Dragging: what's dragged (its row dims), and the folder it would land in ("" = the top level; null = nowhere):
  // one of the tree's own (core/drag.ts), or files from the computer (HTML5, `fromComputer`).
  const d = useDrag()
  const dragging = d?.item.from === "tree" ? d.item.path! : null
  const draggingMany = d?.item.from === "tree" && !!d.item.paths
  const target = `${TREE}:${useId()}`
  const hit = useDropHit<string>(target)
  const [fromComputer, setFromComputer] = useState<string | null>(null)
  const dropOn = hit ?? fromComputer

  const newNote = async (folder: string) => {
    const f = await createFile(folder, freeName(store.files, folder, "Untitled"))
    if (folder) revealInTree(`${folder}/x`)
    openNew(f.path)
  }
  // A plugin's kind of file (New canvas): made in the folder, opened with its name ready to type, like a note.
  const newOf = async (nf: NewFile, folder: string) => {
    const p = await nf.make(folder)
    if (folder) revealInTree(`${folder}/x`)
    openNew(p)
  }
  const newFolder = async (parent: string) => {
    const p = await createFolder(parent, freeName(store.files, parent, "New folder", ""))
    revealInTree(`${p}/x`)
    fresh.current = p
    setRenaming(p)
  }
  const restore = async (n: Node) => {
    try { const to = await restoreFile(n.path); revealInTree(to, { scroll: true, flash: true }) } catch (e) { notifyError(e, "Couldn't restore") }
  }
  const rename = async (n: Node, name: string) => {
    setRenaming(null)
    const clean = cleanName(name)
    if (!clean || clean === n.name) return focusRow(n.path)
    const ext = n.folder || n.other ? "" : n.path.slice(n.path.lastIndexOf("."))
    const to = joinPath(folderOf(n.path), clean + ext)
    const naming = fresh.current === n.path
    fresh.current = null
    try { await moveFile(n.path, to, { undo: !naming }); focusRow(to) } catch (e) { notifyError(e, "Couldn't rename") }
  }
  // After renaming (done or not), the keyboard is on that row again, as it was before (desktop: the rows' own buttons).
  const focusRow = (path: string) => requestAnimationFrame(() => {
    const a = document.activeElement
    if (!compact || (a && a !== document.body)) return
    box.current?.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"] > button`)?.focus({ preventScroll: true })
  })

  /** "New canvas" -> "Canvas", in the New ▸ submenu. */
  const kindName = (label: string) => { const t = label.replace(/^New /, ""); return t.charAt(0).toUpperCase() + t.slice(1) }
  const items = (n: Node): MenuItem[] => {
    const here = n.folder ? n.path : folderOf(n.path)
    const file = !n.folder
    // The trash: restore or delete for good (asks first); .trash itself: empty it.
    if (n.path === ".trash") return [{ label: "Empty trash", icon: Trash2, run: () => remove(n.path), danger: true, disabled: !n.children.length }]
    if (inTrash(n.path)) {
      return [
        ...(file ? [{ label: "Open in new tab", icon: SquareArrowOutUpRight, run: () => openFile(n.path, { newTab: true }) }] : []),
        { label: "Restore", icon: RotateCcw, run: () => restore(n), sep: file },
        copyPathItem(n.path, { folder: n.folder }),
        ...revealItem(n.path),
        { label: "Delete permanently", icon: Trash2, run: () => remove(n.path), danger: true, sep: true },
      ]
    }
    // Groups, a line between each: open; new; change (Rename, Move, Duplicate); keep (Archive, Pin); plugins' groups;
    // the path, then More; Delete. Split rows (Open, New note, Rename, Copy path) keep the rest in their submenus.
    const locked = !n.path || isProtected(n.path)
    const kinds = pluginNewFiles(disabled).map((nf): MenuItem => ({ label: nf.label, icon: nf.icon, run: () => void newOf(nf, here).catch((e) => notifyError(e, `Couldn't make it`)) }))
    const plug = n.path ? pluginFileGroups(n.path, undefined, n.folder) : { navigate: [], more: [], rest: [] }
    return grouped([
      file ? [
        openItem(() => openFile(n.path, { newTab: true, pane }), compact ? () => openInSplit(`file:${n.path}`, "right") : undefined),
      ] : [],
      [
        // The plugins' other kinds in New note ▸, named by what they make (Canvas, Database, Base...).
        { label: "New note", icon: FilePlus, run: () => newNote(here),
          ...(kinds.length ? { split: true, items: [{ label: "Note", icon: FilePlus, run: () => newNote(here) }, ...kinds.map((k) => ({ ...k, label: kindName(k.label) }))] } : {}) },
        { label: "New folder", icon: FolderPlus, run: () => newFolder(here) },
      ],
      locked ? [] : [
        renameItem(n.path, () => setRenaming(n.path)),
        { label: n.folder ? "Move folder to…" : "Move file to…", icon: n.folder ? FolderInput : FileInput, run: () => askMove(n.path) },
        ...(file ? [duplicateItem(n.path)] : []),
      ],
      plug.navigate,
      ...plug.rest,
      [...(n.path ? [copyPathItem(n.path, { folder: n.folder }), ...revealItem(n.path)] : []), ...moreItem(plug.more)],
      locked ? [] : [{ label: "Delete", icon: Trash2, run: () => remove(n.path), danger: true }],
      // The tree's empty space (the vault's top): what it shows, as its panel's menu has.
      n.path ? [] : treeShownItems(),
    ])
  }
  // Selected together (core/select.ts): a right-click or … on one of them is about all of them.
  useSelectable(SELECT, { menu: (keys) => filesMenu(keys, { newTab: (p) => openFile(p, { newTab: true, pane }) }), noun: ["item", "items"] })
  const menuOf = (n: Node) => (n.path ? rowMenu(SELECT, n.path, () => items(n)) : () => items(n))
  const onMenu = (e: MouseEvent, n: Node) => menuFor(menuOf(n))(e)
  // Phones: a row swiped sideways shows its two most used changes (SwipeRow): Move and Delete, or in the trash Restore
  // and Delete (for good: that one asks). The app's own folders, and the trash itself, don't swipe.
  const swipe = (n: Node): SwipeAction[] => {
    if (!n.path || n.path === ".trash" || isProtected(n.path)) return []
    if (inTrash(n.path)) return [{ label: "Restore", icon: RotateCcw, run: () => restore(n), removes: true }, { label: "Delete", icon: Trash2, run: () => remove(n.path), danger: true }]
    if (fixed(n.path)) return []
    return [
      { label: "Move", icon: n.folder ? FolderInput : FileInput, run: () => askMove(n.path) },
      { label: "Delete", icon: Trash2, run: () => remove(n.path), danger: true, removes: true },
    ]
  }

  // A row is only a drag handle; the tree
  // works out the target from what's under the pointer. A finger picks a row up by holding it (a plain press scrolls).
  const canDrag = (n: Node) => !!n.path && renaming !== n.path && !fixed(n.path)
  const press = (e: PointerEvent<HTMLElement>, n: Node) => {
    if (!canDrag(n)) return
    // Held among others selected: they all go (a pane opens the files among them, a folder takes them all).
    const keys = selectionFor(SELECT, n.path, false)?.filter((p) => !fixed(p))
    const item: DragItem = keys && keys.length > 1
      ? { from: "tree", path: n.path, paths: keys, folder: n.folder || undefined, to: n.folder ? undefined : `file:${n.path}`, label: `${keys.length} items` }
      : n.folder ? { from: "tree", path: n.path, folder: true } : { from: "tree", path: n.path, to: `file:${n.path}` }
    startDrag(e, item, { touch: true })
  }
  const hover = useRef<{ path: string; timer: number } | null>(null)
  const [edge] = useState(edgeScroller)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const stopTimers = () => {
    if (hover.current) clearTimeout(hover.current.timer)
    hover.current = null
    edge.stop()
  }
  const targetAt = (el: EventTarget | null) => {
      // (A long folder's "Show more" row is in that folder.)
    const more = (el as Element | null)?.closest?.<HTMLElement>("[data-tree-more]")
    if (more) return { target: more.dataset.treeMore!, folder: null }
    const row = (el as Element | null)?.closest?.<HTMLElement>("[data-tree-path]")
    if (!row) return { target: "", folder: null }
    const p = row.dataset.treePath!
    return row.dataset.treeFolder ? { target: p, folder: p } : { target: folderOf(p), folder: null }
  }
  // Near the tree's top or bottom edge, it scrolls (faster the closer), while the pointer stays there.
  const scrollNear = (y: number, dragged: () => boolean) => {
    // (The tree's own box, or what it's in when it doesn't scroll itself: the open sidebar, a phone's drawer or page.)
    let ul: HTMLElement | null = list.current
    while (ul && !scroll && ul.parentElement && !/(auto|scroll)/.test(getComputedStyle(ul).overflowY)) ul = ul.parentElement
    if (ul) edge.near(ul, y, dragged)
  }
  // A closed folder held over for a moment opens (not the one being dragged, nor anything in it).
  const openLater = (from: string, folder: string | null) => {
    const want = folder && !openedNow().has(folder) && folder !== from && !folder.startsWith(`${from}/`) ? folder : null
    if (hover.current?.path === want) return
    if (hover.current) clearTimeout(hover.current.timer)
    hover.current = want ? { path: want, timer: window.setTimeout(() => { if (!openedNow().has(want)) toggle(want) }, 700) } : null
  }
  // The tree's own drags: the folder it would move into. Tabs and pinned pages dragged here aren't moved (a tab or a
  // page isn't a place in the tree).
  useDropTarget<string>(target, (item, _x, y, el) => {
    const inside = !!el && !!box.current?.contains(el)
    if (item.from !== "tree" || !item.path || !inside) { stopTimers(); return null }
    scrollNear(y, () => getDrag()?.item.path === item.path)
    const { target, folder } = targetAt(el)
    openLater(item.path, folder)
    const all = item.paths ?? [item.path]
    // (Several: into a folder that is none of them nor inside one, and that some of them aren't in yet.)
    return all.some((p) => canMoveInto(p, target)) && all.every((p) => target !== p && !target.startsWith(`${p}/`)) ? target : null
  }, (item, folder) => { if (item.paths) void moveManyInto(item.paths, folder); else if (item.path) moveInto(item.path, folder) }, { end: stopTimers })

  // Files and folders from the computer (HTML5 drag and drop). Entering a row and moving over it both decide (Chrome
  // sends dragover only once the pointer stays on a row).
  const over = (e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return
    scrollNear(e.clientY, () => true)
    const { target, folder } = targetAt(e.target)
    openLater("", folder)
    if (!canDropIn(target)) { e.dataTransfer.dropEffect = "none"; setFromComputer(null); return }
    e.preventDefault()
    e.dataTransfer.dropEffect = desktop && moving(e) ? "move" : "copy"
    setFromComputer(target)
  }
  const treeDrop = {
    onDragEnter: over,
    onDragOver: over,
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) return
      setFromComputer(null); stopTimers()
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return
      e.preventDefault()
      const { target } = targetAt(e.target)
      setFromComputer(null); stopTimers()
      if (canDropIn(target)) dropFrom(e.dataTransfer, target, !!desktop && moving(e))
    },
  }

  // What every row shares: the tree's settings, and its handlers, read through a ref (a row is drawn again only when
  // something it shows changed: TreeRow).
  const on = useRef<RowHandlers>(null!)
  on.current = { press, menu: onMenu, more: (e, n) => menuBelow(e, menuOf(n)()), rename, cancelRename: (n) => { setRenaming(null); focusRow(n.path) }, swipe }
  const { marks, icons } = usePluginRows(store, disabled)
  const decor = useFileRows(disabled)
  const limit = Math.max(0, Math.floor(Number(folderLimit) || 0))
  const rows = useMemo<Rows>(() => ({ compact, fileIcons, disabled, pane, on, marks, icons, decor, limit }), [compact, fileIcons, disabled, pane, marks, icons, decor, limit])

  return (
    <div ref={box} {...treeDrop} data-file-drop className={cn("flex min-h-0 flex-col", className)}>
      {header && (
        <SidebarHeading title={title} open>
          {([
            { label: "New note", icon: SquarePen, run: () => newNote(newNoteFolder(getStore(), currentFile())) },
            { label: "New folder", icon: FolderPlus, run: () => newFolder("") },
            { label: "Change sort order", icon: ArrowUpNarrowWide, run: (e: MouseEvent) => menuBelow(e, SORTS.flatMap((group, g) => group.map((o, i) => ({
              label: o.label, checked: fileSort === o.value, sep: g > 0 && i === 0, run: () => setPrefs({ fileSort: o.value }),
            })))) },
            { label: "Auto-reveal current file", icon: GalleryVertical, pressed: autoReveal, run: () => setPrefs({ autoReveal: !autoReveal }) },
            ...(anyArchive ? [{ label: showArchived ? "Hide archived files" : "Show archived files", icon: Archive, pressed: showArchived, run: () => setPrefs({ showArchived: !showArchived }) }] : []),
            anyOpen
              ? { label: "Collapse all", icon: ChevronsDownUp, run: () => { setOpened(new Set()); setShowingAll(null) } }
              : { label: "Expand all", icon: ChevronsUpDown, run: () => setOpened(new Set(allFolders)) },
          ] as { label: string; icon: LucideIcon; pressed?: boolean; run: (e: MouseEvent) => void }[]).map((b) => (
            <button key={b.label} type="button" onClick={b.run} data-tip={b.label} aria-label={b.label} aria-pressed={b.pressed}
              className={cn("grid size-6 cursor-pointer place-items-center rounded-[4px] hover:bg-foreground/[0.06] hover:text-foreground",
                b.pressed ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground")}>
              <b.icon className="size-[15px]" strokeWidth={2} />
            </button>
          ))}
        </SidebarHeading>
      )}
      <ul ref={list} role="tree" aria-label="Files" aria-multiselectable data-keylist data-select-list={SELECT} data-drop-root={dropOn === "" || undefined} onContextMenu={(e) => { if (e.target === e.currentTarget) onMenu(e, root) }}
        className={cn("flex-1 rounded-[8px] pb-6 transition-colors", scroll && "min-h-0 overflow-y-auto overscroll-contain", dropOn === "" && "drop-target bg-primary/10")}>
        <Kids n={root} depth={0} rows={rows} active={active} renaming={renaming ?? undefined} dropOn={dropOn ?? undefined} dragging={dragging} draggingMany={draggingMany} />
      </ul>
    </div>
  )
})

type RowHandlers = {
  press: (e: PointerEvent<HTMLElement>, n: Node) => void; menu: (e: MouseEvent, n: Node) => void; more: (e: MouseEvent, n: Node) => void
  rename: (n: Node, name: string) => void; cancelRename: (n: Node) => void; swipe: (n: Node) => SwipeAction[]
}
type Rows = { compact: boolean; fileIcons: boolean; disabled: string[]; pane?: string; on: { current: RowHandlers }; marks: Record<string, FileMark>
  icons: Record<string, FileIcon>; decor: Record<string, FileRow>; limit: number }

/** A part's style ("color: red; --x: 1") as React's. */
function styleOf(css?: string): CSSProperties | undefined {
  if (!css) return undefined
  const out: Record<string, string> = {}
  for (const d of css.split(";")) {
    const i = d.indexOf(":")
    if (i < 0) continue
    const k = d.slice(0, i).trim(), v = d.slice(i + 1).trim()
    if (k) out[k.startsWith("--") ? k : k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v
  }
  return out as CSSProperties
}
const partProps = (p?: FileRowPart) => ({ ...p?.attrs, ...(p?.style ? { style: styleOf(p.style) } : {}) })
/** Elements a plugin draws in a row (fileRows), copied in. */
function RowNodes({ nodes }: { nodes: globalThis.Node[] }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => { ref.current?.replaceChildren(...nodes.map((n) => n.cloneNode(true))) }, [nodes])
  return <span ref={ref} data-file-row-nodes className="contents" />
}
type Said = { marks: Record<string, FileMark>; icons: Record<string, FileIcon> }
/** Plugins' marks and icons (`fileMarks`, `fileIcons`), the same objects while they say the same, so rows are drawn again
 *  only when one changes. */
function usePluginRows(store: Store, disabled: string[]) {
  const last = useRef<{ key: string; said: Said }>({ key: "", said: { marks: {}, icons: {} } })
  return useMemo(() => {
    const said = { marks: fileMarks(store, disabled), icons: fileIcons(store, disabled) }, key = JSON.stringify(said)
    if (key !== last.current.key) last.current = { key, said }
    return last.current.said
  }, [store, disabled])
}
/** A path that is this row or inside it (a folder's), else undefined: rows get only what concerns them (the open file,
 *  the one being renamed, the folder a drag would land in), so the others aren't drawn again when it changes. */
const under = (p: string | null | undefined, n: Node) => (p != null && (p === n.path || p.startsWith(`${n.path}/`)) ? p : undefined)

/** A file or folder in the tree, and (an open folder) the rows inside it. */
const TreeRow = memo(function TreeRow({ n, depth, rows, active, renaming, dropOn, dragging, draggingMany }: {
  n: Node; depth: number; rows: Rows; active?: string; renaming?: string; dropOn?: string; dragging: string | null; draggingMany: boolean
}) {
  const picked = useSelected(SELECT, n.path)
  const { compact, fileIcons, disabled, pane, on } = rows
  const mark = n.folder ? undefined : rows.marks[n.path]
  const decor = rows.decor[n.path]
  const isOpen = useIsOpen(n.path)
  const { icon: Icon, tint }: { icon: LucideIcon; tint?: string } =
    n.path === ".trash" ? { icon: Trash2 } : n.folder ? drawn(rows.icons[n.path]) ?? { icon: n.name === ARCHIVE_DIR ? Archive : isOpen ? FolderOpen : Folder } : fileIcon(n.path, n.file?.type ?? null, disabled, n.file)
  // Rows, paddings and indents are in spacing units (compact px / 4), so they follow density (index.css): the chevron
  // stays in line with the sidebar's other icons (RAIL in Sidebar.tsx) in both.
  const rowH = compact ? "h-6.5 text-[13px]" : "min-h-11 text-[17px]"  // phones: long names wrap
  const indent = compact ? 3.5 : 4.5
  const selected = !n.folder && active === n.path
  const faint = isHidden(n.path)
  // Archived (core/fileprops.ts): still here, dimmed, icon and name alike; an archive folder and all in it too.
  const archived = !!n.file?.archived || archives(n.path)
  const pad = (compact ? 1.5 : 1) + depth * indent
  const click = (e: MouseEvent) => {
    if (selectClick(e, SELECT, n.path, currentFile())) return
    if (n.folder) return toggle(n.path)
    openFile(n.path, { newTab: e.metaKey || e.ctrlKey, pane })
  }
  return (
    <li role="treeitem" aria-expanded={n.folder ? isOpen : undefined} aria-selected={selected || undefined}
      className={cn("scroll-mt-10", n.folder && dropOn === n.path && "drop-target rounded-[7px] bg-primary/10")}>
      {renaming === n.path ? (
        <div data-tree-path={n.path} data-tree-folder={n.folder || undefined}
          className={cn("mb-px flex items-center gap-1.5 rounded-[5px] bg-foreground/[0.06]", rowH)} style={{ paddingLeft: space(pad + 5) }}>
          {/* (where the row's icon is: after its chevron's room) */}
          {fileIcons && <Icon className={cn("shrink-0 text-muted-foreground", compact ? "size-[15px]" : "size-[18px]")} strokeWidth={2} />}
          <input autoFocus defaultValue={n.name} aria-label="New name" spellCheck={false}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => on.current.rename(n, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") on.current.cancelRename(n) }}
            className="h-6 min-w-0 flex-1 rounded-[4px] bg-card px-1 outline-none ring-1 ring-primary/60" />
        </div>
      ) : (
        <SwipeRow actions={() => on.current.swipe(n)}>
        <div onPointerDown={(e) => { if (!n.folder) openingSoon(n.path, true); on.current.press(e, n) }} onContextMenu={(e) => on.current.menu(e, n)}
          onPointerEnter={n.folder ? undefined : () => openingSoon(n.path)} onPointerLeave={n.folder ? undefined : () => openingSoon(null)}
          {...partProps(decor?.row)} data-tree-path={n.path} data-tree-folder={n.folder || undefined} data-select-key={n.path} {...selectedAttr(picked)}
          className={cn(decor?.row?.className, "group relative mb-px flex items-center rounded-[5px] transition-colors", rowH,
            selected ? "bg-foreground/[0.08] font-medium" : !dragging && "hover:bg-foreground/[0.04]",
            (dragging === n.path || (picked && draggingMany)) && "opacity-50")}>
          <button type="button" data-keyrow onClick={click} onAuxClick={(e) => { if (e.button === 1 && !n.folder) { e.preventDefault(); openFile(n.path, { newTab: true, pane }) } }}
            data-tip={n.name} data-tip-side="right" data-tip-trunc data-archived={archived || undefined}
            className={cn("flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 pr-8 text-left", compact ? "h-full" : "min-h-11 self-stretch", archived && "opacity-50")} style={{ paddingLeft: space(pad) }}>
            {n.folder
              ? <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-150", isOpen && "rotate-90")} strokeWidth={2.5} />
              : <span className={compact ? "w-3.5 shrink-0" : "w-3.5 shrink-0"} />}
            {decor?.before?.length ? <RowNodes nodes={decor.before} />
              : fileIcons && <Icon className={cn("shrink-0", compact ? "size-[15px]" : "size-[18px]", !tint && "text-muted-foreground")} strokeWidth={2} style={tint ? { color: tint } : undefined} />}
            <span {...partProps(decor?.name)} className={cn(decor?.name?.className, "min-w-0 flex-1", compact ? "truncate" : "py-2.5 leading-[22px] break-words", faint && "text-muted-foreground")}>{n.name}</span>
            {!!decor?.after?.length && <RowNodes nodes={decor.after} />}
            {mark && <span data-file-mark data-tip={mark.tip} className={cn("shrink-0 tabular-nums", compact ? "text-[11px]" : "text-[13px]",
              mark.tone === "orange" ? "text-(--orange)" : "text-(--red)")}>{mark.text}</span>}
          </button>
          <button type="button" data-no-drag aria-label={`More for ${n.name}`}
            onClick={(e) => on.current.more(e, n)}
            className={cn("absolute right-1 grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground",
              compact ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : "")}>
            <Ellipsis className="size-4" strokeWidth={2.25} />
          </button>
        </div>
        </SwipeRow>
      )}
      {/* An indent guide: a thin line down from under the folder's chevron (size-3.5: its middle is
          1.75 units in), alongside its children. */}
      {n.folder && isOpen && !!n.children.length && (
        <ul role="group" className="relative before:pointer-events-none before:absolute before:inset-y-0 before:left-(--guide) before:w-px before:bg-border"
          style={{ "--guide": `calc(${space(pad + 1.75)} - 0.5px)` } as CSSProperties}>
          <Kids n={n} depth={depth + 1} rows={rows} active={active} renaming={renaming} dropOn={dropOn} dragging={dragging} draggingMany={draggingMany} />
        </ul>
      )}
    </li>
  )
})

type KidsProps = { n: Node; depth: number; rows: Rows; active?: string; renaming?: string; dropOn?: string; dragging: string | null; draggingMany: boolean }
/** A folder's rows, a long one's cut to its first files (Rows' `limit`) with a row that shows the rest or hides them again. */
function Kids({ n, depth, rows, active, renaming, dropOn, dragging, draggingMany }: KidsProps) {
  const all = useShowsAll(n.path), revealed = useRevealedIn(n.path)
  const { shown, hidden, long } = capped(n.children, rows.limit, all, [active, renaming, revealed])
  const pad = (rows.compact ? 1.5 : 1) + depth * (rows.compact ? 3.5 : 4.5)
  return (
    <>
      {shown.map((c) => (
        <TreeRow key={c.path} n={c} depth={depth} rows={rows} active={under(active, c)} renaming={under(renaming, c)}
          dropOn={under(dropOn, c)} dragging={dragging} draggingMany={draggingMany} />
      ))}
      {long && (all || hidden > 0) && (
        <li role="none" data-tree-more={n.path}>
          <button type="button" data-keyrow onClick={() => setShowingAll(n.path, !all)}
            className={cn("mb-px flex w-full cursor-pointer items-center gap-1.5 rounded-[5px] text-left text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground",
              rows.compact ? "h-6.5 text-[12px]" : "min-h-11 text-[15px]")} style={{ paddingLeft: space(pad) }}>
            <span className="w-3.5 shrink-0" />
            {all ? "Show less" : `Show ${hidden} more`}
          </button>
        </li>
      )}
    </>
  )
}

/** The New note / New folder actions, for places outside the tree (the files tab's header on phones). */
export function useFileActions(store: Store) {
  return {
    newNote: async (folder = newNoteFolder(store, currentFile())) => {
      const f = await createFile(folder, freeName(store.files, folder, "Untitled"))
      revealInTree(f.path)
      openNew(f.path)
    },
  }
}

