// Bookmarks are a note of the user's (Bookmarks.md, `type: bookmarks`): folders are headings, a bookmark a `[title](url)`
// list item. Read and added to here, the same on the server (plugin.ts) and in the app. Shared with tools/test_web.ts.

/** A bookmark and its folder's path ("Bookmarks bar/Reading"; "" at the top). */
export type Bookmark = { url: string; title: string; folder: string }

const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const FENCE = /^\s*(```|~~~)/
const LINK = /^\s*[-*+][ \t]+(?:\[[ xX]\][ \t]+)?\[((?:\\.|[^\]\\])*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/
const BARE = /^\s*[-*+][ \t]+<?(https?:\/\/[^\s>]+)>?\s*$/i
const ITEM = /^\s*[-*+][ \t]/
const web = (u: string) => /^https?:\/\/\S+$/i.test(u)

type Line = { heading?: { level: number; title: string }; code?: boolean }
/** Each line's heading, if it is one (not inside a code block). */
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

/** The bookmarks in a note's body, in order. Its folders are its headings below the first level (a `# Title` is the note's). */
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

/** A bookmark as its list item. */
export function bookmarkLine(b: Pick<Bookmark, "url" | "title">) {
  const title = (b.title || hostOf(b.url)).replace(/\s+/g, " ").replace(/([[\]\\])/g, "\\$1")
  const url = /[\s()<>]/.test(b.url) ? `<${b.url.replace(/[<>]/g, encodeURIComponent)}>` : b.url
  return `- [${title}](${url})`
}
const hostOf = (u: string) => { try { return new URL(u).host.replace(/^www\./, "") } catch { return u } }

/** Where a folder's section is: its heading's line and the end of everything under it (the next heading as high). */
type Section = { at: number; end: number; level: number }

/** The section of folder `parts` (under `within`), if the note has it. */
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

/** `bookmarks` added to a note's body (those it hasn't already), each under its folder's heading, made when missing:
 *  only lines added, nothing of the user's changed. */
export function addBookmarks(body: string, bookmarks: Bookmark[]): { body: string; added: number } {
  const have = new Set(readBookmarks(body).map((b) => b.url))
  const groups = new Map<string, Bookmark[]>()
  for (const b of bookmarks) {
    if (!web(b.url) || have.has(b.url)) continue
    have.add(b.url)
    const f = b.folder.split("/").map((x) => x.trim()).filter(Boolean).slice(0, 5).join("/")
    groups.set(f, [...(groups.get(f) ?? []), b])
  }
  let lines = body.split("\n")
  let added = 0
  for (const [folder, list] of groups) {
    const { info } = linesOf(lines.join("\n"))
    // (the whole note, as a section above every folder: a `# Title` is passed through)
    const top: Section = { at: -1, end: lines.length, level: 1 }
    const parts = folder ? folder.split("/") : []
    // The deepest folder of the path the note has, and the levels still to make under it.
    let have = 0, under = top
    for (let n = parts.length; n > 0; n--) { const s = find(info, parts.slice(0, n), top); if (s) { have = n; under = s; break } }
    const make = parts.slice(have)
    const items = list.map(bookmarkLine)
    let at: number, block: string[]
    if (!make.length) {
      // Its own links: after the last line before its first subfolder, or its end.
      at = under.at + 1
      while (at < under.end && !(info[at].heading && info[at].heading!.level > under.level)) at++
      while (at > under.at + 1 && !lines[at - 1].trim()) at--
      block = [...items]
    } else {
      at = under.end
      while (at > under.at + 1 && !lines[at - 1].trim()) at--
      block = make.flatMap((name, i) => ["", `${"#".repeat(Math.min(6, under.level + 1 + i))} ${name}`]).concat(items)
    }
    // (a blank line between it and a paragraph or a heading, as one would type it)
    const prose = (l: string | undefined) => !!l?.trim() && !ITEM.test(l)
    if (block[0] === "" && (at === 0 || !lines[at - 1].trim())) block.shift()
    else if (block[0] !== "" && prose(lines[at - 1])) block.unshift("")
    if (prose(lines[at])) block.push("")
    lines.splice(at, 0, ...block)
    added += items.length
  }
  lines = lines.length === 1 && !lines[0] ? [] : lines
  const text = lines.join("\n")
  return { body: added && !text.endsWith("\n") ? `${text}\n` : text, added }
}

/** Bookmarks whose title or address has every word of `text`, best first (a title's word starting so first). */
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
