import { FilePlus } from "lucide-react"
import type { Store } from "@/core/data"
import { type Choice, choose } from "@/components/Chooser"
import { confirmDialog } from "@/components/ConfirmDialog"
import { desktop } from "@/core/desktop"
import { isMac } from "@/core/platform"
import { go, setClickOpens, clickOpening, targetOf } from "@/core/workspace"
import { splitAnchor, tagName } from "../../../core/sections.ts"
import { openAt } from "@/core/anchors"
import { runCommandId, runCommandLink } from "@/core/commands"
import { detailPath } from "@/core/define"
import { cleanName, createNamed, fileOf, folderOf, inVault, openView, stem, type VaultFile } from "@/core/files"
import { openDetail } from "@/core/nav"
import { linkedNote, newNoteFolder } from "@/core/conventions"
import { notify, notifyError } from "@/core/notify"
import { active, type LinkTarget } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import { WIKI_LINK } from "@/core/markdown"
import { type LinkEntry, linkIndex } from "../../../core/links.ts"

export type Target = LinkTarget

export const WIKI = new RegExp(WIKI_LINK, "g")

/** A #tag clicked: the files that have it (the plugin that draws `tag` details: Tags), else a search for it, as in
 *  Obsidian. */
export function openTag(tag: string) {
  const { disabled } = getPrefs()
  const on = active(disabled)
  if (on.some((p) => p.details?.tag)) return openDetail(detailPath("tag", tagName(tag)))
  if (on.some((p) => p.views?.search)) return openView(`search/tag:#${tagName(tag)}`)
  runCommandId("switcher:open")
}

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

/** How a link was clicked: ⌘ (Ctrl elsewhere) or a middle click is a new tab (a web page's behind the one on screen,
 *  in front with ⇧ too, as browsers do); ⌥⌘ sends a web page to the system browser (`out`). */
export type LinkClick = { newTab: boolean; front?: boolean; out?: boolean
  /** The Browser's container a web page opens in (an id or a name; null: none): the link menu's, or its note's `container:`. */
  container?: string | null
  /** Another app's link (Vaultite as the Mac's browser): the Browser may ask which container, as it never does for the app's own. */
  fromApp?: boolean }
export function linkClick(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }): LinkClick {
  const mod = e.metaKey || e.ctrlKey
  return { newTab: mod || e.button === 1, ...(mod && e.shiftKey ? { front: true } : {}), ...(mod && e.altKey ? { out: true } : {}) }
}

function takeWebLink(url: string, how: LinkClick) {
  const { disabled } = getPrefs()
  for (const p of active(disabled)) {
    try { if (p.webLink?.(url, how)) return true } catch { /* a plugin failing leaves the link to the browser */ }
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
 *  system browser (a new browser tab on the web). `how`: how it was clicked (linkClick). */
export function openWebLink(url: string, how?: LinkClick) {
  const asked = clickOpening()
  how ??= asked ? { newTab: true, front: asked.front } : { newTab: false }
  if (!takeWebLink(url, how)) window.open(url, "_blank", "noopener,noreferrer")
}

if (typeof window !== "undefined") {
  const clicked = (e: MouseEvent) => {
    if (e.defaultPrevented || (e.button !== 0 && e.button !== 1) || ((e.shiftKey || e.altKey) && !(e.metaKey || e.ctrlKey))) return
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
    if (!a || a.hasAttribute("download")) return
    if (OTHER_SCHEME.test(a.href)) { if (e.button === 0 && takeSchemeLink(a.href, e.metaKey || e.ctrlKey)) e.preventDefault(); return }
    if (!/^https?:/i.test(a.href) || a.origin === location.origin) return
    if (takeWebLink(a.href, linkClick(e))) e.preventDefault()
  }
  addEventListener("click", clicked)
  addEventListener("auxclick", clicked)
}

const ITEM = "a[href], [data-keyrow], [role=link], [role=option], [data-opens]"
const hashTarget = (hash: string) => {
  const [tab, ...rest] = hash.slice(1).split("/")
  return targetOf((tab === "file" || tab === "view") && rest.length ? `${tab}/${rest[0]}` : tab)
}
const appHref = (a: Element | null) => {
  const href = a?.closest("a[href]")?.getAttribute("href")
  if (href == null) return null
  try { const u = new URL(href, location.href); return u.origin === location.origin && u.pathname === location.pathname ? u.hash : null } catch { return null }
}
if (typeof window !== "undefined") {
  const asks = (e: MouseEvent) => (e.type === "auxclick" ? e.button === 1 : e.button === 0 ? (isMac ? e.metaKey : e.ctrlKey) : e.type === "mousedown" && e.button === 1)
  addEventListener("click", start, true)
  addEventListener("auxclick", start, true)
  addEventListener("mousedown", start, true)
  function start(e: MouseEvent) {
    if (!asks(e)) return
    const item = e.type !== "mousedown" && !!(e.target as Element | null)?.closest?.(ITEM)
    setClickOpens({ front: e.shiftKey && e.button === 0, item })
    setTimeout(() => setClickOpens(null))
  }
  let synth = false
  const end = (e: MouseEvent) => {
    if (synth) return e.preventDefault()
    if (!asks(e)) return
    const el = (e.target as Element | null)?.closest?.<HTMLElement>(ITEM)
    const hash = appHref(e.target as Element)
    if (!e.defaultPrevented && el && (hash !== null || !el.matches("a[href]"))) {
      e.preventDefault()
      const to = hash && hash.length > 1 ? hashTarget(hash) : null
      if (to) go(to, true)
      else if (e.type === "auxclick") { synth = true; try { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, button: 1 })) } finally { synth = false } }
    }
    setClickOpens(null)
  }
  addEventListener("click", end)
  addEventListener("auxclick", end)
}

