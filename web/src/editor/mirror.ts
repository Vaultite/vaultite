import { Annotation, Transaction, type Extension } from "@codemirror/state"
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view"

const mirrored = Annotation.define<boolean>()
const open = new Map<string, Set<EditorView>>()

export const mirror = (path: string): Extension => ViewPlugin.define((view) => {
  const views = open.get(path) ?? new Set<EditorView>()
  open.set(path, views.add(view))
  return {
    update(u) {
      for (const tr of u.transactions) {
        if (!tr.docChanged || tr.annotation(Transaction.remote)) continue
        for (const other of views) {
          if (other === view || !other.state.doc.eq(tr.startState.doc)) continue
          other.dispatch({ changes: tr.changes, annotations: [mirrored.of(true), Transaction.remote.of(true), Transaction.addToHistory.of(false)] })
        }
      }
    },
    destroy() { views.delete(view); if (!views.size) open.delete(path) },
  }
})

export const mirroredIn = (u: ViewUpdate) => u.transactions.every((t) => !t.docChanged || !!t.annotation(mirrored))
