// The vault as files: the tree, opening files and changing them. Tabs (core/workspace.ts), splits and drops are
// re-exported here, the one module the rest of the app opens and moves files and tabs with.
import { reload, type Store } from "@/core/data"
import { del, get, post } from "@/core/http"
import { isEmbeddable, pageExt } from "@/core/formats"
import { afterSheets, closeDetailOf, retargetDetail, route, setFileOpener } from "@/core/nav"
import { runCommandId } from "@/core/commands"
import { onUiAction, onVaultChange, onVaultMove, touches } from "@/core/live"
import { isMedia, kindOf } from "@/core/filekinds"
import { movePlaces } from "@/core/viewstate"
import { homeFolder, inArchive, inPagesDir, isHiddenPath } from "../../../core/fileprops.ts"
import { notify as notice } from "@/core/notify"
import { leaves, shownTab, tabPath, type Group } from "@/core/layout"
import { closeFileTabs, closeTab, dropTabs, findOpen, focusGroup, getWorkspace, go, guarded, isDesktop, retarget, targetOf } from "@/core/workspace"
import { openInSplit } from "@/core/splits"
import { fileAt } from "@/core/pages"


export type VaultFile = {
  /** type: the core's (its kind's when a kind owns it, else its frontmatter's; core/fileprops.ts); kind: that kind's
   *  collection ("people"), if any. */
  path: string; type: string | null; kind: string | null; title: string; aliases: string[]
  /** Modified and created (ms). */
  mtime: number; ctime: number; size: number
  /** Every [[link]] in it: [target, the line it's on]. */
  links: [string, string][]
  problems: number
  /** Its ```block-<name> fences: [name, options text]. */
  blocks: [string, string][]
  /** Its kind's blocks (core/blocks.ts onTop): those it doesn't place are drawn on top of it. */
  kindBlocks?: string[]
  /** Its tags: frontmatter `tags` and inline #tags (core/sections.ts), when it has any. */
  tags?: string[]
  /** From its frontmatter, when it says: how it shows when pinned (a dashboard's icon and colour, the plugin it's from). */
  icon?: string; tint?: string; plugin?: string
  /** A page with tabs (core/tabs.ts): this file's label, and the files after it (on the head). */
  tab?: string; tabs?: string[]
  /** `archived: true` in its frontmatter (core/fileprops.ts): dimmed in the tree, left out of lists. */
  archived?: boolean
}
export type FileTree = { files: VaultFile[]; others: { path: string; mtime: number; ctime: number; size: number }[]; folders: string[] }
export type FileText = { path: string; text: string; mtime: number; size?: number; kind: string | null; problems: string[] }

/** A file's name as the app shows it: without .md, or the extension of a page a plugin draws (an artifact's .html, a
 *  table's .csv: named like notes, FileFormat.page); other files keep theirs. */
