// A note's body as slides, read as Obsidian's Advanced Slides reads a deck (separators, notes, annotations, fragments,
// <style>), never inside code. No imports: tests run it on Node.

export type Annotation = { cls: string; style: string; bg?: string; index?: number; li?: boolean; data?: Record<string, string> }
/** A layout box (`<split>`, `<grid>`, a `::: block`): what's in it in order, Markdown or boxes. `kids`: the style each
 *  of its items gets (the blocks its Markdown draws, the boxes in it), `nth`: the k-th one's own. */
export type Box = { kind: "split" | "grid" | "block"; cls: string; style: string; bg?: string; index?: number; kids: string; nth: string[]; in: (Box | string)[] }
export type Slide = {
  /** What the slide shows (Markdown); an element annotation is an empty `<span class="slide-el-N">` in its place. */
  md: string
  /** Its layout boxes and the Markdown between them, when it has any (`md` is then their Markdown, in order). */
  boxes?: (Box | string)[]
  /** Something on it is placed (a grid's drop): it's drawn on a fixed slide, CANVAS, that drops are a share of. */
  canvas?: boolean
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
  /** Its other data-* (`data-transition`, `data-auto-animate`…), by name without `data-`. */
  data: Record<string, string>
}
export type DeckOptions = { separator?: unknown; verticalSeparator?: unknown; notesSeparator?: unknown; [fm: string]: unknown }

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

// (an unquoted value never runs into the next attribute: `style=bg="red"` is bg, as Advanced Slides reads it)
const ATTR = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(?![^\s"'>]*=["'])([^\s"'>]+)))?/g
function attrsOf(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of s.matchAll(ATTR)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ""
  return out
}

/** Advanced Slides' slide, which a drop's px are of. */
export const CANVAS = { w: 960, h: 700 }
const NAMED: Record<string, [number, number]> = { topleft: [0, 0], top: [0.5, 0], topright: [1, 0], left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5], bottomleft: [0, 1], bottom: [0.5, 1], bottomright: [1, 1] }
/** Where `align` puts a grid's items: across, then along (`even`: spread out). */
const ALIGN: Record<string, [string, string]> = { topleft: ["start", "start"], topright: ["end", "start"], bottomright: ["end", "end"], bottomleft: ["start", "end"],
  left: ["start", "even"], right: ["end", "even"], top: ["center", "start"], bottom: ["center", "end"], stretch: ["center", "even"], justify: ["center", "even"], block: ["center", "even"], center: ["center", "center"] }
const FLEX: Record<string, string> = { start: "flex-start", end: "flex-end", even: "space-evenly", center: "center" }
const round = (n: number) => +n.toFixed(3)

/** A drop's box as percents of the slide (left, top, width, height): x and y from the left and top, negative from the
 *  right and bottom, or a named place; px are of CANVAS (all of them with `absolute`). Null when it doesn't read. */
function placeOf(drag: string | undefined, drop: string, abs: boolean): number[] | null {
  const nums = (v: string) => v.trim().replace(/(\d)\s*x\s*(?=-?\d)/gi, "$1 ").split(/\s+/)
  const pct = (v: string | undefined, max: number) => (!v || !/^-?\d*\.?\d+(px)?$/i.test(v) ? NaN : /px$/i.test(v) || abs ? Number.parseFloat(v) / max * 100 : Number(v))
  const [w, h] = nums(drag ?? (abs ? "480px 700px" : "50 100")).map((v, k) => pct(v, k ? CANVAS.h : CANVAS.w))
  const named = NAMED[drop.trim().toLowerCase()]
  const [x, y] = named ? [(100 - w) * named[0], (100 - h) * named[1]] : nums(drop).map((v, k) => pct(v, k ? CANVAS.h : CANVAS.w))
  const out = [x < 0 ? 100 + x - w : x, y < 0 ? 100 + y - h : y, w, h]
  return out.length === 4 && out.every(Number.isFinite) ? out.map(round) : null
}

