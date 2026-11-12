import { redo, undo } from "@codemirror/commands"
import { syntaxTree } from "@codemirror/language"
import { EditorSelection, Facet, Prec, StateEffect, StateField, Transaction, type EditorState, type Range, type Text } from "@codemirror/state"
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view"
import type { SyntaxNode } from "@lezer/common"
import { embedOf, fenceBlock } from "@/core/formats"
import { innerOf, setProp } from "@/core/frontmatter"
import { CALLOUT, footnoteText, WIKI_LINK } from "@/core/markdown"
import { haptic } from "@/core/haptics"
import { isMac } from "@/core/platform"
import { keepOnScreen } from "@/core/anchor"
import { blockHeightKey, heightOf, holdHeight, textKey } from "@/core/heights"
import { BLOCK_ID, blockName, FENCE, scan, TAG } from "../../../core/sections.ts"
import { fenceLayout, infoWithLayout, type LayoutKey } from "../../../core/blocks.ts"
import { frontmatter, shownStart } from "./frontmatter"
import { blockLines, COPY_ICON, copyCode, drawEmbeds, dropMermaid, hydrate, markdownDrawn, renderMath, renderMermaid, richClick, taskMarks, wireTasks } from "@/core/richmd"
import { capitalize } from "@/lib/utils"
import { drawTable as drawCells, enterTable } from "./tables"
import { cellAt } from "./tableText"
import { commentSpans, highlightClass, highlightColor, highlightSpans, paragraphAt, unquoted, type HighlightColor } from "@/core/highlights"
import { highlightItems } from "@/core/highlightMenu"
import { drawnLink, linkClick, type Link, type LinkClick } from "@/core/links"
import { openMenu } from "@/components/ContextMenu"
import type { ReadingBlock, ReadingDrawn } from "@/core/define"
import type { ReadBlock } from "@/core/plugins"

export type PreviewConfig = {
  live: boolean
  writable: boolean
  resolves: (target: string) => string | null
  asset: (name: string) => string | null
  embedMenu?: (target: string, at: { x: number; y: number }, edit: EmbedEdit) => void
  openImage?: (target: string) => void
  sections: string[]
  renderSection: (name: string, text: string, el: HTMLElement) => Drawn
  renderBlock: (name: string, text: string, el: HTMLElement, edit: BlockEdit) => Drawn
  blockMenu?: (name: string, text: string, at: { x: number; y: number }, edit: BlockEdit) => void
  blockNotes?: (name: string, text: string) => { notes: string[]; about?: string }
  renderEmbed: (target: string, height: number | undefined, el: HTMLElement, edit: () => EmbedEdit | null) => Drawn | false
  renderMarkdown: (md: string) => string
  linkMenu?: (link: Link, at: { x: number; y: number }, text: string) => void
  follow: (link: { wiki?: string; tag?: string }, newTab: boolean) => void
  version: number
  place?: string
  renderGrid?: (cards: GridCard[], el: HTMLElement, edit: GridEdit) => { update: (cards: GridCard[]) => void; destroy: () => void }
  readBlock?: ReadBlock | null
}

export type Drawn = { update: (text: string) => void; destroy: () => void }
export type BlockEdit = {
  bar: HTMLElement
  line: () => number | null
  nth: () => number
  source: (() => void) | null
  setText: ((text: string, typed?: boolean) => void) | null
  done: () => void
}
/** A block of a run drawn as a grid: `wide` takes the row, `stack` goes under the one before (its fence's layout:
 *  core/blocks.ts fenceLayout). */
export type GridCard = { name: string; text: string; wide: boolean; stack: boolean }
/** What changes a run of blocks in the file, each block by its index in the run (found where it is now). */
export type GridEdit = {
  /** The file can be changed. */
  writable: boolean
  /** Block k as an editor's block: its bar (what BlockView adds goes in `bar`) and `source`, how its card shows it. */
  block: (k: number, bar: HTMLElement, source: () => void) => BlockEdit
  /** Block k moved before or after the cell (a block and those stacked under it) holding block `at` of run `to`: with
   *  its own stacked ones, or (stacked itself) alone, then no longer stacked. */
  move: (k: number, to: GridEdit, at: number, after: boolean) => void
  add: (fence: string) => void
  remove: (k: number) => void
  set: (k: number, key: LayoutKey, value: true | undefined) => void
  history: (redo?: boolean) => void
}
export type EmbedEdit = { size: number; writable: boolean; resize: (n: number | null) => void; remove: () => void }

export const previewConfig = Facet.define<PreviewConfig, PreviewConfig>({ combine: (v) => v[v.length - 1] })

const setFocus = StateEffect.define<boolean>()
const focused = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((a, e) => (e.is(setFocus) ? e.value : a), v),
})
const menuOpen = () => !!document.querySelector("[role=menu]")
const focusTracker = EditorView.focusChangeEffect.of((_, on) => (on || !menuOpen() ? setFocus.of(on) : null))
const menuGone = ViewPlugin.define((view) => {
  // setTimeout: CodeMirror can't dispatch inside its own update, which may be what moved the focus.
  const check = () => setTimeout(() => { if (view.state.field(focused) && !view.hasFocus && !menuOpen()) view.dispatch({ effects: setFocus.of(false) }) })
  document.addEventListener("focusin", check)
  return { destroy: () => document.removeEventListener("focusin", check) }
})

const editing = (state: EditorState) => state.field(focused) && state.facet(EditorView.editable)
function touched(state: EditorState, from: number, to: number) {
  return editing(state) && state.selection.ranges.some((r) => r.to >= from && r.from <= to)
}
// The cursor in front counts too: Vim's block cursor there drew its first character over the box.
function touchedInside(state: EditorState, from: number, to: number) {
  return editing(state) && state.selection.ranges.some((r) => (r.empty ? r.head >= from && r.head < to : r.to > from && r.from < to))
}
function touchedLines(state: EditorState, from: number, to: number) {
  if (!editing(state)) return false
  const a = state.doc.lineAt(from).from, b = state.doc.lineAt(to).to
  return state.selection.ranges.some((r) => r.to >= a && r.from <= b)
}

// CodeMirror can't measure a hidden-Markdown line's very start (it has no size): scroll to its text.
export const textStart = (state: EditorState, pos: number) => textStartIn(state.doc, pos)
export function textStartIn(doc: Text, pos: number) {
  const l = doc.lineAt(pos)
  const m = /^(?:[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+|\[\^[^\]\s]+\]:[ \t]?))*/.exec(l.text)
  return l.from + (m ? m[0].length : 0)
}

const reading = (state: EditorState) => !state.facet(EditorView.editable)

const BULLET = 0.95
class Bullet extends WidgetType {
  eq() { return true }
  toDOM() { const s = document.createElement("span"); s.className = "cm-bullet"; s.textContent = "•"; return s }
}

// No position stored: eq would fail for every box below an edit, and CodeMirror redraws them each keystroke.
class Check extends WidgetType {
  on: boolean; writable: boolean
  constructor(on: boolean, writable: boolean) { super(); this.on = on; this.writable = writable }
  eq(o: Check) { return o.on === this.on && o.writable === this.writable }
  toDOM(view: EditorView) {
    const box = document.createElement("input")
    box.type = "checkbox"
    box.checked = this.on
    box.className = "cm-task"
    box.disabled = !this.writable
    box.setAttribute("aria-label", this.on ? "Done" : "Not done")
    // The hit span widens the box for fingers (index.css): an input can't have ::after.
    const hit = document.createElement("span")
    hit.className = "cm-task-hit"
    hit.append(box)
    hit.addEventListener("mousedown", (e) => e.preventDefault())
    hit.addEventListener("click", (e) => {
      e.preventDefault()
      if (!this.writable || !view.state.facet(previewConfig).writable) return
      const from = view.posAtDOM(hit), line = view.state.doc.lineAt(from), at = line.from + line.text.indexOf("[", from - line.from)
      const cur = view.state.sliceDoc(at, at + 3)
      if (!/^\[[ xX]\]$/.test(cur)) return
      haptic()
      view.dispatch({ changes: { from: at + 1, to: at + 2, insert: this.on ? " " : "x" }, userEvent: "input.toggle" })
    })
    return hit
  }
  ignoreEvent() { return true }
}

class Indent extends WidgetType {
  w: number
  constructor(w: number) { super(); this.w = w }
  eq(o: Indent) { return o.w === this.w }
  toDOM() { const s = document.createElement("span"); s.className = "cm-indent"; s.style.width = `${this.w}px`; return s }
}

class Sep extends WidgetType {
  eq() { return true }
  toDOM() { const s = document.createElement("span"); s.className = "cm-wikilink-sep"; s.textContent = " › "; return s }
  ignoreEvent() { return false }
}

class Rule extends WidgetType {
  eq() { return true }
  toDOM() { const s = document.createElement("span"); s.className = "cm-hr"; return s }
}

class Img extends WidgetType {
  src: string; target: string; alt: string; width: number; at: number
  constructor(src: string, target: string, alt: string, width: number, at = -1) {
    super(); this.src = src; this.target = target; this.alt = alt; this.width = width; this.at = at
  }
  get source() { return this.at >= 0 }
  eq(o: Img) { return o.src === this.src && o.target === this.target && o.alt === this.alt && o.width === this.width && o.at === this.at }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span")
    wrap.className = `cm-image-wrap${this.source ? " is-source" : ""}${this.width ? " is-sized" : ""}`
    wrap.dataset.holdMenu = ""
    const img = document.createElement("img")
    img.src = this.src
    img.alt = this.alt
    img.loading = "lazy"
    img.draggable = false
    img.className = "cm-image"
    if (this.width) img.style.width = `${this.width}px`
    const edit = () => embedEdit(view, this.source ? this.at : view.posAtDOM(wrap))
    const tools = document.createElement("span")
    tools.className = "cm-image-tools"
    tools.append(toolButton(ZOOM_ICON, "Open image", () => view.state.facet(previewConfig).openImage?.(this.target)))
    if (view.state.facet(EditorView.editable)) {
      tools.append(toolButton(CODE_ICON, this.source ? "Hide Markdown" : "Show Markdown", () => {
        if (this.source) { view.contentDOM.blur(); return }
        const e = edit()
        if (e) { view.dispatch({ selection: EditorSelection.cursor(e.to) }); view.focus() }
      }))
    }
    wrap.append(img, tools)
    if (view.state.facet(previewConfig).writable && view.state.facet(EditorView.editable)) {
      const grip = document.createElement("span")
      grip.className = "cm-image-resize"
      grip.addEventListener("pointerdown", (e) => dragWidth(e, view, wrap, img, edit))
      wrap.append(grip)
    }
    wrap.addEventListener("contextmenu", (e) => {
      const cfg = view.state.facet(previewConfig), at = edit()
      if (!cfg.embedMenu || !at) return
      e.preventDefault(); e.stopPropagation()
      cfg.embedMenu(this.target, { x: e.clientX, y: e.clientY }, at)
    })
    return wrap
  }
  ignoreEvent(e: Event) { return e.type === "contextmenu" || (e.target as Element).closest?.(".cm-image-tools, .cm-image-resize") != null }
}

const VOID = /^(br|img|wbr|hr)$/i
class HtmlInline extends WidgetType {
  html: string
  constructor(html: string) { super(); this.html = html }
  eq(o: HtmlInline) { return o.html === this.html }
  toDOM(view: EditorView) {
    const el = document.createElement("span")
    el.className = "cm-html"
    el.innerHTML = view.state.facet(previewConfig).renderMarkdown(this.html).trim().replace(/^<p>([\s\S]*)<\/p>$/, "$1")
    return el
  }
  ignoreEvent() { return false }
}

