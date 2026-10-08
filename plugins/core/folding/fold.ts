// Folding: sections and nested list items from the syntax tree (so a `# comment` in code isn't a heading), chevrons in
// a gutter moved out of the text's way. Kept per file by the folded lines' text, so edits around them don't lose it.
import { codeFolding, ensureSyntaxTree, foldEffect, foldedRanges, foldState, syntaxTree, unfoldEffect } from "@codemirror/language"
import { type EditorState, type Extension, type StateEffect } from "@codemirror/state"
import { EditorView, gutter, GutterMarker, gutters, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import type { SyntaxNode } from "@lezer/common"

type Range = { from: number; to: number }
/** Each heading level's line height, in the editor's em (index.css: .cm-h1...), so a chevron sits beside its text. */
const LINE: Record<number, number> = { 1: 1.625 * 1.31, 2: 1.3125 * 1.333, 3: 1.125 * 1.39, 4: 1.44, 5: 1.44, 6: 1.44 }

const HEADING = /^(?:ATX|Setext)Heading(\d)$/
const levelOf = (n: SyntaxNode) => { const m = HEADING.exec(n.name); return m ? Number(m[1]) : 0 }
/** A line that may start a heading or a list item (only these are looked up in the syntax tree). */
const CANDIDATE = /^[ \t]*(?:#{1,6}(?:[ \t]|$)|[-*+][ \t]|\d+[.)][ \t])/

/** The heading or list item node starting on line `n` (1-based), or null. */
function nodeAt(state: EditorState, n: number): SyntaxNode | null {
  const line = state.doc.line(n)
  if (!CANDIDATE.test(line.text)) return null
  const indent = /^[ \t]*/.exec(line.text)![0].length
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.from + indent, 1); node; node = node.parent) {
    if (node.from < line.from) break
    if (levelOf(node) || node.name === "ListItem") return node.from <= line.to ? node : null
  }
  return null
}

/** What folds on line `n`: from the end of the line to the end of its section or nested items; null if nothing. */
export function foldRangeAt(state: EditorState, n: number): (Range & { level: number }) | null {
  const node = nodeAt(state, n)
  if (!node) return null
  const line = state.doc.line(n)
  let end: number
  const level = levelOf(node)
  if (level) {
    // A heading: its next siblings until a heading of the same or a higher level.
    let last: SyntaxNode = node
    for (let next = node.nextSibling; next; next = next.nextSibling) {
      const l = levelOf(next)
      if (l && l <= level) break
      last = next
    }
    end = last.to
  } else end = node.to
  // Not the blank lines at its end: the next heading stays where it was.
  while (end > line.to && /\s/.test(state.sliceDoc(end - 1, end))) end--
  if (end <= line.to) return null
  return { from: line.to, to: Math.min(end, state.doc.length), level }
}

/** Whether line `n` folds, cheaply (for every line on screen, after every keystroke): a heading with anything before
 *  the next heading of its level or higher, a list item with lines under it. Its level (0: a list item), or null. */
function foldsAt(state: EditorState, n: number): number | null {
  const node = nodeAt(state, n)
  if (!node) return null
  const level = levelOf(node)
  if (level) {
    const next = node.nextSibling
    const l = next ? levelOf(next) : 0
    return next && !(l && l <= level) ? level : null
  }
  return state.doc.lineAt(Math.max(node.from, node.to - 1)).number > n && state.sliceDoc(state.doc.line(n).to, node.to).trim() ? 0 : null
}

/** The fold starting at the end of line `n`, if it's folded. */
function foldedAt(state: EditorState, n: number): Range | null {
  const at = state.doc.line(n).to
  let hit: Range | null = null
  foldedRanges(state).between(at, at, (from, to) => { if (from === at) { hit = { from, to }; return false } })
  return hit
}

// ---------- the chevrons ----------

class Chevron extends GutterMarker {
  folded: boolean; from: number; level: number
  constructor(folded: boolean, from: number, level: number) { super(); this.folded = folded; this.from = from; this.level = level }
  eq(o: Chevron) { return o.folded === this.folded && o.from === this.from && o.level === this.level }
  toDOM() {
    const el = document.createElement("span")
    el.className = `cm-vau-fold${this.folded ? " is-folded" : ""}`
    el.dataset.foldFrom = String(this.from)
    // A heading's line is taller (its size, and the space above it): the chevron sits by its text, at the bottom.
    if (this.level) { el.classList.add("is-heading"); el.style.height = `${LINE[this.level] ?? 1.5}em` }
    el.setAttribute("aria-label", this.folded ? "Unfold" : "Fold")
    el.setAttribute("role", "button")
    // lucide's chevron-down, drawn with the text's colour
    el.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
    return el
  }
}

/** Fold or unfold line `n`; false if nothing folds there. */
function toggleLine(view: EditorView, n: number) {
  const folded = foldedAt(view.state, n)
  if (folded) { view.dispatch({ effects: unfoldEffect.of(folded) }); return true }
  const range = foldRangeAt(view.state, n)
  if (!range) return false
  view.dispatch({ effects: foldEffect.of(range) })
  return true
}

