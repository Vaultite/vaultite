// Dictation in an editor: words not settled drawn dimmed at an anchor that follows edits (never in the document), the
// settled ones typed in there as the user's input ("input.dictation"): undo, autosave and the companion take them so.
import { Facet, StateEffect, StateField, type Extension } from "@codemirror/state"
import { Decoration, EditorView, WidgetType } from "@codemirror/view"
import { joinText, type DictationTarget } from "@vaultite"

/** Where the words go and the pending ones; `moved`: the user put the cursor elsewhere since, which takes effect at the
 *  next utterance (a sentence under way finishes where it started). */
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

/** What every editor gets: the anchor and its pending words. */
export const dictationEditor = (path?: string): Extension => [spot, pathOf.of(path), EditorView.baseTheme({
  ".cm-dictation-pending": { color: "var(--muted-foreground)", opacity: "0.75" },
})]

/** What's still pending once `final` settled: the rest of the words it began with, else none (the next ones come). */
const rest = (pending: string, final: string) => {
  const p = pending.trimStart(), f = final.trim()
  return f && p.startsWith(f) ? p.slice(f.length) : ""
}

/** Where the cursor puts words: Vim's block cursor sits on a character, and on a line's last one they go after it. */
function caret(view: EditorView) {
  const head = view.state.selection.main.head, line = view.state.doc.lineAt(head)
  return line.length && head === line.to - 1 && view.dom.querySelector(".cm-fat-cursor") ? line.to : head
}

/** Dictate into `view`, at its cursor. */
export function editorTarget(view: EditorView): DictationTarget | null {
  if (view.state.field(spot, false) === undefined) return null
  view.dispatch({ effects: set.of({ at: caret(view), text: "", moved: false }) })
  const here = () => (view.dom.isConnected ? view.state.field(spot, false) ?? null : null)
  /** The anchor for words starting now: the cursor, if the user moved it there since the last ones. */
  const anchor = (s: Spot) => (s.moved && !s.text ? caret(view) : s.at)
  const before = (at: number) => view.state.sliceDoc(Math.max(0, at - 1), at)
  return {
    view,
    path: view.state.facet(pathOf),
    showsPending: true,
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
      // (the cursor where the words go goes on with them, as when typing; Vim's block on their last character)
      const follow = sel.empty && (sel.head === at || block)
      view.dispatch({
        changes: { from: at, insert },
        effects: set.of({ at: at + insert.length, text: rest(s.text, insert), moved: false }),
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
