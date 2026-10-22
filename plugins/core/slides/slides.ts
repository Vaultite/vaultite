// A note's body as slides, read as Obsidian's Advanced Slides reads a deck (separators, notes, annotations, fragments,
// <style>), never inside code. No imports: tests run it on Node.

export type Annotation = { cls: string; style: string; index?: number; li?: boolean }
export type Slide = {
  /** What the slide shows (Markdown); an element annotation is an empty `<span class="slide-el-N">` in its place. */
  md: string
  /** Speaker notes (Markdown), or "". */
  notes: string
  /** Its column, and its place in that column (vertical slides). */
  h: number
  v: number
  /** Element annotations, by N. */
  els: Annotation[]
  /** From `<!-- slide … -->`: its background (a colour, an image's address or a [[link]]) and reveal's
   *  data-background-* (opacity, size, position, repeat), and a class and style for the slide. */
  bg?: string
  bgAttrs: Record<string, string>
  cls: string
  style: string
}
export type DeckOptions = { separator?: unknown; verticalSeparator?: unknown; notesSeparator?: unknown }

const SEP = /^\s{0,3}-{3,}\s*$/
const VSEP = /^\s{0,3}--\s*$/
const NOTES = /^\s*notes?:/i

/** A frontmatter regex (reveal's), as a line's: its surrounding line breaks dropped; a bad one is matched as text. */
function lineRegex(src: unknown, fallback: RegExp, flags = ""): RegExp {
  if (typeof src !== "string" || !src.trim()) return fallback
  const s = src.replace(/^(?:\\r\??)?\\n/, "").replace(/(?:\\r\??)?\\n$/, "")
  try { return new RegExp(s, flags) } catch { return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags) }
}

/** `text` with `fn` applied outside its code fences only. */
function outsideCode(text: string, fn: (s: string) => string): string {
  const out: string[] = []
  let buf: string[] = [], fence = ""
  const flush = (code: boolean) => { if (buf.length) out.push(code ? buf.join("\n") : fn(buf.join("\n"))); buf = [] }
  for (const line of text.split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (f && !fence) { flush(false); fence = f[1]; buf.push(line); continue }
    if (f && fence && f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length).trim()) {
      buf.push(line); flush(true); fence = ""; continue
    }
    buf.push(line)
  }
  flush(!!fence)
  return out.join("\n")
}

/** Each line of `text` with whether it's inside a code fence (its fence lines count as inside). */
function* fenced(text: string): Generator<[string, boolean]> {
  let fence = ""
  for (const line of text.split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (!fence) fence = f[1]
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length).trim()) { yield [line, true]; fence = ""; continue }
    }
    yield [line, !!fence]
  }
}

const ATTR = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
function attrsOf(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of s.matchAll(ATTR)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ""
  return out
}

const SLIDE_NOTE = /<!--\s*(?:\.slide:|slide\b)([\s\S]*?)-->/g
const ELEMENT_NOTE = /<!--\s*(?:\.element:|element\b)([\s\S]*?)-->/g
/** Layout tags Advanced Slides draws (`<split>`, `<grid>`) and its `::: block`s: left out, their content kept in order. */
const LAYOUT = /^\s*(?:<\/?(?:split|grid)\b[^>]*>\s*)+$|^\s*:::(?:\s+\w[^\n]*)?\s*$/

function slideOf(raw: string, h: number, v: number, notesRe: RegExp): Slide {
  const s: Slide = { md: "", notes: "", h, v, els: [], bgAttrs: {}, cls: "", style: "" }
  const md: string[] = [], notes: string[] = []
  let inNotes = false
  for (const [line, code] of fenced(raw)) {
    if (inNotes) { notes.push(line); continue }
    const m = code ? null : notesRe.exec(line)
    if (m) { inNotes = true; md.push(line.slice(0, m.index)); notes.push(line.slice(m.index + m[0].length)); continue }
    if (!code && LAYOUT.test(line)) continue
    // A fragmented list: items marked `+` or `1)` come in one at a time.
    if (!code && /^\s*(?:\+|\d{1,9}\))\s+\S/.test(line)) { s.els.push({ cls: "fragment", style: "", li: true }); md.push(`${line} <span class="slide-el-${s.els.length - 1}"></span>`); continue }
    md.push(line)
  }
  s.notes = notes.join("\n").trim()
  s.md = outsideCode(md.join("\n"), (t) => t
    .replace(SLIDE_NOTE, (_, a: string) => {
      const at = attrsOf(a)
      for (const [k, val] of Object.entries(at)) {
        if (k === "bg" || k === "data-background") s.bg = val
        else if (k === "data-background-color" || k === "data-background-image") s.bg = val
        else if (k.startsWith("data-background-")) s.bgAttrs[k.slice(16)] = val
        else if (k === "class") s.cls = [s.cls, val].filter(Boolean).join(" ")
        else if (k === "style") s.style = [s.style, val].filter(Boolean).join("; ")
      }
      return ""
    })
    .replace(ELEMENT_NOTE, (_, a: string) => {
      const at = attrsOf(a)
      const index = Number.parseInt(at["data-fragment-index"] ?? "", 10)
      s.els.push({ cls: at.class ?? "", style: at.style ?? "", ...(Number.isFinite(index) ? { index } : {}) })
      return `<span class="slide-el-${s.els.length - 1}"></span>`
    })).trim()
  return s
}

