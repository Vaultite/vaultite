export type CiteItem = {
  key: string
  prefix: string
  suffix: string
  locator: string
  label: string
  suppressAuthor: boolean
}

export type Citation = {
  from: number
  to: number
  inText: boolean
  items: CiteItem[]
  source: string
}

const KEY = String.raw`(?:\{[^{}\n]+\}|[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[:.#$%&\-+?<>~/](?=[\p{L}\p{N}_]))*)`
const ITEM = new RegExp(String.raw`^(?<prefix>[^@]*?)(?<dash>-?)@(?<key>${KEY})(?<rest>[\s\S]*)$`, "u")
const IN_TEXT = new RegExp(String.raw`(?<![\p{L}\p{N}_@\[\]\\-])@(?<key>${KEY})(?:\s?\[(?<after>[^\[\]\n]*)\])?`, "gu")
const BRACKET = /\[([^[\]\n]*@[^[\]\n]*)\](?![([:])/g

const LABELS: [RegExp, string][] = [
  [/^(?:p|pp|page|pages)\b\.?/i, "page"], [/^(?:ch|chap|chaps|chapter|chapters)\b\.?/i, "chapter"],
  [/^(?:sec|secs|section|sections|§|§§)(?:\b\.?|(?=\s|\d))/i, "section"], [/^(?:fig|figs|figure|figures)\b\.?/i, "figure"],
  [/^(?:l|ll|line|lines)\b\.?/i, "line"], [/^(?:n|nn|note|notes)\b\.?/i, "note"], [/^(?:para|paras|paragraph|paragraphs|¶|¶¶)\b\.?/i, "paragraph"],
  [/^(?:vol|vols|volume|volumes)\b\.?/i, "volume"], [/^(?:bk|bks|book|books)\b\.?/i, "book"], [/^(?:col|cols|column|columns)\b\.?/i, "column"],
  [/^(?:fol|fols|folio|folios)\b\.?/i, "folio"], [/^(?:no|nos|number|numbers)\b\.?/i, "number"], [/^(?:op|opp|opus|opera)\b\.?/i, "opus"],
  [/^(?:pt|pts|part|parts)\b\.?/i, "part"], [/^(?:s\.v\.|s\.vv\.|sub verbo)/i, "sub verbo"], [/^(?:v|vv|verse|verses)\b\.?/i, "verse"],
  [/^(?:art|arts|article|articles)\b\.?/i, "article"],
]

const keyOf = (raw: string) => (raw.startsWith("{") ? raw.slice(1, -1).trim() : raw)
export type Locator = { locator: string; label: string; suffix: string }
const NO_LOCATOR: Locator = { locator: "", label: "", suffix: "" }

export function splitLocator(text: string): Locator {
  const t = text.replace(/^\s*,?\s*/, "")
  for (const [re, label] of LABELS) {
    const m = re.exec(t)
    if (!m) continue
    const rest = t.slice(m[0].length).trimStart()
    const n = /^[\p{N}\p{L}]*\p{N}[\p{N}\p{L}\-–—,:]*(?:\s*(?:-|–|—|,|&|and)\s*[\p{N}\p{L}]+)*/u.exec(rest)
    if (n) return { locator: n[0].replace(/,$/, ""), label, suffix: rest.slice(n[0].replace(/,$/, "").length) }
  }
  const bare = /^(\d[\d\-–—,\s]*\d|\d+)(?=$|[\s,;])/.exec(t)
  if (bare) return { locator: bare[0].trim(), label: "page", suffix: t.slice(bare[0].length) }
  return { locator: "", label: "", suffix: text.trim() ? text : "" }
}

function itemOf(part: string): CiteItem | null {
  const m = ITEM.exec(part)
  if (!m?.groups) return null
  const rest = m.groups.rest
  const comma = /^\s*,/.test(rest)
  const loc = comma ? splitLocator(rest) : { ...NO_LOCATOR, suffix: rest }
  return { key: keyOf(m.groups.key), prefix: m.groups.prefix.trim(), suffix: loc.suffix.trim().replace(/^,\s*/, ""),
    locator: loc.locator, label: loc.label, suppressAuthor: m.groups.dash === "-" }
}

function bracketed(body: string): CiteItem[] | null {
  const items: CiteItem[] = []
  for (const part of body.split(";")) {
    const item = itemOf(part)
    if (!item) return null
    items.push(item)
  }
  return items.length ? items : null
}
function hidden(line: string): [number, number][] {
  const out: [number, number][] = []
  for (const m of line.matchAll(/(`+)[\s\S]*?\1|\$\$[\s\S]*?\$\$|\$[^$\s][^$]*?\$|<[^>\n]+>|\[\[[^\]\n]*\]\]|\]\([^)\n]*\)|https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+/g)) {
    out.push([m.index, m.index + m[0].length])
  }
  return out
}

const inside = (spans: [number, number][], a: number, b: number) => spans.some(([x, y]) => a < y && b > x)
function bracketCites(line: string, offset: number, spans: [number, number][]): Citation[] {
  const out: Citation[] = []
  for (const m of line.matchAll(BRACKET)) {
    const a = m.index, b = a + m[0].length
    if (inside(spans, a, b) || /^\[[\^!]/.test(m[0])) continue
    const items = bracketed(m[1])
    if (items) out.push({ from: offset + a, to: offset + b, inText: false, items, source: m[0] })
  }
  return out
}

function inTextCites(line: string, offset: number, spans: [number, number][]): Citation[] {
  const out: Citation[] = []
  for (const m of line.matchAll(IN_TEXT)) {
    const a = m.index, b = a + m[0].length
    if (!m.groups || inside(spans, a, b)) continue
    const loc = m.groups.after === undefined ? NO_LOCATOR : splitLocator(m.groups.after)
    const item: CiteItem = { key: keyOf(m.groups.key), prefix: "", suffix: loc.suffix.trim(), locator: loc.locator, label: loc.label, suppressAuthor: false }
    out.push({ from: offset + a, to: offset + b, inText: true, items: [item], source: m[0] })
  }
  return out
}

export function citationsInLine(line: string, offset = 0): Citation[] {
  const spans = hidden(line)
  const brackets = bracketCites(line, offset, spans)
  const taken: [number, number][] = [...spans, ...brackets.map((c): [number, number] => [c.from - offset, c.to - offset])]
  return [...brackets, ...inTextCites(line, offset, taken)].sort((x, y) => x.from - y.from)
}
export function citationsIn(text: string): Citation[] {
  const out: Citation[] = []
  let at = 0, fence: string | null = null, math = false
  const lines = text.split("\n")
  lines.forEach((line, i) => {
    const start = at
    at += line.length + 1
    if (i === 0 && line === "---") { fence = "---"; return }
    if (fence === "---") { if (line === "---" || line === "...") fence = null; return }
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f) { fence = fence === null ? f[1] : line.trim().startsWith(fence) ? null : fence; return }
    if (fence !== null) return
    if (line.trim() === "$$") { math = !math; return }
    if (math) return
    out.push(...citationsInLine(line, start))
  })
  return out
}

export const citedKeys = (cites: Citation[]) => [...new Set(cites.flatMap((c) => c.items.map((i) => i.key)))]
