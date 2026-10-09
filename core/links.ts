// [[Links]], resolved the way Obsidian does, on the server and in the app (web/src/core/links.ts, through `linkIndex`):
// a path (or relative to the file), then a file name (a folder in front narrows it), then titles, aliases and plugins'
// names. Several files answering: the closest to the linking file wins, an archived one last. No Node.

/** A file as links see it. `names` are what plugins add (a person's name); `archived`: it loses ties. */
export type LinkFile = { path: string; title?: string; aliases?: string[]; names?: string[]; archived?: boolean }
/** Something a link can go to: a file (`path`), or only a name (`labels`) for what isn't one. `bare`: its name counts
 *  without its extension too (by default, a note's). */
export type LinkEntry<T> = { value: T; path?: string; bare?: boolean; labels?: string[]; archived?: boolean }
/** Resolve a link target ("Alice Park", "Notes/Idea", "../Idea#Heading") written in `from`, or null. */
export type Resolve<T> = (target: string, from?: string) => T | null

const WIKI = () => /!?\[\[([^[\]\n|#^]+)(?:[#^][^[\]\n|]*)?(?:\|[^[\]\n]*)?\]\]/g
const CODE = /(`+)(?:(?!\1).)+?\1/g

/** The targets of every [[link]] (and ![[embed]]) in Markdown, outside code (fences and inline). */
export function wikiTargets(text: string): string[] {
  const out: string[] = []
  let fence: string | null = null
  for (const line of text.split("\n")) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f && (fence === null || (f[1][0] === fence[0] && f[1].length >= fence.length))) {
      fence = fence ? null : f[1]
      continue
    }
    if (fence) continue
    for (const m of line.replace(CODE, "").matchAll(WIKI())) out.push(m[1].trim())
  }
  return out
}

/** The targets of the [[links]] in a file's frontmatter values (`with: "[[Alice Park]]"`). */
export function frontmatterTargets(fm: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const v of Object.values(fm)) for (const s of Array.isArray(v) ? v : [v]) if (typeof s === "string" && s.includes("[[")) out.push(...wikiTargets(s))
  return out
}

const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")))
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1)
const noExt = (p: string) => p.replace(/\.[^./]+$/, "")
const segs = (dir: string) => (dir ? dir.split("/") : [])

/** How far file `p` is from folder `dir`: folders up, then down (0 in the same folder). */
function distance(dir: string, p: string) {
  const a = segs(dir.toLowerCase()), b = segs(dirOf(p).toLowerCase())
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return a.length - i + (b.length - i)
}

/** An index of what links can go to, and how they resolve: `resolve`, and what a link to nothing may have meant
 *  (`suggest`: a name that starts with it, "Alice" for Alice Park; a file of that name in another folder). */
export function linkIndex<T>(entries: LinkEntry<T>[]): { resolve: Resolve<T>; suggest: (target: string, from?: string, max?: number) => T[] } {
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
  // Closest first: not archived, then (from a file) its own folder and the fewest folders away, then the shortest path.
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
    // A relative path (`../Idea`) from the linking file's folder first; else from the vault's top.
    if (from !== undefined && /^\.\.?\//.test(t)) {
      const p = resolvePath(dirOf(from), t)
      const hit = p ? paths.get(p.toLowerCase()) : undefined
      if (hit) return rank(hit, from)[0].value
    }
    // A path from the vault's top: a bare name is a name, so the closest file of that name wins over one at the top.
    // (a relative one that isn't there is taken as written from the top: `../Media/a.png` as Media/a.png)
    const k = t.replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "").toLowerCase()
    const exact = k.includes("/") || t.startsWith("/") ? paths.get(k) : undefined
    if (exact) return rank(exact, from)[0].value
    // A file name; a folder in front of it must be the end of the file's path (`[[Work/Idea]]`: any …/Work/Idea.md).
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
    // The file of that name elsewhere (a path that isn't there as written), then names that start with it.
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
export function linkResolver(files: LinkFile[]): Resolve<string> {
  return linkIndex(files.map((f) => ({ value: f.path, path: f.path, archived: f.archived,
    labels: [f.title ?? "", ...(f.aliases ?? []), ...(f.names ?? [])] }))).resolve
}

const LINK = () => /(!?\[\[)([^[\]\n|#^]+)([#^][^[\]\n|]*)?(\|[^[\]\n]*)?\]\]|(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g

/** `text` with each link's target (outside code) passed through `to`: a wikilink's or embed's target, or a Markdown
 *  link's path (decoded, without its #anchor; md: true). `to` gives the new target, or null to leave the link. */
export function mapLinks(text: string, to: (target: string, md: boolean) => string | null): string {
  let fence: string | null = null
  return text.split("\n").map((line) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f && (fence === null || (f[1][0] === fence[0] && f[1].length >= fence.length))) {
      fence = fence ? null : f[1]
      return line
    }
    if (fence || !(line.includes("[[") || line.includes("]("))) return line
    // Inline code stays as it is: only the text between code spans is rewritten.
    let out = "", at = 0
    for (const m of line.matchAll(CODE)) { out += relinkSpan(line.slice(at, m.index), to) + m[0]; at = m.index + m[0].length }
    return out + relinkSpan(line.slice(at), to)
  }).join("\n")
}

function relinkSpan(s: string, to: (target: string, md: boolean) => string | null) {
  return s.replace(LINK(), (all, open?: string, target?: string, head?: string, alias?: string, mdOpen?: string, href?: string, close?: string) => {
    if (open !== undefined && target !== undefined) {
      const esc = target.endsWith("\\") ? "\\" : "" // [[x\|alias]] in a table
      const t = to(target.slice(0, target.length - esc.length).trim(), false)
      return t === null ? all : `${open}${t}${head ?? ""}${esc}${alias ?? ""}]]`
    }
    const angle = href!.startsWith("<"), raw = angle ? href!.slice(1, -1) : href!
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#")) return all
    const hash = raw.indexOf("#"), p = hash < 0 ? raw : raw.slice(0, hash), anchor = hash < 0 ? "" : raw.slice(hash)
    let dec = p
    try { dec = decodeURIComponent(p) } catch { /* not encoded */ }
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

/** The relative path from folder `dir` to vault path `to`. */
export function relativePath(dir: string, to: string): string {
  const a = dir ? dir.split("/") : [], b = to.split("/")
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/")
}