/** The deck: its slides in order (columns, then down each) and the CSS of its <style> blocks, as written. Obsidian
 *  comments (%% … %%) are left out first, so what they hide (a <style>, a `note:`) does nothing. */
export function parseDeck(body: string, opts: DeckOptions = {}): { slides: Slide[]; css: string } {
  const sep = lineRegex(opts.separator, SEP), vsep = lineRegex(opts.verticalSeparator, VSEP), notesRe = lineRegex(opts.notesSeparator, NOTES, "i")
  const css: string[] = []
  const text = outsideCode(body.replace(/\r\n?/g, "\n"), (t) => t
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, c: string) => { css.push(c.trim()); return "" }))
  const cols: string[][][] = [[[]]]
  for (const [line, code] of fenced(text)) {
    const col = cols[cols.length - 1]
    if (!code && sep.test(line)) { cols.push([[]]); continue }
    if (!code && vsep.test(line)) { col.push([]); continue }
    col[col.length - 1].push(line)
  }
  const slides: Slide[] = []
  let h = 0
  for (const col of cols) {
    let v = 0
    for (const lines of col) {
      const s = slideOf(lines.join("\n"), h, v, notesRe)
      if (!s.md && !s.notes && !s.bg) continue
      slides.push(s)
      v++
    }
    if (v) h++
  }
  return { slides, css: css.filter(Boolean).join("\n") }
}

/** A title slide (headings only, maybe a short line under them): drawn centred. */
export function isTitleSlide(md: string): boolean {
  const lines = md.replace(/<span class="slide-el-\d+"><\/span>/g, "").split("\n").map((l) => l.trim()).filter(Boolean)
  const heads = lines.filter((l) => /^#{1,6}\s/.test(l)).length
  const rest = lines.filter((l) => !/^#{1,6}\s/.test(l))
  return heads > 0 && rest.length <= 1 && rest.every((l) => l.length <= 80 && !/^([-*+]|\d+\.|>|!?\[\[|```|\|)/.test(l))
}

// ---------- the deck's CSS, kept to the presentation ----------

/** What a reveal.js deck's CSS calls the page or the presentation (`:root`, `.reveal .slides section`…): the deck here. */
const PAGE = /^(?:(?::root|html|body|\.reveal-viewport)(?=$|[\s>+~.:#[])\s*)*(?:\.reveal(?=$|[\s>+~.:#[])(?:\s+\.slides(?=$|[\s>.:#[]))?(?:\s+section(?=$|[\s>.:#[]))?)?/

/** Commas at the top level of a selector list (not inside :is(...) or [a=","]). */
function splitList(sel: string): string[] {
  const out: string[] = []
  let depth = 0, q = "", at = 0
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i]
    if (q) { if (c === "\\") i++; else if (c === q) q = ""; continue }
    if (c === '"' || c === "'") q = c
    else if (c === "(" || c === "[") depth++
    else if (c === ")" || c === "]") depth--
    else if (c === "," && !depth) { out.push(sel.slice(at, i)); at = i + 1 }
  }
  out.push(sel.slice(at))
  return out.map((s) => s.trim()).filter(Boolean)
}

/** One selector kept inside `scope`: what names the page or the presentation becomes the scope itself. */
export function scopeSelector(sel: string, scope: string): string {
  return splitList(sel).map((one) => {
    const page = PAGE.exec(one)?.[0] ?? ""
    const after = one.slice(page.length), rest = after.trim()
    if (!rest) return scope
    // (`.reveal.dark` is the deck itself; `.reveal .dark` something in it)
    return page && !/\s$/.test(page) && /^[.:#[]/.test(after) ? `${scope}${rest}` : `${scope} ${rest}`
  }).join(", ")
}

/** A deck's CSS with every rule kept inside `scope`: at-rules that nest rules (@media, @supports…) are scoped
 *  within; @keyframes and @font-face kept; what loads or reaches outside (@import, @page, @property…) dropped. */
export function scopeCss(css: string, scope: string): string {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "")
  let i = 0
  /** The text up to the brace that closes the block opened just before `i` (strings skipped). */
  const block = () => {
    const start = i
    let depth = 1, q = ""
    for (; i < src.length; i++) {
      const c = src[i]
      if (q) { if (c === "\\") i++; else if (c === q) q = ""; continue }
      if (c === '"' || c === "'") q = c
      else if (c === "{") depth++
      else if (c === "}" && !--depth) break
    }
    return src.slice(start, i++)
  }
  const rules = (): string => {
    let out = ""
    while (i < src.length) {
      const open = src.indexOf("{", i), close = src.indexOf("}", i), semi = src.indexOf(";", i)
      if (close >= 0 && (open < 0 || close < open)) { i = close + 1; return out }
      if (open < 0) break
      // A statement at-rule (@import url(x);) ends at its semicolon, before any brace.
      if (semi >= 0 && semi < open && src.slice(i, semi).trim().startsWith("@")) { i = semi + 1; continue }
      const prelude = src.slice(i, open).trim()
      i = open + 1
      if (prelude.startsWith("@")) {
        const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? ""
        if (/^(media|supports|container|layer)$/.test(name)) out += `${prelude} {\n${rules()}}\n`
        else { const b = block(); if (/^(-\w+-)?keyframes$|^font-face$/.test(name)) out += `${prelude} {${b}}\n` }
        continue
      }
      const b = block()
      if (prelude) out += `${scopeSelector(prelude, scope)} {${b}}\n`
    }
    return out
  }
  return rules()
}
