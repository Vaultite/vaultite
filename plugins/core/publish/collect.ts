// What a publish sends: the published notes as Markdown for Vaultite Cloud to render, links between them relative
// (`[shown](slug)`), images as `assets/<sha256>`, and what isn't published reduced to its text. Pure but for reading files.
import crypto from "node:crypto"
import fs from "node:fs"
import { inArchive, isHiddenPath } from "../../../core/vault.ts"

/** What collecting needs of the vault (a Vault is one). */
export type Source = {
  entries: Map<string, { fm: Record<string, unknown>; body: string; archived: boolean }>
  others: Map<string, unknown>
  resolveLink: (target: string, from?: string) => string | null
  abs: (rel: string) => string
}
export type Page = { path: string; slug: string; title: string; markdown: string; hash: string }
export type Asset = { path: string; abs: string; hash: string; type: string; size: number }
export type Collected = { pages: Page[]; assets: Asset[]; warnings: string[] }

/** Images the web shows, by extension (HEIC isn't one: browsers can't draw it). */
const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
}
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|heic|bmp|tiff?)$/i
export const MAX_ASSET = 10 << 20

export const sha256 = (b: string | Buffer) => crypto.createHash("sha256").update(b).digest("hex")
/** The hash Vaultite Cloud reports for a page, to skip unchanged ones. */
export const pageHash = (title: string, markdown: string) => sha256(`${title}\n${markdown}`)

const stem = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1).replace(/\.md$/i, "")
const nameOf = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "")
const ext = (rel: string) => /\.([^./]+)$/.exec(rel)?.[1].toLowerCase() ?? ""

/** A note's address part: its name in lowercase letters, digits and hyphens. */
export function slugOf(name: string) {
  const s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return s.slice(0, 100).replace(/-+$/, "") || "note"
}

/** The notes a list of notes and folders (vault paths, `.md` or not) stands for, in path order: a folder's notes at any
 *  depth, leaving out hidden and archived ones. */
export function notesOf(src: Source, items: string[]): string[] {
  const out = new Set<string>()
  for (const raw of items) {
    const item = raw.replace(/^\/+|\/+$/g, "")
    if (!item) continue
    const note = /\.md$/i.test(item) ? item : `${item}.md`
    if (src.entries.has(note)) { out.add(note); continue }
    for (const [rel, e] of src.entries) {
      if (rel.startsWith(`${item}/`) && !isHiddenPath(rel) && !inArchive(rel) && !e.archived) out.add(rel)
    }
  }
  return [...out].sort()
}

/** Each note's slug: unique, the first by path keeping the plain one. `assets` is the relay's. */
export function slugsOf(notes: string[]): Map<string, string> {
  const taken = new Set(["assets"]), out = new Map<string, string>()
  for (const rel of [...notes].sort()) {
    const base = slugOf(stem(rel)).slice(0, 96).replace(/-+$/, "") || "note"
    let s = base
    for (let n = 2; taken.has(s); n++) s = `${base}-${n}`
    taken.add(s)
    out.set(rel, s)
  }
  return out
}

