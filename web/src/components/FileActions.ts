// What the file menus do (the tree's, a tab's, the phone's), in one place so they say and do the same thing.
import { Columns2, Copy, Ellipsis, FileInput, FileSymlink, FolderInput, FolderSearch, FolderTree, Link, Pencil, RotateCcw, Smile, SquareArrowOutUpRight, Trash2, type LucideIcon } from "lucide-react"
import { actionIcon, fileActions, runAction } from "@/core/actions"
import { getStore } from "@/core/data"
import { post } from "@/core/http"
import { newNoteFolder, saveAttachments } from "@/core/conventions"
import { copyFile, deleteFile, fileOf, folderList, inTrash, isHidden, isMd, isProtected, isReadOnly, openFile, openNew, restoreFile, shownName, stem } from "@/core/files"
import { askRename } from "@/core/workspace"
import { setProperty } from "@/core/frontmatter"
import { resolver } from "@/core/links"
import { PLUGINS, isEnabled } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import { isLinux, isMac, revealLabel } from "@/core/platform"
import type { MenuItem } from "@/components/ContextMenu"
import { choose } from "@/components/Chooser"
import { confirmDialog } from "@/components/ConfirmDialog"
import { pickIcon } from "@/components/IconPicker"
import { askMove, askMoveMany, revealInTree } from "@/components/FileTree"
import { notify, notifyError } from "@/core/notify"

/** Put text on the clipboard: the Clipboard API (https and localhost), else a hidden text field and copy. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch { /* not a secure page, or no permission: the old way */ }
  const ta = document.createElement("textarea")
  ta.value = text
  ta.setAttribute("readonly", "")
  Object.assign(ta.style, { position: "fixed", top: "0", left: "0", opacity: "0", pointerEvents: "none" })
  // Inside an open dialog (the sheet) when there is one: outside it, the page is inert and can't take the selection.
  ;(document.querySelector("dialog[open]") ?? document.body).appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  const ok = document.execCommand("copy")
  ta.remove()
  if (!ok) throw new Error("Couldn't copy to the clipboard")
}

const copied = (text: string, what: string) => copyText(text).then(() => { notify(`Copied the ${what}`, { id: "copied" }) }, (e) => notifyError(e))
/** Copy a file's path in the vault ("People/Alice Park.md"). */
export const copyPath = (path: string) => copied(path, "path")
/** Copy a [[link]] to a file. */
export const copyLink = (path: string) => copied(linkTo(path), "link")

/** A [[link]] to a file, as short as the app's links allow: its name when that finds it, else its path. */
export function linkTo(path: string) {
  const s = getStore()
  const noMd = path.replace(/\.md$/i, "")
  const name = /\.md$/i.test(path) ? stem(path) : path.split("/").pop()!
  const resolve = s ? resolver(s) : null
  for (const c of [name, noMd]) if (resolve?.(c)?.file === path) return `[[${c}]]`
  // Not something links find by name (an image, a PDF): its file name, as embeds write it.
  return `[[${s?.files.files.some((f) => f.path === path) ? noMd : name}]]`
}

/** The vault's folder on the server's machine (for "From system root"). */
const vaultRoot = () => getStore()?.vault.path.replace(/\/+$/, "") ?? ""

/** "Copy path": a click copies it from the vault's folder; its submenu has that, from the system root, and (a file) a
 *  link. */
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

/** "Rename", with Change icon in its submenu for a Markdown file in the vault. */
export function renameItem(path: string, rename: () => void): MenuItem {
  const it: MenuItem = { label: "Rename", icon: Pencil, run: rename }
  const icon = iconItem(path)
  return icon.length ? { ...it, split: true, items: [it, ...icon] } : it
}

/** Finder or the file manager only answers this computer: the desktop app, or a browser on the server's own machine
 *  (the server checks too: POST /api/file/open). */
export const canReveal = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && (isMac || isLinux)

/** Open a vault file or folder in this computer's own app (`reveal`: show it in Finder); what fails is an error notice. */
export const openOnComputer = (path: string, reveal?: boolean) =>
  post("file/open", { path, ...(reveal ? { reveal } : {}) }).then(() => {}, (e) => notifyError(e))
export const revealInFinder = (path: string) => openOnComputer(path, true)

/** "Reveal in Finder" ("Show in folder" off a Mac), where it works (none elsewhere). */
export const revealItem = (path: string, sep = false): MenuItem[] =>
  canReveal() ? [{ label: revealLabel, icon: FolderSearch, sep, run: () => revealInFinder(path) }] : []

/** A file from outside the vault (desktop app) copied in, Markdown where new files go and the rest where attachments
 *  do, then shown instead of the outside one. */
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

/** In the desktop app, on the Mac the server runs on: files can open in their own app (a workbook in Numbers). */
export const canOpenHere = () =>
  document.documentElement.dataset.electron !== undefined && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)

