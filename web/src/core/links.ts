// Wikilinks and backlinks: every file is linked by its name and `aliases`; plugins add names (a first
// name) and targets that aren't files.
import type { Store } from "@/core/data"
import { splitAnchor, tagName } from "../../../core/sections.ts"
import { openAt } from "@/core/anchors"
import { runCommandId } from "@/core/commands"
import { detailPath } from "@/core/define"
import { cleanName, createFile, fileOf, folderOf, stem, type VaultFile } from "@/core/files"
import { openDetail } from "@/core/nav"
import { newNoteFolder } from "@/core/conventions"
import { notify } from "@/core/notify"
import { active, type LinkTarget } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import { WIKI_LINK } from "@/core/markdown"

export type Target = LinkTarget

export const WIKI = new RegExp(WIKI_LINK, "g")

/** Markdown to plain text, for previews and search snippets: no marks, code fences, rules or table pipes. */
export function plainText(md: string) {
  return md
    .replace(/^\s*(```|~~~)[\s\S]*?^\s*\1.*$/gm, " ")
    .replace(new RegExp(`!?${WIKI_LINK}`, "g"), (_, t: string, a?: string) => (a ?? (t.split("#")[0] || t.split("#").pop()!)).trim())
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, "")
    .replace(/^[ \t]*\|?([ \t]*:?-+:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*$/gm, "")
    .replace(/^[ \t]*\|(.*?)\|?[ \t]*$/gm, (_, row: string) => row.split("|").map((c) => c.trim()).join(" "))
    .replace(/^[ \t]*(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(\[[ xX]\][ \t]+)?|\d+[.)](?=[ \t]|$)[ \t]*)/gm, "")
    .replace(/(\*\*|__|\*|~~|==|`)/g, "")
    .replace(/<\/?[a-z][^>\n]*>/gi, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
}

/** Markdown as one line of plain text: a preview in a row, a card or a search result. */
export const snippet = (md: string) => plainText(md).replace(/\s+/g, " ").trim()

/** A #tag clicked: the files that have it (the plugin that draws `tag` details: Tags), else the quick switcher. */
export function openTag(tag: string) {
  const { disabled, order } = getPrefs()
  if (active(disabled, order).some((p) => p.details?.tag)) return openDetail(detailPath("tag", tagName(tag)))
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
  const hit = fileOf(s, rel) ?? fileOf(s, `${rel}.md`) ? rel : p.replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "")
  return `${hit.replace(/\.md$/i, "")}${anchor ? `#${anchor}` : ""}`
}

/** A plugin that's on takes this web link (the Web viewer opens it in a tab): whether one did. */
function takeWebLink(url: string, mod: boolean) {
  const { disabled, order } = getPrefs()
  for (const p of active(disabled, order)) {
    try { if (p.webLink?.(url, { mod })) return true } catch { /* a plugin failing leaves the link to the browser */ }
  }
  return false
}

/** A plugin that's on takes this link of another app's scheme (`<app>://`): whether one did. */
export function takeSchemeLink(url: string, mod = false) {
  const { disabled, order } = getPrefs()
  for (const p of active(disabled, order)) {
    try { if (p.schemeLink?.(url, { mod })) return true } catch (e) { console.error(e) }
  }
  return false
}
const OTHER_SCHEME = /^(?!https?:|mailto:|tel:|javascript:|data:|blob:|file:|vaultite:)[a-z][a-z0-9+.-]*:/i

/** Open a web link (http, https): a plugin's way if one takes it (`webLink`: the desktop app's Web viewer), else the
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
 *  A click is the user running it, as from the palette (the sandbox's Start here opens Claude Code this way). */
const COMMAND_LINK = /^vaultite:\/\/command\/([\w:.-]+)$/i

/** Follow a link clicked in drawn Markdown: a file (at its heading or ^block), a detail,
 *  a #tag's files, a command link; a [[link]] to nothing yet makes that note where new notes go. */
export async function followLink(s: Store, link: { wiki?: string; url?: string; tag?: string }, newTab: boolean, from?: string) {
  if (link.tag) return openTag(link.tag)
  let wiki = link.wiki ?? ""
  if (link.url) {
    const cmd = COMMAND_LINK.exec(link.url)
    if (cmd) { if (!runCommandId(cmd[1])) notify("That isn't available here"); return }
    if (/^https?:/i.test(link.url)) return openWebLink(link.url, newTab)
    if (/^mailto:/i.test(link.url)) { window.open(link.url, "_blank", "noopener,noreferrer"); return }
    if (/^[a-z][a-z0-9+.-]*:/i.test(link.url)) { takeSchemeLink(link.url, newTab); return }
    wiki = mdTarget(s, link.url, from)
  }
  const [name, anchor] = splitAnchor(wiki)
  if (!name) { if (from && anchor) openAt(from, anchor); return }
  const t = resolver(s)(name)
  if (t?.file) return openAt(t.file, anchor, { newTab })
  if (t?.detail) return openDetail(t.detail)
  const clean = cleanName(name)
  if (!clean) return
  const f = await createFile(newNoteFolder(s, from), clean)
  openAt(f.path, "", { newTab })
}

