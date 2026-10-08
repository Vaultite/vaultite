// The places inside a note that links name (headings, ^block ids, #tags, %%comments%%), shared by server and app so both
// read a note alike: no Node here.

export type Heading = { level: number; text: string; line: number }

export const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const FRONT = /^---\n(?:[\s\S]*?\n)?---[ \t]*(?:\n|$)/
const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
/** A block id: `^id` (letters, digits and dashes) at the end of a line, after a space or alone on it. */
export const BLOCK_ID = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/
const LIST = /^([ \t]*)(?:[-*+]|\d+[.)])(?:[ \t]|$)/

/** A code fence: its opening line, its closing line (null: not closed, so it runs to the end) and its info (`js`,
 *  `block-person`); lines 0-based. */
export type Fence = { open: number; close: number | null; info: string }

/** Each line of a text, whether it's prose or code (fences, frontmatter), and its fences. A fence closes only with its
 *  own character, at least as long, like CommonMark: everything looking for Markdown outside code reads fences here. */
export function scan(text: string): { lines: string[]; prose: boolean[]; code: boolean[]; fences: Fence[] } {
  const lines = text.split("\n")
  const prose = lines.map(() => true)
  const code = lines.map(() => false)
  const fences: Fence[] = []
  let i = 0
  const fm = FRONT.exec(text)
  if (fm) for (const n = fm[0].replace(/\n$/, "").split("\n").length; i < n; i++) { prose[i] = false; code[i] = true }
  let fence: string | null = null
  let comment = false
  for (; i < lines.length; i++) {
    const l = lines[i]
    const f = FENCE.exec(l)
    if (!comment && f && (fence === null || (f[1][0] === fence[0] && f[1].length >= fence.length && !l.trim().slice(f[1].length).trim()))) {
      if (fence === null) fences.push({ open: i, close: null, info: l.trim().slice(f[1].length).trim() })
      else fences[fences.length - 1].close = i
      fence = fence === null ? f[1] : null
      prose[i] = false
      code[i] = true
      continue
    }
    if (fence !== null) { prose[i] = false; code[i] = true; continue }
    // A %% on its own opens (or closes) a comment block; %%inline%% pairs on one line don't.
    const marks = (l.replace(/`+[^`]*`+/g, "").match(/%%/g) ?? []).length
    if (comment || marks % 2) prose[i] = false
    if (marks % 2) comment = !comment
  }
  return { lines, prose, code, fences }
}

/** A ```block-<name> fence's name, from its info line (its first word, like a code fence's language), or null. */
export function blockName(info: string): string | null {
  return /^block-([\w-]+)$/.exec(info.trim().split(/\s/)[0])?.[1] ?? null
}

/** The block a line opens (```block-person, ~~~block-person), or null. */
export function blockOpening(line: string): string | null {
  const f = FENCE.exec(line)
  return f ? blockName(line.trim().slice(f[1].length)) : null
}

/** A block a text places: its name, its options' text and the lines its fence opens and closes on (0-based). */
export type Placed = { name: string; text: string; open: number; close: number }

/** The blocks a text places, in order: closed ```block-<name> fences (one being typed isn't one yet, one inside another
 *  fence is code). The one reading of blocks, for the server, the editor and the app. */
export function blocksIn(text: string, s = scan(text)): Placed[] {
  if (!text.includes("block-")) return []
  const out: Placed[] = []
  for (const f of s.fences) {
    const name = f.close !== null ? blockName(f.info) : null
    if (name) out.push({ name, text: s.lines.slice(f.open + 1, f.close!).join("\n"), open: f.open, close: f.close! })
  }
  return out
}

/** A text without its blocks (each with the blank lines after it), and blank lines at its ends when it had any. */
export function withoutBlocks(text: string): string {
  const s = scan(text), placed = blocksIn(text, s)
  if (!placed.length) return text
  const keep = s.lines.map(() => true)
  for (const b of placed) {
    let i = b.open
    for (; i <= b.close; i++) keep[i] = false
    for (; i < s.lines.length && !s.lines[i].trim(); i++) keep[i] = false
  }
  return s.lines.filter((_, i) => keep[i]).join("\n").replace(/^\n+|\n+$/g, "")
}

/** The heading text as an anchor matches it: the link rules (no [[ ]], # | ^ : %%), any case, any spacing. */
/** `[[target|shown]]` links as the text they show. */
export const linkText = (s: string) => s.replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, t: string, a?: string) => a || t)
export function anchorKey(s: string) {
  return linkText(s)
    .replace(/[*_=~`]/g, "")
    .replace(/[#|^:%[\]\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** Every `# heading` of a text (ATX), in order, with its line (0-based). Not in code, comments or the frontmatter. */
export function headingsOf(text: string): Heading[] {
  const { lines, prose } = scan(text)
  const out: Heading[] = []
  lines.forEach((l, i) => {
    if (!prose[i]) return
    const m = ATX.exec(l)
    if (m) out.push({ level: m[1].length, text: m[2].replace(BLOCK_ID, "").trim(), line: i })
  })
  return out
}

/** A heading by name (`Heading`, or `Parent#Child` for one under another), or null. */
export function findHeading(text: string, name: string): Heading | null {
  const parts = name.split("#").map(anchorKey).filter(Boolean)
  if (!parts.length) return null
  const hs = headingsOf(text)
  let from = 0
  let hit: Heading | null = null
  for (const p of parts) {
    const k = hs.findIndex((h, j) => j >= from && anchorKey(h.text) === p)
    if (k < 0) return null
    hit = hs[k]
    from = k + 1
  }
  return hit
}

/** A heading's section: its line up to the next heading of the same or a higher level (lines, end exclusive). */
export function sectionOf(text: string, h: Heading): [number, number] {
  const hs = headingsOf(text)
  const next = hs.find((x) => x.line > h.line && x.level <= h.level)
  const lines = text.split("\n")
  let end = next ? next.line : lines.length
  while (end > h.line + 1 && !lines[end - 1].trim()) end--
  return [h.line, end]
}

/** Where a block id is: the paragraph or list item it ends (lines, end exclusive), and the line it's written on. */
export function findBlock(text: string, id: string): { from: number; to: number; line: number } | null {
  const want = id.replace(/^\^/, "").toLowerCase()
  const { lines, prose } = scan(text)
  const blank = (i: number) => !lines[i].trim()
  for (let i = 0; i < lines.length; i++) {
    if (!prose[i]) continue
    const m = BLOCK_ID.exec(lines[i])
    if (!m || m[1].toLowerCase() !== want) continue
    // Alone on its line: the block just above it (a list, a table, a quote), past a blank line.
    if (lines[i].trim() === `^${m[1]}`) {
      let j = i - 1
      while (j >= 0 && blank(j)) j--
      if (j < 0) return null
      let s = j
      while (s > 0 && !blank(s - 1) && !ATX.test(lines[s - 1])) s--
      return { from: s, to: j + 1, line: i }
    }
    // A list item: it and what's indented under it.
    const li = LIST.exec(lines[i])
    if (li) {
      let s = i
      while (s > 0 && !LIST.test(lines[s]) && !blank(s - 1)) s-- // (a continuation line: its item starts above)
      const indent = (LIST.exec(lines[s])?.[1] ?? "").length
      let e = i + 1
      while (e < lines.length && !blank(e) && !(LIST.exec(lines[e]) && LIST.exec(lines[e])![1].length <= indent)) e++
      return { from: s, to: e, line: i }
    }
    // A paragraph: back to the blank line (or heading) above it.
    let s = i
    while (s > 0 && !blank(s - 1) && !ATX.test(lines[s - 1]) && prose[s - 1]) s--
    if (ATX.test(lines[i])) s = i
    return { from: s, to: i + 1, line: i }
  }
  return null
}

/** The line to go to for an anchor (`Heading`, `A#B`, `^id`), or null. */
export function anchorLine(text: string, anchor: string): number | null {
  const a = anchor.trim()
  if (!a) return null
  if (a.startsWith("^")) return findBlock(text, a)?.from ?? null
  return findHeading(text, a)?.line ?? null
}

/** What an embed shows: the whole text, a heading's section (`Heading`) or a block (`^id`, its id taken off); null if
 *  the anchor isn't there. */
export function extract(text: string, anchor: string): string | null {
  const a = anchor.trim()
  if (!a) return text
  const lines = text.split("\n")
  if (a.startsWith("^")) {
    const b = findBlock(text, a)
    if (!b) return null
    return lines.slice(b.from, b.to).map((l) => l.replace(BLOCK_ID, "")).join("\n").replace(/\s+$/, "")
  }
  const h = findHeading(text, a)
  if (!h) return null
  const [from, to] = sectionOf(text, h)
  return lines.slice(from, to).join("\n")
}

/** `Note#Heading` -> ["Note", "Heading"]; `#Heading` -> ["", "Heading"]; `Note#^id` -> ["Note", "^id"]. */
export function splitAnchor(target: string): [string, string] {
  const i = target.indexOf("#")
  return i < 0 ? [target.trim(), ""] : [target.slice(0, i).trim(), target.slice(i + 1).trim()]
}

// ---------- tags ----------

/** An inline #tag: after the line's start or a space; letters, digits, _ - and / (nesting), not only digits. */
export const TAG = /(?<=^|[ \t])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu

/** A tag written the way it's matched: no #, no slashes at its ends. */
export const tagName = (t: string) => t.trim().replace(/^#/, "").replace(/^\/+|\/+$/g, "")

/** The inline #tags in a body, each once (the first spelling kept): not in code, comments, links or URLs. */
export function tagsIn(body: string): string[] {
  if (!body.includes("#")) return []
  const { lines, prose } = scan(body)
  const out = new Map<string, string>()
  lines.forEach((l, i) => {
    if (!prose[i] || !l.includes("#")) return
    const clean = l
      .replace(/(`+)(?:(?!\1).)+?\1/g, " ")
      .replace(/%%.*?%%/g, " ")
      .replace(/!?\[\[[^\]\n]*\]\]/g, " ")
      .replace(/\]\([^)\n]*\)/g, "] ")
      .replace(/<?[a-z][a-z0-9+.-]*:\/\/\S*/gi, " ")
    for (const m of clean.matchAll(TAG)) {
      const t = tagName(m[1])
      if (t && !out.has(t.toLowerCase())) out.set(t.toLowerCase(), t)
    }
  })
  return [...out.values()]
}

/** A body with #from, and the tags nested under it, renamed `to` where tagsIn reads tags (not in code, comments, links
 *  or URLs); the rest of each line as it was. */
export function renameTagsIn(body: string, from: string, to: string): string {
  const f = tagName(from).toLowerCase(), t = tagName(to)
  if (!body.includes("#") || !f) return body
  const { lines, prose } = scan(body)
  const blank = (m: string) => " ".repeat(m.length)
  return lines.map((l, i) => {
    if (!prose[i] || !l.includes("#")) return l
    const masked = l.replace(/(`+)(?:(?!\1).)+?\1/g, blank).replace(/%%.*?%%/g, blank).replace(/!?\[\[[^\]\n]*\]\]/g, blank)
      .replace(/\]\([^)\n]*\)/g, blank).replace(/<?[a-z][a-z0-9+.-]*:\/\/\S*/gi, blank)
    let out = "", at = 0
    for (const m of masked.matchAll(TAG)) {
      const low = m[1].toLowerCase()
      if (low !== f && !low.startsWith(`${f}/`)) continue
      const start = m.index! + 1
      out += l.slice(at, start) + t + m[1].slice(f.length)
      at = start + m[1].length
    }
    return out + l.slice(at)
  }).join("\n")
}

/** A frontmatter `tags` value as a list: a YAML list, or text split on commas (and spaces). */
export function fmTags(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.map((x) => String(x ?? "")) : typeof v === "string" ? v.split(/[,\s]+/) : v == null ? [] : [String(v)]
  return raw.map(tagName).filter(Boolean)
}

/** A file's tags: its frontmatter `tags` (or `tag`), then its inline #tags, each once. */
export function tagsOf(fm: Record<string, unknown>, body: string): string[] {
  const out = new Map<string, string>()
  for (const t of [...fmTags(fm.tags ?? fm.tag), ...tagsIn(body)]) if (!out.has(t.toLowerCase())) out.set(t.toLowerCase(), t)
  return [...out.values()]
}

/** Whether a file's tags have this one, or one nested under it (`project` matches `project/lighthouse`). */
export function hasTag(tags: string[], want: string) {
  const w = tagName(want).toLowerCase()
  return tags.some((t) => { const x = t.toLowerCase(); return x === w || x.startsWith(`${w}/`) })
}

// ---------- what reading hides ----------

/** A text as reading shows it: %%comments%% and block ids (`^id`) taken out, code and the frontmatter left alone. */
export function stripHidden(text: string): string {
  if (!text.includes("%%") && !text.includes("^")) return text
  const { lines, code } = scan(text)
  const out: string[] = []
  let inComment = false
  for (let i = 0; i < lines.length; i++) {
    if (code[i]) { out.push(lines[i]); continue }
    let kept = "", rest = lines[i]
    while (rest) {
      const at = rest.indexOf("%%")
      if (at < 0) { if (!inComment) kept += rest; break }
      if (!inComment) kept += rest.slice(0, at)
      rest = rest.slice(at + 2)
      inComment = !inComment
    }
    if (BLOCK_ID.test(kept)) kept = kept.replace(BLOCK_ID, "")
    // A line that held only a comment or an id goes; a blank line stays.
    if (!kept.trim() && lines[i].trim()) continue
    out.push(kept.trimEnd())
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n")
}
