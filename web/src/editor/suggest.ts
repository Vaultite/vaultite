// What every suggestion list in the editor does the same way: Enter, Tab or a click picks (the cursor after what went
// in, past a link's `]]`), Escape closes the list, and it stays closed while typing on in what it was suggesting for.
import { acceptCompletion, closeCompletion, completionStatus, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete"
import { Prec, StateEffect, StateField } from "@codemirror/state"
import { keymap, type EditorView } from "@codemirror/view"

/** Puts `text` and the link's `]]` in place of from..to (and of the `]]` already after it, as auto-pair typed it). */
export const pickLink = (text: string) => (view: EditorView, _c: Completion, from: number, to: number) => {
  const end = view.state.sliceDoc(to, to + 2) === "]]" ? to + 2 : to
  const insert = `${text}]]`
  view.dispatch({ changes: { from, to: end, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent: "input.complete" })
}

const dismiss = StateEffect.define<number>()
/** Where the list closed with Escape started (its `from`), until the cursor leaves it (goes before it or off its line). */
const dismissed = StateField.define<number | null>({
  create: () => null,
  update(at, tr) {
    for (const e of tr.effects) if (e.is(dismiss)) at = e.value
    if (at === null) return null
    if (tr.docChanged) at = tr.changes.mapPos(at, -1)
    const head = tr.state.selection.main.head
    return head < at || tr.state.doc.lineAt(head).from > at ? null : at
  },
})

const starts = new WeakMap<EditorView, number>()
/** A source that stays quiet where its list was closed with Escape (Ctrl-Space still asks it). */
export function quiet(source: CompletionSource): CompletionSource {
  return (ctx: CompletionContext) => {
    const check = (r: CompletionResult | null) => {
      if (!r || (!ctx.explicit && ctx.state.field(dismissed, false) === r.from)) return null
      if (ctx.view) starts.set(ctx.view, r.from)
      return r
    }
    const r = source(ctx)
    return r instanceof Promise ? r.then(check) : check(r)
  }
}

const close = (view: EditorView) => {
  if (completionStatus(view.state) !== "active") return false
  const from = starts.get(view)
  closeCompletion(view)
  if (from !== undefined) view.dispatch({ effects: dismiss.of(from) })
  return true
}

/** Goes before `autocompletion()`, so its Escape and Tab come first (Tab otherwise indents). */
export const suggestKeys = [dismissed, Prec.highest(keymap.of([{ key: "Escape", run: close }, { key: "Tab", run: acceptCompletion }]))]