/** A file: by its name (a page's with or without its extension, `[[Report.html]]`), path, title and aliases. */
const fileTarget = (f: VaultFile): Target => ({
  kind: "file", id: f.path.replace(/\.md$/i, ""), title: stem(f.path), detail: "", file: f.path,
  names: [stem(f.path), f.path.replace(/\.md$/i, ""), f.path.split("/").pop()!, f.title, ...f.aliases], ...(f.archived ? { archived: true } : {}),
})
/** Any other file (an image, a PDF), linked by its name with its extension. */
const otherTarget = (path: string): Target => ({
  kind: "file", id: path, title: path.split("/").pop()!, detail: "", file: path, names: [path.split("/").pop()!, path],
})

type Resolve = (t: string) => Target | null
const cache = new WeakMap<Store, Resolve>()
// The last resolver and its targets: a store with the same targets gets the same resolver, so what's memoized on it
// (query tables' links, the editor's) stays.
let made: { targets: Target[]; fn: Resolve } | null = null
const sameList = (a?: string[], b?: string[]) => a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]))
const sameTarget = (a: Target, b: Target) => a === b || (a.kind === b.kind && a.id === b.id && a.title === b.title &&
  a.detail === b.detail && a.file === b.file && sameList(a.names, b.names) && sameList(a.weak, b.weak) && !a.archived === !b.archived)

/** Resolve a wikilink target: plugins' exact names, then file names, paths and aliases, then weak names only one target
 *  has. Archived targets come after all others, like the server's (core/links.ts). */
export function resolver(s: Store): Resolve {
  const hit = cache.get(s)
  if (hit) return hit
  const { disabled, order } = getPrefs()
  const targets: Target[] = []
  for (const p of active(disabled, order)) {
    try { targets.push(...(p.links?.(s) ?? [])) } catch { /* a plugin's links failing must not break the rest */ }
  }
  for (const f of s.files?.files ?? []) targets.push(fileTarget(f))
  for (const o of s.files?.others ?? []) if (!o.path.split("/").some((p) => p.startsWith("."))) targets.push(otherTarget(o.path))
  // A plugin's target of an archived file is archived too.
  const rows = new Map((s.files?.files ?? []).map((f) => [f.path.replace(/\.md$/i, ""), f]))
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i], row = rows.get(t.file ? t.file.replace(/\.md$/i, "") : t.id)
    if (!t.archived && row?.archived) targets[i] = { ...t, archived: true }
  }
  const was = made
  if (was && was.targets.length === targets.length && targets.every((t, i) => sameTarget(t, was.targets[i]))) {
    cache.set(s, was.fn)
    return was.fn
  }
  const files = new Map((s.files?.files ?? []).map((f) => [f.path.replace(/\.md$/i, ""), f.path]))
  const strong = new Map<string, Target>()
  const weak = new Map<string, Target | null>(), weakArchived = new Map<string, Target | null>()
  for (const t of [...targets.filter((x) => !x.archived), ...targets.filter((x) => x.archived)]) {
    const withFile = t.file || !files.has(t.id) ? t : { ...t, file: files.get(t.id) }
    for (const n of t.names) { const k = n.trim().toLowerCase(); if (k && !strong.has(k)) strong.set(k, withFile) }
    const into = t.archived ? weakArchived : weak
    for (const n of t.weak ?? []) { const k = n.trim().toLowerCase(); into.set(k, into.has(k) ? null : withFile) }
  }
  const fn = (target: string): Target | null => {
    const k = target.split("#")[0].trim().toLowerCase()
    const hit = strong.get(k) ?? strong.get(k.replace(/\.md$/, "")) ?? (weak.has(k) ? weak.get(k) : weakArchived.get(k))
    if (hit !== undefined) return hit
    // A path that isn't there as written (a Markdown link relative to a folder): the file by its name.
    const last = k.includes("/") ? k.slice(k.lastIndexOf("/") + 1) : ""
    return (last && (strong.get(last) ?? strong.get(last.replace(/\.md$/, "")))) || null
  }
  cache.set(s, fn)
  made = { targets, fn }
  return fn
}

/** Files that link to something (a note, a person), each with the line the link sits on. */
export function mentions(s: Store, is: (t: Target) => boolean, except?: string) {
  const resolve = resolver(s)
  const out: { file: VaultFile; title: string; context: string }[] = []
  for (const f of s.files?.files ?? []) {
    if (f.path === except) continue
    const hit = f.links.find(([t]) => { const r = resolve(t); return !!r && is(r) })
    if (hit) out.push({ file: f, title: stem(f.path), context: plainText(hit[1]).trim() })
  }
  return out.sort((a, b) => b.file.mtime - a.file.mtime)
}
/** Backlinks to a file: the files that link to it. */
export const backlinks = (s: Store, path: string) => mentions(s, (t) => t.file === path, path)
