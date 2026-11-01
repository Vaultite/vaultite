// Roam Research's JSON export: pages of nested blocks, as notes of nested lists. Roam's own syntax made the vault's:
// TODOs as tasks, ((block refs)) as their text, #[[tags]], __italics__, ^^highlights^^; daily pages named by date.

type Block = { string?: unknown; children?: unknown; uid?: unknown; heading?: unknown }
export type RoamNote = { name: string; title: string; body: string; created: number | null; updated: number | null }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const kids = (v: unknown): Block[] => (Array.isArray(v) ? v.filter(isObj) : []) as Block[]
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]

/** A daily page's title ("October 5th, 2026") as its date, or null. */
export function roamDate(title: string): string | null {
  const m = /^([A-Za-z]+) (\d{1,2})(?:st|nd|rd|th), (\d{4})$/.exec(title.trim())
  const mon = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1
  return m && mon >= 0 ? `${m[3]}-${String(mon + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}` : null
}

/** Every page of the export as a note, its links pointing at the names the pages get. */
export function roamNotes(json: unknown): RoamNote[] {
  const pages = (Array.isArray(json) ? json : []).filter((p): p is Record<string, unknown> => isObj(p) && typeof p.title === "string")
  const texts = new Map<string, string>()
  const index = (bs: Block[]) => { for (const b of bs) { if (typeof b.uid === "string") texts.set(b.uid, String(b.string ?? "")); index(kids(b.children)) } }
  for (const p of pages) index(kids(p.children))
  const nameOf = (title: string) => roamDate(title) ?? title
  // (code is left as written; a ref to a block being expanded already, a ring of refs, stays a ref)
  const inline = (s: string, seen: Set<string> = new Set()): string => s.split(/(```[\s\S]*?```|`[^`\n]+`)/).map((part, i) => (i % 2 ? part : part
    .replace(/\{\{\s*\[\[TODO\]\]\s*\}\}|\{\{\s*TODO\s*\}\}/g, "[ ]")
    .replace(/\{\{\s*\[\[DONE\]\]\s*\}\}|\{\{\s*DONE\s*\}\}/g, "[x]")
    .replace(/\{\{\s*(?:\[\[)?embed(?:\]\])?\s*:\s*\(\(([\w-]+)\)\)\s*\}\}|\(\(([\w-]+)\)\)/g, (all, a?: string, b?: string) => {
      const uid = (a ?? b)!, t = texts.get(uid)
      return t === undefined || seen.has(uid) ? all : inline(t, new Set([...seen, uid]))
    })
    // (a tag of a day is a link to it: a date isn't a tag)
    .replace(/#\[\[([^\]]+)\]\]/g, (_, t: string) => (roamDate(t) ? `[[${nameOf(t)}|${t}]]` : `#${t.trim().replace(/\s+/g, "-")}`))
    .replace(/\[\[([^\]]+)\]\]/g, (all: string, t: string) => (t.includes("|") ? all : nameOf(t) === t ? `[[${t}]]` : `[[${nameOf(t)}|${t}]]`))
    .replace(/__([^_\n]+)__/g, "*$1*")
    .replace(/\^\^([^^\n]+)\^\^/g, "==$1=="))).join("")
  const lines = (bs: Block[], depth: number): string[] => bs.flatMap((b) => {
    const text = inline(String(b.string ?? "")).replace(/^\[([ x])\]\s*/, "[$1] ")
    const level = Number(b.heading) || 0
    // (a heading at the top is a heading; deeper, an item)
    if (depth === 0 && level >= 1 && level <= 3) return [`${"#".repeat(level + 1)} ${text}`, ...lines(kids(b.children), 0)]
    const pad = "  ".repeat(depth)
    const [first, ...rest] = text.split("\n")
    return [`${pad}- ${first}`, ...rest.map((l) => `${pad}  ${l}`), ...lines(kids(b.children), depth + 1)]
  })
  return pages.map((p) => {
    const title = String(p.title)
    const time = (v: unknown) => (typeof v === "number" && v > 0 ? v : null)
    return { name: nameOf(title), title, body: lines(kids(p.children), 0).join("\n"), created: time(p["create-time"]), updated: time(p["edit-time"]) }
  })
}
