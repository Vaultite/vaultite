// A podcast's RSS feed, read leniently with no XML library: the show and its episodes, newest first.

export type Episode = { guid: string; title: string; date: string | null; audio: string; type: string; duration: number | null
  image: string | null; link: string; notes: string; transcript: { url: string; type: string } | null }
export type Show = { title: string; author: string; image: string | null; link: string; episodes: Episode[] }

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
export const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => e[0] === "#"
    ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m)

/** A tag's text (the first), decoded; "" for none. */
function tag(xml: string, name: string) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml)
  return m ? decode(m[1]).trim() : ""
}
/** An attribute of a tag (the first that has it). */
function attr(xml: string, name: string, key: string) {
  for (const m of xml.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))) {
    const a = new RegExp(`\\b${key}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(m[1])
    if (a) return decode(a[2] ?? a[3] ?? "").trim()
  }
  return ""
}

/** HTML show notes as plain Markdown-ish text: paragraphs and links kept, the rest dropped. */
export function plainNotes(html: string) {
  return decode(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, t: string) => {
      const text = t.replace(/<[^>]+>/g, "").trim()
      return text && text !== href ? `[${text}](${href})` : href
    })
    .replace(/<li\b[^>]*>/gi, "\n- ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h\d|ul|ol)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

/** "1:02:03", "62:03" or seconds, as seconds. */
function seconds(s: string): number | null {
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  const parts = s.split(":").map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return null
  return parts.reduce((a, n) => a * 60 + n, 0)
}

export function parseFeed(xml: string): Show {
  const channel = xml.replace(/<item\b[\s\S]*$/i, "")
  const image = attr(channel, "itunes:image", "href") || tag(tag(channel, "image"), "url") || null
  const episodes: Episode[] = []
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const it = m[1]
    const audio = attr(it, "enclosure", "url")
    if (!audio) continue
    const when = Date.parse(tag(it, "pubDate"))
    const transcripts = [...it.matchAll(/<podcast:transcript\b([^>]*)\/?>/gi)].map((t) => ({
      url: decode(/\burl\s*=\s*"([^"]*)"/i.exec(t[1])?.[1] ?? ""), type: /\btype\s*=\s*"([^"]*)"/i.exec(t[1])?.[1] ?? "" }))
      .filter((t) => t.url && /vtt|srt/i.test(t.type + t.url))
    episodes.push({
      guid: tag(it, "guid") || audio, title: tag(it, "title") || "Episode",
      date: Number.isFinite(when) ? new Date(when).toISOString().slice(0, 10) : null,
      audio, type: attr(it, "enclosure", "type"), duration: seconds(tag(it, "itunes:duration")),
      image: attr(it, "itunes:image", "href") || null, link: tag(it, "link"),
      notes: plainNotes(tag(it, "content:encoded") || tag(it, "description") || tag(it, "itunes:summary")),
      transcript: transcripts.find((t) => /vtt/i.test(t.type + t.url)) ?? transcripts[0] ?? null,
    })
  }
  episodes.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
  return { title: tag(channel, "title") || "Podcast", author: tag(channel, "itunes:author"), image, link: tag(channel, "link"), episodes }
}

/** SRT as WebVTT (the browser's captions read only VTT). */
export const srtToVtt = (srt: string) => "WEBVTT\n\n" + srt.replace(/\r/g, "").replace(/(\d\d:\d\d:\d\d),(\d{3})/g, "$1.$2").trim() + "\n"

/** A VTT as paragraphs a minute long, each starting with its time in bold (the Player plays a note's times). */
export function paragraphs(vtt: string) {
  const out: string[] = []
  let last = "", start = -1, cur: string[] = []
  for (const block of vtt.split(/\r?\n\r?\n/)) {
    const m = /(?:(\d+):)?(\d\d):(\d\d)\.\d+\s*-->/.exec(block)
    if (!m) continue
    const secs = Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])
    const lines = block.split(/\r?\n/)
    const text = lines.slice(lines.findIndex((l) => l.includes("-->")) + 1).map((l) => decode(l.replace(/<[^>]+>/g, "")).trim()).filter(Boolean)
    for (const l of text) {
      if (l === last) continue
      last = l
      if (start < 0 || secs - start >= 60) { if (cur.length) out.push(cur.join(" ")); start = secs; cur = [`**${clock(secs)}**`] }
      cur.push(l)
    }
  }
  if (cur.length) out.push(cur.join(" "))
  return out.join("\n\n")
}

export const clock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(Math.floor(s % 60)).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}
