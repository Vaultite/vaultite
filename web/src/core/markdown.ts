// Markdown to HTML outside the editor, with its extras (wikilinks, callouts, footnotes, math, mermaid, tags,
// highlights). As in Obsidian: every link is one (a note, a file, any app's scheme), raw HTML is drawn (sanitized),
// vault images show, and `![[Note]]` anywhere is an embed (a `data-md-embed` the caller draws; a link until then).
import { Lexer, Marked, type Token, type Tokens, type TokenizerAndRendererExtension } from "marked"
import { COPY_ICON } from "./richmd"
import { sanitizeHtml } from "./sanitize"

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
/** A wiki link's source: `[[target]]` or `[[target|shown]]` (groups 1 and 2), for building the patterns that need it. */
export const WIKI_LINK = String.raw`\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]`
const WIKI_START = new RegExp(`^!?${WIKI_LINK}`)
/** A footnote's text as a tooltip shows it: links by their text, no marks. */
export const footnoteText = (s: string) => s.replace(/\[\[([^\]|]+\|)?|\]\]|[*_`~]/g, "")

/** What a [[target]] is (its kind tints it: person, book...), or null: nothing yet. */
export type Resolves = (target: string) => { kind: string } | null
/** What drawing needs from the vault: `resolves` links, `asset` a vault file's address (an image), or null. */
export type MarkdownOpts = { resolves?: Resolves; asset?: (name: string) => string | null }

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic)$/i
/** Addresses that run code where they open: drawn as text. */
const UNSAFE = /^(javascript|data|vbscript|blob):/i
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
/** An image's width written after its name or alt text (`|300`, `|300x200`), or 0. */
const widthOf = (s: string) => Number(/^\s*(\d+)(?:x\d+)?\s*$/.exec(s)?.[1] ?? 0)

// ---------- callouts ----------

const svg = (body: string) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
// Lucide's icons, for the callouts.
const ICONS: Record<string, string> = {
  note: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  abstract: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  todo: '<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>',
  tip: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
  success: '<path d="M20 6 9 17l-5-5"/>',
  question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  failure: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  danger: '<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/>',
  bug: '<path d="M12 20v-9"/><path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z"/><path d="M14.12 3.88 16 2"/><path d="M21 21a4 4 0 0 0-3.81-4"/><path d="M21 5a4 4 0 0 1-3.55 3.97"/><path d="M22 13h-4"/><path d="M3 21a4 4 0 0 1 3.81-4"/><path d="M3 5a4 4 0 0 0 3.55 3.97"/><path d="M6 13H2"/><path d="m8 2 1.88 1.88"/><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/>',
  example: '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',
  quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
}
const BACK = '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>'
const CHEVRON = '<path d="m9 18 6-6-6-6"/>'
/** The other names for the callout types. */
const ALIASES: Record<string, string> = {
  summary: "abstract", tldr: "abstract", hint: "tip", important: "tip", check: "success", done: "success",
  help: "question", faq: "question", caution: "warning", attention: "warning", fail: "failure", missing: "failure",
  error: "danger", cite: "quote",
}
/** A callout's first line: `[!type]`, then `-` (folded) or `+` (foldable, open), then its title. */
export const CALLOUT = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)/

function calloutType(name: string) {
  const n = name.toLowerCase()
  const type = ALIASES[n] ?? n
  return ICONS[type] ? type : "note"
}

// ---------- footnotes and math: token shapes ----------

type FootnoteDef = Tokens.Generic & { label: string; tokens: Token[] }
type Math = Tokens.Generic & { text: string; display: boolean }

function make({ resolves, asset }: MarkdownOpts = {}) {
  // One document's footnotes, reset for each (preprocess): definitions by label (their text, then their HTML once
  // drawn), and the labels in the order they're first referenced (their numbers).
  let notes = new Map<string, { text: string; html?: string }>()
  let order: string[] = []

  const wikilink: TokenizerAndRendererExtension = {
    name: "wikilink",
    level: "inline",
    start: (src: string) => { const i = src.search(/!?\[\[/); return i >= 0 ? i : undefined },
    tokenizer(src: string) {
      const r = WIKI_START.exec(src)
      if (!r) return
      // Shown: its alias, else its name (and the heading it goes to: "Note › Heading"; in the same file, the heading).
      const [name, ...at] = r[1].split("#")
      const label = r[2] ?? [name.trim(), ...at.map((x) => x.trim())].filter(Boolean).join(" › ")
      return { type: "wikilink", raw: r[0], target: r[1].trim(), label: label.trim(), embed: r[0].startsWith("!") }
    },
    renderer(t) {
      const hit = !resolves || t.target.startsWith("#") ? { kind: "" } : resolves(t.target)
      const kind = hit && !["file", "note"].includes(hit.kind) ? hit.kind : ""
      const link = `<a class="${esc(["wikilink", kind, hit ? "" : "missing"].filter(Boolean).join(" "))}" data-wiki="${esc(t.target)}"${t.embed ? " data-wiki-embed" : ""}>${esc(t.label)}</a>`
      if (!t.embed || !hit) return link
      // An image in the vault shows (`|300` its width); anything else embedded is drawn by the caller in its place.
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
      const n = notes.get((t as FootnoteDef).label)
      if (n && n.html === undefined) n.html = this.parser.parseInline((t as FootnoteDef).tokens)
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
      const label = t.label as string
      let i = order.indexOf(label)
      if (i < 0) { order.push(label); i = order.length - 1 }
      const note = notes.get(label)
      const tip = note ? ` data-tip="${esc(footnoteText(note.text).replace(/\s+/g, " ").slice(0, 300))}"` : ""
      return `<sup class="footnote-ref${note ? "" : " missing"}" data-footnote="${esc(label)}"${tip}>${i + 1}</sup>`
    },
  }
  const mathBlock: TokenizerAndRendererExtension = {
    name: "mathBlock",
    level: "block",
    start: (src: string) => { const i = src.search(/^ {0,3}\$\$/m); return i >= 0 ? i : undefined },
    tokenizer(src: string) {
      const r = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src)
      if (r) return { type: "mathBlock", raw: r[0], text: r[1].trim(), display: true } as Math
    },
    renderer: (t) => `<div class="math math-display" data-math="display">${esc((t as Math).text)}</div>\n`,
  }
  const mathInline: TokenizerAndRendererExtension = {
    name: "mathInline",
    level: "inline",
    start: (src: string) => { const i = src.indexOf("$"); return i >= 0 ? i : undefined },
    tokenizer(src: string) {
      const d = /^\$\$([^$]+?)\$\$/.exec(src)
      if (d) return { type: "mathInline", raw: d[0], text: d[1].trim(), display: true } as Math
      // No space inside the dollars, and no digit right after the closing one ($5 and $10 is text).
      const r = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<![\s\\])\$(?!\d)/.exec(src)
      if (r) return { type: "mathInline", raw: r[0], text: r[1], display: false } as Math
    },
    renderer: (t) => (t as Math).display
      ? `<span class="math math-display" data-math="display">${esc((t as Math).text)}</span>`
      : `<span class="math math-inline" data-math="inline">${esc((t as Math).text)}</span>`,
  }

  // Marks: ==highlight==, #tags, %%comments%% (inline and over lines) and block ids, which reading hides.
  const highlight: TokenizerAndRendererExtension = {
    name: "highlight",
    level: "inline",
    start: (src: string) => { const i = src.indexOf("=="); return i >= 0 ? i : undefined },
    tokenizer(src: string) {
      const r = /^==(?=[^\s=])([\s\S]*?[^\s=])==(?!=)/.exec(src)
      if (r) return { type: "highlight", raw: r[0], tokens: this.lexer.inlineTokens(r[1]) }
    },
    renderer(t) { return `<mark>${this.parser.parseInline(t.tokens ?? [])}</mark>` },
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
  /** A link's attributes by where it goes: a note or a file in the vault (`data-wiki`, followed like a [[link]]), an app
   *  command, the web, or another app's scheme (`data-url`: obsidian://, zotero://, tel:, file://); null: not a link. */
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
  /** An image's address: the web's as it is, a vault file's from `asset`; null for neither. */
  const imageSrc = (href: string): string | null => {
    if (/^https?:/i.test(href)) return href
    if (SCHEME.test(href) || !asset) return null
    let t = href
    try { t = decodeURIComponent(href) } catch { /* as written */ }
    return asset(t.replace(/^(\.\.?\/)+/, ""))
  }
  const html = (text: string) => sanitizeHtml(text, { link: linkAttrs, image: imageSrc })

  const m = new Marked({ gfm: true })
  m.use({
    extensions: [wikilink, footnoteDef, footnoteRef, mathBlock, mathInline, highlight, tag, commentInline, commentBlock, blockId],
    hooks: {
      preprocess(src: string) { notes = new Map(); order = []; return src },
      postprocess(html: string) {
        html = html.replace(/<p>\s*<\/p>\n?/g, "") // (a paragraph that was only a block id or a comment)
        const labels = [...order, ...[...notes.keys()].filter((l) => !order.includes(l))].filter((l) => notes.has(l))
        if (!labels.length) return html
        const items = labels.map((l) => `<li data-footnote-def="${esc(l)}">${notes.get(l)!.html ?? esc(notes.get(l)!.text)}${order.includes(l)
          ? ` <button type="button" class="footnote-back" data-footnote-back="${esc(l)}" aria-label="Back to the text" data-tip="Back to the text">${svg(BACK)}</button>` : ""}</li>`)
        return `${html}<section class="footnotes"><ol>${items.join("")}</ol></section>`
      },
    },
    renderer: {
      // Raw HTML is drawn as Obsidian draws it, sanitized (core/sanitize.ts).
      html: ({ text }: Tokens.HTML | Tokens.Tag) => html(text),
      // Classed by depth too (.note-prose sizes them by class).
      heading({ tokens, depth }: Tokens.Heading) { return `<h${depth} class="h${depth}">${this.parser.parseInline(tokens)}</h${depth}>\n` },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens), attrs = linkAttrs(href)
        return attrs === null ? inner : `<a${attrs}${title ? ` title="${esc(title)}"` : ""}>${inner}</a>`
      },
      // (`![alt|300](photo.png)`: a width after the alt text, as in Obsidian)
      image({ href, text, title }: Tokens.Image) {
        const src = imageSrc(href), w = /^(.*?)\|(\d+(?:x\d+)?)$/.exec(text)
        return src ? img(src, w ? w[1] : text, w ? widthOf(w[2]) : 0, title) : esc(text)
      },
      // Code: a label and a copy button over it; mermaid is drawn later (hydrate), its source showing until then.
      code({ text, lang }: Tokens.Code) {
        const name = (lang ?? "").trim().split(/\s+/)[0]
        if (name.toLowerCase() === "mermaid") return `<div class="md-mermaid" data-mermaid>${esc(text)}</div>\n`
        const cls = name ? ` class="language-${esc(name)}"` : ""
        return `<div class="md-code"><div class="md-code-head"><span class="md-code-lang">${esc(name)}</span>` +
          `<button type="button" class="md-copy" data-copy aria-label="Copy" data-tip="Copy">${COPY_ICON}</button></div>` +
          `<pre><code${cls}>${esc(text.replace(/\n$/, ""))}\n</code></pre></div>\n`
      },
      // A callout: a blockquote whose first line is `[!type] Title`; foldable ones are a <details>.
      blockquote({ tokens }: Tokens.Blockquote) {
        const first = tokens[0]
        const c = first?.type === "paragraph" ? CALLOUT.exec(first.raw) : null
        if (!c) return `<blockquote>\n${this.parser.parse(tokens)}</blockquote>\n`
        const type = calloutType(c[1])
        const titleMd = c[3].trim() || c[1][0].toUpperCase() + c[1].slice(1).toLowerCase()
        const title = this.parser.parseInline(Lexer.lexInline(titleMd, this.parser.options))
        const body = first.raw.slice(c[0].length) + tokens.slice(1).map((t) => t.raw).join("")
        const content = body.trim() ? this.parser.parse(Lexer.lex(body, this.parser.options)) : ""
        const head = `<span class="callout-icon">${svg(ICONS[type])}</span><span class="callout-title-text">${title}</span>`
        const inner = content ? `<div class="callout-content">${content}</div>` : ""
        if (!c[2]) return `<div class="callout" data-callout="${type}"><div class="callout-title">${head}</div>${inner}</div>\n`
        return `<details class="callout" data-callout="${type}"${c[2] === "+" ? " open" : ""}><summary class="callout-title">${head}` +
          `<span class="callout-fold">${svg(CHEVRON)}</span></summary>${inner}</details>\n`
      },
    },
  })
  return m
}

const plain = make()
const md = (opts?: MarkdownOpts) => (opts?.resolves || opts?.asset ? make(opts) : plain)

/** A Markdown document as HTML. */
export const renderMarkdown = (text: string, opts?: MarkdownOpts) => md(opts).parse(text, { async: false }) as string

/** A line of Markdown (bold, links, code; no headings or lists) as HTML. */
export const renderInline = (text: string, opts?: MarkdownOpts) => md(opts).parseInline(text, { async: false }) as string
