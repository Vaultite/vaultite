// Live preview: Markdown drawn formatted, an element showing its Markdown again while the cursor's in it. Inline marks
// are decorated from what's on screen; blocks (sections, tables, callouts, embeds, block fences) are a state field.
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
import { BLOCK_ID, blockName, scan, TAG } from "../../../core/sections.ts"
import { parseOptions } from "../../../core/blocks.ts"
import { frontmatter } from "./frontmatter"
import { COPY_ICON, copyCode, dropMermaid, hydrate, markdownDrawn, renderMath, renderMermaid, richClick, taskMarks, wireTasks } from "@/core/richmd"
import { capitalize } from "@/lib/utils"
import { drawTable as drawCells, enterTable } from "./tables"
import { cellAt } from "./tableText"
import { HIGHLIGHT_SPAN, highlightClass, highlightColor, paragraphAt, type HighlightColor } from "@/core/highlights"
import { highlightItems } from "@/core/highlightMenu"
import { openMenu } from "@/components/ContextMenu"

export type PreviewConfig = {
  /** false: plain Markdown (source mode). */
  live: boolean
  /** The file can be changed (not in the trash): checkboxes tick, even while reading. */
  writable: boolean
  /** What a [[link]] goes to: null for nothing (it shows grey), else its kind ("person", "book"; "" for a note or a
   *  file), coloured like links everywhere else (core/markdown.ts). */
  resolves: (target: string) => string | null
  /** A vault file for an embed (![[photo.png]]), as a URL, or null. */
  asset: (name: string) => string | null
  /** A drawn image right-clicked (held on a phone): its menu. `target`: the file as written. */
  embedMenu?: (target: string, at: { x: number; y: number }, edit: EmbedEdit) => void
  /** A drawn image's open button: the image on its own, at its size. */
  openImage?: (target: string) => void
  /** Headings (lowercase) whose sections a plugin draws. */
  sections: string[]
  /** Draw a section into `el`; returns how to redraw it (new text, or the store changed) and clean up. */
  renderSection: (name: string, text: string, el: HTMLElement) => Drawn
  /** Draw a ```block-<name> fence (`text`: the lines between its fences); `edit`: its bar and its text in the file. */
  renderBlock: (name: string, text: string, el: HTMLElement, edit: BlockEdit) => Drawn
  /** A block's menu at a point (right-click on its Markdown while it shows). */
  blockMenu?: (name: string, text: string, at: { x: number; y: number }, edit: BlockEdit) => void
  /** What's wrong with a block's options, shown under its Markdown while it's edited (else `about`: what it draws). */
  blockNotes?: (name: string, text: string) => { notes: string[]; about?: string }
  /** Draw an artifact or a table shown in the file (`![[Spending.html]]` on its own line); false if there's no such file.
   *  `edit`: what its menu changes in the file. */
  renderEmbed: (target: string, height: number | undefined, el: HTMLElement, edit: () => EmbedEdit | null) => Drawn | false
  /** Markdown as HTML (a table, a callout, <details>; [[links]] in it as `data-wiki` elements): core/markdown.ts. */
  renderMarkdown: (md: string) => string
  /** Follow a [[link]] (or a #tag) clicked inside a drawn block (a table). */
  follow: (link: { wiki?: string; tag?: string }, newTab: boolean) => void
  /** Bumps when what the sections show changes (the store reloaded), so they draw again. */
  version: number
  /** The file's path: drawn blocks are remembered by it (core/heights.ts). */
  place?: string
  /** Blocks side by side: each run of block fences with only blank lines between is one element (`edit` changes them;
   *  each card a `[data-card]`, in order), and an empty one ends a text that doesn't end with blocks. */
  renderGrid?: (cards: GridCard[], el: HTMLElement, edit: GridEdit) => { update: (cards: GridCard[]) => void; destroy: () => void }
}

export type Drawn = { update: (text: string) => void; destroy: () => void }
/** A drawn block's place in the file: its bar (what a block adds goes in `bar`), its Markdown shown, its options set. */
export type BlockEdit = {
  bar: HTMLElement
  /** Its fence's line in the text (0-based), null once it's gone. */
  line: () => number | null
  /** Which of the text's blocks of its name it is (0: the first), so two alike are told apart. */
  nth: () => number
  /** Its Markdown shown, the cursor on its first line (null while reading). */
  source: (() => void) | null
  /** The text between its fences replaced (null when the file can't be changed); `typed`: one step of typing, which
   *  undo takes back with the steps around it. */
  setText: ((text: string, typed?: boolean) => void) | null
  /** Its Markdown is showing (the cursor is in it): Done puts the cursor after it. */
  done: () => void
}
/** A block of a run drawn as a grid: `wide` takes the row, `stack` goes under the one before (its options). */
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
  /** A block's fence put in after the run (the text's end for an empty one). */
  add: (fence: string) => void
  /** Block k taken out; stacked under it, the next one takes its place. */
  remove: (k: number) => void
  /** One of block k's options set (undefined takes it out). */
  set: (k: number, key: string, value: unknown) => void
  /** Undo (or redo) in the file's history: a card's source field has the editor's. */
  history: (redo?: boolean) => void
}
/** What an embed's menu changes in its Markdown: its size (`|300`: an image's width, a PDF's height; null takes it out),
 *  or the embed itself. */
export type EmbedEdit = { size: number; writable: boolean; resize: (n: number | null) => void; remove: () => void }

export const previewConfig = Facet.define<PreviewConfig, PreviewConfig>({ combine: (v) => v[v.length - 1] })

// Whether the editor has focus: unfocused (or read-only), everything shows formatted.
const setFocus = StateEffect.define<boolean>()
const focused = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((a, e) => (e.is(setFocus) ? e.value : a), v),
})
// (a menu opened from the editor takes the keyboard for a moment: what shows stays as it was, so nothing flickers)
const menuOpen = () => !!document.querySelector("[role=menu]")
const focusTracker = EditorView.focusChangeEffect.of((_, on) => (on || !menuOpen() ? setFocus.of(on) : null))
// The menu gave the keyboard to something else: the editor is no longer the one being edited.
const menuGone = ViewPlugin.define((view) => {
  // (after the event: a focus moved by the editor's own update can't dispatch inside it)
  const check = () => setTimeout(() => { if (view.state.field(focused) && !view.hasFocus && !menuOpen()) view.dispatch({ effects: setFocus.of(false) }) })
  document.addEventListener("focusin", check)
  return { destroy: () => document.removeEventListener("focusin", check) }
})