const chevrons = gutter({
  class: "cm-vau-fold-gutter",
  lineMarker(view, block) {
    const n = view.state.doc.lineAt(block.from).number
    const level = foldsAt(view.state, n)
    if (foldedAt(view.state, n)) return new Chevron(true, block.from, level ?? 0)
    return level === null ? null : new Chevron(false, block.from, level)
  },
  lineMarkerChange: (u) => syntaxTree(u.startState) !== syntaxTree(u.state) || u.startState.field(foldState, false) !== u.state.field(foldState, false),
  domEventHandlers: {
    mousedown(view, block, e) {
      if (!(e.target as Element).closest?.(".cm-vau-fold")) return false
      e.preventDefault()
      return toggleLine(view, view.state.doc.lineAt(block.from).number)
    },
  },
})

/** The chevron of the line under the pointer shows (CSS can't tie a line to its gutter marker). */
const hover = ViewPlugin.fromClass(class {
  view: EditorView
  lit: Element | null = null
  constructor(view: EditorView) {
    this.view = view
    view.dom.addEventListener("mousemove", this.move)
    view.dom.addEventListener("mouseleave", this.leave)
  }
  move = (e: MouseEvent) => {
    const v = this.view
    const h = e.clientY - v.documentTop
    const from = h >= 0 && h <= v.contentHeight ? v.lineBlockAtHeight(h).from : -1
    const el = from < 0 ? null : v.dom.querySelector(`.cm-vau-fold[data-fold-from="${from}"]`)
    if (el === this.lit) return
    this.lit?.classList.remove("is-hover")
    el?.classList.add("is-hover")
    this.lit = el
  }
  leave = () => { this.lit?.classList.remove("is-hover"); this.lit = null }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.leave() }
  destroy() {
    this.view.dom.removeEventListener("mousemove", this.move)
    this.view.dom.removeEventListener("mouseleave", this.leave)
  }
})

// ---------- commands ----------

/** Every heading and list item that folds (nested ones too: Fold all). */
export function foldAll(view: EditorView) {
  const state = view.state
  ensureSyntaxTree(state, state.doc.length, 300)
  const effects: StateEffect<Range>[] = []
  for (let n = 1; n <= state.doc.lines; n++) {
    const r = foldRangeAt(state, n)
    if (r && !foldedAt(state, n)) effects.push(foldEffect.of(r))
  }
  if (effects.length) view.dispatch({ effects })
}

export function unfoldAll(view: EditorView) {
  const effects: StateEffect<Range>[] = []
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => { effects.push(unfoldEffect.of({ from, to })) })
  if (effects.length) view.dispatch({ effects })
}

/** Fold or unfold where the cursor is: its line, else the closest heading or list item around it. */
export function toggleHere(view: EditorView) {
  const state = view.state
  const head = state.selection.main.head
  const at = state.doc.lineAt(head).number
  if (foldedAt(state, at) || foldRangeAt(state, at)) return toggleLine(view, at)
  for (let n = at - 1; n >= 1; n--) {
    const r = foldRangeAt(state, n)
    if (r && r.from < head && r.to >= head) {
      view.dispatch({ effects: foldEffect.of(r), selection: { anchor: state.doc.line(n).to } })
      return true
    }
  }
  return false
}

// ---------- remembered per file (this device) ----------

const KEY = "vaultite.folds"
const KEEP = 200
type Kept = Record<string, { text: string; nth: number }[]>
const readKept = (): Kept => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {} } catch { return {} } }

/** The folded lines, by their text and which of the lines with that text each is. */
function foldsOf(state: EditorState) {
  const out: { text: string; nth: number }[] = []
  const seen = new Map<string, number>()
  let last = 0
  const counts = (upTo: number) => {
    // count each line's text up to (not including) line `upTo`, continuing from the last call
    for (; last < upTo - 1; last++) { const t = state.doc.line(last + 1).text; seen.set(t, (seen.get(t) ?? 0) + 1) }
  }
  foldedRanges(state).between(0, state.doc.length, (from) => {
    const line = state.doc.lineAt(from)
    counts(line.number)
    out.push({ text: line.text, nth: seen.get(line.text) ?? 0 })
  })
  return out
}

function keep(path: string, state: EditorState) {
  const all = readKept()
  const folds = foldsOf(state)
  delete all[path]
  if (folds.length) all[path] = folds
  const keys = Object.keys(all)
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete all[k]
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* private mode, or full */ }
}