export const openHere = (path: string) => openOnComputer(path)

/** Duplicate a file next to it ("Name 1.md"), then open the copy, ready to be renamed like a new note. */
export async function duplicate(path: string) {
  try {
    const to = await copyFile(path)
    revealInTree(to, { scroll: true, flash: true })
    openNew(to)
  } catch (e) { notifyError(e) }
}
export const duplicateItem = (path: string, sep = false): MenuItem => ({ label: "Duplicate", icon: FileSymlink, sep, run: () => duplicate(path) })

/** Pick a Markdown file's icon (its `icon` key: a Lucide name or an emoji). `set`: how to write it (an open editor's own). */
export function changeIcon(path: string, set: (n: string) => unknown = (n) => setProperty(path, "icon", n)) {
  const s = getStore()
  pickIcon({ title: "Change icon", current: (s && fileOf(s, path)?.icon) || undefined, onPick: (n) => { Promise.resolve(set(n)).catch((e) => notifyError(e)) } })
}
/** "Change icon", for a Markdown file in the vault. */
const iconItem = (path: string): MenuItem[] =>
  isMd(path) && !isHidden(path) && !inTrash(path) ? [{ label: "Change icon", icon: Smile, run: () => changeIcon(path) }] : []

/** A file's name as the tree shows it (in the trash, without the time trashing added). */
const nameOf = (path: string) => {
  const name = shownName(path)
  return inTrash(path) ? name.replace(/ \d{4}-\d{2}-\d{2} \d{6}(?=\.[^.]*$|$)/, "") : name
}

/** Move a file or folder to the vault's trash at once; deleteFile offers Undo (it comes back where it was, and opens
 *  again if it was open). */
async function trash(path: string) {
  try { await deleteFile(path) } catch (e) { notifyError(e) }
}

/** Delete something in the trash for good (or empty it: `.trash`), after asking: that can't be undone. */
async function deleteForGood(path: string) {
  const all = path === ".trash"
  const ok = await confirmDialog(all
    ? { title: "Empty the trash?", body: "Everything in it is deleted for good. This can't be undone.", confirm: "Empty trash", danger: true }
    : { title: `Delete "${nameOf(path)}" permanently?`, body: "It's deleted for good. This can't be undone.", confirm: "Delete", danger: true })
  if (!ok) return
  try { await deleteFile(path) } catch (e) { notifyError(e) }
}

/** Delete, the right way for where it is: to the trash with Undo, or for good (asking) in the trash. */
export const remove = (path: string) => (path === ".trash" || inTrash(path) ? deleteForGood(path) : trash(path))

/** Plugins' `fileMenu` items (a folder's: `folderMenu`) for the plugins that are on (but `skip`: a plugin's own menu), by
 *  `section`: navigate, more, then the rest a group each, in the plugins' order. */
export function pluginFileGroups(path: string, skip?: string, folder = false): { navigate: MenuItem[]; more: MenuItem[]; rest: MenuItem[][] } {
  const disabled = getPrefs().disabled
  const by = new Map<string, MenuItem[]>([["navigate", []], ["more", []], ["actions", []]])
  for (const p of PLUGINS) {
    const menu = folder ? p.folderMenu : p.fileMenu
    if (!menu || !isEnabled(p.id, disabled) || p.id === skip) continue
    try {
      for (const { section = "actions", ...it } of menu(path)) {
        if (!by.has(section)) by.set(section, [])
        by.get(section)!.push({ ...it, icon: it.icon as LucideIcon | undefined })
      }
    } catch { /* a plugin's menu failing must not break the rest */ }
  }
  // The ops that act on its kind (core/actions.ts) whose plugin has no item of its own for them
  for (const a of fileActions(path, skip)) if (a.menu) by.get("actions")!.push({ label: a.label, icon: actionIcon(a), run: () => void runAction(a) })
  const { navigate, more, ...rest } = Object.fromEntries(by)
  return { navigate, more, rest: Object.values(rest) }
}

/** The plugins' "more" items as More ▸ (the menu's last before Delete), by name (they come from several plugins: an order to find them by), or one
 *  alone as an item of its own (a submenu of one is a click for nothing). */
export const moreItem = (items: MenuItem[]): MenuItem[] =>
  items.length > 1 ? [{ label: "More", icon: Ellipsis, run: () => {}, items: [...items].sort((x, y) => x.label.localeCompare(y.label)) }] : items

/** A vault file's menu as its tab shows it (the tree's, but for New): change it, the plugins' groups, its path, Delete.
 *  `rename`: how it's renamed (else in its tab, opened first); `phone` leaves out what a phone hasn't got. */
