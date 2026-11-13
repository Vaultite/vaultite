import { codeFolding, ensureSyntaxTree, foldEffect, foldedRanges, foldState, syntaxTree, unfoldEffect } from "@codemirror/language"
import { type EditorState, type Extension, type StateEffect } from "@codemirror/state"
import { EditorView, gutter, GutterMarker, gutters, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import type { SyntaxNode } from "@lezer/common"

type Range = { from: number; to: number }
const LINE: Record<number, number> = { 1: 1.625 * 1.31, 2: 1.3125 * 1.333, 3: 1.125 * 1.39, 4: 1.44, 5: 1.44, 6: 1.44 }

const HEADING = /^(?:ATX|Setext)Heading(\d)$/
const levelOf = (n: SyntaxNode) => { const m = HEADING.exec(n.name); return m ? Number(m[1]) : 0 }
const CANDIDATE = /^[ \t]*(?:#{1,6}(?:[ \t]|$)|[-*+][ \t]|\d+[.)][ \t])/

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

export function foldRangeAt(state: EditorState, n: number): (Range & { level: number }) | null {
  const node = nodeAt(state, n)
  if (!node) return null
  const line = state.doc.line(n)
  let end: number
  const level = levelOf(node)
  if (level) {
    let last: SyntaxNode = node
    for (let next = node.nextSibling; next; next = next.nextSibling) {
      const l = levelOf(next)
      if (l && l <= level) break
      last = next
    }
    end = last.to
  } else end = node.to
  while (end > line.to && /\s/.test(state.sliceDoc(end - 1, end))) end--
  if (end <= line.to) return null
  return { from: line.to, to: Math.min(end, state.doc.length), level }
}

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

function foldedAt(state: EditorState, n: number): Range | null {
  const at = state.doc.line(n).to
  let hit: Range | null = null
  foldedRanges(state).between(at, at, (from, to) => { if (from === at) { hit = { from, to }; return false } })
  return hit
}

class Chevron extends GutterMarker {
  folded: boolean; level: number
  constructor(folded: boolean, level: number) { super(); this.folded = folded; this.level = level }
  eq(o: Chevron) { return o.folded === this.folded && o.level === this.level }
  toDOM() {
    const el = document.createElement("span")
    el.className = `cm-vau-fold${this.folded ? " is-folded" : ""}`
    if (this.level) { el.classList.add("is-heading"); el.style.height = `${LINE[this.level] ?? 1.5}em` }
    el.setAttribute("aria-label", this.folded ? "Unfold" : "Fold")
    el.setAttribute("role", "button")
    el.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
    return el
  }
}

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
    if (foldedAt(view.state, n)) return new Chevron(true, level ?? 0)
    return level === null ? null : new Chevron(false, level)
  },
  lineMarkerChange: (u) => syntaxTree(u.startState) !== syntaxTree(u.state) || u.startState.field(foldState, false) !== u.state.field(foldState, false),
  domEventHandlers: {
    mousedown(view, block, e) {
      if (!(e.target instanceof Element && e.target.closest(".cm-vau-fold"))) return false
      e.preventDefault()
      return toggleLine(view, view.state.doc.lineAt(block.from).number)
    },
  },
})

// CSS can't tie a line to its gutter marker.
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
    const b = h >= 0 && h <= v.contentHeight ? v.lineBlockAtHeight(h) : null, top = v.documentTop + (b?.top ?? 0), bottom = top + (b?.height ?? 0)
    const el = b && [...v.dom.querySelectorAll(".cm-vau-fold")].find((m) => { const r = m.getBoundingClientRect(); return r.top < bottom && r.bottom > top }) || null
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

const KEY = "vaultite.folds"
const KEEP = 200
type Kept = Record<string, { text: string; nth: number }[]>
const readKept = (): Kept => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {} } catch { return {} } }

function foldsOf(state: EditorState) {
  const out: { text: string; nth: number }[] = []
  const seen = new Map<string, number>()
  let last = 0
  const counts = (upTo: number) => {
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
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* localStorage throws in private mode, or full */ }
}

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

type Track = (what: string, on: () => boolean, save: boolean) => () => void
function remember(path: string, track: Track) {
  return ViewPlugin.fromClass(class {
    timer: ReturnType<typeof setTimeout> | null = null
    view: EditorView
    saving = track("folds", () => this.timer !== null, true)
    constructor(view: EditorView) {
      this.view = view
      setTimeout(() => { if (view.dom.isConnected) restore(view, path) }, 0)
    }
    update(u: ViewUpdate) {
      const was = u.startState.field(foldState, false), now = u.state.field(foldState, false)
      if (was === now) return
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => { this.timer = null; keep(path, this.view.state) }, 300)
    }
    destroy() { this.saving(); if (this.timer) { clearTimeout(this.timer); keep(path, this.view.state) } }
  })
}

// CodeMirror's themes can't hold a media query, and it owns its element's classes.
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
  "&.vau-narrow .cm-vau-fold-gutter": { display: "none !important" },
  "&.vau-narrow .cm-gutters:not(:has(.cm-gutter:not(.cm-vau-fold-gutter)))": { display: "none !important" },
})

export function foldingExtension(path?: string, track: Track = () => () => {}): Extension {
  const pointer = typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches
  // A "fixed" gutter's width CodeMirror counts as a margin over the text, hiding what's anchored at a line's start.
  return [codeFolding({ placeholderText: "…" }), pointer ? [chevrons, gutters({ fixed: false }), hover, narrow] : [], theme, path ? remember(path, track) : []]
}
