import { Columns2, Copy, Ellipsis, FileInput, FilePlus, FileSymlink, FolderInput, FolderOpen, FolderPlus, FolderSearch, FolderTree, Link, Pencil, RotateCcw, Smile, SquareArrowOutUpRight, Trash2 } from "lucide-react"
import { actionIcon, fileActions, runAction } from "@/core/actions"
import { getStore } from "@/core/data"
import { kindOf } from "@/core/filekinds"
import { post } from "@/core/http"
import { newNoteFolder, saveAttachments } from "@/core/conventions"
import { copyFile, deleteFile, fileOf, folderList, folderTarget, inTrash, isHidden, isMd, isProtected, isReadOnly, openFile, openFolder, openNew, restoreFile, shownName, stem } from "@/core/files"
import { askRename, isPopout } from "@/core/workspace"
import { setProperty } from "@/core/frontmatter"
import { shortestLink } from "@/core/links"
import { PLUGINS, isEnabled } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import { isDesktop, isLinux, isMac, isWindows, revealLabel } from "@/core/platform"
import { openInSplit } from "@/core/splits"
import type { MenuItem } from "@/components/ContextMenu"
import { choose } from "@/components/Chooser"
import { confirmDialog } from "@/components/ConfirmDialog"
import { pickIcon } from "@/components/IconPicker"
import { askMove, askMoveMany, newNote, revealInTree } from "@/components/FileTree"
import { notify, notifyError } from "@/core/notify"
import { plural } from "@/lib/utils"

/** Put text on the clipboard: the Clipboard API (https and localhost), else a hidden text field and copy. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {}
  const ta = document.createElement("textarea")
  ta.value = text
  ta.setAttribute("readonly", "")
  Object.assign(ta.style, { position: "fixed", top: "0", left: "0", opacity: "0", pointerEvents: "none" })
  // A modal dialog makes the rest of the page inert, so the field must be inside it to take the selection.
  ;(document.querySelector("dialog[open]") ?? document.body).appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  const ok = document.execCommand("copy")
  ta.remove()
  if (!ok) throw new Error("Couldn't copy to the clipboard")
}

export const copied = (text: string, what: string) => copyText(text).then(() => { notify(`Copied the ${what}`, { id: "copied" }) }, (e) => notifyError(e))
export const copyPath = (path: string) => copied(path, "path")
export const copyLink = (path: string) => copied(linkTo(path), "link")

/** A [[link]] to a file (written in `from`), as short as the app's links allow: the shortest path that finds it. */
export function linkTo(path: string, from?: string) {
  const s = getStore()
  return `[[${s ? shortestLink(s, path, from) : path.replace(/\.md$/i, "")}]]`
}

const vaultRoot = () => getStore()?.vault.path.replace(/\/+$/, "") ?? ""

export function copyPathItem(path: string, opts: { folder?: boolean; sep?: boolean } = {}): MenuItem {
  const items: MenuItem[] = [
    { label: "From vault folder", run: () => copyPath(path) },
    ...(vaultRoot() ? [{ label: "From system root", run: () => copied(`${vaultRoot()}/${path}`, "path") }] : []),
  ]
  if (!opts.folder) items.push({ label: "Copy link", icon: Link, sep: true, run: () => copyLink(path) })
  return { label: "Copy path", icon: Copy, sep: opts.sep, run: () => copyPath(path), items, split: true }
}

/** "Open in new tab", with Open to the right in its submenu where there are splits (desktop). */
export function openItem(newTab: () => void, right?: () => void): MenuItem {
  const tab: MenuItem = { label: "Open in new tab", icon: SquareArrowOutUpRight, run: newTab }
  return right ? { ...tab, split: true, items: [tab, { label: "Open to the right", icon: Columns2, run: right }] } : tab
}