class InlineEmbed extends WidgetType {
  target: string
  constructor(target: string) { super(); this.target = target }
  eq(o: InlineEmbed) { return o.target === this.target }
  toDOM(view: EditorView) {
    const el = document.createElement("span")
    el.className = "cm-inline-embed"
    const drawn = view.state.facet(previewConfig).renderEmbed(this.target, undefined, el, () => null)
    if (drawn) inlineDrawn.set(el, drawn)
    else {
      el.className += " is-link cm-wikilink"
      el.dataset.wiki = this.target
      el.textContent = this.target
    }
    return el
  }
  destroy(dom: HTMLElement) { inlineDrawn.get(dom)?.destroy() }
  ignoreEvent(e: Event) { return !(e.target as Element).closest?.(".cm-inline-embed.is-link") }
}
const inlineDrawn = new WeakMap<HTMLElement, Drawn>()

const ZOOM_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>'
const CODE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16"/></svg>'
function toolButton(icon: string, label: string, run: () => void) {
  const b = document.createElement("button")
  b.type = "button"
  b.innerHTML = icon
  b.setAttribute("aria-label", label)
  b.dataset.tip = label
  b.addEventListener("mousedown", (e) => e.preventDefault())
  b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); run() })
  return b
}

function dragWidth(e: PointerEvent, view: EditorView, wrap: HTMLElement, img: HTMLImageElement, edit: () => EmbedEdit | null) {
  if (e.button !== 0) return
  e.preventDefault(); e.stopPropagation()
  const grip = e.currentTarget as HTMLElement
  grip.setPointerCapture(e.pointerId)
  const x0 = e.clientX, w0 = img.getBoundingClientRect().width
  const max = view.contentDOM.getBoundingClientRect().width
  let w = Math.round(w0)
  wrap.classList.add("is-sized", "is-resizing")
  const move = (m: PointerEvent) => { w = Math.round(Math.min(max, Math.max(48, w0 + m.clientX - x0))); img.style.width = `${w}px` }
  const up = () => {
    grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up)
    wrap.classList.remove("is-resizing")
    if (w !== Math.round(w0)) edit()?.resize(w)
  }
  grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up)
}

const MD_IMAGE = /!\[([^\]\n]*)\]\(([^)\s]+)((?:\s+"[^"\n]*")?)\)/g
function sized(opts: string) {
  const parts = opts ? opts.split("|") : []
  const w = /^\s*(\d+)(?:x\d+)?\s*$/.exec(parts[parts.length - 1] ?? "")
  return { width: w ? Number(w[1]) : 0, rest: w ? parts.slice(0, -1) : parts }
}

function embedEdit(view: EditorView, pos: number): (EmbedEdit & { to: number }) | null {
  const l = view.state.doc.lineAt(pos)
  const hits: { from: number; to: number; write: (w: number | null) => string; width: number }[] = []
  WIKI.lastIndex = 0
  for (let m; (m = WIKI.exec(l.text));) {
    if (!m[1]) continue
    const [all, , target, opts] = m, { width, rest } = sized(opts ?? "")
    hits.push({ from: l.from + m.index, to: l.from + m.index + all.length, width,
      write: (w) => `![[${target}${[...rest, ...(w ? [w] : [])].map((r) => `|${r}`).join("")}]]` })
  }
  MD_IMAGE.lastIndex = 0
  for (let m; (m = MD_IMAGE.exec(l.text));) {
    const [all, alt, url, title] = m, { width, rest } = sized(alt)
    hits.push({ from: l.from + m.index, to: l.from + m.index + all.length, width,
      write: (w) => `![${rest.join("|")}${w ? `|${w}` : ""}](${url}${title})` })
  }
  const h = hits.find((x) => x.from === pos)
  if (!h) return null
  const { from, to } = h
  return {
    size: h.width, to, writable: view.state.facet(previewConfig).writable,
    resize: (w) => view.dispatch({ changes: { from, to, insert: h.write(w) }, userEvent: "input.resize" }),
    remove: () => {
      const { doc } = view.state
      const blank = !(l.text.slice(0, from - l.from) + l.text.slice(to - l.from)).trim()
      const empty = (n: number) => n >= 1 && n <= doc.lines && !doc.line(n).text.trim()
      const gap = blank && (l.number === 1 || empty(l.number - 1)) && empty(l.number + 1)
      const end = gap ? doc.line(l.number + 1).to + (l.number + 1 < doc.lines ? 1 : 0)
        : blank && l.to < doc.length ? l.to + 1 : blank ? l.to : view.state.sliceDoc(from - 1, to + 1).match(/^ .* $/) ? to + 1 : to
      view.dispatch({ changes: { from: blank ? l.from : from, to: end }, userEvent: "delete" })
    },
  }
}

class FenceHead extends WidgetType {
  lang: string; code: string
  constructor(lang: string, code: string) { super(); this.lang = lang; this.code = code }
  eq(o: FenceHead) { return o.lang === this.lang && o.code === this.code }
  toDOM() {
    const head = document.createElement("span")
    head.className = "cm-fence-head"
    const lang = document.createElement("span")
    lang.className = "cm-fence-lang"
    lang.textContent = this.lang
    const copy = document.createElement("button")
    copy.type = "button"
    copy.className = "cm-fence-copy"
    copy.innerHTML = COPY_ICON
    copy.setAttribute("aria-label", "Copy")
    copy.dataset.tip = "Copy"
    copy.addEventListener("mousedown", (e) => e.preventDefault())
    copy.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); copyCode(copy, this.code) })
    head.append(lang, copy)
    return head
  }
  ignoreEvent(e: Event) { return (e.target as Element).closest?.(".cm-fence-copy") != null }
}

class MathInline extends WidgetType {
  tex: string
  constructor(tex: string) { super(); this.tex = tex }
  eq(o: MathInline) { return o.tex === this.tex }
  toDOM() { const s = document.createElement("span"); renderMath(this.tex, s, false); return s }
  ignoreEvent() { return false }
}

// No position stored, as with Check: eq would fail for every reference below an edit.
class FootnoteRef extends WidgetType {
  label: string; n: number; tip: string; found: boolean
  constructor(label: string, n: number, tip: string, found: boolean) { super(); this.label = label; this.n = n; this.tip = tip; this.found = found }
  eq(o: FootnoteRef) { return o.label === this.label && o.n === this.n && o.tip === this.tip && o.found === this.found }
  toDOM(view: EditorView) {
    const s = document.createElement("sup")
    s.className = `cm-footnote-ref${this.found ? "" : " is-missing"}`
    s.textContent = String(this.n || this.label)
    if (this.tip) s.dataset.tip = this.tip
    s.addEventListener("mousedown", (e) => {
      const at = footnotes(view.state.doc).defs.get(this.label)?.at
      if (at === undefined) return
      e.preventDefault()
      view.dispatch({ effects: EditorView.scrollIntoView(textStart(view.state, at), { y: "center" }) })
    })
    return s
  }
  ignoreEvent() { return true }
}

class FootnoteLabel extends WidgetType {
  text: string
  constructor(text: string) { super(); this.text = text }
  eq(o: FootnoteLabel) { return o.text === this.text }
  toDOM() { const s = document.createElement("span"); s.className = "cm-footnote-label"; s.textContent = this.text; return s }
}

class Block extends WidgetType {
  key: string; text: string; version: number; draw: Draw
  held: string; guess?: string
  constructor(key: string, text: string, version: number, draw: Draw, place = "") {
    super()
    this.key = key; this.text = text; this.version = version; this.draw = draw
    const name = key.startsWith("block:") ? key.slice(6) : null
    this.held = name ? blockHeightKey("editor", place, name, text) : `editor:${place}:${key}:${textKey(text)}`
    if (name) this.guess = blockHeightKey("page", place, name, text)
  }
  get view() { return this.key.startsWith("block:") || this.key.startsWith("embed:") }
  eq(o: Block) { return o.key === this.key && o.text === this.text && o.version === this.version }
  toDOM(view: EditorView) {
    const el = document.createElement("div")
    el.className = `cm-block cm-block-${this.key.split(":")[0]}`
    el.dataset.key = this.key
    if (this.view) el.dataset.chrome = ""
    const body = document.createElement("div")
    body.className = "cm-block-body"
    const bar = blockBar(view, el)
    el.append(body, ...(this.view || this.key === "table" ? [bar.el] : []))
    holds.set(el, holdHeight(el, () => this.heldNow, true))
    drawn.set(el, this.draw(body, this.text, view, bar.edit))
    if (this.draw === drawHtml) keepFolds(body, this.held)
    painted.set(el, this)
    el.addEventListener("mousedown", (e) => { if (pressed(view, el, e) && !this.view) bar.edit.source!() })
    el.addEventListener("click", (e) => { const w = (e.target as Element).closest("[data-wiki], [data-tag]"); if (w && !w.closest("[data-embed]")) e.preventDefault() })
    if (!this.view) el.addEventListener("contextmenu", (e) => {
      const l = drawnLink(e.target), menu = view.state.facet(previewConfig).linkMenu
      if (!l || !menu || e.defaultPrevented || l.el.closest("[data-embed]")) return
      e.preventDefault()
      menu(l.link, { x: e.clientX, y: e.clientY }, l.text)
    })
    return el
  }
  updateDOM(el: HTMLElement) {
    const d = drawn.get(el), was = painted.get(el)
    if (!d || el.dataset.key !== this.key) return false
    if (!was || was.text !== this.text || was.version !== this.version) d.update(this.text)
    painted.set(el, this)
    return true
  }
  destroy(el: HTMLElement) { drawn.get(el)?.destroy(); drawn.delete(el); holds.get(el)?.(); holds.delete(el) }
  ignoreEvent() { return true }
  get heldNow() { return this.draw === drawHtml ? `${this.held}:${folds.get(this.held)?.map((o) => (o ? 1 : 0)).join("") ?? "as-written"}` : this.held }
  get estimatedHeight() { return heightOf(this.heldNow) ?? (this.guess ? heightOf(this.guess) : undefined) ?? 120 }
}
type Draw = (el: HTMLElement, text: string, view: EditorView, edit: BlockEdit) => Drawn

function pressed(view: EditorView, el: HTMLElement, e: MouseEvent) {
  if (e.button === 2 || (e.ctrlKey && e.button === 0 && isMac)) { e.preventDefault(); return false }
  const wiki = (e.target as Element).closest<HTMLElement>("[data-wiki], [data-tag]")
  if (wiki && (e.button === 0 || e.button === 1) && !wiki.closest("[data-embed]")) {
    e.preventDefault()
    if (e.button === 1) noPaste()
    view.state.facet(previewConfig).follow(wiki.dataset.tag ? { tag: wiki.dataset.tag } : { wiki: wiki.dataset.wiki! }, e.metaKey || e.ctrlKey || e.button === 1)
    return false
  }
  const own = (e.target as Element).closest("a, button, input, textarea, select, summary, [contenteditable=true], [data-no-edit], [data-md-embed]")
  if ((own && el.contains(own)) || e.defaultPrevented || !view.state.facet(EditorView.editable)) return false
  e.preventDefault()
  return true
}

