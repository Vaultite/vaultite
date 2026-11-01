// Notion's Markdown & CSV export ("Title <32 hex id>.md", subpages in a folder of the page's name, databases as CSVs
// with a folder of rows): names without ids, links as wikilinks, a row's properties as its frontmatter.

const ID = /[ -]([0-9a-f]{32})$/i

/** A file or folder name without Notion's id ("Plans 0123...ef.md" -> "Plans.md"), and the id. */
export function bareName(name: string): { name: string; id: string | null } {
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : ""
  const m = ID.exec(stem)
  if (!m) return { name, id: null }
  return { name: (stem.slice(0, m.index).trim() || "Untitled") + ext, id: m[1].toLowerCase() }
}

/** An entry's path with every segment's id dropped (and a database's `_all.csv`, its every property, as its CSV). */
export function barePath(p: string) {
  // (an entry named "../x.md" stays in the import's folder)
  return p.split("/").filter((seg) => seg && seg !== "." && seg !== "..").map((seg, i, all) => {
    const s = i === all.length - 1 ? seg.replace(/_all\.csv$/i, ".csv") : seg
    return bareName(s).name
  }).join("/")
}

/** Its id: the last segment's. */
export const idOf = (p: string) => bareName(p.split("/").pop()!.replace(/_all\.csv$/i, ".csv")).id

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
const pad = (n: number) => String(n).padStart(2, "0")

/** Notion's dates ("October 5, 2026", "October 5, 2026 3:04 PM", a range "... → ...") as the vault writes them; else null. */
export function notionDate(v: string): string | null {
  const m = /^([A-Za-z]+) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d\d)(?: ?([AP]M))?)?(?: \(\w+\))?$/i.exec(v.trim())
  if (!m) return null
  const mon = MONTHS.indexOf(m[1].toLowerCase())
  if (mon < 0) return null
  const day = `${m[3]}-${pad(mon + 1)}-${pad(+m[2])}`
  if (!m[4]) return day
  let h = +m[4]
  if (m[6]) h = (h % 12) + (m[6].toUpperCase() === "PM" ? 12 : 0)
  return `${day} ${pad(h)}:${m[5]}`
}

export type Resolve = (href: string) => { rel: string; md: boolean } | null

/** A link's target as a wikilink's: a note without ".md". */
const target = (rel: string, md: boolean) => (md ? rel.replace(/\.md$/i, "") : rel)

/** A property's value: dates as dates, Yes/No as booleans, relations ("Name (Path%20id.md), ...") as links. */
export function propValue(v: string, resolve: Resolve): unknown {
  const s = v.trim()
  if (!s) return ""
  const date = notionDate(s.split(" → ")[0])
  if (date && !s.includes(" → ")) return date
  if (s === "Yes" || s === "No") return s === "Yes"
  const rel = [...s.matchAll(/(?:^|, )(.+?) \(((?:[^()]|\([^()]*\))+?\.md)\)(?=, |$)/g)]
  if (rel.length && rel.map((m) => m[0]).join("") === s) {
    return rel.map((m) => { const t = resolve(m[2]); return t ? `[[${target(t.rel, t.md)}|${m[1]}]]` : m[1] })
  }
  return s
}

/** A page's Markdown made the vault's: its title heading off (the file's name says it), a database row's property lines
 *  (`Key: value` under the title) as frontmatter, and every link to another page or attachment of the export a wikilink. */
export function notionNote(md: string, resolve: Resolve, row: boolean): { fm: Record<string, unknown>; body: string } {
  let text = md.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
  text = text.replace(/^# [^\n]*\n+/, "")
  const fm: Record<string, unknown> = {}
  if (row) {
    const lines = text.split("\n")
    let n = 0
    while (n < lines.length && /^[^:\n]{1,80}: /.test(lines[n])) n++
    if (n && (n === lines.length || !lines[n].trim())) {
      for (const l of lines.slice(0, n)) {
        const at = l.indexOf(": ")
        fm[l.slice(0, at).trim()] = propValue(l.slice(at + 2), resolve)
      }
      text = lines.slice(n).join("\n")
    }
  }
  return { fm, body: links(text, resolve).trim() }
}

/** Markdown links and images to the export's files as wikilinks and embeds; code left as it is. */
export function links(md: string, resolve: Resolve) {
  const parts = md.split(/(^```[\s\S]*?^```[^\n]*$|`[^`\n]+`)/m)
  return parts.map((p, i) => (i % 2 ? p : p.replace(/(!?)\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (all, bang: string, label: string, href: string) => {
    const t = resolve(href)
    if (!t) return all
    const to = target(t.rel, t.md)
    if (bang) return `![[${to}]]`
    // (a path's link shows its label, else the file's name: never the path)
    const shown = label.replace(/[[\]|]/g, " ").trim() || to.split("/").pop()
    return `[[${to}|${shown}]]`
  }))).join("")
}

/** A link's address as the export's path it names, relative to the page at `from` ("" when it's elsewhere); a link to
 *  notion.so names a page by its id (`byId`). */
export function hrefPath(href: string, from: string, byId: (id: string) => string | undefined): string | null {
  const notion = /^https?:\/\/(?:www\.)?notion\.(?:so|site)\/[^?#]*?([0-9a-f]{32})(?:[?#].*)?$/i.exec(href)
  if (notion) return byId(notion[1].toLowerCase()) ?? null
  if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith("#")) return null
  let p: string
  try { p = decodeURIComponent(href.replace(/[?#].*$/, "")) } catch { return null }
  const out: string[] = from.split("/").slice(0, -1)
  for (const seg of p.split("/")) {
    if (seg === "..") out.pop()
    else if (seg && seg !== ".") out.push(seg)
  }
  return out.join("/")
}