export function stem(path: string) {
  const name = path.split("/").pop()!
  if (/\.md$/i.test(name)) return name.slice(0, -3)
  const ext = pageExt(name)
  return ext ? name.slice(0, -ext.length - 1) : name
}
export const folderOf = (path: string) => path.split("/").slice(0, -1).join("/")
/** `name` in `folder` ("" is the top of the vault). */
export const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name)
/** A name as typed, made one a file can have: characters names can't have and runs of spaces become one space. */
export const cleanName = (typed: string) => typed.replace(/[*"\\/<>:|?#^[\]]/g, " ").replace(/\s+/g, " ").trim()
/** Where new files of a kind (its collection: "notes", "days") go: where most of its files are, folders named like
 *  `fallback` first (Personal/Notes/, not Clippings/), else `fallback`. Folders are the user's (core/fileprops.ts). */
export const homeOf = (s: Store | null | undefined, kind: string, fallback: string) =>
  homeFolder((s?.files.files ?? []).filter((f) => f.kind === kind).map((f) => f.path), fallback.split("/").pop(), kind === "logs") ?? fallback
export const fileOf = (s: Store, path: string) => fileAt(s.files.files, path)
/** Is there a file at `path` in the vault, Markdown or not. */
export const inVault = (s: Store, path: string) => !!fileAt(s.files.files, path) || !!fileAt(s.files.others, path)
export const isMd = (path: string) => /\.md$/i.test(path)
export const isJson = (path: string) => /\.json$/i.test(path)
/** A PDF, audio or video file, shown in a note by an embed like an artifact is. */
export const isMediaEmbed = (path: string) => /\.(pdf|mp3|m4a|aac|wav|ogg|oga|opus|flac|mp4|m4v|mov|webm|ogv)$/i.test(path)
/** The artifact, table, PDF,
 *  player or plugin-drawn file an embed names (`![[Spending.html]]`): by its path, or its file name. */
export function findEmbed(s: Store, target: string): string | null {
  // (a part after the name, `![[Books.base#Reading]]`, is the file's to read: found by its name)
  const hash = target.indexOf("#")
  if (hash > 0) { const hit = findEmbed(s, target.slice(0, hash)); return hit && !isMd(hit) ? hit : null }
  const low = target.trim().replace(/^\/+/, "").toLowerCase()
  const all = [...s.files.files, ...s.files.others].map((f) => f.path).filter(isEmbeddable)
  const is = (name: string) => name === low || name === `${low}.md` // (a drawn Markdown file named without its .md)
  return all.find((p) => is(p.toLowerCase())) ?? all.find((p) => is(p.split("/").pop()!.toLowerCase())) ?? null
}
/** Notes, JSON and pages plugins draw (artifacts, tables): the files that can be pages (pinned). The rest (code,
 *  images, PDFs...) open too. */
export const isDoc = (path: string) => isMd(path) || isJson(path) || !!pageExt(path)
/** In a dot folder, or a dot file: shown only with hidden files on. Not archive folders: an archived file opens as any. */
export const isHidden = isHiddenPath
export { inArchive, inPagesDir }
export const inTrash = (path: string) => path.startsWith(".trash/")
/** The app's own: can't be renamed, moved or deleted (the settings folder, the trash, the generated copies). */
export const isProtected = (path: string) => path === ".vaultite" || path === ".trash" || path === ".vaultite/generated" || path.startsWith(".vaultite/generated/")
/** Read-only in the editor: things in the trash (restore them to edit) and the app's generated copies. */
export const isReadOnly = (path: string) => inTrash(path) || path.startsWith(".vaultite/generated/")

/** Split a file into its frontmatter block ("---\n...\n---\n", plus the blank line after it, or "") and its body. */
export function splitFm(text: string): { fm: string; body: string } {
  const m = /^---\n(?:[\s\S]*?\n)?---[ \t]*(?:\n|$)\n?/.exec(text)
  return m ? { fm: m[0], body: text.slice(m[0].length) } : { fm: "", body: text }
}
/** A file's text from its frontmatter and body, splitFm's other way round: a file ending in its closing --- (no line
 *  break) gets one when a body is typed after it, so the text doesn't go onto the --- line and undo the frontmatter. */
export const joinFm = (fm: string, body: string) => (fm && body && !fm.endsWith("\n") ? `${fm}\n${body}` : fm + body)

// ---------- opening files ----------

const enc = encodeURIComponent

/** Open a file in a tab (go), on phones too; Back returns. From a sheet on a phone the sheets close first, so the file
 *  isn't under them. `pane`: in that pane, not the focused one. */
export function openFile(path: string, opts: { newTab?: boolean; pane?: string } = {}) {
  if (!isDesktop() && route().detail) return afterSheets(() => go(`file:${path}`, opts.newTab))
  if (opts.pane && isDesktop()) focusGroup(opts.pane)
  go(`file:${path}`, opts.newTab)
}
setFileOpener((path) => openFile(path))

// An agent's `vau open <path>` / `vau command <id>` / `vau notify <text>` (server.ts /api/ui), in the window the user
// was in last.
function openAsked(path: string, split?: "right" | "down" | null, newTab = false) {
  if (/^https?:\/\//i.test(path)) path = `view:web/${path}`
  const view = path.startsWith("view:")
  const to = view ? path : `file:${path.replace(/^file:/, "")}`
  if (!isDesktop()) return view ? afterSheets(() => go(to)) : openFile(to.slice(5))
  if (split) return openInSplit(to, split === "down" ? "bottom" : "right")
  if (!view) besideTerminal()
  go(to, newTab)
}
/** A file an agent opens from its terminal goes beside it, not over it: the focus moves to the first other pane that
 *  isn't showing a terminal, when there's one. */
function besideTerminal() {
  const ws = getWorkspace(), gs = leaves(ws.root)
  const isTerm = (g: Group) => !!shownTab(g)?.to.startsWith("view:terminal/")
  const cur = gs.find((g) => g.id === ws.focus)
  const other = cur && isTerm(cur) ? gs.find((g) => g.id !== cur.id && !isTerm(g)) : undefined
  if (other) focusGroup(other.id)
}
onUiAction((m) => {
  if (m.action === "command" && m.id) return runCommandId(m.id)
  if (m.action === "notify" && m.text) {
    const b = m.button
    return void notice(m.text, { kind: m.kind === "error" ? "error" : undefined, action: b ? { label: b.label, run: () => openAsked(b.open) } : undefined })
  }
  if (m.action === "open" && m.path) openAsked(m.path, m.split, !!m.newTab)
})

/** Open a plugin's view. A view is shown once: already open anywhere, that tab shows whatever `newTab` or `split` say,
 *  so a terminal never gets two tabs fighting over its size. Else a new tab, or the group to the right. */
export function openView(to: string, opts: { newTab?: boolean; split?: boolean; focus?: boolean } = {}) {
  const target = to.startsWith("view:") ? to : `view:${to}`
  if (findOpen(target)) return opts.focus === false ? undefined : go(target)
  if (opts.split) return openInSplit(target, "right", opts.focus !== false)
  go(target, opts.newTab)
}

/** Whether a view (`terminal/abc`) is open in a tab somewhere. */
export const isViewOpen = (to: string) => !!findOpen(to.startsWith("view:") ? to : `view:${to}`)

/** Close every tab showing a view (`terminal/abc`), as if the user did (its plugin hears it). */
export function closeView(to: string) {
  const target = to.startsWith("view:") ? to : `view:${to}`
  const open = findOpen(target)
  if (open) guarded([open.t], () => { for (let o = findOpen(target); o; o = findOpen(target)) closeTab(o.t.id, true) })
}

/** A file just made with New note: it opens ready to type its name. */
let fresh: string | null = null
export const markNew = (path: string) => { fresh = path }
export const takeNew = (path: string) => { if (fresh !== path) return false; fresh = null; return true }
/** Open a file just made, in editing with its name ready to type. */
export const openNew = (path: string, opts?: { newTab?: boolean }) => { markNew(path); openFile(path, opts) }

// ---------- file operations ----------

/** A file's text. One read ahead of time (prefetchFile) is taken by the first call for that file. */
export function readFile(path: string) {
  const early = ahead.get(path)
  ahead.delete(path)
  return early?.p ?? get<FileText>(`file?path=${enc(path)}`)
}

// Files read before their view asks (the files on screen at start, before the store is here): kept for a moment, and
// dropped when the file changes, so a view never starts from old text.
const ahead = new Map<string, { p: Promise<FileText>; at: number }>()
const AHEAD_MS = 30_000
onVaultChange((paths) => { for (const p of [...ahead.keys()]) if (touches(paths, p)) ahead.delete(p) })
function prefetchFile(path: string) {
  const now = Date.now()
  for (const [p, e] of ahead) if (now - e.at > AHEAD_MS) ahead.delete(p)
  if (ahead.has(path) || isMedia(kindOf(path))) return
  const p = get<FileText>(`file?path=${enc(path)}`)
  p.catch(() => { if (ahead.get(path)?.p === p) ahead.delete(path) })
  ahead.set(path, { p, at: now })
}

/** Each open editor's way to save what's typed now and wait for it (FileView's `settle`), by its file. */
const settlers = new Map<string, Set<() => Promise<void>>>()
export function onSettle(path: string, fn: () => Promise<void>) {
  const set = settlers.get(path) ?? new Set()
  settlers.set(path, set.add(fn))
  return () => { set.delete(fn); if (!set.size && settlers.get(path) === set) settlers.delete(path) }
}
/** Save what's typed in `path`'s open editors now, before something outside the app reads the file (an agent). */
export async function settleFile(path: string) {
  await Promise.all([...(settlers.get(path) ?? [])].map((fn) => fn().catch(() => {})))
}

/** A file about to be opened: the pointer resting on its row or link (read after a moment), or pressing it (read now),
 *  so its text is on its way before the click. null: the pointer left. */
let intent = 0
export function openingSoon(path: string | null, now = false) {
  clearTimeout(intent)
  if (path && now) prefetchFile(path)
  else if (path) intent = window.setTimeout(() => prefetchFile(path), 80)
}

/** Start reading the files on screen (the address's and its sheet's; on desktop each pane's), so they're drawn as soon
 *  as the store is here rather than asked for then (once, at start: main.tsx). */
export function prefetchShown() {
  const { tab, detail } = route()
  const shown = [targetOf(tab), detail.startsWith("file/") ? targetOf(detail) : ""]
  if (isDesktop()) for (const g of leaves(getWorkspace().root)) shown.push(shownTab(g)?.to ?? "")
  for (const to of new Set(shown)) { const p = tabPath(to); if (p) prefetchFile(p) }
}

export async function createFile(folder: string, name = "Untitled", text = "") {
  const f = await post<FileText>("file", { path: joinPath(folder, `${name}.md`), text, unique: true })
  await reload()
  return f
}

export async function createFolder(parent: string, name = "New folder") {
  const r = await post<{ path: string }>("folder", { path: joinPath(parent, name), unique: true })
  await reload()
  return r.path
}

/** A file or folder as the app names it: a note without .md, other files with their extension. */
export const shownName = (path: string) => (isDoc(path) ? stem(path) : path.split("/").pop()!)

// Moves, wherever they were made (this app, another device, an AI through the API: the live socket's `moved`): open
// tabs follow them, and what an editor still has to save goes to where its file is now (whereNow).
const moves: { n: number; from: string; to: string }[] = []
let moveCount = 0
function followMove(from: string, to: string | null) {
  if (from === to) return
  if (to === null) { dropTabs(from); closeDetailOf(from); return } // trashed
  moves.push({ n: ++moveCount, from, to })
  if (moves.length > 100) moves.shift()
  movePlaces(from, to) // (before the tabs follow: they look for their place under the new path)
  retarget(from, to)
  retargetDetail(from, to) // a phone's file sheet follows too, whatever moved it (the tree, Undo, a rename, an AI)
  // Archived (Done, Archive): out of the way, so it closes; taken back soon after (Undo), it opens again. Unless
  // archived by what the user did in it (a reply sent from a report): they're still reading it.
  const keep = kept.get(from)
  kept.delete(from)
  if (inArchive(to) && !inArchive(from) && !(keep && Date.now() - keep < 60_000)) {
    const shown = route().detail === `file/${encodeURIComponent(to)}`
    if (closeFileTabs(to) || shown) shelved = { path: to, at: Date.now() }
    closeDetailOf(to)
  } else if (shelved?.path === from && Date.now() - shelved.at < 60_000 && !inArchive(to)) {
    shelved = null
    openFile(to)
  }
}
/** Files to stay open when they're archived soon (in a minute): see keepOpen. */
const kept = new Map<string, number>()
/** Something done in this file is about to archive it (a reply sent from a report): its tabs follow it into the
 *  archive instead of closing. */
export const keepOpen = (path: string) => { kept.set(path, Date.now()) }
/** The file just closed by archiving it, for a quick Undo to open again. */
let shelved: { path: string; at: number } | null = null
onVaultMove(followMove)
/** Now, as far as moves go: pass it to whereNow later. */
export const moveMark = () => moveCount
/** Where a file is now, after the moves made since `mark` (itself if it didn't move). */
export function whereNow(path: string, mark: number) {
  let p = path
  for (const { n, from, to } of moves) {
    if (n <= mark) continue
    if (p === from) p = to
    else if (p.startsWith(`${from}/`)) p = to + p.slice(from.length)
  }
  return p
}

/** A save or read failed because the file isn't there any more (the server's 404). */
export const gone = (e: unknown) => /^Error: no file /.test(String(e))

/** Rename or move a file or folder; what plugins keep follows on the server (onMove) and comes back with the reload, so
 *  the app never writes a stale copy back. A toast offers Undo (`undo: false` for that move itself). */
export async function moveFile(from: string, to: string, opts: { undo?: boolean } = {}) {
  const r = await post<{ path: string; updated: string[] }>("file/move", { from, to })
  followMove(from, r.path)
  await reload()
  if (opts.undo !== false && r.path !== from) {
    const folder = folderOf(r.path)
    const text = folder === folderOf(from) ? `Renamed to ${shownName(r.path)}` : `Moved to ${folder || "the top of the vault"}`
    notice(text, { action: { label: "Undo", run: () => undoMove(r.path, from) } })
  }
  return r
}

/** Undo a move: back where it was, unless something changed since (then it says why, and nothing moves). */
async function undoMove(now: string, back: string) {
  try { await moveFile(now, back, { undo: false }) }
  catch (e) {
    const m = String((e as Error).message ?? e)
    throw new Error(`Couldn't undo: ${/^no file/.test(m) ? `${shownName(now)} was moved or deleted since` : /already exists/.test(m) ? `something else is at ${back} now` : m}`)
  }
}

/** Put something from the trash back where it was. */
export async function restoreFile(path: string) {
  const r = await post<{ path: string }>("file/restore", { path })
  retarget(path, r.path)
  await reload()
  return r.path
}

/** Move a file or folder to the trash (in the trash: delete it for good; .trash itself: empty it), with Undo unless
 *  `quiet`. Returns where it went in .trash (null when deleted for good). */
// Deleted here, a moment ago: an editor of it losing its last keystrokes is what the user asked for (Undo brings the
// file back), not something to warn about.
const deleting = new Set<string>()
export const deletedHere = (path: string) => [...deleting].some((d) => path === d || path.startsWith(`${d}/`))

export async function deleteFile(path: string, opts: { quiet?: boolean } = {}): Promise<string | null> {
  const wasOpen = leaves(getWorkspace().root).some((g) => g.tabs.some((t) => t.to === `file:${path}`))
  deleting.add(path)
  setTimeout(() => deleting.delete(path), 10_000)
  const { trashed } = await del<{ trashed?: string }>(`file?path=${enc(path)}`)
  dropTabs(path)
  await reload()  // with what the server's plugins let go of (pins)
  if (trashed && !opts.quiet) {
    notice(`Moved ${shownName(path)} to trash`, { action: { label: "Undo", run: async () => {
      let back: string
      try { back = await restoreFile(trashed) } catch (e) { throw new Error(`Couldn't undo: ${(e as Error).message ?? e}`) }
      if (wasOpen) openFile(back)
    } } })
  }
  return trashed ?? null
}

/** Duplicate a file next to it ("Name 1.md"); returns the copy's path. */
export async function copyFile(path: string) {
  const r = await post<{ path: string }>("file/copy", { path })
  await reload()
  return r.path
}

/** Every folder that holds something, and the empty ones too, sorted (for the tree). */
export function folderList(t: FileTree) {
  const set = new Set(t.folders)
  for (const f of [...t.files, ...t.others]) {
    if (inPagesDir(f.path)) continue // (the app's pages folder isn't one of the user's)
    const parts = f.path.split("/")
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join("/"))
  }
  return [...set].sort()
}

/** A name for a file or folder that isn't taken in its folder ("Untitled", "Untitled 2"...). */
export function freeName(t: FileTree, folder: string, base: string, ext = ".md") {
  const taken = new Set([...t.files, ...t.others].map((f) => f.path.toLowerCase()).concat(t.folders.map((f) => (f + ext).toLowerCase())))
  const at = (n: string) => joinPath(folder, n + ext).toLowerCase()
  if (!taken.has(at(base))) return base
  let n = 2
  while (taken.has(at(`${base} ${n}`))) n++
  return `${base} ${n}`
}

