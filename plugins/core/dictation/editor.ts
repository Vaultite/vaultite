import { Facet, StateEffect, StateField, type Extension } from "@codemirror/state"
import { Decoration, EditorView, WidgetType } from "@codemirror/view"
import { joinText, type DictationTarget } from "@vaultite"
import { watchFix, type Watch } from "./learning.ts"

type Spot = { at: number; text: string; moved: boolean }
const set = StateEffect.define<Spot | null>()
const spot = StateField.define<Spot | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(set)) return e.value
    if (!v) return v
    const at = tr.docChanged ? tr.changes.mapPos(v.at, 1) : v.at
    const moved = v.moved || (tr.selection !== undefined && !tr.isUserEvent("input.dictation") && Math.abs(tr.state.selection.main.head - at) > 1)
    return at === v.at && moved === v.moved ? v : { ...v, at, moved }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => (v?.text ? Decoration.set([Decoration.widget({ widget: new Pending(v.text), side: 1 }).range(v.at)]) : Decoration.none)),
})

type Said = { from: number; to: number; watch: Watch }
export const said = StateEffect.define<Said>()
export const saids = StateField.define<Said[]>({
  create: () => [],
  update(v, tr) {
    const mine = tr.isUserEvent("input.dictation")
    let out = tr.docChanged ? v.map((s) => ({ ...s, from: tr.changes.mapPos(s.from, -1), to: tr.changes.mapPos(s.to, mine ? -1 : 1) })) : v
    for (const e of tr.effects) if (e.is(said)) out = [...out.slice(-19), e.value]
    return out
  },
})
const edits = EditorView.updateListener.of((u) => {
  for (const tr of u.transactions) {
    if (!tr.docChanged || tr.isUserEvent("input.dictation")) continue
    for (const s of tr.startState.field(saids, false) ?? []) if (tr.changes.touchesRange(s.from, s.to)) s.watch.edited()
  }
})

class Pending extends WidgetType {
  readonly text: string
  constructor(text: string) { super(); this.text = text }
  eq(o: Pending) { return o.text === this.text }
  toDOM() {
    const el = document.createElement("span")
    el.className = "cm-dictation-pending"
    el.textContent = this.text
    return el
  }
  ignoreEvent() { return true }
}

const pathOf = Facet.define<string | undefined, string | undefined>({ combine: (v) => v[0] })

export const dictationEditor = (path?: string): Extension => [spot, saids, edits, pathOf.of(path), EditorView.baseTheme({
  ".cm-dictation-pending": { color: "var(--muted-foreground)", opacity: "0.75" },
})]

const rest = (pending: string, final: string) => {
  const p = pending.trimStart(), f = final.trim()
  return f && p.startsWith(f) ? p.slice(f.length) : ""
}

/** Vim's block cursor sits on a character: on a line's last one, words go after it. */
function caret(view: EditorView) {
  const head = view.state.selection.main.head, line = view.state.doc.lineAt(head)
  return line.length && head === line.to - 1 && view.dom.querySelector(".cm-fat-cursor") ? line.to : head
}

export function viewOf(cm: HTMLElement) {
  const view = EditorView.findFromDOM(cm)
  return view && { target: editorTarget(view), dom: view.contentDOM }
}

export function editorTarget(view: EditorView): DictationTarget | null {
  if (view.state.field(spot, false) === undefined) return null
  view.dispatch({ effects: set.of({ at: caret(view), text: "", moved: false }) })
  const here = () => (view.dom.isConnected ? view.state.field(spot, false) ?? null : null)
  const anchor = (s: Spot) => (s.moved && !s.text ? caret(view) : s.at)
  const before = (at: number) => view.state.sliceDoc(Math.max(0, at - 1), at)
  return {
    view,
    path: view.state.facet(pathOf),
    showsPending: true,
    owns: (e) => view.dom.contains(e),
    pending(text) {
      const s = here()
      if (!s) return
      const at = anchor(s)
      view.dispatch({ effects: set.of({ at, text: text ? joinText(before(at), text) : "", moved: at === s.at && s.moved }) })
    },
    final(text) {
      const s = here()
      if (!s) return
      const at = anchor(s), insert = joinText(before(at), text)
      if (!insert) return
      const sel = view.state.selection.main, block = sel.head !== at && caret(view) === at
      const follow = sel.empty && (sel.head === at || block)
      const span: Said = { from: at, to: at + insert.length, watch: watchFix(insert, () => {
        const now = view.dom.isConnected ? view.state.field(saids, false)?.find((x) => x.watch === span.watch) : null
        return now ? view.state.sliceDoc(now.from, now.to) : null
      }) }
      view.dispatch({
        changes: { from: at, insert },
        effects: [set.of({ at: at + insert.length, text: rest(s.text, insert), moved: false }), said.of(span)],
        ...(follow ? { selection: { anchor: at + insert.length - (block ? 1 : 0) }, scrollIntoView: true } : {}),
        userEvent: "input.dictation",
      })
    },
    end() { if (view.dom.isConnected && view.state.field(spot, false)) view.dispatch({ effects: set.of(null) }) },
    rect() {
      const s = here()
      if (!s) return null
      if (!view.dom.getClientRects().length) return new DOMRect()
      const c = view.coordsAtPos(s.at, 1) ?? view.coordsAtPos(s.at, -1)
      if (!c) { const r = view.scrollDOM.getBoundingClientRect(); return new DOMRect(r.left, r.top, 0, 0) }
      return new DOMRect(c.left, c.top, 0, c.bottom - c.top)
    },
  }
}