export function openFolderItem(folder: string, opts: { pane?: string } = {}): MenuItem {
  const open: MenuItem = { label: "Open", icon: FolderOpen, run: () => openFolder(folder, { pane: opts.pane }) }
  return { ...open, split: true, items: [open,
    { label: "Open in new tab", icon: SquareArrowOutUpRight, run: () => openFolder(folder, { newTab: true, pane: opts.pane }) },
    ...(isDesktop() ? [{ label: "Open to the right", icon: Columns2, run: () => openInSplit(folderTarget(folder), "right") }] : []),
  ] }
}

export function renameItem(path: string, rename: () => void): MenuItem {
  const it: MenuItem = { label: "Rename", icon: Pencil, run: rename }
  const icon = iconItem(path)
  return icon.length ? { ...it, split: true, items: [it, ...icon] } : it
}

export const canReveal = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && (isMac || isLinux || isWindows)

export const openOnComputer = (path: string, reveal?: boolean) =>
  post("file/open", { path, ...(reveal ? { reveal } : {}) }).then(() => {}, (e) => notifyError(e))
export const revealInFinder = (path: string) => openOnComputer(path, true)

export const revealItem = (path: string, sep = false): MenuItem[] =>
  canReveal() ? [{ label: revealLabel, icon: FolderSearch, sep, run: () => revealInFinder(path) }] : []

export const openFolderHereItem = (folder: string): MenuItem[] =>
  canReveal() ? [{ label: isMac ? "Open in Finder" : isWindows ? "Open in Explorer" : "Open in file manager", icon: FolderSearch, run: () => openOnComputer(folder) }] : []

export async function copyToVault(abs: string) {
  const s = getStore()
  if (!s) return
  try {
    const name = abs.split("/").pop()!
    const r = await fetch(`api/raw/${encodeURIComponent(name)}?path=${encodeURIComponent(abs)}`)
    if (!r.ok) throw new Error(`couldn't read ${name}`)
    const [path] = await saveAttachments(s, "", [new File([await r.blob()], name)], isMd(abs) ? newNoteFolder(s) : undefined)
    openFile(path)
  } catch (e) { notifyError(e, "Couldn't copy it into the vault") }
}
export const copyToVaultItem = (abs: string, before?: () => void): MenuItem =>
  ({ label: "Copy to vault", icon: FolderInput, run: () => { before?.(); copyToVault(abs) } })

export const canOpenHere = () =>
  document.documentElement.dataset.electron !== undefined && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)

export async function duplicate(path: string) {
  try {
    const to = await copyFile(path)
    revealInTree(to, { scroll: true, flash: true })
    openNew(to)
  } catch (e) { notifyError(e) }
}
export const duplicateItem = (path: string, sep = false): MenuItem => ({ label: "Duplicate", icon: FileSymlink, sep, run: () => duplicate(path) })

export function changeIcon(path: string, set: (n: string) => unknown = (n) => setProperty(path, "icon", n), onClose?: () => void) {
  const s = getStore()
  pickIcon({ title: "Change icon", current: (s && fileOf(s, path)?.icon) || undefined, onPick: (n) => { Promise.resolve(set(n)).catch((e) => notifyError(e)) }, onClose })
}
export const iconChangeable = (path: string) => isMd(path) && !isHidden(path) && !inTrash(path)
const iconItem = (path: string): MenuItem[] => iconChangeable(path) ? [{ label: "Change icon", icon: Smile, run: () => changeIcon(path) }] : []

const nameOf = (path: string) => {
  const name = shownName(path)
  return inTrash(path) ? name.replace(/ \d{4}-\d{2}-\d{2} \d{6}(?=\.[^.]*$|$)/, "") : name
}

async function trash(path: string) {
  try { await deleteFile(path) } catch (e) { notifyError(e) }
}

async function deleteForGood(path: string) {
  const all = path === ".trash"
  const ok = await confirmDialog(all
    ? { title: "Empty the trash?", body: "Everything in it is deleted for good. This can't be undone.", confirm: "Empty trash", danger: true }
    : { title: `Delete "${nameOf(path)}" permanently?`, body: "It's deleted for good. This can't be undone.", confirm: "Delete", danger: true })
  if (!ok) return
  try { await deleteFile(path) } catch (e) { notifyError(e) }
}