export function fileMenu(file: string, opts: { rename?: () => void; phone?: boolean } = {}): MenuItem[] {
  const ro = isReadOnly(file), locked = ro || isProtected(file)
  const plug = pluginFileGroups(file)
  return grouped([
    locked ? [] : [
      // (a phone renames in its title, so Change icon is an item of its own there)
      ...(opts.phone ? iconItem(file) : [renameItem(file, opts.rename ?? (() => { openFile(file); askRename(file) }))]),
      { label: "Move file to…", icon: FileInput, run: () => askMove(file) },
      duplicateItem(file),
    ],
    plug.navigate,
    ...plug.rest,
    [
      copyPathItem(file),
      ...(opts.phone ? [] : [{ label: "Reveal in file tree", icon: FolderTree, run: () => revealInTree(file, { scroll: true, flash: true }) }]),
      ...revealItem(file),
      ...moreItem(plug.more),
    ],
    !isProtected(file) ? [{ label: ro ? "Delete permanently" : "Delete", icon: Trash2, danger: true, run: () => remove(file) }] : [],
  ])
}

/** A menu made of groups, a line between each two (empty groups left out): the file menus' one shape. */
export function grouped(groups: MenuItem[][]): MenuItem[] {
  return groups.filter((g) => g.length).flatMap((g, i) => g.map((it, j) => (j === 0 ? { ...it, sep: i > 0 } : { ...it, sep: false })))
}

// ---------- several files at once (selected together: core/select.ts) ----------

/** The paths not inside another of them (a folder selected with what's in it moves or goes as one). */
export const topmost = (paths: string[]) => paths.filter((p) => !paths.some((q) => q !== p && p.startsWith(`${q}/`)))
const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`

/** Move several to the trash, then one toast with Undo for all of them. */
export async function trashMany(paths: string[]) {
  const back: string[] = []
  for (const p of topmost(paths)) {
    try { const t = await deleteFile(p, { quiet: true }); if (t) back.push(t) } catch (e) { notifyError(e) }
  }
  if (back.length) notify(`Moved ${many(back.length, "item")} to trash`, { action: { label: "Undo", run: async () => { for (const t of back) await restoreFile(t) } } })
}
/** Delete several in the trash for good, asking once. */
async function deleteManyForGood(paths: string[]) {
  const ok = await confirmDialog({ title: `Delete ${many(paths.length, "item")} permanently?`, body: "They're deleted for good. This can't be undone.", confirm: "Delete", danger: true })
  if (!ok) return
  for (const p of topmost(paths)) { try { await deleteFile(p) } catch (e) { notifyError(e) } }
}
async function restoreMany(paths: string[]) {
  for (const p of topmost(paths)) { try { await restoreFile(p) } catch (e) { notifyError(e, "Couldn't restore") } }
}

/** The plugins' items every one of these files has and that can be done to several at once (`many`): Pin, Archive. */
function pluginManyItems(paths: string[]): MenuItem[] {
  const disabled = getPrefs().disabled
  const out: MenuItem[] = []
  for (const p of PLUGINS) {
    if (!p.fileMenu || !isEnabled(p.id, disabled)) continue
    try {
      const menus = paths.map((path) => p.fileMenu!(path))
      for (const it of menus[0]) {
        if (!it.many || !menus.every((m) => m.some((x) => x.label === it.label && x.many))) continue
        const run = it.many
        out.push({ label: it.label, icon: it.icon as LucideIcon | undefined, run: () => run(paths) })
      }
    } catch { /* a plugin's menu failing must not break the rest */ }
  }
  return out
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
  return grouped([
    files.length ? [{ label: files.length === 1 ? "Open in new tab" : `Open ${files.length} in new tabs`, icon: SquareArrowOutUpRight, run: () => files.forEach(open) }] : [],
    locked ? [] : [{ label: "Move to…", icon: files.length === roots.length ? FileInput : FolderInput, run: () => askMoveMany(roots) }],
    files.length === roots.length ? pluginManyItems(files) : [],
    [{ label: "Copy paths", icon: Copy, run: () => void copied(roots.join("\n"), "paths") },
      ...(files.length === roots.length ? [{ label: "Copy links", icon: Link, run: () => void copied(files.map(linkTo).join("\n"), "links") }] : [])],
    locked ? [] : [{ label: "Delete", icon: Trash2, danger: true, run: () => void trashMany(roots) }],
  ])
}

/** Everything the plugins can do with a file (its menus' plugin items, its kind's actions among them), in the palette. */
export function chooseAction(path: string) {
  const g = pluginFileGroups(path)
  const flat = (its: MenuItem[], pre = ""): MenuItem[] => its.flatMap((it) => (it.items ? flat(it.items, `${pre}${it.label}: `) : it.disabled ? [] : [{ ...it, label: pre + it.label }]))
  const items = flat([...g.rest.flat(), ...g.navigate, ...g.more]).map((it, i) => ({ id: String(i), label: it.label, icon: it.icon, run: it.run }))
  choose({ title: "Actions", heading: stem(path), placeholder: "Do what with it…", items, onPick: (it) => it.run() })
}