const editing = (state: EditorState) => state.field(focused) && state.facet(EditorView.editable)
/** Is the cursor in from..to or at its edge, or a selection over it? Only that element shows its Markdown, as in
 *  Obsidian, not the rest of its line. */
function touched(state: EditorState, from: number, to: number) {
  return editing(state) && state.selection.ranges.some((r) => r.to >= from && r.from <= to)
}
/** A line's leading marker (a bullet or checkbox, a footnote's label): shown with the cursor in front of it (Vim's block
 *  cursor there drew its first character over the box) or inside it, or a selection over it; drawn while its line is typed. */
function touchedInside(state: EditorState, from: number, to: number) {
  return editing(state) && state.selection.ranges.some((r) => (r.empty ? r.head >= from && r.head < to : r.to > from && r.from < to))
}
/** Is any part of from..to on a line the cursor (or selection) is on? Headings, quotes and blocks show their Markdown
 *  for the whole line. */
function touchedLines(state: EditorState, from: number, to: number) {
  if (!editing(state)) return false
  const a = state.doc.lineAt(from).from, b = state.doc.lineAt(to).to
  return state.selection.ranges.some((r) => r.to >= a && r.from <= b)
}

/** A line's first position drawn as text (after its marks, bullet, checkbox or label): where CodeMirror can measure it to
 *  scroll there, reading too (where a hidden-Markdown line's very start has no size). */
export function textStart(state: EditorState, pos: number) {
  const l = state.doc.lineAt(pos)
  const m = /^(?:[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+|\[\^[^\]\s]+\]:[ \t]?))*/.exec(l.text)
  return l.from + (m ? m[0].length : 0)
}

/** Reading view: the editor can't be edited, and what reading hides (comments) goes. */
const reading = (state: EditorState) => !state.facet(EditorView.editable)

// ---------- widgets ----------

/** A bullet's column, in em (.cm-bullet): wide enough that a nested item's step shows, as in reading. */
const BULLET = 0.95
class Bullet extends WidgetType {
  eq() { return true }
  toDOM() { const s = document.createElement("span"); s.className = "cm-bullet"; s.textContent = "•"; return s }
}

class Check extends WidgetType {
  on: boolean; at: number; writable: boolean
  constructor(on: boolean, at: number, writable: boolean) { super(); this.on = on; this.at = at; this.writable = writable }
  eq(o: Check) { return o.on === this.on && o.at === this.at && o.writable === this.writable }
  toDOM(view: EditorView) {
    const box = document.createElement("input")
    box.type = "checkbox"
    box.checked = this.on
    box.className = "cm-task"
    box.disabled = !this.writable
    box.setAttribute("aria-label", this.on ? "Done" : "Not done")
    box.addEventListener("mousedown", (e) => e.preventDefault())
    box.addEventListener("click", (e) => {
      e.preventDefault()
      if (!view.state.facet(previewConfig).writable) return
      const at = this.at
      const cur = view.state.sliceDoc(at, at + 3)
      if (!/^\[[ xX]\]$/.test(cur)) return
      haptic()
      view.dispatch({ changes: { from: at + 1, to: at + 2, insert: this.on ? " " : "x" }, userEvent: "input.toggle" })
    })
    return box
  }
  ignoreEvent() { return true }
}

/** A nested list item's leading tabs or spaces, drawn as its levels' width. */
class Indent extends WidgetType {
  w: number
  constructor(w: number) { super(); this.w = w }
  eq(o: Indent) { return o.w === this.w }
  toDOM() { const s = document.createElement("span"); s.className = "cm-indent"; s.style.width = `${this.w}px`; return s }
}

/** The # of a [[Note#Heading]] link, shown as "›". */
class Sep extends WidgetType {
  eq() { return true }
  toDOM() { const s = document.createElement("span"); s.className = "cm-wikilink-sep"; s.textContent = " › "; return s }
  ignoreEvent() { return false }
}

class Rule extends WidgetType {
  eq() { return true }
  toDOM() { const s = document.createElement("span"); s.className = "cm-hr"; return s }
}

/** An image (`![[photo.png|300]]`, `![alt|300](photo.png)`): its corner drags its width, its buttons open it and show
 *  its Markdown, right-click is its menu. `at`: where its Markdown starts when that shows (drawn under the line). */
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
/** Inline HTML (`<kbd>Esc</kbd>`, `<br>`, `<span style>`) drawn as reading shows it, sanitized (core/markdown.ts); a
 *  click puts the cursor there, showing its Markdown, unless it's on a link in it. */
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

/** `![[Note]]` in running text, drawn in its place as on a line of its own (Obsidian's way); a file nothing can draw stays
 *  a link to it. */
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

/** Drag an image's corner: its width follows the pointer, then is written as `|<width>`. */
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
/** An image's options after `|` (`photo|300`, `photo.png|alt|300`): the width (the last part, when a number) and the rest. */
function sized(opts: string) {
  const parts = opts ? opts.split("|") : []
  const w = /^\s*(\d+)(?:x\d+)?\s*$/.exec(parts[parts.length - 1] ?? "")
  return { width: w ? Number(w[1]) : 0, rest: w ? parts.slice(0, -1) : parts }
}

/** The image or embed whose Markdown starts at `pos`: what its menu changes. */
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
    // (the line too, when the embed was all it had, and a blank line after it when one is before it: one gap left)
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

/** A code fence's first line, off the cursor: its language and a copy button (shown on hover, always on phones). */
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

/** $TeX$ in a line, drawn by KaTeX. */
class MathInline extends WidgetType {
  tex: string
  constructor(tex: string) { super(); this.tex = tex }
  eq(o: MathInline) { return o.tex === this.tex }
  toDOM() { const s = document.createElement("span"); renderMath(this.tex, s, false); return s }
  ignoreEvent() { return false }
}

/** A footnote reference, [^1], as its number; hover shows the note, a click goes to it. */
class FootnoteRef extends WidgetType {
  label: string; n: number; tip: string; at: number
  constructor(label: string, n: number, tip: string, at: number) { super(); this.label = label; this.n = n; this.tip = tip; this.at = at }
  eq(o: FootnoteRef) { return o.label === this.label && o.n === this.n && o.tip === this.tip && o.at === this.at }
  toDOM(view: EditorView) {
    const s = document.createElement("sup")
    s.className = `cm-footnote-ref${this.at < 0 ? " is-missing" : ""}`
    s.textContent = String(this.n || this.label)
    if (this.tip) s.dataset.tip = this.tip
    s.addEventListener("mousedown", (e) => {
      if (this.at < 0 || this.at > view.state.doc.length) return
      e.preventDefault()
      view.dispatch({ effects: EditorView.scrollIntoView(textStart(view.state, this.at), { y: "center" }) })
    })
    return s
  }
  ignoreEvent() { return true }
}

