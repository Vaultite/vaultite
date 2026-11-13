
export type Bookmark = { url: string; title: string; folder: string }

const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const FENCE = /^\s*(```|~~~)/
const LINK = /^\s*[-*+][ \t]+(?:\[[ xX]\][ \t]+)?\[((?:\\.|[^\]\\])*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/
const BARE = /^\s*[-*+][ \t]+<?(https?:\/\/[^\s>]+)>?\s*$/i
const ITEM = /^\s*[-*+][ \t]/
const web = (u: string) => /^https?:\/\/\S+$/i.test(u)

type Line = { heading?: { level: number; title: string }; code?: boolean }
function linesOf(body: string): { text: string[]; info: Line[] } {
  const text = body.split("\n"), info: Line[] = []
  let fenced = false
  for (const l of text) {
    if (FENCE.test(l)) { fenced = !fenced; info.push({ code: true }); continue }
    const h = fenced ? null : HEADING.exec(l)
    info.push(h ? { heading: { level: h[1].length, title: h[2].trim() } } : fenced ? { code: true } : {})
  }
  return { text, info }
}

export function readBookmarks(body: string): Bookmark[] {
  const { text, info } = linesOf(body)
  const out: Bookmark[] = [], path: { level: number; title: string }[] = []
  text.forEach((l, i) => {
    const h = info[i].heading
    if (h) {
      while (path.length && path[path.length - 1].level >= h.level) path.pop()
      if (h.level > 1) path.push(h)
      return
    }
    if (info[i].code) return
    const m = LINK.exec(l), bare = m ? null : BARE.exec(l)
    const url = m ? m[2].replace(/^<|>$/g, "").trim() : bare?.[1] ?? ""
    if (!web(url)) return
    out.push({ url, title: m ? m[1].replace(/\\(.)/g, "$1").trim() : "", folder: path.map((p) => p.title).join("/") })
  })
  return out
}

export function bookmarkLine(b: Pick<Bookmark, "url" | "title">) {
  const title = (b.title || hostOf(b.url)).replace(/\s+/g, " ").replace(/([[\]\\])/g, "\\$1")
  const url = /[\s()<>]/.test(b.url) ? `<${b.url.replace(/[<>]/g, encodeURIComponent)}>` : b.url
  return `- [${title}](${url})`
}
const hostOf = (u: string) => { try { return new URL(u).host.replace(/^www\./, "") } catch { return u } }

type Section = { at: number; end: number; level: number }

function find(info: Line[], parts: string[], within: Section): Section | null {
  let s = within
  for (const name of parts) {
    const level = s.level + 1
    let hit: Section | null = null
    for (let i = s.at + 1; i < s.end; i++) {
      const h = info[i].heading
      if (!h || h.level !== level || h.title.toLowerCase() !== name.toLowerCase()) continue
      let end = i + 1
      while (end < info.length && !(info[end].heading && info[end].heading!.level <= level)) end++
      hit = { at: i, end: Math.min(end, s.end), level }
      break
    }
    if (!hit) return null
    s = hit
  }
  return s
}

export const folderPath = (f: string) => f.split("/").map((x) => x.trim()).filter(Boolean).slice(0, 5).join("/")

function insertInto(lines: string[], folder: string, items: string[], before?: number) {
  const { info } = linesOf(lines.join("\n"))
  const top: Section = { at: -1, end: lines.length, level: 1 }
  const parts = folder ? folder.split("/") : []
  let have = 0, under = top
  for (let n = parts.length; n > 0; n--) { const s = find(info, parts.slice(0, n), top); if (s) { have = n; under = s; break } }
  const make = parts.slice(have)
  let at: number, block: string[]
  if (!make.length) {
    if (!items.length) return
    at = under.at + 1
    while (at < under.end && !(info[at].heading && info[at].heading!.level > under.level)) at++
    while (at > under.at + 1 && !lines[at - 1].trim()) at--
    if (before !== undefined && before > under.at && before < at) { lines.splice(before, 0, ...items); return }
    block = [...items]
  } else {
    at = under.end
    while (at > under.at + 1 && !lines[at - 1].trim()) at--
    block = make.flatMap((name, i) => ["", `${"#".repeat(Math.min(6, under.level + 1 + i))} ${name}`]).concat(items)
  }
  const prose = (l: string | undefined) => !!l?.trim() && !ITEM.test(l)
  if (block[0] === "" && (at === 0 || !lines[at - 1].trim())) block.shift()
  else if (block[0] !== "" && prose(lines[at - 1]) && !HEADING.test(lines[at - 1])) block.unshift("")
  if (prose(lines[at])) block.push("")
  lines.splice(at, 0, ...block)
}

const finish = (lines: string[], changed: boolean) => {
  const l = lines.length === 1 && !lines[0] ? [] : lines
  const text = l.join("\n")
  return changed && !text.endsWith("\n") ? `${text}\n` : text
}

export function addBookmarks(body: string, bookmarks: Bookmark[]): { body: string; added: number } {
  const have = new Set(readBookmarks(body).map((b) => b.url))
  const groups = new Map<string, Bookmark[]>()
  for (const b of bookmarks) {
    if (!web(b.url) || have.has(b.url)) continue
    have.add(b.url)
    const f = folderPath(b.folder)
    groups.set(f, [...(groups.get(f) ?? []), b])
  }
  const lines = body.split("\n")
  let added = 0
  for (const [folder, list] of groups) { insertInto(lines, folder, list.map(bookmarkLine)); added += list.length }
  return { body: finish(lines, added > 0), added }
}

export function readFolders(body: string): string[] {
  const { info } = linesOf(body)
  const out: string[] = [], path: { level: number; title: string }[] = []
  for (const l of info) {
    const h = l.heading
    if (!h) continue
    while (path.length && path[path.length - 1].level >= h.level) path.pop()
    if (h.level === 1) continue
    path.push(h)
    out.push(path.map((p) => p.title).join("/"))
  }
  return out
}

export function addFolder(body: string, folder: string): { body: string; added: boolean } {
  const f = folderPath(folder)
  if (!f || readFolders(body).some((x) => x.toLowerCase() === f.toLowerCase())) return { body, added: false }
  const lines = body.split("\n")
  insertInto(lines, f, [])
  return { body: finish(lines, true), added: true }
}

const sectionOf = (body: string, folder: string) => {
  const { text, info } = linesOf(body)
  const f = folderPath(folder)
  return { text, s: f ? find(info, f.split("/"), { at: -1, end: text.length, level: 1 }) : null }
}

export function renameFolder(body: string, folder: string, name: string): { body: string; changed: boolean; taken?: boolean } {
  const { text, s } = sectionOf(body, folder)
  const to = name.replace(/\//g, "-").replace(/\s+/g, " ").trim()
  if (!s || !to) return { body, changed: false }
  const parent = folderPath(folder).split("/").slice(0, -1).join("/")
  const was = folderPath(folder).split("/").pop()!
  if (to === was) return { body, changed: false }
  if (to.toLowerCase() !== was.toLowerCase() && readFolders(body).some((x) => x.toLowerCase() === (parent ? `${parent}/${to}` : to).toLowerCase())) return { body, changed: false, taken: true }
  text[s.at] = `${"#".repeat(s.level)} ${to}`
  return { body: text.join("\n"), changed: true }
}

export function removeFolder(body: string, folder: string): { body: string; removed: number; found: boolean } {
  const { text, s } = sectionOf(body, folder)
  if (!s) return { body, removed: 0, found: false }
  const removed = readBookmarks(text.slice(s.at, s.end).join("\n")).length
  let at = s.at
  if (s.end >= text.length) while (at > 0 && !text[at - 1].trim()) at--
  text.splice(at, s.end - at)
  return { body: finish(text, /\n$/.test(body)), removed, found: true }
}

function linesOfUrl(body: string, url: string): { text: string[]; at: number[] } {
  const { text, info } = linesOf(body)
  const at = text.flatMap((l, i) => {
    if (info[i].heading || info[i].code) return []
    const m = LINK.exec(l), bare = m ? null : BARE.exec(l)
    return (m ? m[2].replace(/^<|>$/g, "").trim() : bare?.[1]) === url ? [i] : []
  })
  return { text, at }
}

export function removeBookmark(body: string, url: string): { body: string; removed: number } {
  const { text, at } = linesOfUrl(body, url)
  const gone = new Set(at)
  return { body: text.filter((_, i) => !gone.has(i)).join("\n"), removed: at.length }
}

export function editBookmark(body: string, url: string, change: { title?: string; folder?: string; before?: string }): { body: string; changed: boolean } {
  const all = readBookmarks(body), was = all.find((b) => b.url === url)
  if (!was) return { body, changed: false }
  const title = change.title ?? was.title
  const folder = change.folder === undefined ? undefined : folderPath(change.folder)
  const into = folder ?? was.folder
  const next = all.find((b) => b.url === change.before && b.folder === into && b.url !== url)
  const list = all.filter((b) => b.folder === into)
  const placed = change.before !== undefined && (next ? list[list.findIndex((b) => b.url === next.url) - 1]?.url !== url : list[list.length - 1]?.url !== url)
  if (into !== was.folder || placed) {
    const { text, at } = linesOfUrl(body, url)
    const line = title === was.title ? text[at[0]] : bookmarkLine({ url, title })
    const lines = text.filter((_, i) => !at.includes(i))
    const before = next ? linesOfUrl(lines.join("\n"), next.url).at[0] : undefined
    insertInto(lines, into, [line.replace(/^\s+/, "")], before)
    return { body: finish(lines, true), changed: true }
  }
  if (title === was.title) return { body, changed: false }
  const { text, at } = linesOfUrl(body, url)
  for (const i of at) text[i] = (/^\s*[-*+][ \t]+(?:\[[ xX]\][ \t]+)?/.exec(text[i])?.[0] ?? "- ") + bookmarkLine({ url, title }).slice(2)
  return { body: text.join("\n"), changed: true }
}

export function matchBookmarks(all: Bookmark[], text: string, limit = 3): Bookmark[] {
  const ws = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (!ws.length) return []
  return all.flatMap((b) => {
    const t = b.title.toLowerCase(), u = b.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "")
    if (!ws.every((w) => t.includes(w) || u.includes(w))) return []
    const score = (u.startsWith(ws[0]) ? 4 : 0) + ws.filter((w) => new RegExp(`(^|\\W)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t)).length
    return [{ b, score }]
  }).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.b)
}
