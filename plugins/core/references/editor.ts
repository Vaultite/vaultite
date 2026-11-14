import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete"
import { EditorState, type Extension, Prec, RangeSetBuilder, StateEffect } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, hoverTooltip, tooltips, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view"
import { get, type EditorCtx } from "@vaultite"
import { type Citation, citationsIn } from "./cite.ts"
import { formatCites, onLibraryChange } from "./client.ts"
import { citationCard } from "./card.ts"
import { safeHtml } from "./safe.ts"
import type { SearchAnswer } from "./wire.ts"
import "./citations.css"

const answered = StateEffect.define<null>()
const TYPING = /(?:^|[\s[;(-])-?@([\p{L}\p{N}_:.#$%&\-+?<>~/]*)$/u

const inBrackets = (before: string) => /\[[^\]]*$/.test(before)
const startsAKey = (r: SearchAnswer, typed: string) => typed.length >= 3 && r.results.some((x) => x.key.toLowerCase().startsWith(typed.toLowerCase()))

async function suggest(ctx: CompletionContext, path: string): Promise<CompletionResult | null> {
  const line = ctx.state.doc.lineAt(ctx.pos), before = line.text.slice(0, ctx.pos - line.from)
  const m = TYPING.exec(before)
  if (!m || (!ctx.explicit && !m[1] && !/\[-?@$/.test(before))) return null
  const from = ctx.pos - m[1].length, bracketed = inBrackets(line.text.slice(0, from - line.from))
  const r = await get<SearchAnswer>(`references/search?q=${encodeURIComponent(m[1])}&path=${encodeURIComponent(path)}&limit=40`).catch(() => null)
  if (!r?.results.length || ctx.aborted || (!bracketed && !startsAKey(r, m[1]))) return null
  const closes = bracketed && !/^[^[]*\]/.test(line.text.slice(ctx.pos - line.from))
  return {
    from, filter: false,
    options: r.results.map((x, i) => ({
      label: x.key, displayLabel: [[x.authors, x.year].filter(Boolean).join(" "), x.title].filter(Boolean).join(" · ") || x.key, detail: `@${x.key}`, boost: -i, type: "text",
      apply: closes ? `${x.key}]` : x.key,
    })),
  }
}

class Chip extends WidgetType {
  html: string
  missing: boolean
  constructor(html: string) {
    super()
    this.html = html
    this.missing = html.includes("csl-missing")
  }
  eq(o: Chip) { return o.html === this.html }
  toDOM(view: EditorView) {
    const span = document.createElement("span")
    span.className = this.missing ? "cm-citation cm-citation-missing" : "cm-citation"
    span.innerHTML = safeHtml(this.html)
    span.addEventListener("mousedown", (e) => {
      e.preventDefault()
      const at = view.posAtDOM(span)
      view.dispatch({ selection: { anchor: at + 1 } })
      view.focus()
    })
    return span
  }
  ignoreEvent() { return true }
}

const SOURCE = Decoration.mark({ class: "cm-citation-source" })

class Chips {
  decorations: DecorationSet = Decoration.none
  cites: Citation[] = []
  html: string[] | null = null
  byText = new Map<string, string>()
  timer: ReturnType<typeof setTimeout> | null = null
  path: string
  shown: boolean
  stop: () => void

  constructor(view: EditorView, path: string, shown: boolean) {
    this.path = path
    this.shown = shown
    this.scan(view)
    this.ask(view, 0)
    this.stop = onLibraryChange(() => this.ask(view, 0))
  }

  scan(view: EditorView) {
    this.cites = citationsIn(view.state.doc.toString())
    this.html = null
  }

  ask(view: EditorView, wait: number) {
    if (this.timer) clearTimeout(this.timer)
    const sources = this.cites.map((c) => c.source)
    if (!sources.length) { this.decorations = Decoration.none; return }
    this.timer = setTimeout(() => {
      void formatCites(this.path, sources).then((r) => {
        if (sources.join("\u0001") !== this.cites.map((c) => c.source).join("\u0001")) return
        this.html = r.sources
        sources.forEach((s, i) => this.byText.set(s, r.sources[i] ?? ""))
        if (view.dom.isConnected) view.dispatch({ effects: answered.of(null) })
      }, () => {})
    }, wait)
  }

  update(u: ViewUpdate) {
    if (u.docChanged) { this.scan(u.view); this.ask(u.view, 350) }
    this.decorations = this.build(u.view)
  }

  build(view: EditorView): DecorationSet {
    const b = new RangeSetBuilder<Decoration>()
    const sel = view.state.selection.ranges, editing = view.hasFocus
    const seen = view.visibleRanges
    this.cites.forEach((c, i) => {
      if (!seen.some((r) => c.to >= r.from && c.from <= r.to)) return
      const html = this.html?.[i] ?? this.byText.get(c.source) ?? ""
      if (!html) return
      const inside = editing && sel.some((r) => r.from <= c.to && r.to >= c.from)
      if (inside || !this.shown) b.add(c.from, c.to, SOURCE)
      else b.add(c.from, c.to, Decoration.replace({ widget: new Chip(html) }))
    })
    return b.finish()
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer)
    this.stop()
  }
}

const chips = (path: string, shown: boolean) => ViewPlugin.define((view) => new Chips(view, path, shown), { decorations: (p) => p.decorations })

const hover = (path: string) => hoverTooltip((view, pos) => {
  const c = citationsIn(view.state.doc.toString()).find((x) => pos >= x.from && pos <= x.to)
  if (!c) return null
  return { pos: c.from, end: c.to, above: false, create: () => ({ dom: citationCard(c.items.map((i) => i.key), path) }) }
}, { hideOnChange: true, hoverTime: 350 })

const inPane = tooltips({ tooltipSpace: (view) => {
  const pane = view.dom.closest("[data-pane]")?.getBoundingClientRect()
  return pane ?? new DOMRect(0, 0, innerWidth, innerHeight)
} })

export function citationsExtension(ctx: EditorCtx): Extension {
  const path = ctx.path ?? ""
  return [
    Prec.highest(EditorState.languageData.of(() => [{ suggest: (c: CompletionContext) => suggest(c, path) }])),
    chips(path, !ctx.source),
    hover(path),
    inPane,
  ]
}