/** A footnote's definition, `[^1]:`, as its number. */
class FootnoteLabel extends WidgetType {
  text: string
  constructor(text: string) { super(); this.text = text }
  eq(o: FootnoteLabel) { return o.text === this.text }
  toDOM() { const s = document.createElement("span"); s.className = "cm-footnote-label"; s.textContent = this.text; return s }
}

/** A block drawn by someone else. Text (a table, a callout): a click puts the cursor in its Markdown, which then shows. A
 *  view (```block-<name>, an embed) stays drawn: its bar's </> shows its Markdown. Redrawn in place when it changes. */
class Block extends WidgetType {
  key: string; text: string; version: number; draw: Draw
  /** Its remembered height's key (core/heights.ts): the file, the block and its text; and for a ```block-<name>, its
   *  key in the file's dashboard, a guess before the editor has drawn it. */
  held: string; guess?: string
  constructor(key: string, text: string, version: number, draw: Draw, place = "") {
    super()
    this.key = key; this.text = text; this.version = version; this.draw = draw
    const name = key.startsWith("block:") ? key.slice(6) : null
    this.held = name ? blockHeightKey("editor", place, name, text) : `editor:${place}:${key}:${textKey(text)}`
    if (name) this.guess = blockHeightKey("page", place, name, text)
  }
  /** A view of something else, not text to edit by clicking: a ```block-<name> or an embed. */
  get view() { return this.key.startsWith("block:") || this.key.startsWith("embed:") }
  eq(o: Block) { return o.key === this.key && o.text === this.text && o.version === this.version }
  toDOM(view: EditorView) {
    const el = document.createElement("div")
    el.className = `cm-block cm-block-${this.key.split(":")[0]}`
    el.dataset.key = this.key
    const body = document.createElement("div")
    body.className = "cm-block-body"
    const bar = blockBar(view, el)
    // (a view's and a table's only: other text shows its Markdown when clicked, and the bar would cover what it draws
    // there, a timeline's Add; a table's cells are edited in place, so its </> is how its Markdown shows)
    el.append(body, ...(this.view || this.key === "table" ? [bar.el] : []))
    // At the height it had last time while it comes in (a block's data, a picture), so the text below stays put.
    holds.set(el, holdHeight(el, this.held, true))
    drawn.set(el, this.draw(body, this.text, view, bar.edit))
    painted.set(el, this)
    el.addEventListener("mousedown", (e) => { if (pressed(view, el, e) && !this.view) bar.edit.source!() })
    return el
  }
  updateDOM(el: HTMLElement) {
    const d = drawn.get(el), was = painted.get(el)
    if (!d || el.dataset.key !== this.key) return false
    // Moved, or the same block again: nothing to draw.
    if (!was || was.text !== this.text || was.version !== this.version) d.update(this.text)
    painted.set(el, this)
    return true
  }
  destroy(el: HTMLElement) { drawn.get(el)?.destroy(); drawn.delete(el); holds.get(el)?.(); holds.delete(el) }
  ignoreEvent() { return true }
  /** Off screen, the editor places it at the height it had last time (a guess for one never drawn). */
  get estimatedHeight() { return heightOf(this.held) ?? (this.guess ? heightOf(this.guess) : undefined) ?? 120 }
}
type Draw = (el: HTMLElement, text: string, view: EditorView, edit: BlockEdit) => Drawn

/** A press on a drawn block: a link in it followed, a right-click left to its menu, its own controls left alone; true
 *  when it's a press on the block itself (the editor's cursor stays where it is). */
function pressed(view: EditorView, el: HTMLElement, e: MouseEvent) {
  // (a right-click, or ⌃-click on a Mac, is the block's menu; the cursor stays where it is)
  if (e.button === 2 || (e.ctrlKey && e.button === 0 && isMac)) { e.preventDefault(); return false }
  const wiki = (e.target as Element).closest<HTMLElement>("[data-wiki], [data-tag]")
  if (wiki && (e.button === 0 || e.button === 1) && !wiki.closest("[data-embed]")) {
    e.preventDefault()
    if (e.button === 1) noPaste()
    view.state.facet(previewConfig).follow(wiki.dataset.tag ? { tag: wiki.dataset.tag } : { wiki: wiki.dataset.wiki! }, e.metaKey || e.ctrlKey || e.button === 1)
    return false
  }
  const own = (e.target as Element).closest("a, button, input, textarea, select, summary, [contenteditable=true], [data-no-edit]")
  // (or handled inside: a table's cell opening redraws it, so the clicked cell is already gone from the page)
  if ((own && el.contains(own)) || e.defaultPrevented || !view.state.facet(EditorView.editable)) return false
  e.preventDefault()
  return true
}

/** A run of blocks side by side (PreviewConfig.renderGrid): one element for them all, drawn again in place when one
 *  changes. `members`: each block's fence lines now (1-based), which what changes them reads. */
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

/** A block's options with one set (undefined takes it out), line by line as Properties writes a frontmatter. */
const withOption = (text: string, key: string, value: unknown) => innerOf(setProp(`---\n${text}\n---\n`, key, value))

/** The lines a..b (1-based) taken out with the blank lines after them (before them, at the text's end). */
function cut(doc: Text, a: number, b: number) {
  let n = b + 1
  while (n <= doc.lines && !doc.line(n).text.trim()) n++
  if (n <= doc.lines) return { from: doc.line(a).from, to: doc.line(n).from }
  let p = a - 1
  while (p >= 1 && !doc.line(p).text.trim()) p--
  return { from: p >= 1 ? doc.line(p).to : doc.line(a).from, to: doc.line(b).to }
}
/** The next line after `b` with something on it (past the end: none). */
const nextFull = (doc: Text, b: number) => { let n = b + 1; while (n <= doc.lines && !doc.line(n).text.trim()) n++; return n }
/** The cell block k of a run is in: from the block it's stacked under to the last stacked under that one. */
function cellOf(ms: Member[], k: number): [number, number] {
  let s = k
  while (s > 0 && ms[s].stack) s--
  let e = s
  while (e + 1 < ms.length && ms[e + 1].stack) e++
  return [s, e]
}
/** Text put in at the end of a document, a blank line from what's before it. */
function atEnd(doc: Text, text: string) {
  const end = doc.sliceString(Math.max(0, doc.length - 2))
  return { from: doc.length, insert: `${!doc.length || end === "\n\n" ? "" : end.endsWith("\n") ? "\n" : "\n\n"}${text}\n` }
}

