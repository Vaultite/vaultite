// The find bar: CodeMirror's search with a panel of the app's own, sticking under the pane's bar while the file
// scrolls. Loaded when an editor first needs it.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { flushSync } from "react-dom"
import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Regex, WholeWord, X } from "lucide-react"
import { EditorView, keymap, type Panel, type ViewUpdate } from "@codemirror/view"
import { EditorSelection, Prec, StateEffect, StateField, type EditorState, type Extension, type SelectionRange } from "@codemirror/state"
import {
  closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, searchPanelOpen, SearchQuery, setSearchQuery,
} from "@codemirror/search"
import { cn, commandKeys, editorOf, keyHint, numberText, openAround, textRanges } from "@vaultite"

/** Counting stops here: a find in a huge file stays quick ("1,000+"). */
export const MAX = 1000

type Spec = { search: string; replace: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean }
/** A query that finds only what's shown: not in the frontmatter a note's editor hides, nor (outside source mode) in
 *  a link's address or what a view is drawn from. */
const queryIn = (view: EditorView, q: Spec) => new SearchQuery({ search: q.search, replace: q.replace, caseSensitive: q.caseSensitive, regexp: q.regexp,
  wholeWord: q.wholeWord, test: (_m, state, from, to) => {
    const ed = editorOf(view)
    return from >= (ed?.start?.(state) ?? 0) && (ed?.findable?.(state, from, to) ?? true)
  } })

type Count = { total: number; current: number; more: boolean }

/** How many matches, and which one is selected (0: none is). */
function countOf(state: EditorState, q: SearchQuery): Count {
  if (!q.search || !q.valid) return { total: 0, current: 0, more: false }
  const sel = state.selection.main
  const cur = q.getCursor(state)
  let total = 0, current = 0
  for (let m = cur.next(); !m.done; m = cur.next()) {
    total++
    if (m.value.from === sel.from && m.value.to === sel.to) current = total
    if (total >= MAX) return { total, current, more: true }
  }
  return { total, current, more: false }
}

/** Select the first match at or after the cursor (wrapping round to the top), as you type. */
function seek(view: EditorView, q: SearchQuery) {
  if (!q.search || !q.valid) return
  const from = view.state.selection.main.from
  let m = q.getCursor(view.state, from).next()
  if (m.done) m = q.getCursor(view.state, 0, from + q.search.length).next()
  if (m.done) return
  const range = EditorSelection.range(m.value.from, m.value.to)
  view.dispatch({ selection: range, effects: scrollTo(range, view), userEvent: "select.search" })
}

// Matches in drawn blocks (a table, a callout, a <details>), where CodeMirror can't mark or scroll: lit with CSS
// highlights in what's drawn, the current one taken into view.