const COMMAND_LINK = /^vaultite:\/\/command\/([\w:.-]+)$/i
const UNSAFE = /^(javascript|data|vbscript|blob):/i

async function openOtherLink(url: string, mod = false) {
  if (UNSAFE.test(url)) return notify("That link can't be opened")
  if (takeSchemeLink(url, mod)) return
  if (/^file:/i.test(url) && !desktop) return notify("File links open in the desktop app")
  if (!desktop && !/^mailto:/i.test(url) && !(await confirmDialog({ title: "Open this link in another app?", body: url, confirm: "Open" }))) return
  window.open(url, "_blank", "noopener,noreferrer")
}

/** Follow a link clicked in drawn Markdown (a file, heading or ^block, a detail, a #tag, a command, a web or app
 *  link). A [[link]] to nothing makes that note, or asks which when another file may be what it meant. */
export async function followLink(s: Store, link: { wiki?: string; url?: string; tag?: string }, how: boolean | LinkClick, from?: string) {
  if (link.tag) return openTag(link.tag)
  const click: LinkClick = typeof how === "boolean" ? { newTab: how } : how, newTab = click.newTab
  let wiki = link.wiki ?? ""
  if (link.url) {
    const cmd = COMMAND_LINK.exec(link.url)
    if (cmd) { if (!runCommandLink(cmd[1])) notify("That isn't available here"); return }
    if (/^https?:/i.test(link.url)) {
      const note = from ? fileOf(s, from)?.container : undefined
      return openWebLink(link.url, click.container === undefined && note ? { ...click, container: note } : click)
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(link.url)) return openOtherLink(link.url, newTab)
    wiki = mdTarget(s, link.url, from)
  }
  const [name, anchor] = splitAnchor(wiki)
  if (!name) { if (from && anchor) openAt(from, anchor); return }
  const open = (t: Target) => (t.file ? openAt(t.file, anchor, { newTab }) : t.detail ? openDetail(t.detail) : undefined)
  const t = resolver(s)(name, from)
  if (t) return open(t)
  const clean = /\.(?!md$)[A-Za-z][A-Za-z0-9]{0,9}$/i.test(name) ? "" : cleanName(name)
  const create = async () => {
    try {
      const path = (await linkedNote(s, name, from)) ?? (await createNamed(newNoteFolder(s, from), name))?.path
      if (path) openAt(path, "", { newTab })
    } catch (e) { notifyError(e, `Couldn't make ${name}`) }
  }
  const maybe = didYouMean(s, name, from)
  if (!maybe.length) return clean ? create() : notify(`No file ${name} in the vault`)
  type Pick = Choice & { to?: Target }
  const items: Pick[] = maybe.map((m, i) => ({ id: String(i), label: m.file ? stem(m.file) : m.title, detail: m.file ? folderOf(m.file) || undefined : undefined, to: m }))
  if (clean) items.push({ id: "new", label: `Create “${clean}”`, icon: FilePlus })
  choose<Pick>({ title: "Did you mean", heading: `No file is called “${name}”. Did you mean:`, placeholder: "Open or create…", items,
    onPick: (c) => { if (c.to) open(c.to); else void create() } })
}

/** A link as drawn Markdown names it: a [[link]]'s target, a Markdown link's address, or a #tag. */
export type Link = { wiki?: string; url?: string; tag?: string }

/** The link drawn at `el` in rendered Markdown (a note's, a sheet's) and its text, or null. An `<a href>` counts only
 *  with a scheme: a footnote's `#fn1` goes nowhere else. */
export function drawnLink(el: EventTarget | null): { link: Link; text: string; el: HTMLElement } | null {
  const a = el instanceof Element ? el.closest<HTMLElement>("[data-wiki], [data-url], [data-tag], a[href]") : null
  if (!a) return null
  const { wiki, url, tag } = a.dataset, href = a.getAttribute("href") ?? ""
  const link = tag ? { tag } : wiki !== undefined ? { wiki } : url ? { url } : /^[a-z][a-z0-9+.-]*:/i.test(href) ? { url: href } : null
  return link && { link, text: a.textContent?.trim() ?? "", el: a }
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

const fileTargets = new WeakMap<VaultFile, Target>()
const fileTarget = (f: VaultFile): Target => {
  let t = fileTargets.get(f)
  if (!t) fileTargets.set(f, t = { kind: "file", id: f.path.replace(/\.md$/i, ""), title: stem(f.path), detail: "", file: f.path,
    names: f.aliases, ...(f.archived ? { archived: true } : {}) })
  return t
}
const otherTarget = (path: string): Target => ({ kind: "file", id: path, title: path.split("/").pop()!, detail: "", file: path, names: [] })

type Resolve = (t: string, from?: string) => Target | null
type Index = { resolve: Resolve; suggest: (t: string, from?: string) => Target[] }
const cache = new WeakMap<Store, Index>()
let made: { targets: Target[]; index: Index } | null = null
const sameList = (a?: string[], b?: string[]) => a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]))
const sameTarget = (a: Target, b: Target) => a === b || (a.kind === b.kind && a.id === b.id && a.title === b.title &&
  a.detail === b.detail && a.file === b.file && sameList(a.names, b.names) && !a.archived === !b.archived)

function linkIndexOf(s: Store): Index {
  const hit = cache.get(s)
  if (hit) return hit
  const { disabled } = getPrefs()
  const targets: Target[] = []
  for (const p of active(disabled)) {
    try { targets.push(...(p.links?.(s) ?? [])) } catch { /* a plugin's links failing must not break the rest */ }
  }
  const rows = new Map((s.files?.files ?? []).map((f) => [f.path.replace(/\.md$/i, ""), f]))
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

const didYouMean = (s: Store, target: string, from?: string) => linkIndexOf(s).suggest(target, from)

