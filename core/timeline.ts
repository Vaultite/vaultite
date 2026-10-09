// A `## Timeline` section, read leniently because people edit it by hand (any bullet or separator, "1h 30m", no kind).
// One parser for the server and the editor, so they agree; no Node here.
export type Entry = { date: string; kind: string; duration_min: number | null; subject: string; notes: string; url: string }

/** The kinds the app knows (an icon each, aliases below); any other word or two is a kind too ("coffee", "game night"). */
export const CONTACT_KINDS = ["call", "hang out", "meet", "study", "text", "message", "email"]
export const KINDS = new Set([...CONTACT_KINDS, "note"])
const ALIASES: Record<string, string> = {
  called: "call", phone: "call", "phone call": "call", "video call": "call", facetime: "call", calls: "call",
  hangout: "hang out", "hung out": "hang out", "hanging out": "hang out", met: "meet", meeting: "meet",
  meetup: "meet", "meet-up": "meet", "meet up": "meet", saw: "meet", texted: "text", texts: "text",
  sms: "text", imessage: "text", whatsapp: "message", messaged: "message", dm: "message", chat: "message",
  emailed: "email", "e-mail": "email", mail: "email", studied: "study", fact: "note", info: "note",
}
const ENTRY = /^\s{0,3}(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)\s*(.*)$/
const LEAD = /^(?:·|•|—|–|-|\||:|,)\s*/
const SEPS: [RegExp, string][] = [[/\s*·\s*/, " · "], [/\s*•\s*/, " • "], [/\s+\|\s+/, " | "], [/\s+[—–]\s+/, " — "], [/\s+-\s+/, " - "]]
const DURATION = /^(?:(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?))?\s*(?:(\d+)\s*(m|min|mins|minutes?))?$/i

export function minutes(part: string): number | null {
  const m = DURATION.exec(part.trim())
  if (!m || !(m[1] || m[3])) return null
  return Math.round(Number(m[1] ?? 0) * 60 + Number(m[3] ?? 0))
}
export const kindOf = (part: string) => { const k = part.toLowerCase().split(/\s+/).join(" "); return KINDS.has(k) ? k : ALIASES[k] ?? null }
/** What reads as a kind of its own at an entry's start: a word or two of letters. */
const OWN_KIND = /^\p{L}[\p{L} ]{0,15}$/u
const ownKind = (part: string) => OWN_KIND.test(part) && part.split(/\s+/).length <= 2

/** A kind to write (a known one by any alias, else any word or two, lower case), or null when it wouldn't read back
 *  as one. */
export function timelineKind(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().split(/\s+/).join(" ") : ""
  return kindOf(s) ?? (ownKind(s) ? s.toLowerCase() : null)
}

export function parseEntry(line: string): Entry | null {
  const m = ENTRY.exec(line)
  if (!m) return null
  const [, y, mo, d] = m
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null
  const rest = m[4].trim().replace(LEAD, "")
  const sep = SEPS.find(([r]) => r.test(rest))
  let parts = (sep ? rest.split(new RegExp(sep[0].source, "g")) : [rest]).map((x) => x.trim()).filter(Boolean)
  if (!parts.length) parts = [""]
  const i: Entry = { date: `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`, kind: "", duration_min: null, subject: "", notes: "", url: "" }
  let k = kindOf(parts[0])
  if (k === null && parts.length > 1 && ownKind(parts[0])) k = parts[0].toLowerCase()
  if (k !== null) parts = parts.slice(1)
  i.kind = k ?? "note"
  const stuck = k === null && parts.length ? /^(.+?)\s+(\d+\s*(?:m|min|mins|minutes?|h|hr|hrs|hours?))$/i.exec(parts[0]) : null
  if (stuck && kindOf(stuck[1])) { i.kind = kindOf(stuck[1])!; i.duration_min = minutes(stuck[2]); parts = parts.slice(1) }
  const text: string[] = []
  parts.forEach((part, n) => {
    if (!text.length && i.duration_min === null && minutes(part) !== null) i.duration_min = minutes(part)
    else if (!text.length && !i.subject && /^\*\*.+\*\*$/.test(part)) i.subject = part.slice(2, -2)
    else if (/^<https?:\/\/\S+>$/.test(part)) i.url = part.slice(1, -1)
    else if (/^https?:\/\/\S+$/.test(part) && n === parts.length - 1) i.url = part
    else text.push(part)
  })
  i.notes = text.join(sep ? sep[1] : " · ")
  return i
}

