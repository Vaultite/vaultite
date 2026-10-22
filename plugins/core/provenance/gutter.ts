// Agents' lines in a note's editor: a bar in the writer's colour (dashed: the user edited it too), who on hover or menu,
// the text washed in it with `authorship: tint`. Sidecar spans (plugin.ts) found in the text a moment after each change.
import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view"
import { type EditorCtx, fmtStamp, fmtTime, get, onVaultChange } from "@vaultite"
import { type Author, authorText, type Mark, resolve, type Span } from "./authorship"

type Mode = "off" | "gutter" | "tint"
type Got = { mode: Mode; spans: Span[] }

const sameDay = (t: number) => new Date(t).toDateString() === new Date().toDateString()
const when = (t: number) => (sameDay(t) ? fmtTime(new Date(t).toISOString()) : fmtStamp(t))
/** What a line's bar says: "Opus · Opus 5.5 high · 7:36 PM", and that the user edited it too. */
const tipOf = (a: Author, mixed: boolean) => `${authorText(a, when)}${mixed ? ", edited by you" : ""}`

class Bar extends WidgetType {
  tint: string; tip: string; mixed: boolean; first: boolean; last: boolean
  constructor(tint: string, tip: string, mixed: boolean, first: boolean, last: boolean) {
    super()
    this.tint = tint; this.tip = tip; this.mixed = mixed; this.first = first; this.last = last
  }
  eq(o: Bar) { return o.tint === this.tint && o.tip === this.tip && o.mixed === this.mixed && o.first === this.first && o.last === this.last }
  toDOM() {
    const el = document.createElement("span")
    el.className = `cm-authored-bar${this.mixed ? " is-mixed" : ""}${this.first ? " is-first" : ""}${this.last ? " is-last" : ""}`
    el.style.setProperty("--c", `var(--${this.tint})`)
    el.setAttribute("data-tip", this.tip)
    el.setAttribute("data-tip-side", "right")
    el.setAttribute("aria-hidden", "true")
    return el
  }
  ignoreEvent() { return true }
}

const set = StateEffect.define<Got>()
const marks = StateEffect.define<DecorationSet>()

/** The decorations of `marks` found in `doc`. */
function decorate(view: EditorView, got: Got): DecorationSet {
  if (got.mode === "off" || !got.spans.length) return Decoration.none
  const doc = view.state.doc, found = resolve(doc.toString(), got.spans)
  const b = new RangeSetBuilder<Decoration>()
  const at = (n: number) => found.get(n)
  const same = (x: Mark | undefined, y: Mark | undefined) => !!x && !!y && x.span === y.span && x.mixed === y.mixed
  for (let n = 1; n <= doc.lines; n++) {
    const m = at(n)
    if (!m) continue
    const s = got.spans[m.span], line = doc.line(n), tint = s.tint || "orange"
    const cls = `cm-authored${got.mode === "tint" ? " cm-authored-tint" : ""}${m.mixed ? " is-mixed" : ""}`
    b.add(line.from, line.from, Decoration.line({ class: cls, attributes: { style: `--c: var(--${tint})` } }))
    b.add(line.from, line.from, Decoration.widget({ widget: new Bar(tint, tipOf(s, m.mixed), m.mixed, !same(at(n - 1), m), !same(at(n + 1), m)), side: -1 }))
  }
  return b.finish()
}

/** Each editor's spans as last read, for its menu (a held finger has no hover). */
const shown = new WeakMap<EditorView, () => Got>()

/** Who wrote the line at the cursor, as its bar's tip says it, and that run of lines; null for the user's. */
export function authorAt(view: EditorView) {
  const got = shown.get(view)?.()
  if (!got || got.mode === "off" || !got.spans.length) return null
  const doc = view.state.doc, found = resolve(doc.toString(), got.spans), n = doc.lineAt(view.state.selection.main.head).number, m = found.get(n)
  if (!m) return null
  let a = n, b = n
  while (found.get(a - 1)?.span === m.span) a--
  while (found.get(b + 1)?.span === m.span) b++
  return { tip: tipOf(got.spans[m.span], m.mixed), from: doc.line(a).from, to: doc.line(b).to }
}

export function authorshipExtension(ctx: EditorCtx): Extension {
  const path = ctx.path!
  const field = StateField.define<{ got: Got; deco: DecorationSet }>({
    create: () => ({ got: { mode: "off", spans: [] }, deco: Decoration.none }),
    update(v, tr) {
      let { got, deco } = v
      deco = deco.map(tr.changes)
      for (const e of tr.effects) {
        if (e.is(set)) got = e.value
        if (e.is(marks)) deco = e.value
      }
      return got === v.got && deco === v.deco ? v : { got, deco }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })
  const draw = ViewPlugin.fromClass(class {
    timer: ReturnType<typeof setTimeout> | undefined
    off: () => void
    on = true
    view: EditorView
    constructor(view: EditorView) {
      this.view = view
      shown.set(view, () => view.state.field(field).got)
      this.load()
      this.off = onVaultChange((paths) => {
        if (paths === null || paths.some((p) => p === path || p === ".vaultite" || p === ".vaultite/plugins" || p.startsWith(".vaultite/plugins/provenance"))) this.load()
      })
    }
    load() {
      get<Got>(`provenance/authorship?path=${encodeURIComponent(path)}`).then((got) => {
        if (!this.on) return
        this.view.dispatch({ effects: set.of({ mode: got.mode, spans: Array.isArray(got.spans) ? got.spans : [] }) })
        this.redraw(0)
      }).catch(() => { /* not a note the server knows (yet): nothing to draw */ })
    }
    redraw(ms = 250) {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        if (this.on) this.view.dispatch({ effects: marks.of(decorate(this.view, this.view.state.field(field).got)) })
      }, ms)
    }
    update(u: ViewUpdate) { if (u.docChanged) this.redraw() }
    destroy() { this.on = false; clearTimeout(this.timer); this.off() }
  })
  return [field, draw, theme]
}

const theme = EditorView.baseTheme({
  ".cm-line.cm-authored": { position: "relative" },
  // (in the margin, between the fold arrows and the text; the span is its hit area, the bar its ::after)
  // (above the fold arrows' gutter, which spans the margin, without reaching their arrows)
  ".cm-authored-bar": { position: "absolute", left: "-7px", top: "0", bottom: "0", width: "7px", zIndex: "2", cursor: "default" },
  ".cm-authored-bar::after": { content: "''", position: "absolute", left: "2px", top: "0", bottom: "0", width: "2px", background: "color-mix(in srgb, var(--c) 75%, transparent)" },
  ".cm-authored-bar.is-first::after": { top: "3px", borderTopLeftRadius: "1px", borderTopRightRadius: "1px" },
  ".cm-authored-bar.is-last::after": { bottom: "3px", borderBottomLeftRadius: "1px", borderBottomRightRadius: "1px" },
  // (both wrote it: the agent's colour in dashes, the gaps a neutral, as the user has no colour)
  ".cm-authored-bar.is-mixed::after": { background: "repeating-linear-gradient(to bottom, color-mix(in srgb, var(--c) 75%, transparent) 0 4px, color-mix(in srgb, var(--foreground) 22%, transparent) 4px 7px)" },
  ".cm-line.cm-authored-tint": { backgroundColor: "color-mix(in srgb, var(--c) 9%, transparent)" },
  ".cm-line.cm-authored-tint.is-mixed": { backgroundColor: "color-mix(in srgb, var(--c) 5%, transparent)" },
})