type Member = GridCard & { a: number; b: number }
class Grid extends WidgetType {
  members: Member[]; version: number; key: string; held: string
  constructor(members: Member[], version: number, place = "") {
    super()
    this.members = members; this.version = version
    this.key = members.map((m) => `${m.name}\0${m.wide}\0${m.stack}\0${m.text}`).join("\0\0")
    this.held = `editor:${place}:grid:${textKey(this.key)}`
  }
  get cards(): GridCard[] { return this.members.map(({ name, text, wide, stack }) => ({ name, text, wide, stack })) }
  eq(o: Grid) { return o.key === this.key && o.version === this.version }
  toDOM(view: EditorView) {
    const el = document.createElement("div")
    el.className = "cm-grid"
    holds.set(el, holdHeight(el, this.held, true))
    grids.set(el, view.state.facet(previewConfig).renderGrid!(this.cards, el, gridEdit(view, el)))
    paintedGrid.set(el, this)
    el.addEventListener("mousedown", (e) => { pressed(view, el, e) })
    return el
  }
  updateDOM(el: HTMLElement) {
    const d = grids.get(el), was = paintedGrid.get(el)
    if (!d) return false
    if (!was || was.key !== this.key || was.version !== this.version) d.update(this.cards)
    paintedGrid.set(el, this)
    return true
  }
  destroy(el: HTMLElement) { grids.get(el)?.destroy(); grids.delete(el); holds.get(el)?.(); holds.delete(el) }
  ignoreEvent() { return true }
  get estimatedHeight() { return heightOf(this.held) ?? (this.members.length ? 240 : 60) }
}
const grids = new WeakMap<HTMLElement, { update: (cards: GridCard[]) => void; destroy: () => void }>()
const paintedGrid = new WeakMap<HTMLElement, Grid>()

const withOption = (text: string, key: string, value: unknown) => innerOf(setProp(`---\n${text}\n---\n`, key, value))

function cut(doc: Text, a: number, b: number) {
  let n = b + 1
  while (n <= doc.lines && !doc.line(n).text.trim()) n++
  if (n <= doc.lines) return { from: doc.line(a).from, to: doc.line(n).from }
  let p = a - 1
  while (p >= 1 && !doc.line(p).text.trim()) p--
  return { from: p >= 1 ? doc.line(p).to : doc.line(a).from, to: doc.line(b).to }
}
const nextFull = (doc: Text, b: number) => { let n = b + 1; while (n <= doc.lines && !doc.line(n).text.trim()) n++; return n }
function cellOf(ms: Member[], k: number): [number, number] {
  let s = k
  while (s > 0 && ms[s].stack) s--
  let e = s
  while (e + 1 < ms.length && ms[e + 1].stack) e++
  return [s, e]
}
function atEnd(doc: Text, text: string) {
  const end = doc.sliceString(Math.max(0, doc.length - 2))
  return { from: doc.length, insert: `${!doc.length || end === "\n\n" ? "" : end.endsWith("\n") ? "\n" : "\n\n"}${text}\n` }
}

const runs = new WeakMap<GridEdit, { view: EditorView; run: () => { w: Grid } | null }>()
function gridEdit(view: EditorView, el: HTMLElement): GridEdit {
  const run = () => {
    if (!el.isConnected) return null
    let hit = null as { w: Grid } | null
    const pos = view.posAtDOM(el)
    view.state.field(blockField).deco.between(pos, pos, (from, _to, d) => { if (from === pos && d.spec.widget instanceof Grid) hit = { w: d.spec.widget } })
    return hit
  }
  const member = (k: number) => run()?.w.members[k] ?? null
  const fenceAt = (a: number) => view.state.field(blockField).c.list.find((x) => x.fence && x.a === a) ?? null
  const put = (changes: { from: number; to?: number; insert?: string }[], userEvent: string) => {
    if (view.state.facet(previewConfig).writable && changes.length) view.dispatch({ changes, userEvent })
  }
  const edit: GridEdit = {
    get writable() { return view.state.facet(previewConfig).writable && view.state.facet(EditorView.editable) },
    block: (k, bar, source) => {
      const find = () => { const m = member(k); return m ? fenceAt(m.a) : null }
      return editOf(view, find, bar, source)
    },
    move: (k, to, at, after) => {
      const there = runs.get(to)
      const ms = run()?.w.members, dst = there?.view === view ? there.run()?.w.members : null
      if (!ms?.[k] || !dst) return
      const doc = view.state.doc
      const lead = k === 0 || !ms[k].stack
      const [s, e] = lead ? cellOf(ms, k) : [k, k]
      const A = ms[s].a, B = ms[e].b
      let text = doc.sliceString(doc.line(A).from, doc.line(B).to)
      if (!lead) {
        const c = layoutChange(doc, ms[k], "stack", false), at = doc.line(A).from
        text = text.slice(0, c.from - at) + c.insert + text.slice(c.to - at)
      }
      let ins: { from: number; insert: string }
      if (!dst.length) ins = atEnd(doc, text)
      else {
        const [ts, te] = cellOf(dst, Math.min(at, dst.length - 1))
        const T = dst[ts].a, U = dst[te].b
        if (T <= B && U >= A) return
        if (lead && (after ? nextFull(doc, U) === A : nextFull(doc, B) === T)) return
        ins = after ? { from: doc.line(U).to, insert: `\n\n${text}` } : { from: doc.line(T).from, insert: `${text}\n\n` }
      }
      put([cut(doc, A, B), ins], "move.drop")
    },
    add: (fence) => {
      const doc = view.state.doc, ms = run()?.w.members, text = fence.replace(/\s+$/, "")
      put([ms?.length ? { from: doc.line(ms[ms.length - 1].b).to, insert: `\n\n${text}` } : atEnd(doc, text)], "input.block")
    },
    remove: (k) => {
      const ms = run()?.w.members
      if (!ms?.[k]) return
      const doc = view.state.doc, changes: { from: number; to?: number; insert?: string }[] = [cut(doc, ms[k].a, ms[k].b)]
      const next = ms[k + 1]
      if ((k === 0 || !ms[k].stack) && next?.stack) changes.push(layoutChange(doc, next, "stack", false))
      put(changes, "delete.block")
    },
    set: (k, key, value) => {
      const m = member(k)
      if (m) put([layoutChange(view.state.doc, m, key, value === true)], "input.block")
    },
    history: (again) => { (again ? redo : undo)(view) },
  }
  runs.set(edit, { view, run })
  return edit
}
function layoutChange(doc: Text, m: { a: number; b: number; text: string }, key: LayoutKey, on: boolean) {
  const open = doc.line(m.a), f = FENCE.exec(open.text)!, info = open.text.slice(f[0].length)
  if (blockName(info)) return fenceBody(doc, m, withOption(m.text, key, on || undefined))
  const from = open.from + f[0].length + /^\s*/.exec(info)![0].length
  return { from, to: open.to, insert: infoWithLayout(info, key, on) }
}
function fenceBody(doc: Text, m: { a: number; b: number }, text: string) {
  const body = text.replace(/\s+$/, ""), open = doc.line(m.a)
  const r = m.b > m.a + 1 ? { from: body ? doc.line(m.a + 1).from : open.to, to: doc.line(m.b - 1).to, insert: body } : { from: open.to, to: open.to, insert: body ? `\n${body}` : "" }
  const was = doc.sliceString(r.from, r.to)
  let s = 0, e = 0
  while (s < was.length && s < r.insert.length && was[s] === r.insert[s]) s++
  while (e < was.length - s && e < r.insert.length - s && was[was.length - 1 - e] === r.insert[r.insert.length - 1 - e]) e++
  return { from: r.from + s, to: r.to - e, insert: r.insert.slice(s, r.insert.length - e) }
}


function blockBar(view: EditorView, el: HTMLElement): { el: HTMLElement; edit: BlockEdit } {
  const bar = document.createElement("div")
  bar.className = "cm-block-bar"
  const slot = document.createElement("div")
  slot.className = "cm-block-slot"
  const src = document.createElement("button")
  src.type = "button"
  src.className = "cm-block-btn cm-block-source"
  src.dataset.tip = "Edit source"
  src.setAttribute("aria-label", "Edit source")
  bar.append(slot, src)
  const cand = () => {
    if (!el.isConnected) return null
    const s = view.state, at = s.doc.lineAt(Math.min(view.posAtDOM(el), s.doc.length)).number
    return s.field(blockField).c.list.find((x) => x.a === at) ?? null
  }
  const edit = editOf(view, cand, slot)
  src.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); edit.source?.() })
  return { el: bar, edit }
}

function editOf(view: EditorView, find: () => Cand | null, bar: HTMLElement, own?: () => void): BlockEdit {
  const source = own ?? (() => {
    const x = find()
    if (!x) return
    const was = drawnTop(view, x)
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(x.a).to), scrollIntoView: was === null, userEvent: "select" })
    view.focus()
    if (was !== null) keepOnScreen(view, x.from, (p) => lineTop(view, p), was)
  })
  return {
    bar,
    line: () => { const x = find(); return x ? x.a - 1 : null },
    nth: () => {
      const x = find(), list = view.state.field(blockField).c.list
      return x?.fence ? list.filter((c) => c.fence?.name === x.fence!.name && c.a < x.a).length : 0
    },
    get source() { return view.state.facet(EditorView.editable) ? source : null },
    get setText() { return view.state.facet(previewConfig).writable ? (t: string, typed?: boolean) => setInner(view, find(), t, typed) : null },
    done: () => doneEditing(view),
  }
}

function setInner(view: EditorView, x: Cand | null, text: string, typed = false) {
  if (x) view.dispatch({ changes: fenceBody(view.state.doc, x, text), userEvent: typed ? "input.type" : "input.block" })
}

function doneEditing(view: EditorView) {
  const r = view.state.selection.main
  const x = view.state.field(blockField).c.list.find((c) => !c.always && r.head >= c.from && r.head <= c.to)
  if (!x) return
  const doc = view.state.doc
  const at = x.b < doc.lines ? doc.line(x.b + 1).from : doc.line(x.b).to
  const was = lineTop(view, x.from)
  if (x.b >= doc.lines) view.dispatch({ changes: { from: at, insert: "\n" }, selection: EditorSelection.cursor(at + 1), userEvent: "input" })
  else view.dispatch({ selection: EditorSelection.cursor(at), userEvent: "select" })
  view.focus()
  keepOnScreen(view, x.from, (p) => drawnTop(view, { ...x, from: p }), was)
}

const lineTop = (view: EditorView, pos: number) => view.documentTop + view.lineBlockAt(Math.min(pos, view.state.doc.length)).top
function drawnTop(view: EditorView, x: Cand): number | null {
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>(".cm-grid")) {
    const ms = paintedGrid.get(el)?.members ?? [], k = ms.findIndex((m) => m.a === x.a)
    if (k < 0) continue
    const cards = el.querySelectorAll<HTMLElement>("[data-card]")
    return cards.length === ms.length ? cards[k].getBoundingClientRect().top : null
  }
  return lineTop(view, x.from)
}

class Foot extends WidgetType {
  name: string; text: string; notes: string[]; about: string
  constructor(name: string, text: string, n: { notes: string[]; about?: string }) { super(); this.name = name; this.text = text; this.notes = n.notes; this.about = n.about ?? "" }
  eq(o: Foot) { return o.name === this.name && o.text === this.text && o.notes.join() === this.notes.join() && o.about === this.about }
  toDOM(view: EditorView) {
    const el = document.createElement("div")
    el.className = "cm-block-foot"
    el.dataset.blockNotes = this.name
    const p = document.createElement("span")
    p.className = "cm-block-notes"
    const say = this.notes.join("; ") || this.about
    p.textContent = capitalize(say)
    if (this.notes.length) p.classList.add("is-wrong")
    const done = document.createElement("button")
    done.type = "button"
    done.className = "cm-block-done"
    done.textContent = "Done"
    done.addEventListener("mousedown", (e) => { e.preventDefault(); doneEditing(view) })
    el.append(p, done)
    return el
  }
  ignoreEvent() { return true }
}

