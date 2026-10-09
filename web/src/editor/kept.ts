// A file's editor state (undo history, selection) kept when its editor goes, so a tab drawn again (a pane draws only
// its last few: components/Workspace.tsx) or a switch to source mode and back is as it was left. Per tab and file.
import { historyField } from "@codemirror/commands"
import { EditorSelection, EditorState, Transaction, type EditorStateConfig } from "@codemirror/state"
import { textChanges } from "@/core/merge"

type Kept = { json: unknown; source: boolean }
const MAX = 50
const kept = new Map<string, Kept>()

/** The key an editor is kept under: its tab (none outside one) and file. */
export const keptKey = (tab: string | undefined, file: string) => `${tab ?? ""}\n${file}`

/** An editor going: its state, for the next one of this tab and file. */
export function keepState(key: string, state: EditorState, source: boolean) {
  kept.delete(key) // (the latest last, so the oldest go first)
  kept.set(key, { json: state.toJSON({ history: historyField }), source })
  while (kept.size > MAX) kept.delete(kept.keys().next().value!)
}

/** The state an editor starts with: the kept one with its history, brought to `doc` (a change made meanwhile, out of
 *  the history, as one from disk is in an editor that stayed) and its selection only in the same mode; else null. */
export function keptState(key: string, doc: string, source: boolean, config: EditorStateConfig): { state: EditorState; selection: boolean } | null {
  const k = kept.get(key)
  if (!k) return null
  kept.delete(key)
  try {
    const json = k.json as { doc: string; selection: unknown }
    let state = EditorState.fromJSON(k.source === source ? json : { ...json, selection: EditorSelection.single(0).toJSON() }, config, { history: historyField })
    const changes = textChanges(json.doc, doc)
    if (changes.length) state = state.update({ changes, annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)] }).state
    if (state.doc.toString() !== doc) return null
    return { state, selection: k.source === source }
  } catch { return null }
}
