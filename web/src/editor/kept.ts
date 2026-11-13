import { historyField } from "@codemirror/commands"
import { EditorSelection, EditorState, Transaction, type EditorStateConfig } from "@codemirror/state"
import { textChanges } from "@/core/merge"

type Kept = { json: { doc: string; selection: unknown }; source: boolean }
const MAX = 50
const kept = new Map<string, Kept>()

export const keptKey = (tab: string | undefined, file: string) => `${tab ?? ""}\n${file}`

export function keepState(key: string, state: EditorState, source: boolean) {
  kept.delete(key)
  kept.set(key, { json: state.toJSON({ history: historyField }), source })
  while (kept.size > MAX) kept.delete(kept.keys().next().value!)
}

export function keptState(key: string, doc: string, source: boolean, config: EditorStateConfig): { state: EditorState; selection: boolean } | null {
  const k = kept.get(key)
  if (!k) return null
  kept.delete(key)
  try {
    const { json } = k
    let state = EditorState.fromJSON(k.source === source ? json : { ...json, selection: EditorSelection.single(0).toJSON() }, config, { history: historyField })
    const changes = textChanges(json.doc, doc)
    if (changes.length) state = state.update({ changes, annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)] }).state
    if (state.doc.toString() !== doc) return null
    return { state, selection: k.source === source }
  } catch { return null }
}