/** The query as a pattern for text on screen, as CodeMirror matches it. */
export function pattern(q: SearchQuery): RegExp | null {
  if (!q.search || !q.valid) return null
  let src = q.regexp ? q.search
    : (q.literal ? q.search : q.search.replace(/\\([nrt\\])/g, (_, c) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : "\\"))).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (q.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`
  for (const flags of ["gmu", "gm"]) {
    try { return new RegExp(src, flags + (q.caseSensitive ? "" : "i")) } catch { /* (valid only without u) */ }
  }
  return null
}

/** What each find open (an editor's bar, a page's) lights, joined into the page's two highlights (index.css colours
 *  them). */
export const lit = new Map<object, { all: Range[]; current: Range | null }>()
export function paintLit() {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return
  const all = [...lit.values()].flatMap((x) => x.all), cur = [...lit.values()].flatMap((x) => (x.current ? [x.current] : []))
  if (all.length) CSS.highlights.set("vau-find", new Highlight(...all)); else CSS.highlights.delete("vau-find")
  if (cur.length) { const h = new Highlight(...cur); h.priority = 1; CSS.highlights.set("vau-find-current", h) } else CSS.highlights.delete("vau-find-current")
}

/** The nearest box around `el` that scrolls, `axis` being x or y. */
export function scroller(el: Element | null, axis: "x" | "y", stop?: Element): HTMLElement | null {
  for (; el && el !== stop; el = el.parentElement) {
    const cs = getComputedStyle(el), o = axis === "x" ? cs.overflowX : cs.overflowY
    if (/auto|scroll/.test(o) && (axis === "x" ? el.scrollWidth > el.clientWidth : el.scrollHeight > el.clientHeight)) return el as HTMLElement
  }
  return null
}

/** Take a match drawn in a block into view: its <details> opened, a wide table scrolled sideways to it, and the pane
 *  scrolled to put it in the middle, as CodeMirror does with what it finds in text. */
function show(view: EditorView, r: Range | Element) {
  reveal(r, view.contentDOM, scroller(view.scrollDOM, "y"), view.dom.querySelector(".cm-panels-top"))
}

/** Take what was found into view: its <details> opened, what scrolls sideways inside `within` (a wide table) scrolled
 *  to it, and `sc` scrolled to put it in the middle of what shows below `bar`. */
export function reveal(r: Range | Element, within: Element, sc: HTMLElement | null, bar?: Element | null) {
  const inside = r instanceof Range ? r.startContainer.parentElement : null
  if (r instanceof Range) openAround(r)
  for (let el = scroller(inside, "x", within); el; el = scroller(el.parentElement, "x", within)) {
    const m = r.getBoundingClientRect(), e = el.getBoundingClientRect(), pad = 24
    if (m.left < e.left + pad) el.scrollLeft -= e.left + pad - m.left
    else if (m.right > e.right - pad) el.scrollLeft += Math.min(m.right - (e.right - pad), m.left - (e.left + pad))
  }
  if (!sc) return
  const m = r.getBoundingClientRect(), s = sc.getBoundingClientRect()
  const top = Math.max(s.top, bar?.getBoundingClientRect().bottom ?? s.top)
  sc.scrollTop += Math.round((m.top + m.bottom) / 2 - (top + s.bottom) / 2)
}

/** Nothing for CodeMirror to scroll: the find bar takes the match into view itself. */
const shownByBar = StateEffect.define<null>()

/** How a match is taken into view: by CodeMirror when it's text, by the bar when it's in a drawn block. */
function scrollTo(range: SelectionRange, view: EditorView): StateEffect<unknown> {
  const panel = panels.get(view)
  const block = panel && editorOf(view)?.blocks?.().find((b) => b.from <= range.from && range.from < b.to)
  if (!panel || !block) return EditorView.scrollIntoView(range, { y: "center" })
  panel.target = { pos: range.from, tries: 0 }
  return shownByBar.of(null)
}

export const tool = "grid size-7 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent max-md:size-9"
export const field = "h-7 w-full min-w-0 rounded-[6px] bg-card px-2 text-[13px] text-foreground outline-none ring-1 ring-border placeholder:text-muted-foreground focus:ring-primary/60 max-md:h-9 max-md:text-[16px]"

export function Toggle({ on, label, keys, onClick, children }: { on: boolean; label: string; keys?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} data-tip={keys ? `${label} (${keys})` : label} onClick={onClick} onMouseDown={(e) => e.preventDefault()}
      className={cn(tool, on && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}>{children}</button>
  )
}

type BarProps = { view: EditorView; query: SearchQuery; count: Count; readOnly: boolean; replacing: boolean; setReplacing: (on: boolean) => void
  /** Bumped to put the keyboard in a field (find, or replace when it's asked for with text to find). */
  focus: { n: number; field: "find" | "replace" } }

function Bar({ view, query, count, readOnly, replacing, setReplacing, focus }: BarProps) {
  const [find, setFind] = useState(query.search)
  const [repl, setRepl] = useState(query.replace)
  useEffect(() => { setFind((f) => (f === query.search ? f : query.search)) }, [query.search])
  useEffect(() => { setRepl((r) => (r === query.replace ? r : query.replace)) }, [query.replace])
  const findRef = useRef<HTMLInputElement>(null), replRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = focus.field === "replace" && replRef.current ? replRef.current : findRef.current
    el?.focus(); el?.select()
  }, [focus])
  const set = (spec: Partial<{ search: string; replace: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean }>) => {
    const q = queryIn(view, { search: query.search, replace: query.replace, caseSensitive: query.caseSensitive, regexp: query.regexp, wholeWord: query.wholeWord, ...spec })
    view.dispatch({ effects: setSearchQuery.of(q) })
    if (spec.search !== undefined || spec.caseSensitive !== undefined || spec.regexp !== undefined || spec.wholeWord !== undefined) seek(view, q)
  }
  const keys = (e: KeyboardEvent, which: "find" | "replace") => {
    if (e.key === "Escape") { e.preventDefault(); closeSearchPanel(view); view.focus(); return }
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (which === "replace" && !readOnly) { if (e.metaKey || e.ctrlKey) replaceAll(view); else replaceNext(view); return }
    if (e.shiftKey) findPrevious(view); else findNext(view)
  }
  const none = !!query.search && query.valid && count.total === 0
  const bad = none || (!!query.search && !query.valid)
  const status = !query.search ? "" : !query.valid ? "Not a valid regular expression" : none ? "No results"
    : `${count.current ? `${numberText(count.current)} of ` : ""}${numberText(count.total)}${count.more ? "+" : ""}${count.current ? "" : count.total === 1 ? " result" : " results"}`
  const canReplace = !readOnly
  return (
    <div className="flex flex-col gap-1 px-1 py-1.5 max-md:gap-1.5" data-find-bar data-replacing={replacing && canReplace ? "" : undefined}>
      <div className="flex min-w-0 items-center gap-0.5 max-md:flex-wrap max-md:gap-y-1.5">
        {canReplace && (
          <button type="button" aria-label={replacing ? "Hide replace" : "Show replace"} aria-expanded={replacing} data-tip={replacing ? "Hide replace" : `Replace${commandKeys("find:replace") ? ` (${commandKeys("find:replace")})` : ""}`}
            onClick={() => setReplacing(!replacing)} onMouseDown={(e) => e.preventDefault()} className={cn(tool, "w-5 max-md:w-7")}>
            <ChevronRight className={cn("size-3.5 transition-transform duration-150", replacing && "rotate-90")} strokeWidth={2.5} />
          </button>
        )}
        <div className="relative min-w-0 flex-1 max-md:order-first max-md:basis-full">
          <input ref={findRef} main-field="true" value={find} placeholder="Find" aria-label="Find" spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
            onChange={(e) => { setFind(e.target.value); set({ search: e.target.value }) }} onKeyDown={(e) => keys(e, "find")}
            className={cn(field, "pr-28 max-md:pr-24", bad ? "ring-[color-mix(in_srgb,var(--red)_55%,transparent)] focus:ring-[color-mix(in_srgb,var(--red)_70%,transparent)]" : "")} />
          <span aria-live="polite" data-find-count className={cn("pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] tabular-nums max-md:text-[13px]", bad ? "text-[var(--red)]" : "text-muted-foreground")}>{status}</span>
        </div>
        <Toggle on={query.caseSensitive} label="Match case" onClick={() => set({ caseSensitive: !query.caseSensitive })}><CaseSensitive className="size-4" strokeWidth={2} /></Toggle>
        <Toggle on={query.wholeWord} label="Whole word" onClick={() => set({ wholeWord: !query.wholeWord })}><WholeWord className="size-4" strokeWidth={2} /></Toggle>
        <Toggle on={query.regexp} label="Regular expression" onClick={() => set({ regexp: !query.regexp })}><Regex className="size-4" strokeWidth={2} /></Toggle>
        <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border max-md:invisible max-md:ml-auto" />
        <button type="button" aria-label="Previous match" data-tip="Previous match (⇧↵)" disabled={!count.total} onClick={() => findPrevious(view)} onMouseDown={(e) => e.preventDefault()} className={tool}>
          <ChevronUp className="size-4" strokeWidth={2} />
        </button>
        <button type="button" aria-label="Next match" data-tip="Next match (↵)" disabled={!count.total} onClick={() => findNext(view)} onMouseDown={(e) => e.preventDefault()} className={tool}>
          <ChevronDown className="size-4" strokeWidth={2} />
        </button>
        <button type="button" aria-label="Close" data-tip="Close (esc)" onClick={() => { closeSearchPanel(view); view.focus() }} onMouseDown={(e) => e.preventDefault()} className={tool}>
          <X className="size-4" strokeWidth={2} />
        </button>
      </div>
      {replacing && canReplace && (
        <div className="flex min-w-0 items-center gap-1">
          <span className="w-5 shrink-0 max-md:hidden" />
          <input ref={replRef} value={repl} placeholder="Replace" aria-label="Replace" spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
            onChange={(e) => { setRepl(e.target.value); set({ replace: e.target.value }) }} onKeyDown={(e) => keys(e, "replace")} className={cn(field, "flex-1")} />
          <button type="button" disabled={!count.total} onClick={() => replaceNext(view)} onMouseDown={(e) => e.preventDefault()} data-tip="Replace this match (↵)"
            className="h-7 shrink-0 cursor-pointer rounded-[6px] px-2 text-[13px] font-medium hover:bg-foreground/[0.06] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent max-md:h-9 max-md:text-[15px]">Replace</button>
          <button type="button" disabled={!count.total} onClick={() => replaceAll(view)} onMouseDown={(e) => e.preventDefault()} data-tip={`Replace every match (${keyHint("Mod+Enter")})`}
            className="h-7 shrink-0 cursor-pointer rounded-[6px] px-2 text-[13px] font-medium hover:bg-foreground/[0.06] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent max-md:h-9 max-md:text-[15px]">Replace all</button>
        </div>
      )}
    </div>
  )
}

/** The panel CodeMirror shows while the search is open: a React root drawn again when the query, the text, the
 *  selection or whether it can be written changes. */
class FindPanel implements Panel {
  dom: HTMLElement
  top = true
  view: EditorView
  root: Root
  replacing = false
  focus: { n: number; field: "find" | "replace" } = { n: 0, field: "find" }
  count: Count = { total: 0, current: 0, more: false }
  counted: { query: SearchQuery; doc: unknown; sel: unknown } | null = null
  timer: ReturnType<typeof setTimeout> | null = null
  /** A match in a drawn block to take into view once it's drawn. */
  target: { pos: number; tries: number } | null = null
  frame = 0
  /** Blocks draw late (a section's React, a picture's height): light them again when they do. */
  watcher: MutationObserver

  constructor(view: EditorView) {
    this.view = view
    this.dom = document.createElement("div")
    this.dom.className = "vau-find"
    this.root = createRoot(this.dom)
    panels.set(view, this)
    this.watcher = new MutationObserver(() => this.light())
    this.watcher.observe(view.contentDOM, { childList: true, subtree: true, characterData: true })
  }
  mount() { this.recount(); this.draw(true); this.light() }
  update(u: ViewUpdate) {
    this.light()
    const q = getSearchQuery(u.state), was = getSearchQuery(u.startState)
    const ro = u.state.readOnly !== u.startState.readOnly
    if (!q.eq(was) || u.selectionSet || ro) { this.recount(); this.draw(false) }
    else if (u.docChanged) {
      // Typing with the bar open: count again a moment after, not on every keystroke.
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => { this.timer = null; this.recount(); this.draw(false) }, 150)
    }
  }
  destroy() {
    if (this.timer) clearTimeout(this.timer)
    cancelAnimationFrame(this.frame)
    this.watcher.disconnect()
    lit.delete(this.view)
    paintLit()
    panels.delete(this.view)
    const root = this.root
    setTimeout(() => root.unmount(), 0)
  }
  /** Light what's found in the drawn blocks on screen (next frame, once however often it's asked), and take the
   *  current match into view if it was just stepped to. */
  light() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      const { view } = this, state = view.state, q = getSearchQuery(state), re = pattern(q)
      const blocks = re ? (editorOf(view)?.blocks?.() ?? []) : []
      const all: Range[] = []
      let current: Range | null = null
      const sel = state.selection.main
      for (const b of blocks) {
        if (!b.text || !b.el || !re) continue
        const found = textRanges(b.el.querySelector<HTMLElement>(".cm-block-body") ?? b.el, re, MAX)
        all.push(...found)
        if (!this.count.current || sel.from < b.from || sel.from >= b.to || !found.length) continue
        // The current match is the block's k-th in its Markdown: the k-th drawn (what's found is what's shown).
        let k = 0
        const cur = q.getCursor(state, b.from, sel.from)
        for (let m = cur.next(); !m.done; m = cur.next()) if (m.value.from < sel.from) k++
        current = found[Math.min(k, found.length - 1)]
      }
      lit.set(view, { all, current })
      paintLit()
      const t = this.target
      if (!t) return
      const block = blocks.find((b) => b.from <= t.pos && t.pos < b.to)
      if (!block || ++t.tries > 4) { this.target = null; return }
      if (!block.el) {
        // Off screen, so not drawn: scrolled to where the editor reckons it is, and the match in it once it's drawn.
        const sc = scroller(view.scrollDOM, "y")
        if (sc && t.tries === 1) sc.scrollTop += Math.round(view.documentTop + view.lineBlockAt(block.from).top - sc.getBoundingClientRect().top - sc.clientHeight / 3)
        return
      }
      this.target = null
      show(view, current ?? block.el)
      // (the editor may still move it as it learns the heights of what it just drew: once more after)
      const again = current ?? block.el
      setTimeout(() => {
        const there = again instanceof Range ? !again.collapsed && again.startContainer.isConnected : again.isConnected
        if (there && !this.target) show(view, again)
      }, 100)
    })
  }
  recount() {
    const s = this.view.state, q = getSearchQuery(s)
    if (this.counted && this.counted.query.eq(q) && this.counted.doc === s.doc && this.counted.sel === s.selection) return
    this.counted = { query: q, doc: s.doc, sel: s.selection }
    this.count = countOf(s, q)
  }
  draw(sync: boolean) {
    const el = <Bar view={this.view} query={getSearchQuery(this.view.state)} count={this.count} readOnly={this.view.state.readOnly} replacing={this.replacing}
      setReplacing={(on) => { this.replacing = on; if (on) this.focus = { n: this.focus.n + 1, field: "replace" }; this.draw(false) }} focus={this.focus} />
    if (sync) flushSync(() => this.root.render(el)); else this.root.render(el)
  }
  /** ⌘F / ⌥⌘F with the bar open: show replace or not, and the keyboard in the right field. */
  ask(replace: boolean) {
    if (replace && !this.view.state.readOnly) this.replacing = true
    const q = getSearchQuery(this.view.state)
    this.focus = { n: this.focus.n + 1, field: replace && q.search && this.replacing ? "replace" : "find" }
    this.draw(true)
  }
}
const panels = new WeakMap<EditorView, FindPanel>()

/** Marks an editor that has the find bar (the plugin's extension may still be on its way when ⌘F is pressed). */
const installed = StateField.define<boolean>({ create: () => true, update: (v) => v })

/** What the plugin adds to every editor: the search, its matches' colours, the bar, and ⌘G / ⇧⌘G in the text. */
export const findExtension: Extension = [
  installed,
  search({ top: true, createPanel: (view) => new FindPanel(view), scrollToMatch: scrollTo }),
  Prec.high(keymap.of([
    { key: "Mod-g", run: (v) => searchPanelOpen(v.state) && findNext(v), shift: (v) => searchPanelOpen(v.state) && findPrevious(v) },
    { key: "Escape", run: (v) => { if (!searchPanelOpen(v.state)) return false; closeSearchPanel(v); return true } },
  ])),
  EditorView.theme({
    "&.cm-editor .cm-panels": { background: "var(--background)", color: "var(--foreground)", zIndex: "5" },
    "&.cm-editor .cm-panels.cm-panels-top": { top: "var(--vau-panel-top, 0px)", borderBottom: "0.5px solid var(--border)", marginBottom: "6px" },
    ".cm-searchMatch": { background: "color-mix(in srgb, var(--yellow) 32%, transparent)", borderRadius: "2px", boxShadow: "0 0 0 1px color-mix(in srgb, var(--yellow) 32%, transparent)" },
    ".cm-searchMatch.cm-searchMatch-selected": { background: "color-mix(in srgb, var(--orange) 50%, transparent)", boxShadow: "0 0 0 1px color-mix(in srgb, var(--orange) 50%, transparent)" },
  }),
]

/** Open the bar in `view` (⌘F), with replace (⌥⌘F) when it can be written. */
export function openFind(view: EditorView, replace: boolean) {
  if (!view.state.field(installed, false)) return
  openSearchPanel(view)
  view.dispatch({ effects: setSearchQuery.of(queryIn(view, getSearchQuery(view.state))) })
  panels.get(view)?.ask(replace)
}
