// Wikilinks and backlinks: every file is linked by its name, path and `aliases`; plugins add names (a person's) and
// targets that aren't files.
import { FilePlus } from "lucide-react"
import type { Store } from "@/core/data"
import { type Choice, choose } from "@/components/Chooser"
import { desktop } from "@/core/desktop"
import { splitAnchor, tagName } from "../../../core/sections.ts"
import { openAt } from "@/core/anchors"
import { runCommandId, runCommandLink } from "@/core/commands"
import { detailPath } from "@/core/define"
import { cleanName, createNamed, folderOf, inVault, openView, stem, type VaultFile } from "@/core/files"
import { openDetail } from "@/core/nav"
import { newNoteFolder } from "@/core/conventions"
import { notify } from "@/core/notify"
import { active, type LinkTarget } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import { WIKI_LINK } from "@/core/markdown"
import { dropHighlightEmoji } from "@/core/highlights"
import { type LinkEntry, linkIndex } from "../../../core/links.ts"

export type Target = LinkTarget

export const WIKI = new RegExp(WIKI_LINK, "g")

/** Markdown to plain text, for previews and search snippets: no marks, code fences, display math, callouts' types, rules or table pipes. */
export function plainText(md: string) {
  return dropHighlightEmoji(md)
    .replace(/^\s*(```|~~~)[\s\S]*?^\s*\1.*$/gm, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(new RegExp(`!?${WIKI_LINK}`, "g"), (_, t: string, a?: string) => (a ?? (t.split("#")[0] || t.split("#").pop()!)).trim())
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, "")
    .replace(/^[ \t]*\|?([ \t]*:?-+:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*$/gm, "")
    .replace(/^[ \t]*\|(.*?)\|?[ \t]*$/gm, (_, row: string) => row.split("|").map((c) => c.trim()).join(" "))
    .replace(/^[ \t]*(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(\[[ xX]\][ \t]+)?|\d+[.)](?=[ \t]|$)[ \t]*)/gm, "")
    .replace(/^[ \t]*\[![^\]\n]+\][+-]?[ \t]*/gm, "")
    .replace(/(\*\*|__|\*|~~|==|`)/g, "")
    .replace(/<\/?[a-z][^>\n]*>/gi, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
}

/** Markdown as one line of plain text: a preview in a row, a card or a search result. */
export const snippet = (md: string) => plainText(md).replace(/\s+/g, " ").trim()

/** A #tag clicked: the files that have it (the plugin that draws `tag` details: Tags), else a search for it, as in
 *  Obsidian. */
export function openTag(tag: string) {
  const { disabled } = getPrefs()
  const on = active(disabled)
  if (on.some((p) => p.details?.tag)) return openDetail(detailPath("tag", tagName(tag)))
  if (on.some((p) => p.views?.search)) return openView(`search/tag:#${tagName(tag)}`)
  runCommandId("switcher:open")
}

/** A Markdown link's target as a wikilink's (`Some%20Note.md#Heading` -> `Some Note#Heading`); relative to `from`'s
 *  folder when such a file is there. */
function mdTarget(s: Store, href: string, from?: string) {
  let t = href
  try { t = decodeURIComponent(href) } catch { /* not encoded */ }
  const [p, anchor] = splitAnchor(t)
  if (!p) return t
  const parts: string[] = from ? folderOf(from).split("/").filter(Boolean) : []
  for (const x of p.split("/")) { if (x === "..") parts.pop(); else if (x && x !== ".") parts.push(x) }
  const rel = parts.join("/")
  const hit = inVault(s, rel) || inVault(s, `${rel}.md`) ? rel : p.replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "")
  return `${hit.replace(/\.md$/i, "")}${anchor ? `#${anchor}` : ""}`
}

/** A plugin that's on takes this web link (the Browser opens it in a tab): whether one did. */
function takeWebLink(url: string, mod: boolean) {
  const { disabled } = getPrefs()
  for (const p of active(disabled)) {
    try { if (p.webLink?.(url, { mod })) return true } catch { /* a plugin failing leaves the link to the browser */ }
  }
  return false
}

/** A plugin that's on takes this link of another app's scheme (`<app>://`): whether one did. */
export function takeSchemeLink(url: string, mod = false) {
  const { disabled } = getPrefs()
  for (const p of active(disabled)) {
    try { if (p.schemeLink?.(url, { mod })) return true } catch (e) { console.error(e) }
  }
  return false
}
const OTHER_SCHEME = /^(?!https?:|mailto:|tel:|javascript:|data:|blob:|file:|vaultite:)[a-z][a-z0-9+.-]*:/i

/** Open a web link (http, https): a plugin's way if one takes it (`webLink`: the desktop app's Browser), else the
 *  system browser (a new browser tab on the web). `mod`: ⌘-clicked. */
export function openWebLink(url: string, mod = false) {
  if (!takeWebLink(url, mod)) window.open(url, "_blank", "noopener,noreferrer")
}

