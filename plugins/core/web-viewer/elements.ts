// Blocked elements: hiding rules (`example.com##selector`) in the user's note Blocked elements.md (type blocked-elements),
// a heading per site; read and changed here, the same on the server (plugin.ts) and in the app.

/** A rule as the note has it, and the site it's for ("" for every site). */
export type ElementRule = { rule: string; site: string; selector: string }

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/
// (sites, comma-separated, `~` for one left out; then ## and a selector, which a heading's "## " never is)
const RULE = /^([a-z0-9.*~,_-]*)##(\S.*)$/i

/** The rule a line holds, if it's one: as is, or a list item, either in backticks (words after them are a note). */
export function ruleOf(line: string): ElementRule | null {
  let t = line.trim().replace(/^[-*+][ \t]+/, "").trim()
  const code = /^(`+)\s?(.*?)\s?\1(?:\s.*)?$/.exec(t)
  if (code) t = code[2].trim()
  const m = RULE.exec(t)
  if (!m || m[2].length > 2000) return null
  const site = m[1].split(",").map((s) => s.trim().toLowerCase()).find((s) => s && !s.startsWith("~")) ?? ""
  return { rule: `${m[1].toLowerCase()}##${m[2].trim()}`, site, selector: m[2].trim() }
}

/** Every rule in a note's body, in order, once each (in a code block too: a pasted list). */
export function readRules(body: string): ElementRule[] {
  const seen = new Set<string>(), out: ElementRule[] = []
  for (const l of body.split("\n")) {
    if (FENCE.test(l)) continue
    const r = ruleOf(l)
    if (r && !seen.has(r.rule)) { seen.add(r.rule); out.push(r) }
  }
  return out
}

/** A rule from a site and a selector, or a whole rule as given ("youtube.com##ytd-reel-shelf-renderer"); null if it
 *  isn't one. */
export function makeRule(rule: string, site?: string): ElementRule | null {
  const t = rule.trim()
  if (!t || /[\n\r]/.test(t)) return null
  if (t.includes("##")) return ruleOf(t)
  const s = (site ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")
  if (s && !/^[a-z0-9.-]+$/.test(s)) return null
  return ruleOf(`${s}##${t}`)
}

/** A rule as its line: in backticks, so Markdown leaves its `*` and `[ ]` alone. */
export const ruleLine = (r: string) => (r.includes("`") ? `- \`\` ${r} \`\`` : `- \`${r}\``)
const headingOf = (site: string) => site || "Every site"

/** `rule` added under its site's heading (made when missing), unless the note has it: only lines added. */
export function addRule(body: string, rule: ElementRule): { body: string; added: boolean } {
  if (readRules(body).some((r) => r.rule === rule.rule)) return { body, added: false }
  const lines = body ? body.replace(/\n+$/, "").split("\n") : []
  const want = headingOf(rule.site).toLowerCase()
  let at = -1, end = lines.length, fenced = false
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) { fenced = !fenced; continue }
    const h = fenced ? null : HEADING.exec(lines[i])
    if (!h) continue
    if (at >= 0) { end = i; break }
    if (h[1].length === 2 && h[2].toLowerCase() === want) at = i
  }
  if (at < 0) {
    const block = [`## ${headingOf(rule.site)}`, "", ruleLine(rule.rule)]
    const out = lines.length ? [...lines, "", ...block] : block
    return { body: `${out.join("\n")}\n`, added: true }
  }
  // (after the section's last line that isn't blank)
  let put = end
  while (put > at + 1 && !lines[put - 1].trim()) put--
  const block = put === at + 1 ? ["", ruleLine(rule.rule)] : [ruleLine(rule.rule)]
  lines.splice(put, 0, ...block)
  return { body: `${lines.join("\n")}\n`, added: true }
}

/** `rule`'s lines taken out, and the heading above them if nothing else is left under it. */
export function removeRule(body: string, rule: string): { body: string; removed: boolean } {
  const lines = body.split("\n")
  const gone = new Set(lines.flatMap((l, i) => (ruleOf(l)?.rule === rule ? [i] : [])))
  if (!gone.size) return { body, removed: false }
  // The sections they were in: a heading's line, and the end of what's under it.
  for (const i of [...gone]) {
    let h = i
    while (h >= 0 && !HEADING.exec(lines[h])) h--
    if (h < 0) continue
    let end = i + 1
    while (end < lines.length && !HEADING.exec(lines[end])) end++
    let left = false
    for (let j = h + 1; j < end; j++) if (!gone.has(j) && lines[j].trim()) left = true
    if (!left) for (let j = h; j < end; j++) gone.add(j)
  }
  const out = lines.filter((_, i) => !gone.has(i))
  // (no blank lines doubled where a section was, nor at the ends)
  const tidy = out.filter((l, i) => l.trim() || (i > 0 && out[i - 1].trim()))
  while (tidy.length && !tidy[tidy.length - 1].trim()) tidy.pop()
  while (tidy.length && !tidy[0].trim()) tidy.shift()
  return { body: tidy.length ? `${tidy.join("\n")}\n` : "", removed: true }
}

/** Parts of sites hidden with one click (the Shields menu; the plugin's `hide` setting): off until chosen, kept up to
 *  date with the app, so they're not the note's. */
export type Preset = { id: string; site: string; name: string; rules: string[] }
export const PRESETS: Preset[] = [
  { id: "youtube-shorts", site: "youtube.com", name: "Hide Shorts", rules: [
    "youtube.com##ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])",
    "youtube.com##ytd-rich-shelf-renderer[is-shorts]",
    "youtube.com##ytd-reel-shelf-renderer",
    "youtube.com##grid-shelf-view-model:has(ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2)",
    "youtube.com##ytd-rich-item-renderer:has(a[href^=\"/shorts/\"])",
    "youtube.com##ytd-video-renderer:has(a[href^=\"/shorts/\"])",
    "youtube.com##ytd-guide-entry-renderer:has(a[title=\"Shorts\"])",
    "youtube.com##ytd-mini-guide-entry-renderer[aria-label=\"Shorts\"]",
    "youtube.com##yt-tab-shape[tab-title=\"Shorts\"]",
  ] },
  { id: "youtube-recommendations", site: "youtube.com", name: "Hide recommendations", rules: [
    "youtube.com##ytd-browse[page-subtype=\"home\"] ytd-rich-grid-renderer",
    "youtube.com##ytd-watch-flexy #related",
    "youtube.com##.ytp-endscreen-content",
    "youtube.com##.ytp-ce-element",
  ] },
  { id: "youtube-comments", site: "youtube.com", name: "Hide comments", rules: [
    "youtube.com##ytd-comments#comments",
    "youtube.com##ytd-engagement-panel-section-list-renderer[target-id=\"engagement-panel-comments-section\"]",
  ] },
]

/** Whether `site` (a page's: "www.youtube.com" or "youtube.com") is `of` or under it. */
export const onSite = (site: string, of: string) => !of || site === of || site.endsWith(`.${of}`)
