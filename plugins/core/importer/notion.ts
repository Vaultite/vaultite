// Notion's export: "Title <32 hex id>.md", subpages in a folder of the page's name, databases as CSVs with a folder of rows

const ID = /[ -]([0-9a-f]{32})$/i

export function bareName(name: string): { name: string; id: string | null } {
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : ""
  const m = ID.exec(stem)
  if (!m) return { name, id: null }
  return { name: (stem.slice(0, m.index).trim() || "Untitled") + ext, id: m[1].toLowerCase() }
}

export function barePath(p: string) {
  return p.split("/").filter((seg) => seg && seg !== "." && seg !== "..").map((seg, i, all) => {
    const s = i === all.length - 1 ? seg.replace(/_all\.csv$/i, ".csv") : seg
    return bareName(s).name
  }).join("/")
}

export const idOf = (p: string) => bareName(p.split("/").pop()!.replace(/_all\.csv$/i, ".csv")).id

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
const pad = (n: number) => String(n).padStart(2, "0")

// Notion's dates: "October 5, 2026", "October 5, 2026 3:04 PM", a range "... → ..."
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

const target = (rel: string, md: boolean) => (md ? rel.replace(/\.md$/i, "") : rel)

// Notion's relations: "Name (Path%20id.md), ..."
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

export function links(md: string, resolve: Resolve) {
  const parts = md.split(/(^```[\s\S]*?^```[^\n]*$|`[^`\n]+`)/m)
  return parts.map((p, i) => (i % 2 ? p : p.replace(/(!?)\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (all, bang: string, label: string, href: string) => {
    const t = resolve(href)
    if (!t) return all
    const to = target(t.rel, t.md)
    if (bang) return `![[${to}]]`
    const shown = label.replace(/[[\]|]/g, " ").trim() || to.split("/").pop()
    return `[[${to}|${shown}]]`
  }))).join("")
}

// a link to notion.so names a page by its id
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