/** Text as it reads in Markdown, its link-making characters escaped. */
const plain = (s: string) => s.replace(/([\\[\]*_`<])/g, "\\$1")
const WIKI = /(!?)\[\[([^[\]\n|#^]*)([#^][^[\]\n|]*)?(?:\|([^[\]\n]*))?\]\]/g
const MDLINK = /(!?)\[([^\]\n]*)\]\((<[^>\n]+>|[^)\s]+)(\s+"[^"\n]*")?\)/g
const CODE = /(`+)[^`\n][\s\S]*?\1|``/g

export function collect(src: Source, items: string[]): Collected {
  const notes = notesOf(src, items)
  const slugs = slugsOf(notes)
  const assets = new Map<string, Asset>(), byPath = new Map<string, Asset | null>(), warnings: string[] = []

  /** An image file as an asset (read once), or null when the web can't show it or it's too big. */
  const asset = (rel: string): Asset | null => {
    if (byPath.has(rel)) return byPath.get(rel)!
    let a: Asset | null = null
    const type = TYPES[ext(rel)]
    if (!type) warnings.push(`${rel}: browsers can't show .${ext(rel)} images, so it's left out`)
    else {
      try {
        const bytes = fs.readFileSync(src.abs(rel))
        if (bytes.length > MAX_ASSET) warnings.push(`${rel} is over 10 MB, so it's left out`)
        else { a = { path: rel, abs: src.abs(rel), hash: sha256(bytes), type, size: bytes.length }; assets.set(a.hash, a) }
      } catch { warnings.push(`${rel} couldn't be read, so it's left out`) }
    }
    byPath.set(rel, a)
    return a
  }

  /** A link's target as a vault file: by Obsidian's rules, or a path relative to the note. */
  const fileOf = (target: string, from: string): string | null => {
    const hit = src.resolveLink(target, from)
    if (hit) return hit
    const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : ""
    const parts = dir ? dir.split("/") : []
    for (const x of target.split("/")) {
      if (x === "..") { if (!parts.length) return null; parts.pop() } else if (x && x !== ".") parts.push(x)
    }
    const rel = parts.join("/")
    return src.entries.has(rel) || src.others.has(rel) ? rel : null
  }

  const image = (rel: string, alt: string) => { const a = asset(rel); return a ? `![${plain(alt)}](assets/${a.hash})` : "" }
  const titleOf = (rel: string) => { const t = src.entries.get(rel)?.fm.title; return typeof t === "string" && t.trim() ? t.trim() : stem(rel) }

  const span = (s: string, from: string) => s
    .replace(WIKI, (_all, bang: string, target: string, head: string | undefined, alias: string | undefined) => {
      const t = target.trim()
      const rel = t ? fileOf(t, from) : from
      const shown = alias?.trim() || (head ? `${t || titleOf(from)} > ${head.slice(1)}` : t)
      if (bang) {
        if (rel && IMAGE.test(rel)) return image(rel, /^\d+(x\d+)?$/.test(alias?.trim() ?? "") ? `${nameOf(rel)}|${alias!.trim()}` : alias?.trim() || nameOf(rel))
        return rel && slugs.has(rel) ? `[${plain(alias?.trim() || titleOf(rel))}](${slugs.get(rel)})` : ""
      }
      return rel && slugs.has(rel) ? `[${plain(shown)}](${slugs.get(rel)})` : plain(shown)
    })
    .replace(MDLINK, (all, bang: string, text: string, href: string, _title: string | undefined) => {
      const raw = href.startsWith("<") ? href.slice(1, -1) : href
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#") || raw.startsWith("assets/")) return all
      let p = raw.replace(/#.*$/, "")
      try { p = decodeURIComponent(p) } catch { /* as written */ }
      const rel = p ? fileOf(p, from) ?? (src.entries.has(`${p}.md`) ? `${p}.md` : null) : null
      if (bang) return rel && IMAGE.test(rel) ? image(rel, text) : ""
      return rel && slugs.has(rel) ? `[${text}](${slugs.get(rel)})` : text
    })

  const pages = notes.map((rel) => {
    const e = src.entries.get(rel)!
    const markdown = rewrite(e.body, (s) => span(s, rel))
    const title = titleOf(rel)
    return { path: rel, slug: slugs.get(rel)!, title, markdown, hash: pageHash(title, markdown) }
  })
  return { pages, assets: [...assets.values()], warnings }
}

/** The body with `block-*` fences (the app's views) and %% comments %% (Obsidian's private notes) left out, and each
 *  stretch of text outside code passed through `span`. */
export function rewrite(body: string, span: (s: string) => string): string {
  const out: string[] = []
  let fence: string | null = null, drop = false, comment = false
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const f = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(line)
    if (fence === null && f) {
      fence = f[1]; drop = f[2].startsWith("block-")
      if (!drop) out.push(line)
      continue
    }
    if (fence !== null) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2]) { fence = null; if (!drop) out.push(line); drop = false; continue }
      if (!drop) out.push(line)
      continue
    }
    // %% may open and close on one line, or span lines
    let text = "", rest = line
    const was = comment
    for (;;) {
      const i = rest.indexOf("%%")
      if (i < 0) { if (!comment) text += rest; break }
      if (!comment) text += rest.slice(0, i)
      comment = !comment
      rest = rest.slice(i + 2)
    }
    if ((was || comment) && !text.trim()) continue
    let done = "", at = 0
    for (const m of text.matchAll(CODE)) { done += span(text.slice(at, m.index)) + m[0]; at = m.index! + m[0].length }
    out.push(done + span(text.slice(at)))
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}