export const remove = (path: string) => (path === ".trash" || inTrash(path) ? deleteForGood(path) : trash(path))

export type PluginGroups = { navigate: MenuItem[]; share: MenuItem[]; more: MenuItem[]; away: MenuItem[]; rest: MenuItem[][] }
export const noGroups: PluginGroups = { navigate: [], share: [], more: [], away: [], rest: [] }

/** Plugins' `fileMenu` items (a folder's: `folderMenu`) for the plugins that are on (but `skip`: a plugin's own menu), by
 *  `section`: navigate, share (in sight even in a tab's short menu), more, away (with Delete), then the rest a group each. */
export function pluginFileGroups(path: string, skip?: string, folder = false): PluginGroups {
  const disabled = getPrefs().disabled
  const by = new Map<string, MenuItem[]>([["navigate", []], ["share", []], ["more", []], ["away", []], ["actions", []]])
  for (const p of PLUGINS) {
    const menu = folder ? p.folderMenu : p.fileMenu
    if (!menu || !isEnabled(p.id, disabled) || p.id === skip) continue
    try {
      for (const { section = "actions", ...it } of menu(path)) {
        if (!by.has(section)) by.set(section, [])
        by.get(section)!.push(it)
      }
    } catch {}
  }
  for (const a of fileActions(path, skip)) if (a.menu) by.get("actions")!.push({ label: a.label, icon: actionIcon(a), run: () => void runAction(a) })
  const { navigate, share, more, away, ...rest } = Object.fromEntries(by)
  return { navigate, share, more, away, rest: Object.values(rest) }
}

export const moreItem = (items: MenuItem[]): MenuItem[] =>
  items.length > 1 ? [{ label: "More", icon: Ellipsis, run: () => {}, items: [...items].sort((x, y) => x.label.localeCompare(y.label)) }] : items

/** A vault file's menu wherever it's shown: `top` (what's about where it is), change it, the plugins' groups, its path,
 *  Archive and Delete. `inside`: shown in something else (an embed, a card), so no Duplicate and Delete names what goes. */
export function fileMenu(file: string, opts: { rename?: () => void; phone?: boolean; short?: boolean; top?: MenuItem[][]; inside?: boolean } = {}): MenuItem[] {
  const ro = isReadOnly(file), locked = ro || isProtected(file)
  const plug = pluginFileGroups(file)
  const rename = renameItem(file, opts.rename ?? (() => { openFile(file, { newTab: opts.inside }); askRename(file) }))
  const reveal: MenuItem[] = isPopout() ? [] : [{ label: "Reveal in file tree", icon: FolderTree, run: () => revealInTree(file, { scroll: true, flash: true }) }]
  const noun = !opts.inside || ro ? "" : kindOf(file) === "image" ? " image" : isMd(file) ? " note" : " file"
  const del: MenuItem[] = !isProtected(file) ? [{ label: ro ? "Delete permanently" : `Delete${noun}`, icon: Trash2, danger: true, run: () => remove(file) }] : []
  const change: MenuItem[] = locked ? [] : [{ label: "Move file to…", icon: FileInput, run: () => askMove(file) }, ...(opts.inside ? [] : [duplicateItem(file)])]
  if (opts.short) {
    const more = grouped([change, plug.navigate, ...plug.rest, plug.more, [...plug.away, ...del]])
    return grouped([...(opts.top ?? []), plug.share, [...(locked ? [] : [rename]), copyPathItem(file), ...reveal, ...revealItem(file),
      ...(more.length ? [{ label: "More file actions", icon: Ellipsis, run: () => {}, items: more }] : [])]])
  }
  return grouped([
    ...(opts.top ?? []),
    locked ? [] : [...(opts.phone ? iconItem(file) : [rename]), ...change],
    plug.navigate,
    plug.share,
    ...plug.rest,
    [copyPathItem(file), ...(opts.phone ? [] : reveal), ...revealItem(file), ...moreItem(plug.more)],
    [...plug.away, ...del],
  ])
}