// Links drawn as <a href> anywhere in the app go the same way: a plain click (and ⌘-click) on a web link or another
// app's (obsidian://) is offered to the plugins first; a middle click, or one no plugin takes, does what it did.
if (typeof window !== "undefined") {
  addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.shiftKey || e.altKey) return
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
    if (!a || a.hasAttribute("download")) return
    if (OTHER_SCHEME.test(a.href)) { if (takeSchemeLink(a.href, e.metaKey || e.ctrlKey)) e.preventDefault(); return }
    if (!/^https?:/i.test(a.href) || a.origin === location.origin) return
    if (takeWebLink(a.href, e.metaKey || e.ctrlKey)) e.preventDefault()
  })
}

/** A Markdown link that runs one of the app's commands: `[Open Claude Code](vaultite://command/terminal:claude-split)`.
 *  One that does more than open something asks first (runCommandLink): the note may not be the user's. */
const COMMAND_LINK = /^vaultite:\/\/command\/([\w:.-]+)$/i
/** Addresses that run code where they open: never followed. */
const UNSAFE = /^(javascript|data|vbscript|blob):/i

/** Open a link of any other scheme (mailto:, tel:, obsidian://, zotero://, file://) the system's way: a plugin's if one
 *  takes it, else the app it belongs to (the desktop app opens file:// with the Mac's app for it). */
function openOtherLink(url: string, mod = false) {
  if (UNSAFE.test(url)) return notify("That link can't be opened")
  if (takeSchemeLink(url, mod)) return
  if (/^file:/i.test(url) && !desktop) return notify("File links open in the desktop app")
  window.open(url, "_blank", "noopener,noreferrer")
}

/** Follow a link clicked in drawn Markdown (a file, heading or ^block, a detail, a #tag, a command, a web or app
 *  link). A [[link]] to nothing makes that note, or asks which when another file may be what it meant. */
export async function followLink(s: Store, link: { wiki?: string; url?: string; tag?: string }, newTab: boolean, from?: string) {
  if (link.tag) return openTag(link.tag)
  let wiki = link.wiki ?? ""
  if (link.url) {
    const cmd = COMMAND_LINK.exec(link.url)
    if (cmd) { if (!runCommandLink(cmd[1])) notify("That isn't available here"); return }
    if (/^https?:/i.test(link.url)) return openWebLink(link.url, newTab)
    if (/^[a-z][a-z0-9+.-]*:/i.test(link.url)) return openOtherLink(link.url, newTab)
    wiki = mdTarget(s, link.url, from)
  }
  const [name, anchor] = splitAnchor(wiki)
  if (!name) { if (from && anchor) openAt(from, anchor); return }
  const open = (t: Target) => (t.file ? openAt(t.file, anchor, { newTab }) : t.detail ? openDetail(t.detail) : undefined)
  const t = resolver(s)(name, from)
  if (t) return open(t)
  // (a file of another kind, `[pdf](a.pdf)`, isn't made as a note)
  const clean = /\.(?!md$)[A-Za-z][A-Za-z0-9]{0,9}$/i.test(name) ? "" : cleanName(name)
  const create = async () => { const f = await createNamed(newNoteFolder(s, from), name); if (f) openAt(f.path, "", { newTab }) }
  const maybe = didYouMean(s, name, from)
  if (!maybe.length) return clean ? create() : notify(`No file ${name} in the vault`)
  type Pick = Choice & { to?: Target }
  const items: Pick[] = maybe.map((m, i) => ({ id: String(i), label: m.file ? stem(m.file) : m.title, detail: m.file ? folderOf(m.file) || undefined : undefined, to: m }))
  if (clean) items.push({ id: "new", label: `Create “${clean}”`, icon: FilePlus })
  choose<Pick>({ title: "Did you mean", heading: `No file is called “${name}”. Did you mean:`, placeholder: "Open or create…", items,
    onPick: (c) => { if (c.to) open(c.to); else void create() } })
}

/** Where a link in drawn Markdown goes, without going: a file (and the heading or block in it), a plugin's detail, or a
 *  web address; null for what isn't a place (a #tag, a command, another app's link, a note that isn't there). */
export function linkPlace(s: Store, link: { wiki?: string; url?: string }, from?: string): { file?: string; anchor?: string; detail?: string; url?: string } | null {
  let wiki = link.wiki ?? ""
  if (link.url) {
    if (/^https?:/i.test(link.url)) return { url: link.url }
    if (/^[a-z][a-z0-9+.-]*:/i.test(link.url)) return null
    wiki = mdTarget(s, link.url, from)
  }
  const [name, anchor] = splitAnchor(wiki)
  if (!name) return from && anchor ? { file: from, anchor } : null
  const t = resolver(s)(name, from)
  return t?.file ? { file: t.file, anchor } : t?.detail ? { detail: t.detail } : null
}