/** The entries in a timeline section (the Markdown under its heading), in file order. */
export function parseTimeline(text: string): Entry[] {
  const out: Entry[] = []
  let last: Entry | null = null
  for (const raw of text.split("\n")) {
    const e = parseEntry(raw)
    if (e) { out.push(e); last = e; continue }
    if (/^[ \t]/.test(raw) && raw.trim() && last) { last.notes = `${last.notes}\n${raw.trim()}`.trim(); continue }
    last = null
  }
  return out
}

/** The lines of a timeline section that aren't entries (nor their continuation lines): text typed there that isn't
 *  one, which a drawn timeline shows as it is rather than hiding it. */
export function strayLines(text: string): string[] {
  const out: string[] = []
  let last = false
  for (const raw of text.split("\n")) {
    if (parseEntry(raw)) { last = true; continue }
    if (/^[ \t]/.test(raw) && raw.trim() && last) continue
    last = false
    if (raw.trim()) out.push(raw)
  }
  return out
}

/** The timeline section of a whole body (under a "Timeline" heading, up to the next heading of its level or higher). */
export function timelineOf(body: string): Entry[] {
  const lines = body.split("\n")
  const at = lines.findIndex((l) => /^#{1,6}\s+timeline\s*#*\s*$/i.test(l))
  if (at < 0) return []
  const level = /^(#+)/.exec(lines[at])![1].length
  const end = lines.findIndex((l, n) => n > at && /^(#{1,6})\s/.test(l) && /^(#+)/.exec(l)![1].length <= level)
  return parseTimeline(lines.slice(at + 1, end < 0 ? undefined : end).join("\n"))
}

/** An entry to write: what's left out isn't written. */
export type NewEntry = { date: string; kind: string; duration_min?: number | null; subject?: string; notes?: string; url?: string }

/** Why an entry can't be written as it is, or null: a kind of the user's own alone would read back as a note. */
export function entryProblem(e: NewEntry): string | null {
  if (KINDS.has(e.kind) || e.duration_min || e.subject || e.notes?.trim() || e.url) return null
  return `'${e.kind}' alone would read as a note: add what it was about or how long`
}

/** The canonical line for an entry, `- 2026-09-26 · call · 20 min · **Subject** · notes · <https://url>` (notes on
 *  several lines continue indented). */
export function entryLine(e: NewEntry) {
  const parts = [e.date, e.kind]
  if (e.duration_min) parts.push(`${Math.trunc(e.duration_min)} min`)
  if (e.subject) parts.push(`**${e.subject}**`)
  if (e.notes?.trim()) parts.push(e.notes.trim())
  if (e.url) parts.push(`<${e.url}>`)
  return ("- " + parts.join(" · ")).replaceAll("\n", "\n  ")
}

/** The file's text with an entry added to its first timeline section, placed by date, newest first; every other line
 *  stays. null: the file has no timeline section. */
export function addEntry(text: string, e: NewEntry): string | null {
  const lines = text.split("\n")
  let start = 0
  if (lines[0] === "---") { const end = lines.findIndex((l, n) => n > 0 && (l === "---" || l === "...")); if (end > 0) start = end + 1 }
  let fence = "", at = -1, level = 0, end = lines.length
  for (let n = start; n < lines.length; n++) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[n])
    if (f) { if (!fence) fence = f[1]; else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = ""; continue }
    if (fence) continue
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[n])
    if (!h) continue
    if (at < 0 && h[2].toLowerCase() === "timeline") { at = n; level = h[1].length }
    else if (at >= 0 && h[1].length <= level) { end = n; break }
  }
  if (at < 0) return null
  const line = entryLine(e)
  let last = -1
  for (let n = at + 1; n < end; n++) {
    const x = parseEntry(lines[n])
    if (x) {
      if (x.date <= e.date) { lines.splice(n, 0, line); return lines.join("\n") }
      last = n
    } else if (last >= 0 && last === n - 1 && /^[ \t]/.test(lines[n]) && lines[n].trim()) last = n
  }
  if (last >= 0) lines.splice(last + 1, 0, line)
  else {
    // No entries yet: under the heading, a blank line on each side.
    let n = at + 1
    while (n < end && !lines[n].trim()) n++
    lines.splice(at + 1, n - at - 1, "", line, ...(n < lines.length || text.endsWith("\n") ? [""] : []))
  }
  return lines.join("\n")
}