/** What a grid's, a split's or an annotation's attributes draw, as Advanced Slides draws them. */
function lookOf(at: Record<string, string>, kind?: Box["kind"]) {
  const cls = [...(at.class ?? "").split(/\s+/), ...(at.animate ?? "").split(/\s+/)], st: string[] = [], kids: string[] = [], nth: string[] = []
  const index = Number.parseInt(at.frag ?? at["data-fragment-index"] ?? "", 10)
  if ("frag" in at) cls.push("fragment")
  if (at.pad) st.push(`padding: ${at.pad}`, "box-sizing: border-box")
  if (at.opacity) st.push(`opacity: ${at.opacity}`)
  if (at.border) st.push(`border: ${at.border}`, "box-sizing: border-box")
  if (at.filter) st.push(`filter: ${at.filter}`)
  if (at.rotate) st.push(`transform: rotate(${/deg$/.test(at.rotate) ? at.rotate : `${at.rotate}deg`})`)
  const place = at.drop ? placeOf(at.drag, at.drop, at.absolute === "true") : null
  if (place) st.push("margin: 0", "position: absolute", `left: ${place[0]}%`, `top: ${place[1]}%`, `width: ${place[2]}%`, `height: ${place[3]}%`)
  if (at.align || at.drop) {
    const row = at.flow === "row", a = (at.align ?? "").toLowerCase(), [across, along] = ALIGN[a] ?? ["center", "center"]
    st.push("display: flex", `flex-direction: ${row ? "row" : "column"}`, `align-items: ${FLEX[row ? (along === "even" ? "center" : along) : across]}`,
      `justify-content: ${at["justify-content"] ?? (row ? (ALIGN[a] && a !== "center" ? "space-evenly" : "center") : FLEX[along])}`,
      `text-align: ${across === "start" ? "left" : across === "end" ? "right" : a === "justify" || a === "block" ? "justify" : "center"}`)
    if (kind) kids.push("margin-block: 0")
    if (row) kids.push("flex: 1")
    if (a === "stretch") { cls.push(row ? "stretch-row" : "stretch-column"); kids.push(row ? "flex: 1; height: 100%; width: 1%" : "flex: 1; height: 1%; width: 100%") }
  }
  if (kind === "split") {
    // (no gap unless one's asked for, as in Advanced Slides)
    const gap = at.gap ? (/^\d*\.?\d+$/.test(at.gap) ? `${at.gap}em` : at.gap) : "0px"
    st.push(`--split-gap: ${gap}`, "display: flex", "flex-flow: row wrap", "align-content: center", "gap: var(--split-gap)")
    kids.push("min-width: 0")
    if ("even" in at) kids.push("flex: 1")
    const wrap = Number.parseInt(at.wrap ?? "", 10)
    if (wrap > 0) kids.push(`flex: 1 1 calc((100% - var(--split-gap) * ${wrap - 1}) / ${wrap})`)
    if ("no-margin" in at) kids.push("margin: 0")
    const flex = (v?: string) => (Number(v) > 0 ? `flex: ${Number(v)}` : "")
    nth.push(flex(at.left), flex(at.middle) || flex(at.right), flex(at.right))
  }
  if (at.style) st.push(at.style)
  return { cls: cls.filter(Boolean).join(" "), style: st.join("; "), ...(at.bg ? { bg: at.bg } : {}), ...(Number.isFinite(index) ? { index } : {}),
    kids: kids.join("; "), nth: nth.some(Boolean) ? nth : [], placed: !!place }
}

const TAG = /<(\/?)(split|grid)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gi
const BLOCK = /^\s*:::\s*([\w-]*)(.*)$/
const MARK = /<span class="slide-el-(\d+)"><\/span>/g
/** A line that's only an image: its own block in a box, as Advanced Slides has it (so a split's images are its columns). */
const IMAGE_LINE = /^\s*!(?:\[[^\]]*\]\([^)]*\)|\[\[[^\]]+\]\])\s*(?:<span class="slide-el-\d+"><\/span>\s*)?$/

/** The slide's Markdown as layout boxes (`<split>`, `<grid>`, `::: block` lines; outside code), or null without any.
 *  An annotation on a `:::` line is its block's; what's left open closes at the slide's end. */