const drawn = new WeakMap<HTMLElement, Drawn>()
const holds = new WeakMap<HTMLElement, () => void>()
const folds = new Map<string, boolean[]>()
function keepFolds(body: HTMLElement, key: string) {
  const all = () => [...body.querySelectorAll("details")]
  const kept = folds.get(key)
  if (kept) all().forEach((d, i) => { if (i < kept.length) d.open = kept[i] })
  // toggle doesn't bubble, so it's caught on the way down.
  body.addEventListener("toggle", () => {
    folds.delete(key)
    folds.set(key, all().map((d) => d.open))
    while (folds.size > 500) folds.delete(folds.keys().next().value!)
  }, true)
}
const painted = new WeakMap<HTMLElement, Block>()

let canvas: CanvasRenderingContext2D | null = null
const fonts = new WeakMap<EditorView, { key: string; font: string; size: number; widths: Map<string, number> }>()
function measurer(view: EditorView) {
  canvas ??= document.createElement("canvas").getContext("2d")
  const key = `${view.defaultCharacterWidth} ${view.defaultLineHeight} ${view.contentDOM.className}`
  let f = fonts.get(view)
  if (f?.key !== key) {
    const cs = getComputedStyle(view.contentDOM)
    f = { key, font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, size: parseFloat(cs.fontSize) || 17, widths: new Map() }
    fonts.set(view, f)
  }
  const { font, size, widths } = f
  return {
    size,
    width: (s: string) => {
      let w = widths.get(s)
      if (w === undefined) {
        if (!canvas) return 0
        canvas.font = font
        w = canvas.measureText(s.replace(/\t/g, "    ")).width
        if (widths.size < 1000) widths.set(s, w)
      }
      return w
    },
  }
}

type Notes = { defs: Map<string, { at: number; text: string }>; num: Map<string, number> }
const notesOf = new WeakMap<Text, Notes>()
const FN_DEF = /^\[\^([^\]\s]+)\]:[ \t]?/
const FN_REF = /\[\^([^\]\s]+)\](?!:)/g
function footnotes(doc: Text): Notes {
  let n = notesOf.get(doc)
  if (n) return n
  n = { defs: new Map(), num: new Map() }
  const { code } = scanOf(doc)
  for (let k = 1; k <= doc.lines; k++) {
    const l = doc.line(k)
    if (code[k - 1] || !l.text.includes("[^")) continue
    const d = FN_DEF.exec(l.text)
    if (d && !n.defs.has(d[1])) n.defs.set(d[1], { at: l.from, text: footnoteText(l.text.slice(d[0].length)).trim() })
    FN_REF.lastIndex = d ? d[0].length : 0
    for (let m; (m = FN_REF.exec(l.text));) if (!n.num.has(m[1])) n.num.set(m[1], n.num.size + 1)
  }
  notesOf.set(doc, n)
  return n
}
// Pandoc's $TeX$ rule: no space inside the dollars, no digit right after the closing one ($5 and $10 is text).
const MATH = /(?<![\\$])\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<![\s\\$])\$(?![\d$])/g

const hide = Decoration.replace({})
const mark = (cls: string, attrs?: Record<string, string>) => Decoration.mark({ class: cls, attributes: attrs })
const line = (cls: string) => Decoration.line({ class: cls })
const WIKI = new RegExp(`(!?)${WIKI_LINK}`, "g")
const IMAGE = /\.(png|jpe?g|gif|webp|svg|heic)$/i

function inline(view: EditorView): DecorationSet {
  const { state } = view
  const cfg = state.facet(previewConfig)
  const out: Range<Decoration>[] = []
  const live = cfg.live
  const tree = syntaxTree(state)
  const m = measurer(view)
  const child = (n: SyntaxNode, name: string) => { const c: SyntaxNode[] = []; let x = n.firstChild; while (x) { if (x.name === name) c.push(x); x = x.nextSibling } return c }
  const markerWidth = (lm: SyntaxNode, task: SyntaxNode | null | undefined, bullet: boolean) => {
    const end = (task ?? lm).to
    const space = state.sliceDoc(end, end + 1) === " " ? " " : ""
    return task ? 18 + 0.4 * m.size + m.width(space) : bullet ? BULLET * m.size + m.width(space) : m.width(state.sliceDoc(lm.from, end) + space)
  }

  const body = shownStart(state)
  const htmls: [number, number][] = []
  const inHtml = (a: number, b: number) => htmls.some(([f, t]) => a < t && b > f)
  const pcache: { p?: Para } = {}
  for (const r of view.visibleRanges) {
    const from = Math.max(r.from, body), to = r.to
    if (from > to) continue
    tree.iterate({
      from, to,
      enter: (ref) => {
        if (inHtml(ref.from, ref.from + 1)) return false
        const n = ref.node, name = ref.name
        const h = /^ATXHeading(\d)$/.exec(name) ?? /^SetextHeading(\d)$/.exec(name)
        if (h) {
          out.push(line(`cm-h cm-h${h[1]}`).range(state.doc.lineAt(n.from).from))
          if (live && name.startsWith("ATX") && !touchedLines(state, n.from, n.to)) {
            for (const m of child(n, "HeaderMark")) {
              const end = state.sliceDoc(m.to, m.to + 1) === " " ? m.to + 1 : m.to
              if (m.from === n.from) out.push(hide.range(m.from, end)); else out.push(hide.range(m.from, m.to))
            }
          } else for (const m of child(n, "HeaderMark")) if (m.to > m.from) out.push(mark("cm-hmark").range(m.from, m.to))
          return
        }
        switch (name) {
          case "Emphasis": case "StrongEmphasis": case "Strikethrough": case "InlineCode": {
            const cls = { Emphasis: "cm-em", StrongEmphasis: "cm-strong", Strikethrough: "cm-strike", InlineCode: "cm-code" }[name]
            if (n.to > n.from) out.push(mark(cls).range(n.from, n.to))
            if (live && !touched(state, n.from, n.to)) {
              const marks = name === "InlineCode" ? "CodeMark" : name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark"
              for (const m of child(n, marks)) out.push(hide.range(m.from, m.to))
            }
            return
          }
          case "Link": {
            if (state.sliceDoc(n.from, n.from + 2) === "[^") return false
            const marks = child(n, "LinkMark"), url = child(n, "URL")[0]
            // Lezer parses the inside of a [[wikilink]] as a link: the wikilink pass below draws it.
            if (!url && state.sliceDoc(n.from - 1, n.from) === "[" && state.sliceDoc(n.to, n.to + 1) === "]") return false
            // A callout's [!type] parses as a link too.
            const p = n.parent
            if (!url && p?.name === "Paragraph" && p.from === n.from && p.parent?.name === "Blockquote" && CALLOUT.test(state.sliceDoc(n.from, state.doc.lineAt(n.from).to))) return false
            const href = url ? state.sliceDoc(url.from, url.to) : ""
            if (!live || touched(state, n.from, n.to) || marks.length < 2) {
              if (href) out.push(mark("cm-link-raw", { "data-url": href }).range(n.from, n.to))
              return false
            }
            const open = marks[0], close = marks[1]
            if (close.from > open.to) out.push(mark("cm-link", href ? { "data-url": href } : undefined).range(open.to, close.from))
            out.push(hide.range(open.from, open.to), hide.range(close.from, n.to))
            return false
          }
          case "Autolink": {
            const url = child(n, "URL")[0]
            if (!url) return false
            const href = state.sliceDoc(url.from, url.to)
            out.push(mark("cm-link", { "data-url": href }).range(url.from, url.to))
            if (live && !touched(state, n.from, n.to)) out.push(hide.range(n.from, url.from), hide.range(url.to, n.to))
            return false
          }
          case "URL": {
            if (n.parent && (n.parent.name === "Link" || n.parent.name === "Image" || n.parent.name === "Autolink")) return
            out.push(mark("cm-link", { "data-url": state.sliceDoc(n.from, n.to) }).range(n.from, n.to))
            return
          }
          case "Image": {
            const url = child(n, "URL")[0]
            const src = url ? state.sliceDoc(url.from, url.to) : ""
            const url2 = /^https?:/i.test(src) ? src : src && !/^[a-z][a-z0-9+.-]*:/i.test(src) ? cfg.asset(src) : null
            if (live && url2) {
              const marks = child(n, "LinkMark")
              const { width, rest } = sized(marks.length >= 2 ? state.sliceDoc(marks[0].to, marks[1].from) : "")
              if (!touched(state, n.from, n.to)) out.push(Decoration.replace({ widget: new Img(url2, src, rest.join("|"), width) }).range(n.from, n.to))
              else out.push(Decoration.widget({ widget: new Img(url2, src, rest.join("|"), width, n.from), side: 1 }).range(state.doc.lineAt(n.to).to))
            }
            return false
          }
          case "Blockquote": {
            for (let pos = n.from; pos <= n.to;) {
              const l = state.doc.lineAt(pos)
              out.push(line("cm-quote").range(l.from))
              pos = l.to + 1
            }
            if (live) {
              tree.iterate({
                from: n.from, to: n.to,
                enter: (q) => {
                  if (q.name !== "QuoteMark") return
                  if (!touchedLines(state, q.from, q.to)) out.push(hide.range(q.from, state.sliceDoc(q.to, q.to + 1) === " " ? q.to + 1 : q.to))
                },
              })
            }
            return
          }
          case "HorizontalRule":
            if (live && !touched(state, n.from, n.to)) out.push(Decoration.replace({ widget: new Rule() }).range(n.from, n.to))
            return false
          case "HTMLTag": {
            const tag = /^<([a-z][\w-]*)/i.exec(state.sliceDoc(n.from, n.to))
            if (!live || !tag) return false
            let end = n.to
            if (!VOID.test(tag[1]) && state.sliceDoc(n.to - 2, n.to) !== "/>") {
              const close = new RegExp(`</${tag[1]}\\s*>`, "i").exec(state.sliceDoc(n.to, state.doc.lineAt(n.from).to))
              if (!close) return false
              end = n.to + close.index + close[0].length
            }
            if (touched(state, n.from, end)) return false
            htmls.push([n.from, end])
            out.push(Decoration.replace({ widget: new HtmlInline(state.sliceDoc(n.from, end)) }).range(n.from, end))
            return false
          }
          case "FencedCode": case "CodeBlock": {
            const first = state.doc.lineAt(n.from).number, last = state.doc.lineAt(n.to).number
            for (let k = first; k <= last; k++) {
              const l = state.doc.line(k)
              out.push(line(`cm-codeblock${k === first ? " cm-codeblock-first" : ""}${k === last ? " cm-codeblock-last" : ""}`).range(l.from))
            }
            const marks = child(n, "CodeMark"), info = child(n, "CodeInfo")[0]
            const lang = info ? state.sliceDoc(info.from, info.to) : ""
            if (name === "FencedCode" && live && !touchedLines(state, n.from, n.to) && !lang.startsWith("block-")) {
              const open = state.doc.line(first), closed = marks.length > 1 && last > first
              const code = last - first > (closed ? 1 : 0) ? state.sliceDoc(state.doc.line(first + 1).from, state.doc.line(closed ? last - 1 : last).to) : ""
              out.push(line(lang.trim() ? "cm-fence-top" : "cm-fence-top cm-fence-bare").range(open.from))
              out.push(Decoration.replace({ widget: new FenceHead(lang.split(/\s/)[0], code) }).range(open.from, open.to))
              if (closed) {
                const end = state.doc.line(last)
                out.push(line("cm-fence-bottom").range(end.from))
                if (end.to > end.from) out.push(hide.range(end.from, end.to))
              }
              return false
            }
            for (const m of [...marks, ...(info ? [info] : [])]) out.push(mark("cm-codemark").range(m.from, m.to))
            return false
          }
          case "ListItem": {
            const lm = child(n, "ListMark")[0]
            if (!lm) return
            const task = n.getChild("Task")?.getChild("TaskMarker")
            const bullet = n.parent?.name === "BulletList"
            const ln = state.doc.lineAt(lm.from)
            const end = (task ?? lm).to
            const space = state.sliceDoc(end, end + 1) === " " ? " " : ""
            const active = touchedInside(state, lm.from, end + space.length)
            const indent = state.sliceDoc(ln.from, lm.from)
            const nested = live && /^[ \t]+$/.test(indent)
            let lead = m.width(indent)
            let style = ""
            if (nested) {
              const levels: SyntaxNode[] = []
              for (let p = n.parent?.parent; p?.name === "ListItem"; p = p.parent?.parent) levels.unshift(p)
              const guides: number[] = []
              lead = 0
              for (const p of levels) {
                const pm = child(p, "ListMark")[0]
                if (!pm) continue
                const pt = p.getChild("Task")?.getChild("TaskMarker")
                guides.push(lead + (pt ? 9 : p.parent?.name === "BulletList" ? BULLET * m.size / 2 : m.width(state.sliceDoc(pm.from, pm.to)) / 2))
                lead += markerWidth(pm, pt, p.parent?.name === "BulletList")
              }
              if (guides.length) style = `;background-image:${guides.map(() => "linear-gradient(var(--border),var(--border))").join(",")}` +
                `;background-size:1px 100%;background-repeat:no-repeat;background-position:${guides.map((x) => `${Math.round(x)}px 0`).join(",")}`
              out.push(Decoration.replace({ widget: new Indent(lead) }).range(ln.from, lm.from))
            }
            const marker = !live || active ? m.width(state.sliceDoc(lm.from, end) + space) : markerWidth(lm, task, bullet)
            const w = Math.round((lead + marker) * 10) / 10
            out.push(Decoration.line({ attributes: { style: `padding-left:${w}px;text-indent:-${w}px${style}` } }).range(ln.from))
            if (task) {
              const on = /x/i.test(state.sliceDoc(task.from, task.to))
              if (on) {
                out.push(line("cm-task-done").range(ln.from))
                if (end + space.length < ln.to) out.push(mark("cm-task-strike").range(end + space.length, ln.to))
              }
              if (live && !active) {
                out.push(Decoration.replace({ widget: new Check(on, cfg.writable) }).range(lm.from, task.to))
                return
              }
            }
            if (live && bullet && !active) out.push(Decoration.replace({ widget: new Bullet() }).range(lm.from, lm.to))
            else out.push(mark("cm-listmark").range(lm.from, lm.to))
            return
          }
        }
      },
    })
    for (let pos = from; pos <= to;) {
      const l = state.doc.lineAt(pos)
      WIKI.lastIndex = 0
      for (let m; (m = WIKI.exec(l.text));) {
        const a = l.from + m.index, b = a + m[0].length
        const [, bang, target, alias] = m
        const inCode = tree.resolveInner(a + 1, 1).name.includes("Code")
        if (inCode || inHtml(a, b)) continue
        const src = bang && live && IMAGE.test(target) ? cfg.asset(target.trim()) : null
        if (src) {
          const { width } = sized(alias ?? "")
          if (!touched(state, a, b)) { out.push(Decoration.replace({ widget: new Img(src, target.trim(), target.trim(), width) }).range(a, b)); continue }
          out.push(Decoration.widget({ widget: new Img(src, target.trim(), target.trim(), width, a), side: 1 }).range(l.to))
        }
        const kind = cfg.resolves(target)
        if (bang && live && kind !== null && !IMAGE.test(target) && !touched(state, a, b) && !embedOf(l.text)) {
          out.push(Decoration.replace({ widget: new InlineEmbed(target.trim()) }).range(a, b))
          continue
        }
        const cls = kind === null ? " is-missing" : kind ? ` ${kind}` : ""
        const attrs = { "data-wiki": target.trim() }
        if (!live || touched(state, a, b)) {
          out.push(mark(`cm-wikilink-raw${cls}`, attrs).range(a, b))
          continue
        }
        const shownFrom = alias ? a + bang.length + 2 + target.length + 1 : a + bang.length + 2
        out.push(hide.range(a, shownFrom))
        out.push(mark(`cm-wikilink${cls}`, attrs).range(shownFrom, b - 2))
        if (!alias) {
          for (let i = target.indexOf("#"); i >= 0; i = target.indexOf("#", i + 1)) {
            const at = shownFrom + i
            out.push(target.slice(0, i).trim() ? Decoration.replace({ widget: new Sep() }).range(at, at + 1) : hide.range(at, at + 1))
          }
        }
        out.push(hide.range(b - 2, b))
      }
      if (live && l.text.includes("$")) {
        MATH.lastIndex = 0
        for (let m; (m = MATH.exec(l.text));) {
          const a = l.from + m.index, b = a + m[0].length
          if (tree.resolveInner(a + 1, 1).name.includes("Code") || touched(state, a, b) || inHtml(a, b)) continue
          out.push(Decoration.replace({ widget: new MathInline(m[1]) }).range(a, b))
        }
      }
      if (l.text.includes("[^") && !tree.resolveInner(l.from + l.text.indexOf("[^") + 1, 1).name.includes("Code")) {
        const notes = footnotes(state.doc)
        const d = FN_DEF.exec(l.text)
        if (d) {
          out.push(line("cm-footnote-def").range(l.from))
          if (live && !touchedInside(state, l.from, l.from + d[0].length)) {
            out.push(Decoration.replace({ widget: new FootnoteLabel(`${notes.num.get(d[1]) ?? d[1]}.`) }).range(l.from, l.from + d[0].length))
          } else out.push(mark("cm-footnote-mark").range(l.from, l.from + d[0].length))
        }
        FN_REF.lastIndex = d ? d[0].length : 0
        for (let m; (m = FN_REF.exec(l.text));) {
          const a = l.from + m.index, b = a + m[0].length
          if (!live || touched(state, a, b)) { out.push(mark("cm-footnote-mark").range(a, b)); continue }
          const def = notes.defs.get(m[1])
          out.push(Decoration.replace({ widget: new FootnoteRef(m[1], notes.num.get(m[1]) ?? 0, def?.text.slice(0, 300) ?? "", !!def) }).range(a, b))
        }
      }
      if (live) inlineMarks(state, l, tree, out, pcache)
      pos = l.to + 1
    }
  }
  return Decoration.set(out, true)
}

