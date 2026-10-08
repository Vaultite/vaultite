// A template's text made into a note's: {{title}}, {{date}}, {{time}} and {{date:YYYY-MM-DD}}-style formats filled
// in (Obsidian's syntax), and the keys every note gets on its own (id, dates) left out so the new note gets fresh ones.

/** The formats {{date}} and {{time}} use without one of their own (the settings'). */
export type Formats = { date: string; time: string }
export const FORMATS: Formats = { date: "YYYY-MM-DD", time: "HH:mm" }

/** `format`: the plugin API's formatDate (this file is both sides', so it imports neither's). */
export function fillVars(text: string, title: string, format: (d: Date, fmt: string) => string, now = new Date(), formats = FORMATS) {
  return text.replace(/\{\{\s*(title|date|time)(?::([^}]*))?\s*\}\}/gi, (_m, name: string, fmt?: string) => {
    const n = name.toLowerCase()
    if (n === "title") return title
    return format(now, fmt?.trim() || (n === "date" ? formats.date : formats.time))
  })
}

// Keys the app fills in itself for each file.
const OWN = new Set(["id", "created", "updated", "added"]) // (added: what books called created before)

/** Top-level keys of a frontmatter block's inner text, each with its lines (the key's line and what's indented under it). */
function entries(inner: string) {
  const out: [string, string][] = []
  for (const line of inner.split("\n")) {
    const m = /^([^\s#:][^:]*):(?:\s|$)/.exec(line)
    if (m) out.push([m[1].trim(), line])
    else if (out.length && line.trim()) out[out.length - 1][1] += `\n${line}`
  }
  return out
}

const inner = (fm: string) => { const m = /^---\n([\s\S]*?)\n?---/.exec(fm); return m ? m[1] : "" }

/** The template's frontmatter merged into a file's: its keys the file doesn't have yet are added at the end (the
 *  file's own values win), the app's own keys left out. Returns the new frontmatter block ("" if there's none). */
export function mergeFm(file: string, template: string) {
  const have = entries(inner(file))
  const keys = new Set(have.map(([k]) => k))
  const add = entries(inner(template)).filter(([k]) => !keys.has(k) && !OWN.has(k))
  if (!add.length) return file
  const lines = [...have.map(([, l]) => l), ...add.map(([, l]) => l)].join("\n")
  return `---\n${lines}\n---\n${file ? file.replace(/^---\n[\s\S]*?\n?---[ \t]*\n?/, "") : "\n"}`
}