/** A file listed in a row (a recent file, a query's result): Open in new tab (to the right too, on desktop), then its menu. */
export const rowFileMenu = (path: string): MenuItem[] => fileMenu(path, { phone: !isDesktop(), top: [[
  openItem(() => openFile(path, { newTab: true }), isDesktop() ? () => openInSplit(`file:${path}`, "right") : undefined)]] })

/** A folder's menu away from the tree (a pinned one, a folder's page): Open (`open` false: not), New, Rename (`rename`, where
 *  it's typed in place) and Move, the plugins' groups (but `skip`'s), its path and Reveal in file tree, Archive, Delete. */
export function folderMenu(folder: string, opts: { skip?: string; open?: boolean; pane?: string; rename?: () => void; newFolder?: () => void; inside?: boolean; short?: boolean } = {}): MenuItem[] {
  const locked = isProtected(folder) || inTrash(folder)
  const plug = pluginFileGroups(folder, opts.skip, true)
  const computer = opts.inside ? openFolderHereItem(folder) : revealItem(folder)
  const del: MenuItem[] = locked ? [] : [{ label: "Delete", icon: Trash2, danger: true, run: () => remove(folder) }]
  if (opts.short) {
    const more = grouped([locked ? [] : [{ label: "Move folder to…", icon: FolderInput, run: () => askMove(folder) }], plug.navigate, ...plug.rest, plug.more, [...plug.away, ...del]])
    return grouped([
      locked ? [] : [{ label: "New note", icon: FilePlus, run: () => void newNote(folder) }, ...(opts.newFolder ? [{ label: "New folder", icon: FolderPlus, run: opts.newFolder }] : [])],
      plug.share,
      [copyPathItem(folder, { folder: true }), ...(isPopout() ? [] : [{ label: "Reveal in file tree", icon: FolderTree, run: () => revealInTree(folder, { scroll: true, flash: true, open: true }) }]), ...computer,
        ...(more.length ? [{ label: "More folder actions", icon: Ellipsis, run: () => {}, items: more }] : [])],
    ])
  }
  return grouped([
    opts.open === false || inTrash(folder) ? [] : [openFolderItem(folder, { pane: opts.pane })],
    locked ? [] : [{ label: "New note", icon: FilePlus, run: () => void newNote(folder) }, ...(opts.newFolder ? [{ label: "New folder", icon: FolderPlus, run: opts.newFolder }] : [])],
    locked ? [] : [...(opts.rename ? [renameItem(folder, opts.rename)] : []), { label: "Move folder to…", icon: FolderInput, run: () => askMove(folder) }],
    plug.navigate,
    plug.share,
    ...plug.rest,
    [
      copyPathItem(folder, { folder: true }),
      { label: "Reveal in file tree", icon: FolderTree, run: () => revealInTree(folder, { scroll: true, flash: true, open: true }) },
      ...computer,
      ...moreItem(plug.more),
    ],
    [...plug.away, ...del],
  ])
}

/** A menu made of groups, a line between each two (empty groups left out): the file menus' one shape. */
export function grouped(groups: MenuItem[][]): MenuItem[] {
  return groups.filter((g) => g.length).flatMap((g, i) => g.map((it, j) => (j === 0 ? { ...it, sep: i > 0 } : { ...it, sep: false })))
}

export const topmost = (paths: string[]) => paths.filter((p) => !paths.some((q) => q !== p && p.startsWith(`${q}/`)))

