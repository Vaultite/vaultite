// [[Links]] on the server, resolved the way the app does (web/src/core/links.ts): path, name, title or alias, then weak
// names (a first name) only when one file has it. An archived file loses every tie. No Node.

/** A file as links see it. `names` and `weak` are what plugins add; `archived`: it loses ties. */
export type LinkFile = { path: string; title?: string; aliases?: string[]; names?: string[]; weak?: string[]; archived?: boolean }

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

/** A resolver over these files: a link target ("Alice", "Notes/Idea", "Idea#Heading") to a file's path, or null. */
export function linkResolver(files: LinkFile[]): (target: string) => string | null {
  const strong = new Map<string, string>()
  const weak = new Map<string, string | null>(), weakArchived = new Map<string, string | null>()
  const key = (n: string) => n.trim().toLowerCase()
  const add = (n: string, path: string) => { const k = key(n); if (k && !strong.has(k)) strong.set(k, path) }
  const byPath = (a: LinkFile, b: LinkFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  // Archived files after the others (their names only where nobody else has them), each by path.
  const sorted = [...files].sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || byPath(a, b))
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1)
  // Most exact first: paths, then file names, then titles, aliases and plugins' names.
  for (const f of sorted) { add(f.path, f.path); add(f.path.replace(/\.md$/i, ""), f.path) }
  for (const f of sorted) { add(base(f.path), f.path); add(base(f.path).replace(/\.md$/i, ""), f.path) }
  for (const f of sorted) for (const n of [f.title ?? "", ...(f.aliases ?? []), ...(f.names ?? [])]) add(n, f.path)
  for (const f of sorted) {
    const into = f.archived ? weakArchived : weak
    for (const n of f.weak ?? []) { const k = key(n); if (k) into.set(k, into.has(k) && into.get(k) !== f.path ? null : f.path) }
  }
  const weakOf = (k: string) => (weak.has(k) ? weak.get(k) : weakArchived.get(k))
  return (target) => {
    const k = key(target.split("#")[0].split("^")[0]).replace(/^\/+/, "")
    return strong.get(k) ?? strong.get(k.replace(/\.md$/, "")) ?? weakOf(k) ?? null
  }
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