function layoutOf(md: string, s: Slide): (Box | string)[] | null {
  const root: (Box | string)[] = [], open: Box[] = []
  let buf: string[] = [], any = false
  const into = () => (open.length ? open[open.length - 1].in : root)
  const flush = () => {
    const t = buf.join("\n").trim()
    buf = []
    if (!t) return
    const boxed = open.length > 0
    into().push(boxed ? [...fenced(t)].map(([l, code]) => (!code && IMAGE_LINE.test(l) ? `\n${l}\n` : l)).join("\n").replace(/\n{3,}/g, "\n\n").trim() : t)
  }
  const start = (kind: Box["kind"], at: Record<string, string>, closed = false) => {
    flush()
    any = true
    const { placed, ...look } = lookOf(at, kind)
    if (placed) s.canvas = true
    const box: Box = { kind, ...look, in: [] }
    into().push(box)
    if (!closed) open.push(box)
    return box
  }
  const end = (kind: Box["kind"]) => {
    const k = open.findLastIndex((b) => b.kind === kind)
    if (k < 0) return null
    flush()
    any = true
    return open.splice(k)[0]
  }
  /** A `:::` line's annotations onto its block. */
  const annotateBox = (box: Box | null, rest: string) => {
    for (const m of rest.matchAll(MARK)) {
      const a = s.els[Number(m[1])]
      if (!box || !a) continue
      box.cls = [box.cls, a.cls].filter(Boolean).join(" ")
      box.style = [box.style, a.style].filter(Boolean).join("; ")
      if (a.bg) box.bg = a.bg
      if (a.index !== undefined) box.index = a.index
    }
  }
  for (const [line, code] of fenced(md)) {
    const b = code ? null : BLOCK.exec(line)
    if (b) { annotateBox(b[1] ? start("block", { class: b[1] }) : end("block"), b[2]); any = true; continue }
    if (code || line.search(TAG) < 0) { buf.push(line); continue }
    let at = 0
    for (const m of line.matchAll(TAG)) {
      // (not one in `code`)
      if ((line.slice(0, m.index).match(/`/g)?.length ?? 0) % 2) continue
      const before = line.slice(at, m.index)
      if (before.trim()) buf.push(before)
      at = m.index + m[0].length
      const kind = m[2].toLowerCase() as Box["kind"]
      if (m[1]) end(kind)
      else start(kind, attrsOf(m[3]), !!m[4])
    }
    const after = line.slice(at)
    if (after.trim() || at === 0) buf.push(after)
  }
  if (!any) return null
  flush()
  return root
}

const SLIDE_NOTE = /<!--\s*(?:\.slide:|slide\b)([\s\S]*?)-->/g
const ELEMENT_NOTE = /<!--\s*(?:\.element:|element\b)([\s\S]*?)-->/g

function slideOf(raw: string, h: number, v: number, notesRe: RegExp): Slide {
  const s: Slide = { md: "", notes: "", h, v, els: [], bgAttrs: {}, cls: "", style: "", data: {} }
  const md: string[] = [], notes: string[] = []
  let inNotes = false, listFrag = 0
  for (const [line, code] of fenced(raw)) {
    if (inNotes) { notes.push(line); continue }
    const m = code ? null : notesRe.exec(line)
    if (m) { inNotes = true; md.push(line.slice(0, m.index)); notes.push(line.slice(m.index + m[0].length)); continue }
    // A fragmented list: items marked `+` or `1)` come in one at a time, numbered from 1 (with a grid's `frag`).
    if (!code && /^\s*(?:\+|\d{1,9}\))\s+\S/.test(line)) { s.els.push({ cls: "fragment", style: "", li: true, index: ++listFrag }); md.push(`${line} <span class="slide-el-${s.els.length - 1}"></span>`); continue }
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
        else if (k.startsWith("data-")) s.data[k.slice(5)] = val
      }
      return ""
    })
    .replace(ELEMENT_NOTE, (_, a: string) => {
      const at = attrsOf(a)
      const { placed, kids: _k, nth: _n, ...look } = lookOf(at)
      if (placed) s.canvas = true
      const data = Object.fromEntries(Object.entries(at).filter(([k]) => k.startsWith("data-") && k !== "data-fragment-index").map(([k, v]) => [k.slice(5), v]))
      s.els.push({ ...look, ...(Object.keys(data).length ? { data } : {}) })
      return `<span class="slide-el-${s.els.length - 1}"></span>`
    })).trim()
  const boxes = layoutOf(s.md, s)
  if (boxes) {
    s.boxes = boxes
    const flat = (b: (Box | string)[]): string[] => b.flatMap((x) => (typeof x === "string" ? [x] : flat(x.in)))
    s.md = flat(boxes).join("\n\n")
  }
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
      if (!s.md && !s.notes && !s.bg && !s.boxes) continue
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

// ---------- moving from one slide to the next, as reveal.js does ----------

export type Style = "none" | "fade" | "slide" | "convex" | "concave" | "zoom"
const STYLES = new Set(["none", "fade", "slide", "convex", "concave", "zoom"])
const SPEEDS: Record<string, number> = { default: 800, fast: 400, slow: 1200 }
export type Move = {
  out: Style; in: Style; outMs: number; inMs: number
  /** The background's way (none when both slides have the same one). */
  bg: Style
  vertical: boolean; back: boolean
  /** Auto-animate (both slides `data-auto-animate`, the same `data-auto-animate-id`): no slide transition then. */
  auto?: { ms: number; easing: string; unmatched: boolean }
}

/** A way in or out, from `zoom` or a pair like `fade-in slide-out`; else `fallback`'s. */
function styleOf(t: unknown, way: "in" | "out", fallback: Style): Style {
  const words = typeof t === "string" ? t.toLowerCase().split(/\s+/) : []
  const paired = words.find((x) => x.endsWith(`-${way}`))?.slice(0, -way.length - 1)
  const w = paired && STYLES.has(paired) ? paired : words.find((x) => STYLES.has(x))
  return (w as Style | undefined) ?? fallback
}
const str = (v: unknown) => (["string", "number", "boolean"].includes(typeof v) ? String(v) : undefined)

/** How the deck goes from slide `a` to `b`: `a` leaves its way, `b` comes in its own (frontmatter `transition`,
 *  `transitionSpeed`, `backgroundTransition`, `autoAnimate*` for the deck; a slide's data-* over them). */
export function moveOf(a: Slide, b: Slide, opts: DeckOptions = {}): Move {
  const deck = styleOf(opts.transition, "in", "slide")
  const ms = (s: Slide) => SPEEDS[str(s.data["transition-speed"] ?? opts.transitionSpeed) ?? ""] ?? SPEEDS.default
  const bgOf = (s: Slide) => JSON.stringify([s.bg ?? str(opts.bg) ?? "", { ...s.bgAttrs, transition: "" }])
  const back = b.h < a.h || (b.h === a.h && b.v < a.v)
  const later = back ? a : b
  const on = (s: Slide) => s.data["auto-animate"] !== undefined && s.data["auto-animate"] !== "false"
  const auto = str(opts.autoAnimate) !== "false" && on(a) && on(b) && (a.data["auto-animate-id"] ?? "") === (b.data["auto-animate-id"] ?? "")
    && later.data["auto-animate-restart"] === undefined
  const secs = Number.parseFloat(str(b.data["auto-animate-duration"] ?? opts.autoAnimateDuration) ?? "")
  return {
    out: auto ? "none" : styleOf(a.data.transition, "out", styleOf(opts.transition, "out", deck)),
    in: auto ? "none" : styleOf(b.data.transition, "in", deck),
    outMs: ms(a), inMs: ms(b),
    bg: bgOf(a) === bgOf(b) ? "none" : styleOf(b.bgAttrs.transition ?? opts.backgroundTransition, "in", "fade"),
    vertical: a.h === b.h, back,
    ...(auto ? { auto: { ms: Number.isFinite(secs) && secs >= 0 ? secs * 1000 : 1000, easing: str(b.data["auto-animate-easing"] ?? opts.autoAnimateEasing) ?? "ease",
      unmatched: str(b.data["auto-animate-unmatched"] ?? opts.autoAnimateUnmatched) !== "false" } } : {}),
  }
}

// ---------- the deck's CSS, kept to the presentation ----------

const CSS_FILE = /^(https:\/\/\S+|[^\s<>"]+\.css([?#]\S*)?)$/i
/** The deck's stylesheets, in the order they apply: a `theme` that's a CSS file or address, then `css` (a list, or
 *  names split by commas). */
export function cssFiles(props: Record<string, unknown>): string[] {
  const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((s) => String(s).trim().replace(/^\[\[([^\]|]+)[^\]]*\]\]$/, "$1"))
  return [...list(props.theme), ...list(props.css)].filter((s) => CSS_FILE.test(s))
}

/** Where a stylesheet `ref` named by the note at `note` may be in the vault, likeliest first: beside the note, from
 *  the vault's root, then Advanced Slides' own folder (its `css/…` themes). */
export function cssPlaces(ref: string, note: string): string[] {
  const join = (dir: string, p: string) => {
    const out: string[] = []
    for (const x of `${dir}/${p}`.split("/")) { if (x === "..") out.pop(); else if (x && x !== ".") out.push(x) }
    return out.join("/")
  }
  const p = ref.replace(/[?#].*$/, "")
  if (p.startsWith("/")) return [join("", p)]
  const dir = note.includes("/") ? note.slice(0, note.lastIndexOf("/")) : ""
  return [...new Set([join(dir, p), join("", p), join(".obsidian/plugins/obsidian-advanced-slides", p)])]
}

/** A stylesheet's relative `url(…)`s (fonts, images) as addresses the browser loads: `toUrl` of the vault path each
 *  names from the sheet's folder `dir`. */
export function cssUrls(css: string, dir: string, toUrl: (path: string) => string): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, _q, u: string) =>
    /^([a-z][\w+.-]*:|\/\/|#)/i.test(u.trim()) ? m : `url(${JSON.stringify(toUrl(cssPlaces(u.trim(), `${dir}/x`)[0]))})`)
}

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