const inCode = (tree: ReturnType<typeof syntaxTree>, at: number) => /Code|URL|LinkMark|HTML|Comment/.test(tree.resolveInner(at, 1).name)

type Para = { from: number; to: number; comments: [number, number][]; marks: { a: number; b: number; inner: string }[] }
function paragraphMarks(state: EditorState, l: { from: number; to: number }, tree: ReturnType<typeof syntaxTree>, cache: { p?: Para }): Para {
  if (cache.p && l.from >= cache.p.from && l.to <= cache.p.to) return cache.p
  const r = paragraphAt(state.doc, l.from)
  const text = state.sliceDoc(r.from, r.to)
  const p: Para = { ...r, comments: [], marks: [] }
  if (text.includes("%%")) {
    for (const [x, y] of commentSpans(text)) {
      const a = r.from + x, b = r.from + y
      if (inCode(tree, a)) continue
      const first = state.doc.lineAt(a), last = state.doc.lineAt(b)
      if (first.number !== last.number && !unquoted(state.sliceDoc(first.from, a)).trim() && !state.sliceDoc(b, last.to).trim()) continue
      p.comments.push([a, b])
    }
  }
  if (text.includes("==")) {
    for (const m of highlightSpans(text)) {
      const a = r.from + m.index, b = a + m.length
      if (inCode(tree, a) || p.comments.some(([x, y]) => a >= x && a < y)) continue
      p.marks.push({ a, b, inner: m.inner })
    }
  }
  return cache.p = p
}
function onLine(l: { from: number; to: number; text: string }, a: number, b: number): [number, number] | null {
  let s = Math.max(a, l.from)
  const e = Math.min(b, l.to)
  if (a < l.from) s += /^[ \t>]*/.exec(l.text)![0].length
  return s < e ? [s, e] : null
}

class HighlightSwatch extends WidgetType {
  readonly color: HighlightColor | null
  constructor(color: HighlightColor | null) { super(); this.color = color }
  eq(o: HighlightSwatch) { return o.color === this.color }
  toDOM(view: EditorView) {
    const el = document.createElement("span")
    el.className = `cm-hl-swatch ${highlightClass(this.color)}`
    el.setAttribute("role", "button")
    el.setAttribute("aria-label", "Highlight colour")
    el.dataset.tip = "Highlight colour"
    el.addEventListener("mousedown", (e) => e.preventDefault())
    el.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation()
      const b = el.getBoundingClientRect()
      openMenu({ x: b.left, y: b.bottom + 4, flip: b.top - 4 }, highlightItems(view, view.posAtDOM(el)))
    })
    return el
  }
  ignoreEvent() { return true }
}

function inlineMarks(state: EditorState, l: { from: number; to: number; text: string }, tree: ReturnType<typeof syntaxTree>, out: Range<Decoration>[], cache: { p?: Para }) {
  const t = l.text
  const para = paragraphMarks(state, l, tree, cache)
  for (const [a, b] of para.comments) {
    const seg = onLine(l, a, b)
    if (seg) out.push(reading(state) ? hide.range(...seg) : mark("cm-comment").range(...seg))
  }
  const inComment = (a: number) => para.comments.some(([x, y]) => a >= x && a < y)
  if (t.includes("#")) {
    TAG.lastIndex = 0
    for (let m; (m = TAG.exec(t));) {
      const a = l.from + m.index, b = a + m[0].length
      if (inCode(tree, a) || inComment(a) || /\[\[[^\]]*$/.test(t.slice(0, m.index))) continue
      out.push(mark("cm-tag", { "data-tag": m[1] }).range(a, b))
    }
  }
  for (const { a, b, inner } of para.marks) {
    if (b < l.from || a > l.to) continue
    const c = highlightColor(inner), e = a + 2 + (c?.len ?? 0)
    const body = e < b - 2 ? onLine(l, e, b - 2) : null
    if (body) out.push(mark(c ? `cm-highlight ${highlightClass(c.color)}` : "cm-highlight").range(...body))
    const opens = a >= l.from && a <= l.to, closes = b - 2 >= l.from && b - 2 <= l.to
    if (!touched(state, a, b)) {
      if (opens) out.push(hide.range(a, e))
      if (closes) out.push(hide.range(b - 2, b))
    } else {
      if (opens) out.push(Decoration.widget({ widget: new HighlightSwatch(c?.color ?? null), side: -1 }).range(a), mark("cm-hmark").range(a, e))
      if (closes) out.push(mark("cm-hmark").range(b - 2, b))
    }
  }
  const id = t.includes("^") ? BLOCK_ID.exec(t) : null
  if (id && !inCode(tree, l.from + id.index + id[0].indexOf("^"))) {
    const a = l.from + id.index, b = l.to
    if (touched(state, a, b)) out.push(mark("cm-blockid").range(a + id[0].indexOf("^"), b))
    else out.push(hide.range(a, b))
  }
}

const inlinePlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = inline(view) }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || u.startState.facet(previewConfig) !== u.state.facet(previewConfig)
      || u.startState.facet(EditorView.editable) !== u.state.facet(EditorView.editable)
      || u.transactions.some((t) => t.effects.some((e) => e.is(setFocus))) || syntaxTree(u.startState) !== syntaxTree(u.state)) {
      this.decorations = inline(u.view)
    }
  }
}, { decorations: (v) => v.decorations })

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/

