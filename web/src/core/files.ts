import { refuse } from "@/core/animation"
import { getStore, reload, type Store } from "@/core/data"
import { del, get, post } from "@/core/http"
import { isEmbeddable, pageExt } from "@/core/formats"
import { afterSheets, closeDetailOf, retargetDetail, route, setFileOpener } from "@/core/nav"
import { runCommandAsked } from "@/core/commands"
import { onUiAction, onVaultChange, onVaultMove, touches } from "@/core/live"
import { isMedia, kindOf } from "@/core/filekinds"
import { movePlaces } from "@/core/viewstate"
import { homeFolder, inArchive, isHiddenPath } from "../../../core/fileprops.ts"
import { dump } from "../../../core/yaml.ts"
import { notify as notice } from "@/core/notify"
import { allPanes, tabPath, type Pane } from "../../../core/layout.ts"
import { isDesktop } from "@/core/platform"
import { guestEdits, share } from "@/core/share"
import { clickOpening, closePane, setClickOpens, dropTabs, findOpen, go, guarded, here, keepsTab, openInPane, openTab, panes, activePane, retarget, selectPane, setFocusedPane, targetOf } from "@/core/workspace"
import { openInSplit } from "@/core/splits"
import { fileAt } from "@/core/pages"
import { resolver } from "@/core/links"
import { filesMoved, resolveView, webContainers } from "@/core/plugins"
import { paneNamed } from "@/core/tabgroups"

export type VaultFile = {
  /** type: the core's (its kind's when a kind owns it, else its frontmatter's; core/fileprops.ts); kind: that kind's
   *  collection ("people"), if any. */
  path: string; type: string | null; kind: string | null; title: string; aliases: string[]
  /** Modified and created (ms). */
  mtime: number; ctime: number; size: number
  problems: number
  /** Its ```block-<name> fences: [name, options text]. */
  blocks: [string, string][]
  /** Its tags: frontmatter `tags` and inline #tags (core/sections.ts), when it has any. */
  tags?: string[]
  /** From its frontmatter, when it says: how it shows when pinned (a dashboard's icon and colour, the plugin it's from). */
  icon?: string; tint?: string; plugin?: string
  /** `container:` in its frontmatter: the Browser's container (an id or a name) the web links followed from it open in. */
  container?: string
  /** `archived: true` in its frontmatter (core/fileprops.ts): dimmed in the tree, left out of lists. */
  archived?: boolean
  /** Excluded files (the File explorer's setting): out of search and the graph, last in the quick switcher. */
  excluded?: boolean
}
export type FileTree = { files: VaultFile[]; others: { path: string; mtime: number; ctime: number; size: number; excluded?: boolean }[]; folders: string[] }
export type FileText = { path: string; text: string; mtime: number; size?: number; kind: string | null; problems: string[] }

/** A file's name as the app shows it: without .md, or the extension of a page a plugin draws (an artifact's .html, a
 *  table's .csv: named like notes, FileFormat.page); other files keep theirs. */
export function stem(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1)
  if (/\.md$/i.test(name)) return name.slice(0, -3)
  const ext = pageExt(name)
  return ext ? name.slice(0, -ext.length - 1) : name
}
export const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")))
/** The files a paste brings, only when it has no text of its own, as Obsidian takes it: Excel or Word cells come as
 *  text and a picture of them. (A file copied in Finder brings its name as text, which isn't its own.) */