async function trashMany(paths: string[]) {
  const back: string[] = []
  for (const p of topmost(paths)) {
    try { const t = await deleteFile(p, { quiet: true }); if (t) back.push(t) } catch (e) { notifyError(e) }
  }
  if (back.length) notify(`Moved ${plural(back.length, "item")} to trash`, { action: { label: "Undo", run: async () => { for (const t of back) await restoreFile(t) } } })
}
async function deleteManyForGood(paths: string[]) {
  const ok = await confirmDialog({ title: `Delete ${plural(paths.length, "item")} permanently?`, body: "They're deleted for good. This can't be undone.", confirm: "Delete", danger: true })
  if (!ok) return
  for (const p of topmost(paths)) { try { await deleteFile(p) } catch (e) { notifyError(e) } }
}
export function removeMany(paths: string[]) {
  const roots = topmost(paths)
  if (roots.every(inTrash)) return deleteManyForGood(roots)
  if (roots.some((p) => p === ".trash" || inTrash(p) || isProtected(p))) return Promise.resolve()
  return trashMany(roots)
}
async function restoreMany(paths: string[]) {
  for (const p of topmost(paths)) { try { await restoreFile(p) } catch (e) { notifyError(e, "Couldn't restore") } }
}

function pluginManyItems(paths: string[], folders: Set<string>): { items: MenuItem[]; away: MenuItem[] } {
  const disabled = getPrefs().disabled
  const items: MenuItem[] = [], away: MenuItem[] = []
  for (const p of PLUGINS) {
    if (!isEnabled(p.id, disabled)) continue
    try {
      const menus = paths.map((path) => (folders.has(path) ? p.folderMenu : p.fileMenu)?.(path) ?? [])
      for (const it of menus[0]) {
        if (!it.many || !menus.every((m) => m.some((x) => x.label === it.label && x.many))) continue
        const run = it.many
        ;(it.section === "away" ? away : items).push({ label: it.label, icon: it.icon, run: () => run(paths) })
      }
    } catch {}
  }
  return { items, away }
}

/** What files and folders selected together can do (the tree's right-click on one of them, the phone's bar): open the
 *  files, move, the plugins' `many` items, copy their paths, delete. In the trash: restore or delete for good. */
export function filesMenu(paths: string[], opts: { newTab?: (path: string) => void } = {}): MenuItem[] {
  const store = getStore()
  const folders = new Set(store ? folderList(store.files) : [])
  const roots = topmost(paths)
  const files = roots.filter((p) => !folders.has(p))
  if (roots.every(inTrash)) {
    return [
      { label: "Restore", icon: RotateCcw, run: () => void restoreMany(roots) },
      { label: "Delete permanently", icon: Trash2, danger: true, sep: true, run: () => void deleteManyForGood(roots) },
    ]
  }
  const locked = roots.some((p) => p === ".trash" || inTrash(p) || isProtected(p))
  const open = opts.newTab ?? ((p: string) => openFile(p, { newTab: true }))
  const plug = pluginManyItems(roots, folders)
  return grouped([
    files.length ? [{ label: files.length === 1 ? "Open in new tab" : `Open ${files.length} in new tabs`, icon: SquareArrowOutUpRight, run: () => files.forEach(open) }] : [],
    locked ? [] : [{ label: "Move to…", icon: files.length === roots.length ? FileInput : FolderInput, run: () => askMoveMany(roots) }],
    plug.items,
    [{ label: "Copy paths", icon: Copy, run: () => void copied(roots.join("\n"), "paths") },
      ...(files.length === roots.length ? [{ label: "Copy links", icon: Link, run: () => void copied(files.map((f) => linkTo(f)).join("\n"), "links") }] : [])],
    [...plug.away, ...(locked ? [] : [{ label: "Delete", icon: Trash2, danger: true, run: () => void trashMany(roots) }])],
  ])
}

export function chooseAction(path: string) {
  const g = pluginFileGroups(path)
  const flat = (its: MenuItem[], pre = ""): MenuItem[] => its.flatMap((it) => (it.items ? flat(it.items, `${pre}${it.label}: `) : it.disabled ? [] : [{ ...it, label: pre + it.label }]))
  const items = flat([...g.rest.flat(), ...g.navigate, ...g.more, ...g.away]).map((it, i) => ({ id: String(i), label: it.label, icon: it.icon, run: it.run }))
  choose({ title: "Actions", heading: stem(path), placeholder: "Do what with it…", items, onPick: (it) => it.run() })
}