/** What changes the run drawn in `el`: its blocks found from where it is now (the text above it may have changed). */
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
        const body = withOption(ms[k].text, "stack", undefined).replace(/\s+$/, "")
        text = [doc.line(A).text, ...(body ? [body] : []), doc.line(B).text].join("\n")
      }
      let ins: { from: number; insert: string }
      if (!dst.length) ins = atEnd(doc, text)
      else {
        const [ts, te] = cellOf(dst, Math.min(at, dst.length - 1))
        const T = dst[ts].a, U = dst[te].b
        // (onto its own cell, or where it already is: nothing moves)
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
      // (the next one stacked under it is no longer: it takes its place)
      if ((k === 0 || !ms[k].stack) && next?.stack) changes.push(fenceBody(doc, next, withOption(next.text, "stack", undefined)))
      put(changes, "delete.block")
    },
    set: (k, key, value) => {
      const m = member(k)
      if (m) put([fenceBody(view.state.doc, m, withOption(m.text, key, value))], "input.block")
    },
    history: (again) => { (again ? redo : undo)(view) },
  }
  runs.set(edit, { view, run })
  return edit
}
/** A fence's lines between its ``` replaced with `text`: only what differs, so the rest keeps its place in the history
 *  and in a merge. */
function fenceBody(doc: Text, m: { a: number; b: number }, text: string) {
  const body = text.replace(/\s+$/, ""), open = doc.line(m.a)
  const r = m.b > m.a + 1 ? { from: body ? doc.line(m.a + 1).from : open.to, to: doc.line(m.b - 1).to, insert: body } : { from: open.to, to: open.to, insert: body ? `\n${body}` : "" }
  const was = doc.sliceString(r.from, r.to)
  let s = 0, e = 0
  while (s < was.length && s < r.insert.length && was[s] === r.insert[s]) s++
  while (e < was.length - s && e < r.insert.length - s && was[was.length - 1 - e] === r.insert[r.insert.length - 1 - e]) e++
  return { from: r.from + s, to: r.to - e, insert: r.insert.slice(s, r.insert.length - e) }
}


/** A drawn block's bar (on hover, top right): what its block adds (`slot`), then </>, its Markdown. And what changes
 *  it in the file, found from where it is now (the text above it may have changed since it was drawn). */
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

/** What changes a block in the file, `find` saying where it is now. */
function editOf(view: EditorView, find: () => Cand | null, bar: HTMLElement, own?: () => void): BlockEdit {
  const source = own ?? (() => {
    const x = find()
    if (!x) return
    // (its Markdown where the block was: what's above it may be drawn anew, so it's held there while that settles)
    const was = drawnTop(view, x)
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(x.a).to), scrollIntoView: was === null, userEvent: "select" })
    view.focus()
    if (was !== null) keepOnScreen(view, () => lineTop(view, x.from), was)
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

/** The lines between a fence's ``` replaced with `text` (none when it's empty). */
function setInner(view: EditorView, x: Cand | null, text: string, typed = false) {
  if (x) view.dispatch({ changes: fenceBody(view.state.doc, x, text), userEvent: typed ? "input.type" : "input.block" })
}

/** The cursor out of the block it's in (to the line after it), so the block is drawn again. */
function doneEditing(view: EditorView) {
  const r = view.state.selection.main
  const x = view.state.field(blockField).c.list.find((c) => !c.always && r.head >= c.from && r.head <= c.to)
  if (!x) return
  const doc = view.state.doc
  const at = x.b < doc.lines ? doc.line(x.b + 1).from : doc.line(x.b).to
  // (the block drawn where its Markdown started, as it was shown in its place)
  const was = lineTop(view, x.from)
  if (x.b >= doc.lines) view.dispatch({ changes: { from: at, insert: "\n" }, selection: EditorSelection.cursor(at + 1), userEvent: "input" })
  else view.dispatch({ selection: EditorSelection.cursor(at), userEvent: "select" })
  view.focus()
  keepOnScreen(view, () => drawnTop(view, x), was)
}

/** The top on screen of the line at `pos` (of the block drawn there: its widget). */
const lineTop = (view: EditorView, pos: number) => view.documentTop + view.lineBlockAt(Math.min(pos, view.state.doc.length)).top
/** The top on screen of block x drawn: its card in a run drawn side by side (null until that's drawn), else its own. */
function drawnTop(view: EditorView, x: Cand): number | null {
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>(".cm-grid")) {
    const ms = paintedGrid.get(el)?.members ?? [], k = ms.findIndex((m) => m.a === x.a)
    if (k < 0) continue
    const cards = el.querySelectorAll<HTMLElement>("[data-card]")
    return cards.length === ms.length ? cards[k].getBoundingClientRect().top : null
  }
  return lineTop(view, x.from)
}

/** Under a ```block-<name> whose Markdown shows: what's wrong with its options, and Done (back to the block). */
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
/** What each block's element shows now (its text and version). */
const painted = new WeakMap<HTMLElement, Block>()

// ---------- inline decorations (only what's on screen) ----------

/** Width of some text in the editor's font, for list items' hanging indent (wrapped lines line up with the text). */
let canvas: CanvasRenderingContext2D | null = null
function measurer(view: EditorView) {
  canvas ??= document.createElement("canvas").getContext("2d")
  const cs = getComputedStyle(view.contentDOM)
  const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  const size = parseFloat(cs.fontSize) || 17
  return {
    size,
    width: (s: string) => { if (!canvas) return 0; canvas.font = font; return canvas.measureText(s.replace(/\t/g, "    ")).width },
  }
}