export function pastedFiles(d: DataTransfer | null | undefined): File[] {
  const files = [...(d?.files ?? [])]
  const text = d?.getData("text/plain").trim() ?? ""
  if (!files.length || !text) return files
  const names = new Set(files.map((f) => f.name))
  return text.split(/\r?\n/).every((l) => names.has(l.trim().split("/").pop()!)) ? files : []
}
export const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name)
const UNNAMEABLE = /[*"\\<>:|?#^[\]]/g
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i
export const cleanName = (typed: string) => typed.split("/").map((p) => p.replaceAll(":", " -").replace(UNNAMEABLE, " ").replace(/\s+/g, " ")
  .replace(/[\s.]+$/, "").trim()).filter((p) => p && p !== "." && p !== "..")
  .map((p) => (WINDOWS_DEVICE.test(p) ? `${p}_` : p)).join("/")
export function nameProblem(typed: string, from: string, to: string): string | null {
  const bad = [...new Set(typed.match(/[/*"\\<>:|?#^[\]]/g) ?? [])]
  if (bad.length) return `A file name can't have ${bad.join(" ")}`
  const name = to.slice(to.lastIndexOf("/") + 1)
  if (!cleanName(typed) || to === from) return null
  if (name.startsWith(".")) return "A name can't start with a dot: it would be hidden"
  if (new TextEncoder().encode(name).length > 255) return "That name is too long"
  // A Mac's file system ignores case: a name taken in any case is taken.
  const low = to.toLowerCase(), t = getStore()?.files
  const taken = low !== from.toLowerCase() && !!t && ([...t.files, ...t.others].some((f) => f.path.toLowerCase() === low) || t.folders.some((f) => f.toLowerCase() === low))
  return taken ? `“${cleanName(typed)}” is already taken in this folder` : null
}
export function refuseName(why: string, field?: Element | null) {
  notice(why, { kind: "error", id: "bad-name" })
  refuse(field)
}
/** Where new files of a kind (its collection: "notes", "days") go: the folder its settings show (the server's: one set,
 *  else where most of its files are), else `fallback`. Folders are the user's (core/fileprops.ts). */
export const homeOf = (s: Store | null | undefined, kind: string, fallback: string) =>
  s?.filing?.homes.find((h) => h.key === kind)?.folder ??
  homeFolder((s?.files.files ?? []).filter((f) => f.kind === kind).map((f) => f.path), fallback.split("/").pop(), kind === "logs") ?? fallback
export const fileOf = (s: Store, path: string) => fileAt(s.files.files, path)
export const inVault = (s: Store, path: string) => !!fileAt(s.files.files, path) || !!fileAt(s.files.others, path)
export const isMd = (path: string) => /\.md$/i.test(path)
export const isJson = (path: string) => /\.json$/i.test(path)
export const isMediaEmbed = (path: string) => /\.(pdf|mp3|m4a|aac|wav|ogg|oga|opus|flac|mp4|m4v|mov|webm|ogv)$/i.test(path)
export function findEmbed(s: Store, target: string, from?: string): string | null {
  const hash = target.indexOf("#")
  if (hash > 0) { const hit = findEmbed(s, target.slice(0, hash), from); return hit && !isMd(hit) ? hit : null }
  const hit = resolver(s)(target, from)?.file
  if (hit) return isEmbeddable(hit) ? hit : null
  const low = target.trim().replace(/^\/+/, "").toLowerCase()
  return [...s.files.files, ...s.files.others].map((f) => f.path).find((p) => isEmbeddable(p) && (p.toLowerCase() === low || p.toLowerCase() === `${low}.md`)) ?? null
}
/** Notes, JSON and pages plugins draw (artifacts, tables): the files that can be pages (pinned). The rest (code,
 *  images, PDFs...) open too. */
export const isDoc = (path: string) => isMd(path) || isJson(path) || !!pageExt(path)
/** In a dot folder, or a dot file: shown only with hidden files on. Not archive folders: an archived file opens as any. */
export const isHidden = isHiddenPath
export { inArchive }
export const inTrash = (path: string) => path.startsWith(".trash/")
export const isProtected = (path: string) => path === ".vaultite" || path === ".trash" || path === ".vaultite/generated" || path.startsWith(".vaultite/generated/") || !!share
export const isReadOnly = (path: string) => inTrash(path) || path.startsWith(".vaultite/generated/") || !guestEdits()

/** Split a file into its frontmatter block ("---\n...\n---\n", plus the blank line after it, or "") and its body. */
export function splitFm(text: string): { fm: string; body: string } {
  const m = /^---\n(?:[\s\S]*?\n)?---[ \t]*(?:\n|$)\n?/.exec(text)
  return m ? { fm: m[0], body: text.slice(m[0].length) } : { fm: "", body: text }
}
export const joinFm = (fm: string, body: string) => (fm && body && !fm.endsWith("\n") ? `${fm}\n${body}` : fm + body)

const enc = encodeURIComponent

/** Open a file in a tab (go), on phones too; Back returns. From a sheet on a phone the sheets close first, so the file
 *  isn't under them. `pane`: in that pane, not the focused one. */
export function openFile(path: string, opts: { newTab?: boolean; pane?: string } = {}) {
  if (!isDesktop() && route().detail) return afterSheets(() => go(`file:${path}`, opts.newTab))
  if (opts.pane && isDesktop()) setFocusedPane(opts.pane)
  go(`file:${path}`, opts.newTab)
}
setFileOpener((path) => openFile(path))

/** A folder's page as a tab's target (the Files plugin's view; "" the vault's top). */
export const folderTarget = (path: string) => (path ? `view:folder/${path}` : "view:folder")
export const pathTarget = (path: string) => { const t = getStore()?.files; return t && isFolder(t, path) ? folderTarget(path) : `file:${path}` }
/** Open a folder's page, as openFile opens a file: in the current tab when it shows a folder, else beside it. */
export function openFolder(path: string, opts: { newTab?: boolean; pane?: string } = {}) {
  const to = folderTarget(path)
  if (!isDesktop() && route().detail) return afterSheets(() => go(to, opts.newTab))
  if (opts.pane && isDesktop()) setFocusedPane(opts.pane)
  go(to, opts.newTab)
}

function openAsked(path: string, split?: "right" | "down" | null, newTab = false, background = false, container?: string | null, into?: string | null) {
  if (/^https?:\/\//i.test(path)) path = `view:web/${path}`
  if (container) path = inContainer(path, container)
  const t = getStore()?.files
  if (t && !path.startsWith("view:") && isFolder(t, path.replace(/^file:/, ""))) path = folderTarget(path.replace(/^file:/, ""))
  const view = path.startsWith("view:")
  const to = view ? path : `file:${path.replace(/^file:/, "")}`
  if (background) return void (findOpen(to) || openTab(to, { background: true }))
  if (!isDesktop()) return view ? afterSheets(() => go(to)) : openFile(to.slice(5))
  const at = into ? paneNamed(into) : null
  if (at && split) { selectPane(at.id); return void openInSplit(to, split === "down" ? "bottom" : "right") }
  if (at) return void openInPane(at.id, to)
  if (split) return openInSplit(to, split === "down" ? "bottom" : "right")
  if (!view) besideKept()
  go(to, newTab)
}
function inContainer(to: string, said: string) {
  if (!to.startsWith("view:web/")) throw new Error("a container is for a web address (https://...)")
  const url = to.slice(9).replace(/^@[a-z0-9]{1,24}\//, ""), k = said.trim().toLowerCase(), list = webContainers()
  if (k === "none") return `view:web/${url}`
  const c = list.find((x) => x.id === k) ?? list.find((x) => x.name.toLowerCase() === k) ?? list.find((x) => x.name.toLowerCase().includes(k) || k.includes(x.name.toLowerCase()))
  if (!c) throw new Error(list.length ? `no container is called ${said}: they're ${list.map((x) => x.name).join(", ")} (or none)` : "this window's browser has no containers")
  return `view:web/@${c.id}/${url}`
}
function besideKept() {
  const kept = (p: Pane) => keepsTab(p.to), cur = activePane()
  const other = cur && kept(cur) ? panes().find((p) => p.id !== cur.id && !kept(p)) : undefined
  if (other) setFocusedPane(other.id)
}
onUiAction((m) => {
  if (m.action === "command" && m.id) return runCommandAsked(m.id)
  if (m.action === "notify" && m.text) {
    const b = m.button
    return void notice(m.text, { kind: m.kind === "error" ? "error" : undefined, action: b ? { label: b.label, run: () => openAsked(b.open) } : undefined })
  }
  if (m.action === "open" && m.path) openAsked(m.path, m.split, !!m.newTab, !!m.background, m.container, m.in)
})

/** Open a plugin's view, shown once: a pane that has it shows it (no two terminal panes fighting over its size), else a
 *  new tab or the pane to the right. `another`: a tab of its own anyway (a blank web page). */
export function openView(to: string, opts: { newTab?: boolean; split?: boolean; focus?: boolean; another?: boolean } = {}) {
  const target = resolveView(to.startsWith("view:") ? to : `view:${to}`)
  if (opts.another) return void openTab(target)
  if (findOpen(target)) {
    const how = clickOpening()
    if (opts.focus === false || (how && !how.front)) return
    setClickOpens(null)
    try { return go(target) } finally { setClickOpens(how) }
  }
  if (opts.split) return openInSplit(target, "right", opts.focus !== false)
  go(target, opts.newTab)
}

/** Whether a view (`terminal/abc`) is open in a pane somewhere. */
export const isViewOpen = (to: string) => !!findOpen(to.startsWith("view:") ? to : `view:${to}`)

/** Close every pane showing a view (`terminal/abc`), as if the user did (its plugin hears it). */
export function closeView(to: string) {
  const target = to.startsWith("view:") ? to : `view:${to}`
  const open = findOpen(target)
  if (open) guarded([open.p], () => { for (let o = findOpen(target); o; o = findOpen(target)) closePane(o.p.id, true) })
}

let fresh: string | null = null
export const markNew = (path: string) => { fresh = path }
export const takeNew = (path: string) => { if (fresh !== path) return false; fresh = null; return true }
/** Open a file just made, in editing with its name ready to type. */
export const openNew = (path: string, opts?: { newTab?: boolean }) => { markNew(path); openFile(path, opts) }

/** A file's text. One read ahead of time (prefetchFile) is taken by the first call for that file. */
export function readFile(path: string) {
  const early = ahead.get(path)
  ahead.delete(path)
  return early?.p ?? get<FileText>(`file?path=${enc(path)}`)
}

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

type Settler = { settle: () => Promise<void>; disk: () => string }
const settlers = new Map<string, Set<Settler>>()
export function onSettle(path: string, settle: () => Promise<void>, disk: () => string) {
  const set = settlers.get(path) ?? new Set(), me = { settle, disk }
  settlers.set(path, set.add(me))
  return () => { set.delete(me); if (!set.size && settlers.get(path) === set) settlers.delete(path) }
}
/** Save what's typed in `path`'s open editors, once a conflict there is settled, before typing in it together: the text
 *  the server has then, as the first editor knows it (undefined: none open; a failed save leaves it behind the typing). */
export async function settleFile(path: string): Promise<string | undefined> {
  const open = [...(settlers.get(path) ?? [])]
  await Promise.all(open.map((s) => s.settle().catch(() => {})))
  return open[0]?.disk()
}

type MergeIn = (base: string | null, text: string, who: string) => Promise<"same" | "merged" | "settled" | "unsaved">
const mergers = new Map<string, MergeIn>()
export function onMergeIn(path: string, fn: MergeIn) {
  mergers.set(path, fn)
  return () => { if (mergers.get(path) === fn) mergers.delete(path) }
}
/** Merge `text`, another device's version of `path` (iCloud's, from `who`), into its open editor from `base` (autosave's
 *  mergeIn), answering once it's saved; "closed" when no editor has the file open. */
export async function mergeIntoFile(path: string, base: string | null, text: string, who: string) {
  const fn = mergers.get(path)
  return fn ? await fn(base, text, who) : "closed" as const
}

let intent = 0
export function openingSoon(path: string | null, now = false) {
  clearTimeout(intent)
  if (path && now) prefetchFile(path)
  else if (path) intent = window.setTimeout(() => prefetchFile(path), 80)
}

function namedNote(el: HTMLElement): string | null {
  const store = getStore()
  if (el.dataset.preview) return /\.md$/i.test(el.dataset.preview) ? el.dataset.preview : null
  const name = (el.dataset.wiki ?? "").split("#")[0].trim()
  const from = el.closest<HTMLElement>("[data-preview-path]")?.dataset.previewPath ?? el.closest<HTMLElement>(".file-view[data-path]")?.dataset.path ?? ""
  const hit = name && store ? resolver(store)(name, from || undefined)?.file : null
  return hit && hit !== from ? hit : null
}

export function watchOpeningSoon() {
  const NAMED = "[data-preview], [data-wiki]"
  let over: Element | null = null
  document.addEventListener("pointerover", (e) => {
    const el = (e.target as Element).closest?.<HTMLElement>(NAMED) ?? null
    if (el === over) return
    over = el
    openingSoon(el && namedNote(el))
  }, { capture: true, passive: true })
  document.addEventListener("pointerdown", (e) => {
    const el = (e.target as Element).closest?.<HTMLElement>(NAMED)
    const path = el && namedNote(el)
    if (path) openingSoon(path, true)
  }, { capture: true, passive: true })
}

export function prefetchShown() {
  const { tab, detail } = route()
  const shown = [targetOf(tab), detail.startsWith("file/") ? targetOf(detail) : ""]
  if (isDesktop()) for (const p of panes()) shown.push(p.to)
  for (const to of new Set(shown)) { const p = tabPath(to); if (p) prefetchFile(p) }
}

export async function createFile(folder: string, name = "Untitled", text = "") {
  const f = await post<FileText>("file", { path: joinPath(folder, `${name}.md`), text, unique: true })
  await reload()
  return f
}

/** A note named as typed (a link's target, the switcher's query): with "/" from the vault's top, else in `folder`.
 *  Bad characters become spaces and the typed name is its alias, so a link finds it. Null when no name is left. */
export async function createNamed(folder: string, typed: string, text = "") {
  const name = cleanName(typed)
  if (!name) return null
  const asTyped = typed.split("/").pop()!.trim()
  const fm = asTyped !== name.split("/").pop() ? `---\n${dump({ aliases: [asTyped] })}\n---\n` : ""
  return createFile(typed.includes("/") ? "" : folder, name, joinFm(fm, text))
}

export async function createFolder(parent: string, name = "New folder") {
  const r = await post<{ path: string }>("folder", { path: joinPath(parent, name), unique: true })
  await reload()
  return r.path
}

/** A file or folder as the app names it: a note without .md, other files with their extension. */
export const shownName = (path: string) => (isDoc(path) ? stem(path) : path.split("/").pop()!)

const moves: { n: number; from: string; to: string }[] = []
let moveCount = 0
function followMove(from: string, to: string | null) {
  if (from === to) return
  if (to === null) { dropTabs(from); closeDetailOf(from) }
  else {
    moves.push({ n: ++moveCount, from, to })
    if (moves.length > 100) moves.shift()
    movePlaces(from, to) // before the tabs follow: they look for their place under the new path
    retarget(from, to)
    retargetDetail(from, to)
  }
  filesMoved(from, to)
}
onVaultMove(followMove)
export const moveMark = () => moveCount
export function whereNow(path: string, mark: number) {
  let p = path
  for (const { n, from, to } of moves) {
    if (n <= mark) continue
    if (p === from) p = to
    else if (p.startsWith(`${from}/`)) p = to + p.slice(from.length)
  }
  return p
}

export const gone = (e: unknown) => /^Error: no file /.test(String(e))

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

const deleting = new Set<string>()
export const deletedHere = (path: string) => [...deleting].some((d) => path === d || path.startsWith(`${d}/`))

/** Move a file or folder to the trash (in the trash: delete it for good; .trash itself: empty it), with Undo unless
 *  `quiet`. Returns where it went in .trash (null when deleted for good). */
export async function deleteFile(path: string, opts: { quiet?: boolean } = {}): Promise<string | null> {
  const wasOpen = allPanes(here()).some((p) => p.to === `file:${path}`)
  deleting.add(path)
  setTimeout(() => deleting.delete(path), 10_000)
  const { trashed } = await del<{ trashed?: string }>(`file?path=${enc(path)}`)
  dropTabs(path)
  await reload()
  if (trashed && !opts.quiet) {
    notice(`Moved ${shownName(path)} to trash`, { action: { label: "Undo", run: async () => {
      let back: string
      try { back = await restoreFile(trashed) } catch (e) { throw new Error(`Couldn't undo: ${(e as Error).message ?? e}`) }
      if (wasOpen) openFile(back)
    } } })
  }
  return trashed ?? null
}

export async function copyFile(path: string) {
  const r = await post<{ path: string }>("file/copy", { path })
  await reload()
  return r.path
}

export function folderList(t: FileTree) {
  const set = new Set<string>()
  const add = (dir: string) => { for (let d = dir; d && !set.has(d); d = d.slice(0, Math.max(0, d.lastIndexOf("/")))) set.add(d) }
  for (const f of t.folders) add(f)
  for (const f of t.files) add(f.path.slice(0, Math.max(0, f.path.lastIndexOf("/"))))
  for (const f of t.others) add(f.path.slice(0, Math.max(0, f.path.lastIndexOf("/"))))
  return [...set].sort()
}

const folderSets = new WeakMap<FileTree, Set<string>>()
export function isFolder(t: FileTree, path: string) {
  let set = folderSets.get(t)
  if (!set) folderSets.set(t, (set = new Set(folderList(t))))
  return set.has(path)
}

/** A name for a file or folder that isn't taken in its folder ("Untitled", "Untitled 1"...: Obsidian's rule). */
export function freeName(t: FileTree, folder: string, base: string, ext = ".md") {
  const taken = new Set([...t.files, ...t.others].map((f) => f.path.toLowerCase()).concat(t.folders.map((f) => (f + ext).toLowerCase())))
  const at = (n: string) => joinPath(folder, n + ext).toLowerCase()
  if (!taken.has(at(base))) return base
  let n = 1
  while (taken.has(at(`${base} ${n}`))) n++
  return `${base} ${n}`
}

