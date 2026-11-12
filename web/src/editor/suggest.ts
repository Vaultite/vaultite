import { acceptCompletion, closeCompletion, completionStatus, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete"
import { type EditorState, Prec, StateEffect, StateField } from "@codemirror/state"
import { keymap, type EditorView } from "@codemirror/view"

// Replaces the `]]` that closeBrackets already typed after the cursor.
export const pickLink = (text: string) => (view: EditorView, _c: Completion, from: number, to: number) => {
  const end = view.state.sliceDoc(to, to + 2) === "]]" ? to + 2 : to
  const insert = `${text}]]`
  view.dispatch({ changes: { from, to: end, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent: "input.complete" })
}

const dismiss = StateEffect.define<number>()
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

// The editor's `override` makes CodeMirror ignore `autocomplete` language data, so plugins add theirs as `suggest`.
export const pluginSuggest: CompletionSource = (ctx) => {
  const sources = ctx.state.languageDataAt<CompletionSource>("suggest", ctx.pos)
  // Stays sync when the sources are: while a result is pending, CodeMirror lets Enter through as a new line.
  const next = (i: number): ReturnType<CompletionSource> => {
    if (i >= sources.length) return null
    const r = sources[i](ctx)
    return r instanceof Promise ? r.then((x) => x ?? next(i + 1)) : r ?? next(i + 1)
  }
  return next(0)
}

const starts = new WeakMap<EditorView, number>()
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

export const suggestKeys = [dismissed, Prec.highest(keymap.of([{ key: "Escape", run: close }, { key: "Tab", run: acceptCompletion }]))]

export const optionGlyph = (c: Completion) => (c as Completion & { glyph?: () => Node }).glyph?.() ?? null
export const optionTrail = (c: Completion, _s: EditorState, view: EditorView) => (c as Completion & { trail?: (view: EditorView) => Node | null }).trail?.(view) ?? null