// Footnotes in a document: each definition's line start and text, and the numbers in the order they're first
// referenced (like the reading view). Worked out once per version of the document, only when one is on screen.
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
// $TeX$: no space inside the dollars, no digit right after the closing one ($5 and $10 is text), not $$.
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
  /** How wide a list item's marker draws in live preview (checkbox, dot or number), with the space after it. */
  const markerWidth = (lm: SyntaxNode, task: SyntaxNode | null | undefined, bullet: boolean) => {
    const end = (task ?? lm).to
    const space = state.sliceDoc(end, end + 1) === " " ? " " : ""
    return task ? 18 + 0.4 * m.size + m.width(space) : bullet ? BULLET * m.size + m.width(space) : m.width(state.sliceDoc(lm.from, end) + space)
  }

  // (nothing in a hidden frontmatter: editor/frontmatter.ts)
  const body = state.field(frontmatter, false) ?? 0
  // Inline HTML drawn in its place (`H<sub>2</sub>O`): what's inside is the widget's, not the passes below.
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
            if (state.sliceDoc(n.from, n.from + 2) === "[^") return false // a footnote: the line pass below
            const marks = child(n, "LinkMark"), url = child(n, "URL")[0]
            // The inside of a [[wikilink]] parses as a link ("[Alice Park]"): the wikilink pass below draws it, in its own
            // colour, like everywhere else a [[link]] shows (callouts, sheets, dashboards).
            if (!url && state.sliceDoc(n.from - 1, n.from) === "[" && state.sliceDoc(n.to, n.to + 1) === "]") return false
            // A callout's [!type] parses as a link too: it's its marker, shown as typed with its line.
            const p = n.parent
            if (!url && p?.name === "Paragraph" && p.from === n.from && p.parent?.name === "Blockquote" && CALLOUT.test(state.sliceDoc(n.from, state.doc.lineAt(n.from).to))) return false
            const href = url ? state.sliceDoc(url.from, url.to) : ""
            if (!live || touched(state, n.from, n.to) || marks.length < 2) {
              if (href) out.push(mark("cm-link-raw").range(n.from, n.to))
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
            // (a vault image, ![](Attachments/photo.png) as Markdown links write it: from the vault)
            const url2 = /^https?:/i.test(src) ? src : src && !/^[a-z][a-z0-9+.-]*:/i.test(src) ? cfg.asset(src) : null
            if (live && url2) {
              const marks = child(n, "LinkMark")
              const { width, rest } = sized(marks.length >= 2 ? state.sliceDoc(marks[0].to, marks[1].from) : "")
              // While its Markdown shows, the image stays, under its line.
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
            // An opening tag to its closing one on the same line, or a void one (<br>, <img>), off the cursor.
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
            // Off the cursor: the ``` lines give way to a header (language, copy) and a closing edge.
            if (name === "FencedCode" && live && !touchedLines(state, n.from, n.to) && !lang.startsWith("block-")) {
              const open = state.doc.line(first), closed = marks.length > 1 && last > first
              const code = last - first > (closed ? 1 : 0) ? state.sliceDoc(state.doc.line(first + 1).from, state.doc.line(closed ? last - 1 : last).to) : ""
              out.push(line("cm-fence-top").range(open.from))
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
            // Hanging indent: a long item wraps under its text, not under its bullet.
            const ln = state.doc.lineAt(lm.from)
            const end = (task ?? lm).to
            const space = state.sliceDoc(end, end + 1) === " " ? " " : ""
            const active = touchedInside(state, lm.from, end + space.length)
            const indent = state.sliceDoc(ln.from, lm.from)
            // Nested items (live): each level starts under its parent's text, with a guide line down from
            // each parent's marker, instead of however wide the tabs or spaces happen to be.
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
                out.push(Decoration.replace({ widget: new Check(on, task.from, cfg.writable) }).range(lm.from, task.to))
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
    // [[Wikilinks]] (not Markdown syntax, so by pattern), and ![[embeds]] of images in the vault.
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
        // (on a line of its own it's a block, drawn below)
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
        // A link to a heading or a block reads like everywhere else (core/markdown.ts): "Note › Heading", and in the
        // same file just "Heading".
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
          out.push(Decoration.replace({ widget: new FootnoteRef(m[1], notes.num.get(m[1]) ?? 0, def?.text.slice(0, 300) ?? "", def ? def.at : -1) }).range(a, b))
        }
      }
      if (live) inlineMarks(state, l, tree, out, pcache)
      pos = l.to + 1
    }
  }
  return Decoration.set(out, true)
}

const inCode = (tree: ReturnType<typeof syntaxTree>, at: number) => /Code|URL|LinkMark|HTML|Comment/.test(tree.resolveInner(at, 1).name)
const COMMENT_SPAN = /%%[^]*?%%/g

/** The ==highlights== and %%comments%% of the paragraph a line is in: they run on over its soft line breaks (and never
 *  over a blank line or another block), so they're read once for the whole paragraph. Kept for the lines that follow. */
type Para = { from: number; to: number; comments: [number, number][]; marks: { a: number; b: number; inner: string }[] }
function paragraphMarks(state: EditorState, l: { from: number; to: number }, tree: ReturnType<typeof syntaxTree>, cache: { p?: Para }): Para {
  if (cache.p && l.from >= cache.p.from && l.to <= cache.p.to) return cache.p
  const r = paragraphAt(state.doc, l.from)
  const text = state.sliceDoc(r.from, r.to)
  const p: Para = { ...r, comments: [], marks: [] }
  if (text.includes("%%")) {
    for (const m of text.matchAll(COMMENT_SPAN)) {
      const a = r.from + m.index, b = a + m[0].length
      if (inCode(tree, a)) continue
      // (%% lines of their own, over several lines, are a block: blockField)
      const first = state.doc.lineAt(a), last = state.doc.lineAt(b)
      if (first.number !== last.number && !state.sliceDoc(first.from, a).trim() && !state.sliceDoc(b, last.to).trim()) continue
      p.comments.push([a, b])
    }
  }
  if (text.includes("==")) {
    for (const m of text.matchAll(HIGHLIGHT_SPAN)) {
      const a = r.from + m.index, b = a + m[0].length
      if (inCode(tree, a) || p.comments.some(([x, y]) => a >= x && a < y)) continue
      p.marks.push({ a, b, inner: m[1] })
    }
  }
  return cache.p = p
}
/** The part of a..b on line `l`, past the quote marks and indent a paragraph's later lines carry; null if none. */
function onLine(l: { from: number; to: number; text: string }, a: number, b: number): [number, number] | null {
  let s = Math.max(a, l.from)
  const e = Math.min(b, l.to)
  if (a < l.from) s += /^[ \t>]*/.exec(l.text)![0].length
  return s < e ? [s, e] : null
}