/** A file: linked by its name or path (a page's with or without its extension, `[[Report.html]]`) and aliases. */
const fileTarget = (f: VaultFile): Target => ({
  kind: "file", id: f.path.replace(/\.md$/i, ""), title: stem(f.path), detail: "", file: f.path,
  names: f.aliases, ...(f.archived ? { archived: true } : {}),
})
/** Any other file (an image, a PDF), linked by its name or path with its extension. */
const otherTarget = (path: string): Target => ({ kind: "file", id: path, title: path.split("/").pop()!, detail: "", file: path, names: [] })

type Resolve = (t: string, from?: string) => Target | null
type Index = { resolve: Resolve; suggest: (t: string, from?: string) => Target[] }
const cache = new WeakMap<Store, Index>()
// The last index and its targets: a store with the same targets gets the same resolver, so what's memoized on it
// (query tables' links, the editor's) stays.
let made: { targets: Target[]; index: Index } | null = null
const sameList = (a?: string[], b?: string[]) => a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]))
const sameTarget = (a: Target, b: Target) => a === b || (a.kind === b.kind && a.id === b.id && a.title === b.title &&
  a.detail === b.detail && a.file === b.file && sameList(a.names, b.names) && !a.archived === !b.archived)

/** The vault's link index: files and plugins' targets (a person, a book), resolved as Obsidian does (core/links.ts). A
 *  plugin's target of a file stands for that file. */
function linkIndexOf(s: Store): Index {
  const hit = cache.get(s)
  if (hit) return hit
  const { disabled } = getPrefs()
  const targets: Target[] = []
  for (const p of active(disabled)) {
    try { targets.push(...(p.links?.(s) ?? [])) } catch { /* a plugin's links failing must not break the rest */ }
  }
  const rows = new Map((s.files?.files ?? []).map((f) => [f.path.replace(/\.md$/i, ""), f]))
  // A plugin's target of a file is that file's, archived with it.
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i], row = rows.get(t.file ? t.file.replace(/\.md$/i, "") : t.id)
    if (row && (!t.file || (row.archived && !t.archived))) targets[i] = { ...t, file: row.path, ...(row.archived ? { archived: true } : {}) }
  }
  for (const f of s.files?.files ?? []) targets.push(fileTarget(f))
  for (const o of s.files?.others ?? []) if (!o.path.split("/").some((p) => p.startsWith("."))) targets.push(otherTarget(o.path))
  const was = made
  if (was && was.targets.length === targets.length && targets.every((t, i) => sameTarget(t, was.targets[i]))) {
    cache.set(s, was.index)
    return was.index
  }
  // One entry per file (its first target: a plugin's before the plain file's), with every target's names.
  const byFile = new Map<string, LinkEntry<Target>>(), entries: LinkEntry<Target>[] = []
  for (const t of targets) {
    const had = t.file ? byFile.get(t.file) : undefined
    if (had) { had.labels!.push(...t.names); continue }
    const e: LinkEntry<Target> = { value: t, labels: [...t.names], archived: t.archived, ...(t.file ? { path: t.file, bare: !!rows.get(t.file.replace(/\.md$/i, "")) } : {}) }
    if (t.file) byFile.set(t.file, e)
    entries.push(e)
  }
  const index = linkIndex(entries)
  cache.set(s, index)
  made = { targets, index }
  return index
}

/** Resolve a wikilink target written in `from` (Obsidian's rules: a path, the closest file of that name, then aliases
 *  and plugins' names), or null. */
export const resolver = (s: Store): Resolve => linkIndexOf(s).resolve

/** How a [[link]] in `from` writes `path`: the shortest end of its path that finds it (its name when that's enough, as
 *  Obsidian's "shortest path when possible"). A note or page without its extension. */
export function shortestLink(s: Store, path: string, from?: string): string {
  const resolve = resolver(s)
  const parts = path.split("/"), named = stem(path)
  const last = named !== parts[parts.length - 1] ? named : parts[parts.length - 1]
  for (let i = parts.length - 1; i >= 0; i--) {
    const c = [...parts.slice(i, -1), last].join("/")
    if (resolve(c, from)?.file === path) return c
  }
  return [...parts.slice(0, -1), last].join("/")
}

/** What a link to nothing may have meant: a name that starts with it ("Alice" for Alice Park), the file of that name in
 *  another folder. */
const didYouMean = (s: Store, target: string, from?: string) => linkIndexOf(s).suggest(target, from)

/** Files that link to something (a note, a person), newest first. */
export function mentions(s: Store, is: (t: Target) => boolean, except?: string) {
  const resolve = resolver(s)
  const out: { file: VaultFile; title: string }[] = []
  for (const f of s.files?.files ?? []) {
    if (f.path === except) continue
    if (f.links.some((t) => { const r = resolve(t, f.path); return !!r && is(r) })) out.push({ file: f, title: stem(f.path) })
  }
  return out.sort((a, b) => b.file.mtime - a.file.mtime)
}
/** Backlinks to a file: the files that link to it. */
export const backlinks = (s: Store, path: string) => mentions(s, (t) => t.file === path, path)