/** Fold again what was folded when this file was last open here. */
function restore(view: EditorView, path: string) {
  const want = readKept()[path]
  if (!want?.length) return
  const state = view.state
  ensureSyntaxTree(state, state.doc.length, 200)
  const byText = new Map<string, number[]>()
  for (let n = 1; n <= state.doc.lines; n++) {
    const t = state.doc.line(n).text
    if (!CANDIDATE.test(t)) continue
    const l = byText.get(t)
    if (l) l.push(n); else byText.set(t, [n])
  }
  const effects: StateEffect<Range>[] = []
  for (const f of want) {
    const n = byText.get(f.text)?.[f.nth]
    const r = n ? foldRangeAt(state, n) : null
    if (r) effects.push(foldEffect.of(r))
  }
  if (effects.length) view.dispatch({ effects })
}

function remember(path: string) {
  return ViewPlugin.fromClass(class {
    timer: ReturnType<typeof setTimeout> | null = null
    view: EditorView
    constructor(view: EditorView) {
      this.view = view
      // (not while the editor is being set up: a moment after)
      setTimeout(() => { if (view.dom.isConnected) restore(view, path) }, 0)
    }
    update(u: ViewUpdate) {
      const was = u.startState.field(foldState, false), now = u.state.field(foldState, false)
      if (was === now) return
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => { this.timer = null; keep(path, this.view.state) }, 300)
    }
    destroy() { if (this.timer) { clearTimeout(this.timer); keep(path, this.view.state) } }
  })
}

/** The editor in the phone layout (a narrow window too) has the class vau-narrow: no chevrons there. (CodeMirror's
 *  themes can't hold a media query, and it owns its element's classes: they're given as its attributes.) */
const NARROW = typeof matchMedia === "function" ? matchMedia("(max-width: 767px)") : null
const narrow = [
  EditorView.editorAttributes.of(() => (NARROW?.matches ? { class: "vau-narrow" } : null)),
  ViewPlugin.fromClass(class {
    view: EditorView
    constructor(view: EditorView) { this.view = view; NARROW?.addEventListener("change", this.redraw) }
    redraw = () => { this.view.dispatch({}) }
    destroy() { NARROW?.removeEventListener("change", this.redraw) }
  }),
]

const theme = EditorView.theme({
  // Alone, the chevrons sit in the margin left of the text, so the text doesn't move; beside other gutters (line
  // numbers) they're one more column, after them.
  "& .cm-gutters:not(:has(.cm-gutter:not(.cm-vau-fold-gutter)))": { position: "absolute !important", insetInlineStart: "-22px", top: "0", width: "20px", background: "transparent", border: "none", zIndex: "1" },
  "& .cm-vau-fold-gutter": { order: "1" },
  "& .cm-vau-fold-gutter .cm-gutterElement": { display: "flex", flexDirection: "column", alignItems: "center" },
  "& .cm-vau-fold.is-heading": { marginTop: "auto" },
  "& .cm-vau-fold": {
    display: "grid", placeItems: "center", width: "18px", height: "1.5em", cursor: "pointer", borderRadius: "4px",
    color: "var(--muted-foreground)", opacity: "0", transition: "opacity 120ms",
  },
  "& .cm-vau-fold svg": { transition: "transform 120ms" },
  "& .cm-vau-fold.is-hover, & .cm-vau-fold:hover": { opacity: "1" },
  "& .cm-vau-fold:hover": { color: "var(--foreground)", background: "color-mix(in srgb, var(--foreground) 6%, transparent)" },
  "& .cm-vau-fold.is-folded": { opacity: "1" },
  "& .cm-vau-fold.is-folded svg": { transform: "rotate(-90deg)" },
  "& .cm-foldPlaceholder": {
    display: "inline-block", margin: "0 6px", padding: "0 6px", border: "none", borderRadius: "5px", cursor: "pointer",
    background: "color-mix(in srgb, var(--foreground) 7%, transparent)", color: "var(--muted-foreground)", fontSize: "0.85em", lineHeight: "1.5",
    verticalAlign: "middle", fontWeight: "500",
  },
  "& .cm-foldPlaceholder:hover": { background: "color-mix(in srgb, var(--foreground) 12%, transparent)", color: "var(--foreground)" },
  // The phone layout (a narrow window too) has no margin to put them in (`narrow`).
  "&.vau-narrow .cm-vau-fold-gutter": { display: "none !important" },
  // Alone, their emptied column would still hang 2px past the window's left edge.
  "&.vau-narrow .cm-gutters:not(:has(.cm-gutter:not(.cm-vau-fold-gutter)))": { display: "none !important" },
})

/** What the plugin adds to a note's editor (`path`: its file, to remember its folds). */
export function foldingExtension(path?: string): Extension {
  // A device without a pointer that
  // rests (a phone) has no chevrons to show: what's folded (Fold all, a fold kept from a computer) opens from its "…".
  const pointer = typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches
  // The gutter is drawn in the margin (theme), not beside the text: not "fixed", or CodeMirror counts its width as a
  // margin over the text's left edge and hides what's anchored there (the slash menu of a "/" at a line's start).
  return [codeFolding({ placeholderText: "…" }), pointer ? [chevrons, gutters({ fixed: false }), hover, narrow] : [], theme, path ? remember(path) : []]
}