/** The swatch before the highlight at the cursor: a click shows its colours. */
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
    // (the editor keeps the keyboard, and so the swatch, while the menu is open)
    el.addEventListener("mousedown", (e) => e.preventDefault())
    el.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation()
      const b = el.getBoundingClientRect()
      openMenu({ x: b.left, y: b.bottom + 4 }, highlightItems(view, view.posAtDOM(el)))
    })
    return el
  }
  ignoreEvent() { return true }
}

/** One line's #tags, ==highlights==, %%comments%% and block id (live preview and reading); the highlights and comments
 *  are its paragraph's (above). */
function inlineMarks(state: EditorState, l: { from: number; to: number; text: string }, tree: ReturnType<typeof syntaxTree>, out: Range<Decoration>[], cache: { p?: Para }) {
  const t = l.text
  const para = paragraphMarks(state, l, tree, cache)
  // Comments: faint while editing, gone when reading.
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
      // (the line's own heading marks aren't a tag: "# Title" has a space after its #)
      out.push(mark("cm-tag", { "data-tag": m[1] }).range(a, b))
    }
  }
  for (const { a, b, inner } of para.marks) {
    if (b < l.from || a > l.to) continue
    // (a colour emoji after the opening ==, ==🟢text==, goes with it; at the cursor, a swatch to change it)
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

// ---------- blocks (```block-<name>, sections, tables): a state field, since they replace whole lines ----------

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/

// Fences and %%comment%% blocks (core/sections.ts), with each line's text and start, read once per document version:
// blocks are worked out on every cursor move, and doc.line() per line per pass was most of a keystroke's time.
type Scan = ReturnType<typeof scan> & { starts: number[] }
const scans = new WeakMap<Text, Scan>()
function scanOf(doc: Text): Scan {
  let s = scans.get(doc)
  if (!s) {
    const r = scan(doc.toString())
    const starts: number[] = new Array(r.lines.length)
    for (let i = 0, at = 0; i < r.lines.length; i++) { starts[i] = at; at += r.lines[i].length + 1 }
    s = { ...r, starts }
    scans.set(doc, s)
  }
  return s
}
/** A line's %% marks, not counting any in `inline code`. */
const commentMarks = (t: string) => (t.replace(/`+[^`]*`+/g, "").match(/%%/g) ?? []).length

/** A block that could be drawn: its lines (1-based) and its decorations. Whether it is depends on the cursor
 *  (touched) and on blocks drawn before it that hold it (a table in a callout): visible(). */
type Cand = { from: number; to: number; a: number; b: number; decos: Range<Decoration>[]
  /** What it is: its Block's key up to the first colon (table, callout, block, embed…), or "comment". */
  kind: string
  /** A ```block-<name>: its name and options, for its notes and menu while its Markdown shows. */
  fence?: { name: string; text: string; wide?: boolean; stack?: boolean }
  /** Drawn wherever the cursor is (a comment's faint lines), and doesn't hide what's inside. */
  always?: boolean }
type Cands = { cfg: PreviewConfig; read: boolean; list: Cand[] }

/** A line that starts a block of raw HTML: a block-level tag, or a whole tag alone on its line (not a comment). */
const HTML_BLOCK = /^\s{0,3}(?:<\/?(?:address|article|aside|blockquote|center|dd|dir|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|iframe|li|main|nav|ol|p|section|table|tbody|td|tfoot|th|thead|tr|ul)(?=[\s/>]|$)|<\/?[a-z][\w-]*(?:\s+[^<>]*)?\/?>\s*$)/i

/** Every block the document could draw, in the order they win (fences, $$ and <details>; embeds; sections; comments;
 *  callouts and tables), worked out once per document version: a cursor move only picks among them again. */
function candidates(state: EditorState): Cands {
  const cfg = state.facet(previewConfig)
  const read = reading(state)
  const list: Cand[] = []
  if (!cfg.live) return { cfg, read, list }
  const doc = state.doc
  // Lines are 1-based here, 0-based in the scan.
  const { prose, code, fences, lines, starts } = scanOf(doc)
  const row = (k: number) => ({ from: starts[k - 1], to: starts[k - 1] + lines[k - 1].length, text: lines[k - 1] })
  const opens = new Map(fences.map((f) => [f.open + 1, f]))
  const add = (a: number, b: number, widget: WidgetType | null, always = false, fence?: Cand["fence"]) => {
    const from = row(a).from, to = row(b).to
    const kind = widget instanceof Block ? widget.key.split(":")[0] : "comment"
    list.push({ from, to, a, b, always, fence, kind, decos: [widget ? Decoration.replace({ widget, block: true }).range(from, to) : Decoration.replace({ block: true }).range(from, to)] })
  }
  // A ```block-<name> fence (and ```mermaid, $$ math $$, <details>) to its closing line; nothing inside other code
  // fences, nor from a fence not closed yet (being typed: left as text).
  for (let k = 1; k <= lines.length; k++) {
    const f = opens.get(k)
    if (f) {
      if (f.close === null) break
      const end = f.close + 1
      const inner = end > k + 1 ? doc.sliceString(row(k + 1).from, row(end - 1).to) : ""
      // (or a fence a plugin draws: ```base)
      const name = blockName(f.info) ?? fenceBlock(f.info)
      if (name) {
        // (side by side, its options say where: read once per version of the text)
        const o = cfg.renderGrid ? parseOptions(inner).options : null
        add(k, end, new Block(`block:${name}`, inner, cfg.version, (el, t, _, edit) => cfg.renderBlock(name, t, el, edit), cfg.place), false,
          { name, text: inner, ...(o && { wide: o.wide === true, stack: o.stack === true }) })
      } else if (f.info.split(/\s/)[0].toLowerCase() === "mermaid") add(k, end, new Block("mermaid", inner, 0, drawMermaid, cfg.place))
      k = end
      continue
    }
    if (!prose[k - 1]) continue
    const t = lines[k - 1]
    if (/^\s{0,3}\$\$/.test(t)) {
      // $$ on its own line (or with TeX after it) to the line that ends with $$; or all on one line.
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
    // Raw HTML on lines of its own (CommonMark's HTML block, to a blank line): drawn as Obsidian does, sanitized.
    if (HTML_BLOCK.test(t)) {
      let end = k
      while (end < lines.length && prose[end] && lines[end].trim()) end++
      add(k, end, new Block("html", doc.sliceString(row(k).from, row(end).to), cfg.version, drawHtml, cfg.place))
      k = end
    }
  }
  // Embedded artifacts and tables: `![[Spending.html]]` on a line of its own.
  for (let k = 1; k <= lines.length; k++) {
    if (!prose[k - 1] || !lines[k - 1].startsWith("![[")) continue
    const m = embedOf(lines[k - 1])
    if (!m) continue
    const { target, height } = m
    // (whether its file is there is in the key: one that comes later, or goes, is drawn again)
    add(k, k, new Block(`embed:${target}:${height ?? ""}:${cfg.resolves(target) !== null}`, "", 0, (el, _, view) => {
      // (where it is when its menu opens: the text above it may have changed since it was drawn)
      const drawn = cfg.renderEmbed(target, height, el, () => embedEdit(view, view.state.doc.lineAt(view.posAtDOM(el)).from))
      if (drawn) return drawn
      el.textContent = `No file ${target} in the vault.`
      el.className += " cm-embed-missing"
      return { update: () => {}, destroy: () => {} }
    }, cfg.place))
  }
  // Sections (a `## Timeline`): from the heading to the next heading of the same or a higher level.
  if (cfg.sections.length) {
    for (let k = 1; k <= lines.length; k++) {
      if (!prose[k - 1]) continue
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
  // %% comment blocks %% over several lines: faint while editing, gone when reading.
  for (let k = 1; k <= lines.length; k++) {
    if (code[k - 1] || commentMarks(lines[k - 1]) % 2 === 0) continue
    let end = k + 1
    while (end <= lines.length && commentMarks(lines[end - 1]) % 2 === 0) end++
    if (end > lines.length) break
    // (a comment that shares its lines with text, in one paragraph: the paragraph's marks, inlineMarks)
    if (paragraphAt(doc, row(k).from).to >= row(end).to && (lines[k - 1].slice(0, lines[k - 1].indexOf("%%")).trim() || lines[end - 1].slice(lines[end - 1].lastIndexOf("%%") + 2).trim())) { k = end; continue }
    if (read) add(k, end, null)
    else {
      const decos: Range<Decoration>[] = []
      for (let j = k; j <= end; j++) decos.push(Decoration.line({ class: "cm-comment" }).range(row(j).from))
      list.push({ from: row(k).from, to: row(end).to, a: k, b: end, decos, always: true, kind: "comment" })
    }
    k = end
  }
  // Tables, and callouts (a quote whose first line is `> [!type] Title`). Only where they can be: not inside
  // paragraphs and headings (most of a long file's tree).
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "Blockquote") {
        const first = doc.lineAt(n.from), last = doc.lineAt(n.to)
        const m = /^\s{0,3}>\s?(.*)$/.exec(first.text)
        if (m && CALLOUT.test(m[1])) {
          add(first.number, last.number, new Block("callout", doc.sliceString(first.from, last.to), cfg.version, drawHtml, cfg.place))
        }
        return false
      }
      if (n.name !== "Table") return n.name === "Document" || n.name === "BulletList" || n.name === "OrderedList" || n.name === "ListItem"
      const first = doc.lineAt(n.from), last = doc.lineAt(n.to)
      add(first.number, last.number, new Block("table", doc.sliceString(first.from, last.to), cfg.version, drawTable, cfg.place))
      return false
    },
  })
  return { cfg, read, list }
}