type Scan = ReturnType<typeof scan> & { starts: number[]; text: string }
const scans = new WeakMap<Text, Scan>()
function scanOf(doc: Text): Scan {
  let s = scans.get(doc)
  if (!s) {
    const text = doc.toString(), r = scan(text)
    const starts: number[] = new Array(r.lines.length)
    for (let i = 0, at = 0; i < r.lines.length; i++) { starts[i] = at; at += r.lines[i].length + 1 }
    s = { ...r, starts, text }
    scans.set(doc, s)
  }
  return s
}
const commentMarks = (t: string) => t.includes("%%") ? (t.replace(/`+[^`]*`+/g, "").match(/%%/g) ?? []).length : 0

type Cand = { from: number; to: number; a: number; b: number; decos: Range<Decoration>[]
  kind: string
  fence?: { name: string; text: string; wide?: boolean; stack?: boolean }
  always?: boolean }
type Cands = { cfg: PreviewConfig; read: boolean; list: Cand[]
  reads: Read[] }

const HTML_BLOCK = /^\s{0,3}(?:<\/?(?:address|article|aside|blockquote|center|dd|dir|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|iframe|li|main|nav|ol|p|section|table|tbody|td|tfoot|th|thead|tr|ul)(?=[\s/>]|$)|<\/?[a-z][\w-]*(?:\s+[^<>]*)?\/?>\s*$)/i

function candidates(state: EditorState): Cands {
  const cfg = state.facet(previewConfig)
  const read = reading(state)
  const list: Cand[] = []
  if (!cfg.live) return { cfg, read, list, reads: [] }
  const doc = state.doc
  const { prose, code, fences, lines, starts, text } = scanOf(doc)
  const has = (mark: string) => text.includes(mark)
  const loud = has("$$") || has("<")
  const row = (k: number) => ({ from: starts[k - 1], to: starts[k - 1] + lines[k - 1].length, text: lines[k - 1] })
  const opens = new Map(fences.map((f) => [f.open + 1, f]))
  const add = (a: number, b: number, widget: WidgetType | null, always = false, fence?: Cand["fence"]) => {
    const from = row(a).from, to = row(b).to
    const kind = widget instanceof Block ? widget.key.split(":")[0] : "comment"
    list.push({ from, to, a, b, always, fence, kind, decos: [widget ? Decoration.replace({ widget, block: true }).range(from, to) : Decoration.replace({ block: true }).range(from, to)] })
  }
  for (let k = 1; k <= lines.length; k++) {
    const f = opens.get(k)
    if (f) {
      if (f.close === null) break
      const end = f.close + 1
      const inner = end > k + 1 ? doc.sliceString(row(k + 1).from, row(end - 1).to) : ""
      const name = blockName(f.info) ?? fenceBlock(f.info)
      if (name) {
        add(k, end, new Block(`block:${name}`, inner, cfg.version, (el, t, _, edit) => cfg.renderBlock(name, t, el, edit), cfg.place), false,
          { name, text: inner, ...(cfg.renderGrid && fenceLayout(f.info, inner)) })
      } else if (f.info.split(/\s/)[0].toLowerCase() === "mermaid") add(k, end, new Block("mermaid", inner, 0, drawMermaid, cfg.place))
      k = end
      continue
    }
    if (!loud || !prose[k - 1]) continue
    const t = lines[k - 1]
    if (!t.includes("$$") && !t.includes("<")) continue
    if (/^\s{0,3}\$\$/.test(t)) {
      const one = /^\s{0,3}\$\$(.+)\$\$\s*$/.exec(t)
      let end = k
      if (!one) while (++end <= lines.length && prose[end - 1] && !/\$\$\s*$/.test(lines[end - 1]));
      if (end > lines.length || !prose[end - 1]) continue
      const tex = one ? one[1] : doc.sliceString(row(k).from, row(end).to).replace(/^\s*\$\$/, "").replace(/\$\$\s*$/, "")
      add(k, end, new Block("math", tex.trim(), 0, drawMath, cfg.place))
      k = end
      continue
    }
    if (/^\s{0,3}<details[\s>]/i.test(t)) {
      let depth = 0, end = k
      for (; end <= lines.length; end++) {
        if (code[end - 1]) continue
        const x = lines[end - 1]
        depth += (x.match(/<details[\s>]/gi)?.length ?? 0) - (x.match(/<\/details>/gi)?.length ?? 0)
        if (depth <= 0) break
      }
      if (end > lines.length) continue
      add(k, end, new Block("details", doc.sliceString(row(k).from, row(end).to), cfg.version, drawHtml, cfg.place))
      k = end
      continue
    }
    // CommonMark's HTML block: to the next blank line.
    if (HTML_BLOCK.test(t)) {
      let end = k
      while (end < lines.length && prose[end] && lines[end].trim()) end++
      add(k, end, new Block("html", doc.sliceString(row(k).from, row(end).to), cfg.version, drawHtml, cfg.place))
      k = end
    }
  }
  if (has("![[")) for (let k = 1; k <= lines.length; k++) {
    if (!prose[k - 1] || !lines[k - 1].startsWith("![[")) continue
    const m = embedOf(lines[k - 1])
    if (!m) continue
    const { target, height } = m
    add(k, k, new Block(`embed:${target}:${height ?? ""}:${cfg.resolves(target) !== null}`, "", 0, (el, _, view) => {
      const drawn = cfg.renderEmbed(target, height, el, () => embedEdit(view, view.state.doc.lineAt(view.posAtDOM(el)).from))
      if (drawn) return drawn
      el.textContent = `No file ${target} in the vault.`
      el.className += " cm-embed-missing"
      return { update: () => {}, destroy: () => {} }
    }, cfg.place))
  }
  if (cfg.sections.length && has("#")) {
    for (let k = 1; k <= lines.length; k++) {
      if (!prose[k - 1] || !lines[k - 1].startsWith("#")) continue
      const h = HEADING.exec(lines[k - 1])
      if (!h) continue
      const name = h[2].trim().toLowerCase()
      if (!cfg.sections.includes(name)) continue
      let end = k
      for (let j = k + 1; j <= lines.length; j++) {
        const hj = prose[j - 1] && HEADING.exec(lines[j - 1])
        if (hj && hj[1].length <= h[1].length) break
        end = j
      }
      while (end > k && !lines[end - 1].trim()) end--
      const body = end > k ? doc.sliceString(row(k + 1).from, row(end).to) : ""
      add(k, end, new Block(`section:${name}`, body, cfg.version, (el, t) => cfg.renderSection(name, t, el), cfg.place))
      k = end
    }
  }
  if (has("%%")) for (let k = 1; k <= lines.length; k++) {
    if (code[k - 1] || commentMarks(lines[k - 1]) % 2 === 0) continue
    let end = k + 1
    while (end <= lines.length && commentMarks(lines[end - 1]) % 2 === 0) end++
    if (end > lines.length) break
    if (paragraphAt(doc, row(k).from).to >= row(end).to && (unquoted(lines[k - 1].slice(0, lines[k - 1].indexOf("%%"))).trim() || lines[end - 1].slice(lines[end - 1].lastIndexOf("%%") + 2).trim())) { k = end; continue }
    if (read) add(k, end, null)
    else {
      const decos: Range<Decoration>[] = []
      for (let j = k; j <= end; j++) decos.push(Decoration.line({ class: "cm-comment" }).range(row(j).from))
      list.push({ from: row(k).from, to: row(end).to, a: k, b: end, decos, always: true, kind: "comment" })
    }
    k = end
  }
  list.push(...parsedCands(state, cfg, 0))
  return { cfg, read, list, reads: read && cfg.readBlock ? readsOf(state) : [] }
}

function parsedCands(state: EditorState, cfg: PreviewConfig, from: number): Cand[] {
  const doc = state.doc, out: Cand[] = []
  const add = (first: { number: number; from: number }, last: { number: number; to: number }, widget: Block) =>
    out.push({ from: first.from, to: last.to, a: first.number, b: last.number, kind: widget.key, decos: [Decoration.replace({ widget, block: true }).range(first.from, last.to)] })
  syntaxTree(state).iterate({
    from,
    enter: (n) => {
      if (n.name === "Blockquote") {
        if (n.from < from) return false
        const first = doc.lineAt(n.from), last = doc.lineAt(n.to)
        const m = /^\s{0,3}>\s?(.*)$/.exec(first.text)
        if (m && CALLOUT.test(m[1])) add(first, last, new Block("callout", doc.sliceString(first.from, last.to), cfg.version, drawHtml, cfg.place))
        return false
      }
      if (n.name !== "Table") return n.name === "Document" || n.name === "BulletList" || n.name === "OrderedList" || n.name === "ListItem"
      if (n.from < from) return false
      const first = doc.lineAt(n.from), last = doc.lineAt(n.to)
      add(first, last, new Block("table", doc.sliceString(first.from, last.to), cfg.version, drawTable, cfg.place))
      return false
    },
  })
  return out
}

function parsedMore(c: Cands, state: EditorState, was: number): Cands {
  const parsed = (x: Cand) => x.kind === "table" || x.kind === "callout"
  let top = syntaxTree(state).resolve(Math.max(0, was - 1), -1)
  while (top.parent?.parent) top = top.parent
  let cut = Math.min(was, top.from)
  for (let i = c.list.length - 1; i >= 0; i--) { const x = c.list[i]; if (parsed(x) && x.to >= cut) cut = Math.min(cut, x.from) }
  cut = state.doc.lineAt(Math.min(cut, state.doc.length)).from
  return { ...c, list: [...c.list.filter((x) => !parsed(x) || x.from < cut), ...parsedCands(state, c.cfg, cut)] }
}

function visible(c: Cands, state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const grid = !!c.cfg.renderGrid && !c.read, cards: Cand[] = []
  const covered = new Uint8Array(state.doc.lines + 2)
  for (const x of c.list) {
    if (!x.always && touchedLines(state, x.from, x.to)) {
      if (x.fence && !c.read) out.push(Decoration.widget({ widget: new Foot(x.fence.name, x.fence.text, c.cfg.blockNotes?.(x.fence.name, x.fence.text) ?? { notes: [] }), block: true, side: 1 }).range(x.to))
      continue
    }
    let free = true
    for (let n = x.a; n <= x.b && free; n++) if (covered[n]) free = false
    if (!free) continue
    if (grid && x.fence) cards.push(x)
    else out.push(...x.decos)
    if (!x.always) covered.fill(1, x.a, x.b + 1)
  }
  if (grid) out.push(...gridRuns(c, state, cards))
  if (c.reads.length) out.push(...readDecos(c, state, covered))
  return Decoration.set(out.sort((a, b) => a.from - b.from), true)
}

function gridRuns(c: Cands, state: EditorState, cards: Cand[]): Range<Decoration>[] {
  const { lines } = scanOf(state.doc)
  const out: Range<Decoration>[] = []
  const blankTo = (a: number, b: number) => { for (let n = a; n < b; n++) if (lines[n - 1].trim()) return false; return true }
  cards.sort((x, y) => x.a - y.a)
  const member = (x: Cand): Member => ({ name: x.fence!.name, text: x.fence!.text, wide: !!x.fence!.wide, stack: !!x.fence!.stack, a: x.a, b: x.b })
  for (let i = 0; i < cards.length;) {
    let j = i
    while (j + 1 < cards.length && blankTo(cards[j].b + 1, cards[j + 1].a)) j++
    out.push(Decoration.replace({ widget: new Grid(cards.slice(i, j + 1).map(member), c.cfg.version, c.cfg.place), block: true }).range(cards[i].from, cards[j].to))
    i = j + 1
  }
  let last = lines.length
  while (last > 0 && !lines[last - 1].trim()) last--
  if (!cards.length || cards[cards.length - 1].b !== last) {
    out.push(Decoration.widget({ widget: new Grid([], c.cfg.version, c.cfg.place), block: true, side: 1 }).range(state.doc.length))
  }
  return out
}

const LOUD = /`{3}|~{3}|\$\$|<\/?details|^\s{0,3}<\/?[a-z]|%%|!\[\[|\||^\s{0,3}>|^\s*$/i, HEADING_LINE = /^\s{0,3}#{1,6}(?:\s|$)/
function mapped(c: Cands, tr: Transaction): Cands | null {
  if (c.reads.length) return null
  const before = tr.startState.doc, after = tr.state.doc
  const loud = (t: string) => LOUD.test(t) || (c.cfg.sections.length > 0 && HEADING_LINE.test(t))
  let quiet = true
  tr.changes.iterChanges((fa, ta, fb, _tb, inserted) => {
    if (!quiet) return
    const l = before.lineAt(fa)
    if (ta > l.to || inserted.lines > 1 || loud(l.text) || loud(after.lineAt(fb).text)) { quiet = false; return }
    if (c.list.some((x) => x.a <= l.number && x.b >= l.number - 1)) quiet = false
  })
  if (!quiet) return null
  const at = (p: number) => tr.changes.mapPos(p)
  return {
    ...c,
    list: c.list.map((x) => ({ ...x, from: at(x.from), to: at(x.to), decos: x.decos.map((d) => d.value.range(at(d.from), at(d.to))) })),
  }
}

function drawHtml(el: HTMLElement, text: string, view: EditorView, edit: BlockEdit): Drawn {
  let last = "", now = text
  const tick = (nth: number, on: boolean) => {
    const at = edit.line()
    if (at == null || !view.state.facet(previewConfig).writable) return
    const from = view.state.doc.line(at + 1).from
    if (view.state.sliceDoc(from, from + now.length) !== now) return
    const mark = taskMarks(now)[nth]
    if (mark !== undefined) view.dispatch({ changes: { from: from + mark, to: from + mark + 1, insert: on ? "x" : " " }, userEvent: "input.toggle" })
  }
  let undraw = () => {}
  const paint = (t: string) => {
    now = t
    const cfg = view.state.facet(previewConfig), html = cfg.renderMarkdown(t)
    if (html === last) return
    const open = [...el.querySelectorAll("details")].map((d) => d.open)
    undraw()
    el.innerHTML = html
    last = html
    el.querySelectorAll("details").forEach((d, i) => { if (i < open.length) d.open = open[i] })
    hydrate(el)
    undraw = drawEmbeds(el, (span, target) => { const d = cfg.renderEmbed(target, undefined, span, () => null); return d ? d.destroy : undefined })
    wireTasks(el, cfg.writable ? tick : null)
    markdownDrawn(el, lines)
  }
  const lines = blockLines(edit.line, () => now, () => view.state.doc.toString())
  paint(text)
  el.addEventListener("click", (e) => richClick(e, el))
  return { update: paint, destroy: () => undraw() }
}
const drawTable = (el: HTMLElement, text: string, view: EditorView, edit: BlockEdit) => drawCells(el, text, view, {
  render: (md) => view.state.facet(previewConfig).renderMarkdown(md),
  canEdit: () => view.state.facet(previewConfig).writable && view.state.facet(EditorView.editable),
  line: edit.line,
  source: () => edit.source?.(),
})
function drawMermaid(el: HTMLElement, src: string): Drawn {
  renderMermaid(src, el)
  return { update: (s) => renderMermaid(s, el), destroy: () => dropMermaid(el) }
}
function drawMath(el: HTMLElement, tex: string): Drawn {
  const paint = (t: string) => { el.textContent = ""; renderMath(t, el, true) }
  paint(tex)
  return { update: paint, destroy: () => {} }
}

const blockField = StateField.define<{ c: Cands; deco: DecorationSet }>({
  create: (state) => { const c = candidates(state); return { c, deco: visible(c, state) } },
  update: (v, tr) => {
    const { state } = tr
    let c = v.c
    if (c.cfg !== state.facet(previewConfig) || c.read !== reading(state)) c = candidates(state)
    else if (tr.docChanged) c = mapped(c, tr) ?? candidates(state)
    else if (syntaxTree(tr.startState).length < syntaxTree(state).length) c = c.read ? candidates(state) : parsedMore(c, state, syntaxTree(tr.startState).length)
    if (c === v.c && !tr.selection && !tr.effects.some((e) => e.is(setFocus) || e.is(readAnswered))) return v
    return { c, deco: visible(c, state) }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

export function offBlocks(state: EditorState, pos: number): number | null {
  pos = Math.max(pos, shownStart(state))
  const list = state.field(blockField, false)?.c.list.filter((x) => !x.always)
  if (!list?.length) return pos
  const doc = state.doc, start = doc.lineAt(pos).number
  const holder = (n: number) => list.find((x) => x.a <= n && x.b >= n)
  let n = start
  for (let x = holder(n); x; x = holder(n)) n = x.b + 1
  if (n === start) return pos
  if (n <= doc.lines) return doc.line(n).from
  n = start
  for (let x = holder(n); x; x = holder(n)) n = x.a - 1
  return n >= 1 ? doc.line(n).to : null
}

type Read = { from: number; to: number; a: number; b: number; kind: string; text: string }
const READ_KINDS: Record<string, string> = { Frontmatter: "frontmatter", Paragraph: "paragraph", BulletList: "list", OrderedList: "list",
  Blockquote: "quote", FencedCode: "code", CodeBlock: "code", HorizontalRule: "rule" }

function readsOf(state: EditorState): Read[] {
  const out: Read[] = [], doc = state.doc, body = state.field(frontmatter, false) ?? 0, start = shownStart(state)
  for (let n = syntaxTree(state).topNode.firstChild; n; n = n.nextSibling) {
    const kind = READ_KINDS[n.name] ?? (/^(ATX|Setext)Heading/.test(n.name) ? "heading" : null)
    if (!kind || (kind === "frontmatter" ? !body : n.from < start)) continue
    const first = doc.lineAt(n.from), last = doc.lineAt(Math.max(n.from, n.to - 1))
    out.push({ from: first.from, to: last.to, a: first.number, b: last.number, kind, text: doc.sliceString(first.from, last.to) })
  }
  return out
}

type Made = { el: HTMLElement; drawn: ReadingDrawn; follow: (view: EditorView, el: HTMLElement) => void }
type ReadCache = { changed: Map<string, boolean>; asking: Map<string, Promise<void>>; made: Map<string, Made> }
const readCaches = new WeakMap<ReadBlock, ReadCache>()
function cacheOf(f: ReadBlock): ReadCache {
  let c = readCaches.get(f)
  if (!c) readCaches.set(f, c = { changed: new Map(), asking: new Map(), made: new Map() })
  return c
}
const readKey = (place: string | undefined, r: Read) => `${place ?? ""}\0${r.kind}\0${textKey(r.text)}`
const readAnswered = StateEffect.define<null>()

function readAt(view: EditorView, el: HTMLElement | null, r: Read): { a: number; b: number } {
  if (!el?.isConnected) return r
  let pos: number
  try { pos = view.posAtDOM(el) } catch { return r }
  const reads = view.state.field(blockField, false)?.c.reads ?? []
  return reads.find((x) => (r.kind === "frontmatter" ? x.kind === r.kind : x.from === pos)) ?? r
}

function readingBlock(view: EditorView, r: Read, path: string) {
  let at = () => readAt(view, null, r)
  const block: ReadingBlock = { path, text: r.text, kind: r.kind, get container() { return view.contentDOM },
    get lineStart() { return at().a - 1 }, get lineEnd() { return at().b - 1 }, get doc() { return view.state.doc.toString() } }
  return { block, follow: (v: EditorView, el: HTMLElement) => { view = v; at = () => readAt(v, el, r) } }
}

function readEl(cfg: PreviewConfig, r: Read) {
  const el = document.createElement("div")
  el.className = "cm-read note-prose"
  if (r.kind !== "frontmatter") { el.innerHTML = cfg.renderMarkdown(r.text); hydrate(el) }
  return el
}

function ask(view: EditorView, cfg: PreviewConfig, r: Read, key: string, cache: ReadCache): Promise<void> {
  const el = readEl(cfg, r), { block, follow } = readingBlock(view, r, cfg.place ?? "")
  return cfg.readBlock!(el, block).catch((e) => { console.error(e); return null }).then((drawn) => {
    cache.asking.delete(key)
    cache.changed.set(key, !!drawn)
    if (drawn) { cache.made.get(key)?.drawn.destroy?.(); cache.made.set(key, { el, drawn, follow }) }
  })
}

function drawRead(r: Read, key: string, cache: ReadCache): Draw {
  return (body, text, view) => {
    let drawn: ReadingDrawn | null = null, n = 0
    const paint = (made: Made | null) => {
      drawn?.destroy?.()
      drawn = null
      body.textContent = ""
      const cfg = view.state.facet(previewConfig), now = ++n
      let el: HTMLElement
      if (made) { el = made.el; drawn = made.drawn; made.follow(view, body) }
      else {
        el = readEl(cfg, r)
        const { block, follow } = readingBlock(view, r, cfg.place ?? "")
        follow(view, body)
        void cfg.readBlock?.(el, block).then((d) => { if (now === n) drawn = d; else d?.destroy?.() }, (e) => console.error(e))
      }
      body.append(el)
      wireTasks(el, cfg.writable ? (nth, on) => {
        if (!view.state.facet(previewConfig).writable) return
        const from = view.state.doc.line(readAt(view, body, r).a).from, mark = taskMarks(text)[nth]
        if (mark === undefined || view.state.sliceDoc(from, from + text.length) !== text) return
        view.dispatch({ changes: { from: from + mark, to: from + mark + 1, insert: on ? "x" : " " }, userEvent: "input.toggle" })
      } : null)
    }
    const made = cache.made.get(key) ?? null
    cache.made.delete(key)
    paint(made)
    body.addEventListener("click", (e) => richClick(e, body))
    return { update: () => paint(null), destroy: () => { n++; drawn?.destroy?.(); drawn = null } }
  }
}

function readDecos(c: Cands, state: EditorState, covered: Uint8Array): Range<Decoration>[] {
  const cache = cacheOf(c.cfg.readBlock!), out: Range<Decoration>[] = []
  for (const r of c.reads) {
    const key = readKey(c.cfg.place, r)
    if (cache.changed.get(key) !== true) continue
    let free = true
    for (let n = r.a; n <= r.b && free; n++) if (covered[n]) free = false
    if (!free) continue
    const widget = new Block(`read:${r.kind}:${textKey(r.text)}`, r.text, readGen(c.cfg.readBlock!), drawRead(r, key, cache), c.cfg.place)
    out.push(r.kind === "frontmatter" ? Decoration.widget({ widget, block: true, side: -1 }).range(state.field(frontmatter, false) ?? r.to)
      : Decoration.replace({ widget, block: true }).range(r.from, r.to))
  }
  return out
}
const gens = new WeakMap<ReadBlock, number>()
let lastGen = 0
const readGen = (f: ReadBlock) => { let g = gens.get(f); if (g === undefined) gens.set(f, g = ++lastGen); return g }

const readAsker = ViewPlugin.fromClass(class {
  view: EditorView; timer: ReturnType<typeof setTimeout> | null = null; flush: ReturnType<typeof setTimeout> | null = null
  gone = false; answers: [ReadCache, string][] = []; waiting = new Set<string>()
  constructor(view: EditorView) { this.view = view; if (view.state.field(blockField, false)?.c.reads.length) this.later() }
  update(u: ViewUpdate) {
    const f = u.state.field(blockField, false)
    if (f?.c.reads.length && (u.viewportChanged || f !== u.startState.field(blockField, false))) this.later()
  }
  later() { this.timer ??= setTimeout(() => { this.timer = null; this.ask() }) }
  ask() {
    const f = this.gone ? null : this.view.state.field(blockField, false), cfg = f?.c.cfg
    if (!f?.c.reads.length || !cfg?.readBlock) return
    const cache = cacheOf(cfg.readBlock), { from, to } = this.view.viewport
    for (const r of f.c.reads) {
      const key = readKey(cfg.place, r)
      if (r.to < from || r.from > to || cache.changed.has(key) || this.waiting.has(key)) continue
      let p = cache.asking.get(key)
      if (!p) cache.asking.set(key, p = ask(this.view, cfg, r, key, cache))
      this.waiting.add(key)
      void p.then(() => { this.waiting.delete(key); this.answers.push([cache, key]); this.flush ??= setTimeout(() => this.draw()) })
    }
  }
  draw() {
    this.flush = null
    if (!this.gone) this.view.dispatch({ effects: readAnswered.of(null) })
    for (const [cache, key] of this.answers.splice(0)) {
      const m = cache.made.get(key)
      if (m) { cache.made.delete(key); m.drawn.destroy?.() }
    }
  }
  destroy() { this.gone = true; if (this.timer) clearTimeout(this.timer) }
})

const OPAQUE = new Set(["block", "embed", "mermaid", "math"])
const HIDDEN = new Set(["LinkTitle", "LinkMark", "HeaderMark", "EmphasisMark", "CodeMark", "CodeInfo", "QuoteMark", "StrikethroughMark", "TaskMarker", "HorizontalRule", "Image"])
const CALLOUT_HEAD = /^(\s{0,3}>\s?\[![\w-]+\][+-]?)[ \t]*\S/

export function findable(state: EditorState, from: number, to: number): boolean {
  const f = state.field(blockField, false)
  if (!f?.c.cfg.live) return true
  const read = f.c.read
  for (const x of f.c.list) if (x.from < to && x.to > from && (OPAQUE.has(x.kind) || (read && x.kind === "comment"))) return false
  const tree = syntaxTree(state)
  let hidden = false
  tree.iterate({
    from, to,
    enter: (n) => {
      if (hidden) return false
      if (n.to <= from || n.from >= to) return
      const parent = n.node.parent?.name ?? ""
      if (HIDDEN.has(n.name) || (n.name === "URL" && (parent === "Link" || parent === "Image"))
        || (n.name === "ListMark" && n.node.parent?.parent?.name === "BulletList")) hidden = true
    },
  })
  if (hidden) return false
  const l = state.doc.lineAt(from)
  if (to > l.to || inCode(tree, from)) return true
  const t = l.text, a0 = from - l.from, b0 = to - l.from
  const over = (a: number, b: number) => a < b0 && b > a0
  const each = (re: RegExp, hit: (m: RegExpExecArray) => boolean) => {
    re.lastIndex = 0
    for (let m; (m = re.exec(t));) if (hit(m)) return true
    return false
  }
  if (t.includes("[[") && each(WIKI, (m) => {
    const a = m.index, b = a + m[0].length, [, bang, target, alias] = m
    if (bang) return over(a, b)
    return over(a, alias ? a + 3 + target.length : a + 2) || over(b - 2, b)
  })) return false
  if (t.includes("$") && each(MATH, (m) => over(m.index, m.index + m[0].length))) return false
  let para: { from: number; to: number } | undefined, ptext = ""
  const text = () => { if (!para) { para = paragraphAt(state.doc, from); ptext = state.sliceDoc(para.from, para.to) } return ptext }
  const overAt = (a: number, b: number) => para!.from + a < to && para!.from + b > from
  if (t.includes("==") && text().includes("==")) {
    for (const m of highlightSpans(ptext)) {
      if (overAt(m.index, m.index + 2 + (highlightColor(m.inner)?.len ?? 0)) || overAt(m.index + m.length - 2, m.index + m.length)) return false
    }
  }
  if (t.includes("[^")) {
    const d = FN_DEF.exec(t)
    if (d && over(0, d[0].length)) return false
    if (each(FN_REF, (m) => over(m.index, m.index + m[0].length))) return false
  }
  const callout = CALLOUT_HEAD.exec(t)
  if (callout && over(0, callout[1].length)) return false
  if (read) {
    if (text().includes("%%") && commentSpans(ptext).some(([a, b]) => overAt(a, b))) return false
    const id = t.includes("^") ? BLOCK_ID.exec(t) : null
    if (id && over(id.index, t.length)) return false
  }
  return true
}

export function drawnBlocks(view: EditorView): { from: number; to: number; text: boolean; el: HTMLElement | null }[] {
  const f = view.state.field(blockField, false)
  if (!f) return []
  const els = new Map<number, HTMLElement>()
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>(".cm-block")) {
    if (el.parentElement !== view.contentDOM) continue
    try { els.set(view.posAtDOM(el), el) } catch { /* posAtDOM throws for an element being taken down */ }
  }
  const out: { from: number; to: number; text: boolean; el: HTMLElement | null }[] = []
  f.deco.between(0, view.state.doc.length, (from, to, d) => {
    const w = d.spec.widget
    if (d.spec.block && w instanceof Block) out.push({ from, to, text: !OPAQUE.has(w.key.split(":")[0]), el: els.get(from) ?? null })
  })
  return out
}

// CodeMirror moves over a drawn block in one step: ↑ and ↓ go into its Markdown instead.
const intoBlock = (forward: boolean) => (view: EditorView) => {
  const { state } = view
  const r = state.selection.main
  if (!r.empty || state.selection.ranges.length > 1 || !state.facet(EditorView.editable)) return false
  const line = state.doc.lineAt(r.head)
  const moved = view.moveVertically(r, forward)
  if (forward ? moved.head <= line.to : moved.head >= line.from) return false
  let at = -1
  state.field(blockField).deco.between(forward ? line.to + 1 : moved.head, forward ? moved.head : line.from - 1, (from, to) => {
    if (forward ? from > line.to && from <= moved.head && at < 0 : to < line.from && to >= moved.head) at = forward ? from : to
  })
  if (at < 0) return false
  const table = drawnBlocks(view).find((b) => (forward ? b.from : b.to) === at)?.el?.querySelector<HTMLElement>(":scope > .cm-block-body")
  if (table && enterTable(table, forward ? "top" : "bottom")) return true
  view.dispatch({ selection: EditorSelection.cursor(at), scrollIntoView: true, userEvent: "select" })
  return true
}
const blockKeys = Prec.high(keymap.of([{ key: "ArrowDown", run: intoBlock(true) }, { key: "ArrowUp", run: intoBlock(false) }]))

const newTable = EditorView.updateListener.of((u) => {
  if (!u.docChanged || !u.transactions.some((t) => t.annotation(Transaction.userEvent) === "input")) return
  const { state, view } = u, head = state.selection.main
  if (!head.empty || state.selection.ranges.length > 1) return
  const put: number[] = []
  u.changes.iterChangedRanges((_a, _b, from, to) => { if (from <= head.head && head.head <= to) put.push(from, to) })
  const x = state.field(blockField).c.list.find((c) => c.kind === "table" && c.from <= head.head && head.head <= c.to)
  if (!x || !put.length || x.from < put[0] || x.to > put[1]) return
  const first = state.doc.lineAt(x.from).number, line = state.doc.lineAt(head.head)
  const r = line.number - first
  if (r === 1) return
  const cell = { r: r > 1 ? r - 1 : 0, c: cellAt(line.text, head.head - line.from) }
  const off = offBlocks(state, head.head)
  if (off === null) return
  // CodeMirror can't dispatch inside an update.
  setTimeout(() => {
    if (view.state.doc !== state.doc) return
    view.dispatch({ selection: EditorSelection.cursor(off), userEvent: "select" })
    const body = drawnBlocks(view).find((b) => b.from === x.from)?.el?.querySelector<HTMLElement>(":scope > .cm-block-body")
    if (!body || !enterTable(body, cell)) view.dispatch({ selection: head })
  })
})

export function linkHandler(open: (link: { wiki?: string; url?: string; tag?: string }, how: boolean | LinkClick) => void) {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0 && e.button !== 1) return false
      const el = (e.target as Element).closest<HTMLElement>("[data-wiki], [data-url], [data-tag]")
      if (!el || el.closest(".cm-block")) return false
      if (el.dataset.tag) {
        const line = view.state.doc.lineAt(view.posAtDOM(el))
        const onCursor = view.hasFocus && view.state.selection.ranges.some((r) => r.to >= line.from && r.from <= line.to)
        if (view.state.facet(EditorView.editable) && onCursor && !(e.metaKey || e.ctrlKey)) return false
        e.preventDefault()
        if (e.button === 1) noPaste()
        open({ tag: el.dataset.tag }, false)
        return true
      }
      const raw = el.classList.contains("cm-wikilink-raw") || el.classList.contains("cm-link-raw")
      if (raw && !(e.metaKey || e.ctrlKey) && view.state.facet(EditorView.editable)) return false
      e.preventDefault()
      if (e.button === 1) noPaste()
      if (el.dataset.wiki) open({ wiki: el.dataset.wiki }, linkClick(e).newTab)
      else if (el.dataset.url) open({ url: el.dataset.url }, linkClick(e))
      return true
    },
  })
}
// On Linux a middle click pastes the selection (X11's PRIMARY) where the button comes up, unless that's prevented; the
const noPaste = () => addEventListener("mouseup", (e) => { if (e.button === 1) e.preventDefault() }, { capture: true, once: true })

let hovered: Element | null = null
const fenceHover = EditorView.domEventHandlers({
  mouseover(e) {
    let l = (e.target as Element).closest?.(".cm-line") ?? null
    if (l && !l.classList.contains("cm-codeblock")) l = null
    while (l && !l.classList.contains("cm-fence-top")) l = l.classList.contains("cm-codeblock-first") ? null : l.previousElementSibling
    if (l === hovered) return false
    hovered?.classList.remove("is-hover")
    hovered = l
    l?.classList.add("is-hover")
    return false
  },
  mouseleave() { hovered?.classList.remove("is-hover"); hovered = null; return false },
})

export const fenceMenu = EditorView.domEventHandlers({
  contextmenu(e, view) {
    const cfg = view.state.facet(previewConfig)
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (!cfg.blockMenu || pos === null || (e as PointerEvent).pointerType === "touch") return false
    const find = () => view.state.field(blockField, false)?.c.list.find((c) => c.fence && pos >= c.from && pos <= c.to && touchedLines(view.state, c.from, c.to)) ?? null
    const x = find()
    if (!x?.fence) return false
    e.preventDefault()
    cfg.blockMenu(x.fence.name, x.fence.text, { x: e.clientX, y: e.clientY }, editOf(view, find, document.createElement("div")))
    return true
  },
})

export const livePreview = [focused, focusTracker, menuGone, inlinePlugin, blockField, readAsker, blockKeys, newTable, fenceHover]
