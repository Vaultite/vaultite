import { Lexer, Marked, Renderer, type Token, type Tokens, type TokenizerAndRendererExtension } from "marked"
import { columnShares, parseTable, sharedMinWidth } from "../editor/tableText"
import { COPY_ICON } from "./richmd"
import { dropHighlightEmoji, highlightClass, highlightColor } from "./highlights"
import { esc, sanitizeHtml } from "./sanitize"
import { CALLOUT, calloutHtml, svg } from "./callouts"

export const WIKI_LINK = String.raw`\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]`
const WIKI_START = new RegExp(`^!?${WIKI_LINK}`)
export function inlineNoteEnd(text: string, i: number) {
  if (text[i] !== "^" || text[i + 1] !== "[") return -1
  for (let k = i + 1, depth = 0; k < text.length; k++) {
    const c = text[k]
    if (c === "\\") k++
    else if (c === "\n") return -1
    else if (c === "[") depth++
    else if (c === "]" && --depth === 0) return text.slice(i + 2, k).trim() ? k + 1 : -1
  }
  return -1
}
const unwrittenLabel = (n: number) => `inline ${n}`
export const footnoteText = (s: string) => dropHighlightEmoji(s).replace(/\[\[([^\]|]+\|)?|\]\]|[*_`~]/g, "")

type Resolves = (target: string) => { kind: string } | null
export type MarkdownOpts = { resolves?: Resolves; asset?: (name: string) => string | null }

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic)$/i
const UNSAFE = /^(javascript|data|vbscript|blob):/i
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const SHORT_CELL = 24
const widthOf = (s: string) => Number(/^\s*(\d+)(?:x\d+)?\s*$/.exec(s)?.[1] ?? 0)

const BACK = '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>'

type FootnoteDef = Tokens.Generic & { label: string; tokens: Token[] }
type InlineNote = Tokens.Generic & { text: string; tokens: Token[] }
type Math = Tokens.Generic & { text: string; display: boolean }

function make({ resolves, asset }: MarkdownOpts = {}) {
  let notes = new Map<string, { text: string; html?: string }>()
  let order: string[] = []

  const wikilink: TokenizerAndRendererExtension = {
    name: "wikilink",
    level: "inline",
    start: (src: string) => { const i = src.search(/!?\[\[/); return i >= 0 ? i : undefined },
    tokenizer(src: string) {
      const r = WIKI_START.exec(src)
      if (!r) return
      const [name, ...at] = r[1].split("#")
      const label = r[2] ?? [name.trim(), ...at.map((x) => x.trim())].filter(Boolean).join(" › ")
      return { type: "wikilink", raw: r[0], target: r[1].trim(), label: label.trim(), embed: r[0].startsWith("!") }
    },
    renderer(t) {
      const hit = !resolves || t.target.startsWith("#") ? { kind: "" } : resolves(t.target)
      const kind = hit && !["file", "note"].includes(hit.kind) ? hit.kind : ""
      const link = `<a class="${esc(["wikilink", kind, hit ? "" : "missing"].filter(Boolean).join(" "))}" data-wiki="${esc(t.target)}"${t.embed ? " data-wiki-embed" : ""}>${esc(t.label)}</a>`
      if (!t.embed || !hit) return link
      const name = t.target.split("#")[0].trim(), src = asset && IMAGE.test(name) ? asset(name) : null
      const alias = /\|([^\]]*)\]\]$/.exec(t.raw)?.[1] ?? ""
      if (src) return img(src, name, widthOf(alias))
      return `<span class="md-embed" data-md-embed="${esc(t.target)}">${link}</span>`
    },
  }
  const footnoteDef: TokenizerAndRendererExtension = {
    name: "footnoteDef",
    level: "block",
    start: (src: string) => { const i = src.search(/^\[\^[^\]\s]+\]:/m); return i >= 0 ? i : undefined },
    tokenizer(src: string) {
      const r = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)(?:\n+|$)/.exec(src)
      if (!r) return
      const text = r[2].replace(/\n(?: {2,}|\t)/g, "\n").trim()
      if (!notes.has(r[1])) notes.set(r[1], { text })
      const tok: FootnoteDef = { type: "footnoteDef", raw: r[0], label: r[1], tokens: [] }
      this.lexer.inline(text, tok.tokens)
      return tok
    },
    renderer(t) {
      const n = notes.get(t.label)
      if (n && n.html === undefined) n.html = this.parser.parseInline(t.tokens ?? [])
      return ""
    },
  }
  const footnoteRef: TokenizerAndRendererExtension = {
    name: "footnoteRef",
    level: "inline",
    start: (src: string) => { const i = src.indexOf("[^"); return i >= 0 ? i : undefined },
    tokenizer(src: string) {
      const r = /^\[\^([^\]\s]+)\](?!:)/.exec(src)
      if (r) return { type: "footnoteRef", raw: r[0], label: r[1] }
    },
    renderer(t) {
      const label: string = t.label
      if (!order.includes(label)) order.push(label)
      return refHtml(label)
    },
  }
  const inlineNote: TokenizerAndRendererExtension = {
    name: "inlineNote",
    level: "inline",
    start: (src: string) => { const i = src.indexOf("^["); return i >= 0 ? i : undefined },
    tokenizer(src: string) {
      const end = inlineNoteEnd(src, 0)
      if (end < 0) return
      const tok: InlineNote = { type: "inlineNote", raw: src.slice(0, end), text: src.slice(2, end - 1).trim(), tokens: [] }
      this.lexer.inline(tok.text, tok.tokens)
      return tok
    },
    renderer(t) {
      const label = unwrittenLabel(order.length + 1)
      order.push(label)
      notes.set(label, { text: t.text, html: this.parser.parseInline(t.tokens ?? []) })
      return refHtml(label)
    },
  }
  const refHtml = (label: string) => {
    const note = notes.get(label)
    const tip = note ? ` data-tip="${esc(footnoteText(note.text).replace(/\s+/g, " ").slice(0, 300))}"` : ""
    return `<sup class="footnote-ref${note ? "" : " missing"}" data-footnote="${esc(label)}"${tip}>${order.indexOf(label) + 1}</sup>`
  }
  const mathBlock: TokenizerAndRendererExtension = {
    name: "mathBlock",
    level: "block",
    start: (src: string) => { const i = src.search(/^ {0,3}\$\$/m); return i >= 0 ? i : undefined },
    tokenizer(src: string) {
      const r = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src)
      if (r) return { type: "mathBlock", raw: r[0], text: r[1].trim(), display: true } satisfies Math
    },
    renderer: (t) => `<div class="math math-display" data-math="display">${esc(t.text)}</div>\n`,
  }
  const mathInline: TokenizerAndRendererExtension = {
    name: "mathInline",
    level: "inline",
    start: (src: string) => { const i = src.indexOf("$"); return i >= 0 ? i : undefined },
    tokenizer(src: string) {
      const d = /^\$\$([^$]+?)\$\$/.exec(src)
      if (d) return { type: "mathInline", raw: d[0], text: d[1].trim(), display: true } satisfies Math
      // Pandoc's rule: no space inside the dollars, no digit right after the closing one ($5 and $10 is text).
      const r = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<![\s\\])\$(?!\d)/.exec(src)
      if (r) return { type: "mathInline", raw: r[0], text: r[1], display: false } satisfies Math
    },
    renderer: (t) => t.display
      ? `<span class="math math-display" data-math="display">${esc(t.text)}</span>`
      : `<span class="math math-inline" data-math="inline">${esc(t.text)}</span>`,
  }

  const highlight: TokenizerAndRendererExtension = {
    name: "highlight",
    level: "inline",
    start: (src: string) => { const i = src.indexOf("=="); return i >= 0 ? i : undefined },
    tokenizer(src: string) {
      const r = /^==(?=[^\s=])([\s\S]*?[^\s=])==(?!=)/.exec(src)
      if (!r) return
      const c = highlightColor(r[1])
      return { type: "highlight", raw: r[0], color: c?.color, tokens: this.lexer.inlineTokens(r[1].slice(c?.len ?? 0)) }
    },
    renderer(t) { return `<mark${t.color ? ` class="${highlightClass(t.color)}"` : ""}>${this.parser.parseInline(t.tokens ?? [])}</mark>` },
  }
  const tag: TokenizerAndRendererExtension = {
    name: "tag",
    level: "inline",
    start: (src: string) => { const r = /(^|[ \t\n])#[\p{L}\p{N}_\-/]/u.exec(src); return r ? r.index + r[1].length : undefined },
    tokenizer(src: string) {
      const r = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u.exec(src)
      if (r) return { type: "tag", raw: r[0], name: r[1] }
    },
    renderer: (t) => `<a class="tag" data-tag="${esc(t.name)}">#${esc(t.name)}</a>`,
  }
  const commentInline: TokenizerAndRendererExtension = {
    name: "commentInline",
    level: "inline",
    start: (src: string) => { const i = src.indexOf("%%"); return i >= 0 ? i : undefined },
    tokenizer(src: string) { const r = /^%%[\s\S]*?%%/.exec(src); if (r) return { type: "commentInline", raw: r[0] } },
    renderer: () => "",
  }
  const commentBlock: TokenizerAndRendererExtension = {
    name: "commentBlock",
    level: "block",
    start: (src: string) => { const i = src.search(/^ {0,3}%%/m); return i >= 0 ? i : undefined },
    tokenizer(src: string) { const r = /^ {0,3}%%[\s\S]*?%%[ \t]*(?:\n+|$)/.exec(src); if (r) return { type: "commentBlock", raw: r[0] } },
    renderer: () => "",
  }
  const blockId: TokenizerAndRendererExtension = {
    name: "blockId",
    level: "inline",
    start: (src: string) => { const i = src.search(/(?:^|[ \t])\^[A-Za-z0-9-]+[ \t]*(?:\n|$)/); return i >= 0 ? i : undefined },
    tokenizer(src: string) { const r = /^[ \t]*\^[A-Za-z0-9-]+[ \t]*(?=\n|$)/.exec(src); if (r) return { type: "blockId", raw: r[0] } },
    renderer: () => "",
  }

  const img = (src: string, alt: string, width = 0, title?: string | null) =>
    `<img src="${esc(src)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ""}${width ? ` width="${width}"` : ""} loading="lazy">`
  const linkAttrs = (href: string): string | null => {
    if (!href || UNSAFE.test(href)) return null
    if (/^vaultite:\/\/command\/[\w:.-]+$/i.test(href)) return ` class="wikilink" data-url="${esc(href)}"`
    if (/^https?:/i.test(href)) return ` href="${esc(href)}" target="_blank" rel="noreferrer"`
    if (SCHEME.test(href)) return ` class="external-link" href="${esc(href)}" data-url="${esc(href)}"`
    let t = href
    try { t = decodeURIComponent(href) } catch { /* as written */ }
    t = t.replace(/\.md(?=#|$)/i, "")
    const hit = !resolves || t.startsWith("#") ? { kind: "" } : resolves(t)
    return ` class="${hit ? "wikilink" : "wikilink missing"}" data-wiki="${esc(t)}"`
  }
  const imageSrc = (href: string): string | null => {
    if (/^https?:/i.test(href)) return href
    if (SCHEME.test(href) || !asset) return null
    let t = href
    try { t = decodeURIComponent(href) } catch { /* as written */ }
    return asset(t.replace(/^(\.\.?\/)+/, ""))
  }
  const html = (text: string) => sanitizeHtml(text, { link: linkAttrs, image: imageSrc })

  const m = new Marked({ gfm: true, breaks: true })
  m.use({
    extensions: [wikilink, footnoteDef, footnoteRef, inlineNote, mathBlock, mathInline, highlight, tag, commentInline, commentBlock, blockId],
    hooks: {
      preprocess(src: string) { notes = new Map(); order = []; return src },
      postprocess(html: string) {
        html = html.replace(/<p>\s*<\/p>\n?/g, "")
        const labels = [...order, ...[...notes.keys()].filter((l) => !order.includes(l))].filter((l) => notes.has(l))
        if (!labels.length) return html
        const items = labels.map((l) => `<li data-footnote-def="${esc(l)}">${notes.get(l)!.html ?? esc(notes.get(l)!.text)}${order.includes(l)
          ? ` <button type="button" class="footnote-back" data-footnote-back="${esc(l)}" aria-label="Back to the text" data-tip="Back to the text">${svg(BACK)}</button>` : ""}</li>`)
        return `${html}<section class="footnotes"><ol>${items.join("")}</ol></section>`
      },
    },
    renderer: {
      html: ({ text }: Tokens.HTML | Tokens.Tag) => html(text),
      heading({ tokens, depth }: Tokens.Heading) { return `<h${depth} class="h${depth}">${this.parser.parseInline(tokens)}</h${depth}>\n` },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens), attrs = linkAttrs(href)
        return attrs === null ? inner : `<a${attrs}${title ? ` title="${esc(title)}"` : ""}>${inner}</a>`
      },
      image({ href, text, title }: Tokens.Image) {
        const src = imageSrc(href), w = /^(.*?)\|(\d+(?:x\d+)?)$/.exec(text)
        return src ? img(src, w ? w[1] : text, w ? widthOf(w[2]) : 0, title) : esc(text)
      },
      code({ text, lang }: Tokens.Code) {
        const name = (lang ?? "").trim().split(/\s+/)[0]
        if (name.toLowerCase() === "mermaid") return `<div class="md-mermaid" data-mermaid>${esc(text)}</div>\n`
        const cls = name ? ` class="language-${esc(name)}"` : ""
        return `<div class="md-code${name ? "" : " md-code-bare"}"><div class="md-code-head"><span class="md-code-lang">${esc(name)}</span>` +
          `<button type="button" class="md-copy" data-copy aria-label="Copy" data-tip="Copy">${COPY_ICON}</button></div>` +
          `<pre><code${cls}>${esc(text.replace(/\n$/, ""))}\n</code></pre></div>\n`
      },
      // Auto table layout shares spare width by max-content: a prose column beside a short cell would squeeze it
      // onto two lines.
      tablecell({ tokens, header, align }: Tokens.TableCell) {
        const tag = header ? "th" : "td", inner = this.parser.parseInline(tokens)
        const short = inner.replace(/<[^>]*>/g, "").replace(/&#?\w+;/g, "_").trim().length <= SHORT_CELL
        return `<${tag}${align ? ` align="${align}"` : ""}${short ? ' class="md-cell-short"' : ""}>${inner}</${tag}>\n`
      },
      table(token: Tokens.Table) {
        const sep = token.raw.split("\n", 2)[1] ?? "", t = sep.trim().length > 72 ? parseTable(token.raw.trimEnd()) : null
        const shares = t && columnShares(t)
        if (!shares) return false
        const cols = shares.map((f) => `<col style="width: ${(f * 100).toFixed(3)}%">`).join("")
        const html = Renderer.prototype.table.call(this, token)
          .replace("<table>", `<table class="has-widths" style="min-width: ${sharedMinWidth(shares).toFixed(2)}em"><colgroup>${cols}</colgroup>`)
        return `<div class="md-table-view">${html}</div>\n`
      },
      blockquote({ tokens }: Tokens.Blockquote) {
        const first = tokens[0]
        const c = first?.type === "paragraph" ? CALLOUT.exec(first.raw) : null
        if (!c) return `<blockquote>\n${this.parser.parse(tokens)}</blockquote>\n`
        const titleMd = c[3].trim() || c[1][0].toUpperCase() + c[1].slice(1).toLowerCase()
        const title = this.parser.parseInline(Lexer.lexInline(titleMd, this.parser.options))
        const body = first.raw.slice(c[0].length) + tokens.slice(1).map((t) => t.raw).join("")
        return calloutHtml(c[1], c[2], title, body.trim() ? this.parser.parse(Lexer.lex(body, this.parser.options)) : "")
      },
    },
  })
  return m
}

const plain = make()
const md = (opts?: MarkdownOpts) => (opts?.resolves || opts?.asset ? make(opts) : plain)

export const renderMarkdown = (text: string, opts?: MarkdownOpts) => md(opts).parse(text, { async: false })

export const renderInline = (text: string, opts?: MarkdownOpts) => md(opts).parseInline(text, { async: false })