/** The blocks drawn now: those the cursor isn't on and no block drawn before holds (a table in a callout being
 *  edited is drawn; in a callout that's drawn it's part of it). */
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
  return Decoration.set(out.sort((a, b) => a.from - b.from), true)
}

/** Blocks drawn side by side: each run of them with only blank lines between is one Grid, and a text that doesn't end
 *  with one ends with an empty one (its Add). */
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

// A change within one line that can't start, end or reshape a block, on a line no block holds, leaves every block as it
// was, only moved: typing a sentence in a long file doesn't read it all again.
const LOUD = /`{3}|~{3}|\$\$|<\/?details|^\s{0,3}<\/?[a-z]|%%|!\[\[|\||^\s{0,3}>|^\s{0,3}#{1,6}(?:\s|$)|^\s*$/i
function mapped(c: Cands, tr: Transaction): Cands | null {
  const before = tr.startState.doc, after = tr.state.doc
  let quiet = true
  tr.changes.iterChanges((fa, ta, fb, _tb, inserted) => {
    if (!quiet) return
    const l = before.lineAt(fa)
    if (ta > l.to || inserted.lines > 1 || LOUD.test(l.text) || LOUD.test(after.lineAt(fb).text)) { quiet = false; return }
    if (c.list.some((x) => x.a <= l.number && x.b >= l.number)) quiet = false
  })
  if (!quiet) return null
  const at = (p: number) => tr.changes.mapPos(p)
  return {
    ...c,
    list: c.list.map((x) => ({ ...x, from: at(x.from), to: at(x.to), decos: x.decos.map((d) => d.value.range(at(d.from), at(d.to))) })),
  }
}

/** Markdown drawn as HTML (a callout, <details>, a table) by the config as it is then; drawn again only when that changes
 *  what it shows, so a toggle opened stays open. Its checkboxes tick in the file, reading too, as the editor's own do. */
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
  const paint = (t: string) => {
    now = t
    const html = view.state.facet(previewConfig).renderMarkdown(t)
    if (html === last) return
    const open = [...el.querySelectorAll("details")].map((d) => d.open)
    el.innerHTML = html
    last = html
    el.querySelectorAll("details").forEach((d, i) => { if (i < open.length) d.open = open[i] })
    hydrate(el)
    wireTasks(el, view.state.facet(previewConfig).writable ? tick : null)
    markdownDrawn(el)
  }
  paint(text)
  el.addEventListener("click", (e) => richClick(e, el))
  return { update: paint, destroy: () => {} }
}
/** A table, edited cell by cell where it can be (./tables.ts), else as Markdown drawn. */
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
    else if (syntaxTree(tr.startState).length < syntaxTree(state).length) c = candidates(state) // more of a long file parsed
    if (c === v.c && !tr.selection && !tr.effects.some((e) => e.is(setFocus))) return v
    return { c, deco: visible(c, state) }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

/** A place for the cursor that opens no drawn block (nor a hidden frontmatter): `pos` when its line is in none, else the line after the block (or
 *  before it, at the end); null when every line is in one. Where the app puts the cursor itself (opening a note, ⌘E). */
export function offBlocks(state: EditorState, pos: number): number | null {
  pos = Math.max(pos, state.field(frontmatter, false) ?? 0)
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

// ---------- what find finds (plugins/core/find) ----------

/** Blocks drawn as something other than their text (a view, a diagram, a formula, a file embedded): what their
 *  Markdown says isn't on screen. */
const OPAQUE = new Set(["block", "embed", "mermaid", "math"])
/** Markdown's syntax that live preview and reading hide (a link's address, `**`, a heading's `#`, a picture). */
const HIDDEN = new Set(["LinkTitle", "LinkMark", "HeaderMark", "EmphasisMark", "CodeMark", "CodeInfo", "QuoteMark", "StrikethroughMark", "TaskMarker", "HorizontalRule", "Image"])
const CALLOUT_HEAD = /^(\s{0,3}>\s?\[![\w-]+\][+-]?)[ \t]*\S/

