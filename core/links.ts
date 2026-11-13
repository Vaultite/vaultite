// [[Links]] resolved as Obsidian does: a path, a file name, then aliases and plugins' names; of several, the closest to
// the linking file wins, an archived one last.
import { archiveTwin } from "./fileprops.ts"

/** A file as links see it. `names` are what plugins add (a person's name); `archived`: it loses ties. */
export type LinkFile = { path: string; aliases?: string[]; names?: string[]; archived?: boolean }
/** Something a link can go to: a file (`path`), or only a name (`labels`) for what isn't one. `bare`: its name counts
 *  without its extension too (by default, a note's). */
export type LinkEntry<T> = { value: T; path?: string; bare?: boolean; labels?: string[]; archived?: boolean }
/** Resolve a link target ("Alice Park", "Notes/Idea", "../Idea#Heading") written in `from`, or null. */
export type Resolve<T> = (target: string, from?: string) => T | null

const WIKI = () => /!?\[\[([^[\]\n|#^]+)(?:[#^][^[\]\n|]*)?(?:\|[^[\]\n]*)?\]\]/g
const CODE = /(`+)(?:(?!\1).)+?\1/g
// A [[link]] or ![[embed]] (target, #heading, |alias), or a Markdown link or image (its text, then its address and title)
const LINK = () => /(!?\[\[)([^[\]\n|#^]+)([#^][^[\]\n|]*)?(\|[^[\]\n]*)?\]\]|(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g

/** The targets of every [[link]] (and ![[embed]]) in Markdown, outside code (fences and inline). */
export function wikiTargets(text: string): string[] {
  const out: string[] = []
  for (const [line, code] of fenced(text)) if (!code) for (const m of line.replace(CODE, "").matchAll(WIKI())) out.push(m[1].trim())
  return out
}

/** A link in a note: its target as a resolver reads it, the line it's on (as written) and whether it's an embed. */
export type NoteLink = { target: string; line: string; embed: boolean }

/** Every link in a note's Markdown, outside code (fences and inline), as Obsidian counts them: [[links]], ![[embeds]]
 *  and Markdown links to files in the vault ([text](path), ![](path); not URLs, nor a heading in the same note). */
export function* noteLinks(text: string): Generator<NoteLink> {
  if (!text.includes("[[") && !text.includes("](")) return
  for (const [line, code] of fenced(text)) {
    if (code || !(line.includes("[[") || line.includes("]("))) continue
    for (const m of line.replace(CODE, "").matchAll(LINK())) {
      // (`[[x\|alias]]` in a table is a link to x)
      if (m[2] !== undefined) { yield { target: m[2].replace(/\\$/, "").trim(), line, embed: m[1].startsWith("!") }; continue }
      const target = mdLinkTarget(m[6])
      if (target) yield { target, line, embed: m[5].startsWith("!") }
    }
  }
}

/** The targets of every link in a note's Markdown (noteLinks). */
export const linkTargets = (text: string): string[] => Array.from(noteLinks(text), (l) => l.target)

function localHref(href: string): { angle: boolean; raw: string; path: string; anchor: string } | null {
  const angle = href.startsWith("<"), raw = angle ? href.slice(1, -1) : href
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#")) return null
  const hash = raw.indexOf("#"), p = hash < 0 ? raw : raw.slice(0, hash)
  let path = p
  try { path = decodeURIComponent(p) } catch { /* not encoded */ }
  return { angle, raw: p, path, anchor: hash < 0 ? "" : raw.slice(hash) }
}

/** A Markdown link's address as a link target, or null when it isn't a file in the vault. As Obsidian reads it: from
 *  the note's folder first, then the vault's top, then by name (`Sub/Idea.md` is written `./Sub/Idea.md` for that). */
export function mdLinkTarget(href: string): string | null {
  const p = localHref(href)?.path.trim()
  if (!p) return null
  return p.includes("/") && !/^(\.\.?\/|\/)/.test(p) ? `./${p}` : p
}

export function* fenced(text: string): Generator<[string, boolean]> {
  let fence: string | null = null
  for (const line of text.split("\n")) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f && (fence === null || (f[1][0] === fence[0] && f[1].length >= fence.length))) { fence = fence ? null : f[1]; yield [line, true] }
    else yield [line, fence !== null]
  }
}

/** `[[X]]` typed without quotes, which YAML reads as a list in a list ([["X"]]): the link it was meant to be, or null. */
const unquoted = (v: unknown) => (Array.isArray(v) && v.length === 1 && Array.isArray(v[0]) && v[0].length === 1 && typeof v[0][0] === "string" ? `[[${v[0][0]}]]` : null)

/** The [[links]] in a file's frontmatter, with the key each is under (`project: "[[Lighthouse]]"`, a list's items, and
 *  `project: [[Lighthouse]]` unquoted too): [key, target]. */
export function frontmatterLinks(fm: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = []
  for (const [k, v] of Object.entries(fm)) {
    for (const s of unquoted(v) !== null ? [v] : Array.isArray(v) ? v : [v]) {
      const text = typeof s === "string" ? s : unquoted(s)
      if (text?.includes("[[")) for (const t of wikiTargets(text)) out.push([k, t])
    }
  }
  return out
}

/** The targets of the [[links]] in a file's frontmatter values (`with: "[[Alice Park]]"`). */
export const frontmatterTargets = (fm: Record<string, unknown>): string[] => frontmatterLinks(fm).map(([, t]) => t)

const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")))
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1)
const noExt = (p: string) => p.replace(/\.[^./]+$/, "")
const segs = (dir: string) => (dir ? dir.split("/") : [])

function distance(dir: string, p: string) {
  const a = segs(dir.toLowerCase()), b = segs(dirOf(p).toLowerCase())
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return a.length - i + (b.length - i)
}

/** What links can go to: `resolve`, and what a link to nothing may have meant (`suggest`: "Alice" for Alice Park, a
 *  file of that name elsewhere). `twins` false: a path doesn't find its archive twin (what relinking needs). */
export function linkIndex<T>(entries: LinkEntry<T>[], { twins = true } = {}): { resolve: Resolve<T>; suggest: (target: string, from?: string, max?: number) => T[] } {
  const paths = new Map<string, LinkEntry<T>[]>(), names = new Map<string, LinkEntry<T>[]>(), labels = new Map<string, LinkEntry<T>[]>()
  const put = (m: Map<string, LinkEntry<T>[]>, k: string, e: LinkEntry<T>) => {
    if (!k) return
    const l = m.get(k)
    if (!l) m.set(k, [e])
    else if (!l.includes(e)) l.push(e)
  }
  for (const e of entries) {
    for (const n of e.labels ?? []) put(labels, n.trim().toLowerCase(), e)
    if (!e.path) continue
    const p = e.path.toLowerCase(), bare = e.bare ?? /\.md$/.test(p)
    put(paths, p, e); put(names, baseOf(p), e)
    if (bare) { put(paths, noExt(p), e); put(names, noExt(baseOf(p)), e) }
  }
  const rank = (l: LinkEntry<T>[], from?: string) => {
    if (l.length < 2) return l
    const dir = from === undefined ? null : dirOf(from)
    const key = (e: LinkEntry<T>) => [Number(!!e.archived), dir === null || !e.path ? 0 : distance(dir, e.path), segs(dirOf(e.path ?? "")).length]
    return [...l].sort((a, b) => {
      const x = key(a), y = key(b)
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
      const pa = a.path ?? "", pb = b.path ?? ""
      return pa < pb ? -1 : pa > pb ? 1 : 0
    })
  }
  const clean = (target: string) => target.split("#")[0].split("^")[0].trim()
  const resolve: Resolve<T> = (target, from) => {
    const t = clean(target)
    if (!t) return null
    if (from !== undefined && /^\.\.?\//.test(t)) {
      const p = resolvePath(dirOf(from), t)
      const hit = p ? paths.get(p.toLowerCase()) : undefined
      if (hit) return rank(hit, from)[0].value
    }
    const k = t.replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "").toLowerCase()
    const exact = k.includes("/") || t.startsWith("/") ? paths.get(k) ?? (twins ? paths.get(archiveTwin(k)) : undefined) : undefined
    if (exact) return rank(exact, from)[0].value
    const base = baseOf(k)
    let hits = names.get(base)
    if (hits && k !== base) hits = hits.filter((e) => { const p = e.path!.toLowerCase(); return p.endsWith(`/${k}`) || ((e.bare ?? /\.md$/.test(p)) && noExt(p).endsWith(`/${k}`)) })
    if (hits?.length) return rank(hits, from)[0].value
    const label = labels.get(k)
    return label ? rank(label, from)[0].value : null
  }
  const suggest = (target: string, from?: string, max = 5) => {
    const k = clean(target).replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "").toLowerCase()
    if (!k) return []
    const out: LinkEntry<T>[] = []
    const add = (l?: LinkEntry<T>[]) => { for (const e of rank(l ?? [], from)) if (!out.includes(e)) out.push(e) }
    if (k.includes("/")) add(names.get(baseOf(k)))
    for (const m of [names, labels]) {
      const starts: LinkEntry<T>[] = []
      for (const [n, l] of m) if (n.length > k.length && n.startsWith(k) && /[\s\-_.,(]/.test(n[k.length])) starts.push(...l)
      add(starts)
    }
    return out.slice(0, max).map((e) => e.value)
  }
  return { resolve, suggest }
}

/** A resolver over these files: a link target (written in `from`) to a file's path, or null. */
export function linkResolver(files: LinkFile[], opts?: { twins?: boolean }): Resolve<string> {
  return linkIndex(files.map((f) => ({ value: f.path, path: f.path, archived: f.archived,
    labels: [...(f.aliases ?? []), ...(f.names ?? [])] })), opts).resolve
}

/** A link in a line of Markdown: its span, where its target is written (`target`) and its text (`text`: a
 *  [[link|alias]]'s alias, a [text](url)'s text); `embed`: an ![[embed]] or ![image](url). */
export type LinkSpan = { wiki?: string; url?: string; tag?: string; from: number; to: number; target: [number, number]; text?: [number, number]; embed?: boolean }
const LINE_LINK = /(!?)\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]|(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s)>\]]+)|(?<=^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/dgu

/** The links in a line (`offset`: where it starts): [[wiki]], ![[embed]], [text](url), <url>, a bare URL, a #tag. */
export function linksIn(text: string, offset = 0): LinkSpan[] {
  const out: LinkSpan[] = []
  for (const m of text.matchAll(LINE_LINK)) {
    const at = (i: number): [number, number] => [offset + m.indices![i]![0], offset + m.indices![i]![1]]
    const from = offset + m.index, to = from + m[0].length
    if (m[2] !== undefined) out.push({ from, to, wiki: m[2], target: at(2), ...(m[3] !== undefined ? { text: at(3) } : {}), ...(m[1] ? { embed: true } : {}) })
    else if (m[6] !== undefined) out.push({ from, to, url: m[6], target: at(6), text: at(5), ...(m[4] ? { embed: true } : {}) })
    else if (m[7] ?? m[8]) { const i = m[7] ? 7 : 8; out.push({ from, to, url: m[i], target: at(i) }) }
    else if (m[9]) out.push({ from, to, tag: m[9], target: at(9) })
  }
  return out
}

/** `text` with each link's target (outside code) passed through `to`: a wikilink's or embed's target, or a Markdown
 *  link's path (decoded, without its #anchor; md: true). `to` gives the new target, or null to leave the link. */
export function mapLinks(text: string, to: (target: string, md: boolean) => string | null): string {
  return Array.from(fenced(text), ([line, code]) => {
    if (code || !(line.includes("[[") || line.includes("]("))) return line
    let out = "", at = 0
    for (const m of line.matchAll(CODE)) { out += relinkSpan(line.slice(at, m.index), to) + m[0]; at = m.index + m[0].length }
    return out + relinkSpan(line.slice(at), to)
  }).join("\n")
}

function relinkSpan(s: string, to: (target: string, md: boolean) => string | null) {
  return s.replace(LINK(), (all, open?: string, target?: string, head?: string, alias?: string, mdOpen?: string, href?: string, close?: string) => {
    if (open !== undefined && target !== undefined) {
      const esc = target.endsWith("\\") ? "\\" : ""
      const t = to(target.slice(0, target.length - esc.length).trim(), false)
      return t === null ? all : `${open}${t}${head ?? ""}${esc}${alias ?? ""}]]`
    }
    const h = localHref(href!)
    if (!h) return all
    const { angle, raw: p, path: dec, anchor } = h
    const t = dec && to(dec, true)
    if (!t) return all
    const pct = (c: string) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    const enc = angle ? t : /%(?!20)[0-9a-f]{2}/i.test(p) ? encodeURI(t).replace(/[()]/g, pct) : t.replace(/[ ()]/g, pct)
    return `${mdOpen}${angle ? `<${enc}${anchor}>` : enc + anchor}${close}`
  })
}

/** A vault path from `dir` and a relative one ("../a/b.md"), or null when it leaves the vault. */
export function resolvePath(dir: string, rel: string): string | null {
  const parts = dir ? dir.split("/") : []
  for (const x of rel.split("/")) {
    if (x === "..") { if (!parts.length) return null; parts.pop() }
    else if (x && x !== ".") parts.push(x)
  }
  return parts.join("/")
}

export function relativePath(dir: string, to: string): string {
  const a = dir ? dir.split("/") : [], b = to.split("/")
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/")
}