/** Is from..to text the reader sees? Outside source mode a find skips a link's address, the Markdown around what it
 *  marks, what a view or diagram is drawn from and, reading, comments; source mode shows (and finds) it all. */
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
  // What's found by pattern on its line: [[a target|its alias]], ![[embeds]], $math$, ==marks==, footnotes, a
  // callout's [!type] before its title; reading, %%comments%% and ^block-ids.
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
  // (==marks== and %%comments%% run over a paragraph's soft line breaks)
  const para = paragraphAt(state.doc, from), ptext = state.sliceDoc(para.from, para.to)
  const overAt = (a: number, b: number) => para.from + a < to && para.from + b > from
  if (ptext.includes("==")) {
    for (const m of ptext.matchAll(HIGHLIGHT_SPAN)) {
      if (overAt(m.index, m.index + 2 + (highlightColor(m[1])?.len ?? 0)) || overAt(m.index + m[0].length - 2, m.index + m[0].length)) return false
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
    if (ptext.includes("%%") && [...ptext.matchAll(COMMENT_SPAN)].some((m) => overAt(m.index, m.index + m[0].length))) return false
    const id = t.includes("^") ? BLOCK_ID.exec(t) : null
    if (id && over(id.index, t.length)) return false
  }
  return true
}

/** The blocks drawn now in place of their Markdown, with their elements while on screen. `text`: drawn from their
 *  text (a table, a callout), so what's found in it can be lit there. */
export function drawnBlocks(view: EditorView): { from: number; to: number; text: boolean; el: HTMLElement | null }[] {
  const f = view.state.field(blockField, false)
  if (!f) return []
  const els = new Map<number, HTMLElement>()
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>(".cm-block")) {
    if (el.parentElement !== view.contentDOM) continue
    try { els.set(view.posAtDOM(el), el) } catch { /* (being taken down) */ }
  }
  const out: { from: number; to: number; text: boolean; el: HTMLElement | null }[] = []
  f.deco.between(0, view.state.doc.length, (from, to, d) => {
    const w = d.spec.widget
    if (d.spec.block && w instanceof Block) out.push({ from, to, text: !OPAQUE.has(w.key.split(":")[0]), el: els.get(from) ?? null })
  })
  return out
}

/** ↑ and ↓ into a block put the cursor in its Markdown, like a click; CodeMirror alone moves over a drawn block in one
 *  step, so it could only be edited by clicking. */
const intoBlock = (forward: boolean) => (view: EditorView) => {
  const { state } = view
  const r = state.selection.main
  if (!r.empty || state.selection.ranges.length > 1 || !state.facet(EditorView.editable)) return false
  const line = state.doc.lineAt(r.head)
  const moved = view.moveVertically(r, forward)
  if (forward ? moved.head <= line.to : moved.head >= line.from) return false // within the line (it wraps)
  let at = -1
  state.field(blockField).deco.between(forward ? line.to + 1 : moved.head, forward ? moved.head : line.from - 1, (from, to) => {
    if (forward ? from > line.to && from <= moved.head && at < 0 : to < line.from && to >= moved.head) at = forward ? from : to
  })
  if (at < 0) return false
  // (a table: into its first or last row's cell, as Obsidian does)
  const table = drawnBlocks(view).find((b) => (forward ? b.from : b.to) === at)?.el?.querySelector<HTMLElement>(":scope > .cm-block-body")
  if (table && enterTable(table, forward ? "top" : "bottom")) return true
  view.dispatch({ selection: EditorSelection.cursor(at), scrollIntoView: true, userEvent: "select" })
  return true
}
const blockKeys = Prec.high(keymap.of([{ key: "ArrowDown", run: intoBlock(true) }, { key: "ArrowUp", run: intoBlock(false) }]))

/** A table put in whole with the cursor in it (the slash menu's Table, Insert table): drawn at once with that cell open,
 *  as Obsidian does, rather than its pipes showing until the cursor leaves. */
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
  // (after this update: an editor can't be changed inside one)
  setTimeout(() => {
    if (view.state.doc !== state.doc) return
    view.dispatch({ selection: EditorSelection.cursor(off), userEvent: "select" })
    const body = drawnBlocks(view).find((b) => b.from === x.from)?.el?.querySelector<HTMLElement>(":scope > .cm-block-body")
    if (!body || !enterTable(body, cell)) view.dispatch({ selection: head })
  })
})

/** Links: a click on a rendered link opens it (in the editor, only with ⌘ when its Markdown is showing). */
export function linkHandler(open: (link: { wiki?: string; url?: string; tag?: string }, newTab: boolean) => void) {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0 && e.button !== 1) return false
      const el = (e.target as Element).closest<HTMLElement>("[data-wiki], [data-url], [data-tag]")
      if (!el || el.closest(".cm-block")) return false
      // A #tag: its files (⌘-click while editing, like a link whose Markdown shows; a click when reading)
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
      const newTab = e.metaKey || e.ctrlKey || e.button === 1
      if (e.button === 1) noPaste()
      if (el.dataset.wiki) open({ wiki: el.dataset.wiki }, newTab)
      else if (el.dataset.url) open({ url: el.dataset.url }, newTab)
      return true
    },
  })
}
// On Linux a middle click pastes the selection (X11's PRIMARY) where the button comes up, unless that's prevented; the
// link's new tab may be showing by then, so it's caught on the window.
const noPaste = () => addEventListener("mouseup", (e) => { if (e.button === 1) e.preventDefault() }, { capture: true, once: true })

// A code block's copy button shows while the pointer is over any line of the block (desktop; phones always show it).
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

/** Right-click on a ```block-<name>'s Markdown while it shows: the block's menu, not the text's (before plugins' menus). */
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

export const livePreview = [focused, focusTracker, menuGone, inlinePlugin, blockField, blockKeys, newTable, fenceHover]
